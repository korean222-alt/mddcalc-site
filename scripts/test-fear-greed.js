#!/usr/bin/env node
// 공포·탐욕 지수 계산 회귀 테스트 (한국 지수).   실행: node scripts/test-fear-greed.js
//
// 미국은 CNN 공식 값을 그대로 쓰므로 여기가 아니라 scripts/test-cnn-parse.js 가 지킵니다.
//
// 이 파일이 있는 이유:
//   0~100 짜리 심리 지표는 틀려도 화면에서 티가 나지 않습니다. 바늘이 어디를 가리키든
//   그럴듯해 보이기 때문입니다. 부호 하나가 뒤집혀 폭락장에 "극단적 탐욕"이 떠도 배포는
//   그대로 됩니다. 그래서 "답을 미리 아는" 합성 시장을 만들어 검사합니다.
//   test-sector-rs.js 와 같은 이유, 같은 방식입니다.
//
// 워크플로우에서 generate-fear-greed.js 보다 먼저 돌립니다.

const assert = require('assert');
const FG = require('./fear-greed');

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`✅ ${label}`); }
  catch (err) { console.error(`❌ ${label}\n   ${err.message}`); failed++; }
};

// ── 눈금 만들기 ───────────────────────────────────────────────────────
check('scale: 구간을 뒤집어 주면 방향도 뒤집힌다', () => {
  assert.strictEqual(FG.scale(0, 0, 10), 0);
  assert.strictEqual(FG.scale(10, 0, 10), 100);
  assert.strictEqual(FG.scale(10, 10, 0), 0);   // 클수록 나쁜 값(변동성)에 쓰는 형태
  assert.strictEqual(FG.scale(5, 0, 10), 50);
});

check('scale: 구간 밖은 0/100 으로 잘린다', () => {
  assert.strictEqual(FG.scale(-99, 0, 10), 0);
  assert.strictEqual(FG.scale(999, 0, 10), 100);
});

check('sma: 구간에 구멍이 있으면 null (0 으로 때우지 않는다)', () => {
  assert.strictEqual(FG.sma([1, 2, 3], 2, 3), 2);
  assert.strictEqual(FG.sma([1, null, 3], 2, 3), null);
  assert.strictEqual(FG.sma([1, 2, 3], 1, 3), null); // 표본 부족
});

check('realizedVol: 변동이 없으면 0, 클수록 커진다', () => {
  const flat = new Array(30).fill(100);
  assert.strictEqual(Math.round(FG.realizedVol(flat, 29, 20) * 1000), 0);
  const wiggly = Array.from({ length: 30 }, (_, i) => 100 * (1 + (i % 2 ? 0.03 : -0.03)));
  assert.ok(FG.realizedVol(wiggly, 29, 20) > 0.3, '흔들리는 시계열의 변동성이 너무 작습니다');
});

// ── z-점수 ────────────────────────────────────────────────────────────
check('zScoreAt: 값이 한 번도 변하지 않으면 null (0σ 는 뜻이 없다)', () => {
  const flat = new Array(100).fill(7);
  assert.strictEqual(FG.zScoreAt(flat, 99), null);
});

check('zScoreAt: 표본이 최소치보다 적으면 null', () => {
  const raw = Array.from({ length: 30 }, (_, i) => i);
  assert.strictEqual(FG.zScoreAt(raw, 29), null);
});

check('zScoreAt: 평균과 표준편차가 계산대로 나온다', () => {
  // 0~99 를 균등하게 늘어놓으면 평균 49.5, 표본표준편차 ≈ 29.01
  const raw = Array.from({ length: 100 }, (_, i) => i);
  const z = FG.zScoreAt(raw, 99);
  assert.strictEqual(z.n, 100);
  assert.strictEqual(z.mean, 49.5);
  assert.strictEqual(Math.round(z.std * 100), 2901);
  assert.strictEqual(Math.round(z.z * 100), Math.round(((99 - 49.5) / z.std) * 100));
});

