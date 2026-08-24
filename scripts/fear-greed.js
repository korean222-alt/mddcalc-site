// 공포·탐욕 지수 산식 — 순수 함수만 있습니다. 파일도 네트워크도 읽지 않습니다.
//
// 이 파일은 **한국 시장용**입니다. 미국은 CNN Business 의 공식 지수를 그대로 받아 씁니다
// (scripts/fetch-cnn-fear-greed.js). 미국 심리에 관해서는 CNN 값이 사실상 표준이라,
// 비슷한 걸 따로 계산해 두면 "CNN 은 72 라던데 여기는 55" 같은 일이 매일 생기고 그때
// 틀린 쪽은 우리로 보입니다. 반대로 한국 지수는 CNN 이 만들지 않으므로, CNN 이 쓰는 방식을
// 그대로 코스피에 적용해 우리가 계산합니다.
//
// ── CNN 의 7개 지표와 이 파일의 대응 ──────────────────────────────────
//   1 시장 모멘텀      지수 vs 125일 이동평균          → 그대로
//   2 주가 강도        52주 신고가 vs 신저가 종목 수    → 그대로
//   3 주가 폭          오른 종목·내린 종목에 실린 거래량 → 그대로 (McClellan 과 같은 발상)
//   4 시장 변동성      VIX vs 50일 이동평균            → 실현변동성 vs 자기 50일 이동평균
//                                                       (VKOSPI 일봉을 우리가 갖고 있지 않습니다)
//   5 안전자산 선호    주식 vs 국채 20일 수익률 차이    → 코스피 vs 국고채10년 ETF
//   6 풋/콜 옵션                                       → 없음 (한국 옵션 데이터 없음)
//   7 정크본드 수요                                    → 없음 (국내 하이일드 스프레드 데이터 없음)
//
// 즉 한국은 CNN 7개 중 5개입니다. 빠진 둘을 그럴듯한 다른 값으로 채우지 않습니다 —
// 이름만 같고 내용이 다른 지표가 섞이면 "CNN 방식"이라는 말 자체가 거짓이 됩니다.
// 화면에도 5개로 계산한다고 적습니다.
//
// 외국인 소진율은 CNN 에 없는 항목이라 **점수에 넣지 않고** 참고용으로만 내보냅니다
// (한국 시장에서는 실제로 쓸모 있는 정보라 버리기도 아깝습니다).
//
// ── 0~100 으로 바꾸는 방법: 고정 구간이 아니라 z-점수 ────────────────────
// CNN 은 각 지표를 "평균에서 몇 표준편차 떨어져 있는가"로 환산합니다. 여기서도 같습니다.
// 최근 250거래일의 평균·표준편차를 구해 오늘 값이 몇 표준편차인지 보고, ±2σ 를 0 과 100 으로
// 놓습니다. 지표마다 단위가 달라도(%, 종목 수, %p) 같은 잣대가 됩니다.
//
// 고정 구간으로 만들었던 첫 판은 한국 모멘텀이 1년 중 90% 를 100점에 붙어 있었습니다.
// 코스피가 1년에 100% 넘게 오른 구간이라 "125일선 +10% 초과"가 그냥 일상이었던 것입니다.
// 늘 100점인 값은 지표가 아니라 상수이고, 상수는 평균에 섞여 나머지를 조용히 희석시킵니다.
//
// 대신 분명히 해둘 것: 이 방식은 "역사상 절대적으로 극단인가"가 아니라 "지난 1년의 이
// 시장 자신에 견줘 극단인가"입니다. 원래 값(52주 신고가 몇 종목 등)은 점수와 함께 그대로
// 들고 다녀서, 절대 수준이 궁금한 사람은 그걸 보면 됩니다.
//
// 모든 함수는 데이터가 모자라면 0 이나 50 으로 때우지 않고 null 을 냅니다.
// 없는 값을 "중립"이라고 우기면 화면은 멀쩡한 얼굴로 틀린 숫자를 보여주기 때문입니다.

