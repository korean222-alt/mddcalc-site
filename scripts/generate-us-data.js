#!/usr/bin/env node
// 미국 종목 일봉을 미리 만들어 정적 파일로 저장합니다. 대상 목록은 scripts/sectors.js
// 의 US_SECTORS 입니다(+ 벤치마크 SPY).
//
//   node scripts/generate-us-data.js
//
// 왜 별도 파이프라인인가:
//   미국 종목은 이미 /api/twelve-data/time-series 로 조회할 수 있지만, 그쪽은 하루 800회
//   한도를 MySQL 로 세는 API 프록시입니다. 섹터 화면은 한 번 열 때 80개 심볼이 필요하므로,
//   그 경로로 보내면 페이지뷰 10번이면 하루 한도가 끝납니다.
//   그래서 한국 데이터와 똑같이 "빌드 시점에 받아 정적 파일로 커밋" 방식을 씁니다.
//
// 왜 Twelve Data 가 1순위인가:
//   2026-08-23 실행 로그 기준으로 무료 소스는 둘 다 GitHub Actions 러너 IP 를 막습니다.
//     야후  : 22심볼 전부 첫 요청부터 HTTP 429 (간격을 벌려도 동일 — IP 대역 차단)
//     Stooq : CSV 대신 <noscript> 봇 차단 페이지
//   반면 Twelve Data 는 이 저장소가 이미 키를 갖고 있고(refresh-stock-pages.yml 이 씁니다),
//   무료 플랜 하루 800회 중 여기서 쓰는 건 80회입니다. 그 800회 한도는 원래 "사용자가
//   버튼을 누를 때마다 호출"하는 경로를 걱정한 것이지, 하루 한 번 도는 배치가 아닙니다.
//   그래도 공짜는 아니라서, 워크플로우는 미국장 마감 뒤 실행에서만 이 스크립트를 돌립니다.
//   한국장 마감 시각(09:30 UTC)에 받아봐야 어차피 같은 전일 종가입니다.
//
//   무료 소스 둘은 폴백으로 남깁니다. 키가 없거나 만료된 환경에서는 그쪽이 살아날 수 있고,
//   로컬에서는 야후가 되는 경우가 있습니다.

const fs = require('fs');
const path = require('path');
const { fromYahoo, httpGet, epochDayFromYmd } = require('./generate-kr-data');
const { usSymbols, US_NAMES } = require('./sectors');
const { createUsageRecorder } = require('../lib/api-usage');

// 트웰브데이터 호출 장부. 방문자 조회(api/twelve-data/time-series.js)와 같은 테이블을 쓴다.
// 한도가 키 단위(일 800회)라, 여기서 쓴 몫이 장부에 안 남으면 화면의 잔량이 실제와 어긋난다.
const usage = createUsageRecorder('cron');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'us');

// 여기서 만드는 파일은 오직 generate-sector-rs.js 만 읽습니다. 그쪽이 쓰는 거래일 축은
// AXIS_ROWS = 520 행이므로, 그보다 긴 히스토리는 저장소만 불립니다.
// (한국 파일이 6000 행인 것은 MDD 계산기가 전 구간을 쓰기 때문입니다 — 여긴 아닙니다)
// 800 행이면 약 3년 2개월치로, 축 520 행에 넉넉한 여유를 둔 값입니다.
// 미국 종목이 210개를 넘어가면서 6000 행을 그대로 두면 매일 20MB 넘는 커밋이 쌓입니다.
const MAX_ROWS = 800;
const TAIL_ROWS = 520;  // 거래량은 최근분만. (generate-kr-data.js 와 같은 규칙)

const API_KEY = process.env.TWELVE_DATA_API_KEY || '';

// Twelve Data 무료 플랜의 outputsize 상한입니다. MAX_ROWS(6000)를 그대로 넘겼다가
// 22심볼이 전부 HTTP 400 을 받았습니다. api/twelve-data/time-series.js 도 5000 을 씁니다.
const TD_MAX_OUTPUTSIZE = 5000;

// Twelve Data 무료 플랜은 분당 8회입니다. 8.5초 간격이면 심볼 하나에 8.5초,
// 지금처럼 210심볼이면 약 30분 걸립니다(하루 800회 한도 중 210회).
// 종목을 늘리려면 이 시간이 그만큼 길어진다는 것을 먼저 계산하세요.
// 키가 없어 무료 소스로 떨어질 때는 KR 쪽과 같은 700ms 를 씁니다.
const DELAY_MS = API_KEY ? 8500 : 700;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 20000; // Node 의 fetch 에는 기본 타임아웃이 없습니다.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const round2 = v => Math.round(v * 100) / 100;

// ── 시세 소스 ────────────────────────────────────────────────────────

