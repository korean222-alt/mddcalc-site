// GET/POST /api/alerts — 410 Gone
//
// 왜 이 파일이 있는가
// -------------------
// 예전 홈페이지에는 "🔔 하락 알림 받기" 폼이 있었고 이메일을 /api/alerts 로 POST 했는데,
// 정작 그 서버리스 함수는 저장소에 존재한 적이 없었다. 폼은 제거했지만 그 사이 구글이
// URL을 알아버려서, Search Console 색인 리포트에 "찾을 수 없음(404)"으로 계속 남는다.
//
// 그냥 두면 Vercel이 HTML 404 페이지를 돌려주는데 그러면 두 가지가 곤란하다.
//   1. 구글은 404를 "일시적으로 없는 것"으로 보고 한동안 반복해서 다시 크롤링한다.
//      410(Gone)은 "영구적으로 삭제됨"이라 색인에서 더 빨리 떨어진다.
//   2. 캐시된 옛 페이지가 아직 이 주소로 POST하면 HTML이 돌아와 JSON 파싱이 깨지면서
//      사용자에게 `Unexpected token '<'` 같은 날것의 에러가 그대로 노출된다.
//      JSON으로 응답하면 최소한 읽을 수 있는 안내 메시지가 나간다.
//
// 알림 기능을 되살릴 때는 이 파일을 실제 구현으로 교체하면 된다
// (수신 저장 + 가격 감시 크론 + 메일 발송 + 수신거부 경로가 전부 필요 — docs/adsense-work-log.md 참고).

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(410).json({
    error: 'gone',
    message: '하락 알림 기능은 현재 제공하지 않습니다. 종목별 하락률은 https://mddcalc.com/ 에서 바로 확인하실 수 있습니다.',
  });
};
