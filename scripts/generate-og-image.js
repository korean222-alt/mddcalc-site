#!/usr/bin/env node
/**
 * scripts/og-template.html 을 1200x630 이미지로 구워 og-image.jpg 를 만든다.
 * 카카오톡·네이버·X 에 링크를 붙였을 때 뜨는 미리보기 썸네일이다.
 *
 * 사용법:  node scripts/generate-og-image.js
 *
 * npm 의존성 없이 로컬에 깔린 크롬(또는 크로미움)의 헤드리스 스크린샷 기능만 쓴다.
 * 자동으로 못 찾으면 CHROME_PATH 환경변수로 직접 알려주면 된다:
 *   CHROME_PATH=/usr/bin/google-chrome node scripts/generate-og-image.js
 *
 * 템플릿을 고쳤을 때만 다시 돌리면 된다. 결과물(og-image.jpg)은 저장소에 커밋되어 있다.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(__dirname, 'og-template.html');
const OUT = path.join(ROOT, 'og-image.jpg');
const WIDTH = 1200, HEIGHT = 630;
// 헤드리스 크롬의 --window-size 는 창 크기라 실제 뷰포트는 그보다 몇십 픽셀 낮게 잡힌다.
// (1200x630 을 요구하면 아래 85px 쯤이 흰 띠로 남는다.) 넉넉한 높이로 찍은 뒤 위쪽
// 1200x630 만 잘라내면 환경별 차이에 상관없이 항상 정확한 크기가 나온다.
const SHOT_HEIGHT = HEIGHT + 300;

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findChrome() {
  for (const p of CANDIDATES) {
    try { if (fs.statSync(p).isFile()) return p; } catch (_) { /* 다음 후보 */ }
  }
  // 경로가 고정돼 있지 않은 환경(플레이라이트 캐시 등)을 위해 한 단계 더 훑는다.
  const pw = '/opt/pw-browsers';
  try {
    for (const dir of fs.readdirSync(pw)) {
      const p = path.join(pw, dir, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch (_) { /* 없으면 넘어간다 */ }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  console.error('❌ 크롬을 찾지 못했습니다. CHROME_PATH 환경변수로 실행 파일 경로를 알려주세요.');
  console.error('   예) CHROME_PATH=/usr/bin/google-chrome node scripts/generate-og-image.js');
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-'));
const tmpPng = path.join(tmpDir, 'og.png');

try {
  // 헤드리스 크롬은 PNG 로만 스크린샷을 뜬다. JPEG 변환은 아래에서 캔버스로 처리한다.
  execFileSync(chrome, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${WIDTH},${SHOT_HEIGHT}`,
    `--screenshot=${tmpPng}`,
    'file://' + TEMPLATE,
  ], { stdio: 'pipe' });

  if (!fs.existsSync(tmpPng)) throw new Error('스크린샷 파일이 생성되지 않았습니다.');

  // PNG 로는 이 그라디언트 배경이 수백 KB 가 된다. 미리보기 썸네일은 JPEG 로 충분하다.
  const pngB64 = fs.readFileSync(tmpPng).toString('base64');
  const convert = path.join(tmpDir, 'convert.html');
  fs.writeFileSync(convert, `<html><body><script>
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = ${WIDTH}; c.height = ${HEIGHT};
      // 위쪽 1200x630 만 잘라 쓴다 (아래는 뷰포트 여백).
      c.getContext('2d').drawImage(img, 0, 0, ${WIDTH}, ${HEIGHT}, 0, 0, ${WIDTH}, ${HEIGHT});
      document.title = c.toDataURL('image/jpeg', 0.92);
    };
    img.src = 'data:image/png;base64,${pngB64}';
  </script></body></html>`);

  const dump = execFileSync(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox',
    '--virtual-time-budget=4000',
    '--dump-dom',
    'file://' + convert,
  ], { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 }).toString();

  const m = /<title>data:image\/jpeg;base64,([A-Za-z0-9+/=]+)<\/title>/.exec(dump);
  if (!m) throw new Error('JPEG 변환 결과를 읽지 못했습니다.');

  fs.writeFileSync(OUT, Buffer.from(m[1], 'base64'));
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`✅ og-image.jpg 생성 완료 (${WIDTH}x${HEIGHT}, ${kb}KB)`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
