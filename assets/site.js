// mddcalc.com 공용 스크립트
// 이 파일은 원래 15개 HTML 에 인라인으로 복제돼 있던 블록입니다. 페이지마다 같은 62KB 를
// 다시 내려받게 되고 이용약관·개인정보처리방침처럼 계산기가 없는 페이지까지 계산 엔진을
// 싣고 있었기 때문에 외부 파일 하나로 분리했습니다. 브라우저가 한 번만 받아 캐시합니다.
//
// 페이지는 이 파일을 불러오기 전에 window.CURRENT_PAGE 를 설정합니다. 페이지 끝의 두 줄이
// 각각 (1) window.CURRENT_PAGE 를 대입하는 인라인 script, (2) 이 파일을 부르는 script 입니다.
// (주석 안에서도 script 종료 태그를 글자 그대로 쓰지 않습니다. 이 파일을 HTML 에 인라인할 때
//  그 문자열이 script 블록을 조기 종료시켜 나머지가 통째로 실행되지 않게 됩니다.)
// index.html 은 이 파일을 쓰지 않습니다 — 통화 표기·공유 이미지 등 홈 전용 기능이 더해진
// 별도 버전을 인라인으로 갖고 있습니다.
const CURRENT_PAGE = (typeof window !== 'undefined' && window.CURRENT_PAGE) || '';

// 여러 도구(MDD, RSI 등)가 같은 티커를 조회할 때 API를 중복 호출하지 않도록 공유하는 캐시.
// 무료 API 한도(분당 8회, 일 800회)를 아끼기 위한 장치입니다. 10분간 유효.
const PRICE_CACHE = {};
const PRICE_CACHE_TTL_MS = 10 * 60 * 1000;

// ── 한국 주식(KRX) 종목표 ────────────────────────────────────────────
// 한글 종목명으로도 찾을 수 있도록 두는 표입니다. 여기 없는 종목은 6자리 코드를
// 그대로 입력하면 됩니다(서버가 코스피/코스닥을 판별합니다).
// 키는 공백 제거 + 대문자로 정규화한 형태입니다.
const KR_STOCKS = {
  // 이 표는 scripts/generate-kr-data.js 가 자동으로 씁니다. 직접 고치지 마세요.
  // 종목을 추가하려면 scripts/kr-tickers.js 에 넣고 생성기를 다시 돌리세요.
  "삼성전자": "005930",
  "SK하이닉스": "000660",
  "LG에너지솔루션": "373220",
  "삼성바이오로직스": "207940",
  "현대차": "005380",
  "현대자동차": "005380",
  "기아": "000270",
  "기아차": "000270",
  "셀트리온": "068270",
  "NAVER": "035420",
  "네이버": "035420",
  "카카오": "035720",
  "LG화학": "051910",
  "삼성SDI": "006400",
  "POSCO홀딩스": "005490",
  "포스코홀딩스": "005490",
  "포스코": "005490",
  "현대모비스": "012330",
  "LG전자": "066570",
  "삼성전기": "009150",
  "삼성물산": "028260",
  "SK": "034730",
  "LG": "003550",
  "SK스퀘어": "402340",
  "KB금융": "105560",
  "신한지주": "055550",
  "하나금융지주": "086790",
  "우리금융지주": "316140",
  "기업은행": "024110",
  "삼성생명": "032830",
  "삼성화재": "000810",
  "카카오뱅크": "323410",
  "한국전력": "015760",
  "한전": "015760",
  "두산에너빌리티": "034020",
  "한화에어로스페이스": "012450",
  "한화오션": "042660",
  "HD한국조선해양": "009540",
  "HD현대중공업": "329180",
  "한국항공우주": "047810",
  "KAI": "047810",
  "고려아연": "010130",
  "SK이노베이션": "096770",
  "HMM": "011200",
  "대한항공": "003490",
  "현대건설": "000720",
  "SK텔레콤": "017670",
  "SKT": "017670",
  "KT": "030200",
  "KT&G": "033780",
  "CJ제일제당": "097950",
  "이마트": "139480",
  "아모레퍼시픽": "090430",
  "크래프톤": "259960",
  "하이브": "352820",
  "HYBE": "352820",
  "엔씨소프트": "036570",
  "NC소프트": "036570",
  "넷마블": "251270",
  "한미반도체": "042700",
  "KODEX200": "069500",
  "코덱스200": "069500",
  "KODEX레버리지": "122630",
  "코덱스레버리지": "122630",
  "에코프로비엠": "247540",
  "에코프로": "086520",
  "알테오젠": "196170",
  "HLB": "028300",
  "리노공업": "058470",
  "레인보우로보틱스": "277810",
  "펄어비스": "263750",
  "카카오게임즈": "293490",
  "에스엠": "041510",
  "SM엔터": "041510",
  "SM": "041510",
  "이오테크닉스": "039030",
  "원익IPS": "240810",
  "위메이드": "112040",
  "엘앤에프": "066970",
  "코스피": "KS11",
  "KOSPI": "KS11",
  "코스닥": "KQ11",
  "KOSDAQ": "KQ11",
  "005930": "005930",
  "000660": "000660",
  "373220": "373220",
  "207940": "207940",
  "005380": "005380",
  "000270": "000270",
  "068270": "068270",
  "035420": "035420",
  "035720": "035720",
  "051910": "051910",
  "006400": "006400",
  "005490": "005490",
  "012330": "012330",
  "066570": "066570",
  "009150": "009150",
  "028260": "028260",
  "034730": "034730",
  "003550": "003550",
  "402340": "402340",
  "105560": "105560",
  "055550": "055550",
  "086790": "086790",
  "316140": "316140",
  "024110": "024110",
  "032830": "032830",
  "000810": "000810",
  "323410": "323410",
  "015760": "015760",
  "034020": "034020",
  "012450": "012450",
  "042660": "042660",
  "009540": "009540",
  "329180": "329180",
  "047810": "047810",
  "010130": "010130",
  "096770": "096770",
  "011200": "011200",
  "003490": "003490",
  "000720": "000720",
  "017670": "017670",
  "030200": "030200",
  "033780": "033780",
  "097950": "097950",
  "139480": "139480",
  "090430": "090430",
  "259960": "259960",
  "352820": "352820",
  "036570": "036570",
  "251270": "251270",
  "042700": "042700",
  "069500": "069500",
  "122630": "122630",
  "247540": "247540",
  "086520": "086520",
  "196170": "196170",
  "028300": "028300",
  "058470": "058470",
  "277810": "277810",
  "263750": "263750",
  "293490": "293490",
  "041510": "041510",
  "039030": "039030",
  "240810": "240810",
  "112040": "112040",
  "066970": "066970",
  "KS11": "KS11",
  "KQ11": "KQ11",
};

function normalizeKrName(s) {
  return String(s || '').trim().replace(/\s+/g, '').toUpperCase();
}

// 입력값을 조회에 쓸 심볼로 바꿉니다.
//   "삼성전자", "005930", "005930.KS" → 한국 (code 005930)
//   "코스피" → 한국 (code KS11)
//   그 밖의 "TSLA" 등 → 미국 (Twelve Data)
// 한국 종목은 Twelve Data 무료 플랜에 없어서 미리 만들어 둔 정적 파일을 읽습니다.
function resolveSymbol(input) {
  const raw = String(input || '').trim();
  const byName = Object.prototype.hasOwnProperty.call(KR_STOCKS, normalizeKrName(raw)) ? KR_STOCKS[normalizeKrName(raw)] : null;
  if (byName) return { symbol: byName, isKR: true, code: byName, typed: raw };

  const upper = raw.toUpperCase();
  const m = upper.match(/^(\d{6})(?:\.(?:KS|KQ))?$/);
  if (m) return { symbol: m[1], isKR: true, code: m[1], typed: raw };
  const idx = upper.match(/^\^?(KS11|KQ11)$/);
  if (idx) return { symbol: idx[1], isKR: true, code: idx[1], typed: raw };

  return { symbol: upper, isKR: false, code: null, typed: raw };
}

// 미리 만들어 둔 한국 주식 일봉을 읽습니다. (scripts/generate-kr-data.js 가 생성)
//
// 정적 파일이라 실패할 여지가 거의 없습니다. 시세 소스가 막히든 말든 사용자가 보는 것은
// 저장소에 커밋된 파일이고, 갱신이 실패하면 지난번 데이터가 그대로 서빙됩니다.
// 저장 형식은 용량을 줄이려고 배열로 눌러 놓았으므로 여기서 원래 형태로 되돌립니다.
//   d: 에포크 이후 일수  h: 고가  c: 종가   (모두 과거 → 최신 순)
async function fetchKrSeries(code) {
  let res;
  try {
    res = await fetch('/data/kr/' + encodeURIComponent(code) + '.json');
  } catch (e) {
    throw new Error('네트워크 연결을 확인해주세요.');
  }
  if (res.status === 404) {
    const err = new Error('아직 지원하지 않는 한국 종목입니다.');
    err.krUnsupported = true;
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const j = await res.json();
  if (!j || !Array.isArray(j.d) || j.d.length === 0) throw new Error('데이터가 없습니다. 티커를 확인해주세요.');

  // 기존 계산 코드가 쓰는 Twelve Data 형태(최신 날짜가 배열 앞)로 되돌립니다.
  // open/low 는 MDD 계산에 쓰이지 않아 저장하지 않았으므로 종가로 채웁니다.
  const values = [];
  for (let i = j.d.length - 1; i >= 0; i--) {
    const close = j.c[i];
    values.push({
      datetime: new Date(j.d[i] * 86400000).toISOString().slice(0, 10),
      open: close, high: j.h[i], low: close, close,
    });
  }
  return { values, meta: { symbol: j.symbol, name: j.name, currency: j.currency, updated: j.updated } };
}

async function fetchPriceSeries(ticker, outputsize) {
  const resolved = resolveSymbol(ticker);
  const key = resolved.symbol;
  const cached = PRICE_CACHE[key];
  if (cached && (Date.now() - cached.time) < PRICE_CACHE_TTL_MS && cached.values.length >= outputsize) {
    // 캐시에 더 많이 들어 있어도 요청한 개수만 돌려줍니다. values 는 최신순이라 앞에서 자릅니다.
    // (RSI 화면이 "최근 N일 기준"이라고 표시하므로 실제 개수가 N과 같아야 합니다.)
    return { fromCache: true, values: cached.values.slice(0, outputsize), metadata: null, meta: cached.meta || null, resolved };
  }

  // 한국 종목은 정적 파일을 읽습니다. API 한도도, 실시간 호출 실패도 없습니다.
  // 파일에는 전체 히스토리가 들어 있으므로 캐시에는 전부 담고, 반환은 요청한 개수만 합니다.
  // 그래야 미국 종목(요청한 만큼만 받아옴)과 동작이 같아집니다.
  if (resolved.isKR) {
    const kr = await fetchKrSeries(resolved.code);
    PRICE_CACHE[key] = { values: kr.values, meta: kr.meta, time: Date.now() };
    return { fromCache: false, values: kr.values.slice(0, outputsize), metadata: null, meta: kr.meta, resolved };
  }

  const res = await fetch('/api/twelve-data/time-series', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: key, interval: '1day', outputsize })
  });
  const json = await res.json();

  if (res.status === 429) {
    const err = new Error(json.message || '오늘 사용량을 모두 사용했어요.');
    err.rateLimited429 = true;
    throw err;
  }
  if (json.status === 'error' && json.message && json.message.includes('rate limit')) {
    const err = new Error('분당 요청 한도(8회)를 초과했습니다. 60초 뒤에 다시 시도해주세요.');
    err.rateLimitedMinute = true;
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (json.error) throw new Error(json.error);
  if (json.status === 'error') throw new Error(json.message || 'API 오류');
  if (!json.values || json.values.length === 0) throw new Error('데이터가 없습니다. 티커를 확인해주세요.');

  PRICE_CACHE[key] = { values: json.values, meta: json.meta || null, time: Date.now() };
  return { fromCache: false, values: json.values, metadata: json._metadata || null, meta: json.meta || null, resolved };
}

// 벤치마크(SPY 등)는 하루 1회만 API를 쓰도록 localStorage에 날짜와 함께 저장해 재사용합니다.
// (메모리 캐시인 PRICE_CACHE는 페이지를 새로고침하면 사라지지만, 이건 브라우저에 남아있어 하루 종일 재사용됩니다.)
async function fetchBenchmarkSeries(symbol) {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = 'bench_cache_' + symbol;

  try {
    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (cached.date === today && Array.isArray(cached.values) && cached.values.length > 0) {
        return { values: cached.values, fromCache: true };
      }
    }
  } catch (e) { /* localStorage 접근 불가(사파리 시크릿모드 등) 시 그냥 API로 진행 */ }

  const { values } = await fetchPriceSeries(symbol, 5000);
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ date: today, values }));
  } catch (e) { /* 저장 실패(용량 초과 등)는 기능에 지장 없으므로 무시 */ }
  return { values, fromCache: false };
}

let STATE = {
  raw: null,
  filtered: null,
  ticker: '',
  mode: 'high',
  startDate: null,
  endDate: null,
  ddChart: null,
  priceChart: null,
};

window.addEventListener('DOMContentLoaded', () => {
  // CSS 클래스로 홈 페이지 활성화
  // 홈(MDD 계산기) 페이지에서만 실행 — 다른 페이지에는 #ticker 요소가 없음
  const tickerEl = document.getElementById('ticker');
  if (tickerEl) {
    const savedTicker = localStorage.getItem('td_last_ticker');
    if (savedTicker) tickerEl.value = savedTicker;

    // 블로그 CTA 등 다른 페이지에서 ?ticker=XXX 로 넘어온 경우 자동 조회
    const qTicker = new URLSearchParams(window.location.search).get('ticker');
    if (qTicker) {
      tickerEl.value = qTicker.toUpperCase();
      loadData();
    }

    renderFavorites();

    tickerEl.addEventListener('keypress', e => {
      if (e.key === 'Enter') loadData();
    });
    tickerEl.addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase();
    });
  }

  const rsiTickerEl = document.getElementById('rsiTicker');
  if (rsiTickerEl) {
    rsiTickerEl.addEventListener('keypress', e => {
      if (e.key === 'Enter') calcRSIByTicker();
    });
    rsiTickerEl.addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase();
    });
  }

  // 블로그 페이지: 그리드 렌더 + ?post=ID 로 특정 글 바로 열기
  if (document.getElementById('blogGrid')) {
    // 글 목록은 정적 HTML로 제공. 구버전 ?post=N 링크만 정적 페이지로 리다이렉트.
    const qPost = new URLSearchParams(window.location.search).get('post');
    if (qPost && /^[0-9]+$/.test(qPost)) {
      window.location.replace('/blog/' + qPost + '.html');
    }
  }

  // 상단 네비게이션 활성 표시 (페이지별 CURRENT_PAGE 값 기준)
  if (typeof CURRENT_PAGE !== 'undefined') {
    document.querySelectorAll('.site-nav a').forEach(a => a.classList.remove('active'));
    let navId = 'nav-' + CURRENT_PAGE;
    if (['rsi','dividend','fx','roi','compound','leverage','dca'].includes(CURRENT_PAGE)) {
      navId = 'nav-tools';
    }
    const navLink = document.getElementById(navId);
    if (navLink) navLink.classList.add('active');
  }
});