const Z_WINDOW = 250;   // 비교 대상 구간 (약 1년)
const Z_MIN = 60;       // 이보다 표본이 적으면 점수를 내지 않습니다 (약 3개월)
const Z_SPAN = 2;       // ±2σ 를 0 과 100 으로

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 값을 [lo, hi] 구간에 대고 0~100 으로 폅니다. lo > hi 로 주면 방향이 뒤집힙니다.
function scale(value, lo, hi) {
  if (value == null || !Number.isFinite(value) || lo === hi) return null;
  return clamp(((value - lo) / (hi - lo)) * 100, 0, 100);
}

// series[at] 시점의 n일 단순이동평균. 구간에 구멍(null)이 있으면 null.
function sma(series, at, n) {
  if (at == null || at < n - 1) return null;
  let sum = 0;
  for (let i = at - n + 1; i <= at; i++) {
    const v = series[i];
    if (v == null || !Number.isFinite(v)) return null;
    sum += v;
  }
  return sum / n;
}

// 일간 로그수익률의 표준편차를 연율화(√252)한 실현변동성.
function realizedVol(series, at, n) {
  if (at == null || at < n) return null;
  const rets = [];
  for (let i = at - n + 1; i <= at; i++) {
    const a = series[i - 1], b = series[i];
    if (a == null || b == null || a <= 0 || b <= 0) return null;
    rets.push(Math.log(b / a));
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varr) * Math.sqrt(252);
}

// raw[at] 이 최근 Z_WINDOW 구간에서 몇 표준편차인지. 표본이 모자라거나 값이 한 번도
// 변하지 않았으면(σ=0) null — 변하지 않는 값에서 "몇 표준편차"는 뜻이 없습니다.
function zScoreAt(raw, at, opt = {}) {
  const window = opt.window || Z_WINDOW;
  const min = opt.min || Z_MIN;
  const cur = raw[at];
  if (cur == null || !Number.isFinite(cur)) return null;

  const vals = [];
  for (let i = Math.max(0, at - window + 1); i <= at; i++) {
    const v = raw[i];
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length < min) return null;

  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const varr = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1);
  const std = Math.sqrt(varr);
  if (!(std > 0)) return null;
  return { z: (cur - mean) / std, mean, std, n: vals.length };
}

// z-점수를 0~100 점으로. ±2σ 가 양 끝입니다.
function scoreAt(raw, at, opt = {}) {
  const z = zScoreAt(raw, at, opt);
  if (!z) return null;
  return scale(z.z, -(opt.span || Z_SPAN), opt.span || Z_SPAN);
}

// ── 구성 요소 ─────────────────────────────────────────────────────────
// 각 구성 요소는 "클수록 탐욕"인 원시값 하나를 냅니다. 점수로 바꾸는 건 위의 z-점수가
// 도맡습니다. 그래서 구성 요소를 추가할 때 0~100 을 어떻게 맞출지 고민할 필요가 없습니다.
//
// raw(ctx, at) 는 { v, note } 또는 null 을 냅니다. note 는 화면에 그대로 나가는 근거
// 문구입니다 — 점수만 보여주면 "왜 82 인가"에 답할 수 없기 때문에 원래 값을 같이 들고 갑니다.
//   ctx = { bench, stocks, riskIdx, safeIdx }
//   stocks[i] = { close: [], volume: [], foreign: []|null }   모두 같은 거래일 축 위의 배열

