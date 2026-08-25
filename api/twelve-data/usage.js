// GET /api/twelve-data/usage — 오늘 쓴 크레딧과 DB 상태를 그대로 보여 주는 점검용 엔드포인트.
//
// 사용량이 이상하게 보일 때(예: 계속 1회) 원인이 "정말 1회"인지 "DB 가 죽어서 0으로
// 읽히는 것"인지 화면만 봐서는 구분할 수 없어서 만들었습니다. 브라우저로 열면 바로 보입니다.
//   { "ok": true,  "todayUsage": 216, "webUsage": 7, "batchUsage": 209, ... }  → 정상
//   { "ok": false, "error": "...", ... }                                       → DB 연결 실패
//
// webUsage  : 사용자가 MDD 계산기에서 미국 종목을 조회한 횟수
// batchUsage: GitHub Actions 배치가 섹터·히트맵·종목 페이지 데이터를 받아오며 쓴 횟수
//             (히트맵·섹터 RS 화면 자체는 정적 파일만 읽어서 크레딧을 쓰지 않습니다)

const { DAILY_LIMIT, BATCH_BUDGET, getPool, utcDayStart, countTodayUsage } = require('./_usage-db');

// 이 응답은 누구나 열어 볼 수 있습니다. 드라이버 에러 메시지에는 DB 호스트와 포트가
// 그대로 실려 오는 경우가 많으므로(예: "connect ETIMEDOUT 1.2.3.4:4000") 가려서 내보냅니다.
// 원인을 아는 데는 에러 종류만 있으면 충분합니다.
function redactHost(message) {
  let out = String(message || '알 수 없는 오류');
  const raw = process.env.DATABASE_URL;
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.hostname) out = out.split(url.hostname).join('(db-host)');
    } catch (e) { /* URL 이 깨져 있으면 아래 일반 규칙만 적용합니다 */ }
  }
  return out
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '(ip)')
    .replace(/\b[\w.-]+\.[a-z]{2,}(?::\d+)?\b/gi, '(host)');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // 점검용이라 캐시되면 곤란합니다. 색인될 이유도 없습니다.
  // (robots.txt 로 막지 않는 것은, 막으면 /api/alerts 의 410 도 못 읽게 되기 때문입니다.)
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

  const since = utcDayStart();
  try {
    const u = await countTodayUsage(getPool());
    res.status(200).json({
      ok: true,
      utcDayStart: since,
      todayUsage: u.total,
      webUsage: u.web,
      batchUsage: u.batch,
      reservedForBatch: u.reserved,
      remainingUsage: Math.max(0, u.effectiveLimit - u.total),
      dailyLimit: u.effectiveLimit,
      planDailyLimit: DAILY_LIMIT,
      batchBudget: BATCH_BUDGET,
      byStatus: u.byStatus,
    });
  } catch (err) {
    res.status(200).json({
      ok: false,
      utcDayStart: since,
      todayUsage: null,
      planDailyLimit: DAILY_LIMIT,
      error: redactHost(err.message),
      hint: 'DATABASE_URL 이 비어 있거나, 접속 정보가 틀렸거나, DB 가 연결을 받지 못하는 상태입니다. Vercel > Project Settings > Environment Variables 를 확인하세요. 형식: mysql://사용자:비밀번호@호스트:4000/DB이름',
    });
  }
};
