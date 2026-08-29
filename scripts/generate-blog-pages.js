// scripts/generate-blog-pages.js
//
// 왜 필요한가
// -----------
// blog.html 이 글 25개를 전부 "/blog.html?post=1" 같은 쿼리스트링 하나로만
// 보여주고, canonical이 무조건 "https://mddcalc.com/blog.html" 로 고정돼
// 있어서 구글 입장에선 "글 25개"가 아니라 "blog.html 페이지 1개"로만 보인다.
// (지난번 종목 티커 페이지랑 정확히 같은 문제)
//
// 이 스크립트는 API 호출이 필요 없다 — blog.html 안에 이미 있는
// BLOG_POSTS 배열(제목/본문 다 포함)을 그대로 읽어서 글마다 정적 페이지
// (/blog/1.html, /blog/2.html ...)로 구워내고, 각 페이지가 자기 자신을
// 가리키는 canonical을 갖게 만든다. 그리고 사이트 전체에 있는
// "/blog.html?post=N" 링크들도 새 URL로 자동 치환한다.
//
// 실행: node scripts/generate-blog-pages.js   (환경변수/API 키 불필요)

const fs = require('fs');
const path = require('path');

const SITE_ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(SITE_ROOT, 'blog');
const SITEMAP_PATH = path.join(SITE_ROOT, 'sitemap.xml');
const ADSENSE_CLIENT = 'ca-pub-5583100002281558';
// sitemap 에 처음 써넣는 임시 lastmod 값. 이 스크립트 끝에서 scripts/sitemap-lastmod.js 가
// 각 파일의 실제 git 커밋 날짜로 다시 덮어쓰므로, 결과물에는 보통 이 날짜가 남지 않는다.
// (아직 한 번도 커밋되지 않은 새 글에만 남는다.)
const SITEMAP_FALLBACK_DATE = '2026-08-29';

// 읽기 시간은 저장하지 않고 본문에서 계산한다. 예전에는 posts-data.js 의 readTime 필드를
// 손으로 적었는데, 글을 고쳐도 숫자를 같이 안 고쳐서 17편 전부가 실제 분량의 1.2~1.4배로
// 부풀어 있었다 (예: 1,506자짜리 글이 "4분 읽기"). 계산해서 쓰면 어긋날 수가 없다.
// 한국어 성인 묵독 속도는 분당 500~600자로 보는 자료가 많아 500자를 기준으로 잡았다.
const CHARS_PER_MINUTE = 500;
function readingTime(contentHtml) {
  const text = String(contentHtml)
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, '');
  return `${Math.max(1, Math.round(text.length / CHARS_PER_MINUTE))}분`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


// 글 데이터의 단일 원본. 예전에는 blog.html 인라인 JS에서 배열을 긁어왔지만,
// 그 60KB짜리 블록을 모든 페이지에서 걷어내고 scripts/posts-data.js 로 분리했다.
const { BLOG_POSTS, RELATED_POSTS, CTA_MAP, TICKER_RELATED_POSTS, RETIRED_POSTS } = require('./posts-data.js');
const { chromeCss, headerHtml, footerHtml, chromeScript } = require('./site-chrome');

// TICKER_RELATED_POSTS(티커 → 글 id[])를 반대로 뒤집어서 글 id → 티커[] 로.
// generate-stock-pages.js가 만드는 /stock/{ticker}.html 쪽에서 이 글로 링크하니,
// 이 글에서도 그 리포트로 되돌아가는 링크를 넣어 상호 링크를 만든다.
const POST_RELATED_TICKERS = {};
for (const [ticker, ids] of Object.entries(TICKER_RELATED_POSTS)) {
  for (const id of ids) {
    (POST_RELATED_TICKERS[id] = POST_RELATED_TICKERS[id] || []).push(ticker);
  }
}
function extractPosts() {
  if (!Array.isArray(BLOG_POSTS) || !BLOG_POSTS.length) {
    throw new Error('scripts/posts-data.js 에서 BLOG_POSTS 를 읽지 못했습니다.');
  }
  // 내린 글은 페이지를 만들지 않는다. 이유는 posts-data.js 의 RETIRED_POSTS 주석 참고.
  const retired = RETIRED_POSTS || new Set();
  const live = BLOG_POSTS.filter(p => !retired.has(p.id));
  if (!live.length) throw new Error('살아 있는 글이 하나도 없습니다 — RETIRED_POSTS 를 확인하세요.');
  return live;
}