const COMPONENTS = [
  {
    // CNN 1) Market Momentum — 지수가 125일 이동평균보다 위인가 아래인가. 그대로 옮겼습니다.
    key: 'momentum',
    label: '시장 모멘텀',
    hint: '지수가 125일 이동평균보다 위인가 아래인가',
    cnn: '시장 모멘텀',
    raw({ bench, benchName }, at) {
      const ma = sma(bench, at, 125);
      const c = bench[at];
      if (ma == null || c == null || ma <= 0) return null;
      const dev = (c / ma - 1) * 100;
      return { v: dev, note: `${benchName || '지수'}가 125일 이동평균보다 ${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%` };
    },
  },
  {
    // CNN 2) Stock Price Strength — 52주 신고가 종목 수와 신저가 종목 수의 차이.
    // CNN 은 뉴욕증시 전 종목을 쓰고 우리는 수록 종목만 씁니다. 그래서 절대 개수가 아니라
    // 수록 종목 수로 나눈 비율을 원시값으로 삼습니다 — 종목을 추가해도 눈금이 흔들리지 않습니다.
    key: 'strength',
    label: '주가 강도',
    hint: '52주 신고가 부근 종목 수 − 신저가 부근 종목 수',
    cnn: '주가 강도',
    raw({ stocks }, at) {
      const look = 250, band = 0.02;
      let hi = 0, lo = 0, total = 0;
      for (const s of stocks) {
        const c = s.close[at];
        if (c == null || at < look) continue;
        let max = -Infinity, min = Infinity;
        for (let i = at - look; i <= at; i++) {
          const v = s.close[i];
          if (v == null) continue;   // 상장 전 구간
          if (v > max) max = v;
          if (v < min) min = v;
        }
        if (max === -Infinity) continue;
        total++;
        if (c >= max * (1 - band)) hi++;
        else if (c <= min * (1 + band)) lo++;
      }
      if (total === 0) return null;
      return {
        v: ((hi - lo) / total) * 100,
        note: `52주 신고가 부근 ${hi}종목 vs 신저가 부근 ${lo}종목`,
      };
    },
  },
  {
    // CNN 3) Stock Price Breadth — McClellan Volume Summation, 즉 "오른 종목에 실린 거래량과
    // 내린 종목에 실린 거래량 중 어느 쪽이 많은가"입니다. 우리는 같은 발상을 최근 20거래일
    // 거래대금으로 잽니다. 50%가 반반이고, 넘으면 오르는 쪽에 돈이 실린 것입니다.
    key: 'breadth',
    label: '주가 폭',
    hint: '오른 날과 내린 날 중 어느 쪽에 거래대금이 실렸는가',
    cnn: '주가 폭',
    raw({ stocks }, at) {
      const days = 20;
      let up = 0, down = 0;
      for (let i = at - days + 1; i <= at; i++) {
        if (i <= 0) continue;
        for (const s of stocks) {
          const c = s.close[i], p = s.close[i - 1], v = s.volume ? s.volume[i] : null;
          if (c == null || p == null || v == null || v <= 0) continue;
          if (c > p) up += c * v;
          else if (c < p) down += c * v;
        }
      }
      if (up + down <= 0) return null;
      const share = (up / (up + down)) * 100;
      return { v: share, note: `최근 20거래일 거래대금의 ${share.toFixed(0)}%가 오른 날에 실림` };
    },
  },
  {
    // CNN 4) Market Volatility — VIX 가 자기 50일 이동평균보다 높은가 낮은가.
    // VKOSPI 일봉이 우리에게 없어서 코스피의 20거래일 실현변동성으로 대신하되, 비교 방식은
    // CNN 과 똑같이 "자기 50일 이동평균 대비"로 맞췄습니다.
    // 변동성은 클수록 공포이므로 부호를 뒤집어 "클수록 탐욕" 규칙을 지킵니다.
    key: 'volatility',
    label: '시장 변동성',
    hint: '20일 실현변동성이 자기 50일 평균보다 높은가 낮은가',
    cnn: '시장 변동성',
    raw({ vol20 }, at) {
      const cur = vol20 ? vol20[at] : null;
      const avg = sma(vol20 || [], at, 50);
      if (cur == null || avg == null) return null;
      const gap = (cur - avg) * 100;   // %p
      return {
        v: -gap,
        note: `20일 변동성 연 ${(cur * 100).toFixed(0)}% — 50일 평균(${(avg * 100).toFixed(0)}%)보다 ${gap >= 0 ? '+' : ''}${gap.toFixed(0)}%p`,
      };
    },
  },
  {
    // CNN 5) Safe Haven Demand — 주식과 국채의 최근 20거래일 수익률 차이.
    // 국고채10년 ETF(scripts/sectors.js 의 FG_BOND)를 국채 자리에 놓습니다.
    // 데이터가 아직 없으면(수집 전) 이 구성 요소는 통째로 빠집니다 — 방어주 바스켓 같은
    // 다른 값으로 몰래 대신하지 않습니다.
    key: 'safehaven',
    label: '안전자산 선호',
    hint: '주식과 국고채의 최근 20거래일 수익률 차이',
    cnn: '안전자산 선호',
    raw({ bench, bond, benchName, bondName }, at) {
      if (!bond) return null;
      const from = at - 20;
      if (from < 0) return null;
      const b0 = bench[from], b1 = bench[at], n0 = bond[from], n1 = bond[at];
      if (b0 == null || b1 == null || n0 == null || n1 == null || b0 <= 0 || n0 <= 0) return null;
      const diff = ((b1 / b0 - 1) - (n1 / n0 - 1)) * 100;
      return {
        v: diff,
        note: `최근 20거래일 ${benchName || '주식'}이 ${bondName || '국채'}보다 ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%p`,
      };
    },
  },
];

