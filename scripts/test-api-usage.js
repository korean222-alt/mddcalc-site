// api/twelve-data/time-series.js 의 "오늘 사용량" 집계를 검증한다.
//
// 배경: 예전 코드는 요청 전에 DB 를 한 번 읽고 거기에 +1 을 해서 응답했다. 조회가 실패하면
// 조용히 0 을 돌려줬기 때문에, DB 가 안 붙는 동안에는 몇 번을 조회하든 화면에 "1회"만 찍혔다.
// 지금은 (1) 기록이 실제로 들어갔을 때만 DB 값을 쓰고, (2) DB 가 안 되면 이 인스턴스가 센
// 값으로 대신하며 그 사실을 usageSource 로 알린다. 둘 다 여기서 확인한다.

const path = require('path');
const Module = require('module');

const API_DIR = path.join(__dirname, '..', 'api', 'twelve-data');
const HANDLER = path.join(API_DIR, 'time-series.js');

// mysql2/promise 를 가짜로 바꿔치기한다. 진짜 DB 없이 성공/실패를 모두 재현하기 위해서다.
async function withStubbedMysql(pool, fn) {
  const realResolve = Module._resolveFilename;
  const fakeId = 'stub-mysql2-promise';
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'mysql2/promise') return fakeId;
    return realResolve.call(this, request, ...rest);
  };
  require.cache[fakeId] = { id: fakeId, filename: fakeId, loaded: true, exports: { createPool: () => pool } };
  // 모듈 안의 커넥션 풀·메모리 카운터가 케이스마다 새로 시작하도록 캐시를 비운다.
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(API_DIR)) delete require.cache[k];
  }
  try {
    return await fn(require(HANDLER));
  } finally {
    Module._resolveFilename = realResolve;
    delete require.cache[fakeId];
  }
}

function fakeRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

// 트웰브데이터 응답을 가로챈다.
const realFetch = global.fetch;
global.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    meta: { symbol: 'PYPL' },
    values: [{ datetime: '2026-08-24', open: '61', high: '62', low: '60', close: '61' }],
  }),
});
process.env.TWELVE_DATA_API_KEY = 'test-key';
process.env.DATABASE_URL = 'mysql://u:p@example.invalid:4000/db';

let failures = 0;
function check(label, cond, extra) {
  if (cond) {
    console.log('✅ ' + label);
  } else {
    failures++;
    console.log('❌ ' + label + (extra ? ' — ' + extra : ''));
  }
}

