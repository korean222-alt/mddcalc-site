// api_usage 테이블에 붙는 공용 코드.
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

module.exports = { getPool, ensureUsageTable, utcDayStart };
