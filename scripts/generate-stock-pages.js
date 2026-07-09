// scripts/generate-stock-pages.js
//
// 왜 필요한가
// -----------
// 지금 index.html 은 티커를 "/?ticker=NVDA" 쿼리스트링 + 클라이언트 JS로만 보여주고,
// <link rel="canonical" href="https://mddcalc.com/"> 가 모든 티커에 동일하게 박혀 있어서
// 구글 입장에서는 "NVDA 페이지"라는 게 아예 존재하지 않는다 (전부 홈페이지로 합쳐짐).
//
// 이 스크립트는 빌드 시점(로컬 or CI)에 한 번 Twelve Data를 호출해서
// 티커별 정적 HTML(/stock/nvda.html 등)을 실제 숫자가 박힌 채로 미리 만들어 둔다.
// 방문자가 올 때마다 API를 부르는 게 아니라 "빌드할 때 한 번"만 부르므로
// 800회/일 한도와 무관하게 안전하다.
//
// 실행: TWELVE_DATA_API_KEY=xxxx node scripts/generate-stock-pages.js
//
// 배포 연동 (Vercel):
//   Project Settings → Build Command 를
//   "node scripts/generate-stock-pages.js && echo done"
//   로 바꾸면 매 배포마다 자동으로 재생성된다.
//   숫자를 매일 최신으로 유지하려면 GitHub Actions cron으로 하루 1회
//   빈 커밋(or Vercel Deploy Hook) 을 트리거해서 재배포되게 하면 된다.

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.TWELVE_DATA_API_KEY;
if (!API_KEY) {
  console.error('❌ TWELVE_DATA_API_KEY 환경변수가 없습니다. export TWELVE_DATA_API_KEY=... 후 재실행하세요.');
  process.exit(1);
}

const SITE_ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(SITE_ROOT, 'stock');
const SITEMAP_PATH = path.join(SITE_ROOT, 'sitemap.xml');
const ADSENSE_CLIENT = 'ca-pub-5583100002281558';

// 한국 서학개미들이 실제로 많이 검색하는 티커 위주. 필요하면 자유롭게 추가/삭제.
const TICKERS = [
  'NVDA', 'TSLA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NFLX',
  'TQQQ', 'SOXL', 'SPXL', 'UPRO', 'SQQQ', 'SOXS', 'FNGU', 'TECL',
  'SPY', 'QQQ', 'VOO', 'VTI', 'SCHD', 'JEPI', 'JEPQ',
  'AMD', 'AVGO', 'SMCI', 'ARM', 'MU', 'TSM', 'INTC',
  'PLTR', 'COIN', 'MSTR', 'RIVN', 'LCID', 'NIO', 'BABA', 'DIS', 'BA',
];

const RATE_LIMIT_PER_MIN = 8; // twelve data 무료 티어
const DELAY_MS = Math.ceil(60000 / RATE_LIMIT_PER_MIN) + 500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchSeries(symbol) {
  const url = new URL('https://api.twelvedata.com/time_series');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', '1day');
  url.searchParams.set('outputsize', '5000');
  url.searchParams.set('apikey', API_KEY);

  const res = await fetch(url.toString());
  const json = await res.json();
  if (json.status === 'error' || !json.values) {
    throw new Error(json.message || `${symbol}: no data`);
  }
  return json.values; // newest first, like the front-end expects
}

