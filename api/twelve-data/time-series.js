// POST /api/twelve-data/time-series
// 기존 server/_core/index.ts 의 Express 라우트를 그대로 이식한 Vercel 서버리스 함수입니다.
// 프론트엔드(15개 정적 페이지)는 그대로 이 경로를 호출하므로, 이 파일만 있으면 동작이 100% 동일합니다.

const mysql = require('mysql2/promise');

const DAILY_LIMIT = 800;
const DB_TIMEOUT_MS = 1500;
const DB_COOLDOWN_MS = 5 * 60 * 1000;

let _pool = null;
let _dbDownUntil = 0;

function utcDayStartSql() {
  return new Date().toISOString().slice(0, 10) + ' 00:00:00';
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dbIsCoolingDown() {
  return Date.now() < _dbDownUntil;
}

function markDbDown() {
  _dbDownUntil = Date.now() + DB_COOLDOWN_MS;
  const old = _pool;
  _pool = null;
  if (old) old.end().catch(() => {});
}

function getPool() {
  if (_pool) return _pool;
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');

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
    connectTimeout: DB_TIMEOUT_MS,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
  return _pool;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function getTodayApiUsageCount() {
  if (dbIsCoolingDown()) return null;
  try {
    const [rows] = await withTimeout(
      getPool().execute(
        'SELECT COUNT(*) AS cnt FROM api_usage WHERE status = ? AND createdAt >= ?',
        ['success', utcDayStartSql()]
      ),
      DB_TIMEOUT_MS,
      'DB count'
    );
    return toCount(rows[0] && rows[0].cnt);
  } catch (err) {
    markDbDown();
    console.warn('[DB] usage count 조회 실패:', err.message);
    return null;
  }
}

async function logApiUsage(symbol, status, statusCode) {
  if (dbIsCoolingDown()) return;
  try {
    await withTimeout(
      getPool().execute(
        'INSERT INTO api_usage (symbol, status, statusCode, createdAt) VALUES (?, ?, ?, UTC_TIMESTAMP())',
        [symbol, status, statusCode ?? null]
      ),
      DB_TIMEOUT_MS,
      'DB insert'
    );
  } catch (err) {
    markDbDown();
    console.warn('[DB] usage 기록 실패:', err.message);
  }
}

function usageFromHeaders(response) {
  const used = Number(response.headers.get('api-credits-used'));
  const left = Number(response.headers.get('api-credits-left'));
  if (!Number.isFinite(used) || !Number.isFinite(left)) return null;
  const limit = used + left;
  // Basic 계획의 분당 창(8) 을 일일 한도로 오인하지 않습니다.
  if (limit > 60) {
    return { todayUsage: used, remainingUsage: left, dailyLimit: limit };
  }
  return null;
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

    const headerUsage = usageFromHeaders(response);
    const metadata = todayUsage !== null
      ? { todayUsage: todayUsage + 1, remainingUsage: DAILY_LIMIT - (todayUsage + 1), dailyLimit: DAILY_LIMIT }
      : headerUsage;

    res.status(200).json({
      ...data,
      ...(metadata ? { _metadata: metadata } : {}),
    });
  } catch (error) {
    console.error('Twelve Data API error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
};
