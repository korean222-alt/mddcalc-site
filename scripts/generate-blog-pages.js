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

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function extractPosts() {
  const html = fs.readFileSync(path.join(SITE_ROOT, 'blog.html'), 'utf8');
  const m = html.match(/const BLOG_POSTS = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('blog.html 에서 BLOG_POSTS 배열을 찾지 못했습니다.');
  // 신뢰된 1차 콘텐츠(직접 작성한 자체 데이터)를 빌드 시점에만 평가 — 외부 입력 없음
  return new Function('return ' + m[1])();
}

function buildPostPage(post, related) {
  const canonical = `https://mddcalc.com/blog/${post.id}.html`;
  const description = post.excerpt;
  const relatedHtml = related.map(p =>
    `<a href="/blog/${p.id}.html" class="related-chip">${escapeHtml(p.title)}</a>`
  ).join('');

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
  "@type": "BlogPosting",
  "headline": "${escapeHtml(post.title)}",
  "description": "${escapeHtml(description)}",
  "datePublished": "${escapeHtml(post.date)}",
  "articleSection": "${escapeHtml(post.tag)}",
  "url": "${canonical}"
}
</script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Pretendard", "Malgun Gothic", sans-serif;
         background: linear-gradient(135deg, #f0f4f8 0%, #e8ecf1 100%); color: #1a202c; line-height: 1.75; padding: 16px; }
  .container { max-width: 720px; margin: 0 auto; }
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
  .note { font-size: 12px; color: #a0aec0; margin-top: 16px; }
</style>
</head>
<body>
<div class="container">
  <nav class="crumbs"><a href="/">MDD 분석기</a> &gt; <a href="/blog.html">블로그</a></nav>
  <div class="card">
    <article>${post.content}</article>
    <div class="related">
      <div class="related-title">다른 글도 보기</div>
      ${relatedHtml}
    </div>
    <p class="note">본 콘텐츠는 정보 제공 목적이며 투자 자문이 아닙니다.</p>
  </div>
</div>
</body>
</html>
`;
}

function updateSitemap(posts) {
  let xml = fs.existsSync(SITEMAP_PATH) ? fs.readFileSync(SITEMAP_PATH, 'utf8') : '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n';
  xml = xml.replace(/\s*<url><loc>https:\/\/mddcalc\.com\/blog\/[^<]+<\/loc><priority>0\.6<\/priority><\/url>/g, '');
  const entries = posts.map(p =>
    `  <url><loc>https://mddcalc.com/blog/${p.id}.html</loc><priority>0.6</priority></url>`
  ).join('\n');
  xml = xml.replace('</urlset>', entries + '\n</urlset>');
  fs.writeFileSync(SITEMAP_PATH, xml);
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

  for (const post of posts) {
    const related = posts.filter(p => p.id !== post.id).slice(0, 3);
    const html = buildPostPage(post, related);
    fs.writeFileSync(path.join(OUT_DIR, `${post.id}.html`), html);
  }
  console.log(`✅ ${posts.length}개 블로그 글 정적 페이지 생성 완료 (/blog/1.html ~ /blog/${posts.length}.html)`);

  updateSitemap(posts);
  console.log('✅ sitemap.xml 갱신 완료');

  const { patchedFiles, patchedLinks } = patchInternalLinks();
  console.log(`✅ 내부 링크 치환: ${patchedFiles}개 파일에서 총 ${patchedLinks}개 링크를 /blog.html?post=N → /blog/N.html 로 변경`);
}

main();
