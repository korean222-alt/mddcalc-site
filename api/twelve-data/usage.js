// GET /api/twelve-data/usage — 오늘 사용량과 DB 상태를 그대로 보여 주는 점검용 엔드포인트.
//
// 사용량이 이상하게 보일 때(예: 계속 1회) 원인이 "정말 1회"인지 "DB 가 죽어서 0으로
// 읽히는 것"인지 화면만 봐서는 구분할 수 없어서 만들었습니다. 브라우저로 열면 바로 보입니다.
//   { "ok": true,  "todayUsage": 37, ... }            → DB 정상, 숫자도 진짜
//   { "ok": false, "error": "...", ... }              → DB 연결 실패. error 에 이유가 있음

const { getPool, ensureUsageTable, utcDayStart } = require('./_usage-db');

const DAILY_LIMIT = 800;

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
    const pool = getPool();
    await ensureUsageTable(pool);
    const [rows] = await pool.execute(
      'SELECT status, COUNT(*) AS cnt FROM api_usage WHERE createdAt >= ? GROUP BY status',
      [since]
    );

    const byStatus = {};
    for (const r of rows) byStatus[r.status] = Number(r.cnt) || 0;
    const sent = (byStatus.success || 0) + (byStatus.error || 0);

    res.status(200).json({
      ok: true,
      utcDayStart: since,
      todayUsage: sent,
      remainingUsage: Math.max(0, DAILY_LIMIT - sent),
      dailyLimit: DAILY_LIMIT,
      byStatus,
    });
  } catch (err) {
    res.status(200).json({
      ok: false,
      utcDayStart: since,
      todayUsage: null,
      dailyLimit: DAILY_LIMIT,
      error: redactHost(err.message),
      hint: 'DATABASE_URL 이 비어 있거나, DB 가 잠들었거나(TiDB 서버리스는 오래 놀면 정지·삭제됨), 접속 정보가 만료된 경우입니다. Vercel > Project Settings > Environment Variables 를 확인하세요.',
    });
  }
};
