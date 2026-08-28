#!/usr/bin/env node
// 네비게이션 링크 정합성 테스트.   실행: node scripts/test-nav-links.js
//
// 이 파일이 있는 이유:
//   PAGE_URLS 표가 두 벌 있습니다. assets/site.js 에 하나, index.html 안에 인라인으로
//   하나. index.html 은 홈 전용 기능(통화 표기·공유 이미지) 때문에 site.js 를 쓰지 않고
//   같은 코드를 복제해 갖고 있기 때문입니다.
//
//   섹터 페이지를 추가하면서 site.js 쪽에만 넣고 index.html 쪽을 빠뜨렸습니다. 그 결과
//   홈에서 "섹터 RS" 를 누르면 navigate('sector') 가 주소를 찾지 못해 '/' 로 가고,
//   홈이 그대로 새로고침됐습니다. 링크가 죽은 게 아니라 제자리로 돌아오는 것이라
//   눈으로는 "눌러도 아무 일이 없다" 로만 보입니다.
//
//   두 표가 어긋나면 여기서 잡습니다.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// const PAGE_URLS = { ... }; 블록에서 키를 뽑습니다.
function pageUrlsOf(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = src.match(/const PAGE_URLS = \{([\s\S]*?)\n\};/);
  assert.ok(m, `${file} 에서 PAGE_URLS 를 찾지 못했습니다`);
  const map = {};
  for (const pair of m[1].matchAll(/(\w+)\s*:\s*'([^']+)'/g)) map[pair[1]] = pair[2];
  return map;
}

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`✅ ${label}`); }
  catch (err) { console.error(`❌ ${label}\n   ${err.message}`); failed++; }
};

const shared = pageUrlsOf('assets/site.js');
const home = pageUrlsOf('index.html');

check('두 PAGE_URLS 표의 키가 같다', () => {
  const a = Object.keys(shared).sort();
  const b = Object.keys(home).sort();
  const onlyShared = a.filter(k => !b.includes(k));
  const onlyHome = b.filter(k => !a.includes(k));
  assert.deepStrictEqual(
    { onlyShared, onlyHome }, { onlyShared: [], onlyHome: [] },
    `assets/site.js 에만: [${onlyShared}] / index.html 에만: [${onlyHome}]`
  );
});

check('두 표의 주소가 같다', () => {
  for (const k of Object.keys(shared)) {
    assert.strictEqual(home[k], shared[k], `'${k}' 주소가 다릅니다`);
  }
});

check('navigate() 가 부르는 페이지가 모두 표에 있다', () => {
  const missing = [];
  for (const file of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of src.matchAll(/navigate\('(\w+)'\)/g)) {
      if (!shared[m[1]] || !home[m[1]]) missing.push(`${file} → navigate('${m[1]}')`);
    }
  }
  assert.deepStrictEqual([...new Set(missing)], [], '표에 없는 페이지를 부릅니다');
});

// 페이지를 기존 페이지에서 복제해 만들 때, 이미 들어 있는 링크를 한 번 더 넣기 쉽습니다.
// 실제로 히트맵 페이지에 "섹터 RS" 링크가 두 개 들어가 네비게이션에 같은 항목이 두 번
// 보였습니다. id 가 중복되면 document.getElementById 도 앞의 것만 집습니다.
check('네비게이션 id 가 페이지마다 한 번씩만 나온다', () => {
  const dups = [];
  for (const file of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const counts = {};
    for (const m of src.matchAll(/id="(nav-[\w-]+)"/g)) counts[m[1]] = (counts[m[1]] || 0) + 1;
    for (const [id, n] of Object.entries(counts)) if (n > 1) dups.push(`${file}: ${id} × ${n}`);
  }
  assert.deepStrictEqual(dups, [], '중복된 네비게이션 id');
});

