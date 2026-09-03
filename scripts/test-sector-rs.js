#!/usr/bin/env node
// 섹터 RS 계산 회귀 테스트.   실행: node scripts/test-sector-rs.js
//
// 이 파일이 있는 이유:
//   RS·순위·거래대금 비중은 눈으로 봐서 틀린 걸 알 수 없는 숫자들입니다. 화면에 그럴듯한
//   막대가 그려지면 계산이 뒤집혀 있어도 그대로 배포됩니다. 그래서 "답을 미리 아는" 합성
//   시계열을 넣고 검사합니다. test-kr-parse.js 와 같은 이유, 같은 방식입니다.
//
// 워크플로우에서 generate-sector-rs.js 보다 먼저 돌립니다.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  equalWeightIndex, alignForward, periodReturn, toRatings, buildMarket,
  turnoverMultiple, turnoverDirection, quadrantOf, weekStart,
} = require('./generate-sector-rs');

const ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = '__sector_test__';
const FIXTURE_PATH = path.join(ROOT, 'data', FIXTURE_DIR);

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`✅ ${label}`); }
  catch (err) { console.error(`❌ ${label}\n   ${err.message}`); failed++; }
};

// ── 순수 함수 ────────────────────────────────────────────────────────
check('동일가중 지수: 두 배 오르면 +100%', () => {
  const idx = equalWeightIndex([[100, 150, 200]]);
  assert.strictEqual(Math.round(periodReturn(idx, 2)), 100);
});

check('동일가중 지수: +100%와 0%를 섞으면 +50% 부근', () => {
  const idx = equalWeightIndex([[100, 200], [50, 50]]);
  assert.strictEqual(Math.round(periodReturn(idx, 1)), 50);
});

check('동일가중 지수: 큰 종목 하나가 지수를 지배하지 않는다', () => {
  // 주가 수준이 100배 달라도 수익률만 쓰므로 기여도는 같아야 합니다.
  const a = equalWeightIndex([[1000000, 1100000], [10, 10]]);
  const b = equalWeightIndex([[10, 11], [1000000, 1000000]]);
  assert.strictEqual(Math.round(periodReturn(a, 1) * 100), Math.round(periodReturn(b, 1) * 100));
});

check('동일가중 지수: 상장 전(null) 멤버는 지수를 흔들지 않는다', () => {
  // 두 번째 멤버는 마지막 날에야 등장합니다. 등장하는 날 지수가 튀면 안 됩니다.
  const idx = equalWeightIndex([[100, 110, 121], [null, null, 500]]);
  assert.strictEqual(Math.round(periodReturn(idx, 2)), 21);
});

check('동일가중 지수: 결측일이 있어도 그날 나머지 멤버 평균만 쓴다', () => {
  const idx = equalWeightIndex([[100, 110], [200, null]]);
  assert.strictEqual(Math.round(periodReturn(idx, 1)), 10);
});

check('periodReturn: 데이터보다 긴 기간을 요구하면 null', () => {
  assert.strictEqual(periodReturn([100, 110], 5), null);
});

check('alignForward: 거래 없는 날은 마지막 종가를 잇고, 상장 전은 null', () => {
  const series = { dates: [10, 12], close: new Map([[10, 100], [12, 120]]) };
  // 11 은 시세 사이의 구멍이라 앞 값으로 메우고, 13 은 시세가 끝난 뒤라 null 입니다.
  assert.deepStrictEqual(alignForward(series, [9, 10, 11, 12, 13]), [null, 100, 100, 120, null]);
});

check('alignForward: 시세가 끝난 뒤로는 연장하지 않는다', () => {
  const series = { dates: [10], close: new Map([[10, 100]]) };
  assert.deepStrictEqual(alignForward(series, [10, 11, 12]), [100, null, null]);
});

check('상장폐지된 멤버가 섹터 수익률을 끌어당기지 않는다', () => {
  // 살아 있는 종목은 100 → 50 (-50%). 죽은 종목은 첫날 이후 시세가 없습니다.
  // 연장해서 "매일 0%"로 남기면 섹터가 -25% 로 보여, 실제보다 덜 빠진 것처럼 보입니다.
  const alive = { dates: [1, 2, 3], close: new Map([[1, 100], [2, 75], [3, 50]]) };
  const dead = { dates: [1], close: new Map([[1, 100]]) };
  const axis = [1, 2, 3];
  const idx = equalWeightIndex([alignForward(alive, axis), alignForward(dead, axis)]);
  assert.strictEqual(Math.round(periodReturn(idx, 2)), -50);
});

