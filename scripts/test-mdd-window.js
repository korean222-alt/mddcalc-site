// index.html 의 MDD 계산 로직 중 "조회 기간" 때문에 화면이 고장 난 것처럼 보이던 부분을 검증한다.
//
// 배경: 이 화면의 기본 조회 기간은 최근 5년이다. 페이팔(PYPL)처럼 진짜 전고점이 5년 창의
// 바로 바깥(2021-07)에 있는 종목은, 창 안에서 가장 높은 값이 "첫날"이 되어 버린다.
// 그러면 하락률 차트가 0%에서 시작해 끝까지 내려가기만 하고 회복률이 전부 0%로 찍힌다.
// 계산은 맞지만 화면은 망가져 보인다. renderWindowPeakNotice() 가 이 상황을 잡아내는지 본다.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// index.html 의 인라인 <script> 를 최소한의 DOM 스텁 위에서 실행한다.
function loadPage() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const blocks = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (/\ssrc=/.test(m[1]) || /ld\+json/.test(m[1])) continue;
    blocks.push(m[2]);
  }
  if (blocks.length === 0) throw new Error('index.html 에서 인라인 스크립트를 찾지 못했습니다.');

  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      els.set(id, {
        id, textContent: '', innerHTML: '', value: '', style: {},
        classList: {
          _s: new Set(),
          add(c) { this._s.add(c); },
          remove(c) { this._s.delete(c); },
          toggle(c, f) { if (f) this._s.add(c); else this._s.delete(c); },
          contains(c) { return this._s.has(c); },
        },
        setAttribute() {}, appendChild() {}, getContext() { return {}; }, parentElement: null,
      });
    }
    return els.get(id);
  };
  const noStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const sandbox = {
    document: {
      getElementById: el,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => el('tmp-' + Math.random()),
      addEventListener: () => {},
    },
    window: { addEventListener: () => {}, location: { search: '' }, matchMedia: () => ({ matches: false }) },
    localStorage: noStorage, sessionStorage: noStorage,
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => { throw new Error('테스트에서는 네트워크를 쓰지 않습니다.'); },
    setTimeout, clearTimeout, setInterval, clearInterval,
    navigator: { userAgent: 'test' },
    Chart: undefined, URLSearchParams, Date, Math, JSON,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(blocks.join('\n;\n'), sandbox, { filename: 'index.html <script>' });
  // STATE 는 let 선언이라 컨텍스트 객체의 속성이 되지 않는다. 렉시컬 바인딩을 꺼내 온다.
  sandbox.STATE = vm.runInContext('STATE', sandbox);
  return sandbox;
}

// 페이팔을 흉내 낸 시세. 2021-07-26 에 꼭지를 찍고 그 뒤로 계속 흘러내린다.
function pyplLike() {
  const rows = [];
  const start = new Date('2015-01-02'), end = new Date('2026-08-24'), peak = new Date('2021-07-26');
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay();
    if (wd === 0 || wd === 6) continue;
    const p = d <= peak
      ? 35 + 275 * Math.pow((d - start) / (peak - start), 1.4)
      : Math.max(5, 310 * Math.exp(-1.15 * Math.pow((d - peak) / (end - peak), 0.55)));
    rows.push({ date: d.toISOString().slice(0, 10), open: p, high: p * 1.01, low: p * 0.99, close: p });
  }
  return rows;
}

function windowOf(raw, years) {
  const latest = new Date(raw[raw.length - 1].date);
  const from = new Date(latest);
  from.setFullYear(from.getFullYear() - years);
  const sd = from.toISOString().slice(0, 10);
  return raw.filter((r) => r.date >= sd);
}

let failures = 0;
function check(label, cond, extra) {
  if (cond) {
    console.log('✅ ' + label);
  } else {
    failures++;
    console.log('❌ ' + label + (extra ? ' — ' + extra : ''));
  }
}

const page = loadPage();
const banner = page.document.getElementById('windowPeakBanner');
const raw = pyplLike();
page.STATE.raw = raw;
page.STATE.ticker = 'PYPL';
page.STATE.currency = 'USD';
page.STATE.mode = 'high';

// 1) 기본값인 5년 창 — 고점이 창 첫날이라 회복률이 전부 0%. 안내가 떠야 한다.
page.STATE.filtered = windowOf(raw, 5);
let A = page.analyze(page.STATE.filtered, 'high');
banner.classList.add('hidden');
page.renderWindowPeakNotice(A);
const hitRows = A.recoveryTable.filter((r) => r.everHit);
check('5년 창에서 고점이 첫날 부근이면 회복률이 전부 0%로 찍힌다',
  hitRows.length > 0 && hitRows.every((r) => r.rate === 0));
check('그 상황에서 "기간 밖 고점" 안내가 뜬다', !banner.classList.contains('hidden'));
check('안내가 기간 밖의 진짜 고점 날짜를 알려 준다',
  banner.innerHTML.includes('2021-07-26'), banner.innerHTML.slice(0, 120));
check('안내에 전체 기간으로 넘어가는 버튼이 있다', banner.innerHTML.includes("setPreset('all')"));

// 2) 10년 창 — 진짜 고점이 창 안에 들어온다. 안내가 뜨면 안 된다.
page.STATE.filtered = windowOf(raw, 10);
A = page.analyze(page.STATE.filtered, 'high');
banner.classList.add('hidden');
page.renderWindowPeakNotice(A);
check('진짜 고점이 창 안에 있으면 안내가 뜨지 않는다', banner.classList.contains('hidden'));
check('그때의 고점 날짜가 실제 꼭지와 같다', A.athDate === '2021-07-26', A.athDate);

// 3) 계속 신고가를 내는 종목 — 안내가 뜨면 안 된다.
const rising = raw.map((r, i) => {
  const p = 10 + i * 0.1;
  return { date: r.date, open: p, high: p * 1.01, low: p, close: p };
});
page.STATE.raw = rising;
page.STATE.filtered = rising.slice(-1258);
A = page.analyze(page.STATE.filtered, 'high');
banner.classList.add('hidden');
page.renderWindowPeakNotice(A);
check('신고가를 계속 내는 종목에는 안내가 뜨지 않는다', banner.classList.contains('hidden'));

// 4) 전체 기간을 보고 있으면 알려 줄 "바깥"이 없다.
page.STATE.raw = raw;
page.STATE.filtered = raw.slice();
A = page.analyze(page.STATE.filtered, 'high');
banner.classList.add('hidden');
page.renderWindowPeakNotice(A);
check('전체 기간을 보고 있으면 안내가 뜨지 않는다', banner.classList.contains('hidden'));

console.log(failures === 0 ? '\n모두 통과' : `\n${failures}개 실패`);
process.exit(failures === 0 ? 0 : 1);
