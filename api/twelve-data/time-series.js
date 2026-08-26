// POST /api/twelve-data/time-series
// 기존 server/_core/index.ts 의 Express 라우트를 그대로 이식한 Vercel 서버리스 함수입니다.
// 프론트엔드(15개 정적 페이지)는 그대로 이 경로를 호출하므로, 이 파일만 있으면 동작이 100% 동일합니다.

const mysql = require('mysql2/promise');

const DAILY_LIMIT = 800;
const CONNECT_TIMEOUT_MS = 8000;

let _pool = null;

function utcDayStartSql() {
  return new Date().toISOString().slice(0, 10) + ' 00:00:00';
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function resetPool() {
  const old = _pool;
  _pool = null;
  if (old) {
    old.end().catch(() => {});
  }
}

function getPool() {
  if (_pool) return _pool;

  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL is not set');
  }

  const url = new URL(raw);
  _pool = mysql.createPool({
    host: url.hostname,
    port: url.port ? Number(url.port) : 4000,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, '').split('?')[0],
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 1,
    connectTimeout: CONNECT_TIMEOUT_MS,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
  return _pool;
}

function isConnError(err) {
  const code = err && err.code;
  return code === 'ETIMEDOUT'
    || code === 'ECONNRESET'
    || code === 'ECONNREFUSED'
    || code === 'PROTOCOL_CONNECTION_LOST'
    || code === 'POOL_CLOSED';
}

async function withDb(fn) {
  try {
    return await fn(getPool());
  } catch (err) {
    if (isConnError(err)) resetPool();
    throw err;
  }
}

async function getTodayApiUsageCountFromDb() {
  const [rows] = await withDb((pool) => pool.execute(
    'SELECT COUNT(*) AS cnt FROM api_usage WHERE status = ? AND createdAt >= ?',
    ['success', utcDayStartSql()]
  ));
  return toCount(rows[0] && rows[0].cnt);
}

async function logApiUsage(symbol, status, statusCode) {
  try {
    await withDb((pool) => pool.execute(
      'INSERT INTO api_usage (symbol, status, statusCode, createdAt) VALUES (?, ?, ?, UTC_TIMESTAMP())',
      [symbol, status, statusCode ?? null]
    ));
  } catch (err) {
    if (isConnError(err)) resetPool();
    console.warn('[DB] usage 기록 실패:', err.message);
  }
}

// 문서상 이 엔드포인트는 크레딧을 쓰지 않습니다.
async function fetchTwelveDataUsage(apiKey) {
  if (!apiKey) return null;
  try {
    const url = new URL('https://api.twelvedata.com/api_usage');
    url.searchParams.set('apikey', apiKey);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    if (!res.ok || json.status === 'error') return null;
    const used = Number(json.daily_usage ?? json.current_usage);
    const limit = Number(json.plan_daily_limit ?? json.plan_limit);
    if (!Number.isFinite(used)) return null;
    return { used, limit: Number.isFinite(limit) ? limit : DAILY_LIMIT };
  } catch (err) {
    console.warn('[TD] api_usage 조회 실패:', err.message);
    return null;
  }
}

async function readUsage(apiKey) {
  try {
    const used = await getTodayApiUsageCountFromDb();
    return { used, limit: DAILY_LIMIT, source: 'db', measured: true };
  } catch (err) {
    console.warn('[DB] usage count 조회 실패:', err.message);
  }

  const td = await fetchTwelveDataUsage(apiKey);
  if (td) {
    return { used: td.used, limit: td.limit || DAILY_LIMIT, source: 'twelvedata', measured: true };
  }

  return { used: 0, limit: DAILY_LIMIT, source: 'none', measured: false };
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

    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'API key not configured' });
      return;
    }

    const usage = await readUsage(apiKey);
    const dailyLimit = usage.limit || DAILY_LIMIT;

    if (usage.measured && usage.used >= dailyLimit) {
      const minutesUntilReset = getMinutesUntilReset();
      const hoursLeft = Math.floor(minutesUntilReset / 60);
      const minutesLeft = minutesUntilReset % 60;

      await logApiUsage(symbol, 'rate_limit', 429);

      res.status(429).json({
        error: 'API usage limit exceeded',
        message: `일일 한도(${dailyLimit}회)를 모두 사용했습니다. ${hoursLeft}시간 ${minutesLeft}분 뒤에 다시 시도해주세요.`,
        remainingTime: { hours: hoursLeft, minutes: minutesLeft, totalMinutes: minutesUntilReset },
        todayUsage: usage.used,
        dailyLimit,
      });
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

    const todayUsage = usage.measured ? usage.used + 1 : 1;
    const remainingUsage = Math.max(0, dailyLimit - todayUsage);
    res.status(200).json({
      ...data,
      _metadata: { todayUsage, remainingUsage, dailyLimit },
    });
  } catch (error) {
    console.error('Twelve Data API error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
};
