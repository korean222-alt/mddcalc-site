#!/usr/bin/env node
// 화면의 오늘 값을 HTML 안에 글자로 심습니다.
//
//   node scripts/write-page-summaries.js
//
// 왜 필요한가:
//   섹터 RS·히트맵·공포탐욕 세 화면은 본문이 전부 자바스크립트로 그려집니다. HTML 파일만
//   놓고 보면 "불러오는 중..." 말고는 숫자가 한 글자도 없습니다. 검색엔진은 자바스크립트를
//   실행해 보기도 하지만 그건 나중이고 불확실하며, 실행하지 않는 크롤러도 많습니다.
//   결과적으로 "오늘 코스피 공포탐욕지수" 같은 검색어에 걸릴 근거가 페이지에 없었습니다.
//   (index.html 의 한국 종목 목록을 실제 텍스트로 넣어 둔 것과 같은 이유입니다 —
//    scripts/generate-kr-data.js 의 syncSupportedList 주석 참고)
//
//   그래서 매 거래일 계산이 끝나면 그 결과를 문장과 표로 HTML 에 써 넣습니다. 부수 효과로
//   자바스크립트가 막혀도 오늘 숫자는 보이고, 페이지 내용이 매일 바뀌므로 크롤러가 다시
//   올 이유도 생깁니다.
//
// 심는 자리는 각 HTML 의 <!-- XXX_SUMMARY_START --> ~ <!-- XXX_SUMMARY_END --> 사이입니다.
// 마커가 없는 파일은 조용히 건너뜁니다.
//
// 네트워크를 쓰지 않습니다. data/*.json 만 읽습니다.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);
const num = v => (v == null ? '—' : String(v));

function readJson(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (err) { console.warn(`⚠️  ${rel} 을 읽지 못했습니다: ${err.message}`); return null; }
}

// 마커 사이를 갈아 끼웁니다. 내용이 같으면 파일을 건드리지 않습니다
// (건드리면 sitemap 의 lastmod 가 바뀌지도 않은 페이지를 바뀌었다고 알리게 됩니다).
function writeBlock(file, name, html) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return 0;
  const src = fs.readFileSync(p, 'utf8');
  const re = new RegExp(`<!-- ${name}_START[\\s\\S]*?<!-- ${name}_END -->`);
  if (!re.test(src)) {
    console.warn(`⚠️  ${file} 에 ${name} 마커가 없습니다 — 건너뜁니다`);
    return 0;
  }
  const block = `<!-- ${name}_START 이 블록은 scripts/write-page-summaries.js 가 자동으로 씁니다 -->\n`
    + html.trimEnd() + `\n    <!-- ${name}_END -->`;
  const next = src.replace(re, () => block);
  if (next === src) return 0;
  fs.writeFileSync(p, next);
  return 1;
}

// 요약 카드의 공통 껍데기. 화면에서 튀지 않게 다른 카드와 같은 모양을 씁니다.
function card(dateLabel, inner, note) {
  return `    <section class="card" style="background:#f7fafc;">
      <h2 class="section">📌 ${esc(dateLabel)} 기준 요약</h2>
      ${inner}
      <p style="font-size:11px; color:#a0aec0; margin-top:10px;">${note}</p>
    </section>`;
}

const AUTO_NOTE = '이 요약은 매 거래일 자동으로 갱신됩니다. 위 화면은 같은 데이터를 기간·시장을 바꿔가며 보여줍니다.';