check('RS Rating: 최고 99, 최저 1', () => {
  const r = toRatings([-5, 0, 10]);
  assert.deepStrictEqual(r, [1, 50, 99]);
});

check('RS Rating: null 은 순위에서 빠지고 null 로 남는다', () => {
  const r = toRatings([10, null, -5]);
  assert.deepStrictEqual(r, [99, null, 1]);
});

check('RS Rating: 섹터가 하나뿐이면 50', () => {
  assert.deepStrictEqual(toRatings([7]), [50]);
});

// ── 거래대금 배율 ────────────────────────────────────────────────────
check('거래대금 배율: 평소의 두 배면 2.0', () => {
  // 앞 250일은 100, 마지막 20일은 200. 20일 창의 배율이 정확히 2 여야 합니다.
  const turn = [...Array(250).fill(100), ...Array(20).fill(200)];
  assert.strictEqual(turnoverMultiple(turn, turn.length - 1, 20), 2);
});

check('거래대금 배율: 축이 모자라면 null (0 으로 때우지 않는다)', () => {
  // 분모 구간(직전 250일)이 축 밖으로 나갑니다. 0 으로 채우면 배율이 무한대가 됩니다.
  assert.strictEqual(turnoverMultiple(Array(30).fill(100), 29, 20), null);
});

check('거래대금 배율: 평소가 0 이면 null', () => {
  const turn = [...Array(250).fill(0), ...Array(20).fill(500)];
  assert.strictEqual(turnoverMultiple(turn, turn.length - 1, 20), null);
});

// ── 매집·분산 방향 ───────────────────────────────────────────────────
check('방향: 거래가 오르는 날에만 몰리면 heavy > light, flowRatio 양수', () => {
  // 지수는 하루 걸러 오르내리고, 오르는 날에만 거래가 10배 터집니다.
  const idx = [100];
  const turn = [0];
  for (let i = 1; i <= 60; i++) {
    const up = i % 2 === 1;
    idx.push(idx[i - 1] * (up ? 1.02 : 0.99));
    turn.push(up ? 1000 : 100);
  }
  const d = turnoverDirection(idx, turn, idx.length - 1, 60);
  assert.ok(d.heavyRet > d.lightRet, `heavy ${d.heavyRet} light ${d.lightRet}`);
  assert.ok(d.flowRatio > 0, `flowRatio ${d.flowRatio}`);
});

check('방향: 거래가 빠지는 날에만 몰리면 부호가 뒤집힌다', () => {
  const idx = [100];
  const turn = [0];
  for (let i = 1; i <= 60; i++) {
    const up = i % 2 === 1;
    idx.push(idx[i - 1] * (up ? 1.02 : 0.99));
    turn.push(up ? 100 : 1000);   // 내리는 날에 거래가 터집니다
  }
  const d = turnoverDirection(idx, turn, idx.length - 1, 60);
  assert.ok(d.heavyRet < d.lightRet, `heavy ${d.heavyRet} light ${d.lightRet}`);
  assert.ok(d.flowRatio < 0, `flowRatio ${d.flowRatio}`);
});

check('방향: 창이 20거래일보다 짧으면 계산하지 않는다', () => {
  // 1일·1주 창에서 "거래가 터진 날"을 고르는 것은 표본이 1~5개라 뜻이 없습니다.
  const idx = Array.from({ length: 60 }, (_, i) => 100 + i);
  const turn = Array(60).fill(100);
  assert.strictEqual(turnoverDirection(idx, turn, 59, 1), null);
  assert.strictEqual(turnoverDirection(idx, turn, 59, 5), null);
  assert.ok(turnoverDirection(idx, turn, 59, 20) != null);
});