// 글 하단 "다른 글도 보기".
//
// 예전에는 posts.filter(...).slice(0, 3) 이라 모든 글이 1·2·3번만 가리켰다. RELATED_POSTS
// 라는 매핑이 있는데도 쓰이지 않고 있었던 것이다. 종목 페이지에서 고쳤던 링크 편중과 같은
// 문제 — 뒤쪽 글로는 들어오는 링크가 아예 생기지 않는다.
// 이제 RELATED_POSTS 를 쓰되, 거기 적힌 글이 내려갔으면 건너뛰고 순환식으로 채운다.
function pickRelated(post, posts) {
  const liveIds = new Set(posts.map(p => p.id));
  const byId = new Map(posts.map(p => [p.id, p]));
  const picked = [];
  for (const id of (RELATED_POSTS[post.id] || [])) {
    if (id !== post.id && liveIds.has(id) && !picked.includes(id)) picked.push(id);
  }
  // 3개가 안 되면 자기 다음 글부터 순환식으로 채운다.
  const i = posts.findIndex(p => p.id === post.id);
  for (let k = 1; picked.length < 3 && k <= posts.length; k++) {
    const cand = posts[(i + k) % posts.length];
    if (cand.id !== post.id && !picked.includes(cand.id)) picked.push(cand.id);
  }
  return picked.slice(0, 3).map(id => byId.get(id));
}

// index.html의 PAGE_URLS와 같은 매핑. 글 안 CTA가 'page' 타입일 때 실제 주소로 바꾸는 데 쓴다.
const PAGE_URLS = {
  home: '/', tools: '/tools.html', rsi: '/rsi-calculator.html', dividend: '/dividend-calculator.html',
  blog: '/blog.html', about: '/about.html', contact: '/contact.html', privacy: '/privacy.html',
  disclaimer: '/disclaimer.html', terms: '/terms.html', fx: '/fx-calculator.html', roi: '/roi-calculator.html',
  compound: '/compound-calculator.html', leverage: '/leverage-etf-simulator.html', dca: '/dca-planner.html',
};

// 글 하단 CTA. 예전에는 blog.html의 JS(getCtaHtml)가 클릭 시 navigate 하는 방식이었는데,
// 정적 페이지로 옮기며 그 함수 자체가 통째로 빠져서 CTA_MAP 데이터는 남았지만 버튼이
// 어디에도 그려지지 않고 있었다 — 홈의 실제 계산 결과로 가는 유일한 경로였던 만큼 실제
// <a href> 링크로 복원한다 (JS 없이도, 크롤러도 그대로 따라갈 수 있도록).
// 글에서 매일 갱신되는 화면으로 보내는 링크.
//
// 예전에는 글에 상단 네비게이션이 없었습니다. 읽는 데 방해라는 이유로 뺐는데,
// 그 결과 글 17편이 사이트 메뉴·푸터 없이 고립됐고, 크롤러와 심사자가 글을 열면
// 이 사이트의 다른 화면으로 가는 길이 본문 아래 칩 세 개뿐이었습니다.
// 지금은 scripts/site-chrome.js 의 헤더·푸터를 붙입니다. 아래 세 링크는 본문 맥락용입니다.
const MARKET_LINKS_HTML = `
    <div class="related">
      <div class="related-title">지금 시장은 어떤가</div>
      <a href="/fear-greed.html" class="related-chip">😱 공포·탐욕 지수 — 지금 시장 심리</a><a href="/sector-rs.html" class="related-chip">📊 섹터 상대강도(RS) — 어디로 돈이 몰리나</a><a href="/heatmap.html" class="related-chip">🔥 주식 히트맵 — 오늘의 등락 지도</a>
    </div>`;