async function run() {
  // 1) DB 가 정상일 때: 방금 넣은 한 건까지 포함해 DB 에서 다시 읽은 값을 돌려준다.
  let rows = 41; // 오늘 이미 41건 쌓여 있는 상태
  await withStubbedMysql({
    query: async () => [[], []],
    execute: async (sql) => {
      if (/^INSERT/i.test(sql.trim())) { rows++; return [{ affectedRows: 1 }, []]; }
      return [[{ cnt: rows }], []];
    },
  }, async (handler) => {
    const res = fakeRes();
    await handler({ method: 'POST', body: { symbol: 'PYPL' } }, res);
    const m = res.body && res.body._metadata;
    check('DB 정상: 오늘 사용량이 기록 뒤 값(42)으로 나온다', m && m.todayUsage === 42, m && String(m.todayUsage));
    check('DB 정상: usageSource 가 db 다', m && m.usageSource === 'db', m && m.usageSource);
    check('DB 정상: 남은 횟수가 한도에서 뺀 값이다', m && m.remainingUsage === 800 - 42, m && String(m.remainingUsage));
  });

  // 2) DB 가 죽었을 때: 예전처럼 계속 1 로 굳지 않고, 최소한 이 인스턴스 기준으로는 올라간다.
  await withStubbedMysql({
    query: async () => { throw new Error('connect ETIMEDOUT'); },
    execute: async () => { throw new Error('connect ETIMEDOUT'); },
  }, async (handler) => {
    const got = [];
    for (let i = 0; i < 3; i++) {
      const res = fakeRes();
      await handler({ method: 'POST', body: { symbol: 'PYPL' } }, res);
      got.push({ status: res.statusCode, meta: res.body && res.body._metadata, values: res.body && res.body.values });
    }
    check('DB 장애: 사용량이 1,2,3 으로 올라간다 (예전엔 계속 1)',
      got.every((g, i) => g.meta && g.meta.todayUsage === i + 1),
      got.map((g) => g.meta && g.meta.todayUsage).join(','));
    check('DB 장애: usageSource 가 memory 라 화면이 "확인 불가"로 알릴 수 있다',
      got.every((g) => g.meta && g.meta.usageSource === 'memory'),
      got.map((g) => g.meta && g.meta.usageSource).join(','));
    check('DB 장애에도 시세 응답 자체는 200 으로 그대로 나간다',
      got.every((g) => g.status === 200 && Array.isArray(g.values) && g.values.length === 1));
  });

  // 3) 한도를 넘겼으면 트웰브데이터로 요청을 내보내지 않는다.
  await withStubbedMysql({
    query: async () => [[], []],
    execute: async (sql) => (/^INSERT/i.test(sql.trim()) ? [{ affectedRows: 1 }, []] : [[{ cnt: 800 }], []]),
  }, async (handler) => {
    const res = fakeRes();
    await handler({ method: 'POST', body: { symbol: 'PYPL' } }, res);
    check('한도 도달: 429 로 막는다', res.statusCode === 429, String(res.statusCode));
    check('한도 도달: 응답에 오늘 사용량이 실려 있다', res.body && res.body.todayUsage === 800, res.body && String(res.body.todayUsage));
  });

  // 4) 점검용 GET /api/twelve-data/usage — DB 가 죽어 있어도 200 으로 원인을 알려 주되,
  //    누구나 열어 볼 수 있는 응답이므로 DB 호스트는 가려서 내보내야 한다.
  process.env.DATABASE_URL = 'mysql://u:p@gateway01.prod.aws.tidbcloud.com:4000/db';
  await withStubbedMysql({
    query: async () => { throw new Error('connect ETIMEDOUT gateway01.prod.aws.tidbcloud.com:4000'); },
    execute: async () => { throw new Error('connect ETIMEDOUT gateway01.prod.aws.tidbcloud.com:4000'); },
  }, async () => {
    const usageHandler = require(path.join(API_DIR, 'usage.js'));
    const res = fakeRes();
    await usageHandler({ method: 'GET' }, res);
    check('점검 엔드포인트: DB 가 죽어도 200 으로 이유를 알려 준다',
      res.statusCode === 200 && res.body && res.body.ok === false, String(res.statusCode));
    check('점검 엔드포인트: 응답에 DB 호스트가 새어 나가지 않는다',
      res.body && !String(res.body.error).includes('tidbcloud.com'), res.body && res.body.error);
    check('점검 엔드포인트: 에러 종류는 남아 있어 원인을 알 수 있다',
      res.body && String(res.body.error).includes('ETIMEDOUT'), res.body && res.body.error);
    check('점검 엔드포인트: 색인되지 않도록 noindex 를 붙인다',
      res.headers['X-Robots-Tag'] === 'noindex', JSON.stringify(res.headers));
  });

  // 5) UTC 자정 경계: 한도가 UTC 로 초기화되므로 집계 기준도 UTC 여야 한다.
  const { utcDayStart } = require(path.join(API_DIR, '_usage-db.js'));
  const expected = new Date().toISOString().slice(0, 10) + ' 00:00:00';
  check('집계 시작 시각이 UTC 자정이다', utcDayStart() === expected, utcDayStart());

  global.fetch = realFetch;
  console.log(failures === 0 ? '\n모두 통과' : '\n' + failures + '개 실패');
  process.exit(failures === 0 ? 0 : 1);
}

run();