// ── 주 경계 ──────────────────────────────────────────────────────────
// 거래대금 추이의 주별 막대가 이 함수 하나에 걸려 있습니다. 하루라도 어긋나면 막대가
// 엉뚱한 주에 얹히는데, 화면에서는 그냥 그럴듯한 막대로 보입니다.
check('weekStart: 에포크일을 그 주 월요일로 내린다', () => {
  const mon = Math.round(Date.UTC(2026, 7, 31) / 86400000);   // 2026-08-31 월요일
  assert.strictEqual(new Date(mon * 86400000).getUTCDay(), 1, '기준일이 월요일이어야 합니다');
  for (let i = 0; i < 7; i++) assert.strictEqual(weekStart(mon + i), mon, `${i}일 뒤`);
  assert.strictEqual(weekStart(mon + 7), mon + 7);
  assert.strictEqual(weekStart(mon - 1), mon - 7);
});

// ── 4분면 ────────────────────────────────────────────────────────────
check('4분면: 거래·강도 조합이 네 이름으로 갈린다', () => {
  assert.strictEqual(quadrantOf(2.0, 5), 'lead');    // 거래 ↑ 강함 ↑
  assert.strictEqual(quadrantOf(2.0, -5), 'churn');  // 거래 ↑ 약함 ↓
  assert.strictEqual(quadrantOf(0.5, 5), 'quiet');   // 거래 ↓ 강함 ↑
  assert.strictEqual(quadrantOf(0.5, -5), 'cold');   // 거래 ↓ 약함 ↓
});

check('4분면: 벤치마크와 비기면(alpha 0) 이름을 붙이지 않는다', () => {
  // 약한 쪽으로 넣으면 "가격은 시장에 뒤집니다"가 비긴 섹터에 붙습니다.
  assert.strictEqual(quadrantOf(2.0, 0), null);
  assert.strictEqual(quadrantOf(0.5, 0), null);
});

check('4분면: 문턱 안(0.85~1.15배)은 이름을 붙이지 않는다', () => {
  // 1.02 배를 "유입"이라 부르면 아무 일 없는 날에도 화면이 매일 다른 말을 합니다.
  assert.strictEqual(quadrantOf(1.02, 5), null);
  assert.strictEqual(quadrantOf(0.9, -5), null);
  assert.strictEqual(quadrantOf(null, 5), null);
  assert.strictEqual(quadrantOf(2.0, null), null);
});

// ── 갱신 시각 안내가 실제 cron 과 같은가 ──────────────────────────────
// 화면의 "다음 자동 갱신 …" 문구는 sectors.js 의 REFRESH_SCHEDULE 에서 나옵니다.
// 워크플로우 cron 만 고치고 이쪽을 잊으면, 화면이 오지 않을 시각을 계속 안내합니다.
// 그건 눈으로 볼 수 없는 종류의 거짓말이라 여기서 잡습니다.
check('안내하는 갱신 시각이 워크플로우 cron 과 일치한다', () => {
  const { REFRESH_SCHEDULE } = require('./sectors');
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/refresh-kr-data.yml'), 'utf8');
  const inYml = [...yml.matchAll(/^\s*-\s*cron:\s*'([^']+)'/gm)].map(m => m[1]);
  const declared = REFRESH_SCHEDULE.runs.map(r => r.cron);
  assert.deepStrictEqual(declared, inYml,
    `sectors.js: ${declared.join(' | ')} / 워크플로우: ${inYml.join(' | ')}`);

  // cron 문자열과 화면 계산용 숫자(hourUtc·minuteUtc·daysUtc)도 서로 맞아야 합니다.
  for (const r of REFRESH_SCHEDULE.runs) {
    const [min, hour, , , dow] = r.cron.split(/\s+/);
    assert.strictEqual(Number(min), r.minuteUtc, r.cron);
    assert.strictEqual(Number(hour), r.hourUtc, r.cron);
    const [from, to] = dow.split('-').map(Number);
    const days = [];
    for (let d = from; d <= (Number.isFinite(to) ? to : from); d++) days.push(d);
    assert.deepStrictEqual(r.daysUtc, days, r.cron);
  }
});