// ========== 관심종목 저장 ==========
let favorites = JSON.parse(localStorage.getItem('mdd_favorites') || '[]');

function saveFavorites() {
  localStorage.setItem('mdd_favorites', JSON.stringify(favorites));
}

function toggleFavorite() {
  const t = STATE.ticker;
  if (!t) return;
  const idx = favorites.indexOf(t);
  if (idx === -1) {
    favorites.unshift(t);
    if (favorites.length > 20) favorites = favorites.slice(0, 20);
  } else {
    favorites.splice(idx, 1);
  }
  saveFavorites();
  updateFavBtn();
  renderFavorites();
}

function removeFavorite(ticker, event) {
  if (event) event.stopPropagation();
  favorites = favorites.filter(f => f !== ticker);
  saveFavorites();
  updateFavBtn();
  renderFavorites();
}

function updateFavBtn() {
  const btn = document.getElementById('favBtn');
  if (!btn) return;
  const isFav = favorites.includes(STATE.ticker);
  btn.textContent = isFav ? '★' : '☆';
  btn.classList.toggle('active', isFav);
}

function loadFavoriteTicker(ticker) {
  const input = document.getElementById('ticker');
  if (input) input.value = ticker;
  loadData();
}

function renderFavorites() {
  const panel = document.getElementById('favoritesPanel');
  const list = document.getElementById('favoritesList');
  if (!panel || !list) return;
  if (favorites.length === 0) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  list.innerHTML = favorites.map(t => `
    <span class="fav-chip" onclick="loadFavoriteTicker('${escapeHtml(t)}')">
      ${escapeHtml(t)}
      <button class="fav-remove" onclick="removeFavorite('${escapeHtml(t)}', event)" title="삭제">✕</button>
    </span>
  `).join('');
}

function showStatus(msg, type='info') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status show ' + type;
}

async function loadData() {
  const ticker = document.getElementById('ticker').value.trim().toUpperCase();
  
  if (!ticker) return showStatus('❌ 티커를 입력해주세요', 'error');
  if (!isValidTickerFormat(ticker)) return showStatus('❌ 종목 형식이 올바르지 않습니다 (미국 티커 TSLA, 한국 종목코드 005930 또는 종목명 삼성전자)', 'error');

  localStorage.setItem('td_last_ticker', ticker);

  document.getElementById('loading').classList.add('show');
  document.getElementById('result').classList.add('hidden');

  try {
    showStatus('⏳ 데이터 불러오는 중...', 'info');

    const { values, fromCache, metadata } = await fetchPriceSeries(ticker, 5000);

    const raw = values.map(v => ({
      date: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
    })).reverse();

    STATE.raw = raw;
    STATE.ticker = ticker;
    setPreset(5);
    const latestDate = raw.length > 0 ? raw[raw.length-1].date : 'N/A';
    
    // 사용량 정보 표시
    let usageMsg = `✅ ${ticker} 데이터 ${raw.length}일치 로드 완료 (최신: ${latestDate})`;
    if (fromCache) {
      usageMsg += `\n♻️ 방금 조회한 데이터를 재사용했어요 (API 미사용)`;
    } else if (metadata) {
      usageMsg += `\n📊 오늘 사용량: ${metadata.todayUsage}/${metadata.dailyLimit}회 (남은 횟수: ${metadata.remainingUsage}회)`;
    }
    showStatus(usageMsg, 'success');
    document.getElementById('result').classList.remove('hidden');
  } catch (e) {
    const errorMsg = e.message;
    console.error('API 에러:', errorMsg, e);
    showStatus(`❌ ${errorMsg} — 티커 오타 / 백엔드 오류 / 무료 한도(분당 8회·일 800회) 확인`, 'error');
  } finally {
    document.getElementById('loading').classList.remove('show');
  }
}

