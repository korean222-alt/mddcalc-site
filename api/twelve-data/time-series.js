// POST /api/twelve-data/time-series
// 기존 server/_core/index.ts 의 Express 라우트를 그대로 이식한 Vercel 서버리스 함수입니다.
// 프론트엔드(15개 정적 페이지)는 그대로 이 경로를 호출하므로, 이 파일만 있으면 동작이 100% 동일합니다.

const mysql = require('mysql2/promise');

const DAILY_LIMIT = 800;

// Twelve Data 는 한 번의 요청에 최대 5000봉만 돌려줍니다(문서상 하드 상한).
// 일봉 기준 5000봉 ≈ 19.8년이라, 이것만으로는 "전체" 기간이 2006년 언저리에서 끊깁니다.
// 그래서 end_date 를 옮겨가며 여러 번 나눠 받고(=페이지네이션) 하나로 합칩니다.
const PAGE_SIZE = 5000;
// 5000봉 × 6페이지 = 30,000봉 ≈ 119년. 어떤 종목이든 상장일까지 충분히 닿습니다.
const MAX_PAGES = 6;

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

async function fetchPage(apiKey, { symbol, interval, outputsize, endDate }) {
  const url = new URL('https://api.twelvedata.com/time_series');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('outputsize', String(outputsize));
  // end_date 는 "이 날짜까지(포함)"라서, 직전 페이지의 가장 오래된 날짜를 그대로 넣으면
  // 그 하루가 겹쳐서 옵니다. 겹치는 날짜는 아래 merge 쪽에서 걸러냅니다.
  if (endDate) url.searchParams.set('end_date', endDate);
  url.searchParams.set('apikey', apiKey);

  const response = await fetch(url.toString());
  const data = await response.json();
  return { response, data };
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

    // outputsize: 'max' 이거나 5000보다 크면 전체 히스토리를 뜻합니다.
    const requested = Number(outputsize);
    const wantAll = outputsize === 'max' || (Number.isFinite(requested) && requested > PAGE_SIZE);
    const pageSize = wantAll || !Number.isFinite(requested) || requested <= 0
      ? PAGE_SIZE
      : Math.floor(requested);

    const values = [];
    const seenDates = new Set();
    let firstPage = null;
    let endDate = null;
    let used = 0;

    for (let page = 0; page < (wantAll ? MAX_PAGES : 1); page++) {
      // 페이지마다 한 건씩 한도를 소모합니다. 도중에 한도가 차면 지금까지 받은 만큼만 돌려줍니다.
      if (page > 0 && todayUsage + used >= DAILY_LIMIT) break;

      const { response, data } = await fetchPage(apiKey, { symbol, interval, outputsize: pageSize, endDate });
      used++;

      if (!response.ok || data.status === 'error') {
        await logApiUsage(symbol, 'error', response.status);
        // 첫 페이지부터 실패하면 그대로 에러를 전달합니다.
        // 이어받기 도중이면 이미 받아둔 구간이라도 쓸 수 있게 그냥 멈춥니다.
        if (page === 0) {
          res.status(response.ok ? 200 : response.status).json(data);
          return;
        }
        break;
      }

      await logApiUsage(symbol, 'success', 200);
      if (!firstPage) firstPage = data;

      const rows = Array.isArray(data.values) ? data.values : [];
      let added = 0;
      for (const row of rows) {
        const date = String(row.datetime || '');
        if (!date || seenDates.has(date)) continue;
        seenDates.add(date);
        values.push(row);
        added++;
      }

      // 요청한 만큼 다 못 채웠다는 건 더 과거 데이터가 없다는 뜻입니다.
      if (rows.length < pageSize) break;
      // 겹치는 날짜뿐이라 새로 붙은 게 없으면(응답이 제자리) 무한루프를 막기 위해 멈춥니다.
      if (added === 0) break;

      // 응답은 최신순이므로 마지막 행이 이 페이지에서 가장 오래된 날짜입니다.
      const oldest = String(rows[rows.length - 1].datetime || '').slice(0, 10);
      if (!oldest || oldest === endDate) break;
      endDate = oldest;
    }

    const remainingUsage = DAILY_LIMIT - (todayUsage + used);
    res.status(200).json({
      ...firstPage,
      values,
      _metadata: {
        todayUsage: todayUsage + used,
        remainingUsage,
        dailyLimit: DAILY_LIMIT,
        requestsUsed: used,
      },
    });
  } catch (error) {
    console.error('Twelve Data API error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
};