// index.html 의 analyze() 를 그대로 이식 (mode='high' 기본값과 동일한 로직)
function analyze(data) {
  const n = data.length;
  const peakSeries = data.map(d => d.high);
  const closes = data.map(d => d.close);
  const dates = data.map(d => d.date);

  const runMax = new Array(n);
  let mx = -Infinity, mxIdx = 0;
  const mxIdxArr = new Array(n);
  for (let i = 0; i < n; i++) {
    if (peakSeries[i] > mx) { mx = peakSeries[i]; mxIdx = i; }
    runMax[i] = mx;
    mxIdxArr[i] = mxIdx;
  }
  const dd = closes.map((c, i) => (c / runMax[i] - 1) * 100);

  const currentPrice = closes[n - 1];
  const currentDD = dd[n - 1];
  const currentDate = dates[n - 1];
  const athPrice = runMax[n - 1];
  const athIdx = mxIdxArr[n - 1];
  const athDate = dates[athIdx];

  let maxDD = 0, maxDDIdx = 0;
  for (let i = 0; i < n; i++) {
    if (dd[i] < maxDD) { maxDD = dd[i]; maxDDIdx = i; }
  }

  return {
    currentPrice, currentDD, currentDate,
    athPrice, athDate,
    maxDD, maxDDDate: dates[maxDDIdx],
  };
}