function buildCtaHtml(postId) {
  const cta = CTA_MAP[postId];
  if (!cta) return '';
  let href;
  if (cta.type === 'ticker') href = `/?ticker=${encodeURIComponent(cta.value)}`;
  else if (cta.type === 'page') href = PAGE_URLS[cta.value] || '/';
  else href = '/';
  return `
    <div class="cta-box">
      <div class="cta-text">👉 지금 배운 내용을 실제 데이터로 확인해보세요</div>
      <a href="${href}" class="cta-btn">${escapeHtml(cta.label)}</a>
    </div>`;
}

// 본문 맨 위 메타줄은 생성기가 통째로 다시 쓴다. 본문 HTML 에 글자로 박아두고 목록 카드는
// 별도 필드를 쓰던 예전 방식은 반드시 어긋났다 — 글을 늘렸을 때 목록은 6분, 본문은 4분이 됐다.
//
// 발행일은 더 이상 쓰지 않는다. 예전에는 17편 전부가 2026-01-15 ~ 05-20 사이 날짜를 5일 간격으로
// 달고 있었는데, 사이트 개설이 2026-07 이라 전부 사이트가 있기도 전의 날짜였다. 화면 텍스트와
// JSON-LD datePublished 양쪽에 박혀 있어서 없던 발행 이력을 주장하는 꼴이었다.
// 지어낸 발행일 대신 실제로 손댄 날(updated)만 밝힌다.
function metaLine(post) {
  return `<div class="article-meta">📅 최종 수정 ${escapeHtml(post.updated)} &nbsp;&bull;&nbsp; ⏱ ${readingTime(post.content)} 읽기</div>`;
}
function syncMeta(html, post) {
  return html.replace(/<div class="article-meta">[\s\S]*?<\/div>/, () => metaLine(post));
}

