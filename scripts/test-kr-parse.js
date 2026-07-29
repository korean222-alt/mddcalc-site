#!/usr/bin/env node
// 네이버 응답 파서 회귀 테스트.   실행: node scripts/test-kr-parse.js
//
// 이 파일이 있는 이유:
//   파서를 두 번 연속 잘못 고쳤습니다. 두 번 다 원인은 "실제 응답을 안 보고 픽스처를
//   지어냈다"는 것이었습니다. 지어낸 픽스처는 작은따옴표를 썼는데 실제 데이터 행은
//   큰따옴표라, 실제로는 0행을 뽑는 코드가 테스트는 통과했습니다.
//
//   그래서 아래 픽스처는 전부 2026-07-29 GitHub Actions 실행 로그에 실제로 찍힌
//   응답을 그대로 옮긴 것입니다. 손으로 만들지 마세요.

const assert = require('assert');
const { fromNaver } = require('./generate-kr-data');

const H = `[['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'], `;

const CASES = [
  {
    label: '일반 종목 (신한지주)',
    ticker: { code: '055550', market: 'KS' },
    // 데이터 행은 헤더와 달리 큰따옴표를 씁니다.
    body: H + `["20010910", 10797, 11324, 9885, 10894, 1254910, 42.17], ["20010911", 11037, 11277, 10894, 11181, 1239210, 42.01]]`,
    expect: { rows: 2, close: [10894, 11181], high: [11324, 11277], currency: 'KRW' },
  },
  {
    label: '옛 행의 외국인소진율이 빈 값 (기업은행)',
    ticker: { code: '024110', market: 'KS' },
    // `4757, ]` 처럼 마지막 값이 비어 있습니다. JSON.parse 로는 여기서 죽습니다.
    body: H + `["19980509", 5328, 5328, 5138, 5328, 4757, ], ["19980511", 4948, 5328, 4948, 4947, 10256, ]]`,
    expect: { rows: 2, close: [5328, 4947], currency: 'KRW' },
  },
  {
    label: '시/고/저가가 0인 행 (HD한국조선해양 상장일)',
    ticker: { code: '009540', market: 'KS' },
    body: H + `["19990823", 0, 0, 0, 70000, 0, ], ["19990824", 51705, 51705, 51705, 51706, 160810, 2.31]]`,
    // 고가 0 < 종가 70000 이므로 고가를 종가로 끌어올려야 합니다.
    // analyze() 가 고가를 최고점 계열로 쓰기 때문에 그대로 두면 낙폭이 어긋납니다.
    expect: { rows: 2, close: [70000, 51706], high: [70000, 51706], currency: 'KRW' },
  },
  {
    label: '지수는 소수점 유지 (코스피)',
    ticker: { code: 'KS11', market: 'IDX' },
    body: H + `["19900104", 911.21, 933.24, 911.21, 928.82, 18094, 0.0], ["19900105", 926.56, 931.56, 913.66, 915.11, 22179, 0.0]]`,
    expect: { rows: 2, close: [928.82, 915.11], currency: 'PT' },
  },
];

(async () => {
  let failed = 0;

  for (const { label, ticker, body, expect } of CASES) {
    global.fetch = async () => ({ ok: true, status: 200, text: async () => body });
    try {
      const got = await fromNaver(ticker);
      assert.strictEqual(got.d.length, expect.rows, `행 수`);
      assert.deepStrictEqual(got.c, expect.close, `종가`);
      if (expect.high) assert.deepStrictEqual(got.h, expect.high, `고가`);
      assert.strictEqual(got.currency, expect.currency, `통화`);
      assert.ok(got.h.every((h, i) => h >= got.c[i]), '고가는 종가 이상이어야 함');
      assert.ok(got.d.every((d, i) => i === 0 || d > got.d[i - 1]), '날짜는 오름차순이어야 함');
      console.log(`✅ ${label}`);
    } catch (err) {
      console.error(`❌ ${label}\n   ${err.message}`);
      failed++;
    }
  }

  // 응답을 못 알아보면 조용히 빈 결과를 주지 말고, 진단할 수 있게 앞부분을 남겨야 합니다.
  global.fetch = async () => ({ ok: true, status: 200, text: async () => '<html>error</html>' });
  try {
    await fromNaver({ code: '005930', market: 'KS' });
    console.error('❌ 알 수 없는 응답인데 성공으로 처리됨');
    failed++;
  } catch (err) {
    assert.ok(err.message.includes('<html>'), '실패 메시지에 응답 앞부분이 있어야 함');
    console.log('✅ 알 수 없는 응답이면 응답 앞부분과 함께 실패');
  }

  console.log(failed ? `\n${failed}개 실패` : `\n${CASES.length + 1}개 모두 통과`);
  process.exit(failed ? 1 : 0);
})();