function setPreset(preset) {
  if (!STATE.raw) return;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-years="${preset}"]`);
  if (btn) btn.classList.add('active');

  const latest = new Date(STATE.raw[STATE.raw.length-1].date);
  const earliest = new Date(STATE.raw[0].date);
  let start;
  if (preset === 'all') start = earliest;
  else if (preset === 'ytd') start = new Date(latest.getFullYear(), 0, 1);
  else { start = new Date(latest); start.setFullYear(start.getFullYear() - preset); }

  if (start < earliest) start = earliest;
  document.getElementById('startDate').value = start.toISOString().slice(0,10);
  document.getElementById('endDate').value = latest.toISOString().slice(0,10);
  rerender();
}

function setMode(mode) {
  STATE.mode = mode;
  document.getElementById('modeHigh').classList.toggle('active', mode === 'high');
  document.getElementById('modeClose').classList.toggle('active', mode === 'close');
  rerender();
}

function rerender() {
  if (!STATE.raw) return;
  const sd = document.getElementById('startDate').value;
  const ed = document.getElementById('endDate').value;
  STATE.startDate = sd; STATE.endDate = ed;
  STATE.filtered = STATE.raw.filter(r => r.date >= sd && r.date <= ed);
  if (STATE.filtered.length < 2) {
    showStatus('❌ 선택 기간에 데이터가 너무 적습니다', 'error');
    return;
  }
  render();
}

function analyze(data, mode) {
  const n = data.length;
  const peakSeries = mode === 'high' ? data.map(d => d.high) : data.map(d => d.close);
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

  const futureMax = new Array(n);
  let fm = -Infinity;
  for (let i = n - 1; i >= 0; i--) {
    if (peakSeries[i] > fm) fm = peakSeries[i];
    futureMax[i] = fm;
  }
  const recovered = runMax.map((m, i) => futureMax[i] > m + 1e-9);

  const currentPrice = closes[n-1];
  const currentDD = dd[n-1];
  const currentDate = dates[n-1];
  const athPrice = runMax[n-1];
  const athIdx = mxIdxArr[n-1];
  const athDate = dates[athIdx];

  let maxDD = 0, maxDDIdx = 0;
  for (let i = 0; i < n; i++) {
    if (dd[i] < maxDD) { maxDD = dd[i]; maxDDIdx = i; }
  }

  const buckets = [5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100];
  const EPS = 1e-9;
  const recoveryTable = buckets.map(b => {
    let hit = 0, rec = 0;
    for (let i = 0; i < n; i++) {
      if (dd[i] <= -b + EPS) {
        hit++;
        if (recovered[i]) rec++;
      }
    }
    const rate = hit === 0 ? 0 : (rec / hit * 100);
    return { bucket: b, hit, rate, total: n, everHit: hit > 0 };
  });

  return {
    n, dates, closes, peakSeries, runMax, dd,
    currentPrice, currentDD, currentDate,
    athPrice, athDate,
    maxDD, maxDDDate: dates[maxDDIdx],
    recoveryTable,
  };
}

function fmt(n, d=2) { return n==null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits:d, maximumFractionDigits:d }); }
function fmtPct(n, d=2) { return n==null || isNaN(n) ? '—' : Number(n).toFixed(d) + '%'; }

// 사용자 입력(티커, 이메일, 에러 메시지 등)을 innerHTML에 넣기 전 이스케이프 처리 (XSS 방지)
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 티커 형식 검증 (알파벳/숫자/점/하이픈만 허용, 최대 10자) — 이상한 값이 API까지 가는 것 자체를 차단
// 미국 티커(TSLA)뿐 아니라 한국 종목 코드(005930 / 005930.KS), 지수(^KS11),
// 한글 종목명("삼성전자")까지 받습니다.
function isValidTickerFormat(t) {
  return /^[A-Z0-9.\-^&가-힣 ]{1,20}$/.test(t);
}

function render() {
  const A = analyze(STATE.filtered, STATE.mode);
  const t = STATE.ticker;

  document.getElementById('tickerLabel').textContent = t + ' (' + (STATE.mode === 'high' ? '장중 최고가 기준' : '종가 기준') + ')';
  updateFavBtn();

  document.getElementById('currentPrice').textContent = '$' + fmt(A.currentPrice);
  document.getElementById('currentDate').textContent = A.currentDate;
  document.getElementById('athPrice').textContent = '$' + fmt(A.athPrice);
  document.getElementById('athDate').textContent = A.athDate;

  const ddEl = document.getElementById('currentDD');
  ddEl.textContent = fmtPct(A.currentDD);
  ddEl.classList.remove('mild','small');
  if (A.currentDD > -5) ddEl.classList.add('small');
  else if (A.currentDD > -15) ddEl.classList.add('mild');

  const interp = A.currentDD > -3 ? '고점 근처'
               : A.currentDD > -10 ? '소폭 조정'
               : A.currentDD > -20 ? '조정 진행 중'
               : A.currentDD > -30 ? '약세장 진입'
               : '심한 하락';
  document.getElementById('ddInterpret').textContent = interp;

  let sig;
  if (A.currentDD <= -30) sig = { cls:'signal-strong', e:'🔥', t:'역대급 하락 구간', d:'과거 데이터상 매우 깊은 하락 수준에 도달했습니다. 기업의 본질적 가치와 시장 상황을 함께 검토할 시점입니다.' };
  else if (A.currentDD <= -20) sig = { cls:'signal-mid', e:'🟠', t:'주요 조정 구간', d:'주가가 고점 대비 유의미하게 하락한 구간입니다. 과거 사례에서는 이 시점부터 자금을 나누어 대응하는 방식이 활용되기도 했습니다.' };
  else if (A.currentDD <= -10) sig = { cls:'signal-mid', e:'🟡', t:'통상적 조정 구간', d:'시장의 통상적인 조정 범위 내에 있습니다. 과거 데이터를 통해 현재 하락의 깊이를 확인해보시기 바랍니다.' };
  else if (A.currentDD <= -3) sig = { cls:'signal-mild', e:'🙂', t:'단기 변동 구간', d:'단기적인 가격 변동이 진행 중인 구간입니다. 추세 변화 여부를 모니터링하며 대응할 수 있습니다.' };
  else sig = { cls:'signal-none', e:'⏸️', t:'신고가 근처 구간', d:'현재 주가가 역사적 신고가 부근에 위치해 있습니다. 과거 데이터상으로는 이 구간에서 변동성이 커지는 경향이 있었습니다.' };

  const sc = document.getElementById('signalCard');
  sc.className = 'signal-card ' + sig.cls;
  document.getElementById('signalEmoji').textContent = sig.e;
  document.getElementById('signalTitle').textContent = sig.t;
  document.getElementById('signalDesc').textContent = sig.d;

  const t15 = A.athPrice * 0.85, t20 = A.athPrice * 0.80, t30 = A.athPrice * 0.70;
  document.getElementById('t15').textContent = '$' + fmt(t15);
  document.getElementById('t20').textContent = '$' + fmt(t20);
  document.getElementById('t30').textContent = '$' + fmt(t30);
  document.getElementById('r15').classList.toggle('hidden', A.currentPrice > t15);
  document.getElementById('r20').classList.toggle('hidden', A.currentPrice > t20);
  document.getElementById('r30').classList.toggle('hidden', A.currentPrice > t30);

  document.getElementById('maxDD').textContent = fmtPct(A.maxDD);
  document.getElementById('maxDDDate').textContent = A.maxDDDate;
  document.getElementById('dataStart').textContent = A.dates[0];
  document.getElementById('totalDays').textContent = A.n.toLocaleString() + '일';

  drawDDChart(A);
  drawPriceChart(A);
  renderRecovery(A);
  renderTV(t);
  renderDeepAnalysis();
  renderBenchmarkComparison();
}

// ========== 심층 분석 (백분위 / 경과일 / 회복통계 / 이동평균 / Top5 / 유사사례) ==========
function daysBetween(d1, d2) {
  return Math.round((new Date(d2) - new Date(d1)) / 86400000);
}

// 전체 원본 데이터(STATE.raw)를 스캔해서 "고점 → 회복(또는 진행중)" 구간(에피소드) 목록을 만듭니다.
function computeEpisodes(raw, mode) {
  const peakSeries = mode === 'high' ? raw.map(d => d.high) : raw.map(d => d.close);
  const closes = raw.map(d => d.close);
  const dates = raw.map(d => d.date);
  const n = raw.length;
  const episodes = [];
  if (n < 2) return episodes;

  let peak = peakSeries[0], peakIdx = 0;
  let cur = null;
  for (let i = 1; i < n; i++) {
    if (peakSeries[i] >= peak) {
      if (cur) {
        cur.recovered = true;
        cur.recoverIdx = i;
        episodes.push(cur);
        cur = null;
      }
      peak = peakSeries[i];
      peakIdx = i;
    } else {
      const ddNow = (closes[i] / peak - 1) * 100;
      if (!cur) cur = { peakIdx, troughIdx: i, troughDD: ddNow };
      else if (ddNow < cur.troughDD) { cur.troughIdx = i; cur.troughDD = ddNow; }
    }
  }
  if (cur) { cur.recovered = false; episodes.push(cur); }

  episodes.forEach(ep => {
    ep.peakDate = dates[ep.peakIdx];
    ep.troughDate = dates[ep.troughIdx];
    if (ep.recovered) {
      ep.recoverDate = dates[ep.recoverIdx];
      ep.daysToRecover = daysBetween(ep.peakDate, ep.recoverDate);
    } else {
      ep.recoverDate = null;
      ep.daysToRecover = null;
      ep.daysSoFar = daysBetween(ep.peakDate, dates[n - 1]);
    }
  });
  return episodes;
}

function computeMA(raw, period) {
  if (raw.length < period) return null;
  const slice = raw.slice(raw.length - period);
  return slice.reduce((a, d) => a + d.close, 0) / period;
}

function renderDeepAnalysis() {
  if (!STATE.raw || STATE.raw.length < 2) return;
  const raw = STATE.raw;
  const mode = STATE.mode;
  const n = raw.length;

  const F = analyze(raw, mode); // 전체(필터 무관) 기준 분석
  const episodes = computeEpisodes(raw, mode);

  // 1) 하락폭 백분위
  const percentileEl = document.getElementById('ddPercentile');
  let percentile = null;
  if (F.currentDD >= -0.01) {
    percentileEl.textContent = '신고가 근처';
  } else {
    const worseOrEqualDays = F.dd.filter(v => v <= F.currentDD).length;
    percentile = worseOrEqualDays / n * 100;
    percentileEl.textContent = `상위 ${percentile.toFixed(1)}% (심한 편)`;
  }

  // 진행 중인(미회복) 에피소드 = 현재 하락 구간
  const lastEp = episodes[episodes.length - 1];
  const currentEp = (lastEp && !lastEp.recovered) ? lastEp : null;

  // 2) 경과일
  document.getElementById('ddDaysElapsed').textContent = currentEp
    ? `${currentEp.daysSoFar.toLocaleString()}일째`
    : '신고가 경신 중';

  // 3) 비슷한 깊이 평균 회복일 + 유사 사례
  const avgBox = document.getElementById('ddAvgRecoveryDays');
  const simBox = document.getElementById('similarCasesBody');
  if (!currentEp) {
    avgBox.textContent = '해당 없음';
    simBox.innerHTML = '<span style="color:#a0aec0;">현재 신고가 부근이라 비교할 하락 사례가 없습니다.</span>';
  } else {
    const depth = currentEp.troughDD;
    const comparable = episodes.filter(ep => ep !== currentEp && ep.recovered && ep.troughDD <= depth + 1e-9);
    if (comparable.length === 0) {
      avgBox.textContent = '비교 사례 없음';
      simBox.innerHTML = '<span style="color:#a0aec0;">이 정도로 깊은 하락은 조회 기간 내 처음이라 비교할 과거 사례가 없습니다.</span>';
    } else {
      const avgDays = comparable.reduce((a, e) => a + e.daysToRecover, 0) / comparable.length;
      avgBox.textContent = `약 ${Math.round(avgDays).toLocaleString()}일`;

      const closest = episodes
        .filter(ep => ep !== currentEp && ep.recovered)
        .slice()
        .sort((a, b) => Math.abs(a.troughDD - depth) - Math.abs(b.troughDD - depth))
        .slice(0, 3);
      simBox.innerHTML = closest.length ? closest.map(ep =>
        `<div style="margin-bottom:6px;">📌 <b>${ep.peakDate}</b> 고점 이후 <b style="color:#e53e3e;">${ep.troughDD.toFixed(1)}%</b> 하락 → <b style="color:#38a169;">${ep.daysToRecover}일</b> 만에 회복 (${ep.recoverDate})</div>`
      ).join('') : '<span style="color:#a0aec0;">비교 사례 없음</span>';
    }
  }

  // 4) 이동평균선 50일/200일
  const sma50 = computeMA(raw, 50);
  const sma200 = computeMA(raw, 200);
  const price = raw[n - 1].close;
  document.getElementById('ma50Value').textContent = sma50 != null ? `$${fmt(sma50)} (현재가 ${price >= sma50 ? '위' : '아래'})` : '데이터 부족 (50일 미만)';
  document.getElementById('ma200Value').textContent = sma200 != null ? `$${fmt(sma200)} (현재가 ${price >= sma200 ? '위' : '아래'})` : '데이터 부족 (200일 미만)';
  const crossEl = document.getElementById('maCrossStatus');
  if (sma50 != null && sma200 != null) {
    crossEl.innerHTML = sma50 > sma200
      ? '🟢 <b>골든크로스 상태</b> — 50일 평균이 200일 평균보다 높아 중기 상승 흐름입니다.'
      : '🔴 <b>데드크로스 상태</b> — 50일 평균이 200일 평균보다 낮아 중기 하락 흐름입니다.';
  } else {
    crossEl.textContent = '⚠️ 상장(또는 데이터 시작) 후 200일이 지나지 않아 계산할 수 없습니다.';
  }

  // 5) 역대 낙폭 Top 5
  const top5 = episodes.slice().sort((a, b) => a.troughDD - b.troughDD).slice(0, 5);
  document.getElementById('top5DrawdownsBody').innerHTML = top5.length ? top5.map((ep, i) => `
    <tr>
      <td>${i + 1}위</td>
      <td>${ep.peakDate}</td>
      <td style="color:#e53e3e; font-weight:700;">${ep.troughDD.toFixed(1)}%</td>
      <td>${ep.recovered ? `✅ ${ep.daysToRecover}일 만에 회복` : `⏳ 진행 중 (${ep.daysSoFar}일째)`}</td>
    </tr>`).join('') : '<tr><td colspan="4" style="color:#a0aec0;">데이터가 부족합니다</td></tr>';

  STATE.deepAnalysis = { percentile, currentEp, top5 };
}

function copyResultSummary() {
  if (!STATE.filtered) return;
  const A = analyze(STATE.filtered, STATE.mode);
  const t = STATE.ticker;
  const lines = [
    `📊 ${t} MDD 분석 결과`,
    `현재가: $${fmt(A.currentPrice)} (${A.currentDate})`,
    `구간 최고가: $${fmt(A.athPrice)} (${A.athDate})`,
    `고점 대비 하락률: ${fmtPct(A.currentDD)}`,
    `역대 최대 하락: ${fmtPct(A.maxDD)} (${A.maxDDDate})`,
  ];
  if (STATE.deepAnalysis) {
    const d = STATE.deepAnalysis;
    if (d.percentile != null) lines.push(`하락폭 순위: 상위 ${d.percentile.toFixed(1)}%`);
    if (d.currentEp) lines.push(`하락 경과: ${d.currentEp.daysSoFar.toLocaleString()}일째`);
  }
  lines.push('', `MDD 분석기(${location.hostname})에서 계산 · 투자 조언 아님, 참고용`);
  const text = lines.join('\n');

  const statusEl = document.getElementById('copyStatus');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      statusEl.textContent = '✅ 복사되었습니다! 원하는 곳에 붙여넣기 하세요.';
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    }).catch(() => {
      statusEl.textContent = '❌ 복사에 실패했어요. 브라우저 권한을 확인해주세요.';
    });
  } else {
    statusEl.textContent = '❌ 이 브라우저에서는 복사 기능을 지원하지 않아요.';
  }
}

// ========== S&P500(SPY) 대비 비교 (SPY는 하루 1회만 API 호출) ==========
async function renderBenchmarkComparison() {
  const loadingEl = document.getElementById('benchmarkLoading');
  const resultEl = document.getElementById('benchmarkResult');
  if (!loadingEl || !resultEl) return;
  if (!STATE.raw || !STATE.filtered || STATE.filtered.length < 2) return;

  if (STATE.ticker === 'SPY') {
    loadingEl.style.display = 'none';
    resultEl.innerHTML = '<div style="color:#a0aec0; font-size:13px;">지금 조회 중인 종목이 SPY(S&P500) 자체라서 비교가 필요 없어요.</div>';
    return;
  }

  loadingEl.style.display = 'block';
  resultEl.innerHTML = '';
  const requestTicker = STATE.ticker; // 응답 도착 전에 사용자가 다른 티커를 조회했는지 확인용

  try {
    const { values } = await fetchBenchmarkSeries('SPY');
    if (STATE.ticker !== requestTicker) return; // 그 사이 다른 종목을 조회했으면 이 결과는 버림

    const spyRaw = values.map(v => ({
      date: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
    })).reverse();

    // 1) SPY 자체의 현재 하락 상태 (전체 히스토리 기준 — 심층분석과 동일한 analyze() 재사용)
    const spyFull = analyze(spyRaw, STATE.mode);
    const F = analyze(STATE.raw, STATE.mode);
    const tickerDD = F.currentDD, spyDD = spyFull.currentDD;

    // 2) 조회 기간(현재 필터된 기간)과 같은 날짜 구간으로 SPY를 맞춰 누적수익률 비교
    const sd = STATE.filtered[0].date, ed = STATE.filtered[STATE.filtered.length - 1].date;
    const spyFiltered = spyRaw.filter(r => r.date >= sd && r.date <= ed);

    let compareHtml = '';
    if (spyFiltered.length >= 2) {
      const tickerReturn = (STATE.filtered[STATE.filtered.length - 1].close / STATE.filtered[0].close - 1) * 100;
      const spyReturn = (spyFiltered[spyFiltered.length - 1].close / spyFiltered[0].close - 1) * 100;
      const alpha = tickerReturn - spyReturn;
      const alphaColor = alpha >= 0 ? '#38a169' : '#e53e3e';
      compareHtml = `
        <div class="stats-grid" style="margin-bottom:14px;">
          <div class="stat-box"><div class="label">${escapeHtml(STATE.ticker)} 조회기간 수익률</div><div class="value" style="font-size:15px;">${tickerReturn >= 0 ? '+' : ''}${tickerReturn.toFixed(1)}%</div></div>
          <div class="stat-box"><div class="label">SPY 같은기간 수익률</div><div class="value" style="font-size:15px;">${spyReturn >= 0 ? '+' : ''}${spyReturn.toFixed(1)}%</div></div>
          <div class="stat-box"><div class="label">초과 수익률(알파)</div><div class="value" style="font-size:15px; color:${alphaColor};">${alpha >= 0 ? '+' : ''}${alpha.toFixed(1)}%p</div></div>
        </div>`;
    }

    // 3) 지금 하락이 이 종목만의 이슈인지, 시장 전체 하락인지
    let context;
    if (spyDD <= -3) {
      context = `📉 지금 S&P500 전체도 고점 대비 <b>${fmtPct(spyDD)}</b> 하락한 상태예요. 시장 전반이 조정을 받고 있는 시기입니다.`;
    } else {
      context = `📈 S&P500 전체는 고점 대비 <b>${fmtPct(spyDD)}</b>로 신고가 근처예요. 지금 이 종목의 하락은 시장 전체보다는 <b>개별 종목 이슈에 가깝다</b>고 볼 수 있어요.`;
    }
    const diff = tickerDD - spyDD; // 음수면 이 종목이 시장보다 더 빠진 것
    const diffText = diff < -0.01
      ? `현재 이 종목은 SPY보다 <b style="color:#e53e3e;">${Math.abs(diff).toFixed(1)}%p 더 깊게</b> 하락한 상태입니다.`
      : diff > 0.01
      ? `현재 이 종목은 SPY보다 <b style="color:#38a169;">${Math.abs(diff).toFixed(1)}%p 덜</b> 하락한, 시장보다 상대적으로 견고한 상태입니다.`
      : `현재 이 종목의 하락폭은 SPY와 거의 비슷한 수준입니다.`;

    resultEl.innerHTML = `
      ${compareHtml}
      <div style="background:#f7fafc; padding:14px; border-radius:8px; font-size:13px; color:#4a5568; line-height:1.8;">
        <div>${context}</div>
        <div style="margin-top:6px;">${diffText}</div>
      </div>
      <p style="font-size:11px; color:#a0aec0; margin-top:8px;">⚠️ SPY 데이터는 API 사용량 절약을 위해 하루 한 번만 갱신됩니다 (브라우저 기준 당일 데이터 재사용).</p>
    `;
  } catch (e) {
    if (STATE.ticker !== requestTicker) return;
    resultEl.innerHTML = `<div style="background:#fed7d7; color:#742a2a; padding:12px; border-radius:8px; font-size:13px;">❌ SPY 비교 데이터를 불러오지 못했어요: ${escapeHtml(e.message)}</div>`;
  } finally {
    if (STATE.ticker === requestTicker) loadingEl.style.display = 'none';
  }
}

function drawDDChart(A) {
  if (STATE.ddChart) STATE.ddChart.destroy();
  const step = Math.max(1, Math.floor(A.n / 600));
  const pts = [];
  for (let i = 0; i < A.n; i += step) pts.push({ x: A.dates[i], y: A.dd[i] });
  if (pts[pts.length-1].x !== A.dates[A.n-1]) pts.push({ x: A.dates[A.n-1], y: A.dd[A.n-1] });

  const ctx = document.getElementById('ddChart').getContext('2d');
  STATE.ddChart = new Chart(ctx, {
    type: 'line',
    data: { datasets: [{
      label: '고점 대비 하락률 (%)', data: pts,
      borderColor: '#e53e3e', backgroundColor: 'rgba(229,62,62,0.25)',
      fill: true, pointRadius: 0, borderWidth: 1.5, tension: 0.1,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${c.parsed.y.toFixed(2)}%` } }
      },
      scales: {
        x: { type: 'time', time: { unit: 'year' } },
        y: { max: 5, ticks: { callback: v => v + '%' } }
      }
    }
  });
}

function drawPriceChart(A) {
  if (STATE.priceChart) STATE.priceChart.destroy();
  const step = Math.max(1, Math.floor(A.n / 600));
  const pts = [];
  for (let i = 0; i < A.n; i += step) pts.push({ x: A.dates[i], y: A.closes[i] });
  if (pts[pts.length-1].x !== A.dates[A.n-1]) pts.push({ x: A.dates[A.n-1], y: A.closes[A.n-1] });

  const ctx = document.getElementById('priceChart').getContext('2d');
  STATE.priceChart = new Chart(ctx, {
    type: 'line',
    data: { datasets: [{
      label: '주가 ($)', data: pts,
      borderColor: '#3182ce', backgroundColor: 'rgba(49,130,206,0.15)',
      fill: true, pointRadius: 0, borderWidth: 1.5, tension: 0.1,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
                 tooltip: { callbacks: { label: c => '$' + c.parsed.y.toFixed(2) } } },
      scales: {
        x: { type: 'time', time: { unit: 'year' } },
        y: { ticks: { callback: v => '$' + v } }
      }
    }
  });
}

function renderRecovery(A) {
  const body = document.getElementById('recoveryBody');
  body.innerHTML = '';
  const banner = document.getElementById('recoveryBanner');

  const currentDD = A.currentDD;
  let currentIdx = -1;
  for (let i = 0; i < A.recoveryTable.length; i++) {
    const lower = -A.recoveryTable[i].bucket;
    const upper = i + 1 < A.recoveryTable.length ? -A.recoveryTable[i+1].bucket : -Infinity;
    if (currentDD <= lower + 1e-9 && currentDD > upper + 1e-9) {
      currentIdx = i; break;
    }
  }

  if (currentDD > -5) {
    banner.classList.remove('hidden');
    banner.innerHTML = `ℹ️ 현재 하락률 <b>${fmtPct(currentDD)}</b> 는 -5% 미만의 얕은 조정입니다. 표의 어느 구간에도 해당하지 않습니다.`;
  } else {
    banner.classList.add('hidden');
  }

  A.recoveryTable.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (i === currentIdx) tr.classList.add('current');
    if (!r.everHit) tr.classList.add('never');

    const pct = r.total > 0 ? (r.hit / r.total * 100) : 0;
    const barWidth = r.everHit ? Math.min(100, r.rate) : 0;
    const barClass = r.everHit ? '' : 'zero';

    tr.innerHTML = `
      <td><b>-${r.bucket}%</b>${i === currentIdx ? ' 👈 <span style="color:#d69e2e;">지금 여기</span>' : ''}</td>
      <td>${r.hit.toLocaleString()}일</td>
      <td>${pct.toFixed(1)}%</td>
      <td><b>${r.rate.toFixed(0)}%</b>${!r.everHit ? ' <span style="color:#a0aec0; font-size:11px;">(미도달)</span>' : ''}</td>
      <td><div class="bar-container"><div class="bar-fill ${barClass}" style="width:${barWidth}%"></div></div></td>
    `;
    body.appendChild(tr);
  });
}

