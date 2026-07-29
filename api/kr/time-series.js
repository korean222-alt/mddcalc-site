// POST /api/kr/time-series   { symbol, outputsize }
//
// 한국거래소(KRX) 종목의 일봉 시세를 돌려줍니다.
//
// 왜 별도 함수인가:
//   기존 /api/twelve-data/time-series 가 쓰는 Twelve Data 무료(Basic) 플랜은
//   미국 거래소 + 환율 + 암호화폐만 포함하고 KRX는 유료 플랜(월 $29~)부터입니다.
//   그래서 한국 종목만 여기로 보내고, 나머지는 기존 경로를 그대로 씁니다.
//
// 응답 형태는 Twelve Data 와 **일부러 똑같이** 맞춰 두었습니다.
//   { values: [{ datetime, open, high, low, close }, ...] }  (최신 날짜가 배열 앞)
//   프론트엔드가 응답을 구분하지 않아도 되도록 하기 위함입니다.
//
// 데이터 출처: Yahoo Finance chart 엔드포인트(키 불필요, 무료).
//   공식 지원 API가 아니라 언제든 형식이 바뀌거나 429로 막힐 수 있는 비공식 경로입니다.
//   그래서 (1) 실패해도 사이트 전체가 죽지 않도록 이 함수 안에서만 처리하고,
//         (2) 아래 fetchDaily() 하나만 갈아끼우면 다른 소스로 바꿀 수 있게 분리해 두었습니다.
//   정식 경로로 옮길 때 후보: 한국투자증권 KIS Developers 오픈API(무료, 계좌·앱키 필요).

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

// Yahoo 는 기본 User-Agent 를 그대로 보내면 종종 거절합니다.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// 서버리스 함수가 "웜" 상태로 재사용되는 동안만 유지되는 캐시.
// POST 응답은 Vercel CDN 이 캐시하지 않으므로, 같은 종목 반복 조회를 여기서 흡수합니다.
const CACHE_TTL_MS = 30 * 60 * 1000;
const _cache = new Map();

// 6자리 숫자만 들어오면 어느 시장인지 알 수 없으므로 코스피(.KS) → 코스닥(.KQ) 순으로 시도합니다.
function candidateSymbols(input) {
  const s = String(input || '').trim().toUpperCase();
  if (/^\d{6}$/.test(s)) return [`${s}.KS`, `${s}.KQ`];
  if (/^\d{6}\.(KS|KQ)$/.test(s)) return [s];
  if (/^\^(KS11|KQ11)$/.test(s)) return [s]; // 코스피/코스닥 지수
  return [];
}

async function fetchDaily(symbol) {
  let lastError = null;

  for (const host of HOSTS) {
    const url =
      `${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?interval=1d&range=max&includePrePost=false`;

    let response;
    try {
      response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    } catch (err) {
      lastError = err;
      continue; // 네트워크 실패면 다음 호스트로
    }

    if (response.status === 429) {
      const err = new Error('rate limited');
      err.rateLimited = true;
      throw err; // 호스트를 바꿔도 같은 IP라 소용없으므로 즉시 중단
    }
    if (!response.ok) {
      lastError = new Error(`upstream ${response.status}`);
      continue;
    }

    const json = await response.json();
    const result = json?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp)) {
      lastError = new Error(json?.chart?.error?.description || 'no data');
      continue;
    }

    const quote = result.indicators?.quote?.[0] || {};
    const values = [];

    for (let i = 0; i < result.timestamp.length; i++) {
      const close = quote.close?.[i];
      // 휴장일·거래정지일은 null 로 오므로 버립니다. 종가가 없으면 계산에 쓸 수 없습니다.
      if (close == null) continue;
      values.push({
        datetime: new Date(result.timestamp[i] * 1000).toISOString().slice(0, 10),
        open: String(quote.open?.[i] ?? close),
        high: String(quote.high?.[i] ?? close),
        low: String(quote.low?.[i] ?? close),
        close: String(close),
      });
    }

    if (values.length === 0) {
      lastError = new Error('no data');
      continue;
    }

    // Twelve Data 와 같은 최신순(내림차순)으로 뒤집습니다.
    values.reverse();

    return {
      values,
      meta: {
        symbol: result.meta?.symbol || symbol,
        name: result.meta?.longName || result.meta?.shortName || null,
        currency: result.meta?.currency || 'KRW',
        exchange: result.meta?.fullExchangeName || result.meta?.exchangeName || null,
      },
    };
  }

  throw lastError || new Error('no data');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { symbol, outputsize = 5000 } = req.body || {};
  if (!symbol) {
    res.status(400).json({ error: 'symbol is required' });
    return;
  }

  const candidates = candidateSymbols(symbol);
  if (candidates.length === 0) {
    res.status(400).json({ status: 'error', message: '한국 종목 코드 형식이 아닙니다 (예: 005930)' });
    return;
  }

  const limit = Math.max(1, Math.min(Number(outputsize) || 5000, 20000));
  const cacheKey = candidates.join('|');
  const cached = _cache.get(cacheKey);

  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    res.status(200).json({ values: cached.data.values.slice(0, limit), meta: cached.data.meta });
    return;
  }

  let lastError = null;

  for (const candidate of candidates) {
    try {
      const data = await fetchDaily(candidate);
      _cache.set(cacheKey, { data, time: Date.now() });
      res.status(200).json({ values: data.values.slice(0, limit), meta: data.meta });
      return;
    } catch (err) {
      if (err.rateLimited) {
        // retryMinute: 하루 한도를 다 쓴 게 아니라 잠깐 몰린 것이므로,
        // 프론트엔드가 "내일 다시" 대신 "1분 뒤에 다시" 로 안내하도록 구분자를 줍니다.
        res.status(429).json({
          error: 'rate limited',
          retryMinute: true,
          message: '한국 주식 시세 요청이 잠시 몰렸습니다. 1분 뒤에 다시 시도해주세요.',
        });
        return;
      }
      lastError = err;
      // .KS 에 없으면 .KQ 로 넘어갑니다 (상장 시장을 모르는 경우)
    }
  }

  const reason = (lastError && lastError.message) || '';
  console.warn('[KR] 시세 조회 실패:', symbol, reason);

  // "그런 종목이 없다"와 "우리가 데이터를 못 가져왔다"는 사용자에게 다르게 안내해야 합니다.
  // 네트워크·업스트림 장애를 "종목 코드를 확인하세요"라고 말하면 사용자가 멀쩡한 코드를
  // 계속 고쳐 넣게 됩니다.
  const notFound = reason === 'no data' || /^upstream 4\d\d$/.test(reason);
  res.status(200).json({
    status: 'error',
    message: notFound
      ? '데이터가 없습니다. 종목 코드를 확인해주세요.'
      : '시세 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.',
  });
};
