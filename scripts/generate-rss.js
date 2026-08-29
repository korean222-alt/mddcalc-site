#!/usr/bin/env node
/**
 * 블로그 RSS 피드(/rss.xml)를 만든다.
 *
 * 사용법:
 *   node scripts/generate-rss.js
 *   (generate-blog-pages.js 끝에서도 자동으로 불린다 — 글을 고치면 피드가 같이 따라간다)
 *
 * 왜 RSS 인가:
 * 구글 노출에는 거의 영향이 없다. 실제 값어치는 **네이버 서치어드바이저가 사이트맵과 별개로
 * RSS 제출을 받는다**는 점이다. 한국어 사이트라 이 경로가 의미가 있다.
 * Feedly 같은 리더 유입은 덤이다.
 *
 * 등록은 한 번만 손으로 하면 된다:
 *   네이버 서치어드바이저 > 요청 > RSS 제출 > https://mddcalc.com/rss.xml
 */
const fs = require('fs');
const path = require('path');
const { BLOG_POSTS, RETIRED_POSTS } = require('./posts-data.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'rss.xml');
const ORIGIN = 'https://mddcalc.com';
const TITLE = 'MDD 분석기 블로그';
const DESCRIPTION = '고점 대비 하락률(MDD)과 주식 하락·회복 패턴에 대한 글을 씁니다.';
const MAX_ITEMS = 25;

// XML 특수문자 이스케이프. 제목/요약에 &, <, 따옴표가 들어가면 피드가 통째로 깨진다.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// RSS 2.0 의 pubDate 는 RFC 822 형식이어야 한다. 'YYYY-MM-DD' 를 그대로 넣으면 안 된다.
// 시간 정보가 없으므로 한국시간 09:00 으로 고정한다(= UTC 00:00).
function toRFC822(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  return d.toUTCString();
}

function main() {
  if (!Array.isArray(BLOG_POSTS) || !BLOG_POSTS.length) {
    console.error('❌ scripts/posts-data.js 에서 BLOG_POSTS 를 읽지 못했습니다.');
    process.exit(1);
  }

  // 최신 글이 위로 오게 정렬한다. 날짜가 같으면 id 가 큰 쪽이 최신이다.
  // 내린 글(RETIRED_POSTS)은 /blog/{id}.html 자체가 생성되지 않으므로 피드에서도 뺀다.
  // 빼지 않으면 구독자에게 404 로 가는 링크를 보내게 된다.
  const retired = RETIRED_POSTS || new Set();
  const posts = BLOG_POSTS
    .filter(p => !retired.has(p.id))
    .sort((a, b) => (a.updated === b.updated ? b.id - a.id : (a.updated < b.updated ? 1 : -1)))
    .slice(0, MAX_ITEMS);

  const skipped = [];
  const items = posts.map(p => {
    const url = `${ORIGIN}/blog/${p.id}.html`;
    // 발행일은 쓰지 않는다 (posts-data.js 의 주석 참고 — 지어낸 날짜였다).
    // 실제로 손댄 날짜를 그대로 내보낸다.
    const pubDate = toRFC822(p.updated);
    if (!pubDate) skipped.push(`${p.id} (날짜 '${p.updated}' 를 해석하지 못함)`);
    return [
      '    <item>',
      `      <title>${esc(p.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      pubDate ? `      <pubDate>${pubDate}</pubDate>` : null,
      p.tag ? `      <category>${esc(p.tag)}</category>` : null,
      `      <description>${esc(p.excerpt || p.title)}</description>`,
      '    </item>',
    ].filter(Boolean).join('\n');
  }).join('\n');

  const latest = posts.map(p => toRFC822(p.updated)).find(Boolean) || new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(TITLE)}</title>
    <link>${ORIGIN}/blog.html</link>
    <description>${esc(DESCRIPTION)}</description>
    <language>ko</language>
    <lastBuildDate>${latest}</lastBuildDate>
    <atom:link href="${ORIGIN}/rss.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;

  fs.writeFileSync(OUT, xml);
  if (skipped.length) {
    console.warn(`⚠️  pubDate 를 넣지 못한 글 ${skipped.length}개: ${skipped.join(', ')}`);
  }
  console.log(`✅ rss.xml 생성 완료 (글 ${posts.length}개)`);
}

main();