// TradingView 지연 로드: 버튼 클릭 시에만 로드
function renderTV(ticker) {
  // 자동 로드는 하지 않음 (lazy load 적용)
  const c = document.getElementById('tvContainer');
  c.setAttribute('data-ticker', ticker);
}

function loadTVChart() {
  const c = document.getElementById('tvContainer');
  const ticker = c.getAttribute('data-ticker') || STATE.ticker;
  if (!ticker) return;
  c.style.display = 'block';
  c.innerHTML = `<iframe style="width:100%; height:100%; border:0;"
    src="https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(ticker)}&interval=D&theme=light&style=1&locale=kr"
    loading="lazy"></iframe>`;
}

// ========== 페이지 라우팅 ==========
// 페이지별 실제 URL 매핑 (사이트가 여러 개의 실제 페이지로 분리되어 있음 — SEO/애드센스용)
const PAGE_URLS = {
  home: '/', tools: '/tools.html', rsi: '/rsi-calculator.html', dividend: '/dividend-calculator.html',
  blog: '/blog.html', about: '/about.html', contact: '/contact.html', privacy: '/privacy.html',
  disclaimer: '/disclaimer.html', terms: '/terms.html', fx: '/fx-calculator.html', roi: '/roi-calculator.html',
  compound: '/compound-calculator.html', leverage: '/leverage-etf-simulator.html', dca: '/dca-planner.html',
  sector: '/sector-rs.html', heatmap: '/heatmap.html'
};

