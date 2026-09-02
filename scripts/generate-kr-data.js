#!/usr/bin/env node
// 한국 주식 일봉 데이터를 미리 만들어 정적 파일로 저장합니다.
//
//   node scripts/generate-kr-data.js
//
// 왜 실시간 API가 아니라 미리 만들어두는가:
//   Twelve Data 무료 플랜에 한국거래소가 없어서 다른 소스가 필요한데, 무료로 쓸 수 있는
//   소스(야후 파이낸스)는 공식 지원 API가 아니라 언제든 429로 막히거나 형식이 바뀔 수 있습니다.
//   그걸 사용자가 버튼을 누르는 순간에 호출하면, 하필 그때 막혔을 때 사이트의 기능 하나가
//   눈앞에서 고장납니다. (예전 /api/alerts 404가 정확히 그런 사례였습니다.)
//
//   그래서 불안정한 호출은 전부 이 스크립트 안 = 빌드 시점으로 옮겼습니다.
//   - 사용자 브라우저는 /data/kr/{code}.json 이라는 정적 파일만 읽습니다. 실패할 여지가 없습니다.
//   - 이 스크립트가 실패해도 이미 저장된 지난 데이터가 그대로 서빙됩니다. 사이트는 멀쩡합니다.
//   - MDD는 전일 종가 기준 지표라 실시간일 필요가 없습니다. (사이트도 그렇게 안내하고 있습니다.)
//
// 이 스크립트는 두 가지를 함께 갱신해서 서로 어긋나지 않게 합니다:
//   1) data/kr/{code}.json  — 일봉 시세
//   2) 15개 HTML 안의 KR_STOCKS 표 — 종목명 → 코드 (실제로 파일이 생성된 종목만 넣습니다)

const fs = require('fs');
const path = require('path');
const { KR_TICKERS, yahooSymbol, normalizeKrName } = require('./kr-tickers');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'kr');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const DELAY_MS = 700;             // 종목 간 간격. 한꺼번에 쏘면 429를 받습니다.
const MAX_ROWS = 6000;            // 약 24년치. MDD 계산에는 충분합니다.
// 거래량·외국인소진율은 "최근 것만" 저장합니다. 6000행을 전부 담으면 종목당 파일이 두 배가
// 되는데, 이 두 값을 쓰는 곳(섹터 수급 계산)이 필요로 하는 구간은 최근 1년 남짓뿐입니다.
// 520행 ≈ 2.1년. 12개월 거래대금 비중을 "직전 12개월"과 비교하려면 250×2 행이 필요합니다.
// 정렬 규칙: v[k] 는 d[d.length - v.length + k] 에 대응합니다. (뒤에서부터 맞춥니다)
const TAIL_ROWS = 520;
const REQUEST_TIMEOUT_MS = 20000; // 아래 httpGet 주석 참고 — 이게 없으면 무한정 매달립니다.

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 날짜를 "에포크 이후 일수"(정수)로 저장합니다. "2026-07-28"(12바이트)보다 훨씬 작고,
// 종목당 수천 행이라 이 차이가 파일 크기에 그대로 반영됩니다.
const epochDayFromUnix = ts => Math.floor(ts / 86400);
const epochDayFromYmd = ymd =>
  Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) / 86400000;

async function httpGet(url, extraHeaders) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...(extraHeaders || {}) },
    // Node 의 fetch 에는 기본 타임아웃이 없습니다. 이걸 안 걸면 상대가 응답을 주지도
    // 끊지도 않을 때 영원히 매달립니다. 실제로 첫 실행이 이것 때문에 20분간 멈춰 있었습니다.
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// ── 시세 소스 ────────────────────────────────────────────────────────
// 소스를 하나만 두면 그게 막히는 날 한국 주식 갱신이 통째로 멈춥니다. 순서대로 시도해서
// 먼저 성공하는 것을 쓰고, 어느 소스가 쓰였는지 로그로 남깁니다.

// 1) 네이버 금융이 자기 차트에 쓰는 공개 엔드포인트.
//    행 형식: [날짜, 시가, 고가, 저가, 종가, 거래량, 외국인소진율]
const NAVER_INDEX_SYMBOL = { KS11: 'KOSPI', KQ11: 'KOSDAQ' };