check('표의 주소에 해당하는 파일이 실제로 있다', () => {
  const missing = [];
  for (const [key, url] of Object.entries(shared)) {
    const file = url === '/' ? 'index.html' : url.replace(/^\//, '');
    if (!fs.existsSync(path.join(ROOT, file))) missing.push(`${key} → ${url}`);
  }
  assert.deepStrictEqual(missing, [], '파일이 없는 주소');
});

check('종목 리포트와 블로그 글에 사이트 헤더·푸터가 있다', () => {
  const missing = [];
  for (const dir of ['stock', 'blog']) {
    const folder = path.join(ROOT, dir);
    for (const f of fs.readdirSync(folder).filter(x => x.endsWith('.html'))) {
      const src = fs.readFileSync(path.join(folder, f), 'utf8');
      const rel = `${dir}/${f}`;
      if (!src.includes('class="site-header"')) missing.push(`${rel}: header 없음`);
      if (!src.includes('class="site-footer"')) missing.push(`${rel}: footer 없음`);
      if (!src.includes('id="siteNav"')) missing.push(`${rel}: siteNav 없음`);
      if (!/href="\/privacy.html"/.test(src)) missing.push(`${rel}: 개인정보 처리방침 링크 없음`);
      if (!/href="\/terms.html"/.test(src)) missing.push(`${rel}: 이용약관 링크 없음`);
      if (!/href="\/disclaimer.html"/.test(src)) missing.push(`${rel}: 면책조항 링크 없음`);
      if (!/href="\/contact.html"/.test(src)) missing.push(`${rel}: 문의 링크 없음`);
      if (!/href="\/"$/.test(src) && !/href="\/"/.test(src)) missing.push(`${rel}: 홈 링크 없음`);
      // 이 페이지들은 site.js 를 안 쓰므로 SPA navigate 로 클릭을 가로채면 안 된다.
      if (/onclick="navigate\('[^']+'\);\s*return false;"/.test(src)) {
        missing.push(`${rel}: navigate()+return false 가 있어 스크립트 없이 클릭이 막힘`);
      }
    }
  }
  assert.deepStrictEqual(missing, [], missing.join('\n     '));
});

check('계산 방식 페이지가 소개·사이트맵에 연결되어 있다', () => {
  const about = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8');
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  assert.ok(about.includes('href="/methodology.html"'), 'about.html 에 methodology 링크가 없습니다');
  assert.ok(fs.existsSync(path.join(ROOT, 'methodology.html')), 'methodology.html 파일이 없습니다');
  assert.ok(sitemap.includes('https://mddcalc.com/methodology.html'), 'sitemap 에 methodology 가 없습니다');
  assert.strictEqual(shared.methodology, '/methodology.html', 'assets/site.js PAGE_URLS 에 methodology 가 없습니다');
  assert.strictEqual(home.methodology, '/methodology.html', 'index.html PAGE_URLS 에 methodology 가 없습니다');
});

check('공개 HTML 푸터에 계산 방식 페이지 링크가 있다', () => {
  const missing = [];
  const skipDir = new Set(['data', 'docs', 'scripts', 'api', 'vendor', 'og', 'node_modules']);
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (!skipDir.has(f) && !f.startsWith('.')) walk(p);
      } else if (f.endsWith('.html')) {
        const src = fs.readFileSync(p, 'utf8');
        if (!src.includes('href="/methodology.html"')) {
          missing.push(path.relative(ROOT, p));
        }
      }
    }
  };
  walk(ROOT);
  assert.deepStrictEqual(missing, [], missing.join('\n     '));
});

check('종목 리포트와 블로그 본문에 좌우 여백이 있다', () => {
  const missing = [];
  for (const dir of ['stock', 'blog']) {
    const folder = path.join(ROOT, dir);
    for (const f of fs.readdirSync(folder).filter(x => x.endsWith('.html'))) {
      const src = fs.readFileSync(path.join(folder, f), 'utf8');
      if (!/\.container \{ max-width: \d+px; margin: 0 auto; padding: 0 16px; \}/.test(src)) {
        missing.push(`${dir}/${f}`);
      }
    }
  }
  assert.deepStrictEqual(missing, [], missing.join('\n     '));
});

check('도구 카드가 크롤러가 따라갈 수 있는 링크다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools.html'), 'utf8');
  assert.ok(!/<div class="tool-card"/.test(src), '도구 카드가 아직 div 입니다');
  const cards = [...src.matchAll(/<a class="tool-card" href="([^"]+)"/g)];
  assert.strictEqual(cards.length, 12, `도구 카드 ${cards.length}개 (12개여야 함)`);
  const missing = [];
  for (const m of cards) {
    const file = m[1] === '/' ? 'index.html' : m[1].replace(/^\//, '');
    if (!fs.existsSync(path.join(ROOT, file))) missing.push(m[1]);
  }
  assert.deepStrictEqual(missing, [], '없는 주소를 가리키는 카드');
  assert.ok(!src.includes('25개 글'), '도구 페이지가 글 수를 25개로 적고 있습니다');
});

check('소개 페이지 description 태그가 닫혀 있다', () => {
  const about = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8');
  assert.ok(
    !/name="description"\s+content="[^"]*"\s*>>/.test(about),
    'about.html description 뒤에 닫는 꺾쇠가 하나 더 있습니다'
  );
});


console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);
