// 종목 리포트·블로그 글처럼 SPA 스크립트(/assets/site.js)를 쓰지 않는 페이지의
// 상단 메뉴·하단 푸터. 심사자가 이런 글을 무작위로 열었을 때 "사이트 안의 한 페이지"가
// 아니라 "링크 없는 고립 문서"로 보이면 네비게이션 거절 사유가 된다.
//
// 이 페이지들에는 navigate() 가 없으므로 href 만 둔다. onclick="navigate(); return false"
// 를 붙이면 스크립트가 없는 상태에서 클릭이 먹히지 않는다.

const NAV_ITEMS = [
  { id: 'home', href: '/', label: '🏠 홈' },
  { id: 'sector', href: '/sector-rs.html', label: '📊 섹터 RS' },
  { id: 'heatmap', href: '/heatmap.html', label: '🔥 히트맵' },
  { id: 'feargreed', href: '/fear-greed.html', label: '😱 공탐지수' },
  { id: 'tools', href: '/tools.html', label: '🔧 도구' },
  { id: 'blog', href: '/blog.html', label: '📚 투자 가이드' },
  { id: 'about', href: '/about.html', label: 'ℹ️ 소개' },
  { id: 'contact', href: '/contact.html', label: '✉️ 문의' },
];

function chromeCss() {
  return `
  .site-header { background: #2d3748; color: #fff; padding: 0; margin: 0 0 16px 0; position: relative; }
  .site-header .header-inner { max-width: 1200px; margin: 0 auto; padding: 0 16px; display: flex; align-items: center; justify-content: space-between; height: 56px; }
  .site-logo { font-size: 18px; font-weight: 800; color: #fff !important; text-decoration: none; }
  .site-logo:hover { color: #90cdf4 !important; }
  .site-nav { display: flex; gap: 4px; align-items: center; }
  .site-nav a { color: #cbd5e0 !important; text-decoration: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 500; white-space: nowrap; }
  .site-nav a:hover, .site-nav a.active { background: rgba(255,255,255,0.15); color: #fff !important; }
  .nav-hamburger { display: none; background: none; border: none; color: #fff; font-size: 22px; cursor: pointer; padding: 4px 8px; }
  @media (max-width: 900px) and (min-width: 769px) {
    .site-nav a { padding: 6px 7px; font-size: 12px; }
  }
  @media (max-width: 768px) {
    .nav-hamburger { display: block; }
    .site-nav { display: none; position: absolute; top: 56px; left: 0; right: 0; background: #2d3748; flex-direction: column; padding: 8px 16px 16px; z-index: 100; }
    .site-nav.open { display: flex; }
    .site-nav a { padding: 10px 12px; }
  }
  .site-footer { background: #2d3748; color: #a0aec0; margin: 40px 0 0; padding: 32px 16px 24px; }
  .site-footer .footer-inner { max-width: 1200px; margin: 0 auto; }
  .site-footer .footer-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 24px; margin-bottom: 24px; }
  .site-footer .footer-col h4 { color: #fff; font-size: 14px; font-weight: 700; margin-bottom: 12px; }
  .site-footer .footer-col a { display: block; color: #a0aec0 !important; text-decoration: none; font-size: 13px; margin-bottom: 6px; }
  .site-footer .footer-col a:hover { color: #fff !important; }
  .site-footer .footer-col p { font-size: 12px; line-height: 1.6; color: #a0aec0; margin: 0; }
  .site-footer .footer-bottom { border-top: 1px solid #4a5568; padding-top: 16px; font-size: 12px; text-align: center; }
  .site-footer .footer-disclaimer { font-size: 11px; color: #718096; margin-top: 8px; line-height: 1.5; }`;
}