check('scoreAt: 평소 수준이면 50점, ±2σ 가 0점과 100점', () => {
  const raw = Array.from({ length: 100 }, (_, i) => (i % 2 ? 1 : -1)); // 평균 0
  const z = FG.zScoreAt(raw, 99);
  assert.strictEqual(Math.round(FG.scale(0, -2, 2)), 50);
  assert.strictEqual(Math.round(FG.scale(2, -2, 2)), 100);
  assert.strictEqual(Math.round(FG.scale(-2, -2, 2)), 0);
  assert.ok(Math.abs(z.z) <= 2);
});

// ── 구성 요소 ─────────────────────────────────────────────────────────
// 각 구성 요소는 "클수록 탐욕"인 원시값을 냅니다. 그 방향이 뒤집히면 지수 전체가
// 거꾸로 도는데, 화면만 봐서는 절대 알 수 없습니다. 여기서 방향만큼은 확실히 못박습니다.
const spec = key => FG.COMPONENTS.find(c => c.key === key) || FG.EXTRAS.find(c => c.key === key);

const risingMarket = (n, rate) => {
  const bench = [];
  for (let i = 0; i < n; i++) bench.push(100 * Math.pow(1 + rate, i));
  return bench;
};

check('모멘텀: 이동평균 위면 양수, 아래면 음수', () => {
  const up = spec('momentum').raw({ bench: risingMarket(300, 0.002) }, 299);
  assert.ok(up.v > 0, `상승장인데 ${up.v}`);
  const down = spec('momentum').raw({ bench: risingMarket(300, -0.002) }, 299);
  assert.ok(down.v < 0, `하락장인데 ${down.v}`);
});

check('모멘텀: 이동평균을 채울 만큼 데이터가 없으면 null', () => {
  assert.strictEqual(spec('momentum').raw({ bench: risingMarket(50, 0.002) }, 49), null);
});

check('주가 강도: 신고가 종목이 많으면 양수, 신저가가 많으면 음수', () => {
  const up = { close: risingMarket(300, 0.003), volume: null, foreign: null };
  const down = { close: risingMarket(300, -0.003), volume: null, foreign: null };
  assert.ok(spec('strength').raw({ stocks: [up, up, up] }, 299).v > 0);
  assert.ok(spec('strength').raw({ stocks: [down, down, down] }, 299).v < 0);
});

check('주가 강도: 수록 종목 수로 나눈 비율이라 종목을 늘려도 눈금이 그대로다', () => {
  const up = { close: risingMarket(300, 0.003) };
  const a = spec('strength').raw({ stocks: [up, up] }, 299).v;
  const b = spec('strength').raw({ stocks: [up, up, up, up, up, up] }, 299).v;
  assert.strictEqual(Math.round(a), Math.round(b));
});

check('주가 폭: 거래대금이 오른 날에만 실리면 100 에 가깝다 (McClellan 과 같은 방향)', () => {
  // 하루 걸러 오르고 내리되, 오르는 날에만 거래량이 실린 시장.
  const close = [], volume = [];
  for (let i = 0; i < 40; i++) {
    close.push(i % 2 ? 110 : 100);
    volume.push(i % 2 ? 1000 : 1);
  }
  const v = spec('breadth').raw({ stocks: [{ close, volume }] }, 39).v;
  assert.ok(v > 90, `오른 날 거래대금 비중이 ${v}`);

  // 반대로 내린 날에만 실리면 0 쪽으로 가야 합니다.
  const volume2 = volume.map((x, i) => (i % 2 ? 1 : 1000));
  const v2 = spec('breadth').raw({ stocks: [{ close, volume: volume2 }] }, 39).v;
  assert.ok(v2 < 10, `내린 날에 실렸는데 ${v2}`);
});

check('시장 변동성: 평소보다 조용하면 양수, 요동치면 음수 (부호가 뒤집혀 있다)', () => {
  // vol20 은 생성기가 미리 만들어 넘기는 실현변동성 선입니다.
  const calm = new Array(60).fill(0.20);
  calm[59] = 0.10;                       // 마지막 날만 절반으로 잠잠
  assert.ok(spec('volatility').raw({ vol20: calm }, 59).v > 0);

  const wild = new Array(60).fill(0.20);
  wild[59] = 0.45;                       // 마지막 날만 폭증
  assert.ok(spec('volatility').raw({ vol20: wild }, 59).v < 0);
});

