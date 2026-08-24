#!/usr/bin/env node
// CNN Business 의 공식 Fear & Greed Index 를 받아 data/cnn-fear-greed.json 으로 저장합니다.
//
//   node scripts/fetch-cnn-fear-greed.js
//   node scripts/fetch-cnn-fear-greed.js --dry-run    받아서 확인만 하고 파일은 쓰지 않음
//
// 왜 받아오는가:
//   미국 시장 심리에 관해서는 CNN 지수가 사실상 표준입니다. 우리가 비슷한 걸 계산해 놓으면
//   "CNN 은 72 라던데 여기는 55" 같은 일이 매일 생기고, 그때 틀린 쪽은 우리로 보입니다.
//   그래서 미국 탭은 CNN 값을 그대로 씁니다. 한국은 CNN 이 만들지 않으므로 같은 방식으로
//   우리가 계산합니다(scripts/fear-greed.js).
//
// 이 스크립트는 절대 실패로 잡을 죽이지 않습니다. 못 받으면 기존 파일을 그대로 두고
// 종료 코드 0 으로 끝납니다. 그 경우 화면은 지난번 값(또는 우리 자체 계산)으로 돌아갑니다 —
// 남의 서버가 잠깐 막혔다고 우리 페이지가 비어 보일 이유는 없습니다.
//
// 주의: 이 엔드포인트는 CNN 이 자기 차트에 쓰는 것이고 공식 문서가 있는 API 가 아닙니다.
// 응답 모양이 예고 없이 바뀔 수 있으므로, 아래 파서는 모르는 모양을 만나면 조용히
// 실패하는 대신 무엇이 어긋났는지 로그로 남기고 기존 파일을 지킵니다.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'cnn-fear-greed.json');
const BASE = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
const SOURCE_PAGE = 'https://www.cnn.com/markets/fear-and-greed';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = 20000;
const STALE_DAYS = 10;   // 이보다 오래된 값이면 "받아왔다"고 인정하지 않습니다

const DRY_RUN = process.argv.includes('--dry-run');

// CNN 의 7개 지표. 왼쪽이 응답의 키, 오른쪽이 화면에 나갈 이름입니다.
// alt 는 응답에서 키 이름이 바뀌었을 때 대신 찾아볼 자리입니다(모멘텀·변동성은 CNN 화면에서
// 각각 "125일 이동평균 대비", "VIX 50일 이동평균 대비"를 쓰므로 그쪽을 먼저 봅니다).
const COMPONENT_KEYS = [
  { key: 'market_momentum_sp125', alt: 'market_momentum_sp500', label: '시장 모멘텀', hint: 'S&P 500 이 125일 이동평균보다 위인가 아래인가' },
  { key: 'stock_price_strength', label: '주가 강도', hint: '뉴욕증시 52주 신고가 종목 수 vs 신저가 종목 수' },
  { key: 'stock_price_breadth', label: '주가 폭', hint: '오른 종목과 내린 종목에 실린 거래량 (McClellan)' },
  { key: 'put_call_options', label: '풋/콜 옵션', hint: '5일 평균 풋콜 비율 — 풋이 많으면 공포' },
  { key: 'market_volatility_vix_50', alt: 'market_volatility_vix', label: '시장 변동성', hint: 'VIX 가 50일 이동평균보다 높은가 낮은가' },
  { key: 'junk_bond_demand', label: '정크본드 수요', hint: '하이일드채와 우량채의 금리 차이' },
  { key: 'safe_haven_demand', label: '안전자산 선호', hint: '주식과 국채의 최근 20거래일 수익률 차이' },
];

const isScore = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
const epochDay = ms => Math.floor(ms / 86400000);

// CNN 은 timestamp 를 밀리초로 줍니다. 초 단위로 바뀌어도 읽히도록 폭을 둡니다.
function toMillis(ts) {
  const n = typeof ts === 'string' ? Number(ts) : ts;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e11 ? n * 1000 : n;   // 1e11 미만이면 초 단위로 봅니다
}

