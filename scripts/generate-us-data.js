#!/usr/bin/env node
// 미국 섹터 ETF·종목 일봉을 미리 만들어 정적 파일로 저장합니다.
//
//   node scripts/generate-us-data.js
//
// 왜 별도 파이프라인인가:
//   미국 종목은 이미 /api/twelve-data/time-series 로 조회할 수 있지만, 그쪽은 하루 800회
//   한도를 MySQL 로 세는 유료 API 프록시입니다. 섹터 화면은 한 번 열 때 20개 넘는 심볼이
//   필요하므로, 그 경로로 보내면 페이지뷰 40번이면 하루 한도가 끝납니다.
//   그래서 한국 데이터와 똑같이 "빌드 시점에 받아 정적 파일로 커밋" 방식을 씁니다.
//
// 수집기는 generate-kr-data.js 의 fromYahoo 를 그대로 가져다 씁니다. 재구현하지 않습니다.
// 타임아웃·재시도·호스트 폴백이 이미 그 안에 들어 있습니다.

const fs = require('fs');
const path = require('path');
const { fromYahoo } = require('./generate-kr-data');
const { usSymbols, US_NAMES } = require('./sectors');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'us');

const DELAY_MS = 700;   // 야후는 한꺼번에 쏘면 429 를 줍니다. KR 쪽과 같은 간격.
const MAX_ROWS = 6000;
const TAIL_ROWS = 520;  // 거래량은 최근분만. (generate-kr-data.js 와 같은 규칙)

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const symbols = usSymbols();
  const ok = [];
  const failed = [];

  for (const symbol of symbols) {
    const t = { code: symbol, market: 'US' };
    try {
      const got = await fromYahoo(t);
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
      console.log(`✅ ${symbol} (${payload.name}) — ${payload.d.length}행, 최신 ${payload.updated}`);
    } catch (err) {
      // 한 심볼이 실패해도 나머지는 계속합니다. 기존 파일을 건드리지 않으므로
      // 그 심볼은 지난번 데이터로 계속 서빙됩니다. (KR 쪽과 같은 정책)
      failed.push({ symbol, reason: err.message });
      console.warn(`⚠️  ${symbol} 실패: ${err.message} — 기존 파일 유지`);
    }
    await sleep(DELAY_MS);
  }

  const usable = symbols.filter(s => fs.existsSync(path.join(OUT_DIR, `${s}.json`)));

  fs.writeFileSync(
    path.join(OUT_DIR, 'index.json'),
    JSON.stringify({
      updated: new Date().toISOString().slice(0, 10),
      count: usable.length,
      stocks: usable.map(s => ({ code: s, name: US_NAMES[s] || s, market: 'US' })),
    }, null, 2)
  );

  console.log(`\n조회 성공 ${ok.length} / 실패 ${failed.length} / 서빙 가능 ${usable.length}심볼`);

  if (usable.length === 0) {
    console.error('::error::단 한 심볼도 만들지 못했습니다. 야후가 막혔을 수 있습니다.');
    process.exit(1);
  }
  // 일부 실패는 정상 종료입니다. 여기서 죽이면 나머지 성공분까지 커밋되지 않습니다.
}

if (require.main === module) {
  main().catch(err => {
    console.error('생성 실패:', err);
    process.exit(1);
  });
}