function buildPostPage(post, related) {
  const canonical = `https://mddcalc.com/blog/${post.id}.html`;
  const description = post.excerpt;
  const content = syncMeta(post.content, post);
  const relatedHtml = related.map(p =>
    `<a href="/blog/${p.id}.html" class="related-chip">${escapeHtml(p.title)}</a>`
  ).join('');
  const relatedTickers = POST_RELATED_TICKERS[post.id] || [];
  const tickerReportHtml = relatedTickers.length ? `
    <div class="related">
      <div class="related-title">실데이터 리포트</div>
      ${relatedTickers.map(t => `<a href="/stock/${t.toLowerCase()}.html" class="related-chip">${t} 하락 구간 전체 보기</a>`).join('')}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(post.title)} | MDD 분석기 블로그</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(post.title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="MDD 분석기">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "MDD 분석기", "item": "https://mddcalc.com/" },
    { "@type": "ListItem", "position": 2, "name": "투자 가이드", "item": "https://mddcalc.com/blog.html" },
    { "@type": "ListItem", "position": 3, "name": "${escapeHtml(post.title)}", "item": "https://mddcalc.com/blog/${post.id}.html" }
  ]
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "${escapeHtml(post.title)}",
  "description": "${escapeHtml(description)}",
  "dateModified": "${escapeHtml(post.updated)}",
  "articleSection": "${escapeHtml(post.tag)}",
  "inLanguage": "ko",
  "url": "${canonical}",
  "mainEntityOfPage": { "@type": "WebPage", "@id": "${canonical}" },
  "author": {
    "@type": "Person",
    "name": "MDD 분석기 운영자",
    "description": "개인 투자자이자 개발자. 투자자문업 등록 사업자가 아니며, 공개된 표준 계산식과 공개 시세 데이터만을 사용해 콘텐츠를 작성합니다.",
    "url": "https://mddcalc.com/about.html",
    "email": "gktgkt2309@gmail.com"
  },
  "publisher": {
    "@type": "Organization",
    "name": "MDD 분석기",
    "url": "https://mddcalc.com/"
  },
  "isAccessibleForFree": true
}
</script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Pretendard", "Malgun Gothic", sans-serif;
         background: linear-gradient(135deg, #f0f4f8 0%, #e8ecf1 100%); color: #1a202c; line-height: 1.75; padding: 0; }
  .container { max-width: 720px; margin: 0 auto; padding: 0 16px; }
  a { color: #4299e1; }
  .card { background: #fff; border-radius: 14px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
  nav.crumbs { font-size: 13px; margin-bottom: 12px; color: #718096; }
  .article-meta { font-size: 13px; color: #a0aec0; margin: 4px 0 20px; }
  .highlight-box { background: #f7fafc; border-left: 3px solid #4299e1; border-radius: 6px; padding: 12px 16px; margin: 14px 0; }
  h1 { font-size: 24px; margin-bottom: 4px; color: #2d3748; }
  h2 { font-size: 19px; margin: 22px 0 10px; color: #2d3748; }
  p { margin-bottom: 12px; }
  ul { margin: 10px 0 14px 20px; } li { margin-bottom: 6px; }
  .related { margin-top: 20px; padding-top: 16px; border-top: 1px solid #edf2f7; }
  .related-title { font-size: 13px; color: #718096; margin-bottom: 8px; }
  .related-chip { display: inline-block; background: #edf2f7; color: #2d3748; padding: 6px 12px;
                  border-radius: 20px; font-size: 13px; font-weight: 600; margin: 0 6px 6px 0; text-decoration: none; }
  .note { font-size: 12px; color: #a0aec0; margin-top: 16px; line-height: 1.7; }
  .author-box { display: flex; gap: 14px; align-items: flex-start; margin-top: 26px; padding: 16px;
                background: #f7fafc; border-radius: 10px; border: 1px solid #edf2f7; }
  .author-avatar { flex: none; width: 44px; height: 44px; border-radius: 50%; background: #edf2f7;
                   display: flex; align-items: center; justify-content: center; font-size: 22px; }
  .author-name { font-size: 14px; font-weight: 700; color: #2d3748; margin-bottom: 4px; }
  .author-bio { font-size: 13px; color: #718096; line-height: 1.7; margin: 0; }
  .cta-box { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
             background: #ebf8ff; border-radius: 10px; padding: 14px 18px; margin-top: 20px; }
  .cta-text { font-size: 14px; color: #2c5282; font-weight: 600; }
  .cta-btn { display: inline-block; background: #2b6cb0; color: #fff !important; padding: 9px 18px; border-radius: 8px;
             font-size: 14px; font-weight: 700; text-decoration: none; white-space: nowrap; }
  .cta-btn:hover { background: #2c5282; }
${chromeCss()}
</style>
</head>
<body>
${headerHtml('blog')}
<div class="container">
  <nav class="crumbs"><a href="/">MDD 분석기</a> &gt; <a href="/blog.html">블로그</a></nav>
  <div class="card">
    <article>${content}</article>
    ${buildCtaHtml(post.id)}
    <div class="author-box">
      <div class="author-avatar">📊</div>
      <div>
        <div class="author-name">MDD 분석기 운영자</div>
        <p class="author-bio">
          개인 투자자이자 개발자입니다. 고점 대비 하락률을 매번 손으로 계산하기 번거로워 만든 도구를 무료로 공개하고 있습니다.
          투자자문업·금융투자업 등록 사업자가 아니며, 특정 종목이나 상품을 추천하지 않습니다.
          글에 쓰인 계산식은 모두 공개된 표준 공식이고, 시세 출처와 계산 순서는 <a href="/methodology.html">숫자는 어떻게 계산하나</a>에 모아 두었습니다.
          미국 종목은 Twelve Data, 한국 종목은 네이버 금융의 종가를 사용합니다.
          내용에 오류가 있으면 <a href="mailto:gktgkt2309@gmail.com">gktgkt2309@gmail.com</a> 으로 알려주세요. 확인 후 수정합니다.
          <a href="/about.html">운영 원칙 자세히 보기 →</a>
        </p>
      </div>
    </div>
    <div class="related">
      <div class="related-title">다른 글도 보기</div>
      ${relatedHtml}
    </div>
    ${tickerReportHtml}
    ${MARKET_LINKS_HTML}
    <p class="note">
      📅 최종 수정 ${escapeHtml(post.updated)}<br>
      본 글은 정보 제공 및 교육 목적으로 작성되었으며 투자 자문이 아닙니다. 과거 데이터는 미래 수익을 보장하지 않고,
      주식 투자에는 원금 손실 위험이 있습니다. 투자 판단과 그 결과에 대한 책임은 투자자 본인에게 있습니다.
    </p>
  </div>
</div>
${footerHtml()}
${chromeScript()}
</body>
</html>
`;
}