function navigate(page) {
  // 이미 그 페이지에 있는 경우: 새로고침 대신 상단으로 스크롤 (블로그는 목록으로 리셋)
  if (typeof CURRENT_PAGE !== 'undefined' && page === CURRENT_PAGE) {
    document.getElementById('siteNav').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  window.location.href = PAGE_URLS[page] || '/';
}

function toggleNav() {
  document.getElementById('siteNav').classList.toggle('open');
}

// ========== RSI 계산기 ==========
// ---- RSI 순수 계산 함수 (Wilder's smoothing) ----
function computeRSI(prices, period) {
  const changes = [];
  for (let i = 1; i < prices.length; i++) changes.push(prices[i] - prices[i - 1]);
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  return { rsi, avgGain, avgLoss };
}

// ---- RSI 결과를 큰 숫자 + 게이지 + 쉬운 말로 렌더링 ----
function renderRSI(prices, period, tickerLabel) {
  const result = document.getElementById('rsiResult');
  if (prices.length < period + 1) {
    result.innerHTML = `<div style="background:#fed7d7; color:#742a2a; padding:12px; border-radius:8px;">❌ 최소 ${period + 1}일치 데이터가 필요한데 ${prices.length}일치만 확인됐어요.</div>`;
    return;
  }
  const { rsi, avgGain, avgLoss } = computeRSI(prices, period);
  const rsiRounded = Math.round(rsi * 100) / 100;

  let plain = '', signalColor = '', signalBg = '';
  if (rsi < 30) { plain = '🟢 최근 많이 빠졌어요 — 반등 관심 구간'; signalColor = '#22543d'; signalBg = '#c6f6d5'; }
  else if (rsi > 70) { plain = '🔴 최근 많이 올랐어요 — 단기 과열 주의'; signalColor = '#742a2a'; signalBg = '#fed7d7'; }
  else { plain = '🟡 보통 수준이에요 — 특별한 신호 없음'; signalColor = '#744210'; signalBg = '#fefcbf'; }

  const pos = Math.min(100, Math.max(0, rsi));
  const label = tickerLabel ? `<div style="font-size:13px; color:#718096; margin-bottom:6px;">📌 ${escapeHtml(tickerLabel)} · 최근 ${prices.length}일 데이터 기준</div>` : '';

  result.innerHTML = `
    ${label}
    <div style="background:${signalBg}; color:${signalColor}; padding:16px; border-radius:10px; text-align:center;">
      <div style="font-size:36px; font-weight:900; margin-bottom:4px;">${rsiRounded}</div>
      <div style="font-size:14px; font-weight:700;">${plain}</div>
    </div>
    <div style="margin-top:14px;">
      <div style="position:relative; height:14px; border-radius:7px; background:linear-gradient(90deg, #e53e3e 0%, #e53e3e 30%, #ecc94b 30%, #ecc94b 70%, #38a169 70%, #38a169 100%);">
        <div style="position:absolute; top:-5px; left:${pos}%; transform:translateX(-50%); width:3px; height:24px; background:#1a202c; border-radius:2px;"></div>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:10px; color:#a0aec0; margin-top:4px;">
        <span>0 (많이 빠짐)</span><span>50</span><span>100 (많이 오름)</span>
      </div>
    </div>
    <div class="stats-grid" style="margin-top:14px;">
      <div class="stat-box"><div class="label">사용 데이터</div><div class="value">${prices.length}일</div></div>
      <div class="stat-box"><div class="label">RSI 기간</div><div class="value">${period}일</div></div>
      <div class="stat-box"><div class="label">평균 상승폭</div><div class="value" style="color:#38a169;">+${(avgGain).toFixed(2)}</div></div>
      <div class="stat-box"><div class="label">평균 하락폭</div><div class="value" style="color:#e53e3e;">-${(avgLoss).toFixed(2)}</div></div>
    </div>
  `;
}

// ---- 티커 입력만으로 자동 조회 (기본 모드) ----
async function calcRSIByTicker() {
  const ticker = document.getElementById('rsiTicker').value.trim().toUpperCase();
  const period = parseInt(document.getElementById('rsiPeriod').value) || 14;
  const result = document.getElementById('rsiResult');
  const loading = document.getElementById('rsiLoading');

  if (!ticker) { result.innerHTML = '<div style="background:#fed7d7; color:#742a2a; padding:12px; border-radius:8px;">❌ 티커를 입력해주세요. 예: TSLA, NVDA, AAPL</div>'; return; }
  if (!isValidTickerFormat(ticker)) { result.innerHTML = '<div style="background:#fed7d7; color:#742a2a; padding:12px; border-radius:8px;">❌ 종목 형식이 올바르지 않습니다 (미국 티커 TSLA, 한국 종목코드 005930 또는 종목명 삼성전자)</div>'; return; }

  loading.style.display = 'block';
  result.innerHTML = '';
  try {
    const outputsize = Math.max(period + 30, 60);
    const { values, fromCache } = await fetchPriceSeries(ticker, outputsize);

    const closes = values.map(v => parseFloat(v.close)).reverse(); // 오래된 → 최신 순
    renderRSI(closes, period, ticker + (fromCache ? ' · 최근 조회 데이터 재사용' : ''));
  } catch (e) {
    result.innerHTML = `<div style="background:#fed7d7; color:#742a2a; padding:12px; border-radius:8px;">❌ ${escapeHtml(e.message)} — 티커 오타이거나 일시적 오류일 수 있어요.</div>`;
  } finally {
    loading.style.display = 'none';
  }
}

// ---- 고급: 종가 데이터 직접 입력 모드 ----
function calcRSIManual() {
  const period = parseInt(document.getElementById('rsiPeriod').value) || 14;
  const raw = document.getElementById('rsiPrices').value.trim();
  const prices = raw.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
  const result = document.getElementById('rsiResult');

  if (prices.length < period + 1) {
    result.innerHTML = `<div style="background:#fed7d7; color:#742a2a; padding:12px; border-radius:8px;">❌ 최소 ${period + 1}개 이상의 종가 데이터가 필요합니다. 현재 ${prices.length}개 입력됨.</div>`;
    return;
  }
  renderRSI(prices, period, null);
}

// ========== 배당 수익률 계산기 ==========
function calcDividend() {
  const price = parseFloat(document.getElementById('divPrice').value);
  const annual = parseFloat(document.getElementById('divAnnual').value);
  const growth = parseFloat(document.getElementById('divGrowth').value) || 0;
  const years = parseInt(document.getElementById('divYears').value) || 10;
  const result = document.getElementById('divResult');

  if (!price || !annual || price <= 0 || annual < 0) {
    result.innerHTML = '<div style="background:#fed7d7; color:#742a2a; padding:12px; border-radius:8px;">❌ 주가와 연간 배당금을 입력해주세요.</div>';
    return;
  }

  const yieldPct = (annual / price) * 100;
  
  // 배당 재투자 수익 계산 (DRIP)
  let totalShares = 1;
  let totalDividend = 0;
  let currentPrice = price;
  const rows = [];
  const priceGrowthRate = growth / 100; // 주가 상승률 (연%)
  const divGrowthRate = growth > 0 ? growth / 100 * 0.5 : 0; // 배당 성장률 (주가 상승률의 50%로 보수적 추정)
  for (let y = 1; y <= years; y++) {
    const divPerShare = annual * Math.pow(1 + divGrowthRate, y - 1);
    const divReceived = totalShares * divPerShare;
    totalDividend += divReceived;
    currentPrice = price * Math.pow(1 + priceGrowthRate, y);
    const newShares = currentPrice > 0 ? divReceived / currentPrice : 0;
    totalShares += newShares;
    if (y <= 5 || y === 10 || y === 20 || y === years) {
      rows.push({ y, divPerShare, divReceived: divReceived.toFixed(2), totalShares: totalShares.toFixed(4), totalDividend: totalDividend.toFixed(2) });
    }
  }

  const finalValue = totalShares * currentPrice;
  const totalReturn = ((finalValue - price) / price * 100).toFixed(1);

  let yieldColor = '#718096';
  if (yieldPct >= 4) yieldColor = '#d69e2e';
  else if (yieldPct >= 2) yieldColor = '#38a169';

  result.innerHTML = `
    <div class="stats-grid" style="margin-bottom:16px;">
      <div class="stat-box"><div class="label">배당 수익률</div><div class="value" style="color:${yieldColor};">${yieldPct.toFixed(2)}%</div></div>
      <div class="stat-box"><div class="label">분기 배당금</div><div class="value">$${(annual/4).toFixed(2)}</div></div>
      <div class="stat-box"><div class="label">${years}년 재투자 후 주수</div><div class="value">${totalShares.toFixed(2)}주</div></div>
      <div class="stat-box"><div class="label">${years}년 재투자 수익</div><div class="value" style="color:#38a169;">+${totalReturn}%</div></div>
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead><tr style="background:#edf2f7;">
          <th style="padding:8px; text-align:left;">연도</th>
          <th style="padding:8px; text-align:right;">주당 배당금</th>
          <th style="padding:8px; text-align:right;">수령 배당금</th>
          <th style="padding:8px; text-align:right;">누적 배당금</th>
          <th style="padding:8px; text-align:right;">보유 주수</th>
        </tr></thead>
        <tbody>${rows.map(r => `<tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px;">${r.y}년</td>
          <td style="padding:8px; text-align:right;">$${r.divPerShare.toFixed(2)}</td>
          <td style="padding:8px; text-align:right;">$${r.divReceived}</td>
          <td style="padding:8px; text-align:right;">$${r.totalDividend}</td>
          <td style="padding:8px; text-align:right;">${r.totalShares}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  `;
}

// ========== 문의 폼 제출 ==========
async function submitContact() {
  const name = document.getElementById('contactName').value.trim();
  const email = document.getElementById('contactEmail').value.trim();
  const subject = document.getElementById('contactSubject').value.trim();
  const message = document.getElementById('contactMessage').value.trim();
  const result = document.getElementById('contactResult');

  if (!name || !email || !subject || !message) {
    result.innerHTML = '<span style="color:#e53e3e;">❌ 모든 항목을 입력해주세요.</span>';
    return;
  }
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    result.innerHTML = '<span style="color:#e53e3e;">❌ 올바른 이메일 주소를 입력해주세요.</span>';
    return;
  }

  result.innerHTML = '<span style="color:#4299e1;">⏳ 전송 중...</span>';
  
  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, subject, message })
    });
    const data = await response.json();
    
    if (response.ok && data.success) {
      result.innerHTML = '<span style="color:#38a169;">✅ 문의가 접수되었습니다. 빠른 시일 내 답변 드리겠습니다.</span>';
      document.getElementById('contactName').value = '';
      document.getElementById('contactEmail').value = '';
      document.getElementById('contactSubject').value = '';
      document.getElementById('contactMessage').value = '';
    } else {
      result.innerHTML = `<span style="color:#e53e3e;">❌ ${escapeHtml(data.error) || '전송 실패. 다시 시도해주세요.'}</span>`;
    }
  } catch (err) {
    result.innerHTML = '<span style="color:#e53e3e;">❌ 네트워크 오류가 발생했습니다. 다시 시도해주세요.</span>';
  }
}

// ========== 환율 계산기 ==========
let KRW_RATE = 1380;

function updateFxRate() {
  const newRate = parseFloat(document.getElementById('fxRate').value);
  if (!isNaN(newRate) && newRate > 0) {
    KRW_RATE = newRate;
    document.getElementById('displayRate').textContent = `$1 = ₩${KRW_RATE.toLocaleString()}`;
    calcFxFromUsd();
    calcFxFromKrw();
  }
}

function calcFxFromUsd() {
  const usd = parseFloat(document.getElementById('fxUsd').value);
  const result = document.getElementById('fxResult');
  if (isNaN(usd) || usd <= 0) { result.innerHTML = ''; return; }
  const krw = usd * KRW_RATE;
  result.innerHTML = `
    <div class="stats-grid">
      <div class="stat-box"><div class="label">환산 원화</div><div class="value" style="color:#2b6cb0;">₩${krw.toLocaleString('ko-KR', {maximumFractionDigits:0})}</div></div>
      <div class="stat-box"><div class="label">적용 환율</div><div class="value">$1 = ₩${KRW_RATE.toLocaleString()}</div></div>
    </div>`;
}

function calcFxFromKrw() {
  const krw = parseFloat(String(document.getElementById('fxKrw').value).replace(/,/g, ''));
  const result = document.getElementById('fxResult');
  if (isNaN(krw) || krw <= 0) { result.innerHTML = ''; return; }
  const usd = krw / KRW_RATE;
  result.innerHTML = `
    <div class="stats-grid">
      <div class="stat-box"><div class="label">환산 달러</div><div class="value" style="color:#2b6cb0;">$${usd.toFixed(2)}</div></div>
      <div class="stat-box"><div class="label">적용 환율</div><div class="value">$1 = ₩${KRW_RATE.toLocaleString()}</div></div>
    </div>`;
}

// ========== 수익률 계산기 ==========
function calcROI() {
  const buy = parseFloat(document.getElementById('roiBuy').value);
  const sell = parseFloat(document.getElementById('roiSell').value);
  const shares = parseFloat(document.getElementById('roiShares').value) || 1;
  const result = document.getElementById('roiResult');
  if (isNaN(buy) || isNaN(sell) || buy <= 0) { result.innerHTML = ''; return; }
  const pnl = (sell - buy) * shares;
  const pct = ((sell - buy) / buy) * 100;
  const pnlKrw = pnl * KRW_RATE;
  const isProfit = pnl >= 0;
  const color = isProfit ? '#38a169' : '#e53e3e';
  const sign = isProfit ? '+' : '';
  result.innerHTML = `
    <div class="stats-grid">
      <div class="stat-box"><div class="label">수익률</div><div class="value" style="color:${color};">${sign}${pct.toFixed(2)}%</div></div>
      <div class="stat-box"><div class="label">수익금 (USD)</div><div class="value" style="color:${color};">${sign}$${pnl.toFixed(2)}</div></div>
      <div class="stat-box"><div class="label">원화 환산</div><div class="value" style="color:${color};">${sign}₩${Math.round(pnlKrw).toLocaleString()}</div></div>
      <div class="stat-box"><div class="label">보유 수량</div><div class="value">${shares}주</div></div>
    </div>
    <div style="background:${isProfit?'#c6f6d5':'#fed7d7'}; color:${isProfit?'#22543d':'#742a2a'}; padding:12px 16px; border-radius:8px; margin-top:12px; font-size:14px;">
      ${isProfit ? '🚀' : '📉'} 매수가 $${buy.toFixed(2)} → 매도가 $${sell.toFixed(2)} — <strong>${sign}${pct.toFixed(2)}% (${sign}$${pnl.toFixed(2)})</strong>
    </div>`;
}

// ========== 복리 계산기 ==========
function calcCompound() {
  const resultEl = document.getElementById('cpResult');
  if (!resultEl) return;

  const init = parseFloat(document.getElementById('cpInit').value) || 0;
  const monthly = parseFloat(document.getElementById('cpMonthly').value) || 0;
  const annualRate = parseFloat(document.getElementById('cpRate').value);
  const years = parseInt(document.getElementById('cpYears').value);

  if (isNaN(annualRate) || !years || years <= 0 || (init <= 0 && monthly <= 0)) {
    resultEl.innerHTML = '<div style="background:#fed7d7; color:#742a2a; padding:12px; border-radius:8px;">❌ 투자금(또는 월 납입액), 연 수익률, 투자 기간을 입력해주세요.</div>';
    return;
  }

  const monthlyRate = annualRate / 100 / 12;
  const totalMonths = years * 12;
  const fmt = n => Math.round(n).toLocaleString('ko-KR');

  let balance = init;
  let totalContrib = init;
  const yearRows = [];
  for (let m = 1; m <= totalMonths; m++) {
    balance = balance * (1 + monthlyRate) + monthly;
    totalContrib += monthly;
    if (m % 12 === 0) {
      yearRows.push({ year: m / 12, balance, totalContrib });
    }
  }

  const finalBalance = balance;
  const totalProfit = finalBalance - totalContrib;
  const profitPct = totalContrib > 0 ? (totalProfit / totalContrib) * 100 : 0;
  const isProfit = totalProfit >= 0;

  // 표는 연도가 많으면(10년 이상) 일부만 보여주고 마지막 해는 항상 포함
  let visibleRows = yearRows;
  if (yearRows.length > 12) {
    const step = Math.ceil(yearRows.length / 10);
    visibleRows = yearRows.filter((r, i) => i % step === 0 || i === yearRows.length - 1);
  }

  const tableRows = visibleRows.map(r => {
    const rowProfit = r.balance - r.totalContrib;
    const rowColor = rowProfit >= 0 ? '#38a169' : '#e53e3e';
    return `<tr>
      <td>${r.year}년차</td>
      <td>${fmt(r.totalContrib)}원</td>
      <td style="font-weight:700;">${fmt(r.balance)}원</td>
      <td style="color:${rowColor};">${rowProfit >= 0 ? '+' : ''}${fmt(rowProfit)}원</td>
    </tr>`;
  }).join('');

  resultEl.innerHTML = `
    <div style="background:${isProfit ? '#c6f6d5' : '#fed7d7'}; color:${isProfit ? '#22543d' : '#742a2a'}; padding:16px; border-radius:10px; text-align:center; margin-bottom:12px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">${years}년 후 예상 평가금액</div>
      <div style="font-size:32px; font-weight:900;">${fmt(finalBalance)}원</div>
    </div>
    <div class="stats-grid" style="margin-bottom:16px;">
      <div class="stat-box"><div class="label">총 납입 원금</div><div class="value">${fmt(totalContrib)}원</div></div>
      <div class="stat-box"><div class="label">투자 수익</div><div class="value" style="color:${isProfit ? '#38a169' : '#e53e3e'};">${isProfit ? '+' : ''}${fmt(totalProfit)}원</div></div>
      <div class="stat-box"><div class="label">수익률</div><div class="value" style="color:${isProfit ? '#38a169' : '#e53e3e'};">${isProfit ? '+' : ''}${profitPct.toFixed(1)}%</div></div>
    </div>
    <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>경과</th><th>납입 원금 누적</th><th>평가 금액</th><th>수익</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}


const ETF_INFO = {
  QQQ:  { mult: 1, fee: 0.0020, name: 'QQQ (1x)',  riskLabel: '낮음' },
  QLD:  { mult: 2, fee: 0.0095, name: 'QLD (2x)',  riskLabel: '높음' },
  TQQQ: { mult: 3, fee: 0.0098, name: 'TQQQ (3x)', riskLabel: '매우 높음' },
};
const SCENARIOS = {
  bull:  { annualReturn: 0.20, annualVol: 0.15, label: '강세' },
  base:  { annualReturn: 0.12, annualVol: 0.20, label: '기본' },
  bear:  { annualReturn: 0.04, annualVol: 0.28, label: '약세' },
  crash: { annualReturn: -0.30, annualVol: 0.45, label: '폭락' },
};

function runLevSim(init, years, annRet, annVol, mult, annFee, trials = 200) {
  const days = years * 252;
  const dr = annRet / 252, dv = annVol / Math.sqrt(252), df = annFee / 252;
  const finals = [];
  for (let t = 0; t < trials; t++) {
    let v = init;
    for (let d = 0; d < days; d++) {
      const u1 = Math.random(), u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
      const dailyRet = dr + dv * z;
      const levRet = mult * dailyRet - (mult * mult - mult) * dv * dv / 2 - df;
      v = Math.max(v * (1 + levRet), 0);
    }
    finals.push(v);
  }
  finals.sort((a, b) => a - b);
  return {
    median: finals[Math.floor(trials * 0.5)],
    p25: finals[Math.floor(trials * 0.25)],
    p75: finals[Math.floor(trials * 0.75)],
    p10: finals[Math.floor(trials * 0.1)],
  };
}

function runLeverageSim() {
  const etfKey = document.getElementById('levEtf').value;
  const scenario = document.getElementById('levScenario').value;
  const init = parseFloat(document.getElementById('levInvestment').value) || 10000;
  const years = parseInt(document.getElementById('levYears').value) || 5;
  const sc = SCENARIOS[scenario];
  const result = document.getElementById('leverageResult');
  result.innerHTML = '<div style="color:#4299e1; padding:12px;">⏳ 시뮬레이션 실행 중... (200회 시뮬레이션)</div>';
  setTimeout(() => {
    const etfs = etfKey === 'COMPARE' ? ['QQQ','QLD','TQQQ'] : [etfKey];
    const rows = etfs.map(key => {
      const info = ETF_INFO[key];
      const sim = runLevSim(init, years, sc.annualReturn, sc.annualVol, info.mult, info.fee);
      const medRoi = ((sim.median - init) / init * 100).toFixed(1);
      const medColor = sim.median >= init ? '#38a169' : '#e53e3e';
      return `<tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:10px 12px; font-weight:700;">${info.name}</td>
        <td style="padding:10px 12px; text-align:right; color:${medColor}; font-weight:700;">$${Math.round(sim.median).toLocaleString()}</td>
        <td style="padding:10px 12px; text-align:right; color:${medColor};">${medRoi >= 0 ? '+' : ''}${medRoi}%</td>
        <td style="padding:10px 12px; text-align:right; color:#718096;">$${Math.round(sim.p25).toLocaleString()}</td>
        <td style="padding:10px 12px; text-align:right; color:#718096;">$${Math.round(sim.p75).toLocaleString()}</td>
        <td style="padding:10px 12px; text-align:center;">${info.riskLabel}</td>
      </tr>`;
    }).join('');
    result.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead><tr style="background:#edf2f7;">
            <th style="padding:10px 12px; text-align:left;">ETF</th>
            <th style="padding:10px 12px; text-align:right;">중간값 (예상)</th>
            <th style="padding:10px 12px; text-align:right;">수익률</th>
            <th style="padding:10px 12px; text-align:right;">25백분위</th>
            <th style="padding:10px 12px; text-align:right;">75백분위</th>
            <th style="padding:10px 12px; text-align:center;">리스크</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="background:#fffbeb; border:1px solid #f6e05e; padding:12px 16px; border-radius:8px; margin-top:12px; font-size:13px; color:#744210;">
        📊 시나리오: <strong>${sc.label}</strong> | 초기 투자: <strong>$${init.toLocaleString()}</strong> | 기간: <strong>${years}년</strong> | 200회 몬테카를로 시뮬레이션 결과입니다. 실제 수익률을 보장하지 않습니다.
      </div>`;
  }, 50);
}

// ========== 분할매수 계획 ==========
function calcDCA() {
  const budget = parseFloat(document.getElementById('dcaBudget').value) || 10000;
  const price = parseFloat(document.getElementById('dcaPrice').value) || 200;
  const rounds = parseInt(document.getElementById('dcaRounds').value) || 5;
  const strategy = document.getElementById('dcaStrategy').value;
  const targetAvgInput = parseFloat(document.getElementById('dcaTargetAvg').value);
  const targetAvg = isNaN(targetAvgInput) ? price * 0.95 : targetAvgInput;
  const result = document.getElementById('dcaResult');

  const weights = Array.from({ length: rounds }, (_, i) => {
    if (strategy === 'equal') return 1;
    if (strategy === 'staircase') return rounds - i;
    if (strategy === 'backloaded') return i + 1;
    return 1;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const priceProgression = Array.from({ length: rounds }, (_, i) => {
    const t = i / Math.max(rounds - 1, 1);
    const drift = -0.10 * Math.sin(Math.PI * t);
    return Math.max(price * (1 + drift + (Math.random() - 0.5) * 0.02), 1);
  });

  let cumShares = 0, cumCost = 0;
  const plan = Array.from({ length: rounds }, (_, i) => {
    const amount = (weights[i] / totalWeight) * budget;
    const p = priceProgression[i];
    const shares = amount / p;
    cumShares += shares;
    cumCost += amount;
    const date = new Date();
    date.setDate(date.getDate() + i * 14);
    return {
      round: i + 1,
      date: date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
      price: p, amount, shares, cumShares,
      cumAvgPrice: cumCost / cumShares,
    };
  });

  const last = plan[plan.length - 1];
  const achievable = last.cumAvgPrice <= targetAvg * 1.02;
  const strategyLabel = { equal: '균등 분할', staircase: '계단식', backloaded: '후반 집중' }[strategy];

  result.innerHTML = `
    <div class="stats-grid" style="margin-bottom:16px;">
      <div class="stat-box"><div class="label">전략</div><div class="value">${strategyLabel}</div></div>
      <div class="stat-box"><div class="label">총 매수 주수</div><div class="value">${last.cumShares.toFixed(3)}주</div></div>
      <div class="stat-box"><div class="label">예상 평균단가</div><div class="value" style="color:${achievable?'#38a169':'#e53e3e'};">$${last.cumAvgPrice.toFixed(2)}</div></div>
      <div class="stat-box"><div class="label">목표 평균단가</div><div class="value">$${targetAvg.toFixed(2)}</div></div>
    </div>
    <div style="background:${achievable?'#c6f6d5':'#fed7d7'}; color:${achievable?'#22543d':'#742a2a'}; padding:12px 16px; border-radius:8px; margin-bottom:16px; font-size:14px;">
      ${achievable ? '✅ 목표 평균단가 달성 가능!' : '⚠️ 목표 평균단가 달성 어려움. 매수 회수를 늘리거나 예산을 늘려보세요.'}
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead><tr style="background:#edf2f7;">
          <th style="padding:8px; text-align:center;">회차</th>
          <th style="padding:8px; text-align:center;">날짜</th>
          <th style="padding:8px; text-align:right;">예상가</th>
          <th style="padding:8px; text-align:right;">투자금액</th>
          <th style="padding:8px; text-align:right;">매수 주수</th>
          <th style="padding:8px; text-align:right;">누적 평균단가</th>
        </tr></thead>
        <tbody>${plan.map(r => `<tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px; text-align:center;">${r.round}회</td>
          <td style="padding:8px; text-align:center;">${r.date}</td>
          <td style="padding:8px; text-align:right;">$${r.price.toFixed(2)}</td>
          <td style="padding:8px; text-align:right;">$${r.amount.toFixed(0)}</td>
          <td style="padding:8px; text-align:right;">${r.shares.toFixed(3)}</td>
          <td style="padding:8px; text-align:right;">$${r.cumAvgPrice.toFixed(2)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <p style="font-size:11px; color:#a0aec0; margin-top:8px;">⚠️ 예상 주가는 V자형 시나리오 기반으로 시뮬레이션된 값입니다. 실제 주가는 다를 수 있습니다.</p>`;
}

// 페이지 로드 시 복리 계산기 초기화
document.addEventListener('DOMContentLoaded', () => {
  calcCompound();
});


// ========== 섹터 상대강도(RS) ==========
// sector-rs.html 전용입니다. 다른 페이지에서는 아래 초기화가 그냥 지나갑니다.
//
// 데이터는 data/sectors.json 하나뿐입니다. 시장·기간을 바꿔도 다시 받지 않습니다
// (계산은 scripts/generate-sector-rs.js 가 빌드 시점에 이미 끝내 둡니다).
//
// 용어 주의: 이 파일 위쪽의 computeRSI 는 RSI(한 종목의 과열도)이고, 여기 RS 는
// "벤치마크 대비 강도"입니다. 이름만 비슷하고 다른 지표입니다.

const RS = {
  data: null,
  market: null,
  period: '3m',
  sortKey: 'rating',
  sortDir: -1,   // -1 내림차순
  openKey: null,
  chart: null,
};

// scripts/sectors.js 의 PERIODS 와 키가 같아야 합니다. 이 목록에만 있고 데이터에 없는
// 키를 고르면 표 전체가 — 로 나옵니다. (거기 주석에 하루 기준의 정의를 적어 두었습니다)
const RS_PERIODS = [
  { key: '1d',  label: '1일',    days: 1 },
  { key: '1w',  label: '1주',    days: 5 },
  { key: '1m',  label: '1개월',  days: 20 },
  { key: '3m',  label: '3개월',  days: 60 },
  { key: '6m',  label: '6개월',  days: 120 },
  { key: '12m', label: '12개월', days: 250 },
];

// 차트에 그릴 최소 점 개수. 1일을 고르면 창이 2점짜리가 되는데, 점 두 개는 흐름이
// 아니라 그냥 선분입니다.
//
// 값을 6 으로 둔 것은 1주(5거래일 = 6점)를 건드리지 않기 위해서입니다.
// "1주를 골랐는데 차트는 1주가 아니다"가 애초에 고치려던 문제라, 늘리는 것은
// 그림이 아예 성립하지 않는 1일에만 적용돼야 합니다.
const RS_CHART_MIN_ROWS = 6;

// krOnly 열은 외국인 소진율이 있는 시장(한국)에서만 그립니다.
const RS_COLS = [
  { key: 'name', label: '섹터', align: 'left' },
  { key: 'rating', label: 'RS 점수', hint: '1~99, 높을수록 강함' },
  { key: 'ret', label: '수익률' },
  { key: 'alpha', label: '벤치마크 대비' },
  // 하루짜리는 전 거래일과 견줍니다(generate-sector-rs.js 의 lag). 열 제목이 그대로
  // "1개월 전 대비"면 화면이 계산과 다른 말을 하게 됩니다.
  { key: 'rankChg', label: '순위 변화', hint: () => RS.period === '1d' ? '전 거래일 대비' : '1개월 전 대비' },
  { key: 'turnShare', label: '거래대금 비중', needs: 'hasTurnover' },
  // 1일에서는 변화폭이 비어 있습니다(소진율은 결제일 뒤 확정 — generate-sector-rs.js 참고).
  // 왜 — 인지 화면에 적어 두지 않으면 데이터가 깨진 것처럼 보입니다.
  { key: 'foreignChg', label: '외국인 소진율', needs: 'hasForeign',
    hint: () => RS.period === '1d' ? '변화폭은 하루 뒤 확정' : null },
];

const rsEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rsUp = '#38a169', rsDown = '#e53e3e', rsFlat = '#a0aec0';

// null 과 0 은 다릅니다. 데이터가 없으면 0% 라고 우기지 말고 — 로 둡니다.
function rsNum(v, digits, unit) {
  if (v == null) return '<span style="color:#cbd5e0;">—</span>';
  const sign = v > 0 ? '+' : '';
  const color = v > 0 ? rsUp : (v < 0 ? rsDown : rsFlat);
  return `<span style="color:${color}; font-weight:600;">${sign}${v.toFixed(digits)}${unit}</span>`;
}

function rsPlain(v, digits, unit) {
  if (v == null) return '<span style="color:#cbd5e0;">—</span>';
  return `${v.toFixed(digits)}${unit}`;
}

function rsRankChg(v) {
  if (v == null) return '<span style="color:#cbd5e0;">—</span>';
  if (v === 0) return `<span style="color:${rsFlat};">— 0</span>`;
  const arrow = v > 0 ? '▲' : '▼';
  return `<span style="color:${v > 0 ? rsUp : rsDown}; font-weight:600;">${arrow} ${Math.abs(v)}</span>`;
}

function rsMarketData() { return RS.data.markets[RS.market]; }
function rsPeriodLabel() { return (RS_PERIODS.find(p => p.key === RS.period) || {}).label || RS.period; }
function rsRankBasis() { return RS.period === '1d' ? '전 거래일 대비' : '1개월 전 대비'; }
function rsPeriodDays() { return (RS_PERIODS.find(p => p.key === RS.period) || {}).days || 60; }

// 은/는, 이/가 같은 조사는 앞 글자의 받침에 따라 갈립니다. 기간 이름이 "1일"(받침 O)
// 이거나 "1주"(받침 X)라서 한쪽으로 고정하면 문장이 어색해집니다.
// 한글이 아닌 글자(숫자·영문)로 끝나면 안전한 쪽을 씁니다.
function rsJosa(word, withBatchim, without) {
  const ch = word.charCodeAt(word.length - 1);
  if (ch < 0xac00 || ch > 0xd7a3) return withBatchim;
  return (ch - 0xac00) % 28 === 0 ? without : withBatchim;
}

// 이 화면은 실시간이 아닙니다. 매 거래일 장 마감 뒤에 한 번 계산해 파일로 저장하고,
// 브라우저는 그 파일을 읽습니다. 그래서 "지금 새로고침했으니 지금 시세"가 아니라
// "마지막으로 마감된 거래일의 종가"입니다. 며칠 지난 데이터를 최신인 줄 알고 보는
// 일이 없도록, 기준일이 오래됐으면 그 사실을 눈에 띄게 적습니다.
function rsStaleNote(updated) {
  const base = `장 마감 뒤 갱신되는 종가 데이터입니다. 장중 실시간 시세가 아닙니다.`;
  const t = Date.parse(updated + 'T00:00:00Z');
  if (!Number.isFinite(t)) return base;
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 4) return base;
  return `⚠️ 기준일이 ${days}일 전입니다. 데이터 갱신이 밀렸을 수 있습니다. ${base}`;
}

// 차트에 실제로 그릴 구간. 고른 기간만큼 잘라 내되(사용자가 1주를 골랐으면 1주가
// 보여야 합니다) 데이터가 모자라면 있는 만큼, 너무 짧으면 최소치까지 늘립니다.
// 반환은 [시작 인덱스, 행 수].
function rsChartWindow(len) {
  const rows = Math.min(len, Math.max(rsPeriodDays() + 1, RS_CHART_MIN_ROWS));
  return [len - rows, rows];
}

async function initSectorPage() {
  const loading = document.getElementById('rsLoading');
  const errBox = document.getElementById('rsError');
  try {
    // cache: 'no-cache' — 브라우저 캐시에 있어도 서버에 "바뀌었나"를 반드시 물어봅니다.
    // 안 바뀌었으면 304 라 내려받는 양은 그대로이고, 바뀌었으면 즉시 새 파일을 받습니다.
    // 이게 없으면 갱신된 뒤에도 한동안 어제 숫자를 보고 있을 수 있습니다.
    const res = await fetch('/data/sectors.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    RS.data = await res.json();
  } catch (e) {
    loading.classList.remove('show');
    errBox.style.display = 'block';
    errBox.className = 'status error show';
    errBox.textContent = '섹터 데이터를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.';
    return;
  }

  const keys = Object.keys(RS.data.markets || {});
  if (keys.length === 0) {
    loading.classList.remove('show');
    errBox.style.display = 'block';
    errBox.className = 'status error show';
    errBox.textContent = '표시할 시장이 없습니다.';
    return;
  }
  RS.market = keys.includes('KR') ? 'KR' : keys[0];

  loading.classList.remove('show');
  document.getElementById('rsBody').classList.remove('hidden');
  renderSectorControls();
  renderSectorAll();
}

// 시장 탭은 데이터에 실제로 들어 있는 시장만 그립니다. 수집이 실패해 한쪽이 비어도
// 없는 탭을 눌러 빈 화면을 보는 일이 없게 합니다.
function renderSectorControls() {
  const flags = { KR: '🇰🇷', US: '🇺🇸' };
  document.getElementById('rsMarketToggle').innerHTML = Object.keys(RS.data.markets)
    .map(k => `<button type="button" class="${k === RS.market ? 'active' : ''}" onclick="setSectorMarket('${k}')">${flags[k] || ''} ${rsEsc(RS.data.markets[k].label)}</button>`)
    .join('');

  document.getElementById('rsPeriodBtns').innerHTML = RS_PERIODS
    .map(p => `<button type="button" class="preset-btn ${p.key === RS.period ? 'active' : ''}" onclick="setSectorPeriod('${p.key}')">${p.label}</button>`)
    .join('');
}

function setSectorMarket(key) {
  if (RS.market === key) return;
  RS.market = key;
  RS.openKey = null;
  renderSectorControls();
  renderSectorAll();
}

function setSectorPeriod(key) {
  RS.period = key;
  renderSectorControls();
  renderSectorAll();
}

function renderSectorAll() {
  const m = rsMarketData();
  const benchRet = m.benchmark.ret[RS.period];

  document.getElementById('rsMeta').innerHTML =
    `기준일 <b>${rsEsc(m.updated)}</b> 종가 · 벤치마크 <b>${rsEsc(m.benchmark.name)}</b> ` +
    `${rsPeriodLabel()} ${benchRet == null ? '—' : (benchRet > 0 ? '+' : '') + benchRet.toFixed(1) + '%'} · ` +
    `수록 ${m.universeCount}종목 / ${m.sectors.length}섹터` +
    // 기준일이 오늘이 아닐 수 있다는 것을 화면에서 바로 알 수 있어야 합니다.
    // "조회할 때마다 실시간"으로 오해하면 이 숫자로 장중 판단을 하게 됩니다.
    `<br><span style="color:#a0aec0;">${rsStaleNote(m.updated)}</span>`;
  document.getElementById('rsSummaryPeriod').textContent = rsPeriodLabel();

  renderSectorSummary();
  renderSectorTable();
  renderSectorDetail();
}

function renderSectorSummary() {
  const m = rsMarketData();
  const rows = m.sectors.filter(s => s.periods[RS.period].rating != null);
  const box = document.getElementById('rsSummary');
  if (rows.length === 0) { box.innerHTML = '<div class="stat-box"><div class="value">데이터 부족</div></div>'; return; }

  const byRating = [...rows].sort((a, b) => b.periods[RS.period].rating - a.periods[RS.period].rating);
  const strongest = byRating[0];
  const weakest = byRating[byRating.length - 1];

  const flows = rows.filter(s => s.periods[RS.period].turnShareChg != null)
    .sort((a, b) => b.periods[RS.period].turnShareChg - a.periods[RS.period].turnShareChg);
  const inflow = flows[0];

  const tile = (label, name, value, note) =>
    `<div class="stat-box"><div class="label">${label}</div>` +
    `<div class="value" style="font-size:16px;">${name}</div>` +
    `<div style="font-size:13px; margin-top:4px;">${value}</div>` +
    `<div style="font-size:11px; color:#718096; margin-top:2px;">${note}</div></div>`;

  const html = [
    tile('가장 강한 섹터', rsEsc(strongest.name),
      rsNum(strongest.periods[RS.period].alpha, 1, '%p'), '벤치마크 대비'),
    tile('가장 약한 섹터', rsEsc(weakest.name),
      rsNum(weakest.periods[RS.period].alpha, 1, '%p'), '벤치마크 대비'),
  ];
  if (m.hasTurnover && inflow) {
    html.push(tile('수급이 몰린 섹터', rsEsc(inflow.name),
      rsNum(inflow.periods[RS.period].turnShareChg, 2, '%p'), '거래대금 비중 변화'));
  } else if (m.hasTurnover) {
    html.push(tile('수급이 몰린 섹터', '—', '<span style="color:#cbd5e0;">거래대금 데이터 준비 중</span>', ''));
  } else {
    // 거래대금을 비교할 수 없는 시장에서는 대신 "가장 빠르게 올라오는 섹터"를 보여줍니다.
    // 자리를 비워 두는 것보다, 같은 질문(어디로 가고 있나)에 답하는 다른 숫자가 낫습니다.
    const rising = rows.filter(s => s.periods[RS.period].rankChg != null)
      .sort((a, b) => b.periods[RS.period].rankChg - a.periods[RS.period].rankChg)[0];
    html.push(rising
      ? tile('순위가 가장 오른 섹터', rsEsc(rising.name), rsRankChg(rising.periods[RS.period].rankChg), rsRankBasis())
      : tile('순위가 가장 오른 섹터', '—', '', ''));
  }
  box.innerHTML = html.join('');
}

function renderSectorTable() {
  const m = rsMarketData();
  const cols = RS_COLS.filter(c => !c.needs || m[c.needs]);

  document.getElementById('rsHead').innerHTML = cols.map(c => {
    const active = RS.sortKey === c.key ? (RS.sortDir === -1 ? ' ▼' : ' ▲') : '';
    const hint = typeof c.hint === 'function' ? c.hint() : c.hint;
    return `<th style="cursor:pointer; text-align:${c.align || 'center'}; white-space:nowrap;" onclick="sortSectorTable('${c.key}')">` +
      `${c.label}${active}` +
      (hint ? `<div style="font-weight:400; color:#a0aec0; font-size:10px;">${hint}</div>` : '') +
      `</th>`;
  }).join('');

  const rows = [...m.sectors].sort((a, b) => {
    if (RS.sortKey === 'name') return a.name.localeCompare(b.name) * -RS.sortDir;
    const av = a.periods[RS.period][RS.sortKey];
    const bv = b.periods[RS.period][RS.sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;   // 값 없는 행은 정렬 방향과 무관하게 아래로
    if (bv == null) return -1;
    return (av - bv) * RS.sortDir;
  });

  document.getElementById('rsRows').innerHTML = rows.map(s => {
    const p = s.periods[RS.period];
    const open = RS.openKey === s.key;
    const cells = cols.map(c => {
      if (c.key === 'name') {
        return `<td style="text-align:left; white-space:nowrap;"><b>${rsEsc(s.name)}</b> <span style="color:#a0aec0;">${open ? '▲' : '▼'}</span></td>`;
      }
      if (c.key === 'rating') {
        const v = p.rating;
        if (v == null) return '<td><span style="color:#cbd5e0;">—</span></td>';
        // 막대는 표를 훑을 때 눈이 먼저 잡는 부분입니다. 강한 쪽 파랑, 약한 쪽 회색.
        const fill = v >= 50 ? '' : ' zero';
        return `<td><div style="display:flex; align-items:center; gap:8px; min-width:120px;">` +
          `<b style="width:26px; text-align:right;">${v}</b>` +
          `<div class="bar-container" style="flex:1;"><div class="bar-fill${fill}" style="width:${v}%;"></div></div></div></td>`;
      }
      if (c.key === 'ret') return `<td>${rsNum(p.ret, 1, '%')}</td>`;
      if (c.key === 'alpha') return `<td>${rsNum(p.alpha, 1, '%p')}</td>`;
      if (c.key === 'rankChg') return `<td>${rsRankChg(p.rankChg)}</td>`;
      if (c.key === 'turnShare') {
        return `<td style="white-space:nowrap;">${rsPlain(p.turnShare, 1, '%')}<br>` +
          `<span style="font-size:11px;">${rsNum(p.turnShareChg, 2, '%p')}</span></td>`;
      }
      if (c.key === 'foreignChg') {
        return `<td style="white-space:nowrap;">${rsPlain(p.foreign, 1, '%')}<br>` +
          `<span style="font-size:11px;">${rsNum(p.foreignChg, 2, '%p')}</span></td>`;
      }
      return '<td></td>';
    }).join('');
    return `<tr style="cursor:pointer;${open ? ' background:#ebf8ff;' : ''}" onclick="toggleSectorDetail('${s.key}')">${cells}</tr>`;
  }).join('');
}

function sortSectorTable(key) {
  if (RS.sortKey === key) RS.sortDir = -RS.sortDir;
  else { RS.sortKey = key; RS.sortDir = key === 'name' ? 1 : -1; }
  renderSectorTable();
}

function toggleSectorDetail(key) {
  RS.openKey = RS.openKey === key ? null : key;
  renderSectorTable();
  renderSectorDetail();
  if (RS.openKey) document.getElementById('rsDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderSectorDetail() {
  const card = document.getElementById('rsDetail');
  if (!RS.openKey) { card.classList.add('hidden'); return; }

  const m = rsMarketData();
  const s = m.sectors.find(x => x.key === RS.openKey);
  if (!s) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  document.getElementById('rsDetailTitle').textContent = `📈 ${s.name} — ${m.benchmark.name} 대비 RS`;

  const members = [...s.members].sort((a, b) => {
    const av = a.ret[RS.period], bv = b.ret[RS.period];
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });
  document.getElementById('rsMembers').innerHTML =
    `<h3 style="font-size:14px; color:#4a5568; margin-bottom:8px;">구성 종목 ${rsPeriodLabel()} 수익률</h3>` +
    `<div style="display:flex; flex-wrap:wrap; gap:8px;">` +
    members.map(mem => {
      const v = mem.ret[RS.period];
      const color = v == null ? rsFlat : (v > 0 ? rsUp : rsDown);
      return `<span class="fav-chip" style="cursor:default;">${rsEsc(mem.name)} ` +
        `<b style="color:${color};">${v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'}</b></span>`;
    }).join('') + '</div>';

  drawSectorChart(s, m);
}

// 차트 위 설명줄. 그린 구간이 기간 버튼에 따라 달라지므로 글도 같이 달라져야 합니다.
// 고정 문구로 두면 1주를 눌러도 "1년 전 = 100" 이라고 적혀 있어, 화면이 스스로 거짓말을
// 하게 됩니다. 실제로 그 상태였습니다.
function renderSectorChartNote(m, rows, firstDate) {
  const el = document.getElementById('rsChartNote');
  if (!el) return;
  const days = rsPeriodDays();
  const shown = rows - 1;
  // 고른 기간보다 길게 그린 경우(1일)를 숨기지 않고 그대로 밝힙니다.
  const label = rsPeriodLabel();
  // 휴대폰에서는 이 줄이 차트만큼 자리를 먹습니다. 한 줄에 사실만, 설명은 그 아래 한 줄.
  const stretched = shown > days
    ? ` <span style="color:#a0aec0;">(${label}${rsJosa(label, '은', '는')} ${days}거래일뿐이라 늘렸습니다)</span>`
    : '';
  el.innerHTML =
    `<b>섹터지수 ÷ ${rsEsc(m.benchmark.name)}</b> · 최근 <b>${shown}거래일</b>(${rsEsc(firstDate)}부터) · 첫날 = 100${stretched}<br>` +
    `선이 100 위로 가면 이 구간에서 ${rsEsc(m.benchmark.name)}보다 강했다는 뜻입니다.`;
}

// 광고 차단기가 CDN 을 막으면 Chart 가 없습니다. 그때도 표와 숫자는 멀쩡해야 하므로
// 캔버스만 안내 문구로 바꾸고 나머지는 그대로 둡니다. (홈 화면과 같은 처리)
function sectorChartUnavailable(msg) {
  const wrap = document.getElementById('rsChartWrap');
  if (!wrap) return;
  // 그리지 못했으면 설명줄도 그린 것처럼 말하면 안 됩니다.
  const note = document.getElementById('rsChartNote');
  if (note) note.innerHTML = 'RS 선은 <b>섹터지수 ÷ 벤치마크</b>이며, 고른 기간의 첫날을 100 으로 맞춰 그립니다.';
  wrap.innerHTML = `<div style="height:100%; display:flex; align-items:center; justify-content:center; ` +
    `background:#f7fafc; border-radius:10px; color:#718096; font-size:13px; text-align:center; padding:16px;">` +
    `${msg}<br><span style="font-size:12px; color:#a0aec0;">아래 표와 숫자는 정상입니다.</span></div>`;
}

function drawSectorChart(s, m) {
  const wrap = document.getElementById('rsChartWrap');
  if (typeof Chart === 'undefined') {
    sectorChartUnavailable('차트를 불러오지 못했습니다. (광고 차단 확장 프로그램이 원인일 수 있습니다)');
    return;
  }
  // 이전에 안내 문구로 바꿔 놓았다면 캔버스를 되살립니다.
  if (!document.getElementById('rsChart')) wrap.innerHTML = '<canvas id="rsChart"></canvas>';

  try {
    if (RS.chart) RS.chart.destroy();

    // 고른 기간만큼만 그립니다. 저장된 RS 선은 1년치 한 벌뿐이라, 잘라 낸 다음
    // 창 첫날 = 100 으로 다시 맞춥니다. 그래야 기준선(100)이 "이 기간 시작점"이 되고
    // 선이 위에 있으면 그 기간 동안 벤치마크를 이겼다는 뜻이 됩니다.
    // 다시 맞추지 않으면 1주를 골라도 눈금이 108 근처에 붙어 있어 방향이 안 보입니다.
    const [from, rows] = rsChartWindow(s.rs.length);
    const base = s.rs[from];
    const series = s.rs.slice(from)
      .map(v => (v == null || base == null || base <= 0) ? null : Math.round((v / base) * 10000) / 100);
    const labels = m.dates.slice(from).map(d => new Date(d * 86400000).toISOString().slice(0, 10));

    // 창이 짧으면 점을 찍습니다. 거래일이 몇 개 없는데 선만 있으면 어디가 하루인지
    // 읽을 수가 없습니다.
    const dot = rows <= 26 ? 2.5 : 0;

    RS.chart = new Chart(document.getElementById('rsChart').getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: `${s.name} RS`,
            data: series,
            borderColor: '#3182ce',
            backgroundColor: 'rgba(49,130,206,0.15)',
            fill: true, pointRadius: dot, borderWidth: 1.8, tension: 0.1,
          },
          {
            label: `${m.benchmark.name} 기준선`,
            data: series.map(() => 100),
            borderColor: '#a0aec0',
            borderDash: [5, 4], pointRadius: 0, borderWidth: 1, fill: false,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { maxTicksLimit: 8, font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { font: { size: 10 } } },
        },
      },
    });

    renderSectorChartNote(m, rows, labels[0]);
  } catch (e) {
    // 차트 하나가 죽는다고 페이지 전체가 멈추면 안 됩니다.
    console.error('[sector] 차트 렌더 실패:', e);
    sectorChartUnavailable('차트를 그리지 못했습니다.');
  }
}

if (CURRENT_PAGE === 'sector') {
  document.addEventListener('DOMContentLoaded', initSectorPage);
}

// ========== 섹터 히트맵 ==========
// heatmap.html 전용입니다. 섹터 RS 화면과 같은 data/sectors.json 을 읽습니다.
//
// 칸 크기 = 거래대금 비중, 색 = 등락률. 캔버스가 아니라 절대배치 div 로 그립니다.
// 그래야 글자가 그대로 검색·선택되고, 화면 크기가 바뀌어도 다시 그리기만 하면 됩니다.

// depth: 'sector' 는 섹터 19칸, 'member' 는 종목 100칸. null 이면 화면 폭에 맡깁니다.
// zoom: 1 이면 창에 딱 맞고, 그보다 크면 판이 창보다 커져 창 안에서 스크롤됩니다.
const HM = { data: null, market: null, period: '1m', size: 'turn', depth: null, zoom: 1, tiles: [], bound: false };

// 좁은 화면 기준. 이 아래에서는 종목 100칸을 넣어 봐야 이름이 한 글자도 안 들어갑니다.
const HM_NARROW = 640;
function hmIsNarrow() { return (window.innerWidth || document.documentElement.clientWidth || 0) <= HM_NARROW; }
function hmDepth() { return HM.depth || (hmIsNarrow() ? 'sector' : 'member'); }

// 색을 어디서 최대로 진하게 만들지는 기간마다 달라야 합니다. 12개월 수익률에 ±5% 기준을
// 쓰면 거의 모든 칸이 새빨갛거나 새파래져서 아무것도 구분되지 않습니다.
const HM_CLAMP = { '1d': 3, '1w': 5, '1m': 10, '3m': 20, '6m': 30, '12m': 50 };

// 하락 ← 보합 → 상승. 사이트 팔레트의 빨강·초록을 양 끝으로 씁니다.
const HM_STOPS = [
  [-1, [155, 44, 44]],   // 진한 빨강
  [-0.5, [229, 62, 62]],
  [0, [203, 213, 224]],  // 보합
  [0.5, [56, 161, 105]],
  [1, [34, 84, 61]],     // 진한 초록
];

function hmColor(v, clamp) {
  if (v == null) return { bg: '#edf2f7', fg: '#a0aec0' };
  const t = Math.max(-1, Math.min(1, v / clamp));
  let lo = HM_STOPS[0], hi = HM_STOPS[HM_STOPS.length - 1];
  for (let i = 0; i < HM_STOPS.length - 1; i++) {
    if (t >= HM_STOPS[i][0] && t <= HM_STOPS[i + 1][0]) { lo = HM_STOPS[i]; hi = HM_STOPS[i + 1]; break; }
  }
  const span = hi[0] - lo[0];
  const k = span === 0 ? 0 : (t - lo[0]) / span;
  const rgb = [0, 1, 2].map(i => Math.round(lo[1][i] + (hi[1][i] - lo[1][i]) * k));
  // 배경이 어두우면 흰 글자, 밝으면 검은 글자. 대비를 눈대중하지 않고 휘도로 정합니다.
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return { bg: `rgb(${rgb.join(',')})`, fg: lum > 0.6 ? '#1a202c' : '#ffffff' };
}

// 트리맵 배치. 값이 큰 순으로 정렬된 항목을 절반씩 갈라 긴 변 쪽으로 나눕니다.
// 정식 squarified 보다 짧고, 이 정도 개수(섹터 19개 / 종목 100개)에서는 결과가 거의 같습니다.
function hmLayout(items, x, y, w, h, out) {
  if (items.length === 0 || w <= 0 || h <= 0) return;
  if (items.length === 1) { out.push({ item: items[0], x, y, w, h }); return; }

  const total = items.reduce((a, i) => a + i.value, 0);
  if (total <= 0) { // 값이 전부 0이면 균등 분할로 떨어뜨립니다
    const half = Math.ceil(items.length / 2);
    if (w >= h) {
      hmLayout(items.slice(0, half), x, y, w / 2, h, out);
      hmLayout(items.slice(half), x + w / 2, y, w / 2, h, out);
    } else {
      hmLayout(items.slice(0, half), x, y, w, h / 2, out);
      hmLayout(items.slice(half), x, y + h / 2, w, h / 2, out);
    }
    return;
  }

  // 앞쪽 묶음이 절반을 넘을 때까지 담습니다. 최소 하나는 담고, 뒤쪽도 최소 하나는 남깁니다.
  let acc = 0, i = 0;
  do { acc += items[i].value; i++; } while (i < items.length - 1 && acc < total / 2);

  const frac = acc / total;
  if (w >= h) {
    hmLayout(items.slice(0, i), x, y, w * frac, h, out);
    hmLayout(items.slice(i), x + w * frac, y, w * (1 - frac), h, out);
  } else {
    hmLayout(items.slice(0, i), x, y, w, h * frac, out);
    hmLayout(items.slice(i), x, y + h * frac, w, h * (1 - frac), out);
  }
}

function hmMarketData() { return HM.data.markets[HM.market]; }
function hmPeriodLabel() { return (RS_PERIODS.find(p => p.key === HM.period) || {}).label || HM.period; }

async function initHeatmapPage() {
  const loading = document.getElementById('hmLoading');
  const errBox = document.getElementById('hmError');
  try {
    // cache: 'no-cache' — 브라우저 캐시에 있어도 서버에 "바뀌었나"를 반드시 물어봅니다.
    // 안 바뀌었으면 304 라 내려받는 양은 그대로이고, 바뀌었으면 즉시 새 파일을 받습니다.
    // 이게 없으면 갱신된 뒤에도 한동안 어제 숫자를 보고 있을 수 있습니다.
    const res = await fetch('/data/sectors.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    HM.data = await res.json();
  } catch (e) {
    loading.classList.remove('show');
    errBox.style.display = 'block';
    errBox.className = 'status error show';
    errBox.textContent = '히트맵 데이터를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.';
    return;
  }

  const keys = Object.keys(HM.data.markets || {});
  if (keys.length === 0) {
    loading.classList.remove('show');
    errBox.style.display = 'block';
    errBox.className = 'status error show';
    errBox.textContent = '표시할 시장이 없습니다.';
    return;
  }
  HM.market = keys.includes('KR') ? 'KR' : keys[0];

  loading.classList.remove('show');
  document.getElementById('hmBody').classList.remove('hidden');
  renderHeatmapControls();
  renderHeatmap();

  // 폭이 바뀌면 칸 비율이 달라지므로 다시 그립니다. 연속 호출은 한 번으로 묶습니다.
  // 컨트롤도 같이 다시 그려야 합니다 — 묶음 기본값이 화면 폭에 따라 달라지므로,
  // 지도만 다시 그리면 버튼은 "종목"에 불이 켜져 있는데 지도는 섹터가 됩니다.
  let timer = null;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { renderHeatmapControls(); renderHeatmap(); }, 150);
  });
}

// 거래대금을 비교할 수 없는 시장(미국: 섹터 ETF 와 개별 종목이 섞여 있음)에서는
// 칸 크기를 균등으로 고정합니다. 비교가 성립하지 않는 값으로 칸 크기를 정하면
// 화면이 그럴듯하게 틀립니다 — 표에서 숫자를 지우는 것보다 눈에 안 띄어서 더 나쁩니다.
function hmSizeMode() { return hmMarketData().hasTurnover ? HM.size : 'equal'; }

function renderHeatmapControls() {
  const flags = { KR: '🇰🇷', US: '🇺🇸' };
  document.getElementById('hmMarketToggle').innerHTML = Object.keys(HM.data.markets)
    .map(k => `<button type="button" class="${k === HM.market ? 'active' : ''}" onclick="setHeatmapMarket('${k}')">${flags[k] || ''} ${rsEsc(HM.data.markets[k].label)}</button>`)
    .join('');
  document.getElementById('hmPeriodBtns').innerHTML = RS_PERIODS
    .map(p => `<button type="button" class="preset-btn ${p.key === HM.period ? 'active' : ''}" onclick="setHeatmapPeriod('${p.key}')">${p.label}</button>`)
    .join('');
  const comparable = hmMarketData().hasTurnover;
  document.querySelectorAll('#hmSizeToggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.size === hmSizeMode());
    b.disabled = !comparable;
    b.style.opacity = comparable ? '' : '0.45';
    b.style.cursor = comparable ? '' : 'not-allowed';
  });
  document.querySelectorAll('#hmDepthToggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.depth === hmDepth());
  });
  document.querySelectorAll('#hmZoomToggle button').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.zoom) === HM.zoom);
  });
}

