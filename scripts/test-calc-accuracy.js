#!/usr/bin/env node
/**
 * 계산 정확성 회귀 테스트.
 *
 * 감사에서 나온 P1 오류들이 다시 들어오지 못하게 막는다. 여기서 검사하는 값들은
 * 전부 "검산 가능한 산수"라서, 틀리면 사이트가 내세우는 신뢰성이 바로 깨진다.
 *
 * 실행: node scripts/test-calc-accuracy.js   (네트워크·API 키 불필요)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let failed = 0;
function ok(cond, label, detail) {
  if (cond) { console.log(`✅ ${label}`); return; }
  failed++;
  console.log(`❌ ${label}${detail ? `\n   ${detail}` : ''}`);
}

// ── 1. 회복 기간 중앙값: 표본이 짝수면 가운데 두 값의 평균이어야 한다 ──────────
// 예전에는 recDays[Math.floor(n/2)] 로 위쪽 값 하나만 썼다. [10, 30] 이면
// 중앙값 20일 대신 30일이 나와서 회복이 실제보다 느려 보였다.
{
  const src = read('scripts/generate-stock-pages.js');
  ok(!/medianDays:\s*recDays\[Math\.floor\(recDays\.length \/ 2\)\]/.test(src),
     '리포트 중앙값이 "위쪽 값 하나"로 계산되지 않는다');

  const m = src.match(/function median\(sortedNums\) \{[\s\S]*?\n\}/);
  ok(!!m, '중앙값 헬퍼 함수가 있다');
  if (m) {
    const median = eval(`(${m[0].replace('function median', 'function')})`);
    ok(median([10, 30]) === 20, '짝수 표본 [10,30] 의 중앙값은 20일', `받은 값: ${median([10, 30])}`);
    ok(median([5, 10, 30, 100]) === 20, '짝수 표본 [5,10,30,100] 의 중앙값은 20일', `받은 값: ${median([5, 10, 30, 100])}`);
    ok(median([10, 20, 30]) === 20, '홀수 표본 [10,20,30] 의 중앙값은 20일', `받은 값: ${median([10, 20, 30])}`);
    ok(median([]) === null, '표본이 없으면 null');
  }
}

// ── 2. 분할매수: 예산은 평균단가를 바꾸지 못한다 ────────────────────────────
// 회차별 금액이 (가중치 ÷ 가중치합) × 예산이라, 예산을 늘리면 매수금액과 주수가
// 같은 비율로 커져서 평균단가(총매수금액 ÷ 총주수)는 그대로다.
// 그런데도 "예산을 늘려보세요"라고 안내하면 실행 불가능한 조언이 된다.
{
  function avgPrice(budget, price, rounds, strategy) {
    const pp = Array.from({ length: rounds }, (_, i) => {
      const t = i / Math.max(rounds - 1, 1);
      return Math.max(price * (1 - 0.10 * Math.sin(Math.PI * t)), 1);
    });
    const w = pp.map((p, i) => strategy === 'staircase' ? price / p : strategy === 'backloaded' ? i + 1 : 1);
    const tw = w.reduce((a, b) => a + b, 0);
    let shares = 0, cost = 0;
    for (let i = 0; i < rounds; i++) { const amt = w[i] / tw * budget; shares += amt / pp[i]; cost += amt; }
    return cost / shares;
  }
  const a = avgPrice(10000, 200, 5, 'staircase');
  const b = avgPrice(20000, 200, 5, 'staircase');
  ok(Math.abs(a - b) < 1e-9,
     '예산을 2배로 늘려도 평균단가는 그대로다 (모델의 성질)',
     `$${a.toFixed(2)} vs $${b.toFixed(2)}`);

  for (const [file, label] of [['assets/site.js', 'assets/site.js'], ['index.html', 'index.html']]) {
    const src = read(file);
    ok(!src.includes('매수 횟수를 늘리거나 예산을 늘려보세요'),
       `${label}: 예산 증액을 권하는 안내문이 없다`);
  }
  ok(!read('dca-planner.html').includes('예산을 늘려 재계산해보세요'),
     'dca-planner.html: 예산 증액을 권하는 도움말이 없다');
}

// ── 3. 홈 해석: "낙폭이 가장 깊다" 와 "가격이 가장 낮다" 는 다른 말이다 ────────
// 종가가 100 → 200 → 140 이면 현재 낙폭 -30% 가 기간 중 가장 깊지만,
// 현재가 140 은 기간 최저가 100 보다 높다.
{
  const closes = [100, 200, 140];
  let mx = -Infinity;
  const dd = closes.map(c => { mx = Math.max(mx, c); return (c / mx - 1) * 100; });
  const cur = dd[dd.length - 1];
  const deeperDays = dd.filter(v => v < cur).length;
  const minClose = Math.min(...closes);
  ok(deeperDays === 0 && minClose < closes[closes.length - 1],
     '반례 확인: 현재 낙폭이 최대여도 현재가가 기간 최저가는 아니다',
     `현재 낙폭 ${cur.toFixed(1)}%, 현재가 ${closes[2]}, 기간 최저 ${minClose}`);

  ok(!read('index.html').includes('현재가 이 기간의 최저점입니다.'),
     'index.html: "현재가가 기간 최저점" 이라는 문장이 없다');
}

// ── 4. 배당 재투자 글의 숫자가 실제 계산기 모델과 일치한다 ──────────────────
// 블로그가 계산기와 다른 값을 주장하면, 독자가 계산기로 확인하는 순간 어긋난다.
{
  function drip(price, annual, growth, years) {
    let shares = 1, cur = price;
    const pg = growth / 100, dg = growth > 0 ? growth / 100 * 0.5 : 0;
    for (let y = 1; y <= years; y++) {
      const received = shares * annual * Math.pow(1 + dg, y - 1);
      cur = price * Math.pow(1 + pg, y);
      shares += received / cur;
    }
    return { sharesGrowth: (shares - 1) * 100, totalReturn: (shares * cur - price) / price * 100 };
  }
  const post = read('scripts/posts-data.js');
  for (const [years, growth, ret] of [[10, '40.1', '128.1'], [20, '82.7', '384.7'], [30, '125.2', '873.4']]) {
    const r = drip(100, 4, 5, years);
    ok(r.sharesGrowth.toFixed(1) === growth && r.totalReturn.toFixed(1) === ret,
       `${years}년 DRIP 모델이 주수 +${growth}% / 총수익 ${ret}% 를 낸다`,
       `계산: +${r.sharesGrowth.toFixed(1)}% / ${r.totalReturn.toFixed(1)}%`);
    ok(post.includes(`${growth}%`) && post.includes(`${ret}%`),
       `블로그 6번이 ${years}년 값으로 ${growth}% / ${ret}% 를 쓴다`);
  }
  ok(!post.includes('총 투자 수익률은 163%'), '블로그 6번에 옛 163% 주장이 없다');
}

// ── 5. 레버리지 글: +10% 뒤 -10% 는 원금이 아니다 ──────────────────────────
{
  ok((100 * 1.1 * 0.9).toFixed(2) === '99.00', '100 → 110 → 99 (-1%)');
  ok((100 * 1.2 * 0.8).toFixed(2) === '96.00', '2배: 100 → 120 → 96 (-4%)');
  ok((100 * 1.3 * 0.7).toFixed(2) === '91.00', '3배: 100 → 130 → 91 (-9%)');
  const post = read('scripts/posts-data.js');
  ok(!post.includes('기초 지수가 첫날 10% 상승하고 다음 날 10% 하락하면 원금으로 돌아오지만'),
     '블로그 16번에 "원금으로 돌아온다" 는 서술이 없다');
  ok(post.includes('100 → 110 → 99'), '블로그 16번이 올바른 수치를 쓴다');
}

// ── 6. 테슬라 글: 분할 전 가격과 분할 후 가격을 섞어 비교하지 않는다 ──────────
// $1,243(분할 전 장중 고점)과 $101(분할 후 장중 저점)을 그대로 빼면 -91.9% 가 되어
// 글이 주장하는 -75% 와 맞지 않는다. 같은 수정주가 기준으로 통일해야 한다.
{
  const post = read('scripts/posts-data.js');
  ok(!post.includes('최고점인 $1,243에서'), '블로그 2번이 분할 전 $1,243 을 낙폭 계산에 쓰지 않는다');
  ok(post.includes('$414.50') && post.includes('$101.81'),
     '블로그 2번이 수정주가 기준 고점·저점을 함께 쓴다');
  const intraday = (101.81 - 414.50) / 414.50 * 100;
  const close = (108.10 - 409.97) / 409.97 * 100;
  ok(intraday.toFixed(1) === '-75.4', '장중 기준 -75.4% 가 맞다', `계산: ${intraday.toFixed(2)}%`);
  ok(close.toFixed(1) === '-73.6', '종가 기준 -73.6% 가 맞다', `계산: ${close.toFixed(2)}%`);
}

console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);
