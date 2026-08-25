// 트웰브데이터 하루 크레딧 장부(api_usage 테이블)를 검증한다.
//
// 배경 1 — 늘 "1회"로 보이던 것
//   예전 코드는 요청 전에 DB 를 한 번 읽고 거기에 +1 을 해서 응답했다. 조회가 실패하면
//   조용히 0 을 돌려줬기 때문에, DB 가 안 붙는 동안에는 몇 번을 조회하든 "1회"만 찍혔다.
//
// 배경 2 — 배치가 쓰는 크레딧이 장부에 없던 것
//   섹터 RS·히트맵·종목 페이지 데이터를 만드는 GitHub Actions 배치는 api.twelvedata.com 을
//   직접 부른다. 그래서 하루 200회 넘게 써도 사이트 장부에는 한 줄도 남지 않았다.
//   지금은 배치도 같은 테이블에 status='batch' 로 적고, 사이트는 배치 몫을 남겨 두고 멈춘다.

const path = require('path');
const Module = require('module');

const API_DIR = path.join(__dirname, '..', 'api', 'twelve-data');
const HANDLER = path.join(API_DIR, 'time-series.js');

// 오늘 테이블에 이 상태별 행 수가 들어 있다고 치는 가짜 DB.
// 새 코드가 실제로 쓰는 두 가지 문장만 흉내 낸다: 상태별 GROUP BY 집계, 다중행 INSERT.
function fakeDb(counts) {
  const rows = Object.assign({}, counts);
  return {
    inserted: rows,
    query: async (sql, params) => {
      if (/^\s*CREATE TABLE/i.test(sql)) return [[], []];
      if (/^\s*INSERT/i.test(sql)) {
        // (?, ?, ?, UTC_TIMESTAMP()) 한 묶음이 한 행이다. status 는 각 묶음의 두 번째 값.
        for (let i = 1; i < params.length; i += 3) {
          rows[params[i]] = (rows[params[i]] || 0) + 1;
        }
        return [{ affectedRows: params.length / 3 }, []];
      }
      throw new Error('테스트가 예상하지 못한 SQL: ' + sql);
    },
    execute: async (sql) => {
      if (/GROUP BY status/i.test(sql)) {
        return [Object.entries(rows).map(([status, cnt]) => ({ status, cnt })), []];
      }
      throw new Error('테스트가 예상하지 못한 SQL: ' + sql);
    },
  };
}

function brokenDb(message) {
  const boom = async () => { throw new Error(message); };
  return { query: boom, execute: boom };
}

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

async function call(handler) {
  const res = fakeRes();
  await handler({ method: 'POST', body: { symbol: 'PYPL' } }, res);
  return res;
}

