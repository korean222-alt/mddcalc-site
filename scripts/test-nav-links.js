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

check('표의 주소에 해당하는 파일이 실제로 있다', () => {
  const missing = [];
  for (const [key, url] of Object.entries(shared)) {
    const file = url === '/' ? 'index.html' : url.replace(/^\//, '');
    if (!fs.existsSync(path.join(ROOT, file))) missing.push(`${key} → ${url}`);
  }
  assert.deepStrictEqual(missing, [], '파일이 없는 주소');
});

console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);