// ── 공포·탐욕 지수 ────────────────────────────────────────────────────
function fearGreedSummary() {
  const fg = readJson('data/fear-greed.json');
  if (!fg || !fg.markets) return null;

  const parts = [];
  let latest = null;

  for (const m of Object.values(fg.markets)) {
    if (m.score == null) continue;
    if (!latest || m.updated > latest) latest = m.updated;

    const inScore = (m.components || []).filter(c => c.inScore !== false);
    const source = m.source === 'cnn'
      ? `<a href="${esc(m.sourceUrl || 'https://www.cnn.com/markets/fear-and-greed')}" target="_blank" rel="noopener nofollow">CNN Business</a> 공식 값으로`
      : 'CNN 과 같은 방식으로 계산해';

    const prev = [
      m.prev && m.prev.d1 != null ? `어제 ${m.prev.d1}` : null,
      m.prev && m.prev.w1 != null ? `1주 전 ${m.prev.w1}` : null,
      m.prev && m.prev.m1 != null ? `1개월 전 ${m.prev.m1}` : null,
    ].filter(Boolean).join(', ');

    parts.push(
      `      <p style="font-size:14px; color:#4a5568; line-height:1.9; margin-bottom:10px;">`
      + `${esc(m.flag)} <b>${esc(m.label)}</b> 공포·탐욕 지수는 ${source} <b>${m.score}점 — ${esc(m.bandLabel)}</b> 구간입니다`
      + (prev ? ` (${esc(prev)})` : '') + '. '
      + '지표별로는 '
      + inScore.map(c => `${esc(c.label)} ${num(c.score)}`).join(', ')
      + ' 입니다.</p>'
    );
  }
  if (parts.length === 0) return null;

  return { html: card(latest, parts.join('\n'), AUTO_NOTE), updated: latest };
}

// ── 섹터 상대강도 ─────────────────────────────────────────────────────
// 화면 기본값과 같은 기간을 씁니다. 요약과 첫 화면의 숫자가 다르면 둘 중 하나가 틀린 것처럼 보입니다.
const RS_PERIOD = '3m';
const RS_PERIOD_LABEL = '3개월';
const TOP_N = 5;

function sectorSummary() {
  const data = readJson('data/sectors.json');
  if (!data || !data.markets) return null;

  const parts = [];
  let latest = null;

  for (const key of ['KR', 'US']) {
    const m = data.markets[key];
    if (!m) continue;
    if (!latest || m.updated > latest) latest = m.updated;

    const rows = m.sectors
      .map(s => ({ name: s.name, ...(s.periods[RS_PERIOD] || {}) }))
      .filter(s => s.rating != null)
      .sort((a, b) => b.rating - a.rating);
    if (rows.length === 0) continue;

    const top = rows.slice(0, TOP_N);
    const worst = rows[rows.length - 1];

    parts.push(
      `      <p style="font-size:14px; color:#4a5568; line-height:1.9; margin:14px 0 8px;">`
      + `${esc(m.flag)} <b>${esc(m.label)}</b> ${RS_PERIOD_LABEL} 기준 가장 강한 섹터는 `
      + `<b>${esc(top[0].name)}</b>(RS ${top[0].rating}, ${pct(top[0].ret)})이고, `
      + `가장 약한 섹터는 <b>${esc(worst.name)}</b>(RS ${worst.rating}, ${pct(worst.ret)})입니다. `
      + `벤치마크는 ${esc(m.benchmark.name)} ${pct(m.benchmark.ret[RS_PERIOD])}입니다.</p>`
      + `\n      <div style="overflow-x:auto;"><table style="font-size:12.5px;">`
      + `<thead><tr><th style="text-align:left;">${esc(m.label)} 상위 ${top.length}개 섹터</th>`
      + `<th>RS 점수</th><th>${RS_PERIOD_LABEL} 등락률</th><th>거래대금 비중</th></tr></thead><tbody>`
      + top.map(s => `<tr><td style="text-align:left;">${esc(s.name)}</td><td>${s.rating}</td>`
        + `<td>${pct(s.ret)}</td><td>${s.turnShare == null ? '—' : s.turnShare.toFixed(1) + '%'}</td></tr>`).join('')
      + `</tbody></table></div>`
    );
  }
  if (parts.length === 0) return null;

  return { html: card(latest, parts.join('\n'), AUTO_NOTE), updated: latest };
}