// 사이트맵의 모든 항목에 lastmod 를 넣는다. 이게 없으면 구글은 페이지가 언제
// 바뀌었는지 알 수 없어 재크롤링 우선순위를 낮게 잡는다.
function updateSitemap(posts) {
  let xml = fs.existsSync(SITEMAP_PATH) ? fs.readFileSync(SITEMAP_PATH, 'utf8') : '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n';
  xml = xml.replace(/\s*<url><loc>https:\/\/mddcalc\.com\/blog\/[^<]+<\/loc>[\s\S]*?<\/url>/g, '');
  // 블로그·종목 리포트를 제외한 나머지 정적 페이지에만 lastmod 를 붙이거나 갱신한다.
  // /stock/ 항목은 generate-stock-pages.js가 실제로 데이터를 다시 받아온 날짜로 따로 관리하므로
  // 여기서 건드리면 방금 갱신한 실제 기준일을 이 스크립트의 마지막 편집일로 덮어써 버리게 된다.
  xml = xml.replace(/<url><loc>(https:\/\/mddcalc\.com\/(?!stock\/)[^<]*)<\/loc>(?:<lastmod>[^<]*<\/lastmod>)?(<priority>[^<]*<\/priority>)<\/url>/g,
    (_m, loc, prio) => `<url><loc>${loc}</loc><lastmod>${SITEMAP_FALLBACK_DATE}</lastmod>${prio}</url>`);
  const entries = posts.map(p =>
    `  <url><loc>https://mddcalc.com/blog/${p.id}.html</loc><lastmod>${escapeHtml(p.updated)}</lastmod><priority>0.6</priority></url>`
  ).join('\n');
  xml = xml.replace('</urlset>', entries + '\n</urlset>');
  fs.writeFileSync(SITEMAP_PATH, xml);
}