function setHeatmapMarket(k) { if (HM.market === k) return; HM.market = k; renderHeatmapControls(); renderHeatmap(); }
function setHeatmapPeriod(k) { HM.period = k; renderHeatmapControls(); renderHeatmap(); }
function setHeatmapSize(k) { HM.size = k; renderHeatmapControls(); renderHeatmap(); }
function setHeatmapDepth(k) { HM.depth = k; renderHeatmapControls(); renderHeatmap(); }

// 배율을 바꾸면 판 크기가 달라집니다. 스크롤을 그냥 두면 보고 있던 자리가 엉뚱한 데로
// 튀므로, 창 한가운데가 가리키던 지점을 새 배율에서도 한가운데에 오도록 되돌립니다.
function setHeatmapZoom(z) {
  const vp = document.getElementById('hmViewport');
  const before = HM.zoom;
  let cx = 0.5, cy = 0.5;
  if (vp && vp.scrollWidth > 0) {
    cx = (vp.scrollLeft + vp.clientWidth / 2) / vp.scrollWidth;
    cy = (vp.scrollTop + vp.clientHeight / 2) / vp.scrollHeight;
  }
  HM.zoom = z;
  renderHeatmapControls();
  renderHeatmap();
  if (vp && z !== before) {
    vp.scrollLeft = cx * vp.scrollWidth - vp.clientWidth / 2;
    vp.scrollTop = cy * vp.scrollHeight - vp.clientHeight / 2;
  }
}