check('시장 변동성: 50일 평균을 채울 만큼 데이터가 없으면 null', () => {
  assert.strictEqual(spec('volatility').raw({ vol20: new Array(30).fill(0.2) }, 29), null);
});

check('안전자산 선호: 주식이 국채보다 앞서면 양수, 뒤지면 음수', () => {
  const up = risingMarket(40, 0.01);
  const flat = new Array(40).fill(100);
  assert.ok(spec('safehaven').raw({ bench: up, bond: flat }, 39).v > 0);
  assert.ok(spec('safehaven').raw({ bench: flat, bond: up }, 39).v < 0);
});

check('안전자산 선호: 국채 데이터가 없으면 null (다른 값으로 대신하지 않는다)', () => {
  assert.strictEqual(spec('safehaven').raw({ bench: risingMarket(40, 0.01), bond: null }, 39), null);
});

check('CNN 에 있는 지표만 점수에 들어간다', () => {
  const keys = FG.COMPONENTS.map(c => c.key).sort();
  assert.deepStrictEqual(keys, ['breadth', 'momentum', 'safehaven', 'strength', 'volatility']);
  // 다섯 개 모두 CNN 의 어느 지표에 대응하는지 이름을 달고 있어야 합니다.
  assert.ok(FG.COMPONENTS.every(c => typeof c.cnn === 'string' && c.cnn.length > 0));
});

check('외국인 수급은 참고 지표이고 점수에 들어가지 않는다', () => {
  assert.deepStrictEqual(FG.EXTRAS.map(c => c.key), ['foreign']);
  assert.ok(!FG.COMPONENTS.some(c => c.key === 'foreign'));

  const extra = FG.EXTRAS[0];
  const up = { close: [], foreign: Array.from({ length: 40 }, (_, i) => 30 + i * 0.1) };
  const down = { close: [], foreign: Array.from({ length: 40 }, (_, i) => 30 - i * 0.1) };
  assert.ok(extra.raw({ stocks: [up] }, 39).v > 0);
  assert.ok(extra.raw({ stocks: [down] }, 39).v < 0);
  assert.strictEqual(extra.raw({ stocks: [{ close: [], foreign: null }] }, 39), null);
});

// ── 합산과 구간 이름 ──────────────────────────────────────────────────
check('combine: 값이 없는 구성 요소는 빠지고, 하나도 없으면 null', () => {
  assert.strictEqual(FG.combine([80, null, 40]), 60);
  assert.strictEqual(FG.combine([null, null]), null);
  assert.strictEqual(FG.combine([]), null);
});

check('구간 이름: 경계값이 표와 정확히 맞는다', () => {
  const at = s => FG.band(s).label;
  assert.strictEqual(at(0), '극단적 공포');
  assert.strictEqual(at(24), '극단적 공포');
  assert.strictEqual(at(25), '공포');
  assert.strictEqual(at(44), '공포');
  assert.strictEqual(at(45), '중립');
  assert.strictEqual(at(55), '중립');
  assert.strictEqual(at(56), '탐욕');
  assert.strictEqual(at(74), '탐욕');
  assert.strictEqual(at(75), '극단적 탐욕');
  assert.strictEqual(at(100), '극단적 탐욕');
  assert.strictEqual(FG.band(null), null);
});

