#!/usr/bin/env node
// 공포·탐욕 지수를 미리 계산해 data/fear-greed.json 하나로 만듭니다.
//
//   node scripts/generate-fear-greed.js
//
// 시장마다 값의 출처가 다릅니다.
//   🇺🇸 미국 : CNN Business 공식 지수를 그대로 씁니다 (scripts/fetch-cnn-fear-greed.js 가 받아
//              둔 data/cnn-fear-greed.json 을 읽습니다). 미국 심리는 CNN 값이 사실상 표준이라
//              비슷한 걸 따로 계산해 두면 매일 숫자가 어긋나고 틀린 쪽은 우리로 보입니다.
//   🇰🇷 한국 : CNN 이 만들지 않으므로 CNN 과 같은 방식으로 우리가 계산합니다
//              (산식은 scripts/fear-greed.js — 어느 지표를 무엇으로 대신했는지도 거기 적혀 있습니다).
//
// CNN 값을 못 받은 경우에는 미국도 같은 방식으로 계산해 채우고, 그 사실을 데이터에
// 남깁니다(source: 'own'). 화면은 그 표시를 보고 "CNN 공식"인지 "우리 계산"인지 밝힙니다.
// 남의 서버가 막혔다고 탭이 사라지면, 사용자는 우리가 고장 난 줄로 압니다.
//
// 이 스크립트 자체는 네트워크를 쓰지 않습니다. 이미 커밋된 파일만 읽습니다.
//
// 왜 지난 1년치를 매번 다시 계산하는가:
//   오늘 점수 하나만 보면 "38"이 낮은 건지 알 수 없습니다. 어제 계산한 값을 이어붙이지 않고
//   매번 전 구간을 다시 계산하는 이유는, 산식을 고쳤을 때 과거 점수만 옛 산식으로 남아
//   선이 이상하게 꺾이는 걸 막기 위해서입니다.

const fs = require('fs');
const path = require('path');
const { MARKETS, SECTOR_DEFS, BENCHMARKS, REFRESH_SCHEDULE, FG_BOND } = require('./sectors');
const { KR_TICKERS } = require('./kr-tickers');
const { readSeries, alignForward } = require('./generate-sector-rs');
const FG = require('./fear-greed');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'fear-greed.json');
const CNN_FILE = path.join(ROOT, 'data', 'cnn-fear-greed.json');

// 거래일 축 길이. 왜 520 인가:
//   거래량과 외국인 소진율이 종목 파일에 최근 520행만 저장돼 있습니다(generate-kr-data.js).
//   더 길게 잡아도 그 두 구성 요소는 계산되지 않으므로 늘어나는 건 계산 시간뿐입니다.
//
//   이 안에서 점수가 나오는 구간은 뒤쪽 일부입니다. 가장 긴 구성 요소(52주 신고가)가
//   250거래일을 참조하고, 그 값을 다시 지난 250거래일과 견줘 z-점수를 내기 때문입니다.
//   그래서 이력은 약 200거래일(10개월)치가 나옵니다.
const AXIS_ROWS = 520;
const FOREIGN_STALE = 30;   // 외국인 소진율을 앞으로 끌고 갈 수 있는 최대 거래일 수
const CNN_STALE_DAYS = 10;  // 받아둔 CNN 값이 이보다 오래되면 우리 계산으로 대체합니다

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

// 축 전체의 20거래일 실현변동성. 변동성 구성 요소가 이걸 다시 50일 평균과 비교하므로
// (CNN 이 VIX 를 자기 50일선과 비교하는 것과 같은 구조) 점 하나가 아니라 선이 필요합니다.
function volSeries(bench, axis) {
  const out = new Array(axis.length).fill(null);
  for (let at = 0; at < axis.length; at++) out[at] = FG.realizedVol(bench, at, 20);
  return out;
}

