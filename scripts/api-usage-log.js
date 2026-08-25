// 배치가 쓴 트웰브데이터 크레딧을 사이트와 같은 장부(api_usage 테이블)에 적는다.
//
// 왜 필요한가
// -----------
// 트웰브데이터 무료 플랜의 하루 800 크레딧은 두 곳이 나눠 쓴다.
//   1. 사용자가 MDD 계산기에서 미국 종목을 조회할 때 (api/twelve-data/time-series.js)
//   2. GitHub Actions 배치가 시세를 미리 받아 정적 파일로 만들 때
//        generate-us-data.js     — 209 심볼 (섹터 RS·히트맵 데이터의 원본)
//        generate-stock-pages.js —  21 심볼 (/stock/*.html)
// 그런데 2번은 api.twelvedata.com 을 직접 부르기 때문에 장부에 한 줄도 남지 않았다.
// 그래서 사이트는 "오늘 5회 썼다"고 하는데 실제로는 214회를 쓴 상태가 된다.
// 여기서 2번도 같은 테이블에 적어, 사이트가 보는 숫자가 실제와 맞게 한다.
//
// 절대 배치를 멈추지 않는다
// -------------------------
// 장부에 못 적는다고 시세 갱신을 포기할 이유는 없다. DB 가 없거나 실패하면 경고만 남기고
// 그냥 넘어간다 (DATABASE_URL 이 없는 로컬 실행이 대표적인 경우다).

const path = require('path');

// api/ 아래 파일을 그대로 쓴다. 사이트와 배치가 같은 산식·같은 status 값을 쓰게 하려면
// 장부 코드가 한 벌이어야 한다. (Vercel 은 api/ 안의 _ 로 시작하는 파일을 함수로 만들지 않는다)
const DB_MODULE = path.join(__dirname, '..', 'api', 'twelve-data', '_usage-db.js');

const FLUSH_EVERY = 25; // 30분짜리 배치가 도중에 죽어도 여기까지는 남는다

let buffer = [];
let recorded = 0;
let disabled = false;
let warned = false;
let loaded = null;   // 한 번이라도 불러온 장부 모듈 (끝에 커넥션을 닫으려고 붙잡아 둔다)

function warnOnce(message) {
  if (warned) return;
  warned = true;
  // 드라이버 에러는 require 스택까지 여러 줄로 붙어 온다. 첫 줄이면 원인은 충분히 드러난다.
  console.warn(`⚠️  API 사용량을 장부에 적지 못했습니다: ${String(message).split('\n')[0]}`);
  console.warn('   (시세 갱신은 그대로 진행합니다. 사이트가 보여 주는 오늘 사용량만 실제보다 적게 나옵니다)');
}

function loadDb() {
  if (disabled) return null;
  if (!process.env.DATABASE_URL) {
    disabled = true;
    // 로컬에서 돌릴 때는 DB 가 없는 게 정상이라 조용히 넘어간다.
    // CI 에서는 시크릿을 빠뜨린 것이므로 알린다.
    if (process.env.CI) warnOnce('DATABASE_URL 이 없습니다 (Actions 시크릿을 확인하세요)');
    return null;
  }
  try {
    loaded = require(DB_MODULE);
    return loaded;
  } catch (err) {
    // mysql2 가 설치돼 있지 않은 환경(의존성 설치를 건너뛴 워크플로우 등)
    disabled = true;
    warnOnce(err.message);
    return null;
  }
}

// 크레딧을 하나 썼다고 적어 둔다. 실제로 트웰브데이터까지 나간 요청만 부른다
// (성공이든 실패든 크레딧은 깎이므로 둘 다 센다).
function count(symbol, statusCode) {
  if (disabled) return;
  const db = loadDb();
  if (!db) return;
  buffer.push({ symbol, status: db.BATCH_STATUS, statusCode: statusCode == null ? null : statusCode });
  if (buffer.length >= FLUSH_EVERY) {
    // 호출부를 기다리게 하지 않는다. 실패는 flush 안에서 삼킨다.
    flush();
  }
}

async function flush() {
  if (disabled || buffer.length === 0) return 0;
  const db = loadDb();
  if (!db) { buffer = []; return 0; }

  const rows = buffer;
  buffer = [];
  try {
    await db.recordUsage(db.getPool(), rows);
    recorded += rows.length;
    return rows.length;
  } catch (err) {
    disabled = true; // 한 번 실패하면 남은 요청마다 다시 시도해 로그를 더럽히지 않는다
    warnOnce(err.message);
    return 0;
  }
}

// 배치가 끝날 때 부른다. 남은 것을 적고, 오늘 장부가 어떻게 됐는지 한 줄로 알려 준다.
//
// 커넥션은 반드시 닫는다. 열린 채로 두면 Node 가 살아 있는 소켓 때문에 종료하지 못하고,
// 워크플로우가 타임아웃까지 러너를 붙잡는다. 그래서 기록이 실패했더라도 닫기는 시도한다.
async function finish() {
  await flush();
  const db = loaded; // disabled 여부와 무관하게, 한 번이라도 풀을 만들었으면 닫아야 한다
  if (!db) return;
  try {
    if (!disabled) {
      const u = await db.countTodayUsage(db.getPool());
      console.log(
        `📒 오늘 트웰브데이터 크레딧: ${u.total}/${db.DAILY_LIMIT} ` +
        `(사용자 조회 ${u.web} · 배치 ${u.batch} — 이번 실행에서 ${recorded} 기록)`
      );
      if (u.total > db.DAILY_LIMIT * 0.9) {
        console.warn(`⚠️  하루 한도의 90% 를 넘겼습니다. 남은 크레딧 ${db.DAILY_LIMIT - u.total} 회.`);
      }
    }
  } catch (err) {
    warnOnce(err.message);
  } finally {
    try { await db.getPool().end(); } catch (e) { /* 만든 적이 없거나 이미 닫혔으면 그만 */ }
  }
}

module.exports = { count, flush, finish };
