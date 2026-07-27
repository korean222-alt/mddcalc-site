// scripts/generate-stock-pages.js
//
// 왜 다시 만드는가
// ---------------
// 이전 버전(/stock/*.html, 39개)은 종목당 442자 안팎이었고, 그마저도 설명을
// 두 문장에서 그라데이션으로 잘라내고 "무료로 전체 보기 →" 버튼으로 인터랙티브
// 계산기 쪽 클릭을 유도하는 구조였다. 이건 정확히 구글이 "낮은 가치의 콘텐츠"로
// 분류하는 패턴(완결된 답을 주지 않고 클릭을 유도하는 티저)이라 전부 삭제했다.
//
// 이번 버전은 정반대로 설계한다: 계산기가 실제로 계산하는 것과 동일한 원본
// 시세 데이터를 빌드 시점에 가져와서, 역대 주요 하락 구간 표·변동성·SPY 대비
// 비교까지 페이지 자체에 전부 담는다. 클릭을 유도해 콘텐츠를 완성시키는 구조가
// 아니라, 페이지 하나만 봐도 그 자체로 답이 되도록 만드는 것이 목표다.
//
// 실행: TWELVE_DATA_API_KEY=xxxx node scripts/generate-stock-pages.js
// (Twelve Data 무료 한도: 분당 8회 · 일 800회 — 15개 종목이면 넉넉하게 안전)

const fs = require('fs');
const path = require('path');

const SITE_ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(SITE_ROOT, 'stock');
const SITEMAP_PATH = path.join(SITE_ROOT, 'sitemap.xml');
const ADSENSE_CLIENT = 'ca-pub-5583100002281558';

const API_KEY = process.env.TWELVE_DATA_API_KEY;
if (!API_KEY) {
  console.error('❌ TWELVE_DATA_API_KEY 환경변수가 없습니다. TWELVE_DATA_API_KEY=xxxx node scripts/generate-stock-pages.js 로 실행하세요.');
  process.exit(1);
}

// 서학개미가 실제로 많이 찾는 종목들.
//
// 처음에는 품질 검증을 위해 핵심 15개로 시작했는데, 그 사이 구글 검색에
// /stock/baba.html 이 노출되는 걸 발견했다. 예전 얇은 버전(423자 티저) 39개를
// 지울 때 그중 24개가 이미 색인된 상태였고, 새 15개에 없는 것들이 전부 404가 된 것.
// 이미 색인·노출까지 얻은 URL을 버리는 셈이라 옛 목록 39개를 그대로 복원한다.
// 아래 두 번째 줄부터가 그 복원분이다.
const TICKERS = [
  'AAPL', 'TSLA', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META',
  'SPY', 'QQQ', 'VOO', 'VTI', 'SCHD', 'TQQQ', 'SOXL', 'AMD',
  // 아래 24개는 예전에 색인됐다가 404가 된 URL 복구분
  'NFLX', 'SPXL', 'UPRO', 'SQQQ', 'SOXS', 'FNGU', 'TECL', 'JEPI',
  'JEPQ', 'AVGO', 'SMCI', 'ARM', 'MU', 'TSM', 'INTC', 'PLTR',
  'COIN', 'MSTR', 'RIVN', 'LCID', 'NIO', 'BABA', 'DIS', 'BA',
];
const BENCHMARK = 'SPY'; // 상대 비교 기준 지수

const REFRESH_CYCLE_DAYS = 7; // 매주 자동 갱신 (.github/workflows/refresh-stock-pages.yml)
const TOP_N_DRAWDOWNS = 5;

