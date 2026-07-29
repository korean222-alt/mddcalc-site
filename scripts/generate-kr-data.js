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

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const DELAY_MS = 700;   // 종목 간 간격. 한꺼번에 쏘면 429를 받습니다.
const MAX_ROWS = 6000;  // 약 24년치. MDD 계산에는 충분합니다.

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 날짜를 "에포크 이후 일수"(정수)로 저장합니다. "2026-07-28"(12바이트)보다 훨씬 작고,
// 종목당 수천 행이라 이 차이가 파일 크기에 그대로 반영됩니다.
function toEpochDay(ts) {
  return Math.floor(ts / 86400);
}

async function fetchOne(symbol) {
  let lastError = null;

  for (const host of HOSTS) {
    const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=max`;
    let response;
    try {
      response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    } catch (err) {
      lastError = err;
      continue;
    }

    if (response.status === 429) {
      lastError = new Error('429 rate limited');
      await sleep(5000); // 잠깐 쉬고 다른 호스트로
      continue;
    }
    if (!response.ok) {
      lastError = new Error(`HTTP ${response.status}`);
      continue;
    }

    const json = await response.json();
    const result = json?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp)) {
      lastError = new Error(json?.chart?.error?.description || '데이터 없음');
      continue;
    }

    const quote = result.indicators?.quote?.[0] || {};
    const d = [], h = [], c = [];

    for (let i = 0; i < result.timestamp.length; i++) {
      const close = quote.close?.[i];
      if (close == null) continue; // 휴장·거래정지일
      const high = quote.high?.[i] ?? close;
      d.push(toEpochDay(result.timestamp[i]));
      // 원화는 호가 단위가 1원이라 반올림해도 정보 손실이 없고, 파일이 눈에 띄게 작아집니다.
      // 지수는 소수점이 의미가 있어 두 자리까지 남깁니다.
      const round = result.meta?.currency === 'KRW' && !symbol.startsWith('^')
        ? Math.round
        : (v => Math.round(v * 100) / 100);
      h.push(round(high));
      c.push(round(close));
    }

    if (d.length === 0) {
      lastError = new Error('유효한 종가 없음');
      continue;
    }

    // 오래된 쪽을 잘라냅니다 (뒤쪽이 최신).
    const from = Math.max(0, d.length - MAX_ROWS);

    return {
      symbol: result.meta?.symbol || symbol,
      name: result.meta?.longName || result.meta?.shortName || null,
      currency: result.meta?.currency || 'KRW',
      d: d.slice(from),
      h: h.slice(from),
      c: c.slice(from),
    };
  }

  throw lastError || new Error('알 수 없는 실패');
}

// 15개 HTML 안의 KR_STOCKS 표를 실제 생성된 종목만으로 다시 씁니다.
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

  for (const file of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
    const p = path.join(ROOT, file);
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

  for (const t of KR_TICKERS) {
    const symbol = yahooSymbol(t);
    try {
      const data = await fetchOne(symbol);
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
      };
      fs.writeFileSync(path.join(OUT_DIR, `${t.code}.json`), JSON.stringify(payload));
      ok.push(t);
      console.log(`✅ ${t.name} (${symbol}) — ${data.d.length}행, 최신 ${payload.updated}`);
    } catch (err) {
      // 한 종목이 실패해도 나머지는 계속 만듭니다. 이미 저장돼 있던 파일은 건드리지 않으므로
      // 그 종목은 지난번 데이터로 계속 서빙됩니다.
      failed.push({ ticker: t, reason: err.message });
      console.warn(`⚠️  ${t.name} (${symbol}) 실패: ${err.message} — 기존 파일 유지`);
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
  console.log(`HTML 갱신 — 종목명 표 ${updatedFiles}개 파일, 칩 ${updatedChips}개, 지원 목록 ${updatedList}개`);

  if (usable.length === 0) {
    console.error('::error::단 한 종목도 만들지 못했습니다. 데이터 소스가 막혔을 수 있습니다.');
    process.exit(1);
  }
  // 일부 실패는 정상 종료입니다. 여기서 죽이면 나머지 성공분까지 커밋되지 않습니다.
}

main().catch(err => {
  console.error('생성 실패:', err);
  process.exit(1);
});
