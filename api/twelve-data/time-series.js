// POST /api/twelve-data/time-series
// 기존 server/_core/index.ts 의 Express 라우트를 그대로 이식한 Vercel 서버리스 함수입니다.
// 프론트엔드(15개 정적 페이지)는 그대로 이 경로를 호출하므로, 이 파일만 있으면 동작이 100% 동일합니다.
//
// 이 함수는 우리 Twelve Data 유료 키를 대신 써주는 프록시입니다. 즉 이 주소를 아는 사람은
// 누구나 우리 일일 한도(800회)를 대신 소진시킬 수 있습니다. 한도가 바닥나면 우리 사이트
// 방문자가 조회를 못 합니다. 그래서 아래 세 겹으로 막습니다.
//   1. 입력 검증  — 프론트엔드가 실제로 보낼 수 있는 형태만 통과시킨다
//   2. Origin 검사 — 브라우저에서 남의 사이트가 우리 API를 부르는 것을 막는다
//   3. IP별 속도제한 — 스크립트로 퍼붓는 것을 막는다 (완벽하진 않지만 문턱을 크게 올린다)

const mysql = require('mysql2/promise');

const DAILY_LIMIT = 800;

// 한 IP가 이 시간창 안에서 보낼 수 있는 최대 요청 수.
// 사람이 쓰는 속도(종목 하나 조회 = 1~2회)보다 넉넉하고, 스크립트로 한도를 태우기엔 너무 좁게 잡았습니다.
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_PER_WINDOW = 20;

// 프론트엔드가 실제로 쓰는 값만 허용합니다. 그 밖의 값은 업스트림까지 보내지 않습니다.
const ALLOWED_INTERVALS = new Set([
  '1min', '5min', '15min', '30min', '45min',
  '1h', '2h', '4h', '1day', '1week', '1month',
]);
const MAX_OUTPUTSIZE = 5000;

// 티커 형식 — 프론트엔드 isValidTickerFormat() 과 같은 규칙입니다.
// 미국 티커(TSLA), 한국 종목코드(005930 / 005930.KS), 지수(^KS11), 한글 종목명("삼성전자")까지.
const TICKER_RE = /^[A-Za-z0-9.\-^&가-힣 ]{1,20}$/;

// 우리 사이트에서 온 요청만 받습니다.
//
// 도메인을 하드코딩하지 않고 "요청이 들어온 그 호스트"와 Origin 이 같은지만 봅니다.
// 그래야 mddcalc.com, www, Vercel 프리뷰 주소, 나중에 도메인을 바꿔도 전부 그대로 동작하고,
// 남의 사이트(브라우저)에서 우리 API 를 부르는 것만 걸러집니다.
//
// Origin 헤더가 아예 없는 요청(curl, 서버-서버)은 브라우저가 붙이는 값이 아니라
// 여기서 판단할 근거가 없으므로 통과시키고 속도제한에 맡깁니다.
function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const selfHost = String(req.headers.host || '').split(':')[0];
  if (!selfHost) return true; // 비교 기준이 없으면 막지 않는다 (사이트가 멈추는 쪽이 더 나쁘다)
  try {
    const originHost = new URL(origin).hostname;
    // www 를 붙이거나 뗀 형태도 같은 사이트로 본다
    const bare = h => h.replace(/^www\./, '');
    return bare(originHost) === bare(selfHost);
  } catch {
    return false;
  }
}

// 웜(warm) 인스턴스 안에서만 유지되는 속도제한 기록입니다.
// 서버리스라 인스턴스가 여러 개면 각자 세지만, 그래도 한 인스턴스로 퍼붓는 공격은 확실히 막힙니다.
// (완전한 방어는 공유 저장소가 필요합니다 — 지금 구조에서 추가 비용 없이 할 수 있는 최선입니다.)
const _rateBuckets = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const hits = (_rateBuckets.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  hits.push(now);
  _rateBuckets.set(ip, hits);

  // Map 이 무한정 커지지 않도록 오래된 항목을 정리합니다.
  if (_rateBuckets.size > 5000) {
    for (const [k, v] of _rateBuckets) {
      if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) _rateBuckets.delete(k);
    }
  }
  return hits.length > RATE_MAX_PER_WINDOW;
}

let _connPromise = null;

// 서버리스 함수가 "웜(warm)" 상태로 재사용될 때 커넥션을 재활용하기 위한 캐시.
// 연결에 실패한 프로미스를 그대로 캐시하면 그 인스턴스는 영원히 DB를 못 씁니다.
// 그래서 실패한 프로미스는 캐시에서 지워 다음 요청이 다시 시도하게 합니다.
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
    _connPromise.catch(() => { _connPromise = null; });
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
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!isAllowedOrigin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  if (isRateLimited(getClientIp(req))) {
    res.setHeader('Retry-After', '60');
    // scope:'ip' 는 "이 사람이 너무 빨리 눌렀다"는 뜻으로, 아래의 일일 한도 소진(429)과 다르다.
    // 프론트엔드가 이 값을 보고 "1분 뒤 다시" 와 "내일 다시" 를 구분해 안내한다.
    res.status(429).json({
      error: 'Too many requests',
      scope: 'ip',
      message: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.',
    });
    return;
  }

  try {
    const body = req.body || {};
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';
    const interval = typeof body.interval === 'string' ? body.interval : '1day';
    const outputsizeRaw = Number(body.outputsize);

    if (!symbol) {
      res.status(400).json({ error: 'symbol is required' });
      return;
    }
    if (!TICKER_RE.test(symbol)) {
      res.status(400).json({ error: 'invalid symbol' });
      return;
    }
    if (!ALLOWED_INTERVALS.has(interval)) {
      res.status(400).json({ error: 'invalid interval' });
      return;
    }
    // 값이 없거나 이상하면 기존 기본값(5000)을 그대로 씁니다 — 프론트엔드 동작이 바뀌지 않도록.
    const outputsize = Number.isFinite(outputsizeRaw)
      ? Math.min(Math.max(Math.floor(outputsizeRaw), 1), MAX_OUTPUTSIZE)
      : MAX_OUTPUTSIZE;

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
    // 원본 메시지에는 DB 호스트명 같은 내부 정보가 섞여 나올 수 있어 로그에만 남깁니다.
    console.error('Twelve Data API error:', error);
    res.status(500).json({ error: '데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' });
  }
};
