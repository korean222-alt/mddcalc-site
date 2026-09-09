// POST /api/twelve-data/time-series
// 기존 server/_core/index.ts 의 Express 라우트를 그대로 이식한 Vercel 서버리스 함수입니다.
// 프론트엔드(15개 정적 페이지)는 그대로 이 경로를 호출하므로, 이 파일만 있으면 동작이 100% 동일합니다.

const mysql = require('mysql2/promise');

const DAILY_LIMIT = 800;
const DB_TIMEOUT_MS = 1500;
const DB_COOLDOWN_MS = 5 * 60 * 1000;
const TD_USAGE_CACHE_MS = 2 * 60 * 1000;

// 시세 응답 캐시.
//
// 자동 수집(GitHub Actions)과 방문자가 같은 무료 플랜 한도(하루 800회)를 나눠 쓴다.
// 캐시가 없으면 같은 종목을 연달아 조회하는 것만으로 크레딧이 그대로 나간다.
// 일봉은 하루 한 번만 바뀌므로 10분 캐시로도 결과가 달라지지 않는다.
//
// 한계: Vercel 서버리스는 인스턴스마다 메모리가 따로라 이 캐시는 인스턴스 단위다.
// 인스턴스가 여러 개면 그만큼 미스가 난다. 진짜 공유 캐시가 필요하면 Redis 같은
// 외부 저장소를 붙여야 하는데, 지금 트래픽에서는 이것만으로도 호출 수가 크게 준다.
const QUOTE_CACHE_MS = 10 * 60 * 1000;
// 상류가 죽었을 때 "마지막 정상 응답"으로 버티는 한도. 이 기간이 지나면
// 오래된 값을 보여 주느니 실패를 알린다.
const QUOTE_STALE_MAX_MS = 24 * 60 * 60 * 1000;
const QUOTE_CACHE_MAX_ENTRIES = 200;
const TD_FETCH_TIMEOUT_MS = 8000;

let _pool = null;
let _dbDownUntil = 0;
let _tdDaily = null;
const _quoteCache = new Map();   // key -> { data, fetchedAt }

function cacheKey(symbol, interval, outputsize) {
  return `${String(symbol).toUpperCase()}|${interval}|${outputsize}`;
}

function readCache(key, maxAgeMs) {
  const hit = _quoteCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > maxAgeMs) return null;
  return hit;
}

function writeCache(key, data) {
  // Map 은 삽입 순서를 지키므로 가장 오래된 것부터 버리면 된다.
  if (_quoteCache.size >= QUOTE_CACHE_MAX_ENTRIES) {
    const oldest = _quoteCache.keys().next().value;
    if (oldest !== undefined) _quoteCache.delete(oldest);
  }
  _quoteCache.set(key, { data, fetchedAt: Date.now() });
}

// 캐시에서 내보낼 때 "언제 받은 값인지"를 응답에 실어 준다.
// 프론트엔드가 화면에 기준 시각을 표시할 수 있어야 오래된 값이 조용히 섞이지 않는다.
function withCacheMeta(data, hit, stale) {
  return {
    ...data,
    _cache: {
      cached: true,
      stale: !!stale,
      fetchedAt: new Date(hit.fetchedAt).toISOString(),
      ageSeconds: Math.round((Date.now() - hit.fetchedAt) / 1000),
    },
  };
}

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

    // 최근에 받아 둔 응답이 있으면 그대로 돌려줍니다. 일봉은 하루 한 번만 바뀌므로
    // 10분 안에 다시 물어봐도 답이 같습니다. 크레딧을 아끼는 가장 확실한 지점입니다.
    const key = cacheKey(symbol, interval, outputsize);
    const fresh = readCache(key, QUOTE_CACHE_MS);
    if (fresh) {
      res.status(200).json(withCacheMeta(fresh.data, fresh, false));
      return;
    }

    // 시세 조회와 한도 조회를 같이 시작합니다. DB는 조회 경로를 막지 않습니다.
    const tdUsagePromise = getTwelveDailyUsage(apiKey);

    const url = new URL('https://api.twelvedata.com/time_series');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('outputsize', String(outputsize));
    url.searchParams.set('apikey', apiKey);

    // 타임아웃이 없으면 상류가 늘어질 때 함수가 그대로 매달려 있다가 플랫폼 한도에서
    // 끊긴다. 그 사이 사용자는 아무 안내도 못 받는다. 8초에서 끊고 아래 폴백으로 넘긴다.
    let response, data;
    try {
      response = await fetch(url.toString(), { signal: AbortSignal.timeout(TD_FETCH_TIMEOUT_MS) });
      data = await response.json();
    } catch (err) {
      // 상류 실패. 마지막으로 정상 조회한 값이 하루 안쪽이면 그것을 보여 준다.
      // 화면이 비어 있는 것보다, 기준 시각을 밝힌 지난 값이 낫다.
      const stale = readCache(key, QUOTE_STALE_MAX_MS);
      logApiUsage(symbol, 'error', null);
      if (stale) {
        console.warn(`[TD] ${symbol} 조회 실패(${err.message}) — 캐시된 값으로 응답`);
        res.status(200).json(withCacheMeta(stale.data, stale, true));
        return;
      }
      res.status(504).json({ error: `시세 조회에 실패했습니다: ${err.message}` });
      return;
    }

    if (!response.ok) {
      logApiUsage(symbol, 'error', response.status);
      // 한도 초과(429)나 상류 오류도 같은 이유로 지난 값을 먼저 시도한다.
      const stale = readCache(key, QUOTE_STALE_MAX_MS);
      if (stale) {
        console.warn(`[TD] ${symbol} HTTP ${response.status} — 캐시된 값으로 응답`);
        res.status(200).json(withCacheMeta(stale.data, stale, true));
        return;
      }
      res.status(response.status).json(data);
      return;
    }

    logApiUsage(symbol, 'success', 200);
    bumpLocalDailyUsage();
    writeCache(key, data);

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
