#!/usr/bin/env node
// 섹터 상대강도(RS)와 수급 지표를 미리 계산해 data/sectors.json 하나로 만듭니다.
//
//   node scripts/generate-sector-rs.js
//
// 네트워크를 쓰지 않습니다. 이미 커밋된 data/kr/*.json, data/us/*.json 만 읽습니다.
// 그래서 오프라인에서 몇 번이고 다시 돌리며 숫자를 검산할 수 있습니다.
//
// 왜 미리 계산하는가:
//   브라우저에서 하려면 100개가 넘는 종목 파일(합계 9MB)을 받아야 합니다. 미리 계산해 두면
//   사용자는 120KB짜리 파일 하나만 받고, 시장 전환·기간 전환이 네트워크 없이 즉시 됩니다.
//
// 용어 주의: 이 저장소에서 "상대강도"는 지금까지 RSI(Relative Strength Index)를 뜻했습니다.
// 여기서 만드는 RS(Relative Strength)는 "벤치마크 대비 얼마나 강한가"로, 다른 지표입니다.

const fs = require('fs');
const path = require('path');
const { KR_TICKERS } = require('./kr-tickers');
const {
  MARKETS, SECTOR_DEFS, US_NAMES, BENCHMARKS, TURNOVER_COMPARABLE,
  REFRESH_SCHEDULE, usSymbols, PERIODS,
} = require('./sectors');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'sectors.json');
const TICKER_FILE = path.join(ROOT, 'data', 'ticker-sectors.json');

const AXIS_ROWS = 520;  // 거래일 축 길이. 12개월(250) 지표를 직전 12개월과 비교하는 데 필요.
const RS_ROWS = 250;    // 화면 차트에 그릴 RS 선의 길이 (약 1년)
const RANK_LAG = 20;    // "1개월 전 순위"의 기준. 이 차이가 곧 수급 유입/이탈 방향입니다.

// 거래대금 배율(turnMult)의 분모가 되는 "평소" 구간 길이. 고른 기간 직전 1년입니다.
// 12개월(250일) 기간이면 250 + 250 = 500 < AXIS_ROWS 라서 축 안에 아슬아슬하게 들어갑니다.
const BASE_DAYS = 250;

// 거래대금이 "늘었다/줄었다"를 가르는 문턱. 이 사이는 보합으로 둡니다.
// 문턱 없이 1.0 을 기준으로 가르면 1.02 배가 "유입"으로 찍혀, 아무 일도 없는 날에도
// 화면이 매일 다른 이야기를 합니다.
const MULT_UP = 1.15, MULT_DOWN = 0.85;

// 매집·분산 방향(heavyRet 등)을 계산할 최소 창 길이.
// 1일·1주 창에서 "거래가 터진 날"을 고르는 것은 표본이 1~5개라 뜻이 없습니다.
const DIR_MIN_DAYS = 20;

const round2 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

// ── 시세 파일 읽기 ────────────────────────────────────────────────────
// 저장 형식(generate-kr-data.js 참고):
//   d 에포크일, h 고가, c 종가 — 전 구간
//   v 거래량, f 외국인소진율 — 최근 TAIL_ROWS 행만. v[k] ↔ d[d.length - v.length + k]
function readSeries(dir, code) {
  const p = path.join(ROOT, 'data', dir, `${code}.json`);
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(j.d) || j.d.length === 0) return null;

  const close = new Map();
  const volume = new Map();
  const foreign = new Map();
  for (let i = 0; i < j.d.length; i++) close.set(j.d[i], j.c[i]);

  const vOff = j.v ? j.d.length - j.v.length : 0;
  if (j.v) for (let k = 0; k < j.v.length; k++) volume.set(j.d[vOff + k], j.v[k]);

  const fOff = j.f ? j.d.length - j.f.length : 0;
  if (j.f) for (let k = 0; k < j.f.length; k++) {
    if (j.f[k] != null) foreign.set(j.d[fOff + k], j.f[k]);
  }

  return { code, name: j.name || code, currency: j.currency || null, dates: j.d, close, volume, foreign };
}