// ── 히트맵 ────────────────────────────────────────────────────────────
const HM_PERIOD = '1m';
const HM_PERIOD_LABEL = '1개월';

function heatmapSummary() {
  const data = readJson('data/sectors.json');
  if (!data || !data.markets) return null;

  const parts = [];
  let latest = null;

  for (const key of ['KR', 'US']) {
    const m = data.markets[key];
    if (!m) continue;
    if (!latest || m.updated > latest) latest = m.updated;

    const members = [];
    for (const s of m.sectors) {
      for (const mem of s.members) {
        const ret = mem.ret[HM_PERIOD];
        if (ret == null) continue;
        members.push({ name: mem.name, sector: s.name, ret, turn: mem.turn ? mem.turn[HM_PERIOD] : null });
      }
    }
    if (members.length === 0) continue;

    const up = [...members].sort((a, b) => b.ret - a.ret).slice(0, TOP_N);
    const down = [...members].sort((a, b) => a.ret - b.ret).slice(0, TOP_N);
    const busiest = [...members].sort((a, b) => (b.turn || 0) - (a.turn || 0))[0];

    parts.push(
      `      <p style="font-size:14px; color:#4a5568; line-height:1.9; margin:14px 0 8px;">`
      + `${esc(m.flag)} <b>${esc(m.label)}</b> ${HM_PERIOD_LABEL} 기준 가장 많이 오른 종목은 `
      + `<b>${esc(up[0].name)}</b>(${esc(up[0].sector)}, ${pct(up[0].ret)}), 가장 많이 빠진 종목은 `
      + `<b>${esc(down[0].name)}</b>(${esc(down[0].sector)}, ${pct(down[0].ret)})입니다.`
      + (busiest && busiest.turn != null
        ? ` 거래대금이 가장 많이 몰린 종목은 <b>${esc(busiest.name)}</b>(비중 ${busiest.turn.toFixed(1)}%)입니다.`
        : '')
      + `</p>`
      + `\n      <div style="overflow-x:auto;"><table style="font-size:12.5px;">`
      + `<thead><tr><th style="text-align:left;">${esc(m.label)} ${HM_PERIOD_LABEL} 상승 상위</th><th>등락률</th>`
      + `<th style="text-align:left;">하락 상위</th><th>등락률</th></tr></thead><tbody>`
      + up.map((u, i) => {
        const d = down[i];
        return `<tr><td style="text-align:left;">${esc(u.name)}</td><td>${pct(u.ret)}</td>`
          + `<td style="text-align:left;">${d ? esc(d.name) : ''}</td><td>${d ? pct(d.ret) : ''}</td></tr>`;
      }).join('')
      + `</tbody></table></div>`
    );
  }
  if (parts.length === 0) return null;

  return { html: card(latest, parts.join('\n'), AUTO_NOTE), updated: latest };
}

function main() {
  const jobs = [
    { file: 'fear-greed.html', name: 'FG_SUMMARY', build: fearGreedSummary },
    { file: 'sector-rs.html', name: 'RS_SUMMARY', build: sectorSummary },
    { file: 'heatmap.html', name: 'HM_SUMMARY', build: heatmapSummary },
  ];

  let wrote = 0;
  for (const job of jobs) {
    const out = job.build();
    if (!out) { console.warn(`⚠️  ${job.file}: 요약을 만들 데이터가 없어 건너뜁니다`); continue; }
    const changed = writeBlock(job.file, job.name, out.html);
    wrote += changed;
    console.log(`   ${job.file} — 기준일 ${out.updated}${changed ? '' : ' (내용 같음, 그대로 둠)'}`);
  }
  console.log(wrote ? `✅ ${wrote}개 페이지의 요약을 갱신했습니다` : '변경 사항 없음');
}

if (require.main === module) main();

module.exports = { fearGreedSummary, sectorSummary, heatmapSummary, writeBlock };
