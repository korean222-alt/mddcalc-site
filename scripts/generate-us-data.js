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

// 섹터 계산에는 안 들어가지만 정적 파일은 있어야 하는 심볼들.
//
// 프론트엔드는 미국 종목 조회가 실패하면 data/us/{심볼}.json 으로 떨어집니다
// (index.html·assets/site.js 의 fetchUsStaticSeries). 그 폴백이 의미가 있으려면
// "사이트가 조회된다고 약속한 종목"에 파일이 있어야 합니다.
//
// 아래는 홈 바로가기 칩과 /stock/ 리포트가 가리키는데 usSymbols() 에는 없는 것들입니다.
// 레버리지·지수 ETF 라 섹터 바구니(sectors.js)에 넣으면 섹터 RS·히트맵 숫자가 오염되므로
// 여기서 따로 받습니다. generate-sector-rs.js 는 디렉터리가 아니라 usSymbols() 를 순회하므로
// 이 파일들이 늘어도 섹터 계산에는 영향이 없습니다.
const FALLBACK_ONLY_SYMBOLS = ['QQQ', 'VOO', 'VTI', 'SCHD', 'JEPQ', 'TQQQ', 'SOXL', 'SOXX'];

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'us');

// 이번 실행이 Twelve Data 를 몇 번 썼는지 남기는 파일입니다. scripts/check-api-usage.js
// 가 이 파일을 읽어 검사하고, 워크플로우 요약에도 같은 값을 출력합니다.
//
// 왜 파일로 남기는가:
//   Twelve Data 대시보드의 사용량 카운터는 UTC 자정에 0 으로 리셋됩니다. 이 저장소의
//   미국 수집은 22:30 UTC(한국 07:30)에 도는데, 대시보드를 한국 시간 낮에 열면 그때는
//   이미 UTC 날짜가 넘어간 뒤라 "오늘 0회"로 보입니다. 실제로 쓰고 있는데도 안 쓴 것처럼
//   보이는 것입니다. 이 파일은 리셋되지 않으므로 언제 열어도 지난 실행의 실제 호출 수가
//   남아 있습니다.
const USAGE_FILE = path.join(ROOT, 'data', 'api-usage.json');

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

// 실제로 Twelve Data 로 나간 요청 수입니다. 심볼 수(usSymbols().length)와 같을 것 같지만
// 같다고 가정하면 안 됩니다 — 키가 없으면 한 번도 안 나가고, 폴백을 타면 심볼 수보다 적을
// 수 있습니다. 세어서 남겨야 "이 실행이 API 를 진짜 썼는가"를 나중에 확인할 수 있습니다.
let twelveDataCalls = 0;
const getTwelveDataCalls = () => twelveDataCalls;
const resetTwelveDataCalls = () => { twelveDataCalls = 0; };

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
  //
  // 세는 위치가 fetch 바로 앞인 것이 중요합니다. 함수 첫 줄에서 세면 키가 없어 곧바로
  // 던지는 경우까지 "호출했다"로 잡히고, 성공한 뒤에 세면 실패한 요청이 빠집니다.
  // Twelve Data 는 실패한 요청도 크레딧을 씁니다.
  twelveDataCalls++;
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
    throw new Error(`HTTP ${res.status} ${json.code || ''} ${json.message || ''}`.trim());
  }
  if (!Array.isArray(json.values) || json.values.length === 0) throw new Error('values 비어 있음');

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