// ── 시장 전체를 흉내낸 검사 ───────────────────────────────────────────
// 부호가 하나라도 뒤집혀 있으면 여기서 잡힙니다. 폭락한 시장에 "탐욕"이 뜨면 실패합니다.
function syntheticMarket({ n, trend, vol, foreignTrend }) {
  // 지수는 종목 6개를 평균낸 것처럼 움직이고, 종목마다 추세와 물결의 위상이 다릅니다.
  // 6종목이 완전히 똑같이 움직이면 "50일선 위 비율"과 "52주 신고가 종목 수"가 늘 0% 아니면
  // 100% 라 표준편차가 0 이 되고, 그 두 구성 요소가 검사에서 통째로 빠져 버립니다.
  const stocks = [];
  for (let j = 0; j < 6; j++) {
    const close = [], volume = [], foreign = [];
    let price = 100 + j * 10;
    for (let i = 0; i < n; i++) {
      const wave = Math.sin(i / 3 + j) * vol + Math.sin(i / 41 + j * 2) * vol * 3;
      price = price * (1 + trend * (j % 3 === 0 ? -0.4 : 1) + wave);
      close.push(price);
      volume.push(1000 * (1 + 0.5 * Math.sin(i / 5 + j)) * (wave > 0 ? 2 : 1));
      foreign.push(30 + i * foreignTrend + Math.sin(i / 7 + j) * 0.3);
    }
    stocks.push({ close, volume, foreign });
  }

  const bench = [];
  for (let i = 0; i < n; i++) bench.push(stocks.reduce((a, s) => a + s.close[i], 0) / stocks.length);

  // 국채는 주식과 상관없이 아주 완만하게 오르는 선으로 둡니다.
  const bond = [];
  for (let i = 0; i < n; i++) bond.push(100 * (1 + 0.0001 * i));

  return {
    bench,
    benchName: '합성지수',
    bondName: '합성국채',
    stocks,
    bond,
    vol20: bench.map((_, at) => FG.realizedVol(bench, at, 20)),
  };
}

// 한 시장의 전체 이력을 계산해 마지막 날 점수를 냅니다 (generate-fear-greed.js 와 같은 절차).
function scoreLast(ctx, n) {
  const scores = FG.COMPONENTS
    .map(spec => {
      const values = [];
      for (let at = 0; at < n; at++) {
        const r = spec.raw(ctx, at);
        values.push(r ? r.v : null);
      }
      return FG.scoreAt(values, n - 1);
    })
    .filter(s => s != null);
  return { score: FG.combine(scores), used: scores.length };
}

check('합성 시장: 조용히 오르던 시장이 급락하면 점수가 크게 떨어진다', () => {
  const n = 520;
  const calm = syntheticMarket({ n, trend: 0.001, vol: 0.004, foreignTrend: 0.01 });
  const before = scoreLast(calm, n);

  // 같은 시장의 마지막 30일만 급락 + 변동성 폭증 + 외국인 이탈로 갈아끼웁니다.
  const crash = syntheticMarket({ n, trend: 0.001, vol: 0.004, foreignTrend: 0.01 });
  for (let i = n - 30; i < n; i++) {
    const factor = 1 + (i % 2 ? -0.05 : -0.03);
    for (const s of crash.stocks) {
      s.close[i] = s.close[i - 1] * factor;
      s.foreign[i] = s.foreign[i - 1] - 0.05;
    }
    crash.bench[i] = crash.stocks.reduce((a, s) => a + s.close[i], 0) / crash.stocks.length;
    crash.bond[i] = crash.bond[i - 1] * 1.002;   // 겁이 나면 돈은 채권으로 갑니다
  }
  // 벤치마크를 갈아끼웠으니 변동성 선도 다시 만듭니다.
  crash.vol20 = crash.bench.map((_, at) => FG.realizedVol(crash.bench, at, 20));
  const after = scoreLast(crash, n);

  assert.strictEqual(before.used, FG.COMPONENTS.length,
    `구성 요소 ${FG.COMPONENTS.length}개 중 ${before.used}개만 계산됐습니다`);
  assert.ok(after.score < before.score - 20,
    `급락 뒤 점수가 충분히 떨어지지 않았습니다 (${before.score} → ${after.score})`);
  assert.ok(after.score < 40, `급락한 시장의 점수가 ${after.score} 입니다`);
});

check('합성 시장: 데이터가 짧으면 점수를 내지 않는다 (0 이나 50 이 아니라 null)', () => {
  const short = syntheticMarket({ n: 40, trend: 0.001, vol: 0.004, foreignTrend: 0.01 });
  assert.strictEqual(scoreLast(short, 40).score, null);
});

console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);