// 거래일 축 위에 종가를 늘어놓습니다. 그 날 거래가 없으면 마지막으로 알려진 종가를 씁니다
// (거래정지·휴장). 아직 상장 전이면 null 이고, 그 구간은 계산에서 제외됩니다.
//
// 중요: 시세가 끝난 날 이후로는 연장하지 않고 null 로 둡니다.
// 앞으로 채우기는 데이터 "사이"의 구멍을 메우는 것이지, 없는 미래를 지어내는 게 아닙니다.
// 끝까지 연장하면 상장폐지·합병된 종목이 "매일 0% 변동"으로 계산에 남아 섹터 지수를
// 평평한 쪽으로 끌어당깁니다. 실제로 HD현대미포(2025-12-12 이후 시세 없음)가 조선 섹터
// 수익률을 그만큼 부풀리고 있었습니다.
function alignForward(series, axis) {
  const out = new Array(axis.length).fill(null);
  const dates = series.dates;
  const lastDate = dates[dates.length - 1];
  let last = null;
  let cursor = 0;
  for (let i = 0; i < axis.length; i++) {
    while (cursor < dates.length && dates[cursor] <= axis[i]) {
      last = series.close.get(dates[cursor]);
      cursor++;
    }
    out[i] = axis[i] > lastDate ? null : last;
  }
  return out;
}

// 동일가중 일간 리밸런싱 지수.
// 시가총액 가중이 아닌 이유: 우리에겐 시총 데이터가 없고, 무엇보다 "반도체·메모리"를
// 삼성전자 하나가 100% 설명해 버리면 섹터 지표로서 의미가 없습니다.
function equalWeightIndex(alignedList) {
  const n = alignedList[0].length;
  const idx = new Array(n).fill(100);
  for (let i = 1; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (const a of alignedList) {
      const prev = a[i - 1];
      const cur = a[i];
      if (prev == null || cur == null || prev <= 0) continue; // 상장 전·데이터 없음
      sum += cur / prev - 1;
      count++;
    }
    idx[i] = idx[i - 1] * (1 + (count ? sum / count : 0));
  }
  return idx;
}

// 지수의 P거래일 수익률(%). at 은 기준 시점(기본 = 마지막).
function periodReturn(idx, days, at) {
  const end = at == null ? idx.length - 1 : at;
  const start = end - days;
  if (start < 0 || !Number.isFinite(idx[start]) || idx[start] <= 0) return null;
  return (idx[end] / idx[start] - 1) * 100;
}

// 같은 시장 섹터들 사이의 백분위 순위를 1~99 로. (IBD 의 RS Rating 과 같은 방식)
// 절대 수익률이 아니라 순위이므로, 시장 전체가 빠지는 구간에서도 "덜 빠진 섹터"가 드러납니다.
function toRatings(values) {
  const valid = values.map((v, i) => ({ v, i })).filter(x => x.v != null);
  const ratings = new Array(values.length).fill(null);
  if (valid.length === 0) return ratings;
  if (valid.length === 1) { ratings[valid[0].i] = 50; return ratings; }

  valid.sort((a, b) => a.v - b.v); // 낮은 수익률이 앞
  valid.forEach((x, rank) => {
    ratings[x.i] = Math.round(1 + 98 * (rank / (valid.length - 1)));
  });
  return ratings;
}

// 축의 [from, to) 구간 거래대금 합계. 거래량이 없는 종목은 합계에서 빠집니다.
function turnoverSum(series, axis, from, to) {
  let sum = 0;
  for (let i = Math.max(0, from); i < to; i++) {
    const day = axis[i];
    const v = series.volume.get(day);
    if (v == null || v === 0) continue;
    const c = series.close.get(day);
    if (c == null) continue;
    sum += c * v;
  }
  return sum;
}

// 축 위에 하루치 거래대금을 그대로 늘어놓습니다. 구간 합계(turnoverSum)만으로는
// "거래가 터진 날 가격이 어느 쪽으로 갔는가"를 볼 수 없어서, 일별 배열이 따로 필요합니다.
function dailyTurnover(series, axis) {
  const out = new Array(axis.length).fill(0);
  for (let i = 0; i < axis.length; i++) {
    const day = axis[i];
    const v = series.volume.get(day);
    if (v == null || v === 0) continue;
    const c = series.close.get(day);
    if (c == null) continue;
    out[i] = c * v;
  }
  return out;
}

// [from, to) 평균. 구간이 축을 벗어나면 null — 0 으로 때우면 배율이 무한대가 됩니다.
function windowMean(arr, from, to) {
  if (from < 0 || to > arr.length || to - from <= 0) return null;
  let sum = 0;
  for (let i = from; i < to; i++) sum += arr[i];
  return sum / (to - from);
}

