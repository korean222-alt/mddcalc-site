#!/usr/bin/env node
// CNN 공포·탐욕 지수 응답 파서 테스트.   실행: node scripts/test-cnn-parse.js
//
// 이 파일이 있는 이유:
//   CNN 이 자기 차트에 쓰는 엔드포인트라 공식 문서가 없고, 예고 없이 모양이 바뀔 수 있습니다.
//   그때 우리가 해야 할 일은 "이상한 값을 화면에 올리는 것"이 아니라 "쓰지 않고 지난 값을
//   지키는 것"입니다. 그 판단이 정확히 되는지를 픽스처로 고정해 둡니다.
//   test-kr-parse.js 와 같은 이유, 같은 방식입니다.

const assert = require('assert');
const { parse } = require('./fetch-cnn-fear-greed');

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`✅ ${label}`); }
  catch (err) { console.error(`❌ ${label}\n   ${err.message}`); failed++; }
};

const now = Date.now();
const day = 86400000;

// 실제 응답 모양을 줄여 옮긴 픽스처입니다.
function fixture(over = {}) {
  const hist = [];
  for (let i = 200; i >= 0; i--) hist.push({ x: now - i * day, y: 50 + (i % 20), rating: 'neutral' });
  const comp = s => ({ timestamp: now, score: s, rating: 'neutral' });
  return {
    fear_and_greed: {
      score: 63.4, rating: 'greed', timestamp: now,
      previous_close: 60.1, previous_1_week: 55.2, previous_1_month: 41.9, previous_1_year: 70.3,
    },
    fear_and_greed_historical: { timestamp: now, score: 63.4, rating: 'greed', data: hist },
    market_momentum_sp500: comp(70),
    market_momentum_sp125: comp(72),
    stock_price_strength: comp(80),
    stock_price_breadth: comp(55),
    put_call_options: comp(44),
    market_volatility_vix: comp(30),
    market_volatility_vix_50: comp(33),
    junk_bond_demand: comp(88),
    safe_haven_demand: comp(61),
    ...over,
  };
}

check('정상 응답: 점수·기준일·이력·구성 요소를 뽑는다', () => {
  const out = parse(fixture());
  assert.strictEqual(out.score, 63);                    // 반올림
  assert.strictEqual(out.components.length, 7);
  assert.strictEqual(out.history.scores.length, 201);
  assert.strictEqual(out.updated, new Date(now).toISOString().slice(0, 10));
  assert.deepStrictEqual(out.prev, { d1: 60, w1: 55, m1: 42, y1: 70 });
});

check('모멘텀·변동성은 CNN 화면과 같은 쪽(125일선·VIX 50일선)을 쓴다', () => {
  const out = parse(fixture());
  const by = Object.fromEntries(out.components.map(c => [c.label, c.score]));
  assert.strictEqual(by['시장 모멘텀'], 72);   // sp125 (sp500 은 70)
  assert.strictEqual(by['시장 변동성'], 33);   // vix_50 (vix 는 30)
});

check('그 키가 없으면 대체 키로 넘어간다', () => {
  const f = fixture();
  delete f.market_momentum_sp125;
  delete f.market_volatility_vix_50;
  const by = Object.fromEntries(parse(f).components.map(c => [c.label, c.score]));
  assert.strictEqual(by['시장 모멘텀'], 70);
  assert.strictEqual(by['시장 변동성'], 30);
});

check('이력의 날짜는 에포크 일수로, 우리 데이터와 같은 단위로 바뀐다', () => {
  const out = parse(fixture());
  assert.strictEqual(out.history.dates.at(-1), Math.floor(now / day));
  assert.ok(out.history.dates.every(Number.isInteger));
});

check('timestamp 가 초 단위로 와도 읽는다', () => {
  const f = fixture();
  f.fear_and_greed.timestamp = Math.floor(now / 1000);
  assert.strictEqual(parse(f).updated, new Date(now).toISOString().slice(0, 10));
});

// ── 여기부터는 "쓰지 않고 거절해야 하는" 경우들입니다 ──────────────────
const rejects = (label, over, expect) => check(label, () => {
  assert.throws(() => parse(fixture(over)), new RegExp(expect));
});

rejects('점수가 없으면 거절한다', { fear_and_greed: { timestamp: now } }, 'score');
rejects('점수가 범위를 벗어나면 거절한다', { fear_and_greed: { score: 480, timestamp: now } }, 'score');
rejects('점수가 문자열이면 거절한다', { fear_and_greed: { score: '63', timestamp: now } }, 'score');
rejects('오래된 값이면 거절한다 (갱신이 멈춘 응답)', {
  fear_and_greed: { score: 63, timestamp: now - 30 * day },
}, '일 전 것');
rejects('이력이 너무 짧으면 거절한다', {
  fear_and_greed_historical: { data: [{ x: now, y: 63 }] },
}, '이력이');

check('구성 요소가 절반 넘게 사라지면 거절한다', () => {
  const f = fixture();
  for (const k of ['stock_price_strength', 'stock_price_breadth', 'put_call_options',
                   'junk_bond_demand', 'safe_haven_demand']) delete f[k];
  assert.throws(() => parse(f), /구성 요소를/);
});

check('구성 요소 하나가 깨져 있어도 나머지는 살린다', () => {
  const f = fixture();
  f.put_call_options = { timestamp: now, rating: 'fear' };   // score 없음
  const out = parse(f);
  assert.strictEqual(out.components.length, 6);
  assert.ok(!out.components.some(c => c.label === '풋/콜 옵션'));
});

check('이력 중간의 깨진 행은 건너뛴다', () => {
  const f = fixture();
  f.fear_and_greed_historical.data[5] = { x: null, y: 'oops' };
  const out = parse(f);
  assert.strictEqual(out.history.scores.length, 200);
});

console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);