function pick(json, spec) {
  const node = json[spec.key] || (spec.alt ? json[spec.alt] : null);
  if (!node || !isScore(node.score)) return null;
  return {
    key: spec.key,
    label: spec.label,
    hint: spec.hint,
    score: Math.round(node.score),
    // rating(문자열)은 쓰지 않습니다. 화면의 구간 이름은 점수에서 다시 뽑습니다 —
    // 한국 탭과 같은 표를 써야 두 탭의 "탐욕"이 같은 뜻이 됩니다.
  };
}

function parse(json) {
  const head = json && json.fear_and_greed;
  if (!head || !isScore(head.score)) {
    throw new Error('fear_and_greed.score 를 찾지 못했습니다 (응답 모양이 바뀐 것 같습니다)');
  }

  const ms = toMillis(head.timestamp);
  if (ms == null) throw new Error('fear_and_greed.timestamp 를 읽지 못했습니다');
  const ageDays = (Date.now() - ms) / 86400000;
  if (ageDays > STALE_DAYS) {
    throw new Error(`받아온 값이 ${Math.floor(ageDays)}일 전 것입니다 — 갱신이 멈춘 응답으로 보고 쓰지 않습니다`);
  }

  const hist = (json.fear_and_greed_historical && json.fear_and_greed_historical.data) || [];
  const dates = [];
  const scores = [];
  for (const row of hist) {
    const t = toMillis(row && row.x);
    if (t == null || !isScore(row.y)) continue;
    dates.push(epochDay(t));
    scores.push(Math.round(row.y));
  }
  if (scores.length < 30) throw new Error(`이력이 ${scores.length}개뿐입니다 — 너무 짧아 쓰지 않습니다`);

  const components = COMPONENT_KEYS.map(spec => pick(json, spec)).filter(Boolean);
  if (components.length < 5) {
    throw new Error(`구성 요소를 ${components.length}개만 찾았습니다 (7개여야 합니다)`);
  }

  const prevOf = v => (isScore(v) ? Math.round(v) : null);

  return {
    fetchedAt: new Date().toISOString(),
    source: 'CNN Business Fear & Greed Index',
    sourceUrl: SOURCE_PAGE,
    updated: new Date(ms).toISOString().slice(0, 10),
    score: Math.round(head.score),
    prev: {
      d1: prevOf(head.previous_close),
      w1: prevOf(head.previous_1_week),
      m1: prevOf(head.previous_1_month),
      y1: prevOf(head.previous_1_year),
    },
    components,
    history: { dates, scores },
  };
}

async function main() {
  // 1년치를 달라고 시작 날짜를 붙입니다. 붙이지 않으면 최근 구간만 옵니다.
  const from = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const url = `${BASE}/${from}`;

  let json;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Referer: SOURCE_PAGE },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (err) {
    console.warn(`⚠️  CNN 지수를 받지 못했습니다: ${err.message}`);
    console.warn('   기존 data/cnn-fear-greed.json 을 그대로 둡니다 (화면은 지난 값으로 뜹니다).');
    return;
  }

  let out;
  try {
    out = parse(json);
  } catch (err) {
    console.warn(`⚠️  CNN 응답을 해석하지 못했습니다: ${err.message}`);
    console.warn('   기존 파일을 그대로 둡니다. 응답 모양이 바뀌었다면 COMPONENT_KEYS 를 확인하세요.');
    console.warn('   받은 응답의 최상위 키: ' + Object.keys(json || {}).join(', '));
    return;
  }

  console.log(`   CNN ${out.score}점 (기준일 ${out.updated}) · 구성 요소 ${out.components.length}개 · 이력 ${out.history.scores.length}일`);
  for (const c of out.components) console.log(`     ${c.label.padEnd(8)} ${String(c.score).padStart(3)}`);

  if (DRY_RUN) { console.log('   --dry-run: 파일을 쓰지 않았습니다.'); return; }
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  console.log('✅ data/cnn-fear-greed.json — ' + Math.round(fs.statSync(OUT_FILE).size / 1024) + 'KB');
}

if (require.main === module) main();

module.exports = { parse, COMPONENT_KEYS, STALE_DAYS };
