#!/usr/bin/env node
// API 사용 기록·검사 회귀 테스트.   실행: node scripts/test-api-usage.js
//
// 이 검사기는 "조용한 실패"를 잡으라고 만든 것이라, 검사기 자신이 조용히 망가지면
// 아무 소용이 없습니다. 통과해야 할 경우와 반드시 잡아야 할 경우를 여기에 고정합니다.

const assert = require('assert');

process.env.TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY || 'test-key';

const { checkUsage } = require('./check-api-usage');
const { buildUsageRecord, fetchApiUsage, resetTwelveDataCalls, getTwelveDataCalls,
        fromTwelveData, kstStamp } = require('./generate-us-data');

const NOW = new Date('2026-08-25T00:00:00Z');

// 정상적인 하루치 실행. 209심볼 중 206 성공, Twelve Data 사용량도 209 늘었습니다.
const goodUsage = {
  provider: 'twelvedata',
  generatedAt: '2026-08-24T23:27:25.000Z',
  generatedAtKST: '2026-08-25 08:27 KST',
  symbols: 209, calls: 209, ok: 206, failed: 3, usable: 208,
  sources: { twelvedata: 206 },
  usage: { measured: true, before: 12, after: 221, delta: 209, limit: 800 },
  failures: [{ symbol: 'CFLT', reason: '...' }],
};

const goodSectors = {
  generatedAt: '2026-08-24T23:27:25.400Z',
  provenance: { US: { symbols: 208, sources: { twelvedata: 208 }, apiUsage: { calls: 209 } } },
};

const CASES = [
  {
    label: '정상 실행은 통과한다',
    input: { usage: goodUsage, sectors: goodSectors, now: NOW, fresh: true },
    ok: true,
  },
  {
    label: '기록이 없으면 잡는다',
    input: { usage: null, sectors: goodSectors, now: NOW },
    ok: false, expect: /api-usage.json 이 없습니다/,
  },
  {
    label: '키가 비어 호출이 0회면 잡는다',
    input: {
      usage: { ...goodUsage, calls: 0, sources: { stooq: 206 },
        usage: { measured: false, reason: 'API 키 없음' } },
      sectors: goodSectors, now: NOW,
    },
    ok: false, expect: /한 번도 부르지 않았습니다/,
  },
  {
    label: '폴백으로만 받았으면 잡는다 (화면은 멀쩡해 보인다)',
    input: {
      usage: { ...goodUsage, sources: { stooq: 206 } },
      sectors: goodSectors, now: NOW,
    },
    ok: false, expect: /Twelve Data 로 받아온 심볼이 0개/,
  },
  {
    label: '호출은 했는데 저쪽 사용량이 안 늘면 잡는다',
    input: {
      usage: { ...goodUsage, usage: { measured: true, before: 12, after: 14, delta: 2, limit: 800 } },
      sectors: goodSectors, now: NOW,
    },
    ok: false, expect: /사용량은 2회만 늘었습니다/,
  },
  {
    label: '하루 한도 90%를 넘으면 잡는다',
    input: {
      usage: { ...goodUsage, usage: { measured: true, before: 520, after: 729, delta: 209, limit: 800 } },
      sectors: goodSectors, now: NOW,
    },
    ok: false, expect: /90%를 넘었습니다/,
  },
  {
    label: '사용량을 못 쟀다는 것만으로는 실패가 아니다 (호출 수가 이미 증거)',
    input: {
      usage: { ...goodUsage, usage: { measured: false, reason: 'api_usage 조회 실패' } },
      sectors: goodSectors, now: NOW, fresh: true,
    },
    ok: true,
  },
  {
    label: '--fresh 면 어제 기록을 이번 실행분으로 인정하지 않는다',
    input: { usage: goodUsage, sectors: goodSectors, now: new Date('2026-08-26T00:00:00Z'), fresh: true },
    ok: false, expect: /시간 전 것입니다/,
  },
  {
    label: '--fresh 가 아니면 오래된 기록도 검사 대상이다',
    input: { usage: goodUsage, sectors: goodSectors, now: new Date('2026-08-26T00:00:00Z') },
    ok: true,
  },
  {
    label: 'sectors.json 에 출처가 없으면 잡는다 (옛 생성기)',
    input: { usage: goodUsage, sectors: { generatedAt: '2026-08-24T23:27:25.400Z' }, now: NOW },
    ok: false, expect: /provenance 가 없습니다/,
  },
  {
    label: 'RS·히트맵이 읽는 파일이 전부 폴백 산이면 잡는다',
    input: {
      usage: goodUsage,
      sectors: { ...goodSectors, provenance: { US: { symbols: 208, sources: { yahoo: 208 } } } },
      now: NOW,
    },
    ok: false, expect: /Twelve Data 로 받은 것이 하나도 없습니다/,
  },
  {
    label: '수집보다 먼저 만들어진 sectors.json 은 잡는다 (스텝 순서가 뒤집힌 경우)',
    input: {
      usage: goodUsage,
      sectors: { ...goodSectors, generatedAt: '2026-08-24T20:00:00.000Z' },
      now: NOW,
    },
    ok: false, expect: /먼저 만들어졌습니다/,
  },
];