// 한 시장의 재료(벤치마크 종가, 수록 종목, 국채 ETF, 변동성 선)를 모읍니다.
function buildContext(marketKey) {
  const info = MARKETS.find(m => m.key === marketKey);
  const bench = BENCHMARKS[marketKey];
  const benchSeries = readSeries(info.dir, bench.code);
  if (!benchSeries) throw new Error(`벤치마크 ${bench.code} 데이터가 없습니다 (data/${info.dir}/${bench.code}.json)`);

  const axis = benchSeries.dates.slice(-AXIS_ROWS);
  const benchClose = alignForward(benchSeries, axis);

  // 수록 종목. 같은 종목이 두 섹터에 있어도 한 번만 셉니다.
  const universe = new Map();
  for (const def of SECTOR_DEFS[marketKey]) {
    for (const code of def.codes) {
      if (universe.has(code)) continue;
      const s = readSeries(info.dir, code);
      if (s) universe.set(code, alignedStock(s, axis));
    }
  }
  const stocks = [...universe.values()];
  if (stocks.length === 0) throw new Error(`${marketKey}: 수록 종목 데이터가 하나도 없습니다`);

  // 국채 ETF. 아직 수집되지 않았으면 null 이고, 그러면 안전자산 선호가 통째로 빠집니다.
  // 방어주 바스켓 같은 다른 값으로 몰래 대신하지 않습니다 — 이름만 CNN 이고 내용이 다른
  // 지표를 섞으면 "CNN 과 같은 방식"이라는 말 자체가 거짓이 됩니다.
  let bond = null, bondName = null;
  const bondCode = FG_BOND[marketKey];
  if (bondCode) {
    const bs = readSeries(info.dir, bondCode);
    if (bs) {
      bond = alignForward(bs, axis);
      const t = KR_TICKERS.find(x => x.code === bondCode);
      bondName = (t && t.name) || bs.name || bondCode;
    } else {
      console.warn(`⚠️  ${marketKey}: 국채 ETF(${bondCode}) 데이터가 아직 없어 안전자산 선호를 뺍니다.`
        + ' 다음 데이터 갱신에서 채워집니다.');
    }
  }

  return {
    info, bench, axis,
    ctx: {
      bench: benchClose,
      benchName: bench.name,
      stocks,
      bond,
      bondName,
      vol20: volSeries(benchClose, axis),
    },
  };
}

// 구성 요소 하나의 축 전체 원시값과 점수. z-점수가 "지난 250거래일의 이 값"을 필요로 하므로
// 하루치만 계산해서는 점수를 낼 수 없습니다.
function buildSpec(spec, ctx, axis) {
  const raws = new Array(axis.length).fill(null);
  for (let at = 0; at < axis.length; at++) raws[at] = spec.raw(ctx, at);
  const values = raws.map(r => (r ? r.v : null));
  const scores = raws.map((_, at) => FG.scoreAt(values, at));
  return { spec, raws, values, scores };
}

function describe(b, at, inScore) {
  return {
    key: b.spec.key,
    label: b.spec.label,
    hint: b.spec.hint,
    cnn: b.spec.cnn || null,
    inScore,
    score: b.scores[at] == null ? null : Math.round(b.scores[at]),
    value: b.values[at] == null ? null : Math.round(b.values[at] * 100) / 100,
    note: b.raws[at] ? b.raws[at].note : null,
  };
}

function buildMarket(marketKey) {
  const { info, bench, axis, ctx } = buildContext(marketKey);
  const last = axis.length - 1;

  // 재료가 없는 구성 요소는 목록에서 뺍니다. 늘 "—" 인 줄을 화면에 세워 두지 않습니다.
  const built = FG.COMPONENTS
    .map(spec => buildSpec(spec, ctx, axis))
    .filter(b => b.scores.some(v => v != null));
  if (built.length === 0) throw new Error(`${marketKey}: 계산되는 구성 요소가 하나도 없습니다`);

  const extras = FG.EXTRAS
    .map(spec => buildSpec(spec, ctx, axis))
    .filter(b => b.scores.some(v => v != null));

  // 이력의 시작점: 모든 구성 요소가 점수를 내기 시작하는 날. 중간에 하나가 빠지는 날은
  // 남은 것들로 평균냅니다. 하지만 시작부터 구성이 다르면 앞부분과 뒷부분이 서로 다른
  // 지표가 되므로, 다 모이는 날부터 그립니다.
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

  const score = scores[scores.length - 1];
  const b = FG.band(score);
  const back = n => (scores.length > n ? scores[scores.length - 1 - n] : null);

  return {
    label: info.label,
    flag: info.flag || '',
    source: 'own',
    benchmark: { code: bench.code, name: bench.name },
    updated: new Date(axis[last] * 86400000).toISOString().slice(0, 10),
    universeCount: ctx.stocks.length,
    score,
    band: b.key,
    bandLabel: b.label,
    emoji: b.emoji,
    color: b.color,
    prev: { d1: back(1), w1: back(5), m1: back(20), m3: back(60), m6: back(120) },
    range: { min: Math.min(...scores), max: Math.max(...scores), avg: Math.round(scores.reduce((a, c) => a + c, 0) / scores.length) },
    components: built.map(x => describe(x, last, true)).concat(extras.map(x => describe(x, last, false))),
    history: { dates, scores },
  };
}