// ── 시장·섹터 정의 ────────────────────────────────────────────────────
check('모든 시장의 구성 종목이 수집 목록 안에 있다', () => {
  const { MARKETS, SECTOR_DEFS, usSymbols, US_NAMES } = require('./sectors');
  const { KR_TICKERS } = require('./kr-tickers');
  const known = { kr: new Set(KR_TICKERS.map(t => t.code)), us: new Set(usSymbols()) };
  const bad = [];
  for (const m of MARKETS) {
    assert.ok(SECTOR_DEFS[m.key], `${m.key} 섹터 정의 없음`);
    for (const s of SECTOR_DEFS[m.key]) {
      assert.ok(s.codes.length > 0, `${m.key}/${s.name} 이 비어 있습니다`);
      for (const c of s.codes) if (!known[m.dir].has(c)) bad.push(`${m.key}/${s.name}/${c}`);
    }
  }
  assert.deepStrictEqual(bad, []);
  // 이름표가 없으면 화면에 티커가 그대로 나옵니다. 죽을 일은 아니지만 티가 나므로 막습니다.
  assert.deepStrictEqual(usSymbols().filter(s => !US_NAMES[s]), []);
});

check('섹터 키가 시장 안에서 겹치지 않는다', () => {
  const { MARKETS, SECTOR_DEFS } = require('./sectors');
  for (const m of MARKETS) {
    const keys = SECTOR_DEFS[m.key].map(s => s.key);
    assert.strictEqual(new Set(keys).size, keys.length, `${m.key} 에 중복 키가 있습니다`);
  }
});

// ── 합성 데이터로 전체 파이프라인 ──────────────────────────────────────
// 답을 미리 정해 둔 세 섹터를 만들고 buildMarket 을 그대로 통과시킵니다.
const N = 300;
const DAY0 = 20000;
const axis = Array.from({ length: N }, (_, i) => DAY0 + i);

function writeFixture(code, { closeAt, volumeAt, foreignAt }) {
  const d = axis.slice();
  const c = d.map((_, i) => closeAt(i));
  const v = d.map((_, i) => (volumeAt ? volumeAt(i) : 1000));
  const payload = { code, symbol: code, name: code, market: 'KS', currency: 'KRW', d, h: c, c, v };
  if (foreignAt) payload.f = d.map((_, i) => foreignAt(i));
  fs.writeFileSync(path.join(FIXTURE_PATH, `${code}.json`), JSON.stringify(payload));
}