// 이름이 칸에 실제로 들어가는 글자 크기. 한글은 대략 글자 크기만큼 폭을 먹으므로
// (칸 너비 ÷ 글자 수) 가 곧 넣을 수 있는 최대 크기입니다. 눈대중으로 11px 을 박아 두면
// 긴 이름은 잘리고 짧은 이름은 칸을 놀립니다.
// 아주 긴 이름은 6글자까지만 셈에 넣고 나머지는 CSS 말줄임에 맡깁니다 —
// 그렇게 안 하면 이름 하나 때문에 글자가 4px 이 됩니다.
function hmFontFor(w, h, len) {
  const byWidth = (w - 6) / Math.max(1, Math.min(len, 6));
  const byHeight = (h - 13) / 1.35;
  return Math.floor(Math.min(13, byWidth, byHeight));
}

function hmShowTip(text) { document.getElementById('hmTip').innerHTML = text; }

function renderHeatmap() {
  const m = hmMarketData();
  const P = HM.period;
  const clamp = HM_CLAMP[P] || 10;
  const canvas = document.getElementById('hmCanvas');
  const viewport = document.getElementById('hmViewport');
  if (!canvas || !viewport) return;

  const byMember = hmDepth() === 'member';

  document.getElementById('hmMeta').innerHTML =
    `기준일 <b>${rsEsc(m.updated)}</b> 종가 · ` +
    `${hmPeriodLabel()} 등락률 · 수록 ${m.universeCount}종목 / ${m.sectors.length}섹터` +
    ` · 색 최대 ±${clamp}%` +
    // 거래대금을 비교할 수 없는 시장에서는 칸 크기가 균등이라는 걸 화면에 밝힙니다.
    // 크기가 아무 의미 없는데 의미 있어 보이는 것이 이 화면에서 가장 위험한 오해입니다.
    (m.hasTurnover ? '' : ' · 이 시장은 섹터 ETF 와 개별 종목이 섞여 있어 거래대금을 서로 비교할 수 없습니다 — <b>칸 크기는 균등</b>입니다') +
    `<br><span style="color:#a0aec0;">${rsStaleNote(m.updated)}</span>`;

  // 판 크기 = 창 크기 × 배율. 배율이 1이면 창에 딱 맞아 스크롤이 없고, 그보다 크면
  // 칸이 그만큼 커집니다. 트리맵은 칸 "면적"이 곧 글자 자리라, 이름이 잘릴 때
  // 실제로 필요한 건 글자를 줄이는 게 아니라 판을 키우는 것입니다.
  const W = Math.max(200, Math.round(viewport.clientWidth * HM.zoom));
  const H = Math.max(200, Math.round(viewport.clientHeight * HM.zoom));
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  const html = [];
  HM.tiles = [];
  const HEADER = 17; // 섹터 이름 띠

  // 한 칸 그리기. 섹터 묶음과 종목 묶음이 같은 함수를 씁니다 — 두 벌로 두면
  // 한쪽만 고치게 됩니다.
  const drawTile = (it, box) => {
    const { bg, fg } = hmColor(it.ret, clamp);
    const sign = it.ret > 0 ? '+' : '';
    const idx = HM.tiles.length;
    HM.tiles.push(it);

    const fs = hmFontFor(box.w, box.h, it.name.length);
    const showName = fs >= 8;
    const showPct = box.w > 26 && box.h > 13;
    const pctSize = showName ? Math.max(9, Math.min(fs - 1, 12)) : 9;

    return `<div data-tile="${idx}" title="${rsEsc(it.sector)} · ${rsEsc(it.name)}  ${sign}${it.ret.toFixed(1)}%" ` +
      `style="position:absolute; left:${box.x}px; top:${box.y}px; width:${box.w}px; height:${box.h}px; ` +
      `background:${bg}; color:${fg}; border:1px solid rgba(255,255,255,0.85); box-sizing:border-box; ` +
      `display:flex; flex-direction:column; align-items:center; justify-content:center; ` +
      `overflow:hidden; cursor:default; line-height:1.25; padding:1px;">` +
      (showName
        ? `<span style="font-weight:700; font-size:${fs}px; max-width:100%; overflow:hidden; ` +
          `text-overflow:ellipsis; white-space:nowrap;">${rsEsc(it.name)}</span>`
        : '') +
      (showPct
        ? `<span style="font-size:${pctSize}px; opacity:0.95;">${sign}${it.ret.toFixed(showName ? 1 : 0)}%</span>`
        : '') +
      `</div>`;
  };

  if (byMember) {
    // 섹터 → 그 안의 종목. 값이 없는 종목은 그리지 않습니다(상장폐지·데이터 없음).
    const sectors = m.sectors.map(s => {
      const members = s.members
        .filter(mem => mem.ret[P] != null)
        .map(mem => ({
          name: mem.name, code: mem.code, ret: mem.ret[P],
          turn: mem.turn ? mem.turn[P] : null,
          sector: s.name,
          value: hmSizeMode() === 'equal' ? 1 : Math.max(mem.turn && mem.turn[P] ? mem.turn[P] : 0, 0.0001),
        }))
        .sort((a, b) => b.value - a.value);
      return { name: s.name, members, value: members.reduce((a, x) => a + x.value, 0) };
    }).filter(s => s.members.length > 0).sort((a, b) => b.value - a.value);

    if (sectors.length === 0) { canvas.innerHTML = ''; return; }

    const boxes = [];
    hmLayout(sectors, 0, 0, W, H, boxes);

    for (const box of boxes) {
      const s = box.item;
      html.push(
        `<div style="position:absolute; left:${box.x}px; top:${box.y}px; width:${box.w}px; height:${box.h}px; ` +
        `border:1px solid #fff; box-sizing:border-box; overflow:hidden;">` +
        (box.h > HEADER + 8
          ? `<div style="height:${HEADER}px; line-height:${HEADER}px; background:#2d3748; color:#fff; ` +
            `font-size:10px; font-weight:700; padding:0 5px; white-space:nowrap; overflow:hidden;">${rsEsc(s.name)}</div>`
          : '') +
        `</div>`
      );

      const innerY = box.h > HEADER + 8 ? HEADER : 0;
      const cells = [];
      hmLayout(s.members, box.x, box.y + innerY, box.w, box.h - innerY, cells);
      for (const cell of cells) html.push(drawTile(cell.item, cell));
    }
  } else {
    // 섹터 묶음. 칸이 19개뿐이라 좁은 화면에서도 이름이 그대로 들어갑니다.
    // 수익률은 섹터 지수(구성 종목 동일가중)의 값이라 종목 칸의 평균과는 다릅니다.
    const items = m.sectors
      .filter(s => s.periods[P] && s.periods[P].ret != null)
      .map(s => {
        const share = s.periods[P].turnShare;
        return {
          name: s.name, code: s.key, ret: s.periods[P].ret, turn: share, sector: '섹터 지수',
          value: hmSizeMode() === 'equal' ? 1 : Math.max(share || 0, 0.0001),
        };
      })
      .sort((a, b) => b.value - a.value);

    if (items.length === 0) { canvas.innerHTML = ''; return; }

    const cells = [];
    hmLayout(items, 0, 0, W, H, cells);
    for (const cell of cells) html.push(drawTile(cell.item, cell));
  }

  canvas.innerHTML = html.join('');

  // 기간·시장을 바꾸면 설명줄을 비웁니다. 그대로 두면 지도는 12개월인데 설명줄만
  // "1개월 -9.8%" 로 남아, 화면 안에서 두 기간이 섞여 보입니다.
  hmShowTip('칸에 마우스를 올리거나 터치하면 자세한 값이 여기에 나옵니다.');

  // 배율 안내. 배율 1에서는 스크롤이 없으니 "밀어서 보세요"라고 하면 안 됩니다.
  document.getElementById('hmZoomHint').textContent = HM.zoom > 1
    ? '· 확대된 상태입니다. 지도 안을 밀어서 나머지를 보세요.'
    : (hmDepth() === 'sector'
      ? '· 섹터로 묶어 보는 중입니다. 종목까지 보려면 묶음을 종목으로 바꾸세요.'
      : '· 이름이 잘리면 배율을 올리거나 묶음을 섹터로 바꾸세요.');

  // 마우스와 터치 양쪽에서 같은 설명을 띄웁니다. 칸이 작아 글자를 못 넣은 경우가 많아
  // 이 줄이 사실상 유일한 확인 수단입니다.
  //
  // 한 번만 붙입니다. 예전에는 렌더할 때마다 붙여서, 기간 버튼을 열 번 누르면
  // 같은 핸들러가 열 개 쌓였습니다(칸 하나 만질 때마다 열 번 실행).
  if (!HM.bound) {
    const onPick = e => {
      const el = e.target.closest('[data-tile]');
      if (!el) return;
      const it = HM.tiles[Number(el.dataset.tile)];
      if (!it) return;
      const sign = it.ret > 0 ? '+' : '';
      const color = it.ret > 0 ? '#38a169' : (it.ret < 0 ? '#e53e3e' : '#718096');
      hmShowTip(
        `<b>${rsEsc(it.name)}</b> <span style="color:#a0aec0;">(${rsEsc(it.sector)})</span> · ` +
        `${hmPeriodLabel()} <b style="color:${color};">${sign}${it.ret.toFixed(1)}%</b>` +
        (it.turn != null ? ` · 거래대금 비중 <b>${it.turn.toFixed(2)}%</b>` : '')
      );
    };
    canvas.addEventListener('mousemove', onPick);
    canvas.addEventListener('click', onPick);
    HM.bound = true;
  }

  // 범례
  const steps = [-clamp, -clamp / 2, 0, clamp / 2, clamp];
  document.getElementById('hmLegend').innerHTML =
    '<span>하락</span>' +
    steps.map(v => {
      const { bg, fg } = hmColor(v, clamp);
      return `<span style="background:${bg}; color:${fg}; padding:3px 8px; border-radius:4px; font-weight:600;">` +
        `${v > 0 ? '+' : ''}${v}%</span>`;
    }).join('') +
    '<span>상승</span>' +
    `<span style="margin-left:8px;">· 칸 크기 = ${hmSizeMode() === 'equal' ? '균등' : '거래대금 비중'}` +
    ` · 칸 = ${byMember ? '종목' : '섹터'}</span>`;
}

if (CURRENT_PAGE === 'heatmap') {
  document.addEventListener('DOMContentLoaded', initHeatmapPage);
}