// 1) Twelve Data. 이 사이트가 미국 종목에 원래 쓰는 소스입니다.
//    values 는 최신 날짜가 앞이라 뒤집어야 합니다. 숫자는 전부 문자열로 옵니다.
async function fromTwelveData(symbol) {
  if (!API_KEY) throw new Error('TWELVE_DATA_API_KEY 없음');

  const url = new URL('https://api.twelvedata.com/time_series');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', '1day');
  url.searchParams.set('outputsize', String(Math.min(MAX_ROWS, TD_MAX_OUTPUTSIZE)));
  url.searchParams.set('apikey', API_KEY);

  // httpGet 을 쓰지 않고 직접 fetch 합니다. httpGet 은 !res.ok 면 "HTTP 400" 만 던지고
  // 본문을 버리는데, Twelve Data 는 무엇이 잘못됐는지를 그 본문에 담아 보냅니다.
  // 실제로 outputsize 상한을 넘겨 400 을 받았을 때 로그에 이유가 하나도 남지 않았습니다.
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`HTTP ${res.status} — JSON 아님`);
  }

  // 잘못된 요청은 HTTP 400 으로도, HTTP 200 + status:"error" 로도 옵니다. 둘 다 봐야
  // 합니다. 후자를 놓치면 빈 결과를 정상으로 착각해 멀쩡한 기존 파일을 덮어씁니다.
  if (!res.ok || json.status === 'error') {
    // 200 + status:"error" 도 트웰브데이터는 호출 한 건으로 셉니다. 장부에도 남깁니다.
    await usage.record(symbol, 'error', res.status);
    throw new Error(`HTTP ${res.status} ${json.code || ''} ${json.message || ''}`.trim());
  }
  if (!Array.isArray(json.values) || json.values.length === 0) {
    await usage.record(symbol, 'error', res.status);
    throw new Error('values 비어 있음');
  }
  await usage.record(symbol, 'success', res.status);

  const d = [], h = [], c = [], v = [];
  for (let i = json.values.length - 1; i >= 0; i--) { // 과거 → 최신으로 뒤집습니다
    const row = json.values[i];
    const close = Number(row.close);
    if (!Number.isFinite(close) || close <= 0) continue;
    const high = Number(row.high);
    d.push(epochDayFromYmd(String(row.datetime).slice(0, 10).replace(/-/g, '')));
    h.push(Math.max(round2(Number.isFinite(high) ? high : close), round2(close)));
    c.push(round2(close));
    const vol = Number(row.volume);
    v.push(Number.isFinite(vol) ? Math.round(vol) : 0);
  }
  if (d.length === 0) throw new Error('유효한 행 없음');

  return { source: 'twelvedata', currency: json.meta?.currency || 'USD', d, h, c, v };
}