try {
  fs.mkdirSync(FIXTURE_PATH, { recursive: true });

  writeFixture('KS11', { closeAt: () => 100 });                          // 벤치마크: 완전 횡보
  writeFixture('UP1', { closeAt: i => 100 * (1 + i / N) });              // 우상향
  writeFixture('UP2', { closeAt: i => 100 * (1 + i / N) });
  writeFixture('FLAT', { closeAt: () => 100, foreignAt: i => 30 + i / 100 }); // 외국인 소진율 상승
  writeFixture('DOWN', {
    closeAt: i => 100 * (1 - i / (N * 2)),
    volumeAt: i => (i > N - 30 ? 100000 : 1000),                          // 최근 거래대금 급증
  });

  const defs = [
    { key: 'up', name: '상승', codes: ['UP1', 'UP2'] },
    { key: 'flat', name: '횡보', codes: ['FLAT'] },
    { key: 'down', name: '하락', codes: ['DOWN'] },
  ];
  const built = buildMarket('KR', FIXTURE_DIR, defs, m => m.name);
  const market = built.market;
  const by = Object.fromEntries(market.sectors.map(s => [s.key, s]));

  check('벤치마크가 횡보면 알파 = 수익률', () => {
    const p = by.up.periods['1m'];
    assert.strictEqual(p.ret, p.alpha);
  });

  check('가장 강한 섹터 99, 가장 약한 섹터 1', () => {
    assert.strictEqual(by.up.periods['3m'].rating, 99);
    assert.strictEqual(by.down.periods['3m'].rating, 1);
  });

  check('오르는 섹터의 RS 선은 100 위에서 끝난다', () => {
    const rs = by.up.rs;
    assert.strictEqual(rs[0], 100);
    assert.ok(rs[rs.length - 1] > 100, `마지막 RS ${rs[rs.length - 1]}`);
    assert.ok(by.down.rs[by.down.rs.length - 1] < 100);
  });

  check('거래대금이 몰린 섹터의 비중 변화가 양수', () => {
    assert.ok(by.down.periods['1m'].turnShareChg > 0, `${by.down.periods['1m'].turnShareChg}`);
    assert.ok(by.up.periods['1m'].turnShareChg < 0, '몰린 쪽이 있으면 나머지는 비중이 준다');
  });

  check('비중 합계는 100%', () => {
    const sum = market.sectors.reduce((a, s) => a + s.periods['1m'].turnShare, 0);
    assert.ok(Math.abs(sum - 100) < 0.05, `합계 ${sum}`);
  });

  check('외국인소진율: 값이 있는 섹터만 숫자, 없으면 null', () => {
    assert.ok(by.flat.periods['1m'].foreignChg > 0, `${by.flat.periods['1m'].foreignChg}`);
    assert.strictEqual(by.up.periods['1m'].foreign, null);
    assert.strictEqual(by.up.periods['1m'].foreignChg, null);
  });

  check('구성 종목 수익률이 들어 있다', () => {
    assert.strictEqual(by.up.members.length, 2);
    assert.ok(by.up.members[0].ret['3m'] > 0);
  });

  check('구성 종목 수익률은 종가에서 바로 구한다 (지수 경유 아님)', () => {
    // UP1 은 창 전체에서 100 → 200 이므로 12개월(250일) 수익률이 계산 가능해야 하고,
    // 축 길이(300)보다 긴 구간을 요구하면 null 이어야 합니다.
    const m = by.up.members.find(x => x.name === 'UP1');
    assert.ok(m.ret['12m'] > 0, `12m ${m.ret['12m']}`);
    const expected = Math.round((((100 * (1 + 299 / 300)) / (100 * (1 + 49 / 300))) - 1) * 100);
    assert.strictEqual(Math.round(m.ret['12m']), expected);
  });

  check('거래대금 배율: 최근 거래가 급증한 섹터만 배율이 뛴다', () => {
    // DOWN 은 마지막 30일 거래량이 100배입니다. FLAT 은 종가도 거래량도 내내 그대로라
    // 배율이 정확히 1.0 이어야 합니다.
    assert.ok(by.down.periods['1m'].turnMult > 10, `DOWN ${by.down.periods['1m'].turnMult}`);
    assert.strictEqual(by.flat.periods['1m'].turnMult, 1);
  });

  check('거래대금 배율은 거래량이 아니라 거래대금을 본다', () => {
    // UP 은 거래량이 한 번도 변한 적 없지만 주가가 오릅니다. 거래대금 = 가격 × 거래량
    // 이므로 배율은 1 이 아니라 그 가격 상승분만큼 올라야 맞습니다.
    // (이걸 1 로 만들려면 거래량을 세야 하는데, 그러면 "10만원짜리 100주"와
    //  "1000원짜리 100주"가 같은 크기가 됩니다 — 수급을 보는 데 쓸 수 없습니다.)
    assert.ok(by.up.periods['1m'].turnMult > 1.2, `${by.up.periods['1m'].turnMult}`);
  });

  check('거래대금 배율은 비중과 다른 것을 본다', () => {
    // FLAT 은 거래대금이 한 번도 변한 적 없지만, DOWN 이 폭증하면서 비중은 밀립니다.
    // 배율이 1 인데 비중이 줄었다면 "내가 식은 게 아니라 남이 뜨거워진 것"입니다.
    // 비중만 보고 수급을 읽으면 안 되는 이유가 정확히 이 자리입니다.
    const p = by.flat.periods['1m'];
    assert.ok(p.turnShareChg < 0, `비중 변화 ${p.turnShareChg}`);
    assert.strictEqual(p.turnMult, 1);
  });

  check('4분면: 거래가 터지면서 하락하는 섹터는 손바뀜', () => {
    assert.strictEqual(by.down.periods['1m'].quadrant, 'churn');
  });

  check('방향 지표는 1일·1주에는 없고 1개월부터 있다', () => {
    assert.strictEqual(by.down.periods['1d'].heavyRet, null);
    assert.strictEqual(by.down.periods['1w'].flowRatio, null);
    assert.ok(by.down.periods['1m'].heavyRet != null);
    assert.ok(by.down.periods['1m'].flowRatio != null);
  });

  check('하루 평균 거래대금이 백만 단위로 담긴다', () => {
    // FLAT 은 종가 100, 거래량 1000 → 하루 10만. 백만 단위로는 0 입니다.
    // 0 과 null 은 다릅니다 — 거래가 작은 것과 값이 없는 것을 섞으면 안 됩니다.
    assert.strictEqual(by.flat.periods['1m'].turnAvgM, 0);
    assert.ok(by.down.periods['1m'].turnAvgM > 0, `${by.down.periods['1m'].turnAvgM}`);
  });

  check('구성 종목에도 배율과 외국인 변화가 붙는다', () => {
    const flat = by.flat.members[0];
    assert.ok(flat.mult['1m'] != null, '멤버 배율이 없습니다');
    assert.ok(flat.fChg['1m'] > 0, `멤버 외국인 변화 ${flat.fChg['1m']}`);
  });

  check('외국인 데이터가 없는 시장에는 fChg 키 자체가 없다', () => {
    // 값이 전부 null 인 키를 6기간씩 담으면 파일만 17KB 커지고 화면은 아무것도 못 그립니다.
    // 벤치마크는 픽스처에 있는 KS11 을 써야 하므로 시장 키는 KR 그대로 두고,
    // hasForeign 만 꺼서 넘깁니다.
    const noForeign = buildMarket('KR', FIXTURE_DIR, [{ key: 'flat', name: '횡보', codes: ['FLAT'] }],
      m => m.name, { label: '테스트', hasForeign: false });
    const mem = noForeign.market.sectors[0].members[0];
    assert.strictEqual('fChg' in mem, false);
    assert.ok('mult' in mem, '배율은 그대로 있어야 합니다');
  });

  // ── 장중 수집 감지 ──────────────────────────────────────────────────
  // 실제로 걸렸던 문제입니다. 한국 수집이 장 마감 전에 돌면 마지막 봉의 거래량이
  // 하루치가 아니라 그때까지의 누적이고, 그대로 계산하면 "거래대금이 평소의 0.09배"
  // 라는 틀린 문장이 화면에 나옵니다.
  check('마지막 봉이 장중이면 1일 거래대금 지표를 내놓지 않는다', () => {
    const dir = FIXTURE_DIR + '2';
    const dirPath = path.join(ROOT, 'data', dir);
    fs.mkdirSync(dirPath, { recursive: true });
    try {
      const write = (code, volumeAt) => {
        const c = axis.map(() => 100);
        fs.writeFileSync(path.join(dirPath, `${code}.json`), JSON.stringify({
          code, symbol: code, name: code, market: 'KS', currency: 'KRW',
          d: axis.slice(), h: c, c, v: axis.map((_, i) => volumeAt(i)),
        }));
      };
      write('KS11', () => 1000);
      // 마지막 하루만 평소의 5% — 장중에 받아온 봉입니다.
      write('A', i => (i === axis.length - 1 ? 50 : 1000));

      const { market } = buildMarket('KR', dir, [{ key: 'a', name: 'A', codes: ['A'] }], m => m.name);
      assert.ok(market.partialLast != null && market.partialLast < 0.6, `partialLast ${market.partialLast}`);
      assert.strictEqual(market.sectors[0].periods['1d'].turnMult, null);
      assert.strictEqual(market.sectors[0].periods['1d'].turnAvgM, null);
      assert.strictEqual(market.sectors[0].members[0].mult['1d'], null);
      // 기간이 길면 한 봉의 몫이 작아지므로 그대로 둡니다.
      assert.ok(market.sectors[0].periods['1m'].turnMult != null, '1개월은 살아 있어야 합니다');
    } finally {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  });

  check('거래량이 정상이면 장중으로 오인하지 않는다', () => {
    // FLAT·UP·DOWN 픽스처의 마지막 봉은 멀쩡합니다. 여기서 partialLast 가 잡히면
    // 매일 멀쩡한 데이터에 "아직 덜 찼습니다" 경고가 붙습니다.
    assert.strictEqual(market.partialLast, null);
    assert.ok(by.flat.periods['1d'].turnMult != null);
  });

  // ── 거래대금 추이 (data/sector-flow.json) ───────────────────────────
  // 화면이 이 배열 위에 막대를 그립니다. 길이가 하루 어긋나거나 방향 문자가 뒤집혀도
  // 막대는 똑같이 그럴듯하게 그려지므로, 눈으로는 잘못을 알 수 없습니다.
  check('추이: 섹터마다 날짜·거래대금·방향 길이가 같다', () => {
    const f = built.flow;
    assert.ok(f && f.dates.length > 0, '추이가 비어 있습니다');
    for (const [key, sec] of Object.entries(f.sectors)) {
      assert.strictEqual(sec.t.length, f.dates.length, `${key} 거래대금 길이`);
      assert.strictEqual(sec.dir.length, f.dates.length, `${key} 방향 길이`);
    }
    assert.deepStrictEqual(Object.keys(f.sectors).sort(), ['down', 'flat', 'up']);
  });

  check('추이: 창은 주 경계에서 시작한다 (잘린 첫 주를 버린다)', () => {
    // 첫날 바로 앞 거래일이 같은 주에 있으면, 첫 주가 잘린 채로 시작한 것입니다.
    // 그 상태로 주별 막대를 그리면 첫 막대만 하루이틀짜리로 짧게 나옵니다.
    const first = built.flow.dates[0];
    const axisAll = market.dates;   // RS 선과 같은 창(250일). 그 앞 축은 여기 없습니다.
    assert.ok(first >= axisAll[0], '추이 창이 RS 창보다 앞설 수 없습니다');
    assert.strictEqual(weekStart(first - 1), weekStart(first) - 7, '첫날이 그 주의 첫 거래일이 아닙니다');
  });

  check('추이: 마지막 날짜가 RS 창의 마지막 날과 같다', () => {
    const f = built.flow;
    assert.strictEqual(f.dates[f.dates.length - 1], market.dates[market.dates.length - 1]);
  });

  check('추이: 거래대금은 백만 단위 정수', () => {
    // DOWN 의 마지막 날은 종가 100 × (1 − 299/600) ≈ 50.2, 거래량 100000
    // → 하루 거래대금 약 502만 원. 백만 단위로 담기면 5 입니다.
    const t = built.flow.sectors.down.t;
    const last = t[t.length - 1];
    const expected = Math.round(100 * (1 - (N - 1) / (N * 2)) * 100000 / 1e6);
    assert.ok(Number.isInteger(last), `정수가 아닙니다: ${last}`);
    assert.strictEqual(last, expected);
  });

  check('추이: 방향은 그 섹터가 오른 날 u, 내린 날 d', () => {
    const up = built.flow.sectors.up.dir;
    const down = built.flow.sectors.down.dir;
    const count = (str, c) => [...str].filter(x => x === c).length;
    assert.ok(count(up, 'u') > up.length * 0.9, `상승 섹터의 u 비율 ${count(up, 'u')}/${up.length}`);
    assert.ok(count(down, 'd') > down.length * 0.9, `하락 섹터의 d 비율 ${count(down, 'd')}/${down.length}`);
  });

  check('추이: 거래가 터진 구간이 막대에도 그대로 보인다', () => {
    // 배율(turnMult)만 맞고 배열이 어긋나면 화면의 막대는 엉뚱한 자리에 섭니다.
    // DOWN 은 마지막 30일에만 거래량이 100배입니다.
    const t = built.flow.sectors.down.t;
    const tail = t.slice(-30).reduce((a, b) => a + b, 0) / 30;
    const before = t.slice(-90, -30).reduce((a, b) => a + b, 0) / 60;
    assert.ok(tail > before * 50, `최근 ${tail} vs 이전 ${before}`);
  });

  check('데이터 파일이 없는 구성 종목은 크래시 없이 빠진다', () => {
    const withGhost = [{ key: 'g', name: '유령', codes: ['UP1', 'NOPE'] }];
    const r = buildMarket('KR', FIXTURE_DIR, withGhost, m => m.name);
    assert.strictEqual(r.market.sectors[0].members.length, 1);
    assert.strictEqual(r.stats.dropped, 1);
  });
} finally {
  fs.rmSync(FIXTURE_PATH, { recursive: true, force: true });
  if (fs.existsSync(FIXTURE_PATH)) { console.error('❌ 픽스처 디렉터리가 지워지지 않았습니다'); failed++; }
}

console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);