// CNN 이 받아둔 값을 화면이 쓰는 모양으로 바꿉니다. 구간 이름(공포·탐욕)은 CNN 의 영어
// rating 을 옮기지 않고 점수에서 다시 뽑습니다 — 두 탭의 "탐욕"이 같은 뜻이어야 합니다.
function fromCnn() {
  if (!fs.existsSync(CNN_FILE)) return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(CNN_FILE, 'utf8')); }
  catch (err) { console.warn(`⚠️  data/cnn-fear-greed.json 을 읽지 못했습니다: ${err.message}`); return null; }

  if (typeof j.score !== 'number' || !j.history || !Array.isArray(j.history.scores)) {
    console.warn('⚠️  data/cnn-fear-greed.json 의 모양이 이상합니다 — 무시합니다.');
    return null;
  }
  const ageDays = (Date.now() - new Date(j.updated + 'T00:00:00Z').getTime()) / 86400000;
  if (!Number.isFinite(ageDays) || ageDays > CNN_STALE_DAYS) {
    console.warn(`⚠️  받아둔 CNN 값이 ${Math.floor(ageDays)}일 전 것입니다 — 우리 계산으로 대체합니다.`);
    return null;
  }

  const scores = j.history.scores;
  const b = FG.band(j.score);
  const info = MARKETS.find(m => m.key === 'US');
  const back = n => (scores.length > n ? scores[scores.length - 1 - n] : null);

  return {
    label: info.label,
    flag: info.flag || '',
    source: 'cnn',
    sourceName: j.source,
    sourceUrl: j.sourceUrl,
    fetchedAt: j.fetchedAt,
    benchmark: { code: 'SPX', name: 'S&P 500' },
    updated: j.updated,
    universeCount: null,
    score: j.score,
    band: b.key,
    bandLabel: b.label,
    emoji: b.emoji,
    color: b.color,
    // CNN 은 어제·1주·1개월·1년 전 값을 직접 줍니다. 3·6개월은 주지 않으므로 이력에서 셉니다.
    prev: {
      d1: j.prev.d1, w1: j.prev.w1, m1: j.prev.m1,
      m3: back(60), m6: back(120), y1: j.prev.y1,
    },
    range: { min: Math.min(...scores), max: Math.max(...scores), avg: Math.round(scores.reduce((a, c) => a + c, 0) / scores.length) },
    components: j.components.map(c => ({ ...c, cnn: c.label, inScore: true, value: null })),
    history: j.history,
  };
}

function main() {
  const markets = {};

  // 한국: CNN 이 만들지 않으므로 같은 방식으로 우리가 계산합니다.
  try {
    markets.KR = buildMarket('KR');
    const m = markets.KR;
    console.log(`   ${m.label} ${m.score}점 (${m.bandLabel}) — 기준일 ${m.updated}, 수록 ${m.universeCount}종목,`
      + ` 구성 요소 ${m.components.filter(c => c.inScore).length}개, 이력 ${m.history.scores.length}일`);
  } catch (err) {
    console.warn(`⚠️  한국 시장을 건너뜁니다: ${err.message}`);
  }

  // 미국: CNN 공식 값. 없거나 오래됐으면 같은 방식으로 계산해 채웁니다.
  const cnn = fromCnn();
  if (cnn) {
    markets.US = cnn;
    console.log(`   ${cnn.label} ${cnn.score}점 (${cnn.bandLabel}) — CNN 공식, 기준일 ${cnn.updated},`
      + ` 구성 요소 ${cnn.components.length}개, 이력 ${cnn.history.scores.length}일`);
  } else {
    try {
      markets.US = buildMarket('US');
      const m = markets.US;
      console.log(`   ${m.label} ${m.score}점 (${m.bandLabel}) — CNN 값이 없어 자체 계산, 기준일 ${m.updated}`);
    } catch (err) {
      console.warn(`⚠️  미국 시장을 건너뜁니다: ${err.message}`);
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

module.exports = { buildMarket, buildContext, alignedStock, fromCnn };