function fmt(n, d = 2) {
  return n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPct(n, d = 2) {
  return n == null || isNaN(n) ? '—' : Number(n).toFixed(d) + '%';
}
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 최근 5년만 사용 (index.html 의 기본 setPreset(5) 와 동일)
function last5Years(rows) {
  const latest = new Date(rows[rows.length - 1].date);
  const cutoff = new Date(latest);
  cutoff.setFullYear(cutoff.getFullYear() - 5);
  return rows.filter(r => new Date(r.date) >= cutoff);
}

function buildPage(ticker, A) {
  const drop = Math.abs(A.currentDD).toFixed(1);
  const isNearATH = Math.abs(A.currentDD) < 1;
  const title = isNearATH
    ? `${ticker} 지금 사도 될까? 사상 최고가 근접 | MDD 분석기`
    : `${ticker} 지금 사도 될까? 고점 대비 ${drop}% 하락 | MDD 분석기`;
  const description = isNearATH
    ? `${ticker}는 현재 사상 최고가(ATH) 부근입니다. 과거 하락·회복 패턴과 최대 낙폭(MDD)을 무료로 확인하세요.`
    : `${ticker}는 고점(ATH) 대비 ${drop}% 하락한 상태입니다. 역대 최대 낙폭 ${fmtPct(A.maxDD)}, 현재가 $${fmt(A.currentPrice)}. 과거 회복 패턴을 무료로 확인하세요.`;
  const canonical = `https://mddcalc.com/stock/${ticker.toLowerCase()}.html`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="MDD 분석기">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FinancialProduct",
  "name": "${escapeHtml(ticker)} MDD(최대낙폭) 분석",
  "description": "${escapeHtml(description)}",
  "url": "${canonical}"
}
</script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Pretendard", "Malgun Gothic", sans-serif;
         background: linear-gradient(135deg, #f0f4f8 0%, #e8ecf1 100%); color: #1a202c; line-height: 1.6; padding: 16px; }
  .container { max-width: 760px; margin: 0 auto; }
  a { color: #4299e1; }
  .card { background: #fff; border-radius: 14px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
  h1 { font-size: 26px; margin-bottom: 8px; color: #2d3748; }
  .subtitle { color: #718096; margin-bottom: 20px; font-size: 14px; }
  .stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 16px 0; }
  .stat { background: #f7fafc; border-radius: 10px; padding: 14px; }
  .stat .label { font-size: 12px; color: #718096; margin-bottom: 4px; }
  .stat .value { font-size: 20px; font-weight: 700; color: #2d3748; }
  .neg { color: #e53e3e; } .pos { color: #38a169; }
  .cta { display: inline-block; margin-top: 12px; padding: 12px 20px; background: #2d3748; color: #fff;
         border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px; }
  .note { font-size: 12px; color: #a0aec0; margin-top: 16px; }
  nav.crumbs { font-size: 13px; margin-bottom: 12px; color: #718096; }
</style>
</head>
<body>
<div class="container">
  <nav class="crumbs"><a href="/">MDD 분석기</a> &gt; <a href="/tools.html">도구 모음</a> &gt; ${escapeHtml(ticker)}</nav>
  <div class="card">
    <h1>${escapeHtml(ticker)} 지금 사도 될까?</h1>
    <p class="subtitle">고점(ATH) 대비 하락률과 과거 회복 패턴 — 기준일 ${escapeHtml(A.currentDate)}</p>

    <div class="stat-grid">
      <div class="stat">
        <div class="label">현재가</div>
        <div class="value">$${fmt(A.currentPrice)}</div>
      </div>
      <div class="stat">
        <div class="label">고점 대비 (ATH: $${fmt(A.athPrice)}, ${escapeHtml(A.athDate)})</div>
        <div class="value ${A.currentDD < -0.01 ? 'neg' : 'pos'}">${fmtPct(A.currentDD)}</div>
      </div>
      <div class="stat">
        <div class="label">최근 5년 최대 낙폭(MDD)</div>
        <div class="value neg">${fmtPct(A.maxDD)}</div>
      </div>
      <div class="stat">
        <div class="label">최대 낙폭 발생일</div>
        <div class="value">${escapeHtml(A.maxDDDate)}</div>
      </div>
    </div>

    <p>${escapeHtml(ticker)}는 현재 고점 대비 <strong>${fmtPct(A.currentDD)}</strong> 하락한 상태입니다.
    최근 5년 기준 가장 크게 떨어졌던 시점은 <strong>${escapeHtml(A.maxDDDate)}</strong>이며,
    당시 고점 대비 <strong>${fmtPct(A.maxDD)}</strong>까지 낙폭이 커졌습니다.
    아래에서 이동평균, SPY 대비 상대강도, 과거 유사 하락 이후 평균 회복 기간까지 무료로 확인할 수 있습니다.</p>

    <a class="cta" href="/?ticker=${encodeURIComponent(ticker)}">${escapeHtml(ticker)} 전체 분석 보기 →</a>
    <p class="note">본 페이지는 정보 제공 목적이며 투자 자문이 아닙니다. 데이터 기준일: ${escapeHtml(A.currentDate)}</p>
  </div>
</div>
</body>
</html>
`;
}

function updateSitemap(tickers) {
  let xml = fs.existsSync(SITEMAP_PATH) ? fs.readFileSync(SITEMAP_PATH, 'utf8') : '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n';

  // 기존에 이 스크립트가 넣어둔 /stock/ 항목은 지우고 새로 채워서 중복 방지
  xml = xml.replace(/\s*<url><loc>https:\/\/mddcalc\.com\/stock\/[^<]+<\/loc><priority>0\.6<\/priority><\/url>/g, '');

  const entries = tickers.map(t =>
    `  <url><loc>https://mddcalc.com/stock/${t.toLowerCase()}.html</loc><priority>0.6</priority></url>`
  ).join('\n');

  xml = xml.replace('</urlset>', entries + '\n</urlset>');
  fs.writeFileSync(SITEMAP_PATH, xml);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ok = [];
  const failed = [];

  for (const ticker of TICKERS) {
    try {
      process.stdout.write(`${ticker} ... `);
      const values = await fetchSeries(ticker);
      const rows = values.map(v => ({
        date: v.datetime, open: parseFloat(v.open), high: parseFloat(v.high),
        low: parseFloat(v.low), close: parseFloat(v.close),
      })).reverse();
      const windowed = last5Years(rows);
      const A = analyze(windowed);
      const html = buildPage(ticker, A);
      fs.writeFileSync(path.join(OUT_DIR, `${ticker.toLowerCase()}.html`), html);
      console.log(`OK (${fmtPct(A.currentDD)})`);
      ok.push(ticker);
    } catch (e) {
      console.log(`FAIL (${e.message})`);
      failed.push(ticker);
    }
    await sleep(DELAY_MS); // 무료 티어 분당 8회 한도 준수
  }

  updateSitemap(ok);
  console.log(`\n완료: ${ok.length}개 생성, ${failed.length}개 실패`);
  if (failed.length) console.log('실패한 티커:', failed.join(', '));
}

main();
