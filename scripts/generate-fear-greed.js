#!/usr/bin/env node
// 공포·탐욕 지수를 미리 계산해 data/fear-greed.json 하나로 만듭니다.
//
//   node scripts/generate-fear-greed.js
//
// 네트워크를 쓰지 않습니다. 이미 커밋된 data/kr/*.json, data/us/*.json 만 읽습니다.
// 그래서 오프라인에서 몇 번이고 다시 돌리며 숫자를 검산할 수 있고, 시세 소스가 막혀도
// 지난번 결과가 그대로 서빙됩니다 — 섹터 RS 와 완전히 같은 방식입니다.
//
// 산식은 scripts/fear-greed.js 에 순수 함수로만 들어 있습니다(파일도 네트워크도 모릅니다).
// 이 파일이 하는 일은 그 함수들이 먹을 배열을 만들어 먹이고, 결과를 JSON 으로 쓰는 것뿐입니다.
//
// 왜 지난 1년치를 매번 다시 계산하는가:
//   오늘 점수 하나만 보면 "38"이 낮은 건지 알 수 없습니다. 지난 1년 어디쯤인지가 같이
//   보여야 의미가 생깁니다. 어제 계산한 값을 이어붙이지 않고 매번 전 구간을 다시 계산하는
//   이유는, 산식을 고쳤을 때 과거 점수만 옛 산식으로 남아 선이 이상하게 꺾이는 걸 막기 위해서입니다.

const fs = require('fs');
const path = require('path');
const { MARKETS, SECTOR_DEFS, BENCHMARKS, REFRESH_SCHEDULE, FG_BASKETS } = require('./sectors');
const { readSeries, alignForward, equalWeightIndex } = require('./generate-sector-rs');
const FG = require('./fear-greed');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'fear-greed.json');

// 거래일 축 길이. 왜 520 인가:
//   거래량과 외국인 소진율이 종목 파일에 최근 520행만 저장돼 있습니다(generate-kr-data.js).
//   더 길게 잡아도 그 두 구성 요소는 계산되지 않으므로 늘어나는 건 계산 시간뿐입니다.
//
//   이 안에서 점수가 나오는 구간은 뒤쪽 일부입니다. 가장 긴 구성 요소(52주 신고가)가
//   250거래일을 참조하고, 그 값을 다시 지난 250거래일과 견줘 z-점수를 내기 때문입니다.
//   그래서 이력은 약 200거래일(10개월)치가 나옵니다 — 화면에 그 길이를 그대로 적습니다.
const AXIS_ROWS = 520;
const FOREIGN_STALE = 30;   // 외국인 소진율을 앞으로 끌고 갈 수 있는 최대 거래일 수

// 시세 파일 하나를 거래일 축 위의 배열 세 개로 폅니다.
//   close   앞으로 채움 (거래정지·휴장). 시세가 끝난 뒤로는 연장하지 않고 null.
//   volume  그날 실제 거래량. 없으면 null — 0 으로 채우면 "거래가 없었다"는 거짓이 됩니다.
//   foreign 마지막으로 알려진 값, 단 30거래일까지만. 그보다 오래되면 null.
function alignedStock(series, axis) {
  const close = alignForward(series, axis);
  const volume = axis.map(d => {
    const v = series.volume.get(d);
    return v == null || v === 0 ? null : v;
  });

  let foreign = null;
  if (series.foreign && series.foreign.size > 0) {
    foreign = new Array(axis.length).fill(null);
    let last = null, age = 0;
    for (let i = 0; i < axis.length; i++) {
      const f = series.foreign.get(axis[i]);
      if (f != null) { last = f; age = 0; }
      else age++;
      foreign[i] = (last != null && age <= FOREIGN_STALE) ? last : null;
    }
  }

  return { code: series.code, name: series.name, close, volume, foreign };
}

// 한 시장의 재료(벤치마크 종가, 수록 종목, 위험/방어 바스켓 지수)를 모읍니다.
function buildContext(marketKey) {
  const info = MARKETS.find(m => m.key === marketKey);
  const bench = BENCHMARKS[marketKey];
  const benchSeries = readSeries(info.dir, bench.code);
  if (!benchSeries) throw new Error(`벤치마크 ${bench.code} 데이터가 없습니다 (data/${info.dir}/${bench.code}.json)`);

  const axis = benchSeries.dates.slice(-AXIS_ROWS);
  const benchClose = alignForward(benchSeries, axis);

  // 수록 종목. 같은 종목이 두 섹터에 있어도 한 번만 셉니다.
  const bySector = new Map();
  const universe = new Map();
  for (const def of SECTOR_DEFS[marketKey]) {
    const list = [];
    for (const code of def.codes) {
      let a = universe.get(code);
      if (!a) {
        const s = readSeries(info.dir, code);
        if (!s) continue;
        a = alignedStock(s, axis);
        universe.set(code, a);
      }
      list.push(a);
    }
    if (list.length) bySector.set(def.key, list);
  }
  const stocks = [...universe.values()];
  if (stocks.length === 0) throw new Error(`${marketKey}: 수록 종목 데이터가 하나도 없습니다`);

  // 위험/방어 바스켓 지수. 한쪽이라도 비면 안전자산 선호는 계산되지 않습니다(null).
  const basket = FG_BASKETS[marketKey];
  const basketIndex = keys => {
    if (!keys) return null;
    const list = [];
    for (const k of keys) for (const s of (bySector.get(k) || [])) list.push(s.close);
    return list.length ? equalWeightIndex(list) : null;
  };

  return {
    info, bench, axis,
    ctx: {
      bench: benchClose,
      stocks,
      riskIdx: basketIndex(basket && basket.risk),
      safeIdx: basketIndex(basket && basket.safe),
    },
  };
}