(async () => {
  let failed = 0;

  for (const { label, input, ok, expect } of CASES) {
    try {
      const got = checkUsage(input);
      assert.strictEqual(got.ok, ok, `통과 여부가 다릅니다 (문제: ${got.problems.join(' / ') || '없음'})`);
      if (expect) {
        assert.ok(got.problems.some(p => expect.test(p)),
          `기대한 지적이 없습니다: ${expect} — 실제: ${got.problems.join(' / ')}`);
      }
      console.log(`✅ ${label}`);
    } catch (err) {
      console.error(`❌ ${label}\n   ${err.message}`);
      failed++;
    }
  }

  // ── 호출 수 세기 ────────────────────────────────────────────────────
  // 이 숫자가 곧 "사용량이 올라갔다"의 근거라, 실제로 나간 요청과 어긋나면 안 됩니다.
  {
    const body = JSON.stringify({ meta: { currency: 'USD' }, status: 'ok',
      values: [{ datetime: '2026-08-21', high: '11', close: '10', volume: '5' }] });

    resetTwelveDataCalls();
    global.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(body) });
    await fromTwelveData('SPY');
    await fromTwelveData('QQQ');

    // 실패한 요청도 크레딧을 씁니다. 성공만 세면 실제 사용량보다 적게 잡힙니다.
    global.fetch = async () => ({ ok: false, status: 400,
      json: async () => ({ code: 400, message: 'nope', status: 'error' }) });
    try { await fromTwelveData('BAD'); } catch { /* 실패가 정상인 케이스 */ }

    try {
      assert.strictEqual(getTwelveDataCalls(), 3, '성공 2회 + 실패 1회 = 3회여야 합니다');
      console.log('✅ 실패한 요청까지 호출 수에 센다');
    } catch (err) { console.error(`❌ ${err.message}`); failed++; }
  }

  // ── api_usage 응답 읽기 ─────────────────────────────────────────────
  // 플랜에 따라 필드 이름이 다릅니다. 한쪽만 읽으면 조용히 "못 쟀음"이 됩니다.
  const USAGE_SHAPES = [
    { label: '요즘 응답 (daily_usage)', body: { daily_usage: 209, plan_daily_limit: 800 }, expect: { used: 209, limit: 800 } },
    { label: '예전 응답 (current_usage)', body: { current_usage: 42, plan_limit: 610 }, expect: { used: 42, limit: 610 } },
    { label: '한도 없이 사용량만', body: { current_usage: 7 }, expect: { used: 7, limit: null } },
  ];
  for (const { label, body, expect } of USAGE_SHAPES) {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => body });
    try {
      assert.deepStrictEqual(await fetchApiUsage(), expect);
      console.log(`✅ ${label}`);
    } catch (err) { console.error(`❌ ${label}\n   ${err.message}`); failed++; }
  }

  // 조회가 깨져도 수집은 계속돼야 합니다. 여기서 던지면 209심볼이 통째로 날아갑니다.
  for (const [label, impl] of [
    ['HTTP 500', async () => ({ ok: false, status: 500, json: async () => ({}) })],
    ['status:error', async () => ({ ok: true, status: 200, json: async () => ({ status: 'error', message: 'bad key' }) })],
    ['네트워크 오류', async () => { throw new Error('ECONNRESET'); }],
    ['JSON 아님', async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } })],
  ]) {
    global.fetch = impl;
    try {
      assert.strictEqual(await fetchApiUsage(), null, 'null 을 돌려줘야 합니다');
      console.log(`✅ api_usage ${label} → 던지지 않고 null`);
    } catch (err) { console.error(`❌ api_usage ${label}\n   ${err.message}`); failed++; }
  }

  // ── 기록 만들기 ─────────────────────────────────────────────────────
  const RECORD_CASES = [
    {
      label: '정상: 사용량 증가분을 그대로 담는다',
      args: { usageBefore: { used: 10, limit: 800 }, usageAfter: { used: 219, limit: 800 } },
      check: u => { assert.strictEqual(u.measured, true); assert.strictEqual(u.delta, 209); },
    },
    {
      label: 'UTC 자정 리셋이 실행 중이면 "못 쟀음"으로 남긴다 (실패가 아님)',
      // 22:30 UTC 실행이 자정을 넘기면 나중 값이 더 작습니다. 이걸 음수 증가분으로
      // 기록하면 검사기가 멀쩡한 실행을 실패로 부릅니다.
      args: { usageBefore: { used: 700, limit: 800 }, usageAfter: { used: 9, limit: 800 } },
      check: u => { assert.strictEqual(u.measured, false); assert.ok(/리셋/.test(u.reason)); },
    },
    {
      label: '키가 없으면 못 쟀음으로 남긴다',
      args: { usageBefore: null, usageAfter: null },
      check: u => { assert.strictEqual(u.measured, false); assert.ok(u.reason); },
    },
  ];
  for (const { label, args, check } of RECORD_CASES) {
    try {
      const rec = buildUsageRecord({
        symbols: new Array(209), ok: new Array(206), usable: new Array(208),
        failed: [{ symbol: 'CFLT', reason: 'x'.repeat(500) }],
        bySource: { twelvedata: 206 }, calls: 209, now: NOW, ...args,
      });
      check(rec.usage);
      assert.strictEqual(rec.calls, 209, '호출 수');
      assert.strictEqual(rec.symbols, 209, '심볼 수');
      assert.ok(rec.failures[0].reason.length <= 200, '실패 사유는 잘라서 담아야 합니다');
      console.log(`✅ ${label}`);
    } catch (err) { console.error(`❌ ${label}\n   ${err.message}`); failed++; }
  }

  // 한국 시간 표기. UTC 밤 실행이 다음날 아침으로 넘어가는지가 핵심입니다.
  try {
    assert.strictEqual(kstStamp(new Date('2026-08-24T22:35:00Z')), '2026-08-25 07:35 KST');
    console.log('✅ 22:35 UTC 는 다음날 07:35 KST 로 적는다');
  } catch (err) { console.error(`❌ KST 표기\n   ${err.message}`); failed++; }

  console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
  process.exit(failed ? 1 : 0);
})();