async function fromNaver(t) {
  const symbol = t.market === 'IDX' ? NAVER_INDEX_SYMBOL[t.code] : t.code;
  if (!symbol) throw new Error('이 소스가 모르는 심볼');

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const url =
    'https://api.finance.naver.com/siseJson.naver' +
    `?symbol=${symbol}&requestType=1&startTime=19900101&endTime=${today}&timeframe=day`;

  const text = await (await httpGet(url, { Referer: 'https://finance.naver.com/' })).text();

  // 실제 응답(2026-07-29 실행 로그에서 확인):
  //   [['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'],   ← 헤더는 작은따옴표
  //    ["20010910", 10797, 11324, 9885, 10894, 1254910, 42.17],            ← 데이터는 큰따옴표
  //    ["19980509", 5328, 5328, 5138, 5328, 4757, ]]                       ← 옛 행은 마지막 값이 빔
  //
  // 처음엔 따옴표를 치환해 통째로 JSON.parse 했는데, 저 빈 값(`4757, ]`)이 JSON 문법에 어긋나
  // 그 종목의 히스토리 전체가 버려졌습니다. 1990년대부터 상장된 21종목이 전부 이것 때문에 죽었습니다.
  // 그래서 필요한 열만 정규식으로 뽑습니다. 뒤쪽 열이 비어 있든 앞뒤에 뭐가 붙어 있든 무관합니다.
  // 따옴표는 두 종류가 섞여 오므로 둘 다 받습니다.
  // 6열(거래량)과 7열(외국인소진율)은 옵셔널 그룹으로 받습니다. 위 예시의 `4757, ]` 처럼
  // 옛 행은 7열이 비어 있고, 아주 옛 행은 열 자체가 없기도 합니다. 필수로 잡으면 그런 행이
  // 통째로 버려집니다 — 이 파일이 이미 한 번 겪은 실패와 같은 종류입니다.
  const rowRe = /\[\s*["']?(\d{8})["']?\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]*)\s*(?:,\s*([\d.]*)\s*)?)?/g;
  // 원화는 호가 단위가 1원이라 반올림해도 정보 손실이 없습니다. 지수는 소수점이 의미가 있습니다.
  const round = t.market === 'IDX' ? (v => Math.round(v * 100) / 100) : Math.round;

  const out = [];
  for (const m of text.matchAll(rowRe)) {
    const high = Number(m[3]);
    const close = Number(m[5]);
    if (!Number.isFinite(close) || close <= 0) continue;
    // 반올림 뒤 고가가 종가보다 낮아지는 경우가 생길 수 있어 max 로 맞춥니다.
    // analyze() 가 고가를 최고점 계열로 쓰기 때문에 여기가 어긋나면 낙폭이 틀어집니다.
    // 거래량이 없으면 0. 외국인소진율은 "없음"과 "0%"를 구분해야 하므로 null 로 둡니다.
    // 지수(코스피/코스닥)는 이 값이 늘 0.0 으로 오는데 의미가 없으므로 마찬가지로 null 입니다.
    const volume = m[6] ? Math.round(Number(m[6])) : 0;
    const foreign = (t.market !== 'IDX' && m[7]) ? Math.round(Number(m[7]) * 100) / 100 : null;
    out.push([
      epochDayFromYmd(m[1]),
      Math.max(round(Number.isFinite(high) ? high : close), round(close)),
      round(close),
      Number.isFinite(volume) ? volume : 0,
      Number.isFinite(foreign) ? foreign : null,
    ]);
  }

  if (out.length === 0) {
    // 무엇 때문에 실패했는지 추측하지 않아도 되도록 응답 앞부분을 남깁니다.
    throw new Error(`행을 찾지 못함 (응답 앞부분: ${text.replace(/\s+/g, ' ').slice(0, 160)})`);
  }

  out.sort((a, b) => a[0] - b[0]); // 과거 → 최신
  return {
    source: 'naver',
    currency: t.market === 'IDX' ? 'PT' : 'KRW', // PT = 지수 포인트 (통화 아님)
    d: out.map(r => r[0]),
    h: out.map(r => r[1]),
    c: out.map(r => r[2]),
    v: out.map(r => r[3]),
    f: out.map(r => r[4]),
  };
}

// 2) 야후 파이낸스 chart 엔드포인트. 지수(^KS11)까지 되지만 비공식이라 429가 잦습니다.
async function fromYahoo(t) {
  const symbol = yahooSymbol(t);
  const hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  let lastError = null;

  for (const host of hosts) {
    try {
      const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=max`;
      const json = await (await httpGet(url, { Accept: 'application/json' })).json();
      const result = json?.chart?.result?.[0];
      if (!result || !Array.isArray(result.timestamp)) {
        throw new Error(json?.chart?.error?.description || '데이터 없음');
      }

      const quote = result.indicators?.quote?.[0] || {};
      // 원화는 호가 단위가 1원이라 반올림해도 정보 손실이 없고 파일이 작아집니다.
      // 지수와 미국 종목(달러·센트)은 소수점이 의미가 있어 두 자리까지 남깁니다.
      const round = (t.market === 'IDX' || t.market === 'US')
        ? (v => Math.round(v * 100) / 100)
        : Math.round;

      const d = [], h = [], c = [], v = [];
      for (let i = 0; i < result.timestamp.length; i++) {
        const close = quote.close?.[i];
        if (close == null) continue; // 휴장·거래정지일
        d.push(epochDayFromUnix(result.timestamp[i]));
        h.push(round(quote.high?.[i] ?? close));
        c.push(round(close));
        v.push(Math.round(quote.volume?.[i] ?? 0));
      }
      if (d.length === 0) throw new Error('유효한 종가 없음');

      // 야후에는 외국인소진율이 없습니다. f 를 주지 않으므로, 어떤 종목이 야후로 폴백하면
      // 그 종목만 외국인 지표가 빠집니다. 섹터 계산부는 이 결측을 견디도록 되어 있습니다.
      const fallbackCurrency = t.market === 'US' ? 'USD' : 'KRW';
      return {
        source: 'yahoo',
        currency: t.market === 'IDX' ? 'PT' : (result.meta?.currency || fallbackCurrency),
        d, h, c, v,
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('알 수 없는 실패');
}

const SOURCES = [fromNaver, fromYahoo];

async function fetchOne(t) {
  const errors = [];

  for (const source of SOURCES) {
    try {
      const got = await source(t);
      const from = Math.max(0, got.d.length - MAX_ROWS); // 오래된 쪽을 잘라냅니다
      const tail = Math.max(0, got.d.length - TAIL_ROWS); // 거래량·외국인은 최근분만

      // 외국인소진율이 한 행도 없으면(지수, 야후 폴백) 키를 아예 넣지 않습니다.
      // null 만 520개 들어 있는 배열을 저장할 이유가 없습니다.
      const f = got.f ? got.f.slice(tail) : null;
      const hasForeign = f && f.some(x => x != null);

      return {
        ...got,
        symbol: t.market === 'US' ? t.code : (t.market === 'IDX' ? `^${t.code}` : `${t.code}.${t.market}`),
        d: got.d.slice(from),
        h: got.h.slice(from),
        c: got.c.slice(from),
        v: got.v ? got.v.slice(tail) : [],
        f: hasForeign ? f : null,
      };
    } catch (err) {
      errors.push(`${source.name}: ${err.message}`);
    }
  }

  throw new Error(errors.join(' / '));
}

// KR_STOCKS 표가 들어 있는 모든 파일(루트 HTML + assets/site.js)을 실제 생성된
// 종목만으로 다시 씁니다.
// 데이터 파일이 없는 종목이 검색어 표에 남아 있으면 "검색은 되는데 결과가 없는" 상태가
// 되므로, 성공한 종목만 넣는 것이 핵심입니다.
function syncNameTable(okTickers) {
  const pairs = [];
  for (const t of okTickers) {
    const names = [t.name, ...(t.aliases || [])];
    for (const n of names) pairs.push([normalizeKrName(n), t.code]);
  }
  pairs.push(...okTickers.map(t => [t.code, t.code])); // 코드 자체도 키로

  const seen = new Set();
  const lines = [];
  for (const [k, v] of pairs) {
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  }

  const block =
    'const KR_STOCKS = {\n' +
    '  // 이 표는 scripts/generate-kr-data.js 가 자동으로 씁니다. 직접 고치지 마세요.\n' +
    '  // 종목을 추가하려면 scripts/kr-tickers.js 에 넣고 생성기를 다시 돌리세요.\n' +
    lines.join('\n') +
    '\n};';

  const re = /const KR_STOCKS = \{[\s\S]*?\n\};/;
  let updated = 0;

  // 루트 HTML 뿐 아니라 assets/site.js 도 갱신합니다. index.html 은 계산기 코드를 자체
  // 복제해 두고 있고 나머지 페이지는 assets/site.js 를 읽는데, 예전에는 이 루프가 루트
  // HTML 만 훑어서 site.js 쪽 표만 낡은 채로 남았습니다. 그 결과 홈에서는 찾아지는
  // 종목명이 RSI 계산기에서는 미국 API 로 새어 나가 실패했습니다.
  const files = fs.readdirSync(ROOT)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(ROOT, f));
  files.push(path.join(ROOT, 'assets', 'site.js'));

  for (const p of files) {
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    if (!re.test(src)) continue;
    const next = src.replace(re, () => block);
    if (next !== src) {
      fs.writeFileSync(p, next);
      updated++;
    }
  }
  return updated;
}

// 검색창 바로 아래 한국 종목 바로가기 칩. 데이터 파일이 실제로 있는 종목만 넣습니다.
// (버튼이 있는데 눌러도 안 되는 상태를 원천적으로 만들지 않기 위해서입니다.)
const CHIP_PICKS = ['005930', '000660', '005380', '035420', 'KS11'];

function syncChips(okTickers) {
  const byCode = new Map(okTickers.map(t => [t.code, t]));
  const chips = CHIP_PICKS
    .filter(code => byCode.has(code))
    .map(code => {
      const t = byCode.get(code);
      const label = t.market === 'IDX' ? `${t.name} 지수` : t.name;
      return `      <button type="button" class="quick-chip" onclick="loadFavoriteTicker('${t.name}')">${label}</button>`;
    });

  const block =
    '<!-- KR_CHIPS_START 이 블록은 scripts/generate-kr-data.js 가 자동으로 씁니다 -->\n' +
    (chips.length ? chips.join('\n') + '\n' : '') +
    '      <!-- KR_CHIPS_END -->';

  const p = path.join(ROOT, 'index.html');
  const src = fs.readFileSync(p, 'utf8');
  const re = /<!-- KR_CHIPS_START[\s\S]*?<!-- KR_CHIPS_END -->/;
  if (!re.test(src)) return 0;
  const next = src.replace(re, () => block);
  if (next === src) return 0;
  fs.writeFileSync(p, next);
  return 1;
}

// 검색창 아래에 지원 종목을 실제로 보여줍니다. 두 가지 목적이 있습니다.
//   1) "안 되는 종목"을 사용자가 추측하지 않아도 되게 한다
//   2) 사이트에 한글 종목명이 실제 텍스트로 존재하게 한다
//      (작업 로그 9장에서 지적한, "테슬라 하락률" 류 검색어에 걸릴 근거가 없다는 문제와 같은 맥락)
function syncSupportedList(okTickers) {
  const groups = [
    ['코스피', okTickers.filter(t => t.market === 'KS')],
    ['코스닥', okTickers.filter(t => t.market === 'KQ')],
    ['지수', okTickers.filter(t => t.market === 'IDX')],
  ];

  const html = groups
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) =>
      `        <div style="margin-bottom:8px;"><b>${label}</b> (${list.length}) — ` +
      list.map(t => `<span class="kr-name">${t.name}</span>`).join(', ') +
      '</div>')
    .join('\n');

  const block =
    '<!-- KR_SUPPORTED_START 이 블록은 scripts/generate-kr-data.js 가 자동으로 씁니다 -->\n' +
    '      <div class="body" style="font-size:12px; line-height:1.9;">\n' +
    html + '\n' +
    '        <div style="margin-top:8px; color:#718096;">목록에 없는 종목도 6자리 코드로 요청해 주시면 추가합니다.</div>\n' +
    '      </div>\n' +
    '      <!-- KR_SUPPORTED_END -->';

  const p = path.join(ROOT, 'index.html');
  const src = fs.readFileSync(p, 'utf8');
  const re = /<!-- KR_SUPPORTED_START[\s\S]*?<!-- KR_SUPPORTED_END -->/;
  if (!re.test(src)) return 0;
  const next = src.replace(re, () => block);
  if (next === src) return 0;
  fs.writeFileSync(p, next);
  return 1;
}

async function main() {
  // --sync-only: 시세는 받지 않고, 이미 있는 data/kr/*.json 기준으로 HTML 표만 다시 맞춥니다.
  // 네트워크 없이 돌릴 수 있어서 종목 목록만 손봤을 때 유용합니다.
  if (process.argv.includes('--sync-only')) {
    const usable = KR_TICKERS.filter(t => fs.existsSync(path.join(OUT_DIR, `${t.code}.json`)));
    console.log(`--sync-only: 데이터 파일이 있는 ${usable.length}종목으로 HTML 갱신`);
    console.log(`  종목명 표 ${syncNameTable(usable)}개 파일, 칩 ${syncChips(usable)}개, 지원 목록 ${syncSupportedList(usable)}개`);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const ok = [];
  const failed = [];

  const bySource = {};

  for (const t of KR_TICKERS) {
    try {
      const data = await fetchOne(t);
      bySource[data.source] = (bySource[data.source] || 0) + 1;
      const payload = {
        code: t.code,
        symbol: data.symbol,
        name: t.name,
        market: t.market,
        currency: data.currency,
        updated: new Date(data.d[data.d.length - 1] * 86400000).toISOString().slice(0, 10),
        d: data.d,
        h: data.h,
        c: data.c,
        // v(거래량)·f(외국인소진율)는 최근 TAIL_ROWS 행만 담깁니다.
        // v[k] 는 d[d.length - v.length + k] 에 대응합니다.
        v: data.v,
        ...(data.f ? { f: data.f } : {}),
      };
      fs.writeFileSync(path.join(OUT_DIR, `${t.code}.json`), JSON.stringify(payload));
      ok.push(t);
      console.log(`✅ ${t.name} (${payload.symbol}) — ${data.d.length}행, 최신 ${payload.updated} [${data.source}]`);
    } catch (err) {
      // 한 종목이 실패해도 나머지는 계속 만듭니다. 이미 저장돼 있던 파일은 건드리지 않으므로
      // 그 종목은 지난번 데이터로 계속 서빙됩니다.
      failed.push({ ticker: t, reason: err.message });
      console.warn(`⚠️  ${t.name} (${t.code}) 실패: ${err.message} — 기존 파일 유지`);
    }
    await sleep(DELAY_MS);
  }

  // 이번에 실패했더라도 이전 실행에서 만들어진 파일이 있으면 그 종목은 여전히 조회 가능합니다.
  const usable = KR_TICKERS.filter(t => fs.existsSync(path.join(OUT_DIR, `${t.code}.json`)));
  const updatedFiles = syncNameTable(usable);
  const updatedChips = syncChips(usable);
  const updatedList = syncSupportedList(usable);

  fs.writeFileSync(
    path.join(OUT_DIR, 'index.json'),
    JSON.stringify({
      updated: new Date().toISOString().slice(0, 10),
      count: usable.length,
      stocks: usable.map(t => ({ code: t.code, name: t.name, market: t.market })),
    }, null, 2)
  );

  console.log(`\n조회 성공 ${ok.length} / 실패 ${failed.length} / 서빙 가능 ${usable.length}종목`);
  console.log('소스별 성공:', Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ') || '없음');
  console.log(`HTML 갱신 — 종목명 표 ${updatedFiles}개 파일, 칩 ${updatedChips}개, 지원 목록 ${updatedList}개`);

  if (usable.length === 0) {
    console.error('::error::단 한 종목도 만들지 못했습니다. 데이터 소스가 막혔을 수 있습니다.');
    process.exit(1);
  }
  // 일부 실패는 정상 종료입니다. 여기서 죽이면 나머지 성공분까지 커밋되지 않습니다.
}

// 직접 실행할 때만 돌립니다. 테스트에서 개별 함수를 가져다 쓸 수 있게 하기 위함입니다.
if (require.main === module) {
  main().catch(err => {
    console.error('생성 실패:', err);
    process.exit(1);
  });
}

module.exports = { fromNaver, fromYahoo, fetchOne, syncNameTable, syncChips, syncSupportedList, httpGet, epochDayFromYmd };
