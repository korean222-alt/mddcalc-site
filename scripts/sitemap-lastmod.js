#!/usr/bin/env node
/**
 * sitemap.xml 의 <lastmod> 를 각 파일이 마지막으로 커밋된 날짜로 맞춘다.
 *
 * 사용법:
 *   node scripts/sitemap-lastmod.js          실제로 고친다
 *   node scripts/sitemap-lastmod.js --check   고칠 게 있는지만 알려준다 (있으면 종료코드 1)
 *
 * lastmod 를 손으로 관리하면 반드시 실제 수정일과 어긋난다. 지금 sitemap 의 기본 페이지
 * 15개가 전부 2026-07-25 로 멈춰 있는 게 그 결과다. 크롤러는 lastmod 가 거짓이라고 판단하면
 * 그 뒤로는 아예 무시해버리기 때문에, 커밋 날짜라는 확실한 근거로 매번 다시 채운다.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const ORIGIN = 'https://mddcalc.com';
const CHECK_ONLY = process.argv.includes('--check');

// URL 하나를 저장소 안의 실제 파일 경로로 바꾼다. 루트(/)만 index.html 로 특별 취급한다.
function urlToFile(url) {
  if (!url.startsWith(ORIGIN)) return null;
  let rel = url.slice(ORIGIN.length);
  if (rel === '' || rel === '/') rel = '/index.html';
  return path.join(ROOT, decodeURIComponent(rel));
}

/**
 * 파일별 최신 커밋 날짜(YYYY-MM-DD)를 한 번의 git 호출로 모은다.
 * 파일마다 git log 를 부르면 109번 프로세스를 띄우게 되므로 전체 로그를 한 번만 훑는다.
 */
function lastCommitDates() {
  const out = execFileSync('git', ['log', '--pretty=format:%cs', '--name-only', '--no-renames'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
  });
  const dates = new Map();
  let current = null;
  for (const line of out.split('\n')) {
    if (line === '') continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(line)) { current = line; continue; }
    // git log 는 최신 커밋부터 내려오므로 먼저 만난 쪽이 최신이다.
    if (current && !dates.has(line)) dates.set(line, current);
  }
  return dates;
}

function main() {
  let xml = fs.readFileSync(SITEMAP, 'utf8');
  const dates = lastCommitDates();
  const missing = [];
  const changes = [];

  xml = xml.replace(
    /<loc>([^<]+)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g,
    (whole, url, oldDate) => {
      const file = urlToFile(url);
      if (!file || !fs.existsSync(file)) { missing.push(url); return whole; }
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const newDate = dates.get(rel);
      if (!newDate || newDate === oldDate) return whole;
      changes.push(`${rel}: ${oldDate} → ${newDate}`);
      return `<loc>${url}</loc><lastmod>${newDate}</lastmod>`;
    }
  );

  if (missing.length) {
    console.warn(`⚠️  sitemap 에 있는데 파일이 없는 URL ${missing.length}개 (그대로 둠):`);
    for (const u of missing.slice(0, 10)) console.warn('   - ' + u);
  }

  if (!changes.length) {
    console.log('✅ lastmod 가 모두 최신입니다 — 고칠 것 없음');
    return;
  }

  if (CHECK_ONLY) {
    console.log(`❗ lastmod 가 실제 수정일과 다른 URL ${changes.length}개:`);
    for (const c of changes) console.log('   - ' + c);
    process.exit(1);
  }

  fs.writeFileSync(SITEMAP, xml);
  console.log(`✅ lastmod ${changes.length}개 갱신`);
  for (const c of changes) console.log('   - ' + c);
}

main();