async function run() {
  // 상수는 _usage-db.js 안에 있는데 그 모듈이 mysql2 를 부른다. 가짜를 끼운 상태에서 읽는다.
  let DAILY_LIMIT, BATCH_BUDGET;
  await withStubbedMysql(fakeDb({}), async () => {
    ({ DAILY_LIMIT, BATCH_BUDGET } = require(path.join(API_DIR, '_usage-db.js')));
  });

  // 1) DB 가 정상일 때: 방금 넣은 한 건까지 포함해 DB 에서 다시 읽은 값을 돌려준다.
  await withStubbedMysql(fakeDb({ success: 41 }), async (handler) => {
    const m = (await call(handler)).body._metadata;
    check('DB 정상: 오늘 사용량이 기록 뒤 값(42)으로 나온다', m.todayUsage === 42, String(m.todayUsage));
    check('DB 정상: usageSource 가 db 다', m.usageSource === 'db', m.usageSource);
    check('DB 정상: 배치 몫을 뺀 한도가 남은 횟수에 반영된다',
      m.dailyLimit === DAILY_LIMIT - BATCH_BUDGET && m.remainingUsage === m.dailyLimit - 42,
      `한도 ${m.dailyLimit} / 남음 ${m.remainingUsage}`);
  });

  // 2) 배치가 쓴 크레딧도 같은 장부에 잡힌다.
  //    (섹터 RS·히트맵 데이터를 만드는 GitHub Actions 배치가 status='batch' 로 적는다)
  await withStubbedMysql(fakeDb({ success: 6, batch: 209 }), async (handler) => {
    const m = (await call(handler)).body._metadata;
    check('배치 사용량이 오늘 총 사용량에 포함된다', m.todayUsage === 216, String(m.todayUsage));
    check('사용자 조회 몫과 배치 몫이 나뉘어 보인다',
      m.webUsage === 7 && m.batchUsage === 209, `web ${m.webUsage} / batch ${m.batchUsage}`);
    check('배치가 이미 쓴 만큼 예약분이 줄어든다',
      m.reservedForBatch === BATCH_BUDGET - 209, String(m.reservedForBatch));
  });

  // 3) 배치 몫은 사용자 조회가 먹어치우지 못한다.
  //    배치 전이든 후든 사용자가 쓸 수 있는 횟수가 같아야 한다(예약분이 자동으로 상쇄된다).
  const webCap = DAILY_LIMIT - BATCH_BUDGET;
  await withStubbedMysql(fakeDb({ success: webCap }), async (handler) => {
    const res = await call(handler);
    check('배치 전: 사용자 조회가 배치 몫을 남기고 429 로 멈춘다', res.statusCode === 429, String(res.statusCode));
  });
  await withStubbedMysql(fakeDb({ success: webCap, batch: BATCH_BUDGET }), async (handler) => {
    const res = await call(handler);
    check('배치 후: 같은 지점에서 멈춘다 (예약분을 두 번 세지 않는다)', res.statusCode === 429, String(res.statusCode));
  });
  await withStubbedMysql(fakeDb({ success: webCap - 1, batch: BATCH_BUDGET }), async (handler) => {
    const res = await call(handler);
    check('배치 후: 한도 직전까지는 정상 조회된다', res.statusCode === 200, String(res.statusCode));
  });

  // 4) DB 가 죽었을 때: 예전처럼 계속 1 로 굳지 않고, 최소한 이 인스턴스 기준으로는 올라간다.
  await withStubbedMysql(brokenDb('connect ETIMEDOUT'), async (handler) => {
    const got = [];
    for (let i = 0; i < 3; i++) got.push(await call(handler));
    check('DB 장애: 사용량이 1,2,3 으로 올라간다 (예전엔 계속 1)',
      got.every((r, i) => r.body._metadata.todayUsage === i + 1),
      got.map((r) => r.body._metadata.todayUsage).join(','));
    check('DB 장애: usageSource 가 memory 라 화면이 "확인 불가"로 알릴 수 있다',
      got.every((r) => r.body._metadata.usageSource === 'memory'));
    check('DB 장애에도 시세 응답 자체는 200 으로 그대로 나간다',
      got.every((r) => r.statusCode === 200 && r.body.values.length === 1));
  });

  // 5) 점검용 GET /api/twelve-data/usage — DB 가 죽어도 200 으로 원인을 알려 주되,
  //    누구나 열어 볼 수 있는 응답이므로 DB 호스트는 가려서 내보내야 한다.
  await withStubbedMysql(fakeDb({ success: 7, batch: 209 }), async () => {
    const usageHandler = require(path.join(API_DIR, 'usage.js'));
    const res = fakeRes();
    await usageHandler({ method: 'GET' }, res);
    check('점검 엔드포인트: 사용자 몫과 배치 몫을 나눠 보여 준다',
      res.body.ok === true && res.body.webUsage === 7 && res.body.batchUsage === 209 && res.body.todayUsage === 216,
      JSON.stringify(res.body));
  });

  process.env.DATABASE_URL = 'mysql://u:p@gateway01.prod.aws.tidbcloud.com:4000/db';
  await withStubbedMysql(brokenDb('connect ETIMEDOUT gateway01.prod.aws.tidbcloud.com:4000'), async () => {
    const usageHandler = require(path.join(API_DIR, 'usage.js'));
    const res = fakeRes();
    await usageHandler({ method: 'GET' }, res);
    check('점검 엔드포인트: DB 가 죽어도 200 으로 이유를 알려 준다',
      res.statusCode === 200 && res.body.ok === false, String(res.statusCode));
    check('점검 엔드포인트: 응답에 DB 호스트가 새어 나가지 않는다',
      !String(res.body.error).includes('tidbcloud.com'), res.body.error);
    check('점검 엔드포인트: 에러 종류는 남아 있어 원인을 알 수 있다',
      String(res.body.error).includes('ETIMEDOUT'), res.body.error);
    check('점검 엔드포인트: 색인되지 않도록 noindex 를 붙인다',
      res.headers['X-Robots-Tag'] === 'noindex', JSON.stringify(res.headers));
  });

  // 6) UTC 자정 경계: 한도가 UTC 로 초기화되므로 집계 기준도 UTC 여야 한다.
  await withStubbedMysql(fakeDb({}), async () => {
    const { utcDayStart } = require(path.join(API_DIR, '_usage-db.js'));
    const expected = new Date().toISOString().slice(0, 10) + ' 00:00:00';
    check('집계 시작 시각이 UTC 자정이다', utcDayStart() === expected, utcDayStart());
  });

  // 7) 배치 쪽 기록기: DB 가 없으면 조용히 넘어가고, 배치를 절대 멈추지 않는다.
  delete process.env.DATABASE_URL;
  delete require.cache[require.resolve('./api-usage-log.js')];
  const usageLog = require('./api-usage-log.js');
  let threw = false;
  try {
    usageLog.count('SPY', 200);
    await usageLog.finish();
  } catch (e) { threw = true; }
  check('배치 기록기: DATABASE_URL 이 없어도 예외를 던지지 않는다', !threw);

  global.fetch = realFetch;
  console.log(failures === 0 ? '\n모두 통과' : '\n' + failures + '개 실패');
  process.exit(failures === 0 ? 0 : 1);
}

run();
