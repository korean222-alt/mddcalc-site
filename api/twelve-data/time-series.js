// POST /api/twelve-data/time-series
// 기존 server/_core/index.ts 의 Express 라우트를 그대로 이식한 Vercel 서버리스 함수입니다.
// 프론트엔드(15개 정적 페이지)는 그대로 이 경로를 호출하므로, 이 파일만 있으면 동작이 100% 동일합니다.

const mysql = require('mysql2/promise');

const DAILY_LIMIT = 800;

let _connPromise = null;

// 서버리스 함수가 "웜(warm)" 상태로 재사용될 때 커넥션을 재활용하기 위한 캐시.
function getConnection() {
  if (!_connPromise) {
    const url = new URL(process.env.DATABASE_URL);
    _connPromise = mysql.createConnection({
      host: url.hostname,
      port: url.port ? Number(url.port) : 4000,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, '').split('?')[0],
      ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    });
  }
  return _connPromise;
}

async function getTodayApiUsageCount() {
  try {
    const conn = await getConnection();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [rows] = await conn.execute(
      'SELECT COUNT(*) AS cnt FROM api_usage WHERE status = ? AND createdAt >= ?',
      ['success', today]
    );
    return rows[0]?.cnt ?? 0;
  } catch (err) {
    console.warn('[DB] usage count 조회 실패:', err.message);
    return 0;
  }
}

async function logApiUsage(symbol, status, statusCode) {
  try {
    const conn = await getConnection();
    await conn.execute(
      'INSERT INTO api_usage (symbol, status, statusCode, createdAt) VALUES (?, ?, ?, NOW())',
      [symbol, status, statusCode ?? null]
    );
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

    if (todayUsage >= DAILY_LIMIT) {
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

    const remainingUsage = DAILY_LIMIT - (todayUsage + 1);
    res.status(200).json({
      ...data,
      _metadata: { todayUsage: todayUsage + 1, remainingUsage, dailyLimit: DAILY_LIMIT },
    });
  } catch (error) {
    console.error('Twelve Data API error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
};
