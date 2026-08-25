// 트웰브데이터 호출 횟수 장부 (api_usage 테이블)
//
// 왜 공용 모듈인가
// ----------------
// 트웰브데이터 무료 키의 한도는 "일 800회"인데, 이 저장소에서 그 키를 쓰는 곳이 둘이다.
//
//   1. api/twelve-data/time-series.js  — 방문자가 종목을 조회할 때 (source='web')
//   2. scripts/generate-*.js           — GitHub Actions 크론이 페이지를 갱신할 때 (source='cron')
//
// 예전에는 1번만 기록해서, 크론이 평일마다 400회 넘게 쓰는 걸 장부가 통째로 못 봤다.
// 그래서 화면에는 늘 실제보다 수백 회 적은 숫자가 떴다. 양쪽이 같은 장부를 쓰게 하려고
// 이 파일로 뺐다.
//
// 드라이버는 HTTP 방식(@neondatabase/serverless)이다. 쿼리 한 번이 fetch 한 번이라
// 유지할 소켓이 없다 — 서버리스 함수가 얼어붙었다 깨어나도 죽은 커넥션을 쓸 일이 없고,
// 크론 스크립트가 30분씩 도는 동안 커넥션을 붙들고 있지도 않는다.
//
// 규칙 하나: 이 파일의 어떤 함수도 예외를 밖으로 던지지 않는다. 장부 기록이 실패했다고
// 주가 조회나 페이지 생성이 죽으면 안 된다. 실패는 경고만 찍고 삼킨다.

const DAILY_LIMIT = 800;

let _sql = null;
let _resolved = false;

// 드라이버를 최상단에서 require 하지 않는다.
//
// Vercel 은 배포할 때 package.json 을 보고 알아서 설치하지만, GitHub Actions 워크플로는
// 체크아웃하고 node 스크립트를 바로 돌린다. 워크플로에 설치 단계를 넣어두긴 했지만,
// 거기에만 기대면 설치가 빠진 경로(로컬 실행, 파서 테스트 스텝) 하나가 MODULE_NOT_FOUND
// 로 데이터 갱신 전체를 죽인다. 장부는 부가 기능이므로 없으면 없는 대로 지나가야 한다.
function getSql() {
  if (_resolved) return _sql;
  _resolved = true;

  const url = process.env.DATABASE_URL;
  if (!url) return null;

  try {
    const { neon } = require('@neondatabase/serverless');
    _sql = neon(url);
  } catch (err) {
    console.warn('[DB] 드라이버를 불러오지 못해 사용량 집계를 건너뜁니다:', err.message);
    _sql = null;
  }
  return _sql;
}

// 테이블은 첫 사용 때 스스로 만든다. 프로세스당 한 번만 시도하고,
// 실패하면 캐시를 비워 다음 호출이 다시 시도하게 둔다.
let _schemaPromise = null;

function ensureSchema(sql) {
  if (!_schemaPromise) {
    _schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS api_usage (
          id          bigserial PRIMARY KEY,
          symbol      text        NOT NULL,
          status      text        NOT NULL,
          status_code integer,
          source      text        NOT NULL DEFAULT 'web',
          created_at  timestamptz NOT NULL DEFAULT now()
        )`;
      // source 는 나중에 추가된 컬럼이다. 이미 테이블이 있는 DB 도 따라오게 한다.
      await sql`ALTER TABLE api_usage ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web'`;
      await sql`
        CREATE INDEX IF NOT EXISTS api_usage_status_created_at_idx
          ON api_usage (status, created_at)`;
    })().catch((err) => {
      _schemaPromise = null;
      throw err;
    });
  }
  return _schemaPromise;
}

// 오늘(UTC 기준) 성공 호출 수. 못 읽으면 0 이 아니라 null 이다.
// 0 을 돌려주면 호출부가 "0 + 1 = 오늘 1회"라는 틀린 숫자를 만들어 내보낸다.
async function getTodayApiUsageCount() {
  const sql = getSql();
  if (!sql) return null;
  try {
    await ensureSchema(sql);
    const rows = await sql`
      SELECT COUNT(*)::int AS cnt
        FROM api_usage
       WHERE status = 'success'
         AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
    return rows[0]?.cnt ?? 0;
  } catch (err) {
    console.warn('[DB] usage count 조회 실패:', err.message);
    return null;
  }
}

// 한 건 기록. 웹 요청 경로에서 쓴다.
async function logApiUsage(symbol, status, statusCode, source = 'web') {
  return logApiUsageBatch([{ symbol, status, statusCode, source }]);
}

// 한 문장에 넣는 최대 행 수. 크론은 209종목을 도는데 한 건씩 보내면
// HTTP 왕복이 209번이고, 그동안 Neon 컴퓨트가 계속 깨어 있다(무료 한도는 컴퓨트 시간 기준).
// 모아서 한 번에 보내면 왕복 한 번으로 끝난다.
const MAX_ROWS_PER_STATEMENT = 50;

// 여러 건 기록. 파라미터는 전부 스칼라로 넘긴다 — 배열을 파라미터로 넘기면
// 드라이버/서버가 Postgres 배열 리터럴로 바꿔주는지에 기대야 하는데, 그 동작을
// 여기서 검증할 방법이 없어서 기대지 않기로 했다. 자리표시자는 코드가 만들고
// 값은 전부 바인딩되므로 문자열 조립이지만 주입 경로가 없다.
async function logApiUsageBatch(rows) {
  if (!rows || rows.length === 0) return;
  const sql = getSql();
  if (!sql) return;
  try {
    await ensureSchema(sql);
    for (let i = 0; i < rows.length; i += MAX_ROWS_PER_STATEMENT) {
      const chunk = rows.slice(i, i + MAX_ROWS_PER_STATEMENT);
      const placeholders = [];
      const params = [];
      chunk.forEach((r, k) => {
        const b = k * 4;
        placeholders.push(`($${b + 1}, $${b + 2}, $${b + 3}::int, $${b + 4})`);
        params.push(
          String(r.symbol),
          String(r.status),
          r.statusCode == null ? null : Number(r.statusCode),
          String(r.source || 'web')
        );
      });
      await sql.query(
        `INSERT INTO api_usage (symbol, status, status_code, source) VALUES ${placeholders.join(', ')}`,
        params
      );
    }
  } catch (err) {
    console.warn(`[DB] usage 기록 실패 (${rows.length}건 유실):`, err.message);
  }
}

// 크론 스크립트용 버퍼. 호출할 때마다 DB 를 때리면 30분 내내 컴퓨트가 깨어 있으므로
// 모아뒀다가 흘려보낸다. 도중에 스크립트가 죽어도 손실이 FLUSH_AT 건을 넘지 않는다.
const FLUSH_AT = 50;

function createUsageRecorder(source) {
  let buffer = [];
  return {
    record(symbol, status, statusCode) {
      buffer.push({ symbol, status, statusCode, source });
      if (buffer.length >= FLUSH_AT) return this.flush();
      return Promise.resolve();
    },
    async flush() {
      if (buffer.length === 0) return;
      const pending = buffer;
      buffer = [];
      await logApiUsageBatch(pending);
    },
  };
}

module.exports = {
  DAILY_LIMIT,
  getTodayApiUsageCount,
  logApiUsage,
  logApiUsageBatch,
  createUsageRecorder,
};