// CNN 에 없는 항목입니다. 점수에는 넣지 않고 화면에 참고로만 보여줍니다.
// (한국 시장에서는 외국인 수급이 실제로 쓸모 있는 정보라 버리기도 아깝습니다)
const EXTRAS = [
  {
    key: 'foreign',
    label: '외국인 수급',
    hint: '외국인 소진율의 20거래일 변화 — 참고용, 점수에 넣지 않습니다',
    raw({ stocks }, at) {
      const from = at - 20;
      if (from < 0) return null;
      const deltas = [];
      for (const s of stocks) {
        if (!s.foreign) continue;
        const now = s.foreign[at], then = s.foreign[from];
        if (now == null || then == null) continue;
        deltas.push(now - then);
      }
      if (deltas.length === 0) return null;
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      return {
        v: avg,
        note: `외국인 소진율이 20거래일 동안 평균 ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%p`,
      };
    },
  },
];

// ── 합산 ──────────────────────────────────────────────────────────────
// 동일 가중입니다. CNN 도 7개 지표에 같은 가중을 줍니다. 어느 하나가 더 중요하다는 근거는
// 우리에게 없고, 근거 없는 가중치는 결국 "보고 싶은 숫자"를 만들어내는 손잡이가 됩니다.
// 점수가 없는 구성 요소는 그냥 빠집니다 (남은 것들끼리 평균).
function combine(scores) {
  const valid = scores.filter(s => s != null && Number.isFinite(s));
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

// CNN 의 구간 이름을 그대로 씁니다. 사람들이 이미 아는 말이라 설명이 필요 없습니다.
const BANDS = [
  { max: 24,  key: 'extreme-fear',  label: '극단적 공포', emoji: '😱', color: '#c53030' },
  { max: 44,  key: 'fear',          label: '공포',        emoji: '😨', color: '#dd6b20' },
  { max: 55,  key: 'neutral',       label: '중립',        emoji: '😐', color: '#718096' },
  { max: 74,  key: 'greed',         label: '탐욕',        emoji: '🙂', color: '#38a169' },
  { max: 100, key: 'extreme-greed', label: '극단적 탐욕', emoji: '🤑', color: '#276749' },
];

function band(score) {
  if (score == null) return null;
  return BANDS.find(b => score <= b.max) || BANDS[BANDS.length - 1];
}

module.exports = {
  scale, sma, realizedVol, zScoreAt, scoreAt,
  COMPONENTS, EXTRAS, combine, band, BANDS,
  Z_WINDOW, Z_MIN, Z_SPAN,
};