// ── 거래대금 배율 ─────────────────────────────────────────────────────
// 왜 비중(turnShare)만으로는 부족한가:
//   비중은 남들이 조용해져도 올라갑니다. 실제로 미국 메모리는 3개월 비중이 +4%p 늘었는데
//   같은 기간 절대 거래대금은 오히려 줄고 있었습니다 — 6~7월에 터진 거래의 잔상이었습니다.
//   비중만 보면 "돈이 들어오는 중"으로 읽히지만 사실은 식는 중이었던 겁니다.
//
// 그래서 절대 금액을 "평소"와 견줍니다. 최근 기간의 하루 평균 거래대금이 그 직전 1년의
// 하루 평균 대비 몇 배인가. 1.0 이면 평소만큼, 2.0 이면 평소의 두 배가 오갔다는 뜻입니다.
function turnoverMultiple(turn, last, days) {
  const cur = windowMean(turn, last + 1 - days, last + 1);
  const base = windowMean(turn, last + 1 - days - BASE_DAYS, last + 1 - days);
  if (cur == null || base == null || base <= 0) return null;
  return cur / base;
}

// ── 거래가 터진 날, 가격은 어느 쪽으로 갔는가 ─────────────────────────
// 거래대금은 매수 금액과 매도 금액이 언제나 같습니다. 그래서 거래대금이 늘었다는 사실
// 하나만으로는 매집인지 분산인지 알 수 없습니다 — 알 수 있는 건 "손바뀜이 컸다"뿐입니다.
//
// 방향을 짐작할 수 있는 가장 정직한 방법은, 거래가 유난히 많았던 날 가격이 어느 쪽으로
// 움직였는지를 보는 것입니다. 큰 거래가 오른 날에 몰렸다면 사려는 쪽이 급했다는 뜻이고,
// 빠진 날에 몰렸다면 팔려는 쪽이 급했다는 뜻입니다. 어디까지나 정황이지 증거가 아니며,
// 그래서 화면에서도 "매집"이라 단정하지 않고 이 숫자 그대로 보여줍니다.
//
//   heavyRet   거래대금 상위 25% 날들의 평균 등락률 (%)
//   lightRet   하위 25% 날들의 평균 등락률 (%)
//   flowRatio  오른 날 거래대금에서 내린 날 거래대금을 뺀 값을 전체로 나눈 비율 (%)
//              +100 이면 오른 날에만 거래가 있었다는 뜻, -100 이면 그 반대입니다.
function turnoverDirection(idx, turn, last, days) {
  if (days < DIR_MIN_DAYS) return null;   // 표본이 너무 적으면 아예 내놓지 않습니다
  const from = last + 1 - days;
  if (from - 1 < 0) return null;          // 첫날의 등락률을 내려면 하루 앞이 있어야 합니다

  const rows = [];
  for (let i = from; i <= last; i++) {
    const prev = idx[i - 1];
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(idx[i])) continue;
    rows.push({ ret: (idx[i] / prev - 1) * 100, turn: turn[i] });
  }
  if (rows.length < DIR_MIN_DAYS) return null;

  const total = rows.reduce((a, r) => a + r.turn, 0);
  if (total <= 0) return null;

  const signed = rows.reduce((a, r) => a + Math.sign(r.ret) * r.turn, 0);

  const sorted = [...rows].sort((a, b) => b.turn - a.turn);
  const q = Math.max(1, Math.round(sorted.length / 4));
  const mean = list => list.reduce((a, r) => a + r.ret, 0) / list.length;

  return {
    heavyRet: mean(sorted.slice(0, q)),
    lightRet: mean(sorted.slice(-q)),
    flowRatio: (signed / total) * 100,
  };
}

// ── 4분면 ─────────────────────────────────────────────────────────────
// 거래대금(평소 대비 배율)과 상대강도(벤치마크 대비)를 엮으면 네 가지 상태가 나옵니다.
// 같은 "거래대금 증가"라도 가격이 따라 오르는 중인지 아닌지에 따라 뜻이 정반대입니다.
//
//   lead    거래 ↑ · 강함 ↑   주도 — 돈이 들어오면서 가격도 따라옵니다
//   churn   거래 ↑ · 약함 ↓   손바뀜 — 거래는 터지는데 가격은 밀립니다
//   quiet   거래 ↓ · 강함 ↑   조용한 상승 — 관심 밖에서 오릅니다
//   cold    거래 ↓ · 약함 ↓   소외 — 돈도 관심도 빠졌습니다
//   null    문턱 안(보합)이거나 판단할 값이 없음
function quadrantOf(mult, alpha) {
  if (mult == null || alpha == null) return null;
  if (mult >= MULT_UP) return alpha > 0 ? 'lead' : 'churn';
  if (mult <= MULT_DOWN) return alpha > 0 ? 'quiet' : 'cold';
  return null;
}