// 이 리포트가 다루는 종목과 겹치는 블로그 글이 있으면 서로 링크한다.
// generate-blog-pages.js도 같은 매핑을 반대 방향으로 써서 상호 링크를 만든다.
const { TICKER_RELATED_POSTS } = require('./posts-data.js');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtPct(n) { return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`; }
function fmtPrice(n) { return `$${n.toFixed(2)}`; }
function fmtDate(d) { return d; } // 이미 YYYY-MM-DD 문자열

async function fetchSeries(symbol) {
  const url = new URL('https://api.twelvedata.com/time_series');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', '1day');
  url.searchParams.set('outputsize', '5000');
  url.searchParams.set('apikey', API_KEY);

  const res = await fetch(url.toString());
  const json = await res.json();

  if (json.status === 'error') throw new Error(`${symbol}: ${json.message}`);
  if (!json.values || !json.values.length) throw new Error(`${symbol}: 데이터 없음`);

  // Twelve Data는 최신순으로 내려주므로 오래된 순으로 뒤집는다
  return json.values.map(v => ({ date: v.datetime, close: parseFloat(v.close) })).reverse();
}

function daysBetween(d1, d2) {
  return Math.round((new Date(d2) - new Date(d1)) / 86400000);
}

// 고점→저점→회복(신고점 경신)을 하나의 "구간"으로 묶어 전부 계산.
// 마지막까지 회복 못 한 구간은 ongoing으로 별도 반환.
function computeDrawdowns(series) {
  const episodes = [];
  let peak = series[0].close, peakDate = series[0].date;
  let trough = null, troughDate = null;

  for (let i = 1; i < series.length; i++) {
    const { date, close } = series[i];
    if (close >= peak) {
      if (trough !== null) {
        episodes.push({
          peakDate, peakPrice: peak,
          troughDate, troughPrice: trough,
          declinePct: (trough - peak) / peak * 100,
          recoveryDate: date,
          recoveryDays: daysBetween(troughDate, date),
        });
        trough = null; troughDate = null;
      }
      peak = close; peakDate = date;
    } else if (trough === null || close < trough) {
      trough = close; troughDate = date;
    }
  }

  let ongoing = null;
  if (trough !== null) {
    ongoing = {
      peakDate, peakPrice: peak,
      troughDate, troughPrice: trough,
      declinePct: (trough - peak) / peak * 100,
      recoveryDate: null, recoveryDays: null,
    };
  }
  return { episodes, ongoing, athPrice: peak, athDate: peakDate };
}

// 연환산 변동성 (일간 로그수익률의 표준편차 × √252)
function annualizedVolatility(series) {
  const rets = [];
  for (let i = 1; i < series.length; i++) rets.push(Math.log(series[i].close / series[i - 1].close));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

// 하루하루의 "그 시점 고점 대비 낙폭"을 이어붙인 시계열.
// 현재 낙폭이 이 종목 역사에서 어느 정도 위치인지 백분위로 따질 때 쓴다.
function drawdownSeries(series) {
  const out = [];
  let peak = series[0].close;
  for (const p of series) {
    if (p.close > peak) peak = p.close;
    out.push((p.close - peak) / peak * 100);
  }
  return out;
}

function analyze(series) {
  const { episodes, ongoing, athPrice, athDate } = computeDrawdowns(series);
  const all = ongoing ? [...episodes, ongoing] : episodes;
  const top = [...all].sort((a, b) => a.declinePct - b.declinePct).slice(0, TOP_N_DRAWDOWNS);

  const last = series[series.length - 1];
  const currentDrawdownPct = (last.close - athPrice) / athPrice * 100;

  // -10/-20/-30/-50% 구간을 각각 몇 번이나 지나갔는지. 이 사이트의 핵심 개념(구간별 빈도)과
  // 같은 계산이고, 종목마다 값이 완전히 달라서 페이지의 고유성을 만드는 부분이기도 하다.
  const thresholds = [10, 20, 30, 50];
  const frequency = thresholds.map(th => ({
    threshold: th,
    count: all.filter(e => e.declinePct <= -th).length,
  }));

  // 회복 통계는 실제로 회복이 끝난 구간만 대상으로 한다 (진행 중인 구간은 기간이 확정되지 않음).
  const recovered = episodes.filter(e => e.recoveryDays != null);
  const recDays = recovered.map(e => e.recoveryDays).sort((a, b) => a - b);
  const recoveryStats = {
    recoveredCount: recovered.length,
    ongoingCount: ongoing ? 1 : 0,
    medianDays: recDays.length ? recDays[Math.floor(recDays.length / 2)] : null,
    maxDays: recDays.length ? recDays[recDays.length - 1] : null,
  };

  // 오늘보다 더 깊이 빠져 있던 거래일의 비율.
  const dd = drawdownSeries(series);
  const deeperDays = dd.filter(v => v < currentDrawdownPct).length;
  const deeperPct = dd.length ? deeperDays / dd.length * 100 : 0;

  return {
    startDate: series[0].date,
    endDate: last.date,
    years: (daysBetween(series[0].date, last.date) / 365.25),
    tradingDays: series.length,
    currentPrice: last.close,
    currentDate: last.date,
    athPrice, athDate,
    currentDrawdownPct,
    isAtAth: Math.abs(currentDrawdownPct) < 0.05,
    volatility: annualizedVolatility(series),
    topDrawdowns: top,
    worstDrawdownPct: top.length ? top[0].declinePct : 0,
    episodeCount: all.length,
    frequency,
    recoveryStats,
    deeperPct,
  };
}

function buildDrawdownTableHtml(top) {
  return top.map(d => `
        <tr>
          <td>${d.peakDate}<br><span class="muted">${fmtPrice(d.peakPrice)}</span></td>
          <td>${d.troughDate}<br><span class="muted">${fmtPrice(d.troughPrice)}</span></td>
          <td class="neg">${fmtPct(d.declinePct)}</td>
          <td>${d.recoveryDate ? `${d.recoveryDate}<br><span class="muted">${d.recoveryDays.toLocaleString()}일 소요</span>` : '<span class="ongoing">미회복 (진행 중)</span>'}</td>
        </tr>`).join('');
}

function buildFrequencyRowsHtml(a) {
  return a.frequency.map(f => {
    // 상장 기간이 짧은 종목은 주기가 1년 미만으로 나올 수 있어 개월 단위로 표기한다.
    let cycle = '해당 없음';
    if (f.count > 0) {
      const yrs = a.years / f.count;
      cycle = yrs >= 1 ? `약 ${yrs.toFixed(1)}년에 1회` : `약 ${Math.max(1, Math.round(yrs * 12))}개월에 1회`;
    }
    return `
        <tr>
          <td>-${f.threshold}% 이상 하락</td>
          <td class="${f.count > 0 ? 'neg' : ''}">${f.count}회</td>
          <td><span class="muted">${cycle}</span></td>
        </tr>`;
  }).join('');
}

function buildRecoveryStatsHtml(symbol, a) {
  const r = a.recoveryStats;
  if (!r.recoveredCount) {
    return `<p>분석 기간 동안 고점을 회복한 하락 구간이 아직 집계되지 않았습니다.${r.ongoingCount ? ' 현재 구간은 회복이 진행 중입니다.' : ''}</p>`;
  }
  const nowLine = a.isAtAth
    ? `현재는 사상 최고가를 경신 중이라 진행 중인 하락 구간이 없습니다.`
    : `현재 낙폭 <strong>${fmtPct(a.currentDrawdownPct)}</strong>은 분석 기간 전체 거래일 중 <strong>약 ${a.deeperPct.toFixed(0)}%</strong>의 날들보다 얕은 수준입니다. 즉 과거 ${a.deeperPct.toFixed(0)}%의 날은 지금보다 더 깊이 빠져 있었습니다.`;
  return `
    <div class="stat-grid">
      <div class="stat">
        <div class="label">회복 완료된 하락 구간</div>
        <div class="value">${r.recoveredCount}회</div>
      </div>
      <div class="stat">
        <div class="label">회복까지 걸린 기간(중앙값)</div>
        <div class="value">${r.medianDays.toLocaleString()}일</div>
      </div>
    </div>
    <p style="margin-top:12px;">${symbol}은(는) 분석 기간 동안 하락 구간 <strong>${a.episodeCount}개</strong>를 지나갔고, 그중 <strong>${r.recoveredCount}개</strong>는 이전 고점을 회복했습니다. 회복까지 걸린 기간은 중앙값 기준 <strong>${r.medianDays.toLocaleString()}일</strong>, 가장 오래 걸린 경우는 <strong>${r.maxDays.toLocaleString()}일</strong>이었습니다.${r.ongoingCount ? ' 나머지 1개 구간은 아직 회복이 진행 중입니다.' : ''}</p>
    <p>${nowLine}</p>
    <p class="muted">회복은 종가가 직전 고점을 다시 넘어선 시점을 기준으로 하며, 과거에 회복했다는 사실이 앞으로도 회복한다는 근거가 되지는 않습니다. 개별 종목은 사업 환경이 바뀌면 전고점을 영영 회복하지 못할 수도 있습니다.</p>`;
}

// 목록에서 자기 다음에 오는 6개를 순환식으로 고른다.
// 앞에서 6개를 그냥 잘라 쓰면 39개 페이지가 전부 같은 종목(AAPL·TSLA·…)만 가리켜서,
// 새로 복구한 뒤쪽 종목들로는 들어오는 링크가 거의 생기지 않는다. 순환식으로 고르면
// 모든 종목이 비슷한 수의 인바운드 링크를 갖게 되어 크롤러가 전체를 고르게 훑는다.
function buildRelatedTickersHtml(symbol) {
  const i = TICKERS.indexOf(symbol);
  const others = [];
  for (let k = 1; others.length < 6 && k < TICKERS.length; k++) {
    others.push(TICKERS[(i + k) % TICKERS.length]);
  }
  return others.map(t => `<a href="/stock/${t.toLowerCase()}.html" class="chip">${t}</a>`).join('');
}

function buildRelatedBlogHtml(symbol) {
  const ids = TICKER_RELATED_POSTS[symbol] || [];
  if (!ids.length) return '';
  const { BLOG_POSTS } = require('./posts-data.js');
  const links = ids.map(id => {
    const p = BLOG_POSTS.find(x => x.id === id);
    return p ? `<a href="/blog/${id}.html" class="chip">${escapeHtml(p.title)}</a>` : '';
  }).filter(Boolean).join('');
  if (!links) return '';
  return `
    <div class="related">
      <div class="related-title">관련 글</div>
      ${links}
    </div>`;
}

function buildPage(symbol, a, spyA, generatedDate) {
  const canonical = `https://mddcalc.com/stock/${symbol.toLowerCase()}.html`;
  const title = `${symbol} MDD 실데이터: 역대 하락 구간·회복 기간 전체 정리 | MDD 분석기`;
  const description = `${symbol}의 실제 시세로 계산한 고점 대비 하락률, 역대 주요 하락 구간과 회복 기간, 변동성을 무료로 확인하세요.`;

  const yearsLabel = a.years.toFixed(1);
  const heroClass = a.currentDrawdownPct < -0.05 ? 'neg' : 'pos';
  const heroText = a.isAtAth ? '현재 사상 최고가' : fmtPct(a.currentDrawdownPct);

  let spyCompareHtml = '';
  if (symbol !== BENCHMARK && spyA) {
    const diff = a.worstDrawdownPct - spyA.worstDrawdownPct;
    const deeper = diff < 0;
    spyCompareHtml = `
    <div class="card">
      <h2>📊 ${BENCHMARK}(시장 전체) 대비 비교</h2>
      <p>같은 기간(${spyA.startDate} ~ ${spyA.endDate}) 동안 ${BENCHMARK}의 최대 낙폭은 <strong>${fmtPct(spyA.worstDrawdownPct)}</strong>였습니다.
      ${symbol}의 최대 낙폭 <strong>${fmtPct(a.worstDrawdownPct)}</strong>은 ${BENCHMARK}보다 <strong>${Math.abs(diff).toFixed(1)}%p ${deeper ? '더 깊었습니다' : '더 얕았습니다'}</strong>.
      연환산 변동성도 ${symbol}가 ${a.volatility.toFixed(1)}%로 ${BENCHMARK}(${spyA.volatility.toFixed(1)}%)보다 ${a.volatility > spyA.volatility ? '높았습니다' : '낮았습니다'}.</p>
    </div>`;
  }

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
  "@type": "WebPage",
  "name": "${escapeHtml(symbol)} MDD 실데이터 리포트",
  "description": "${escapeHtml(description)}",
  "url": "${canonical}",
  "dateModified": "${generatedDate}",
  "inLanguage": "ko"
}
</script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Pretendard", "Malgun Gothic", sans-serif;
         background: linear-gradient(135deg, #f0f4f8 0%, #e8ecf1 100%); color: #1a202c; line-height: 1.65; padding: 16px; }
  .container { max-width: 760px; margin: 0 auto; }
  a { color: #4299e1; }
  .card { background: #fff; border-radius: 14px; padding: 22px; margin-bottom: 16px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
  nav.crumbs { font-size: 13px; margin-bottom: 12px; color: #718096; }
  .ticker-name { font-size: 14px; font-weight: 700; color: #718096; letter-spacing: 0.5px; }
  .hero { font-size: 46px; font-weight: 800; line-height: 1.1; margin: 6px 0 4px; }
  .hero.neg { color: #e53e3e; } .hero.pos { color: #38a169; }
  .hero-label { font-size: 13px; color: #718096; margin-bottom: 6px; }
  .data-range { font-size: 12px; color: #a0aec0; margin-bottom: 14px; }
  .stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 14px 0; }
  .stat { background: #f7fafc; border-radius: 10px; padding: 14px; }
  .stat .label { font-size: 12px; color: #718096; margin-bottom: 4px; }
  .stat .value { font-size: 17px; font-weight: 700; color: #2d3748; }
  h2 { font-size: 17px; margin-bottom: 10px; color: #2d3748; }
  p { font-size: 14px; color: #4a5568; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; color: #a0aec0; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #edf2f7; }
  td { padding: 8px; border-bottom: 1px solid #f7fafc; vertical-align: top; }
  td.neg { color: #e53e3e; font-weight: 700; }
  .muted { font-size: 11px; color: #a0aec0; }
  .ongoing { color: #d69e2e; font-weight: 600; }
  .tool-cta { display: block; margin-top: 4px; padding: 14px 18px; background: #2b6cb0; color: #fff !important;
              border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 14px; text-align: center; }
  .tool-cta:hover { background: #2c5282; }
  .related { margin-top: 4px; }
  .related-title { font-size: 13px; color: #718096; margin-bottom: 8px; }
  .chip { display: inline-block; background: #edf2f7; color: #2d3748; padding: 6px 12px;
          border-radius: 20px; font-size: 13px; font-weight: 600; margin: 0 6px 6px 0; text-decoration: none; }
  .freshness { font-size: 12px; color: #718096; background: #f7fafc; border-radius: 8px; padding: 10px 12px; margin-top: 4px; }
  .note { font-size: 12px; color: #a0aec0; margin-top: 16px; line-height: 1.7; }
</style>
</head>
<body>
<div class="container">
  <nav class="crumbs"><a href="/">MDD 분석기</a> &gt; <a href="/tools.html">도구 모음</a> &gt; ${symbol}</nav>

  <div class="card">
    <div class="ticker-name">${symbol}</div>
    <div class="hero ${heroClass}">${heroText}</div>
    <div class="hero-label">${a.isAtAth ? `사상 최고가 ${fmtPrice(a.athPrice)} 경신 중` : `사상 최고가(ATH) ${fmtPrice(a.athPrice)} (${a.athDate}) 대비 · 현재가 ${fmtPrice(a.currentPrice)}`} · 기준일 ${a.currentDate}</div>
    <div class="data-range">📅 데이터 기간: ${a.startDate} ~ ${a.endDate} (약 ${yearsLabel}년, 일봉 기준)</div>

    <div class="stat-grid">
      <div class="stat">
        <div class="label">이 기간 최대 낙폭(MDD)</div>
        <div class="value">${fmtPct(a.worstDrawdownPct)}</div>
      </div>
      <div class="stat">
        <div class="label">연환산 변동성</div>
        <div class="value">${a.volatility.toFixed(1)}%</div>
      </div>
    </div>

    <p>${symbol} 종목은 ${a.isAtAth
      ? `현재 사상 최고가(${a.athDate} 기록, ${fmtPrice(a.athPrice)})를 경신하며 거래되고 있습니다.`
      : `현재 사상 최고가(${a.athDate} 기록, ${fmtPrice(a.athPrice)}) 대비 <strong>${heroText}</strong> 상태입니다.`}
    분석 기간(${yearsLabel}년) 동안 가장 크게 하락했던 구간은 <strong>${a.topDrawdowns[0].declinePct.toFixed(1)}%</strong> 하락한 사례로,
    ${a.topDrawdowns[0].peakDate}부터 ${a.topDrawdowns[0].troughDate}까지 낙폭이 커졌${a.topDrawdowns[0].recoveryDate ? `고, 이후 ${a.topDrawdowns[0].recoveryDays.toLocaleString()}일 만에 이전 고점을 회복했습니다.` : `으며, 이 분석 시점까지 아직 이전 고점을 회복하지 못한 상태입니다.`}</p>
  </div>

  <div class="card">
    <h2>📋 역대 주요 하락 구간 (하락률 상위 ${a.topDrawdowns.length}개)</h2>
    <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>고점</th><th>저점</th><th>하락률</th><th>회복</th></tr></thead>
        <tbody>${buildDrawdownTableHtml(a.topDrawdowns)}</tbody>
      </table>
    </div>
    <p class="muted" style="margin-top:10px;">종가 기준으로 계산한 근사치이며, 실제 장중 고가/저가 기준으로는 수치가 다소 달라질 수 있습니다.</p>
  </div>

  <div class="card">
    <h2>📉 하락 구간별 발생 횟수</h2>
    <p>분석 기간 ${yearsLabel}년(거래일 ${a.tradingDays.toLocaleString()}일) 동안 ${symbol}이(가) 각 하락 구간을 지나간 횟수입니다. 같은 구간이라도 종목마다 빈도가 크게 다릅니다.</p>
    <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>하락 구간</th><th>발생 횟수</th><th>평균 주기</th></tr></thead>
        <tbody>${buildFrequencyRowsHtml(a)}</tbody>
      </table>
    </div>
    <p class="muted" style="margin-top:10px;">고점을 새로 경신한 뒤 다시 하락한 구간을 각각 1회로 셉니다. 평균 주기는 분석 기간을 발생 횟수로 나눈 값으로, 실제 발생 간격은 시기에 따라 편차가 큽니다.</p>
  </div>

  <div class="card">
    <h2>⏱ 회복 통계</h2>
    ${buildRecoveryStatsHtml(symbol, a)}
  </div>
  ${spyCompareHtml}

  <div class="card">
    <a class="tool-cta" href="/?ticker=${symbol}">MDD 계산기에서 ${symbol} 실시간으로 다시 조회하기 →</a>
  </div>

  <div class="card">
    <div class="related">
      <div class="related-title">다른 종목 리포트</div>
      ${buildRelatedTickersHtml(symbol)}
    </div>
    ${buildRelatedBlogHtml(symbol)}
    <p class="freshness">📅 데이터 기준일: ${generatedDate} · 이 페이지는 매주 자동으로 최신 데이터로 갱신됩니다. 지금 보시는 수치가 실제 시세와 최대 ${REFRESH_CYCLE_DAYS}일 정도 차이가 날 수 있습니다.</p>
    <p class="note">본 페이지는 정보 제공 목적이며 투자 자문이 아닙니다. 데이터 출처: Twelve Data. 오류 제보: <a href="mailto:gktgkt2309@gmail.com">gktgkt2309@gmail.com</a></p>
  </div>
</div>
</body>
</html>
`;
}

function updateSitemap(tickers, generatedDate) {
  let xml = fs.readFileSync(SITEMAP_PATH, 'utf8');
  xml = xml.replace(/\s*<url><loc>https:\/\/mddcalc\.com\/stock\/[^<]+<\/loc>[\s\S]*?<\/url>/g, '');
  const entries = tickers.map(t =>
    `  <url><loc>https://mddcalc.com/stock/${t.toLowerCase()}.html</loc><lastmod>${generatedDate}</lastmod><priority>0.7</priority></url>`
  ).join('\n');
  xml = xml.replace('</urlset>', entries + '\n</urlset>');
  fs.writeFileSync(SITEMAP_PATH, xml);
}

// tools.html 안에 "종목별 실데이터 리포트" 허브 섹션을 정적으로 유지한다.
// (blog.html의 BLOG_GRID_STATIC 마커와 같은 방식 — 크롤러가 JS 없이도 15개 링크를 전부 보게 하려면
// 어딘가 한 곳에는 15개 링크가 정적 HTML로 모여 있어야 한다.)
function updateToolsHub(tickers) {
  const p = path.join(SITE_ROOT, 'tools.html');
  let html = fs.readFileSync(p, 'utf8');
  const chips = tickers.map(t => `<a href="/stock/${t.toLowerCase()}.html" class="chip">${t}</a>`).join('\n        ');
  const block = `<!-- STOCK_HUB_STATIC:START -->
      <div class="card">
        <h2 class="section">📈 종목별 MDD 실데이터 리포트</h2>
        <p style="font-size:14px; color:#4a5568; margin-bottom:10px;">실제 시세 데이터로 계산한 역대 하락 구간과 회복 기간을 종목별로 정리했습니다.</p>
        ${chips}
      </div>
<!-- STOCK_HUB_STATIC:END -->`;
  const markerRe = /<!-- STOCK_HUB_STATIC:START -->[\s\S]*?<!-- STOCK_HUB_STATIC:END -->/;
  if (markerRe.test(html)) {
    html = html.replace(markerRe, () => block);
  } else if (html.includes('</div><!-- end container -->')) {
    html = html.replace('</div><!-- end container -->', () => block + '\n</div><!-- end container -->');
  } else {
    throw new Error('tools.html 에서 삽입 위치를 찾지 못했습니다.');
  }
  fs.writeFileSync(p, html);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const generatedDate = new Date().toISOString().slice(0, 10);

  const analyses = {};
  for (const symbol of TICKERS) {
    process.stdout.write(`⏳ ${symbol} 조회 중... `);
    const series = await fetchSeries(symbol);
    analyses[symbol] = analyze(series);
    console.log(`완료 (${series.length}일치, ${analyses[symbol].startDate} ~ ${analyses[symbol].endDate})`);
    await sleep(8000); // 분당 8회 제한 준수 (60s / 8 = 7.5s, 여유 있게 8s)
  }

  const spyA = analyses[BENCHMARK];
  for (const symbol of TICKERS) {
    const html = buildPage(symbol, analyses[symbol], spyA, generatedDate);
    fs.writeFileSync(path.join(OUT_DIR, `${symbol.toLowerCase()}.html`), html);
  }
  console.log(`\n✅ ${TICKERS.length}개 종목 리포트 생성 완료 (/stock/*.html)`);

  updateSitemap(TICKERS, generatedDate);
  console.log('✅ sitemap.xml 갱신 완료');

  updateToolsHub(TICKERS);
  console.log('✅ tools.html 허브 섹션 갱신 완료');
}

main().catch(err => {
  console.error('❌ 생성 실패:', err.message);
  process.exit(1);
});
