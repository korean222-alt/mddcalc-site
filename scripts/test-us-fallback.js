#!/usr/bin/env node
// 미국 종목 정적 폴백 테스트.   실행: node scripts/test-us-fallback.js
//
// 이 파일이 있는 이유:
//   loadData() 는 시세 조회가 실패하면 #result 를 hidden 으로 둔 채 끝납니다. 즉 라이브
//   API 가 한 번 실패하면 계산기 페이지에 검색창과 에러 문구만 남고, 계산기가 본체인
//   사이트에서 그 화면에는 볼 것이 하나도 없습니다.
//
//   Twelve Data 무료 플랜은 분당 8회인데 주간 배치(generate-us-data.js)가 217종목을
//   8.5초 간격으로 받는 약 30분 동안 그 한도를 씁니다. 키 만료·API 장애·환경변수 누락도
//   같은 화면으로 끝납니다. 그래서 실패하면 커밋된 정적 파일로 떨어지게 해 두었습니다.
//
//   폴백 경로는 평소에 안 타므로 조용히 망가지기 쉽습니다. 여기서 잡습니다.
//   fetchPriceSeries 는 index.html 과 assets/site.js 에 같은 코드가 두 벌 있으므로
//   둘 다 검사합니다 (test-nav-links.js 와 같은 이유).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`✅ ${label}`); }
  catch (err) { console.error(`❌ ${label}\n   ${err.message}`); failed++; }
};

// 검사 대상 파일에서 폴백에 필요한 함수 둘만 떼어내 실행합니다.
// 파일 전체는 DOM 에 기대는 코드가 많아 그대로는 못 돌립니다.
function loadFns(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const grab = (name) => {
    const m = src.match(new RegExp(`\\nasync function ${name}\\([\\s\\S]*?\\n\\}\\n`));
    assert.ok(m, `${file} 에서 ${name} 을 찾지 못했습니다`);
    return m[0];
  };
  const ctx = {
    PRICE_CACHE: {},
    PRICE_CACHE_TTL_MS: 0,
    resolveSymbol: (t) => ({ symbol: t, code: t, isKR: false }), // 미국 경로만 검사합니다
    fetch: null,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(grab('fetchUsStaticSeries') + grab('fetchPriceSeries'), ctx);
  return ctx;
}

// 실제 커밋된 파일을 읽어 응답을 흉내 냅니다 (픽스처를 손으로 지어내지 않습니다 —
// generate-kr-data.js 파서가 지어낸 픽스처 때문에 두 번 잘못 고쳐진 전례가 있습니다).
function makeFetch({ apiStatus, apiBody }) {
  return async (url) => {
    if (String(url).includes('/api/twelve-data/time-series')) {
      return { ok: apiStatus === 200, status: apiStatus, json: async () => apiBody };
    }
    const m = String(url).match(/\/data\/us\/(.+)\.json$/);
    const p = path.join(ROOT, 'data', 'us', `${decodeURIComponent(m[1])}.json`);
    if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
  };
}

const RATE_LIMITED = { apiStatus: 429, apiBody: { message: '한도 초과' } };

async function main() {
  for (const file of ['index.html', 'assets/site.js']) {
    await check(`${file}: 분당 한도(429)에 걸리면 정적 데이터로 떨어진다`, async () => {
      const ctx = loadFns(file);
      ctx.fetch = makeFetch(RATE_LIMITED);
      const r = await vm.runInContext('fetchPriceSeries("SPY", 5000)', ctx);
      assert.strictEqual(r.fallback, true, 'fallback 플래그가 서 있어야 합니다');
      assert.ok(r.values.length > 100, `행이 너무 적습니다 (${r.values.length})`);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.values[0].datetime), '날짜 형식이 다릅니다');
      // 최신순으로 돌려줘야 기존 계산 코드가 그대로 동작합니다.
      assert.ok(r.values[0].datetime > r.values[1].datetime, '최신 날짜가 앞에 와야 합니다');
      assert.ok(r.values[0].high >= r.values[0].close, '고가가 종가보다 낮습니다');
    });

    await check(`${file}: 요청한 개수보다 많이 돌려주지 않는다`, async () => {
      const ctx = loadFns(file);
      ctx.fetch = makeFetch(RATE_LIMITED);
      const r = await vm.runInContext('fetchPriceSeries("SPY", 50)', ctx);
      assert.strictEqual(r.values.length, 50, `50개를 요청했는데 ${r.values.length}개입니다`);
    });

    await check(`${file}: API 가 정상이면 폴백을 쓰지 않는다`, async () => {
      const ctx = loadFns(file);
      ctx.fetch = makeFetch({
        apiStatus: 200,
        apiBody: { values: [{ datetime: '2026-08-28', open: '1', high: '2', low: '1', close: '2' }] },
      });
      const r = await vm.runInContext('fetchPriceSeries("SPY", 5000)', ctx);
      assert.ok(!r.fallback, '정상 응답인데 폴백을 탔습니다');
      assert.strictEqual(r.values.length, 1);
    });

    await check(`${file}: 정적 파일도 없는 종목은 원래 오류를 그대로 올린다`, async () => {
      const ctx = loadFns(file);
      ctx.fetch = makeFetch(RATE_LIMITED);
      let caught = null;
      try { await vm.runInContext('fetchPriceSeries("ZZZZ", 5000)', ctx); }
      catch (err) { caught = err; }
      assert.ok(caught, '오류가 나야 하는데 성공했습니다');
      assert.strictEqual(caught.rateLimited429, true, '원래의 429 오류가 보존돼야 합니다');
    });
  }

  // 사이트가 "조회된다"고 안내하는 종목은 생성기가 반드시 받으러 가야 합니다.
  // 파일 존재가 아니라 설정을 검사하는 이유: 파일은 워크플로가 API 키로 돌아야 생기므로
  // 새 종목을 추가한 직후에는 아직 없는 게 정상입니다. 반면 "리포트는 만들어 놓고
  // 수집 목록에는 안 넣은" 상태는 언제나 버그입니다.
  await check('종목 리포트가 있는 미국 종목은 전부 수집 목록에 있다', () => {
    const { usSymbols } = require('./sectors');
    const genSrc = fs.readFileSync(path.join(__dirname, 'generate-us-data.js'), 'utf8');
    const m = genSrc.match(/const FALLBACK_ONLY_SYMBOLS = \[([^\]]*)\]/);
    assert.ok(m, 'generate-us-data.js 에서 FALLBACK_ONLY_SYMBOLS 를 찾지 못했습니다');
    const extra = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
    const collected = new Set([...usSymbols(), ...extra]);

    const promised = fs.readdirSync(path.join(ROOT, 'stock'))
      .filter(f => f.endsWith('.html'))
      .map(f => path.basename(f, '.html').toUpperCase());
    const missing = promised.filter(t => !collected.has(t));
    assert.deepStrictEqual(missing, [], `수집 목록에 없는 종목: ${missing.join(', ')}`);

    const noFile = promised.filter(t => !fs.existsSync(path.join(ROOT, 'data', 'us', `${t}.json`)));
    if (noFile.length) {
      console.log(`   ℹ️  아직 예비 데이터 파일이 없는 종목 ${noFile.length}개: ${noFile.join(', ')}`);
      console.log('      (다음 Refresh Korean stock data 실행에서 생성됩니다)');
    }
  });

  console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
  process.exit(failed ? 1 : 0);
}

main();
