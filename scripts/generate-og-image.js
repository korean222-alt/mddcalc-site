#!/usr/bin/env node
/**
 * scripts/og-template.html 을 1200x630 이미지로 구워 미리보기 썸네일을 만든다.
 * 홈은 og-image.jpg, 나머지 페이지는 og/<이름>.jpg 로 나온다.
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

// 페이지마다 다른 썸네일을 굽는다.
//
// 전에는 홈 한 장뿐이라, 섹터 RS·히트맵·공포탐욕 링크를 카톡에 붙이면 썸네일이 아예 없거나
// (og:image 미지정) 홈 이미지가 떠서 "고점 대비 얼마나 떨어졌을까?" 라는 엉뚱한 카드가 나왔다.
// 무엇을 여는 링크인지 카드만 봐도 알게 한다.
const PAGES = [
  {
    out: 'og-image.jpg',            // 홈은 이미 이 경로로 색인·공유돼 있어 그대로 둔다
    title: '고점 대비 <span class="hl">얼마나</span><br>떨어졌을까?',
    sub: '종목만 입력하면 최대 낙폭(MDD)과 과거 회복 패턴까지',
    chips: ['미국 주식 · ETF', '국내 주식 · 지수', '가입 없이 무료'],
  },
  {
    out: 'og/fear-greed.jpg',
    title: '지금 시장은<br><span class="hl">공포</span>인가 <span class="hl">탐욕</span>인가',
    sub: '미국은 CNN 공식 지수 그대로, 한국은 같은 방식으로 계산',
    chips: ['0 ~ 100 한 숫자', '매 거래일 갱신', '지표별 근거 공개'],
  },
  {
    out: 'og/sector-rs.jpg',
    title: '어느 섹터로<br><span class="hl">돈이 몰리나</span>',
    sub: '한국·미국 섹터를 시장 대비 강한 순으로 줄 세웁니다',
    chips: ['상대강도 RS 1~99', '거래대금 비중', '외국인 소진율'],
  },
  {
    out: 'og/heatmap.jpg',
    title: '오늘 <span class="hl">어디에</span><br>돈이 몰렸나',
    sub: '칸 크기는 거래대금, 색은 등락률 — 한 화면에서',
    chips: ['한국 · 미국', 'AI · 성장 테마', '1일 ~ 12개월'],
  },
  {
    out: 'og/tools.jpg',
    title: '무료 주식 분석<br><span class="hl">도구 11종</span>',
    sub: 'MDD · RSI · 배당 · 복리 · 환율 · 레버리지 ETF까지',
    chips: ['가입 없이 무료', '광고 외 결제 없음', '계산식 공개'],
  },
];
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
const template = fs.readFileSync(TEMPLATE, 'utf8');

// 한 장 굽기. 자리표시자를 갈아 끼운 임시 HTML 을 만들어 스크린샷을 뜬다.
function render(page) {
  // 전역 치환입니다. 문자열 replace 는 첫 번째만 바꾸는데, 그것 때문에 자리표시자를 그대로
  // 적어 둔 주석이 먼저 걸려서 제목이 "{{TITLE}}" 로 찍힌 이미지가 나온 적이 있습니다.
  const html = template
    .replace(/\{\{TITLE\}\}/g, page.title)
    .replace(/\{\{SUB\}\}/g, page.sub)
    .replace(/\{\{CHIPS\}\}/g, page.chips.map(c => `<span class="chip">${c}</span>`).join('\n      '));
  const src = path.join(tmpDir, 'page.html');
  fs.writeFileSync(src, html);
  return src;
}

try {
  for (const page of PAGES) {
  const OUT = path.join(ROOT, page.out);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const SRC = render(page);

  // 헤드리스 크롬은 PNG 로만 스크린샷을 뜬다. JPEG 변환은 아래에서 캔버스로 처리한다.
  execFileSync(chrome, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${WIDTH},${SHOT_HEIGHT}`,
    `--screenshot=${tmpPng}`,
    'file://' + SRC,
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
  console.log(`✅ ${page.out} (${WIDTH}x${HEIGHT}, ${kb}KB)`);
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
