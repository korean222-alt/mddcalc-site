// api_usage 테이블에 붙는 공용 코드.
//
// 이 파일을 읽는 곳은 두 군데입니다.
//   1. api/twelve-data/*.js  — 사용자가 종목을 조회할 때 (서버리스 함수)
//   2. scripts/api-usage-log.js — GitHub Actions 배치가 시세를 받아올 때
// 트웰브데이터 무료 플랜의 하루 800 크레딧을 이 둘이 나눠 쓰므로, 장부도 하나여야 합니다.
//
// 왜 커넥션 하나를 캐시하지 않는가
// --------------------------------
// 예전에는 mysql.createConnection() 이 돌려준 프라미스를 모듈 변수에 담아 재사용했습니다.
// 서버리스에서 이 방식은 두 가지로 무너집니다.
//   1. 첫 연결이 한 번 실패하면 "거부된 프라미스"가 그대로 캐시되어, 그 인스턴스는
//      되살아날 때까지 영원히 DB 를 못 씁니다.
//   2. 함수가 웜 상태로 몇 분 쉬는 동안 서버(TiDB 서버리스 등)가 유휴 커넥션을 끊습니다.
//      다음 요청은 이미 죽은 커넥션으로 쿼리를 날려 그대로 실패합니다.
// 두 경우 모두 호출부의 try/catch 가 조용히 삼켜서 "오늘 사용량 0" 으로 보였습니다.
//
// 풀은 죽은 커넥션을 알아서 버리고 새로 만듭니다. 동시 실행이 거의 없는 사이트라
// 커넥션은 1개면 충분하고, 유휴 커넥션은 짧게 끊어 DB 쪽 연결 수를 아낍니다.

const mysql = require('mysql2/promise');

// 트웰브데이터 무료 플랜의 하루 크레딧. UTC 자정에 초기화됩니다.
const DAILY_LIMIT = 800;

// 매일 도는 배치가 쓰는 몫. 사용자 조회가 이만큼은 남겨 두고 멈춰야, 미국장 마감 뒤
// 도는 섹터 데이터 수집이 429 를 맞고 통째로 실패하는 일이 없습니다.
//   scripts/generate-us-data.js    : 209 심볼 × 평일 1회
//   scripts/generate-stock-pages.js:  21 심볼 × 매주 월요일 1회
// 여유를 붙여 넉넉히 잡습니다. 종목을 늘리면 이 값도 같이 올려야 합니다.
const BATCH_BUDGET = 260;

// status 값. 사용자 조회('success'/'error')와 배치('batch')를 구분해 두면 컬럼을 새로
// 추가하지 않고도 "누가 얼마나 썼는지"를 나눠 셀 수 있습니다.
//   success / error : 사용자 조회로 실제 트웰브데이터까지 나간 요청 (성공이든 실패든 크레딧 소모)
//   rate_limit      : 우리가 막아서 나가지 않은 요청 (크레딧 소모 없음 → 세지 않음)
//   batch           : GitHub Actions 배치가 쓴 크레딧
const WEB_STATUSES = ['success', 'error'];
const BATCH_STATUS = 'batch';

let pool = null;
let ensured = null;

function getPool() {
  if (pool) return pool;

  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL 환경변수가 설정되어 있지 않습니다.');

  const url = new URL(raw);
  pool = mysql.createPool({
    host: url.hostname,
    port: url.port ? Number(url.port) : 4000,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, '').split('?')[0],
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 1,
    maxIdle: 1,
    idleTimeout: 30000,
    enableKeepAlive: true,
    connectTimeout: 8000,
  });
  return pool;
}

// 테이블이 없어서 조회·기록이 통째로 실패하는 일이 없도록, 인스턴스마다 한 번 만들어 둡니다.
// 이미 있으면 아무 일도 하지 않습니다.
function ensureUsageTable(p) {
  if (ensured) return ensured;
  ensured = p.query(`
    CREATE TABLE IF NOT EXISTS api_usage (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      symbol VARCHAR(32) NOT NULL,
      status VARCHAR(16) NOT NULL,
      statusCode INT NULL,
      createdAt DATETIME NOT NULL,
      INDEX idx_created_status (createdAt, status)
    )
  `).catch((err) => {
    // 만들지 못했다고 해서 다음 요청까지 막을 이유는 없습니다. 다음에 다시 시도합니다.
    ensured = null;
    throw err;
  });
  return ensured;
}

// 트웰브데이터의 일일 한도는 UTC 자정에 초기화됩니다. 그래서 "오늘"의 기준도 UTC 이고,
// 비교 대상인 createdAt 도 UTC_TIMESTAMP() 로 기록합니다.
// 드라이버가 Date 를 서버 로컬 타임존 문자열로 바꿔 보내는 것을 피하려고 문자열로 넘깁니다.
function utcDayStart() {
  return new Date().toISOString().slice(0, 10) + ' 00:00:00';
}

// 오늘(UTC 기준) 쓴 크레딧을 누가 썼는지로 나눠서 셉니다.
//
// effectiveLimit — 사용자 조회를 막기 시작할 지점.
// 배치가 아직 안 돌았으면 그 몫(BATCH_BUDGET)만큼 빼 두고, 배치가 돌아 기록이 쌓이면
// 남은 예약분만 뺍니다. 그래서 배치 전후로 "사용자가 쓸 수 있는 양"이 흔들리지 않습니다.
async function countTodayUsage(p) {
  await ensureUsageTable(p);
  const [rows] = await p.execute(
    'SELECT status, COUNT(*) AS cnt FROM api_usage WHERE createdAt >= ? GROUP BY status',
    [utcDayStart()]
  );

  const byStatus = {};
  for (const r of rows) byStatus[r.status] = Number(r.cnt) || 0;

  const web = WEB_STATUSES.reduce((sum, s) => sum + (byStatus[s] || 0), 0);
  const batch = byStatus[BATCH_STATUS] || 0;
  const reserved = Math.max(0, BATCH_BUDGET - batch);

  return {
    web,
    batch,
    total: web + batch,
    reserved,
    effectiveLimit: DAILY_LIMIT - reserved,
    byStatus,
  };
}

// 크레딧을 쓴 만큼 기록합니다. rows 는 { symbol, status, statusCode } 배열입니다.
// COUNT(*) 로 세므로 크레딧 하나당 한 행입니다.
async function recordUsage(p, rows) {
  if (!rows || rows.length === 0) return 0;
  await ensureUsageTable(p);

  const placeholders = rows.map(() => '(?, ?, ?, UTC_TIMESTAMP())').join(', ');
  const params = [];
  for (const r of rows) {
    params.push(String(r.symbol || '').slice(0, 32), r.status, r.statusCode == null ? null : r.statusCode);
  }
  // NOW() 는 DB 세션 타임존을 따라가서 UTC 자정 경계와 어긋날 수 있습니다.
  // 한도가 UTC 자정에 초기화되므로 기록도 UTC 로 못박습니다.
  await p.query(
    `INSERT INTO api_usage (symbol, status, statusCode, createdAt) VALUES ${placeholders}`,
    params
  );
  return rows.length;
}

module.exports = {
  DAILY_LIMIT, BATCH_BUDGET, BATCH_STATUS, WEB_STATUSES,
  getPool, ensureUsageTable, utcDayStart, countTodayUsage, recordUsage,
};
