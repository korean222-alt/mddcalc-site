// POST /api/twelve-data/time-series
// 기존 server/_core/index.ts 의 Express 라우트를 그대로 이식한 Vercel 서버리스 함수입니다.
// 프론트엔드(15개 정적 페이지)는 그대로 이 경로를 호출하므로, 이 파일만 있으면 동작이 100% 동일합니다.
//
// 호출 횟수 장부는 lib/api-usage.js 가 맡습니다. 같은 장부를 GitHub Actions 크론
// (scripts/generate-*.js)도 쓰기 때문에, 여기서 읽는 숫자에는 크론이 쓴 몫도 들어 있습니다.
// 트웰브데이터 한도는 키 단위(일 800회)라 그래야 실제 잔량과 맞습니다.

const {
  DAILY_LIMIT,
  getTodayApiUsageCount,
  logApiUsage,
} = require('../../lib/api-usage');

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
        message: `일일 한도(${DAILY_LIMIT}회)를 모두 사용했습니다. ${hoursLeft}시간 ${minutesLeft}분 뒤에 다시 시도해주세요.`,
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
    // 틀린 숫자를 보여주느니 아무것도 안 보여주는 편이 낫습니다.
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