// 축의 index 시점에서 유효한 마지막 외국인소진율. 없으면 null.
function foreignAt(series, axis, index) {
  for (let i = index; i >= 0 && i > index - 30; i--) {
    const f = series.foreign.get(axis[i]);
    if (f != null) return f;
  }
  return null;
}

// ── 마지막 봉이 장중인가 ──────────────────────────────────────────────
// 수집이 장 마감 전에 돌면 마지막 날 거래량이 하루치가 아니라 그때까지의 누적입니다.
// 실제로 2026-09-03 한국 파일의 삼성전자는 180만 주였습니다 — 평소 1500만 주의 12%.
//
// 비중(turnShare)은 모든 섹터가 똑같이 덜 찼으니 비율이 대체로 유지돼 티가 안 납니다.
// 하지만 거래대금 배율은 절대 금액이라 그대로 드러납니다. "평소의 0.09배"는 노이즈가
// 아니라 틀린 문장입니다 — 아직 안 끝난 하루를 끝난 하루와 비교한 것이기 때문입니다.
//
// 그래서 직전 20거래일 중앙값의 60% 에 못 미치면 장중으로 봅니다. 반휴장일도 걸릴 수
// 있으므로 단정하지 않고 표시만 하고, 화면이 그 사실을 사용자에게 말합니다.
const PARTIAL_RATIO = 0.6;

function partialLastBar(universeList, axis) {
  const last = axis.length - 1;
  if (last < 21) return null;
  const dayTotal = i => universeList.reduce((a, u) => {
    const v = u.volume.get(axis[i]);
    const c = u.close.get(axis[i]);
    return a + ((v == null || c == null) ? 0 : c * v);
  }, 0);

  const prev = [];
  for (let i = last - 20; i < last; i++) prev.push(dayTotal(i));
  prev.sort((a, b) => a - b);
  const median = prev[Math.floor(prev.length / 2)];
  if (!(median > 0)) return null;

  const ratio = dayTotal(last) / median;
  return ratio < PARTIAL_RATIO ? round2(ratio) : null;
}