// Twelve Data 가 따로 두는 "현재 사용량" 엔드포인트입니다. 수집 전후로 한 번씩 물어보면
// 이번 실행이 실제로 몇 크레딧을 썼는지가 남의 대시보드가 아니라 우리 로그에 남습니다.
// (문서상 이 엔드포인트 자체는 크레딧을 쓰지 않습니다. 쓰더라도 실행당 2회입니다)
//
// 응답 필드는 플랜에 따라 이름이 다릅니다. 예전 응답은 current_usage/plan_limit 만 주고,
// 요즘은 daily_usage/plan_daily_limit 가 함께 옵니다. 둘 다 받습니다.
// 실패해도 수집은 그대로 진행합니다 — 사용량 확인은 부가 정보이고, 이것 때문에 209심볼
// 수집을 멈출 이유가 없습니다.
async function fetchApiUsage() {
  if (!API_KEY) return null;
  try {
    const url = new URL('https://api.twelvedata.com/api_usage');
    url.searchParams.set('apikey', API_KEY);
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') return null;

    const used = Number(json.daily_usage ?? json.current_usage);
    const limit = Number(json.plan_daily_limit ?? json.plan_limit);
    if (!Number.isFinite(used)) return null;
    return { used, limit: Number.isFinite(limit) ? limit : null };
  } catch {
    return null;
  }
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

// 한국 시간 표기. 이 기록을 읽는 사람은 UTC 로 살지 않습니다. 22:30 UTC 실행이
// 한국 07:30 이라는 걸 매번 암산하게 두면 "어제 것인가 오늘 것인가"를 착각합니다.
function kstStamp(date) {
  return new Date(date.getTime() + 9 * 3600 * 1000)
    .toISOString().replace('T', ' ').slice(0, 16) + ' KST';
}

// data/api-usage.json 의 내용을 만듭니다. 파일 쓰기와 나눠 둔 것은 테스트가 진짜
// 데이터 파일을 덮어쓰지 않고 이 계산만 검사할 수 있게 하기 위해서입니다.
function buildUsageRecord({ symbols, ok, failed, usable, bySource, usageBefore, usageAfter, calls, now = new Date() }) {

  // 사용량 카운터는 UTC 자정에 리셋됩니다. 실행이 자정을 걸치면 나중 값이 더 작아지는데,
  // 그건 "안 썼다"가 아니라 "카운터가 돌았다"입니다. 이걸 구분하지 않으면 검사 스크립트가
  // 멀쩡한 실행을 실패로 부릅니다.
  let usage = { measured: false, reason: usageBefore || usageAfter ? 'api_usage 조회 실패' : 'API 키 없음 또는 조회 실패' };
  if (usageBefore && usageAfter) {
    const delta = usageAfter.used - usageBefore.used;
    usage = delta >= 0
      ? { measured: true, before: usageBefore.used, after: usageAfter.used, delta, limit: usageAfter.limit }
      : { measured: false, reason: 'UTC 자정 리셋이 실행 중에 있었습니다',
          before: usageBefore.used, after: usageAfter.used, limit: usageAfter.limit };
  }

  const record = {
    provider: 'twelvedata',
    generatedAt: now.toISOString(),
    generatedAtKST: kstStamp(now),
    // 이 파일을 만든 것이 무엇이고, 그 결과를 누가 쓰는지. RS·히트맵이 읽는
    // data/sectors.json 은 여기서 만든 data/us/*.json 으로 계산됩니다.
    producedBy: 'scripts/generate-us-data.js',
    consumedBy: ['data/us/*.json', 'data/sectors.json (섹터 RS·히트맵)'],
    symbols: symbols.length,
    calls: calls === undefined ? getTwelveDataCalls() : calls,
    ok: ok.length,
    failed: failed.length,
    usable: usable.length,
    sources: bySource,
    usage,
    // 실패 사유는 앞부분만 남깁니다. 전문을 넣으면 매일 커밋되는 파일이 로그가 됩니다.
    failures: failed.slice(0, 20).map(f => ({ symbol: f.symbol, reason: String(f.reason).slice(0, 200) })),
  };

  return record;
}

function writeUsageRecord(args) {
  const record = buildUsageRecord(args);
  fs.writeFileSync(USAGE_FILE, JSON.stringify(record, null, 2));
  console.log(`✅ data/api-usage.json — Twelve Data 호출 ${record.calls}회`
    + (record.usage.measured
      ? ` (사용량 ${record.usage.before}→${record.usage.after}${record.usage.limit ? '/' + record.usage.limit : ''})`
      : ''));
  return record;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (!API_KEY) {
    console.warn('::warning::TWELVE_DATA_API_KEY 가 없어 무료 소스로만 시도합니다. '
      + 'GitHub Actions 러너에서는 무료 소스가 대부분 막히므로 미국 데이터가 비게 됩니다.');
  }

  const symbols = [...usSymbols(), ...FALLBACK_ONLY_SYMBOLS];
  const ok = [];
  const failed = [];
  const bySource = {};

  // 수집 전 사용량. 뒤의 값과 비교해야 "이번 실행분"을 분리할 수 있습니다.
  // 절대값만 보면 다른 경로(사용자 조회 프록시)가 쓴 것과 섞입니다.
  const usageBefore = await fetchApiUsage();
  if (usageBefore) {
    console.log(`   Twelve Data 사용량(수집 전): ${usageBefore.used}`
      + (usageBefore.limit ? ` / ${usageBefore.limit}` : '') + '회');
  } else if (API_KEY) {
    console.log('   Twelve Data 사용량 조회 실패 — 수집은 그대로 진행합니다');
  }

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
        // 어느 소스에서 받은 값인지. 이게 없으면 파일만 봐서는 Twelve Data 로 받은 건지
        // 폴백(Stooq·야후)으로 받은 건지 구분할 방법이 없습니다.
        source: got.source,
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
        sources: bySource,
        stocks: usable.map(s => ({ code: s, name: US_NAMES[s] || s, market: 'US' })),
      }, null, 2)
    );
  }

  console.log(`\n조회 성공 ${ok.length} / 실패 ${failed.length} / 서빙 가능 ${usable.length}심볼`);
  console.log('소스별 성공:', Object.entries(bySource).map(([k, n]) => `${k} ${n}`).join(', ') || '없음');

  const usageAfter = await fetchApiUsage();
  if (usageAfter) {
    const delta = usageBefore ? usageAfter.used - usageBefore.used : null;
    console.log(`Twelve Data 사용량(수집 후): ${usageAfter.used}`
      + (usageAfter.limit ? ` / ${usageAfter.limit}` : '') + '회'
      + (delta === null ? '' : ` — 이번 실행에서 ${delta}회 늘었습니다`));
  }

  writeUsageRecord({ symbols, ok, failed, usable, bySource, usageBefore, usageAfter });

  // 여기서 절대 exit 1 하지 않습니다.
  //
  // 처음에는 "한 심볼도 못 받으면 실패"로 두었는데, 그 때문에 야후가 러너를 막은 날
  // 이 스텝이 잡을 죽였고 — 바로 앞 단계에서 성공한 한국 101종목이 커밋되지 못했습니다.
  // 미국 데이터는 이 사이트의 부가 기능입니다. 못 받으면 미국 탭이 지난 데이터를 보여주거나
  // 아예 안 뜰 뿐, 한국 쪽 갱신을 막을 이유가 없습니다.
  if (usable.length === 0) {
    console.warn('::warning::미국 심볼을 하나도 받지 못했습니다. 미국 탭은 표시되지 않습니다.');
  }
}

if (require.main === module) {
  main().catch(err => {
    // 예기치 못한 예외도 마찬가지입니다. 로그만 남기고 후속 스텝을 살립니다.
    console.warn('::warning::미국 데이터 생성 실패:', err.message);
  });
}

module.exports = {
  fromStooq, fromTwelveData, fetchOne, fetchApiUsage,
  getTwelveDataCalls, resetTwelveDataCalls, buildUsageRecord, writeUsageRecord, kstStamp,
};
