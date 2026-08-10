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
//
// 2026-07 추가분(세 번째 줄 이후): Search Console 실적을 보니 클릭이 붙는 검색어가
// "mdd 계산기" 같은 도구 이름보다 "soxl mdd", "voo mdd", "schd mdd", "qqq mdd" 처럼
// **종목명 + mdd** 형태였다. 이미 있는 종목만으로 노출이 잡히고 있다는 뜻이라,
// 같은 패턴으로 검색될 만한 종목(양자컴퓨팅·원전·개별 2배 레버리지 등 국내에서
// 많이 찾는 것들)을 늘린다.
// 2026-08-10: 69개 -> 20개로 줄였다.
//
// 왜 줄였나. 69개일 때 이 종목 페이지들이 사이트 전체 URL 109개 중 63%를 차지했다.
// 페이지 하나하나에는 실제로 계산한 데이터가 들어 있었지만, 문장 틀이 전부 같아서
// 사이트 전체가 "자동 생성 페이지 위에 손으로 만든 페이지 몇 개를 얹은 것"처럼 보였다.
// 구글이 2024년에 명문화한 대량 생성 콘텐츠(scaled content) 정책이 겨냥하는 형태다.
//
// 그래서 (1) 개수를 줄이고 (2) 남긴 종목에는 ticker-notes.js 의 해설을 하나씩 붙였다.
// 종목당 사람이 쓴 문단이 있어야 이 페이지가 "그 종목에 대한 문서"가 된다.
//
// 남길 종목은 검색 실적(노출이 잡히던 SCHD·QQQ·SOXL 등)과, 해설이 서로 겹치지 않도록
// 성격이 다른 묶음(지수 / 배당 / 커버드콜 / 레버리지 / 반도체 / 빅테크 / 고변동성)을
// 기준으로 골랐다. 지운 49개는 vercel.json 에서 301 로 이 목록의 가까운 종목이나
// 허브로 보낸다 — 404 로 두면 예전에 색인된 URL 이 색인 오류로 남는다.
//
// 종목을 다시 늘리려면 여기에 티커를 넣고 ticker-notes.js 에 해설을 함께 써야 한다.
// 해설 없이 티커만 늘리면 줄이기 전 상태로 돌아간다.
const TICKERS = [
  // 지수 추종 (VTI 는 blog/23.html 이 본문에서 다루므로 상호 링크를 위해 유지)
  'SPY', 'QQQ', 'VOO', 'VTI',
  // 배당 · 커버드콜
  'SCHD', 'JEPQ',
  // 레버리지 (변동성 감쇠 설명이 필요한 상품)
  'TQQQ', 'SOXL',
  // 반도체
  'SOXX', 'NVDA', 'AVGO', 'TSM', 'MU',
  // 빅테크
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META',
  // 고변동성 개별주
  'TSLA', 'PLTR', 'COIN',
];

// 한국어 검색어를 잡기 위한 종목명. 서학개미는 "테슬라 하락률", "엔비디아 mdd" 처럼
// 티커가 아니라 한글 이름으로도 검색하는데, 지금 페이지에는 한글 종목명이 한 글자도
// 없어서 그런 검색어로는 아예 후보에 오르지 못한다. 제목·설명·h1에 같이 넣는다.
// 값이 없으면 티커만 쓴다(ARM, AMD, ASML처럼 한글명이 따로 없는 경우).
const TICKER_NAMES = {
  AAPL: '애플', TSLA: '테슬라', NVDA: '엔비디아', MSFT: '마이크로소프트',
  GOOGL: '구글 알파벳', AMZN: '아마존', META: '메타',
  SPY: 'S&P500 ETF', QQQ: '나스닥100 ETF', VOO: '뱅가드 S&P500 ETF',
  VTI: '미국 전체시장 ETF', SCHD: '미국 배당 ETF', TQQQ: '나스닥100 3배',
  SOXL: '반도체 3배 레버리지', AMD: '', NFLX: '넷플릭스',
  SPXL: 'S&P500 3배', UPRO: 'S&P500 3배', SQQQ: '나스닥100 3배 인버스',
  SOXS: '반도체 3배 인버스', FNGU: '빅테크 3배', TECL: '기술주 3배',
  JEPI: 'S&P500 커버드콜 ETF', JEPQ: '나스닥 커버드콜 ETF', AVGO: '브로드컴',
  SMCI: '슈퍼마이크로', ARM: '', MU: '마이크론', TSM: 'TSMC',
  INTC: '인텔', PLTR: '팔란티어', COIN: '코인베이스', MSTR: '마이크로스트래티지',
  RIVN: '리비안', LCID: '루시드', NIO: '니오', BABA: '알리바바',
  DIS: '디즈니', BA: '보잉',
  IONQ: '아이온큐', RGTI: '리게티', QBTS: '디웨이브', OKLO: '오클로',
  SMR: '뉴스케일파워', VST: '비스트라', CEG: '컨스텔레이션에너지',
  TSLL: '테슬라 2배', NVDL: '엔비디아 2배', CONL: '코인베이스 2배',
  QLD: '나스닥100 2배', SOXX: '필라델피아 반도체 ETF', IVV: 'iShares S&P500 ETF',
  TLT: '미국 장기국채 ETF', GLD: '금 ETF',
  HOOD: '로빈후드', SOFI: '소파이', APP: '앱러빈', ORCL: '오라클',
  ASML: '', MRVL: '마벨', CRWD: '크라우드스트라이크', ANET: '아리스타네트웍스',
  RKLB: '로켓랩', JOBY: '조비에비에이션', MARA: '마라홀딩스',
  LLY: '일라이릴리', COST: '코스트코', UNH: '유나이티드헬스', V: '비자',
};