// ── 한 시장 계산 ──────────────────────────────────────────────────────
// meta 는 MARKETS 의 한 줄(라벨·깃발 등)입니다. 넘기지 않으면 키로 찾고, 그것도 없으면
// 키를 그대로 라벨로 씁니다 — 테스트가 가짜 시장으로 부를 수 있게 두려는 것입니다.
function buildMarket(marketKey, dir, sectorDefs, nameOf, meta) {
  const info = meta || MARKETS.find(m => m.key === marketKey) || { label: marketKey, flag: '' };
  const hasTurnover = TURNOVER_COMPARABLE[marketKey] !== false;
  const bench = BENCHMARKS[marketKey];
  const benchSeries = readSeries(dir, bench.code);
  if (!benchSeries) throw new Error(`벤치마크 ${bench.code} 데이터가 없습니다 (data/${dir}/${bench.code}.json)`);

  // 거래일 축은 벤치마크 날짜를 기준으로 삼습니다. 어떤 섹터든 같은 날짜 위에서 비교됩니다.
  const axis = benchSeries.dates.slice(-AXIS_ROWS);
  const benchIdx = equalWeightIndex([alignForward(benchSeries, axis)]);

  const dropped = [];
  const stale = [];
  const sectors = [];
  const universe = new Map(); // 거래대금 분모용. 같은 종목이 두 섹터에 있어도 한 번만 셉니다.

  for (const def of sectorDefs) {
    const members = [];
    for (const code of def.codes) {
      const s = readSeries(dir, code);
      if (!s) { dropped.push(`${def.name}/${code}`); continue; }
      // 시세가 축 끝까지 오지 않는 종목은 최근 구간 계산에서 자동으로 빠집니다(alignForward).
      // 조용히 빠지면 왜 섹터 수치가 달라졌는지 알 수 없으므로 로그로 드러냅니다.
      const lag = axis.filter(d => d > s.dates[s.dates.length - 1]).length;
      if (lag > 0) stale.push(`${def.name}/${s.name} ${lag}거래일`);
      members.push(s);
      universe.set(code, s);
    }
    if (members.length === 0) {
      console.warn(`⚠️  ${def.name}: 구성 종목 데이터가 하나도 없어 건너뜁니다`);
      continue;
    }
    const aligned = members.map(m => alignForward(m, axis));
    // 섹터의 하루치 거래대금 = 구성 종목 합계. 배율과 방향 지표가 이 배열 위에서 계산됩니다.
    const daily = members.map(m => dailyTurnover(m, axis));
    const turn = axis.map((_, i) => daily.reduce((a, d) => a + d[i], 0));
    sectors.push({ def, members, aligned, daily, turn, idx: equalWeightIndex(aligned) });
  }
  if (sectors.length === 0) throw new Error(`${marketKey}: 계산 가능한 섹터가 없습니다`);

  const last = axis.length - 1;
  const universeList = [...universe.values()];
  const partialRatio = hasTurnover ? partialLastBar(universeList, axis) : null;

  // 기간별 지표. rating 은 섹터들끼리의 순위이므로 시장 단위로 한 번에 계산합니다.
  const perPeriod = {};
  const memberTurn = {};
  for (const P of PERIODS) {
    const rets = sectors.map(s => periodReturn(s.idx, P.days));
    const retsPrev = sectors.map(s => periodReturn(s.idx, P.days, last - RANK_LAG));
    const ratings = toRatings(rets);
    const ratingsPrev = toRatings(retsPrev);
    const benchRet = periodReturn(benchIdx, P.days);

    // 거래대금 비중: 최근 P일 vs 그 직전 P일. 기간을 바꾸면 비교 창도 함께 움직입니다.
    const curTotal = universeList.reduce((a, s) => a + turnoverSum(s, axis, last + 1 - P.days, last + 1), 0);
    const prevTotal = universeList.reduce((a, s) => a + turnoverSum(s, axis, last + 1 - P.days * 2, last + 1 - P.days), 0);

    // 히트맵은 타일 크기를 거래대금으로 정합니다. 섹터 합계만으로는 그릴 수 없어
    // 종목별 비중도 같이 담아 둡니다. (섹터별 합계는 아래에서 그대로 재사용)
    memberTurn[P.key] = sectors.map(s =>
      s.members.map(m => {
        const own = turnoverSum(m, axis, last + 1 - P.days, last + 1);
        return (hasTurnover && curTotal > 0) ? round2((own / curTotal) * 100) : null;
      })
    );

    perPeriod[P.key] = sectors.map((s, i) => {
      const cur = s.members.reduce((a, m) => a + turnoverSum(m, axis, last + 1 - P.days, last + 1), 0);
      const prev = s.members.reduce((a, m) => a + turnoverSum(m, axis, last + 1 - P.days * 2, last + 1 - P.days), 0);
      const share = (hasTurnover && curTotal > 0) ? (cur / curTotal) * 100 : null;
      const sharePrev = (hasTurnover && prevTotal > 0) ? (prev / prevTotal) * 100 : null;

      // 외국인소진율은 종목별 변화폭을 먼저 구한 뒤 평균냅니다. 절대 수준을 평균하면
      // 그 사이에 값이 생기거나 사라진 종목 때문에 변화폭이 엉뚱하게 튑니다.
      const nowVals = [];
      const deltas = [];
      for (const m of s.members) {
        const now = foreignAt(m, axis, last);
        const then = foreignAt(m, axis, last - P.days);
        if (now != null) nowVals.push(now);
        if (now != null && then != null) deltas.push(now - then);
      }

      // 절대 거래대금 지표. 비중과 달리 남의 사정에 흔들리지 않습니다.
      // 마지막 봉이 장중이면 1일 창은 그 봉 하나가 전부입니다. 덜 찬 하루를 꽉 찬
      // 하루들과 견준 배율은 노이즈가 아니라 오답이라, 아예 내놓지 않습니다.
      // 기간이 길수록 한 봉의 몫이 작아지므로 5일 이상은 그대로 둡니다.
      const partialWindow = partialRatio != null && P.days <= 1;
      const mult = round2((hasTurnover && !partialWindow) ? turnoverMultiple(s.turn, last, P.days) : null);
      const dir = hasTurnover ? turnoverDirection(s.idx, s.turn, last, P.days) : null;
      const alpha = (rets[i] != null && benchRet != null) ? rets[i] - benchRet : null;

      return {
        ret: round2(rets[i]),
        alpha: round2(alpha),
        rating: ratings[i],
        ratingPrev: ratingsPrev[i],
        rankChg: (ratings[i] != null && ratingsPrev[i] != null) ? ratings[i] - ratingsPrev[i] : null,
        turnShare: round2(share),
        turnShareChg: round2(share != null && sharePrev != null ? share - sharePrev : null),
        turnAvgM: (hasTurnover && !partialWindow) ? Math.round(cur / P.days / 1e6) : null,  // 하루 평균 거래대금 (백만 단위)
        turnMult: mult,
        quadrant: quadrantOf(mult, round2(alpha)),
        heavyRet: dir ? round2(dir.heavyRet) : null,
        lightRet: dir ? round2(dir.lightRet) : null,
        flowRatio: dir ? round2(dir.flowRatio) : null,
        foreign: nowVals.length ? round2(nowVals.reduce((a, b) => a + b, 0) / nowVals.length) : null,
        foreignChg: deltas.length ? round2(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null,
      };
    });
  }

  // RS 선: 섹터지수 / 벤치마크지수 를 창 시작 = 100 으로 정규화 (맨스필드형).
  // 100 위로 올라가면 벤치마크보다 강해지는 중, 아래로 내려가면 약해지는 중입니다.
  const rsFrom = Math.max(0, axis.length - RS_ROWS);
  const out = sectors.map((s, i) => {
    const base = s.idx[rsFrom] / benchIdx[rsFrom];
    const rs = [];
    for (let k = rsFrom; k < axis.length; k++) rs.push(round2((s.idx[k] / benchIdx[k]) / base * 100));

    const periods = {};
    for (const P of PERIODS) periods[P.key] = perPeriod[P.key][i];

    return {
      key: s.def.key,
      name: s.def.name,
      rs,
      periods,
      members: s.members.map((m, mi) => {
        // 정렬된 종가에서 직접 구합니다. 지수로 돌려 구하면 시세가 끊긴 종목이 "0%"로
        // 나와 화면에 보합처럼 보입니다. 양 끝 중 하나라도 없으면 null 이어야 합니다.
        const a = s.aligned[mi];
        const end = a.length - 1;
        const ret = {};
        const turn = {};
        const mult = {};   // 평소 대비 거래대금 배율
        const fChg = info.hasForeign ? {} : null;   // 외국인 소진율 변화 (한국 종목에만 있습니다)
        for (const P of PERIODS) {
          const from = a[end - P.days];
          const to = a[end];
          ret[P.key] = (from == null || to == null || from <= 0) ? null : round2((to / from - 1) * 100);
          turn[P.key] = memberTurn[P.key][i][mi];
          // 섹터 배율과 같은 이유로, 장중이면 1일 배율은 내놓지 않습니다.
          mult[P.key] = (hasTurnover && !(partialRatio != null && P.days <= 1))
            ? round2(turnoverMultiple(s.daily[mi], last, P.days)) : null;

          // 섹터 평균만 보면 "누가" 사 모이는지는 가려집니다. 반도체·메모리처럼 종목마다
          // 외국인 방향이 갈리는 섹터에서는 이 줄이 섹터 평균보다 많은 것을 말해 줍니다.
          if (fChg) {
            const now = foreignAt(m, axis, last);
            const then = foreignAt(m, axis, last - P.days);
            fChg[P.key] = (now != null && then != null) ? round2(now - then) : null;
          }
        }
        const out = { code: m.code, name: nameOf(m), ret, turn, mult };
        if (fChg) out.fChg = fChg;
        return out;
      }),
    };
  });

  const benchPeriods = {};
  for (const P of PERIODS) benchPeriods[P.key] = round2(periodReturn(benchIdx, P.days));

  if (dropped.length) console.warn(`⚠️  ${marketKey}: 데이터 파일이 없어 제외한 구성 종목 ${dropped.length}개 — ${dropped.join(', ')}`);
  if (stale.length) console.warn(`⚠️  ${marketKey}: 시세가 뒤처져 최근 구간에서 빠지는 종목 ${stale.length}개 — ${stale.join(', ')}\n`
    + '     오래 뒤처진 종목은 상장폐지·합병일 수 있습니다. scripts/sectors.js 에서 빼는 것을 검토하세요.');

  return {
    market: {
      label: info.label,
      flag: info.flag || '',
      hasForeign: !!info.hasForeign,
      hasTurnover,
      partialLast: partialRatio,   // 장중 수집이면 그 비율, 아니면 null
      currency: (universeList.find(u => u.currency && u.currency !== 'PT') || {}).currency || null,
      benchmark: { code: bench.code, name: bench.name, ret: benchPeriods },
      updated: new Date(axis[last] * 86400000).toISOString().slice(0, 10),
      universeCount: universeList.length,
      dates: axis.slice(rsFrom),
      sectors: out,
    },
    stats: { sectors: out.length, dropped: dropped.length },
  };
}

// ── 정합성 검사 ───────────────────────────────────────────────────────
// 오타 하나로 섹터가 조용히 비는 것을 막습니다. 데이터 파일이 아직 없는 것(수집 실패)과
// 애초에 목록에 없는 코드(오타)는 다른 문제이므로, 후자만 여기서 죽입니다.
function assertCodesKnown() {
  const known = { kr: new Set(KR_TICKERS.map(t => t.code)), us: new Set(usSymbols()) };
  const bad = [];
  for (const m of MARKETS) {
    for (const s of SECTOR_DEFS[m.key]) {
      for (const c of s.codes) if (!known[m.dir].has(c)) bad.push(`${m.key}/${s.name}/${c}`);
    }
  }
  if (bad.length) {
    console.error(`::error::sectors.js 가 모르는 코드를 참조합니다: ${bad.join(', ')}`);
    process.exit(1);
  }
}

// ── 종목 → 섹터 색인 ──────────────────────────────────────────────────
// MDD 계산기(홈)에서 "이 종목 최근 수급" 카드를 그리는 데 씁니다.
//
// 왜 sectors.json 을 그냥 쓰지 않는가:
//   sectors.json 은 210KB 입니다. 섹터 화면은 그 값을 다 쓰지만, 홈은 종목 하나의 섹터와
//   그 섹터의 최근 수급 몇 줄만 필요합니다. 티커를 하나 조회할 때마다 210KB 를 받게 하는 건
//   그 카드 하나가 치를 값이 아닙니다. 그래서 필요한 것만 담은 20KB 짜리를 따로 만듭니다.
//
// 기간은 1개월 하나로 고정합니다. 카드에서 기간을 고르게 하면 결국 섹터 화면을 홈에 다시
// 만드는 일이 되고, 그 화면은 이미 있습니다 — 카드는 그리로 보내는 것이 일입니다.
const TICKER_PERIOD = '1m';

function buildTickerIndex(markets) {
  // 테마(AI·성장)는 부가 정보로만 답니다. 같은 미국 종목을 다르게 묶은 것이라
  // "이 종목의 섹터"로 삼으면 시장 탭과 어긋납니다.
  const themes = {};
  if (markets.THEME) {
    for (const s of markets.THEME.sectors) {
      for (const mem of s.members) (themes[mem.code] = themes[mem.code] || []).push([s.key, s.name]);
    }
  }

  const tickers = {};
  for (const key of ['KR', 'US']) {
    const m = markets[key];
    if (!m) continue;
    for (const s of m.sectors) {
      const p = s.periods[TICKER_PERIOD] || {};
      for (const mem of s.members) {
        // 한 종목이 두 섹터에 들어 있으면 먼저 나온 쪽을 씁니다(sectors.js 의 순서).
        if (tickers[mem.code]) continue;
        tickers[mem.code] = {
          m: key,
          n: mem.name,
          s: s.key,
          sn: s.name,
          ret: mem.ret[TICKER_PERIOD],
          sectorRet: p.ret == null ? null : p.ret,
          rating: p.rating == null ? null : p.rating,
          rankChg: p.rankChg == null ? null : p.rankChg,
          turnShare: p.turnShare == null ? null : p.turnShare,
          turnShareChg: p.turnShareChg == null ? null : p.turnShareChg,
          // 비중만 담으면 홈 카드도 섹터 화면과 똑같은 오독을 부릅니다 — 남이 조용해져도
          // 비중은 오릅니다. 절대 금액 배율과 4분면을 같이 실어 보냅니다.
          turnMult: p.turnMult == null ? null : p.turnMult,
          quadrant: p.quadrant || null,
          foreignChg: p.foreignChg == null ? null : p.foreignChg,
          t: themes[mem.code],
        };
      }
    }
  }
  return tickers;
}

// 이 계산이 "어느 소스에서 받은 값으로" 만들어졌는지를 결과 파일에 함께 담습니다.
//
// 왜 필요한가: 섹터 RS 와 히트맵은 같은 data/sectors.json 을 읽습니다. 화면에 막대가
// 그려진다고 해서 그 값이 Twelve Data 로 받은 최신 종가라는 보장은 없습니다 — 수집이
// 통째로 실패해도 지난 파일이 남아 있어 화면은 똑같이 그려집니다. 그래서 "이번 계산에
// 들어간 미국 파일 중 몇 개가 Twelve Data 에서 왔는가"를 여기서 세어 남깁니다.
// scripts/check-api-usage.js 가 이 값을 검사합니다.
function usProvenance() {
  const sources = {};
  let counted = 0;
  for (const code of usSymbols()) {
    const p = path.join(ROOT, 'data', 'us', `${code}.json`);
    if (!fs.existsSync(p)) continue;
    let src = 'unknown';   // source 필드가 생기기 전에 만들어진 파일
    try { src = JSON.parse(fs.readFileSync(p, 'utf8')).source || 'unknown'; } catch { /* 손상 파일 */ }
    sources[src] = (sources[src] || 0) + 1;
    counted++;
  }

  const out = { symbols: counted, sources };

  // 수집 기록이 있으면 호출 수까지 같이 답니다. 없으면 그 항목만 빠집니다.
  const usagePath = path.join(ROOT, 'data', 'api-usage.json');
  if (fs.existsSync(usagePath)) {
    try {
      const u = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
      out.apiUsage = {
        provider: u.provider, calls: u.calls,
        generatedAt: u.generatedAt, generatedAtKST: u.generatedAtKST,
        delta: u.usage && u.usage.measured ? u.usage.delta : null,
      };
    } catch { /* 기록이 깨졌다고 RS 계산을 멈출 이유는 없습니다 */ }
  }

  return out;
}

function main() {
  assertCodesKnown();

  const krName = new Map(KR_TICKERS.map(t => [t.code, t.name]));
  const markets = {};

  // 한 시장의 데이터가 통째로 없어도(수집 실패, 야후 차단) 나머지 시장은 살립니다.
  // 화면도 실제로 들어 있는 시장만 탭으로 보여줍니다. 여기서 죽이면 사고 하나에
  // 페이지 전체가 데이터 없는 화면이 됩니다 — KR 수집이 이미 택한 정책과 같습니다.
  const nameOfFor = dir => (dir === 'kr'
    ? m => krName.get(m.code) || m.name
    : m => US_NAMES[m.code] || m.name);

  for (const info of MARKETS) {
    try {
      const built = buildMarket(info.key, info.dir, SECTOR_DEFS[info.key], nameOfFor(info.dir), info);
      markets[info.key] = built.market;
      console.log('   ' + built.market.label + ' ' + built.stats.sectors + '섹터'
        + ' (기준일 ' + built.market.updated + ', 수록 ' + built.market.universeCount + '종목)');
    } catch (err) {
      console.warn('⚠️  ' + info.key + ' 시장을 건너뜁니다: ' + err.message);
    }
  }

  if (Object.keys(markets).length === 0) {
    console.error('::error::계산할 수 있는 시장이 하나도 없습니다. data/kr, data/us 를 확인하세요.');
    process.exit(1);
  }

  // generatedAt 은 날짜만이 아니라 시각까지 담습니다.
  //
  // 기준일(market.updated)은 "어느 날 종가인가"이고, generatedAt 은 "언제 받아왔는가"라서
  // 서로 다른 값입니다. 화면에서 "왜 어제 날짜지?" 를 가르는 것이 바로 이 둘의 차이입니다.
  // 갱신이 며칠째 멈춰 있어도 기준일만 보면 알 수 없으므로, 화면이 이 값으로 판단합니다.
  //
  // schedule 은 "다음 갱신은 언제인가"를 화면이 스스로 계산하는 데 씁니다. 안내 문구를
  // HTML 에 박아 두면 cron 을 고쳤을 때 조용히 거짓말이 됩니다.
  const provenance = { US: usProvenance() };

  fs.writeFileSync(OUT_FILE, JSON.stringify({
    updated: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    schedule: REFRESH_SCHEDULE,
    provenance,
    markets,
  }));
  console.log('✅ data/sectors.json — ' + Math.round(fs.statSync(OUT_FILE).size / 1024) + 'KB');
  console.log('   미국 데이터 출처: '
    + (Object.entries(provenance.US.sources).map(([k, n]) => `${k} ${n}`).join(', ') || '없음')
    + (provenance.US.apiUsage ? ` · 마지막 수집 ${provenance.US.apiUsage.generatedAtKST}`
      + ` (Twelve Data ${provenance.US.apiUsage.calls}회)` : ''));

  const tickers = buildTickerIndex(markets);
  fs.writeFileSync(TICKER_FILE, JSON.stringify({
    updated: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    period: TICKER_PERIOD,
    periodLabel: (PERIODS.find(p => p.key === TICKER_PERIOD) || {}).label || TICKER_PERIOD,
    markets: Object.fromEntries(Object.entries(markets)
      .filter(([k]) => k === 'KR' || k === 'US')
      .map(([k, m]) => [k, { label: m.label, flag: m.flag, benchmark: m.benchmark.name, updated: m.updated }])),
    tickers,
  }));
  console.log('✅ data/ticker-sectors.json — ' + Object.keys(tickers).length + '종목, '
    + Math.round(fs.statSync(TICKER_FILE).size / 1024) + 'KB');
}

if (require.main === module) main();

module.exports = {
  equalWeightIndex, alignForward, periodReturn, toRatings, readSeries, buildMarket,
  buildTickerIndex, usProvenance, dailyTurnover, turnoverMultiple, turnoverDirection, quadrantOf,
};
