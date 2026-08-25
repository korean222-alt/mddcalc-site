// POST /api/twelve-data/time-series
// 기존 server/_core/index.ts 의 Express 라우트를 그대로 이식한 Vercel 서버리스 함수입니다.
// 프론트엔드(15개 정적 페이지)는 그대로 이 경로를 호출하므로, 이 파일만 있으면 동작이 100% 동일합니다.

const { getPool, ensureUsageTable, utcDayStart } = require('./_usage-db');

const DAILY_LIMIT = 800;

// 하루 사용량은 api_usage 테이블이 원본입니다. 다만 DB 가 잠깐 끊겨도 조회 자체는
// 막지 않기로 했으므로, 그동안 이 인스턴스가 내보낸 요청 수만이라도 세어 둡니다.
// (인스턴스가 여럿이면 실제보다 적게 잡힙니다. 그래서 화면에도 "대략"이라고 알립니다.)
const memoryCounter = { day: null, count: 0 };

function bumpMemoryCounter(day) {
  if (memoryCounter.day !== day) {
    memoryCounter.day = day;
    memoryCounter.count = 0;
  }
  memoryCounter.count += 1;
  return memoryCounter.count;
}

function readMemoryCounter(day) {
  return memoryCounter.day === day ? memoryCounter.count : 0;
}

// 오늘(UTC 기준) 트웰브데이터로 실제 나간 요청 수.
//
// status 가 'success' 인 것만 세던 예전 코드는 실패 응답을 빠뜨렸는데, 트웰브데이터는
// 에러로 끝난 요청도 크레딧을 깎습니다. 실제로 나간 요청('success' + 'error')을 모두 세야
// 한도 계산이 맞습니다. 'rate_limit' 은 우리가 막아서 나가지 않은 요청이라 제외합니다.
async function getTodayApiUsageCount() {
  try {
    const pool = getPool();
    await ensureUsageTable(pool);
    const [rows] = await pool.execute(
      "SELECT COUNT(*) AS cnt FROM api_usage WHERE status IN ('success','error') AND createdAt >= ?",
      [utcDayStart()]
    );
    return { ok: true, count: Number(rows[0] && rows[0].cnt) || 0 };
  } catch (err) {
    console.warn('[DB] usage count 조회 실패:', err.message);
    return { ok: false, count: null, error: err.message };
  }
}

async function logApiUsage(symbol, status, statusCode) {
  try {
    const pool = getPool();
    await ensureUsageTable(pool);
    // NOW() 는 DB 세션 타임존을 따라가서 UTC 자정 경계와 어긋날 수 있습니다.
    // 한도가 UTC 자정에 초기화되므로 기록도 UTC 로 못박습니다.
    await pool.execute(
      'INSERT INTO api_usage (symbol, status, statusCode, createdAt) VALUES (?, ?, ?, UTC_TIMESTAMP())',
      [String(symbol).slice(0, 32), status, statusCode == null ? null : statusCode]
    );
    return true;
  } catch (err) {
    console.warn('[DB] usage 기록 실패:', err.message);
    return false;
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

    const today = new Date().toISOString().slice(0, 10);
    const usage = await getTodayApiUsageCount();
    // DB 가 안 될 때는 이 인스턴스가 센 값으로 대신합니다. 실제보다 적게 잡히므로
    // 한도를 넘겨 버릴 위험이 있지만, DB 하나 때문에 조회를 통째로 막는 것보다 낫습니다.
    const countedUsage = usage.ok ? usage.count : readMemoryCounter(today);

    if (countedUsage >= DAILY_LIMIT) {
      const minutesUntilReset = getMinutesUntilReset();
      const hoursLeft = Math.floor(minutesUntilReset / 60);
      const minutesLeft = minutesUntilReset % 60;

      await logApiUsage(symbol, 'rate_limit', 429);

      res.status(429).json({
        error: 'API usage limit exceeded',
        message: `일일 한도(800회)를 모두 사용했습니다. ${hoursLeft}시간 ${minutesLeft}분 뒤에 다시 시도해주세요.`,
        remainingTime: { hours: hoursLeft, minutes: minutesLeft, totalMinutes: minutesUntilReset },
        todayUsage: countedUsage,
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

    // 여기까지 왔다는 것은 요청이 실제로 나갔다는 뜻입니다. 성공이든 실패든 크레딧은
    // 이미 깎였으므로 둘 다 기록하고, 메모리 카운터도 똑같이 올립니다.
    bumpMemoryCounter(today);

    if (!response.ok) {
      await logApiUsage(symbol, 'error', response.status);
      res.status(response.status).json(data);
      return;
    }

    const logged = await logApiUsage(symbol, 'success', 200);

    // 방금 넣은 한 건까지 포함한 수를 DB 에서 다시 읽습니다. 예전에는 요청 전에 읽은 값에
    // +1 을 했는데, 그러면 DB 가 안 될 때 항상 "1회"로 보였습니다. 지금은 기록이 실제로
    // 들어갔을 때만 DB 값을 쓰고, 아니면 확인 불가라고 정직하게 알립니다.
    let todayUsage = null;
    let usageSource = 'unavailable';
    if (logged) {
      const after = await getTodayApiUsageCount();
      if (after.ok) {
        todayUsage = after.count;
        usageSource = 'db';
      }
    }
    if (todayUsage == null) {
      todayUsage = readMemoryCounter(today);
      usageSource = 'memory';
    }

    res.status(200).json({
      ...data,
      _metadata: {
        todayUsage,
        remainingUsage: Math.max(0, DAILY_LIMIT - todayUsage),
        dailyLimit: DAILY_LIMIT,
        // 'db' = 정확한 값 / 'memory' = 이 서버 인스턴스가 센 값(실제보다 적을 수 있음)
        usageSource,
      },
    });
  } catch (error) {
    console.error('Twelve Data API error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
};
