// 공포·탐욕 지수 산식 — 순수 함수만 있습니다. 파일도 네트워크도 읽지 않습니다.
//
// 왜 우리가 직접 계산하는가:
//   CNN Fear & Greed Index 는 공개 API 가 없고, 한국 시장 지수는 아예 만들지도 않습니다.
//   그런데 우리에겐 이미 매 거래일 수집해 커밋해 둔 재료가 다 있습니다 — 한국·미국 개별
//   종목의 일봉, 거래량, 그리고 한국은 외국인 소진율까지. 남의 숫자를 긁어오는 대신 그
//   재료로 같은 성격의 지표를 만듭니다. 산식이 이 파일 안에 다 보이므로 "이 숫자가 왜
//   이렇게 나왔나"를 끝까지 되짚을 수 있고, 외부 서비스가 죽어도 같이 죽지 않습니다.
//
// 구성 요소는 CNN 과 같은 발상입니다: 값 하나를 믿지 않고 성격이 다른 여러 개를 0~100 으로
// 환산해 평균냅니다. 다만 우리가 가진 데이터로 계산되는 것만 넣었습니다.
// (채권·풋콜비율·정크본드 스프레드는 데이터가 없어 빼고, 대신 한국은 외국인 수급을 넣습니다)
//
// ── 0~100 으로 바꾸는 방법: 고정 구간이 아니라 z-점수 ────────────────────
// 처음에는 "125일선 대비 ±10%" 같은 고정 구간에 대고 폈습니다. 그렇게 만든 첫 판을
// 검산해 보니 한국 모멘텀이 1년 중 90% 를 100점에 붙어 있었습니다. 코스피가 1년에
// 100% 넘게 오른 구간이라 125일선 +10% 초과가 그냥 일상이었던 것입니다. 늘 100점인 값은
// 지표가 아니라 상수이고, 상수는 평균에 섞여 나머지 구성 요소를 조용히 희석시킵니다.
//
// 그래서 각 구성 요소를 "그 시장 자신의 지난 1년"과 비교합니다 (CNN 이 쓰는 방식이기도
// 합니다). 최근 250거래일의 평균·표준편차를 구해 오늘 값이 몇 표준편차인지 보고,
// ±2σ 를 0 과 100 으로 놓습니다. 시장마다 성질이 달라도 같은 잣대가 되고, 한쪽 끝에
// 붙어 사는 구성 요소가 없어집니다.
//
// 대신 분명히 해둘 것: 이 지수는 "역사상 절대적으로 극단인가"가 아니라 "지난 1년의 이
// 시장 자신에 견줘 극단인가"입니다. 1년 내내 조용히 오르기만 한 시장은 100점이 잘 나오지
// 않습니다. 화면에도 그렇게 적습니다. 원래 값(52주 신고가 몇 종목, 50일선 위 몇 종목)은
// 점수와 함께 그대로 들고 다녀서, 절대 수준이 궁금한 사람은 그걸 보면 됩니다.
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
    key: 'momentum',
    label: '시장 모멘텀',
    hint: '지수가 125일 이동평균보다 위인가 아래인가',
    warmup: 125,
    raw({ bench }, at) {
      const ma = sma(bench, at, 125);
      const c = bench[at];
      if (ma == null || c == null || ma <= 0) return null;
      const dev = (c / ma - 1) * 100;
      return { v: dev, note: `지수가 125일 이동평균보다 ${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%` };
    },
  },
  {
    key: 'strength',
    label: '주가 강도',
    hint: '52주 신고가 부근 종목 수 − 신저가 부근 종목 수',
    warmup: 250,
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
    key: 'breadth',
    label: '시장 폭',
    hint: '50일 이동평균 위에 있는 종목 비율',
    warmup: 50,
    raw({ stocks }, at) {
      let above = 0, total = 0;
      for (const s of stocks) {
        const c = s.close[at];
        const ma = sma(s.close, at, 50);
        if (c == null || ma == null) continue;
        total++;
        if (c > ma) above++;
      }
      if (total === 0) return null;
      return {
        v: (above / total) * 100,
        note: `수록 ${total}종목 중 ${above}종목이 50일선 위 (${Math.round((above / total) * 100)}%)`,
      };
    },
  },
  {
    key: 'volatility',
    label: '변동성',
    hint: '최근 20일 변동성이 평소보다 낮으면 탐욕, 높으면 공포',
    warmup: 21,
    // 변동성은 클수록 공포입니다. 부호를 뒤집어 두면 "클수록 탐욕" 규칙이 그대로 지켜져
    // 점수 쪽에서 이 구성 요소만 예외로 다루지 않아도 됩니다.
    raw({ bench }, at) {
      const vol = realizedVol(bench, at, 20);
      if (vol == null) return null;
      return { v: -vol * 100, note: `최근 20거래일 변동성 연 ${(vol * 100).toFixed(0)}%` };
    },
  },
  {
    key: 'volume',
    label: '거래 강도',
    hint: '최근 20일 거래대금이 오른 날에 실렸는가',
    warmup: 21,
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
    key: 'safehaven',
    label: '안전자산 선호',
    hint: '경기민감·성장주가 방어주보다 앞서갔는가',
    warmup: 21,
    // 채권 데이터가 없으니 주식 안에서 위험선호를 봅니다. 겁이 나면 돈은 통신·은행 같은
    // 저베타로 숨고, 배가 부르면 반도체·성장주로 갑니다. (바구니는 scripts/sectors.js)
    raw({ riskIdx, safeIdx }, at) {
      if (!riskIdx || !safeIdx) return null;
      const from = at - 20;
      if (from < 0) return null;
      const r = riskIdx[at] / riskIdx[from] - 1;
      const s = safeIdx[at] / safeIdx[from] - 1;
      if (!Number.isFinite(r) || !Number.isFinite(s)) return null;
      const diff = (r - s) * 100;
      return {
        v: diff,
        note: `최근 20거래일 경기민감주가 방어주보다 ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%p`,
      };
    },
  },
  {
    key: 'foreign',
    label: '외국인 수급',
    hint: '외국인 소진율의 20거래일 변화 (한국 전용)',
    warmup: 21,
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
// 동일 가중입니다. 어느 구성 요소가 더 중요한지를 뒷받침할 근거가 우리에게 없고,
// 근거 없는 가중치는 결국 "보고 싶은 숫자"를 만들어내는 손잡이가 됩니다.
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
  COMPONENTS, combine, band, BANDS,
  Z_WINDOW, Z_MIN, Z_SPAN,
};
