// POST /api/twelve-data/time-series
// 기존 server/_core/index.ts 의 Express 라우트를 그대로 이식한 Vercel 서버리스 함수입니다.
// 프론트엔드(15개 정적 페이지)는 그대로 이 경로를 호출하므로, 이 파일만 있으면 동작이 100% 동일합니다.
//
// DB 는 Neon(Postgres) 이고, 드라이버는 일부러 HTTP 방식(@neondatabase/serverless)을 씁니다.
// 이유: 서버리스 함수는 요청이 끝나면 얼어붙었다가 다음 요청 때 되살아납니다. TCP 커넥션을
// 모듈 스코프에 캐시해두면 그 사이 서버 쪽이 유휴 소켓을 끊어버려서, 되살아난 함수는 이미
// 죽은 소켓으로 쿼리를 날리게 됩니다(예전 mysql2 코드가 정확히 이 상태였습니다).
// HTTP 드라이버는 쿼리 한 번이 fetch 한 번이라 유지할 소켓 자체가 없습니다.

const { neon } = require('@neondatabase/serverless');

const DAILY_LIMIT = 800;

let _sql = null;

// DATABASE_URL 이 없으면 null 을 돌려줍니다. 사이트는 DB 없이도 돌아가야 하고,
// 그때는 사용량 카운트만 조용히 빠집니다(틀린 숫자를 보여주는 것보다 낫습니다).
function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}

// 테이블은 첫 요청 때 스스로 만듭니다. 인스턴스당 한 번만 시도하고,
// 실패하면 캐시를 비워서 다음 요청이 다시 시도하게 둡니다.
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
          created_at  timestamptz NOT NULL DEFAULT now()
        )`;
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

// 오늘(UTC 기준) 성공 호출 수. DB 를 못 읽으면 0 이 아니라 null 입니다.
// 0 을 돌려주면 "오늘 1회"라는 틀린 숫자가 화면에 찍히기 때문입니다.
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

async function logApiUsage(symbol, status, statusCode) {
  const sql = getSql();
  if (!sql) return;
  try {
    await ensureSchema(sql);
    await sql`
      INSERT INTO api_usage (symbol, status, status_code)
      VALUES (${symbol}, ${status}, ${statusCode ?? null})`;
  } catch (err) {
    console.warn('[DB] usage 기록 실패:', err.message);
  }
}

function getMinutesUntilReset() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return Math.ceil((tomorrow.getTime() - now.getTime()) / (1000 * 60));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { symbol, interval = '1day', outputsize = 5000 } = req.body || {};

    if (!symbol) {
      res.status(400).json({ error: 'symbol is required' });
      return;
    }

    const todayUsage = await getTodayApiUsageCount();

    if (todayUsage !== null && todayUsage >= DAILY_LIMIT) {
      const minutesUntilReset = getMinutesUntilReset();
      const hoursLeft = Math.floor(minutesUntilReset / 60);
      const minutesLeft = minutesUntilReset % 60;

      await logApiUsage(symbol, 'rate_limit', 429);

      res.status(429).json({
        error: 'API usage limit exceeded',
        message: `일일 한도(800회)를 모두 사용했습니다. ${hoursLeft}시간 ${minutesLeft}분 뒤에 다시 시도해주세요.`,
        remainingTime: { hours: hoursLeft, minutes: minutesLeft, totalMinutes: minutesUntilReset },
        todayUsage,
        dailyLimit: DAILY_LIMIT,
      });
      return;
    }

    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'API key not configured' });
      return;
    }

    const url = new URL('https://api.twelvedata.com/time_series');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('outputsize', String(outputsize));
    url.searchParams.set('apikey', apiKey);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!response.ok) {
      await logApiUsage(symbol, 'error', response.status);
      res.status(response.status).json(data);
      return;
    }

    await logApiUsage(symbol, 'success', 200);

    // 카운트를 못 읽었으면 _metadata 를 아예 빼서 프론트가 사용량 줄을 건너뛰게 합니다.
    const payload = { ...data };
    if (todayUsage !== null) {
      payload._metadata = {
        todayUsage: todayUsage + 1,
        remainingUsage: DAILY_LIMIT - (todayUsage + 1),
        dailyLimit: DAILY_LIMIT,
      };
    }
    res.status(200).json(payload);
  } catch (error) {
    console.error('Twelve Data API error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
};
