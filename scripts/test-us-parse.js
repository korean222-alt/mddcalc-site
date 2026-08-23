#!/usr/bin/env node
// Stooq CSV 파서 회귀 테스트.   실행: node scripts/test-us-parse.js
//
// test-kr-parse.js 와 같은 이유로 있습니다. 파서가 조용히 0행을 뽑아도 생성기는
// "실패"로 처리해 기존 파일을 남기기 때문에, 화면은 지난 데이터로 멀쩡해 보입니다.
// 그래서 며칠이 지나도록 아무도 모릅니다. 응답 형태를 여기서 고정해 둡니다.

const assert = require('assert');
const { fromStooq } = require('./generate-us-data');

const HEADER = 'Date,Open,High,Low,Close,Volume';

const CASES = [
  {
    label: '정상 응답 (SPY)',
    body: `${HEADER}\n1993-01-29,25.6314,25.7,25.5028,25.5479,1003200\n1993-02-01,25.55,26.01,25.55,26.0,480500\n`,
    expect: { rows: 2, close: [25.55, 26], high: [25.7, 26.01], volume: [1003200, 480500] },
  },
  {
    label: '마지막 줄에 개행이 없어도 읽는다',
    body: `${HEADER}\n2026-08-20,100,101,99,100.5,1234`,
    expect: { rows: 1, close: [100.5], volume: [1234] },
  },
  {
    label: '고가가 종가보다 낮게 오면 종가로 끌어올린다',
    // 낙폭 계산이 고가를 최고점 계열로 쓰기 때문에 어긋나면 안 됩니다. (KR 파서와 같은 규칙)
    body: `${HEADER}\n2026-08-20,10,9.5,9,10.4,500\n`,
    expect: { rows: 1, close: [10.4], high: [10.4] },
  },
  {
    label: '거래량이 비어 있으면 0',
    body: `${HEADER}\n2026-08-20,10,11,9,10.5,\n`,
    expect: { rows: 1, close: [10.5], volume: [0] },
  },
  {
    label: '종가가 0이거나 비정상인 행은 버린다',
    body: `${HEADER}\n2026-08-19,0,0,0,0,0\n2026-08-20,10,11,9,10.5,100\n`,
    expect: { rows: 1, close: [10.5] },
  },
];

// 데이터가 아닌 응답은 반드시 실패로 처리돼야 합니다. 여기서 빈 결과를 정상이라고
// 넘기면 생성기가 멀쩡한 기존 파일을 빈 파일로 덮어씁니다.
const REJECT = [
  { label: '한도 초과 안내문', body: 'Exceeded the daily hits limit' },
  { label: '데이터 없음', body: 'No data' },
  { label: '차단 HTML', body: '<html><body>Forbidden</body></html>' },
  { label: '헤더만 있고 행이 없음', body: HEADER + '\n' },
];

(async () => {
  let failed = 0;

  for (const { label, body, expect } of CASES) {
    global.fetch = async () => ({ ok: true, status: 200, text: async () => body });
    try {
      const got = await fromStooq('SPY');
      assert.strictEqual(got.d.length, expect.rows, '행 수');
      assert.deepStrictEqual(got.c, expect.close, '종가');
      if (expect.high) assert.deepStrictEqual(got.h, expect.high, '고가');
      if (expect.volume) assert.deepStrictEqual(got.v, expect.volume, '거래량');
      assert.strictEqual(got.currency, 'USD', '통화');
      assert.ok(got.h.every((h, i) => h >= got.c[i]), '고가는 종가 이상이어야 함');
      assert.ok(got.d.every((d, i) => i === 0 || d > got.d[i - 1]), '날짜는 오름차순이어야 함');
      assert.strictEqual(got.v.length, got.c.length, '거래량 길이는 종가와 같아야 함');
      console.log(`✅ ${label}`);
    } catch (err) {
      console.error(`❌ ${label}\n   ${err.message}`);
      failed++;
    }
  }

  for (const { label, body } of REJECT) {
    global.fetch = async () => ({ ok: true, status: 200, text: async () => body });
    try {
      await fromStooq('SPY');
      console.error(`❌ ${label} — 데이터가 아닌데 성공으로 처리됨`);
      failed++;
    } catch (err) {
      console.log(`✅ ${label} → 실패 처리`);
    }
  }

  console.log(failed ? `\n${failed}개 실패` : `\n${CASES.length + REJECT.length}개 모두 통과`);
  process.exit(failed ? 1 : 0);
})();