// 2) Stooq 의 CSV 내보내기. 인증이 없고 전체 히스토리를 한 번에 줍니다.
//    심볼은 소문자 + ".us" 입니다. (SPY → spy.us)
//    응답 예:
//      Date,Open,High,Low,Close,Volume
//      1993-01-29,25.6314,25.6314,25.5028,25.5479,1003200
async function fromStooq(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&i=d`;
  const text = await (await httpGet(url)).text();

  // Stooq 는 한도를 넘기거나 심볼을 모를 때도 HTTP 200 에 안내문 한 줄을 담아 보냅니다
  // ("Exceeded the daily hits limit", "No data"). 헤더 줄이 없으면 데이터가 아닙니다.
  // 이걸 확인하지 않으면 빈 결과를 정상으로 착각해 기존 파일을 지우게 됩니다.
  if (!/^Date,Open,High,Low,Close,Volume/m.test(text)) {
    throw new Error(`CSV 헤더 없음 (응답 앞부분: ${text.replace(/\s+/g, ' ').slice(0, 120)})`);
  }

  const d = [], h = [], c = [], v = [];
  for (const line of text.split('\n')) {
    const cols = line.trim().split(',');
    if (cols.length < 5) continue;
    const [date, , high, , close, volume] = cols;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue; // 헤더·빈 줄
    const closeNum = Number(close);
    if (!Number.isFinite(closeNum) || closeNum <= 0) continue;
    const highNum = Number(high);
    d.push(epochDayFromYmd(date.replace(/-/g, '')));
    // 고가가 종가보다 낮게 들어오면 낙폭 계산이 어긋납니다. KR 쪽과 같은 보정.
    h.push(Math.max(round2(Number.isFinite(highNum) ? highNum : closeNum), round2(closeNum)));
    c.push(round2(closeNum));
    const vol = Number(volume);
    v.push(Number.isFinite(vol) ? Math.round(vol) : 0);
  }

  if (d.length === 0) throw new Error('유효한 행 없음');
  return { source: 'stooq', currency: 'USD', d, h, c, v };
}

// 3) 야후 파이낸스. generate-kr-data.js 의 것을 그대로 씁니다 (타임아웃·호스트 폴백 포함).
async function fromYahooUS(symbol) {
  const got = await fromYahoo({ code: symbol, market: 'US' });
  return { ...got, source: 'yahoo' };
}

const SOURCES = [fromTwelveData, fromStooq, fromYahooUS];

async function fetchOne(symbol) {
  const errors = [];
  for (const source of SOURCES) {
    try {
      return await source(symbol);
    } catch (err) {
      errors.push(`${source.name}: ${err.message}`);
    }
  }
  throw new Error(errors.join(' / '));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (!API_KEY) {
    console.warn('::warning::TWELVE_DATA_API_KEY 가 없어 무료 소스로만 시도합니다. '
      + 'GitHub Actions 러너에서는 무료 소스가 대부분 막히므로 미국 데이터가 비게 됩니다.');
  }

  const symbols = usSymbols();
  const ok = [];
  const failed = [];
  const bySource = {};

  for (const symbol of symbols) {
    try {
      const got = await fetchOne(symbol);
      bySource[got.source] = (bySource[got.source] || 0) + 1;
      const from = Math.max(0, got.d.length - MAX_ROWS);
      const tail = Math.max(0, got.d.length - TAIL_ROWS);

      const payload = {
        code: symbol,
        symbol,
        name: US_NAMES[symbol] || symbol,
        market: 'US',
        currency: got.currency || 'USD',
        updated: new Date(got.d[got.d.length - 1] * 86400000).toISOString().slice(0, 10),
        d: got.d.slice(from),
        h: got.h.slice(from),
        c: got.c.slice(from),
        // v[k] 는 d[d.length - v.length + k] 에 대응합니다. 외국인소진율(f)은 미국에 없습니다.
        v: got.v ? got.v.slice(tail) : [],
      };
      fs.writeFileSync(path.join(OUT_DIR, `${symbol}.json`), JSON.stringify(payload));
      ok.push(symbol);
      console.log(`✅ ${symbol} (${payload.name}) — ${payload.d.length}행, 최신 ${payload.updated} [${got.source}]`);
    } catch (err) {
      // 기존 파일을 건드리지 않으므로 그 심볼은 지난번 데이터로 계속 서빙됩니다.
      // 아직 한 번도 못 받은 심볼이면 그 종목만 섹터에서 빠집니다(generate-sector-rs.js).
      failed.push({ symbol, reason: err.message });
      console.warn(`⚠️  ${symbol} 실패: ${err.message} — 기존 파일 유지`);
    }
    await sleep(DELAY_MS);
  }

  const usable = symbols.filter(s => fs.existsSync(path.join(OUT_DIR, `${s}.json`)));

  if (usable.length > 0) {
    fs.writeFileSync(
      path.join(OUT_DIR, 'index.json'),
      JSON.stringify({
        updated: new Date().toISOString().slice(0, 10),
        count: usable.length,
        stocks: usable.map(s => ({ code: s, name: US_NAMES[s] || s, market: 'US' })),
      }, null, 2)
    );
  }

  console.log(`\n조회 성공 ${ok.length} / 실패 ${failed.length} / 서빙 가능 ${usable.length}심볼`);
  console.log('소스별 성공:', Object.entries(bySource).map(([k, n]) => `${k} ${n}`).join(', ') || '없음');

  // 여기서 절대 exit 1 하지 않습니다.
  //
  // 처음에는 "한 심볼도 못 받으면 실패"로 두었는데, 그 때문에 야후가 러너를 막은 날
  // 이 스텝이 잡을 죽였고 — 바로 앞 단계에서 성공한 한국 101종목이 커밋되지 못했습니다.
  // 미국 데이터는 이 사이트의 부가 기능입니다. 못 받으면 미국 탭이 지난 데이터를 보여주거나
  // 아예 안 뜰 뿐, 한국 쪽 갱신을 막을 이유가 없습니다.
  if (usable.length === 0) {
    console.warn('::warning::미국 심볼을 하나도 받지 못했습니다. 미국 탭은 표시되지 않습니다.');
  }

  // 버퍼에 남은 기록을 마저 보냅니다. 실패해도 예외를 던지지 않습니다(장부는 부가 기능).
  await usage.flush();
}

if (require.main === module) {
  main().catch(async err => {
    // 예기치 못한 예외도 마찬가지입니다. 로그만 남기고 후속 스텝을 살립니다.
    console.warn('::warning::미국 데이터 생성 실패:', err.message);
    // 도중에 죽더라도 이미 써버린 호출은 장부에 남겨야 합니다.
    await usage.flush();
  });
}

module.exports = { fromStooq, fromTwelveData, fetchOne };
