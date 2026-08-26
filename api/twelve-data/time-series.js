// POST /api/twelve-data/time-series
// 기존 server/_core/index.ts 의 Express 라우트를 그대로 이식한 Vercel 서버리스 함수입니다.
// 프론트엔드(15개 정적 페이지)는 그대로 이 경로를 호출하므로, 이 파일만 있으면 동작이 100% 동일합니다.

const mysql = require('mysql2/promise');

const DAILY_LIMIT = 800;
const DB_TIMEOUT_MS = 1500;
const DB_COOLDOWN_MS = 5 * 60 * 1000;
const TD_USAGE_CACHE_MS = 2 * 60 * 1000;

let _pool = null;
let _dbDownUntil = 0;
let _tdDaily = null;

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function utcDayStartSql() {
  return utcDay() + ' 00:00:00';
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

// 하루 사용량만 읽습니다. current_usage/plan_limit 는 분당 한도(무료 8회)라 쓰면 안 됩니다.
// 이 엔드포인트도 크레딧 1회를 쓰므로 2분 캐시합니다.
async function getTwelveDailyUsage(apiKey) {
  const day = utcDay();
  if (_tdDaily && _tdDaily.day === day && (Date.now() - _tdDaily.fetchedAt) < TD_USAGE_CACHE_MS) {
    return _tdDaily;
  }
  if (!apiKey) return _tdDaily;

  try {
    const url = new URL('https://api.twelvedata.com/api_usage');
    url.searchParams.set('apikey', apiKey);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(4000) });
    const json = await res.json();
    if (!res.ok || json.status === 'error') return _tdDaily;

    const used = Number(json.daily_usage);
    const limit = Number(json.plan_daily_limit);
    if (!Number.isFinite(used)) return _tdDaily;

    _tdDaily = {
      used,
      limit: Number.isFinite(limit) && limit > 60 ? limit : DAILY_LIMIT,
      fetchedAt: Date.now(),
      day,
    };
    return _tdDaily;
  } catch (err) {
    console.warn('[TD] daily usage 조회 실패:', err.message);
    return _tdDaily;
  }
}

function bumpLocalDailyUsage() {
  if (_tdDaily && _tdDaily.day === utcDay()) {
    _tdDaily.used += 1;
    _tdDaily.fetchedAt = Date.now();
  }
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

    // 시세 조회와 한도 조회를 같이 시작합니다. DB는 조회 경로를 막지 않습니다.
    const tdUsagePromise = getTwelveDailyUsage(apiKey);

    const url = new URL('https://api.twelvedata.com/time_series');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('outputsize', String(outputsize));
    url.searchParams.set('apikey', apiKey);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!response.ok) {
      logApiUsage(symbol, 'error', response.status);
      res.status(response.status).json(data);
      return;
    }

    logApiUsage(symbol, 'success', 200);
    bumpLocalDailyUsage();

    const td = await tdUsagePromise;
    const metadata = td
      ? {
          todayUsage: td.used,
          remainingUsage: Math.max(0, td.limit - td.used),
          dailyLimit: td.limit,
        }
      : null;

    res.status(200).json({
      ...data,
      ...(metadata ? { _metadata: metadata } : {}),
    });
  } catch (error) {
    console.error('Twelve Data API error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
};
