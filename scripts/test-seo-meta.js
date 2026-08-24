#!/usr/bin/env node
// 색인용 메타데이터 회귀 테스트.   실행: node scripts/test-seo-meta.js
//
// 이 파일이 있는 이유:
//   heatmap.html 은 sector-rs.html 을 복제해 만들었는데, title·description 뿐 아니라
//   <link rel="canonical"> 까지 그대로였습니다. canonical 이 남의 주소를 가리키면 검색엔진은
//   그 페이지를 "사본"으로 보고 색인에서 지웁니다. sitemap 에 올려도, 링크를 아무리 걸어도
//   검색 결과에 나오지 않습니다. 그런데 화면은 멀쩡히 잘 뜹니다 — 눈으로는 절대 알 수 없고,
//   몇 달 뒤 "왜 이 페이지만 검색이 안 되지?" 로 발견하게 됩니다.
//
//   페이지를 복제해 만드는 일은 앞으로도 계속 있을 것이므로, 그때마다 여기서 잡습니다.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://mddcalc.com';

// 색인 대상이 아닌 페이지(있으면 여기에 적습니다). 지금은 없습니다.
const SKIP = new Set([]);

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`✅ ${label}`); }
  catch (err) { console.error(`❌ ${label}\n   ${err.message}`); failed++; }
};

const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && !SKIP.has(f));

const meta = new Map();
for (const file of pages) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const one = re => { const m = src.match(re); return m ? m[1].trim() : null; };
  meta.set(file, {
    title: one(/<title>([\s\S]*?)<\/title>/i),
    desc: one(/<meta\s+name="description"\s+content="([^"]*)"/i),
    canonical: one(/<link\s+rel="canonical"\s+href="([^"]*)"/i),
    ogUrl: one(/<meta\s+property="og:url"\s+content="([^"]*)"/i),
    ogTitle: one(/<meta\s+property="og:title"\s+content="([^"]*)"/i),
    robots: one(/<meta\s+name="robots"\s+content="([^"]*)"/i),
    src,
  });
}

// 파일 이름 → 그 페이지의 정식 주소. index.html 만 루트로 정규화합니다.
const urlOf = file => (file === 'index.html' ? ORIGIN + '/' : ORIGIN + '/' + file);

check('모든 페이지에 canonical 이 있고, 자기 자신을 가리킨다', () => {
  const wrong = [];
  for (const [file, m] of meta) {
    if (!m.canonical) { wrong.push(`${file}: canonical 없음`); continue; }
    if (m.canonical !== urlOf(file)) wrong.push(`${file}: ${m.canonical} (있어야 할 값 ${urlOf(file)})`);
  }
  assert.deepStrictEqual(wrong, [], '\n     ' + wrong.join('\n     '));
});

check('og:url 도 자기 자신을 가리킨다', () => {
  const wrong = [];
  for (const [file, m] of meta) {
    if (m.ogUrl && m.ogUrl !== urlOf(file)) wrong.push(`${file}: ${m.ogUrl}`);
  }
  assert.deepStrictEqual(wrong, [], '\n     ' + wrong.join('\n     '));
});

check('title 이 페이지마다 다르다', () => {
  const seen = new Map();
  const dups = [];
  for (const [file, m] of meta) {
    assert.ok(m.title, `${file}: <title> 이 없습니다`);
    if (seen.has(m.title)) dups.push(`"${m.title}" — ${seen.get(m.title)}, ${file}`);
    else seen.set(m.title, file);
  }
  assert.deepStrictEqual(dups, [], '\n     ' + dups.join('\n     '));
});

check('description 이 페이지마다 다르다', () => {
  const seen = new Map();
  const dups = [];
  for (const [file, m] of meta) {
    assert.ok(m.desc, `${file}: description 이 없습니다`);
    if (seen.has(m.desc)) dups.push(`"${m.desc.slice(0, 40)}…" — ${seen.get(m.desc)}, ${file}`);
    else seen.set(m.desc, file);
  }
  assert.deepStrictEqual(dups, [], '\n     ' + dups.join('\n     '));
});

check('og:title 이 페이지마다 다르다', () => {
  const seen = new Map();
  const dups = [];
  for (const [file, m] of meta) {
    if (!m.ogTitle) continue;
    if (seen.has(m.ogTitle)) dups.push(`"${m.ogTitle}" — ${seen.get(m.ogTitle)}, ${file}`);
    else seen.set(m.ogTitle, file);
  }
  assert.deepStrictEqual(dups, [], '\n     ' + dups.join('\n     '));
});

// sitemap 과 실제 페이지가 어긋나면, 만든 페이지가 조용히 색인되지 않거나
// 없는 페이지를 크롤러에게 계속 권하게 됩니다.
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const sitemapUrls = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]));

check('색인 대상 페이지가 모두 sitemap 에 있다', () => {
  const missing = [];
  for (const [file, m] of meta) {
    if (m.robots && /noindex/i.test(m.robots)) continue;
    if (!sitemapUrls.has(urlOf(file))) missing.push(`${file} → ${urlOf(file)}`);
  }
  assert.deepStrictEqual(missing, [], '\n     ' + missing.join('\n     '));
});

check('sitemap 의 주소에 해당하는 파일이 실제로 있다', () => {
  const missing = [];
  for (const url of sitemapUrls) {
    if (!url.startsWith(ORIGIN)) { missing.push(`${url}: 다른 도메인`); continue; }
    let rel = url.slice(ORIGIN.length);
    if (rel === '' || rel === '/') rel = '/index.html';
    if (!fs.existsSync(path.join(ROOT, rel))) missing.push(url);
  }
  assert.deepStrictEqual(missing, [], '\n     ' + missing.join('\n     '));
});

// 페이지를 새로 만들 때 JSON-LD 를 붙였다가 쉼표 하나로 깨뜨리는 일이 흔합니다.
// 깨진 구조화 데이터는 화면에 아무 표시도 남기지 않고 그냥 무시됩니다.
check('JSON-LD 가 전부 파싱된다', () => {
  const broken = [];
  for (const [file, m] of meta) {
    for (const block of m.src.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { JSON.parse(block[1]); }
      catch (e) { broken.push(`${file}: ${e.message}`); }
    }
  }
  assert.deepStrictEqual(broken, [], '\n     ' + broken.join('\n     '));
});

console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);
