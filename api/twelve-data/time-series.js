// POST /api/twelve-data/time-series
// 기존 server/_core/index.ts 의 Express 라우트를 그대로 이식한 Vercel 서버리스 함수입니다.
// 프론트엔드(15개 정적 페이지)는 그대로 이 경로를 호출하므로, 이 파일만 있으면 동작이 100% 동일합니다.

const { DAILY_LIMIT, getPool, countTodayUsage, recordUsage } = require('./_usage-db');

// 하루 사용량은 api_usage 테이블이 원본입니다. 다만 DB 가 잠깐 끊겨도 조회 자체는
// 막지 않기로 했으므로, 그동안 이 인스턴스가 내보낸 요청 수만이라도 세어 둡니다.
// (인스턴스가 여럿이면 실제보다 적게 잡힙니다. 그래서 화면에도 "확인 불가"라고 알립니다.)
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

async function readUsage() {
  try {
    return { ok: true, usage: await countTodayUsage(getPool()) };
  } catch (err) {
    console.warn('[DB] usage 조회 실패:', err.message);
    return { ok: false, usage: null, error: err.message };
  }
}

async function logApiUsage(symbol, status, statusCode) {
  try {
    await recordUsage(getPool(), [{ symbol, status, statusCode }]);
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
    const read = await readUsage();
    // DB 가 안 될 때는 이 인스턴스가 센 값으로 대신합니다. 실제보다 적게 잡히므로
    // 한도를 넘겨 버릴 위험이 있지만, DB 하나 때문에 조회를 통째로 막는 것보다 낫습니다.
    const usedNow = read.ok ? read.usage.total : readMemoryCounter(today);
    const limitNow = read.ok ? read.usage.effectiveLimit : DAILY_LIMIT;

    if (usedNow >= limitNow) {
      const minutesUntilReset = getMinutesUntilReset();
      const hoursLeft = Math.floor(minutesUntilReset / 60);
      const minutesLeft = minutesUntilReset % 60;

      // 나가지 않은 요청이므로 크레딧은 안 씁니다. 세지 않는 status 로만 남깁니다.
      await logApiUsage(symbol, 'rate_limit', 429);

      res.status(429).json({
        error: 'API usage limit exceeded',
        message: `오늘 쓸 수 있는 조회 횟수를 모두 사용했습니다. ${hoursLeft}시간 ${minutesLeft}분 뒤에 다시 시도해주세요.`,
        remainingTime: { hours: hoursLeft, minutes: minutesLeft, totalMinutes: minutesUntilReset },
        todayUsage: usedNow,
        dailyLimit: limitNow,
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
    let metadata = null;
    if (logged) {
      const after = await readUsage();
      if (after.ok) {
        metadata = {
          todayUsage: after.usage.total,
          remainingUsage: Math.max(0, after.usage.effectiveLimit - after.usage.total),
          dailyLimit: after.usage.effectiveLimit,
          // 사용자 조회 몫과 배치(섹터·히트맵 데이터 수집) 몫을 나눠 보여 줍니다.
          webUsage: after.usage.web,
          batchUsage: after.usage.batch,
          reservedForBatch: after.usage.reserved,
          planDailyLimit: DAILY_LIMIT,
          usageSource: 'db',
        };
      }
    }
    if (!metadata) {
      const counted = readMemoryCounter(today);
      metadata = {
        todayUsage: counted,
        remainingUsage: Math.max(0, DAILY_LIMIT - counted),
        dailyLimit: DAILY_LIMIT,
        planDailyLimit: DAILY_LIMIT,
        // 'memory' = 이 서버 인스턴스가 센 값(실제보다 적을 수 있음). 화면은 숫자 대신
        // "확인 불가"라고 씁니다.
        usageSource: 'memory',
      };
    }

    res.status(200).json({ ...data, _metadata: metadata });
  } catch (error) {
    console.error('Twelve Data API error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
};