// "SOXL(반도체 3배 레버리지)" 처럼. 한글명이 없으면 티커만.
function labelOf(symbol) {
  const kor = TICKER_NAMES[symbol];
  return kor ? `${symbol}(${kor})` : symbol;
}
// 종목 성격별 분류. 69개 페이지가 전부 똑같은 섹션 구성이면 실제 데이터가 들어 있어도
// "한 틀로 찍어낸 페이지"로 보인다. 성격에 따라 실제로 필요한 설명이 다르므로
// (레버리지는 변동성 감쇠, 커버드콜은 배당 제외 문제) 분류별로 다른 섹션을 붙인다.
const CATEGORY = {
  TQQQ: 'leveraged', SOXL: 'leveraged', SPXL: 'leveraged', UPRO: 'leveraged',
  TSLL: 'leveraged', NVDL: 'leveraged', CONL: 'leveraged', QLD: 'leveraged',
  FNGU: 'leveraged', TECL: 'leveraged',
  SQQQ: 'inverse', SOXS: 'inverse',
  SCHD: 'income', JEPI: 'income', JEPQ: 'income',
  SPY: 'index', QQQ: 'index', VOO: 'index', VTI: 'index', IVV: 'index', SOXX: 'index',
  TLT: 'asset', GLD: 'asset',
};
function categoryOf(symbol) { return CATEGORY[symbol] || 'stock'; }

// S&P500 을 그대로 추종하는 ETF 들. 서로 비교해봐야 "0.0%p 더 깊었습니다" 같은
// 무의미한 문장만 나오므로 벤치마크 비교를 건너뛴다.
const SP500_TRACKERS = new Set(['SPY', 'VOO', 'IVV']);

// 배수 상품의 표시용 배수. 변동성 감쇠 설명에 쓴다.
const LEVERAGE_FACTOR = {
  TQQQ: 3, SOXL: 3, SPXL: 3, UPRO: 3, FNGU: 3, TECL: 3,
  TSLL: 2, NVDL: 2, CONL: 2, QLD: 2, SQQQ: -3, SOXS: -3,
};

const BENCHMARK = 'SPY'; // 상대 비교 기준 지수

const REFRESH_CYCLE_DAYS = 7; // 매주 자동 갱신 (.github/workflows/refresh-stock-pages.yml)
const TOP_N_DRAWDOWNS = 5;
// 회복 통계에서 "하락 구간"으로 셀 최소 낙폭(%). 이 밑은 일상적인 등락으로 보고 제외한다.
const MEANINGFUL_DRAWDOWN_PCT = 10;

// 종목별 해설. 숫자는 여기에 없고(표가 담당한다) "왜 이런 모양인지"만 들어 있다.
// 자세한 작성 원칙은 ticker-notes.js 상단 주석 참고.
const { TICKER_NOTES } = require('./ticker-notes.js');