function headerHtml(activeId) {
  const links = NAV_ITEMS.map(item => {
    const active = item.id === activeId ? ' class="active"' : '';
    return `      <a href="${item.href}" id="nav-${item.id}"${active}>${item.label}</a>`;
  }).join('\n');
  return `<header class="site-header">
  <div class="header-inner">
    <a class="site-logo" href="/">📊 MDD 분석기</a>
    <button type="button" class="nav-hamburger" onclick="toggleNav()" aria-label="메뉴">☰</button>
    <nav class="site-nav" id="siteNav">
${links}
    </nav>
  </div>
</header>`;
}

function footerHtml() {
  return `<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-grid">
      <div class="footer-col">
        <h4>📊 MDD 분석기</h4>
        <p>고점 대비 하락률(MDD)으로 하락 및 회복 패턴을 찾아주는 무료 주식 분석 도구입니다.</p>
      </div>
      <div class="footer-col">
        <h4>무료 계산기</h4>
        <a href="/">📊 MDD 계산기</a>
        <a href="/rsi-calculator.html">📈 RSI 계산기</a>
        <a href="/sector-rs.html">📊 섹터 상대강도(RS)</a>
        <a href="/heatmap.html">🔥 섹터 히트맵</a>
        <a href="/fear-greed.html">😱 공포·탐욕 지수</a>
        <a href="/tools.html">🔧 도구 모음</a>
      </div>
      <div class="footer-col">
        <h4>투자 가이드</h4>
        <a href="/blog.html">📚 모든 가이드 보기</a>
        <a href="/blog/1.html">MDD란 무엇인가?</a>
        <a href="/methodology.html">숫자는 어떻게 계산하나</a>
      </div>
      <div class="footer-col">
        <h4>사이트 정보</h4>
        <a href="/about.html">ℹ️ 소개</a>
        <a href="/contact.html">✉️ 문의하기</a>
        <a href="/privacy.html">🔒 개인정보 처리방침</a>
        <a href="/terms.html">📋 이용약관</a>
        <a href="/disclaimer.html">⚠️ 면책조항</a>
        <a href="mailto:gktgkt2309@gmail.com">📧 gktgkt2309@gmail.com</a>
      </div>
    </div>
    <div class="footer-bottom">
      <p>© 2026 MDD 분석기. All rights reserved.</p>
      <p class="footer-disclaimer">⚠️ 이 사이트에서 제공하는 모든 정보는 교육적 목적으로만 제공되며, 투자 권유나 재정 조언이 아닙니다. 주식 투자는 원금 손실의 위험이 있으며, 모든 투자 결정은 본인의 신중한 판단에 따라 진행하시기 바랍니다.</p>
    </div>
  </div>
</footer>`;
}

function chromeScript() {
  return `<script>
function toggleNav() {
  var n = document.getElementById('siteNav');
  if (n) n.classList.toggle('open');
}
</script>`;
}

// 이미 구워진 HTML 에 헤더·푸터를 심는다. 생성기를 다시 돌릴 수 없을 때(종목 페이지는
// API 키가 필요함) 기존 파일을 같은 마크업으로 맞추기 위해 쓴다.
function injectChrome(html, activeId) {
  if (html.includes('class="site-header"')) return html;
  html = html.replace(/line-height: 1\.(65|75); padding: 16px;/, 'line-height: 1.$1; padding: 0;');
  html = html.replace(
    /\.container \{ max-width: (\d+)px; margin: 0 auto; \}/,
    '.container { max-width: $1px; margin: 0 auto; padding: 0 16px; }'
  );
  if (!html.includes('.site-header {')) {
    html = html.replace('</style>', chromeCss() + '\n</style>');
  }
  html = html.replace('<body>\n<div class="container">', `<body>\n${headerHtml(activeId)}\n<div class="container">`);
  html = html.replace(/<\/div>\n<\/body>\n<\/html>\s*$/, `</div>\n${footerHtml()}\n${chromeScript()}\n</body>\n</html>\n`);
  return html;
}

module.exports = {
  NAV_ITEMS,
  chromeCss,
  headerHtml,
  footerHtml,
  chromeScript,
  injectChrome,
};