// blog.html 안의 정적 글 목록(그리드)을 BLOG_POSTS 기준으로 재생성.
// 크롤러가 JS 실행 없이도 글 25개의 링크를 전부 볼 수 있어야 하므로
// 목록은 JS 렌더가 아니라 정적 HTML로 유지한다.
function updateBlogIndex(posts) {
  const p = path.join(SITE_ROOT, 'blog.html');
  let html = fs.readFileSync(p, 'utf8');
  const cards = posts.map(post => `    <a class="blog-card" href="/blog/${post.id}.html" style="display:block; text-decoration:none; color:inherit;">
      <div class="blog-card-img" style="background:${post.bg}">${post.emoji}</div>
      <div class="blog-card-body">
        <div class="blog-card-tag">${escapeHtml(post.tag)}</div>
        <div class="blog-card-title">${escapeHtml(post.title)}</div>
        <div class="blog-card-excerpt">${escapeHtml(post.excerpt)}</div>
        <div class="blog-card-meta">최종 수정 ${escapeHtml(post.updated)} &bull; ${readingTime(post.content)} 읽기</div>
      </div>
    </a>`).join('\n');
  const block = `<!-- BLOG_GRID_STATIC:START -->\n${cards}\n<!-- BLOG_GRID_STATIC:END -->`;
  const markerRe = /<!-- BLOG_GRID_STATIC:START -->[\s\S]*?<!-- BLOG_GRID_STATIC:END -->/;
  if (markerRe.test(html)) {
    html = html.replace(markerRe, () => block);
  } else if (html.includes('<div class="blog-grid" id="blogGrid"></div>')) {
    html = html.replace('<div class="blog-grid" id="blogGrid"></div>',
      () => `<div class="blog-grid" id="blogGrid">\n${block}\n</div>`);
  } else {
    throw new Error('blog.html 에서 blogGrid 컨테이너를 찾지 못했습니다.');
  }
  fs.writeFileSync(p, html);
}

// 사이트 전체에서 "/blog.html?post=N" 링크를 "/blog/N.html" 로 치환
function patchInternalLinks() {
  const files = fs.readdirSync(SITE_ROOT).filter(f => f.endsWith('.html'));
  let patchedFiles = 0, patchedLinks = 0;
  for (const f of files) {
    const p = path.join(SITE_ROOT, f);
    let html = fs.readFileSync(p, 'utf8');
    const before = html;
    html = html.replace(/\/blog\.html\?post=(\d+)/g, (m, id) => { patchedLinks++; return `/blog/${id}.html`; });
    if (html !== before) {
      fs.writeFileSync(p, html);
      patchedFiles++;
    }
  }
  return { patchedFiles, patchedLinks };
}

function main() {
  const posts = extractPosts();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 내린 글의 파일이 남아 있으면 지운다. 남겨두면 사이트맵·목록에는 없는데 URL 로는
  // 열리는 상태가 되어, 크롤러가 어디서도 링크되지 않는 페이지를 계속 들고 있게 된다.
  const retired = RETIRED_POSTS || new Set();
  let removed = 0;
  for (const id of retired) {
    const p = path.join(OUT_DIR, `${id}.html`);
    if (fs.existsSync(p)) { fs.unlinkSync(p); removed++; }
  }
  if (removed) console.log(`🗑  내린 글 파일 ${removed}개 삭제 (vercel.json 이 301 로 대체 글에 연결)`);

  for (const post of posts) {
    const html = buildPostPage(post, pickRelated(post, posts));
    fs.writeFileSync(path.join(OUT_DIR, `${post.id}.html`), html);
  }
  console.log(`✅ ${posts.length}개 블로그 글 정적 페이지 생성 완료 (내린 글 ${retired.size}개 제외)`);

  updateBlogIndex(posts);
  console.log('✅ blog.html 정적 글 목록 갱신 완료');

  updateSitemap(posts);
  console.log('✅ sitemap.xml 갱신 완료');

  const { patchedFiles, patchedLinks } = patchInternalLinks();
  console.log(`✅ 내부 링크 치환: ${patchedFiles}개 파일에서 총 ${patchedLinks}개 링크를 /blog.html?post=N → /blog/N.html 로 변경`);

  // RSS 피드도 같은 BLOG_POSTS 를 쓴다. 여기서 같이 돌려야 글을 고쳤을 때 피드가 뒤처지지 않는다.
  const run = script =>
    require('child_process').execFileSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit' });
  run('generate-rss.js');

  // 위 updateSitemap 은 lastmod 를 SITEMAP_FALLBACK_DATE 로 일괄로 찍어놓는다. 그대로 두면 손대지도
  // 않은 페이지 40개의 수정일이 거짓이 되므로, 마지막에 실제 커밋 날짜로 되돌린다.
  run('sitemap-lastmod.js');
}

main();