// 이 리포트가 다루는 종목과 겹치는 블로그 글이 있으면 서로 링크한다.
// generate-blog-pages.js도 같은 매핑을 반대 방향으로 써서 상호 링크를 만든다.
const { TICKER_RELATED_POSTS } = require('./posts-data.js');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 쿠팡 파트너스 배너. generate-blog-pages.js와 완전히 같은 마크업을 써서
// 한쪽만 손보고 다른 쪽을 깜빡하는 일이 없게 한다. 제거하려면 이 상수를 쓰는 자리를
// 지우면 된다 (COUPANG_PARTNERS_START/END 주석 참고).
// 상단 정적 배너는 뺐다 — 계산기/리포트 본문 아래 캐러셀 배너 하나만 쓴다.
const COUPANG_RESPONSIVE_BANNER = `<!-- COUPANG_PARTNERS_START 쿠팡 파트너스 배너. 제거하려면 이 주석부터 END 주석까지 지우면 됩니다. -->
<div class="container" id="coupangAdWrap" style="margin-top:4px;">
  <div id="coupangAd" style="display:none; background:#fff; border-radius:14px; padding:14px 16px 16px; margin-bottom:16px; box-shadow:0 2px 10px rgba(0,0,0,0.05);">
    <div style="max-width:100%; overflow-x:hidden; display:flex; justify-content:center;">
      <script src="https://ads-partners.coupang.com/g.js"></script>
      <script>
      (function () {
        // 쿠팡 배너는 픽셀 고정 크기라 화면마다 다른 배너를 써야 합니다.
        // 쿠팡 파트너스에 배너를 두 개 만들어 두고, 화면 폭에 맞는 쪽을 고릅니다.
        //   PC/태블릿 : 1012747 (680x140)
        //   모바일     : 1012749 (329x140)
        // 폭이 모자라면 그만큼 줄여서 넣습니다. 그대로 넣으면 가로 스크롤이 생기는데,
        // 애드센스 심사자는 모바일을 먼저 보기 때문에 그게 그대로 감점이 됩니다.
        if (typeof PartnersCoupang === 'undefined') return; // 차단됐으면 고지 문구까지 통째로 숨김
        var box = document.getElementById('coupangAd');
        // 배너를 담을 카드는 아직 display:none 이라 폭을 잴 수 없습니다(0 이 나옵니다).
        // 항상 보이는 바깥 컨테이너를 재고 카드 좌우 패딩(16px x 2)을 뺍니다.
        var wrap = document.getElementById('coupangAdWrap');
        var outer = (wrap && wrap.clientWidth) || document.documentElement.clientWidth || 320;
        var avail = Math.floor(outer) - 32;
        var DESKTOP = { id: 1012747, width: 680 };
        var MOBILE  = { id: 1012749, width: 329 };
        var pick = avail >= DESKTOP.width ? DESKTOP : MOBILE;
        var width = Math.max(240, Math.min(pick.width, avail));
        try {
          new PartnersCoupang.G({
            id: pick.id, template: 'carousel', trackingCode: 'AF9480830',
            width: String(width), height: '140', tsource: ''
          });
          box.style.display = 'block';
        } catch (e) {
          console.error('[coupang] 배너 생성 실패:', e);
        }
      })();
      </script>
    </div>
    <p style="margin-top:10px; font-size:11px; color:#a0aec0; line-height:1.6; text-align:center;">
      이 영역은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.
    </p>
  </div>
</div>
<!-- COUPANG_PARTNERS_END -->`;

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

  // 회복 통계는 "의미 있는 하락"만 대상으로 한다.
  // computeDrawdowns는 고점 대비 0.5%짜리 미세한 등락도 하나의 구간으로 세기 때문에,
  // 필터 없이 집계하면 BABA 기준 "구간 42개, 회복 중앙값 5일"처럼 노이즈가 지배해
  // 숫자가 사실상 무의미해진다. -10% 이상 하락한 구간만 남겨 실제로 체감되는 하락을 본다.
  const meaningful = all.filter(e => e.declinePct <= -MEANINGFUL_DRAWDOWN_PCT);
  const recovered = meaningful.filter(e => e.recoveryDays != null);
  const recDays = recovered.map(e => e.recoveryDays).sort((a, b) => a - b);
  const recoveryStats = {
    meaningfulCount: meaningful.length,
    recoveredCount: recovered.length,
    ongoingCount: meaningful.length - recovered.length,
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
  const TH = MEANINGFUL_DRAWDOWN_PCT;
  if (!r.meaningfulCount) {
    return `<p>분석 기간 동안 ${symbol}이(가) -${TH}% 이상 하락한 구간은 없었습니다.</p>`;
  }
  if (!r.recoveredCount) {
    return `<p>${symbol}은(는) 분석 기간 동안 -${TH}% 이상 하락한 구간을 <strong>${r.meaningfulCount}개</strong> 지나갔지만, 그중 이전 고점을 회복한 구간은 아직 없습니다.</p>`;
  }
  const nowLine = a.isAtAth
    ? `현재는 사상 최고가를 경신 중이라 진행 중인 하락 구간이 없습니다.`
    : `현재 낙폭 <strong>${fmtPct(a.currentDrawdownPct)}</strong>은 분석 기간 전체 거래일 중 <strong>약 ${a.deeperPct.toFixed(0)}%</strong>의 날들보다 얕은 수준입니다. 즉 과거 ${a.deeperPct.toFixed(0)}%의 날은 지금보다 더 깊이 빠져 있었습니다.`;
  const ongoingLine = r.ongoingCount
    ? ` 나머지 ${r.ongoingCount}개 구간은 이 분석 시점까지 아직 회복되지 않았습니다.`
    : '';
  return `
    <div class="stat-grid">
      <div class="stat">
        <div class="label">-${TH}% 이상 하락 후 회복한 구간</div>
        <div class="value">${r.recoveredCount}회 / ${r.meaningfulCount}회</div>
      </div>
      <div class="stat">
        <div class="label">회복까지 걸린 기간(중앙값)</div>
        <div class="value">${r.medianDays.toLocaleString()}일</div>
      </div>
    </div>
    <p style="margin-top:12px;">${symbol}은(는) 분석 기간 동안 <strong>-${TH}% 이상 하락한 구간</strong>을 <strong>${r.meaningfulCount}개</strong> 지나갔고, 그중 <strong>${r.recoveredCount}개</strong>가 이전 고점을 회복했습니다. 회복까지 걸린 기간은 중앙값 기준 <strong>${r.medianDays.toLocaleString()}일</strong>, 가장 오래 걸린 경우는 <strong>${r.maxDays.toLocaleString()}일</strong>이었습니다.${ongoingLine}</p>
    <p>${nowLine}</p>
    <p class="muted">일상적인 등락과 구분하기 위해 -${TH}% 이상 하락한 구간만 집계했습니다. 회복은 종가가 직전 고점을 다시 넘어선 시점을 기준으로 하며, 과거에 회복했다는 사실이 앞으로도 회복한다는 근거가 되지는 않습니다. 개별 종목은 사업 환경이 바뀌면 전고점을 영영 회복하지 못할 수도 있습니다.</p>`;
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
  const { BLOG_POSTS, RETIRED_POSTS } = require('./posts-data.js');
  // 내려간 글로는 링크하지 않는다. 그 글의 파일은 더 이상 생성되지 않으므로
  // 그대로 두면 종목 페이지에서 404 로 나가는 링크가 된다.
  const retired = RETIRED_POSTS || new Set();
  const ids = (TICKER_RELATED_POSTS[symbol] || []).filter(id => !retired.has(id));
  if (!ids.length) return '';
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

// 낙폭에서 원금을 되찾으려면 몇 % 올라야 하는지. -50%는 +100%가 있어야 본전이다.
// 하락률과 회복률이 대칭이 아니라는 점이 MDD를 봐야 하는 이유 자체라, 종목마다 실제
// 숫자로 보여준다.
function recoveryGainPct(declinePct) {
  return (1 / (1 + declinePct / 100) - 1) * 100;
}

// 분류별로 다른 섹션. 같은 틀에 숫자만 바뀐 페이지가 69개 있는 것보다,
// 종목 성격에 실제로 필요한 설명이 붙는 편이 읽는 사람에게도 낫다.
function buildCategorySectionHtml(symbol, a, spyA) {
  const cat = categoryOf(symbol);
  const worst = a.worstDrawdownPct;
  const needGain = recoveryGainPct(worst);
  const curNeedGain = a.isAtAth ? null : recoveryGainPct(a.currentDrawdownPct);
  const factor = LEVERAGE_FACTOR[symbol];
  const worstEp = a.topDrawdowns[0];
  const worstRecovery = worstEp && worstEp.recoveryDays != null
    ? `실제로 이 낙폭을 회복하는 데 <strong>${worstEp.recoveryDays.toLocaleString()}일</strong>이 걸렸습니다.`
    : '이 낙폭은 이 분석 시점까지 아직 회복되지 않았습니다.';

  // 어느 분류에나 공통으로 쓰는 "회복에 필요한 상승률" 문단.
  const gainBlock = `
      <p>최대 낙폭 <strong>${fmtPct(worst)}</strong>에서 원금을 되찾으려면 저점 대비 <strong>+${needGain.toFixed(0)}%</strong> 상승이 필요합니다.
      ${worstRecovery}${curNeedGain != null ? ` 현재 낙폭 <strong>${fmtPct(a.currentDrawdownPct)}</strong> 기준으로는 <strong>+${curNeedGain.toFixed(1)}%</strong>가 필요합니다.` : ''}</p>`;

  if (cat === 'leveraged' || cat === 'inverse') {
    const isInverse = cat === 'inverse';
    return `
    <div class="card">
      <h2>⚠️ ${Math.abs(factor || 3)}배 ${isInverse ? '인버스' : '레버리지'} 상품이라 낙폭을 다르게 읽어야 합니다</h2>
      <p>${symbol}는 기초지수의 <strong>일간</strong> 수익률을 ${Math.abs(factor || 3)}배${isInverse ? ' 반대로' : ''} 따라가도록 만들어진 상품입니다.
      매일 배수를 다시 맞추기 때문에 <strong>보유 기간이 길어질수록 기초지수 수익률의 ${Math.abs(factor || 3)}배와 벌어집니다</strong>.
      지수가 올랐다 내렸다를 반복하며 제자리로 돌아와도 이 상품은 손실이 남는데, 이것을 변동성 감쇠(volatility decay)라고 합니다.</p>
      ${gainBlock}
      <p>연환산 변동성이 <strong>${a.volatility.toFixed(1)}%</strong>로 높다는 점이 이 감쇠를 키웁니다.
      ${isInverse ? '특히 인버스 상품은 시장이 장기적으로 우상향하면 구조적으로 불리해, 장기 보유보다 단기 대응 목적에 쓰이는 상품입니다.' : '이 표의 하락 구간들은 기초지수가 같은 폭으로 빠졌다는 뜻이 아니라, 배수와 감쇠가 함께 작용한 결과입니다.'}</p>
    </div>`;
  }

  if (cat === 'income') {
    return `
    <div class="card">
      <h2>💵 이 수치는 분배금을 뺀 주가 기준입니다</h2>
      <p>${symbol}는 분배금(배당) 지급이 수익의 큰 부분을 차지하는 상품입니다.
      이 페이지의 낙폭은 <strong>주가만으로 계산</strong>한 값이라, 분배금을 다시 반영한 총수익(Total Return) 기준으로는
      실제 손실이 여기 표시된 것보다 얕습니다. 분배금을 지급하면 그만큼 주가가 내려가므로,
      주가 차트만 보면 하락이 실제보다 커 보이는 것이 정상입니다.</p>
      ${gainBlock}
      <p>연환산 변동성은 <strong>${a.volatility.toFixed(1)}%</strong>입니다.
      커버드콜 방식의 상품이라면 상승 구간에서 수익이 제한되는 대신 변동성이 낮아지는 특성도 함께 고려해야 합니다.</p>
    </div>`;
  }

  if (cat === 'index') {
    return `
    <div class="card">
      <h2>🧺 지수를 통째로 담는 ETF의 낙폭입니다</h2>
      <p>${symbol}는 개별 기업이 아니라 지수 전체를 담습니다. 편입 종목 하나가 무너져도 지수가 알아서 교체하므로,
      개별 종목처럼 <strong>전고점을 영영 회복하지 못하는 상황은 상대적으로 드뭅니다</strong>.
      아래 회복 통계에서 대부분의 하락 구간이 결국 회복된 것도 그래서입니다.</p>
      ${gainBlock}
      <p>다만 시장 전체가 빠지는 국면에서는 분산이 도움이 되지 않습니다.
      연환산 변동성 <strong>${a.volatility.toFixed(1)}%</strong>는 이 ETF가 담고 있는 시장의 평상시 등락 폭으로 보시면 됩니다.</p>
    </div>`;
  }

  if (cat === 'asset') {
    return `
    <div class="card">
      <h2>🪙 주식과 다른 자산군입니다</h2>
      <p>${symbol}는 주식이 아니라 ${symbol === 'GLD' ? '금' : '채권'} 가격을 따라갑니다.
      주가지수와 하락 시점이 겹치지 않는 경우가 많아, 낙폭의 깊이만으로 주식과 직접 비교하기는 어렵습니다.
      ${symbol === 'TLT' ? '특히 장기채는 금리가 오르면 가격이 내려가므로, 주식과는 다른 이유로 하락합니다.' : '금은 실물 자산이라 기업 실적이 아니라 금리·달러·안전자산 수요에 따라 움직입니다.'}</p>
      ${gainBlock}
      <p>연환산 변동성은 <strong>${a.volatility.toFixed(1)}%</strong>입니다.
      포트폴리오에 섞었을 때의 효과를 보려면 낙폭의 크기보다 <strong>주식과 언제 같이 빠졌는지</strong>를 함께 봐야 합니다.</p>
    </div>`;
  }

  // 개별 종목
  return `
    <div class="card">
      <h2>🏢 개별 기업이라 회복이 보장되지 않습니다</h2>
      <p>지수 ETF와 달리 개별 기업은 사업이 무너지면 <strong>전고점을 영영 회복하지 못할 수 있습니다</strong>.
      아래 회복 통계는 과거에 실제로 회복했던 기록일 뿐, 앞으로도 회복한다는 근거가 아닙니다.
      실적·경쟁 환경·재무 상태가 과거와 같은지 함께 확인하셔야 합니다.</p>
      ${gainBlock}
      <p>연환산 변동성은 <strong>${a.volatility.toFixed(1)}%</strong>${spyA ? `로, 같은 기간 ${BENCHMARK}(${spyA.volatility.toFixed(1)}%)와 비교해 보시면 이 종목이 평소 얼마나 크게 흔들리는지 가늠할 수 있습니다` : '입니다'}.</p>
    </div>`;
}

// 종목 해설 카드. 해설이 없는 종목이면 빈 문자열을 돌려주므로 빈 카드가 생기지 않는다.
// 위치는 히어로 카드 바로 뒤 — 이 페이지에서 유일하게 이 종목에만 해당하는 내용이라
// 표보다 먼저 읽히는 자리에 둔다.
function buildTickerNoteHtml(symbol) {
  const note = TICKER_NOTES[symbol];
  if (!note) return '';
  const label = labelOf(symbol);
  return `
  <div class="card note-card">
    <h2>🔎 ${escapeHtml(label)}의 낙폭은 왜 이런 모양인가</h2>
    <p>${note.trim()}</p>
  </div>
`;
}

function buildPage(symbol, a, spyA, generatedDate) {
  const canonical = `https://mddcalc.com/stock/${symbol.toLowerCase()}.html`;
  const label = labelOf(symbol);

  // 제목은 실제로 들어오는 검색어 두 가지("soxl mdd", "고점 대비 하락률")를 한 줄에
  // 같이 담는다. 옛 제목("MDD 실데이터: 역대 하락 구간·회복 기간 전체 정리")은
  // "고점 대비 하락률"이라는 표현이 제목에 없어서, 노출은 잡히는데 클릭이 0에
  // 가까웠던 검색어들과 글자가 맞지 않았다.
  const title = `${label} MDD·고점 대비 하락률 총정리`;

  const yearsLabel = a.years.toFixed(1);
  const heroClass = a.currentDrawdownPct < -0.05 ? 'neg' : 'pos';
  const heroText = a.isAtAth ? '현재 사상 최고가' : fmtPct(a.currentDrawdownPct);

  // 설명문에는 숫자를 앞에 둔다. 검색 결과에서 "지금 몇 % 빠졌는지"가 먼저 보이는 쪽이
  // 같은 순위에서도 클릭을 더 가져간다. 매주 자동 갱신되므로 숫자도 같이 최신화된다.
  const description = a.isAtAth
    ? `${label}은 현재 사상 최고가 부근입니다. 역대 최대 낙폭(MDD) ${fmtPct(a.worstDrawdownPct)}, 주요 하락 구간과 전고점 회복까지 걸린 기간을 실제 시세로 계산해 정리했습니다.`
    : `${label}의 현재 고점 대비 하락률은 ${fmtPct(a.currentDrawdownPct)}입니다. 역대 최대 낙폭(MDD) ${fmtPct(a.worstDrawdownPct)}, 주요 하락 구간과 전고점 회복까지 걸린 기간을 실제 시세로 계산해 정리했습니다.`;

  let spyCompareHtml = '';
  // SPY·VOO·IVV 는 같은 지수를 추종해서 서로 비교하면 "0.0%p 더 깊었습니다",
  // "17.1%로 SPY(17.1%)보다 높았습니다" 같은 무의미한 문장이 나온다. 아예 건너뛴다.
  if (symbol !== BENCHMARK && spyA && !SP500_TRACKERS.has(symbol)) {
    const diff = a.worstDrawdownPct - spyA.worstDrawdownPct;
    const volDiff = a.volatility - spyA.volatility;
    // 차이가 0.1%p 도 안 되면 "더 깊다/얕다"로 단정하지 않는다.
    const ddPhrase = Math.abs(diff) < 0.1
      ? `${BENCHMARK}와 <strong>사실상 같은 수준</strong>이었습니다`
      : `${BENCHMARK}보다 <strong>${Math.abs(diff).toFixed(1)}%p ${diff < 0 ? '더 깊었습니다' : '더 얕았습니다'}</strong>`;
    const volPhrase = Math.abs(volDiff) < 0.1
      ? `${BENCHMARK}(${spyA.volatility.toFixed(1)}%)와 거의 같았습니다`
      : `${BENCHMARK}(${spyA.volatility.toFixed(1)}%)보다 ${volDiff > 0 ? '높았습니다' : '낮았습니다'}`;
    spyCompareHtml = `
    <div class="card">
      <h2>📊 ${BENCHMARK}(시장 전체) 대비 비교</h2>
      <p>같은 기간(${spyA.startDate} ~ ${spyA.endDate}) 동안 ${BENCHMARK}의 최대 낙폭은 <strong>${fmtPct(spyA.worstDrawdownPct)}</strong>였습니다.
      ${symbol}의 최대 낙폭 <strong>${fmtPct(a.worstDrawdownPct)}</strong>은 ${ddPhrase}.
      연환산 변동성은 ${symbol}가 ${a.volatility.toFixed(1)}%로 ${volPhrase}.</p>
    </div>`;
  }

  const categoryHtml = buildCategorySectionHtml(symbol, a, spyA);

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
  "name": "${escapeHtml(label)} MDD·고점 대비 하락률 리포트",
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
  h1.ticker-name { font-size: 15px; font-weight: 700; color: #4a5568; letter-spacing: 0.3px; margin-bottom: 2px; }
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
  .note-card { background: #fffdf7; border-left: 4px solid #d69e2e; }
  .note-card p { font-size: 14.5px; line-height: 1.85; color: #3d4852; margin-bottom: 0; }
</style>
</head>
<body>
<div class="container">
  <nav class="crumbs"><a href="/">MDD 분석기</a> &gt; <a href="/tools.html">도구 모음</a> &gt; ${symbol}</nav>

  <div class="card">
    <!-- 이 페이지들에는 h1이 아예 없었다. 크롤러 입장에서 "이 문서가 무엇에 대한
         문서인지" 선언하는 자리가 비어 있던 셈이라, 제목과 같은 문구로 채운다. -->
    <h1 class="ticker-name">${escapeHtml(label)} MDD·고점 대비 하락률</h1>
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
${buildTickerNoteHtml(symbol)}
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
  ${categoryHtml}

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
${COUPANG_RESPONSIVE_BANNER}
</body>
</html>
`;
}

// staleTickers: 이번 실행에서 갱신하지 못한 종목. lastmod까지 오늘 날짜로 바꿔버리면
// 바뀌지도 않은 페이지를 바뀌었다고 알리는 셈이라, 사이트맵에 있던 날짜를 그대로 둔다.
function updateSitemap(tickers, generatedDate, staleTickers = []) {
  let xml = fs.readFileSync(SITEMAP_PATH, 'utf8');
  const previousLastmod = {};
  for (const m of xml.matchAll(/<loc>https:\/\/mddcalc\.com\/stock\/([^<]+)\.html<\/loc><lastmod>([^<]+)<\/lastmod>/g)) {
    previousLastmod[m[1].toUpperCase()] = m[2];
  }
  const stale = new Set(staleTickers);
  xml = xml.replace(/\s*<url><loc>https:\/\/mddcalc\.com\/stock\/[^<]+<\/loc>[\s\S]*?<\/url>/g, '');
  const entries = tickers.map(t => {
    const lastmod = (stale.has(t) && previousLastmod[t]) || generatedDate;
    return `  <url><loc>https://mddcalc.com/stock/${t.toLowerCase()}.html</loc><lastmod>${lastmod}</lastmod><priority>0.7</priority></url>`;
  }).join('\n');
  xml = xml.replace('</urlset>', entries + '\n</urlset>');
  fs.writeFileSync(SITEMAP_PATH, xml);
}

// tools.html 안에 "종목별 실데이터 리포트" 허브 섹션을 정적으로 유지한다.
// (blog.html의 BLOG_GRID_STATIC 마커와 같은 방식 — 크롤러가 JS 없이도 15개 링크를 전부 보게 하려면
// 어딘가 한 곳에는 15개 링크가 정적 HTML로 모여 있어야 한다.)
function updateToolsHub(tickers) {
  const p = path.join(SITE_ROOT, 'tools.html');
  let html = fs.readFileSync(p, 'utf8');
  // 앵커 텍스트에 한글 종목명을 같이 넣는다. 링크 글자는 구글이 대상 페이지를 무엇으로
  // 이해할지에 직접 쓰이는데, 지금까지는 사이트 어디에도 "테슬라"라는 한글이 없어서
  // 한글 검색어로는 후보에 오를 근거 자체가 없었다.
  const chips = tickers.map(t => {
    const kor = TICKER_NAMES[t];
    return `<a href="/stock/${t.toLowerCase()}.html" class="chip">${t}${kor ? ` ${escapeHtml(kor)}` : ''}</a>`;
  }).join('\n        ');
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
  const rawSeries = {};
  const failed = [];
  for (const symbol of TICKERS) {
    process.stdout.write(`⏳ ${symbol} 조회 중... `);
    // 한 종목이 실패해도 전체를 중단하지 않는다. 예전에는 던진 에러가 그대로 올라가
    // 주간 갱신 전체가 죽었는데, 목록에 종목을 늘릴수록 (상장폐지·티커 변경·무료 플랜
    // 미지원 등으로) 한 종목이 실패할 확률이 같이 올라간다. 실패한 종목은 기존 페이지를
    // 그대로 두고 넘어간다.
    try {
      const series = await fetchSeries(symbol);
      rawSeries[symbol] = series;
      analyses[symbol] = analyze(series);
      console.log(`완료 (${series.length}일치, ${analyses[symbol].startDate} ~ ${analyses[symbol].endDate})`);
    } catch (err) {
      failed.push(symbol);
      console.log(`건너뜀 — ${err.message}`);
    }
    await sleep(8000); // 분당 8회 제한 준수 (60s / 8 = 7.5s, 여유 있게 8s)
  }

  if (!analyses[BENCHMARK]) {
    throw new Error(`벤치마크 ${BENCHMARK} 조회에 실패해 비교 섹션을 만들 수 없습니다. 이번 실행은 중단합니다.`);
  }

  // 벤치마크 비교는 "같은 기간"이라고 적는 만큼 실제로 같은 기간이어야 한다.
  // SPY는 2006년부터 데이터가 있지만 BABA는 2014년 상장이라, SPY 전체 구간을 그대로
  // 갖다 붙이면 서로 다른 기간을 비교해놓고 같은 기간이라고 주장하게 된다.
  // 종목별 시작일 이후로 SPY를 잘라내 그 구간만 다시 계산한다.
  const spySeries = rawSeries[BENCHMARK];
  for (const symbol of TICKERS) {
    const a = analyses[symbol];
    if (!a) continue; // 조회 실패분 — 기존 페이지 유지
    let spyA = null;
    if (symbol !== BENCHMARK && spySeries) {
      const windowed = spySeries.filter(p => p.date >= a.startDate && p.date <= a.endDate);
      if (windowed.length > 30) spyA = analyze(windowed);
    }
    const html = buildPage(symbol, a, spyA, generatedDate);
    fs.writeFileSync(path.join(OUT_DIR, `${symbol.toLowerCase()}.html`), html);
  }
  const generatedCount = TICKERS.length - failed.length;
  console.log(`\n✅ ${generatedCount}개 종목 리포트 생성 완료 (/stock/*.html)`);
  if (failed.length) console.log(`⚠️  건너뛴 종목 ${failed.length}개: ${failed.join(', ')}`);

  // 사이트맵과 허브 링크에는 "파일이 실제로 있는" 종목만 넣는다. 조회에 실패한 종목까지
  // 넣어버리면 구글이 존재하지 않는 URL을 크롤링하러 갔다가 404를 받게 되고,
  // 그게 정확히 Search Console 색인 리포트에 쌓이는 오류가 된다.
  const publishedTickers = TICKERS.filter(t =>
    fs.existsSync(path.join(OUT_DIR, `${t.toLowerCase()}.html`))
  );

  updateSitemap(publishedTickers, generatedDate, failed);
  console.log(`✅ sitemap.xml 갱신 완료 (${publishedTickers.length}개)`);

  updateToolsHub(publishedTickers);
  console.log('✅ tools.html 허브 섹션 갱신 완료');
}

main().catch(err => {
  console.error('❌ 생성 실패:', err.message);
  process.exit(1);
});
