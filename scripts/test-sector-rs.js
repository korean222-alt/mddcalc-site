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
  assert.deepStrictEqual(alignForward(series, [9, 10, 11, 12, 13]), [null, 100, 100, 120, 120]);
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
  const { market } = buildMarket('KR', FIXTURE_DIR, defs, m => m.name);
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
