#!/usr/bin/env node
/**
 * 새로 올라갔거나 내용이 바뀐 페이지를 IndexNow 로 검색엔진에 바로 알린다.
 *
 * IndexNow 를 받는 곳: 빙(Bing), 네이버, 얀덱스, Seznam 등.
 * 구글은 IndexNow 를 쓰지 않는다. 구글 쪽은 sitemap.xml 의 lastmod 가 정확한지에 달려 있고,
 * 그건 scripts/sitemap-lastmod.js 가 맡는다. 즉 이 스크립트는 "구글 말고 나머지" 담당이다.
 *
 * 사용법:
 *   node scripts/submit-indexnow.js index.html blog/3.html   지정한 파일만 알린다
 *   node scripts/submit-indexnow.js --all                     sitemap 의 전체 URL 을 알린다
 *   node scripts/submit-indexnow.js --dry-run ...             보내지 않고 보낼 목록만 출력
 *
 * 키는 공개되는 값이다(검증용으로 사이트 루트에 같은 이름의 .txt 를 올려둬야 한다).
 * 비밀이 아니므로 저장소에 그대로 두는 게 정상이다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOST = 'mddcalc.com';
const ORIGIN = 'https://' + HOST;
const KEY = '3a437d1698d094bb66ae274682805aa8';
const KEY_FILE = path.join(ROOT, KEY + '.txt');
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_URLS = 10000; // IndexNow 1회 요청 상한

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALL = args.includes('--all');
const files = args.filter(a => !a.startsWith('--'));

// 사이트 루트의 키 파일이 없으면 검색엔진이 소유 검증에 실패해 요청 전체가 거부된다.
// 보내기 전에 먼저 막는다.
if (!fs.existsSync(KEY_FILE)) {
  console.error(`❌ 키 파일이 없습니다: ${KEY}.txt`);
  console.error('   이 파일이 사이트 루트에 그대로 올라가 있어야 IndexNow 가 동작합니다.');
  process.exit(1);
}
if (fs.readFileSync(KEY_FILE, 'utf8').trim() !== KEY) {
  console.error(`❌ ${KEY}.txt 의 내용이 키와 다릅니다. 파일 안에는 키 문자열만 있어야 합니다.`);
  process.exit(1);
}

function urlsFromSitemap() {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
}

// 저장소 상대경로 → 공개 URL. index.html 은 루트로 정규화한다 (canonical 과 맞춰야 한다).
function fileToUrl(file) {
  const rel = path.relative(ROOT, path.resolve(ROOT, file)).split(path.sep).join('/');
  if (rel.startsWith('..')) return null;
  if (!rel.endsWith('.html')) return null;
  if (rel === 'index.html') return ORIGIN + '/';
  return ORIGIN + '/' + rel;
}

function collectUrls() {
  if (ALL) return urlsFromSitemap();
  const known = new Set(urlsFromSitemap());
  const urls = [];
  for (const f of files) {
    const url = fileToUrl(f);
    if (!url) continue;
    // sitemap 에 없는 페이지(noindex 인 mdd.html 등)는 알릴 이유가 없다.
    if (!known.has(url)) { console.log(`   (건너뜀, sitemap 에 없음) ${f}`); continue; }
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

async function main() {
  const urlList = collectUrls();

  if (!urlList.length) {
    console.log('알릴 URL 이 없습니다 — 아무것도 보내지 않습니다.');
    return;
  }
  if (urlList.length > MAX_URLS) {
    console.error(`❌ URL 이 ${urlList.length}개로 1회 상한(${MAX_URLS})을 넘습니다.`);
    process.exit(1);
  }

  console.log(`IndexNow 로 알릴 URL ${urlList.length}개:`);
  for (const u of urlList.slice(0, 20)) console.log('   - ' + u);
  if (urlList.length > 20) console.log(`   ... 외 ${urlList.length - 20}개`);

  if (DRY_RUN) {
    console.log('\n--dry-run 이라 실제로 보내지 않았습니다.');
    return;
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: `${ORIGIN}/${KEY}.txt`,
      urlList,
    }),
  });

  const body = await res.text().catch(() => '');

  // IndexNow 는 200(수락) 과 202(수락, 키 검증 대기중) 를 모두 정상으로 본다.
  if (res.status === 200 || res.status === 202) {
    console.log(`\n✅ 전송 완료 (HTTP ${res.status}) — ${urlList.length}개 URL`);
    return;
  }
  // 여기서 실패해도 사이트 배포 자체는 이미 끝난 상태다. 색인 통보가 늦어질 뿐이라
  // 워크플로 전체를 실패로 만들지 않고 경고만 남긴다.
  console.error(`\n⚠️  전송 실패 (HTTP ${res.status}) ${body.slice(0, 300)}`);
  if (res.status === 403) {
    console.error(`   403 은 보통 ${ORIGIN}/${KEY}.txt 가 아직 배포되지 않았을 때 납니다.`);
  }
  process.exitCode = 0;
}

main().catch(err => {
  console.error('⚠️  전송 중 오류:', err.message);
  process.exitCode = 0;
});
