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
const { KR_SECTORS, US_SECTORS, US_NAMES, BENCHMARKS, TURNOVER_COMPARABLE, usSymbols, PERIODS } = require('./sectors');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'sectors.json');

const AXIS_ROWS = 520;  // 거래일 축 길이. 12개월(250) 지표를 직전 12개월과 비교하는 데 필요.
const RS_ROWS = 250;    // 화면 차트에 그릴 RS 선의 길이 (약 1년)
const RANK_LAG = 20;    // "1개월 전 순위"의 기준. 이 차이가 곧 수급 유입/이탈 방향입니다.

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

  return { code, name: j.name || code, dates: j.d, close, volume, foreign };
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

// 축의 index 시점에서 유효한 마지막 외국인소진율. 없으면 null.
function foreignAt(series, axis, index) {
  for (let i = index; i >= 0 && i > index - 30; i--) {
    const f = series.foreign.get(axis[i]);
    if (f != null) return f;
  }
  return null;
}

// ── 한 시장 계산 ──────────────────────────────────────────────────────
function buildMarket(marketKey, dir, sectorDefs, nameOf) {
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
    sectors.push({ def, members, aligned, idx: equalWeightIndex(aligned) });
  }
  if (sectors.length === 0) throw new Error(`${marketKey}: 계산 가능한 섹터가 없습니다`);

  const last = axis.length - 1;
  const universeList = [...universe.values()];

  // 기간별 지표. rating 은 섹터들끼리의 순위이므로 시장 단위로 한 번에 계산합니다.
  const perPeriod = {};
  const memberTurn = {};
  for (const P of PERIODS) {
    // 순위 변화의 비교 시점. 기본은 1개월 전이지만, 1일 기간에서 "한 달 전 그날 하루의
    // 순위"와 비교하는 것은 아무 뜻이 없습니다. 하루짜리는 바로 전 거래일과 견줍니다.
    // (화면 열 제목도 기간에 따라 다르게 씁니다 — assets/site.js 의 RS_COLS)
    const lag = P.days === 1 ? 1 : RANK_LAG;
    const rets = sectors.map(s => periodReturn(s.idx, P.days));
    const retsPrev = sectors.map(s => periodReturn(s.idx, P.days, last - lag));
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
      //
      // 1일 기간에서는 변화폭을 내지 않습니다(null). 소진율은 결제일(T+2) 뒤에 확정돼서
      // 마지막 거래일 값은 그 전날 값이 그대로 실려 옵니다 — 표본 40종목을 확인했더니
      // 40개 전부 마지막 이틀이 같은 값이었고, 그 앞 이틀은 33개가 달랐습니다.
      // 그대로 빼면 모든 섹터가 정확히 0.00%p 가 되어, "변화 없음"처럼 보이는 숫자가
      // 실제로는 "아직 안 나옴"입니다. 없는 값은 0 이 아니라 없는 값으로 둡니다.
      const foreignReady = P.days > 1;
      const nowVals = [];
      const deltas = [];
      for (const m of s.members) {
        const now = foreignAt(m, axis, last);
        const then = foreignAt(m, axis, last - P.days);
        if (now != null) nowVals.push(now);
        if (foreignReady && now != null && then != null) deltas.push(now - then);
      }

      return {
        ret: round2(rets[i]),
        alpha: round2(rets[i] != null && benchRet != null ? rets[i] - benchRet : null),
        rating: ratings[i],
        ratingPrev: ratingsPrev[i],
        rankChg: (ratings[i] != null && ratingsPrev[i] != null) ? ratings[i] - ratingsPrev[i] : null,
        turnShare: round2(share),
        turnShareChg: round2(share != null && sharePrev != null ? share - sharePrev : null),
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
        for (const P of PERIODS) {
          const from = a[end - P.days];
          const to = a[end];
          ret[P.key] = (from == null || to == null || from <= 0) ? null : round2((to / from - 1) * 100);
          turn[P.key] = memberTurn[P.key][i][mi];
        }
        return { code: m.code, name: nameOf(m), ret, turn };
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
      label: marketKey === 'KR' ? '한국' : '미국',
      hasForeign: marketKey === 'KR',
      hasTurnover,
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
  const krKnown = new Set(KR_TICKERS.map(t => t.code));
  const krBad = KR_SECTORS.flatMap(s => s.codes.filter(c => !krKnown.has(c)).map(c => `${s.name}/${c}`));
  const usKnown = new Set(usSymbols());
  const usBad = US_SECTORS.flatMap(s => s.codes.filter(c => !usKnown.has(c)).map(c => `${s.name}/${c}`));
  const bad = [...krBad, ...usBad];
  if (bad.length) {
    console.error(`::error::sectors.js 가 모르는 코드를 참조합니다: ${bad.join(', ')}`);
    process.exit(1);
  }
}

function main() {
  assertCodesKnown();

  const krName = new Map(KR_TICKERS.map(t => [t.code, t.name]));
  const markets = {};

  // 한 시장의 데이터가 통째로 없어도(수집 실패, 야후 차단) 나머지 시장은 살립니다.
  // 화면도 실제로 들어 있는 시장만 탭으로 보여줍니다. 여기서 죽이면 사고 하나에
  // 페이지 전체가 데이터 없는 화면이 됩니다 — KR 수집이 이미 택한 정책과 같습니다.
  const plan = [
    ['KR', 'kr', KR_SECTORS, m => krName.get(m.code) || m.name],
    ['US', 'us', US_SECTORS, m => US_NAMES[m.code] || m.name],
  ];
  for (const [key, dir, defs, nameOf] of plan) {
    try {
      const built = buildMarket(key, dir, defs, nameOf);
      markets[key] = built.market;
      console.log('   ' + built.market.label + ' ' + built.stats.sectors + '섹터'
        + ' (기준일 ' + built.market.updated + ', 수록 ' + built.market.universeCount + '종목)');
    } catch (err) {
      console.warn('⚠️  ' + key + ' 시장을 건너뜁니다: ' + err.message);
    }
  }

  if (Object.keys(markets).length === 0) {
    console.error('::error::계산할 수 있는 시장이 하나도 없습니다. data/kr, data/us 를 확인하세요.');
    process.exit(1);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify({
    updated: new Date().toISOString().slice(0, 10),
    markets,
  }));
  console.log('✅ data/sectors.json — ' + Math.round(fs.statSync(OUT_FILE).size / 1024) + 'KB');
}

if (require.main === module) main();

module.exports = { equalWeightIndex, alignForward, periodReturn, toRatings, readSeries, buildMarket };