function buildMarket(marketKey) {
  const { info, bench, axis, ctx } = buildContext(marketKey);
  const last = axis.length - 1;

  // 이 시장에서 계산 대상인 구성 요소만 남깁니다. 미국은 외국인 소진율 데이터가 아예 없고,
  // 바스켓이 비면 안전자산 선호도 없습니다. 늘 "—" 인 줄을 화면에 세워 두지 않습니다.
  const specs = FG.COMPONENTS.filter(c => {
    if (c.key === 'foreign') return ctx.stocks.some(s => s.foreign);
    if (c.key === 'safehaven') return !!(ctx.riskIdx && ctx.safeIdx);
    return true;
  });

  // 구성 요소마다 축 전체의 원시값을 한 번에 만들어 둡니다. z-점수가 "지난 250거래일의
  // 이 값"을 필요로 하므로, 하루치만 계산해서는 점수를 낼 수 없습니다.
  const built = specs.map(spec => {
    const raws = new Array(axis.length).fill(null);
    for (let at = 0; at < axis.length; at++) raws[at] = spec.raw(ctx, at);
    const values = raws.map(r => (r ? r.v : null));
    const scores = raws.map((_, at) => FG.scoreAt(values, at));
    return { spec, raws, values, scores };
  });

  // 이력의 시작점: 모든 구성 요소가 점수를 내기 시작하는 날.
  // 중간에 하나가 빠지는 날은 남은 것들로 평균냅니다(combine). 하지만 시작부터 구성이
  // 다르면 앞부분과 뒷부분이 서로 다른 지표가 되므로, 다 모이는 날부터 그립니다.
  let start = 0;
  for (let at = 0; at < axis.length; at++) {
    if (built.every(b => b.scores[at] != null)) { start = at; break; }
  }

  const dates = [];
  const scores = [];
  for (let at = start; at < axis.length; at++) {
    const s = FG.combine(built.map(b => b.scores[at]));
    if (s == null) continue;
    dates.push(axis[at]);
    scores.push(s);
  }
  if (scores.length === 0) throw new Error(`${marketKey}: 점수를 낼 수 있는 날이 하나도 없습니다`);

  const components = built.map(b => ({
    key: b.spec.key,
    label: b.spec.label,
    hint: b.spec.hint,
    score: b.scores[last] == null ? null : Math.round(b.scores[last]),
    value: b.values[last] == null ? null : Math.round(b.values[last] * 100) / 100,
    note: b.raws[last] ? b.raws[last].note : null,
  }));

  const score = scores[scores.length - 1];
  const b = FG.band(score);

  // 과거 같은 지표와의 비교. "38"이 낮은 건지 높은 건지는 이것 없이는 알 수 없습니다.
  const back = n => (scores.length > n ? scores[scores.length - 1 - n] : null);

  return {
    label: info.label,
    flag: info.flag || '',
    benchmark: { code: bench.code, name: bench.name },
    updated: new Date(axis[last] * 86400000).toISOString().slice(0, 10),
    universeCount: ctx.stocks.length,
    score,
    band: b.key,
    bandLabel: b.label,
    emoji: b.emoji,
    color: b.color,
    prev: { d1: back(1), w1: back(5), m1: back(20), m3: back(60), m6: back(120) },
    // 지난 1년 중 오늘이 어디쯤인지. 점수 하나만으로는 높은지 낮은지 알 수 없습니다.
    range: { min: Math.min(...scores), max: Math.max(...scores), avg: Math.round(scores.reduce((a, c) => a + c, 0) / scores.length) },
    components,
    history: { dates, scores },
  };
}

function main() {
  const markets = {};
  // 공포·탐욕은 시장 단위 심리 지표입니다. THEME 탭은 US 와 같은 종목을 다르게 묶어 놓은
  // 것뿐이라 지수를 따로 내면 같은 숫자가 이름만 바꿔 두 번 나옵니다. 그래서 뺍니다.
  for (const key of ['KR', 'US']) {
    try {
      markets[key] = buildMarket(key);
      const m = markets[key];
      console.log(`   ${m.label} ${m.score}점 (${m.bandLabel}) — 기준일 ${m.updated}, 수록 ${m.universeCount}종목, 이력 ${m.history.scores.length}일`);
    } catch (err) {
      console.warn(`⚠️  ${key} 시장을 건너뜁니다: ${err.message}`);
    }
  }

  if (Object.keys(markets).length === 0) {
    console.error('::error::계산할 수 있는 시장이 하나도 없습니다. data/kr, data/us 를 확인하세요.');
    process.exit(1);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify({
    updated: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    schedule: REFRESH_SCHEDULE,
    // 구간 표(0~24 극단적 공포 …)를 데이터가 들고 갑니다. 화면에도 같은 표를 두면 구간을
    // 조정할 때 두 곳을 고쳐야 하고, 한쪽만 고치면 게이지 색과 글자가 어긋납니다.
    bands: FG.BANDS,
    markets,
  }));
  console.log('✅ data/fear-greed.json — ' + Math.round(fs.statSync(OUT_FILE).size / 1024) + 'KB');
}

if (require.main === module) main();

module.exports = { buildMarket, alignedStock };
