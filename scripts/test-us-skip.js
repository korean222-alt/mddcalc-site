// generate-us-data.js 가 "이미 최신인 심볼"을 건너뛰는지 확인한다.
//
// 이 워크플로우는 평일마다 돌지만 미국 증시는 연 9~10일 휴장한다. 그날도 209심볼을
// 전부 다시 받으면 어제와 똑같은 종가를 받으면서 하루 크레딧의 26% 를 버린다.
// 수동 재실행도 마찬가지다. 기준 심볼(SPY) 하나로 "가장 최근 거래일"을 알아낸 뒤,
// 그 날짜가 이미 들어 있는 파일은 부르지 않는다.

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..');

let failures = 0;
function check(label, cond, extra) {
  if (cond) {
    console.log('✅ ' + label);
  } else {
    failures++;
    console.log('❌ ' + label + (extra ? ' — ' + extra : ''));
  }
}

const DAY = 86400000;
function epochDay(ymd) { return Math.round(new Date(ymd + 'T00:00:00Z').getTime() / DAY); }

// 심볼 하나를 흉내 낸 응답. 마지막 날짜가 lastDate 다.
function series(lastDate, rows = 5) {
  const end = epochDay(lastDate);
  const d = [], h = [], c = [], v = [];
  for (let i = rows - 1; i >= 0; i--) { d.push(end - i); h.push(101); c.push(100); v.push(1000); }
  return { source: 'twelvedata', currency: 'USD', d, h, c, v };
}

// 실제 스크립트를 그대로 돌리되, 네트워크만 가짜로 바꾼다.
// 심볼 목록도 테스트용 3개로 줄인다.
function loadScript(outDir, symbols, lastDate, calls) {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(path.join(REPO, 'scripts'))) delete require.cache[k];
  }

  const sectors = require(path.join(REPO, 'scripts', 'sectors.js'));
  sectors.usSymbols = () => symbols.slice();

  const mod = require(path.join(REPO, 'scripts', 'generate-us-data.js'));
  // fetchOne 은 모듈 내부에서 직접 부르므로, 그 아래의 fetch 를 가로챈다.
  return { mod, sectors };
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'us-skip-'));
  const outDir = path.join(tmp, 'data', 'us');
  fs.mkdirSync(outDir, { recursive: true });

  const symbols = ['SPY', 'AAPL', 'MSFT'];
  const lastDate = '2026-08-24';

  // 스크립트가 쓰는 것과 같은 저장 형식으로 "이미 최신" 파일 두 개를 깔아 둔다.
  for (const sym of ['SPY', 'AAPL', 'MSFT']) {
    const s = series(lastDate);
    fs.writeFileSync(path.join(outDir, `${sym}.json`),
      JSON.stringify({ code: sym, symbol: sym, market: 'US', currency: 'USD', updated: lastDate, d: s.d, h: s.h, c: s.c, v: s.v }));
  }

  // 네트워크를 가로채고, 어떤 심볼이 실제로 호출됐는지 센다.
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const sym = new URL(String(url)).searchParams.get('symbol');
    calls.push(sym);
    const s = series(lastDate);
    const values = [];
    for (let i = s.d.length - 1; i >= 0; i--) {
      values.push({
        datetime: new Date(s.d[i] * DAY).toISOString().slice(0, 10),
        high: String(s.h[i]), close: String(s.c[i]), volume: String(s.v[i]),
      });
    }
    return { ok: true, status: 200, json: async () => ({ meta: { currency: 'USD' }, values }) };
  };

  process.env.TWELVE_DATA_API_KEY = 'test-key';
  delete process.env.DATABASE_URL; // 장부 기록은 이 테스트의 관심사가 아니다

  // 실제 스크립트를 소스에서 읽어, 상수 두 개(출력 경로·대기 시간)와 심볼 목록만 갈아끼워 돌린다.
  // 파일을 통째로 흉내 내면 정작 검증하려는 로직이 테스트본과 갈라지므로 원본을 쓴다.
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'generate-us-data.js'), 'utf8')
    .replace(/const OUT_DIR = .*;/, `const OUT_DIR = ${JSON.stringify(outDir)};`)
    .replace(/const DELAY_MS = .*;/, 'const DELAY_MS = 0;')
    .replace(/const symbols = usSymbols\(\);/, `const symbols = ${JSON.stringify(symbols)};`)
    .replace(/if \(require\.main === module\)/, 'if (false)');

  const Module = require('module');
  const m = new Module(path.join(REPO, 'scripts', 'generate-us-data.test.js'));
  m.filename = path.join(REPO, 'scripts', 'generate-us-data.test.js');
  m.paths = Module._nodeModulePaths(path.join(REPO, 'scripts'));
  m._compile(src + '\nmodule.exports.__main = main;', m.filename);

  // 1) 전부 최신이면 기준 심볼 한 번만 부른다 (휴장일 · 수동 재실행)
  await m.exports.__main();
  check('전부 최신이면 API 를 1회만 쓴다 (예전엔 3회)', calls.length === 1, `호출 ${calls.length}회: ${calls.join(',')}`);
  check('그 1회는 기준 심볼(SPY)이다', calls[0] === 'SPY', calls[0]);

  // 2) 하루 밀려 있으면 평소대로 전부 받는다
  calls.length = 0;
  for (const sym of symbols) {
    const s = series('2026-08-21'); // 사흘 전까지만 있는 상태
    fs.writeFileSync(path.join(outDir, `${sym}.json`),
      JSON.stringify({ code: sym, symbol: sym, market: 'US', currency: 'USD', updated: '2026-08-21', d: s.d, h: s.h, c: s.c, v: s.v }));
  }
  await m.exports.__main();
  check('데이터가 밀려 있으면 전부 받는다 (아끼려다 갱신을 거르지 않는다)',
    calls.length === symbols.length, `호출 ${calls.length}회: ${calls.join(',')}`);

  // 3) 파일이 아예 없는 심볼은 건너뛰지 않는다
  calls.length = 0;
  fs.unlinkSync(path.join(outDir, 'MSFT.json'));
  for (const sym of ['SPY', 'AAPL']) {
    const s = series(lastDate);
    fs.writeFileSync(path.join(outDir, `${sym}.json`),
      JSON.stringify({ code: sym, symbol: sym, market: 'US', currency: 'USD', updated: lastDate, d: s.d, h: s.h, c: s.c, v: s.v }));
  }
  await m.exports.__main();
  check('파일이 없는 심볼은 반드시 받는다', calls.includes('MSFT'), calls.join(','));
  check('그 외 최신인 심볼은 여전히 건너뛴다', calls.length === 2, `호출 ${calls.length}회: ${calls.join(',')}`);

  global.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures === 0 ? '\n모두 통과' : '\n' + failures + '개 실패');
  process.exit(failures === 0 ? 0 : 1);
}

run();
