#!/usr/bin/env node
// Twelve Data 를 실제로 썼는지 검사합니다.
//
//   node scripts/check-api-usage.js            # 커밋된 기록으로 검사
//   node scripts/check-api-usage.js --fresh    # "방금 실행분인가"까지 검사 (워크플로우용)
//
// 왜 있는가:
//   "API 사용량이 안 올라간다"를 확인할 방법이 Twelve Data 대시보드밖에 없었습니다.
//   그런데 그 카운터는 UTC 자정에 리셋되고, 이 저장소의 미국 수집은 22:30 UTC(한국 07:30)에
//   돕니다. 한국 시간 낮에 대시보드를 열면 그 사이 날짜가 넘어가 늘 "오늘 0회"로 보입니다.
//   실제로 쓰고 있는데도 안 쓴 것처럼 보이는 것입니다.
//
//   그리고 화면만 봐서는 더더욱 알 수 없습니다. 수집이 통째로 실패해도 지난 파일이 남아
//   있어 섹터 RS·히트맵은 똑같이 그려집니다. 그래서 사람 눈 대신 이 스크립트가 봅니다.
//
// 무엇을 보는가 (셋 다 만족해야 통과):
//   1. data/api-usage.json — 이번 수집이 Twelve Data 를 몇 번 불렀는가
//   2. Twelve Data 가 알려준 사용량이 그만큼 늘었는가 (키가 살아 있을 때만 잴 수 있음)
//   3. data/sectors.json — RS·히트맵이 읽는 그 파일이 정말 그 데이터로 만들어졌는가

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USAGE_FILE = path.join(ROOT, 'data', 'api-usage.json');
const SECTORS_FILE = path.join(ROOT, 'data', 'sectors.json');

// 기록이 "방금 것"으로 인정되는 시간. 워크플로우의 미국 수집은 길어야 40분이고, 뒤이어
// 바로 이 검사가 돕니다. 6시간이면 느린 러너까지 넉넉히 덮으면서, 어제 기록을 오늘 것으로
// 착각하지는 않는 값입니다(수집은 하루 한 번뿐입니다).
const FRESH_HOURS = 6;

// 사용량 증가분이 호출 수와 정확히 같기를 요구하지는 않습니다. 사용자 조회 프록시
// (api/twelve-data/time-series.js)가 같은 키를 쓰기 때문에 그쪽 호출이 섞여 더 클 수
// 있습니다. 반대로 작아지는 것은 이상 신호이므로, 아래로만 여유를 둡니다.
const DELTA_TOLERANCE = 0.9;

function checkUsage({ usage, sectors, now = new Date(), fresh = false }) {
  const lines = [];
  const problems = [];

  if (!usage) {
    problems.push('data/api-usage.json 이 없습니다. 미국 수집(generate-us-data.js)이 한 번도 돌지 않았습니다.');
    return { ok: false, lines, problems };
  }

  const calls = Number(usage.calls) || 0;
  const tdOk = Number((usage.sources || {}).twelvedata) || 0;

  lines.push(`수집 시각: ${usage.generatedAtKST || usage.generatedAt}`);
  lines.push(`Twelve Data 호출: ${calls}회 (성공 ${tdOk} / 대상 ${usage.symbols || '?'}심볼)`);

  // 1) 호출 자체가 있었는가
  if (calls === 0) {
    problems.push('Twelve Data 를 한 번도 부르지 않았습니다. '
      + 'TWELVE_DATA_API_KEY 시크릿이 비어 있거나 스텝이 건너뛰어졌습니다.');
  }
  if (tdOk === 0) {
    problems.push('Twelve Data 로 받아온 심볼이 0개입니다. '
      + `실제로 쓰인 소스: ${JSON.stringify(usage.sources || {})}`);
  }

  // 2) 저쪽 카운터도 그만큼 늘었는가
  const u = usage.usage || {};
  if (u.measured) {
    lines.push(`Twelve Data 사용량: ${u.before} → ${u.after}`
      + (u.limit ? ` / ${u.limit}` : '') + ` (이번 실행 +${u.delta})`);
    if (calls > 0 && u.delta < calls * DELTA_TOLERANCE) {
      problems.push(`호출은 ${calls}회인데 사용량은 ${u.delta}회만 늘었습니다. `
        + '캐시나 프록시가 요청을 대신 처리하고 있는지 확인하세요.');
    }
    if (u.limit && u.after > u.limit * 0.9) {
      problems.push(`하루 한도 ${u.limit}회 중 ${u.after}회를 썼습니다. 90%를 넘었습니다.`);
    }
  } else {
    // 못 쟀다고 실패로 보지는 않습니다. 위의 호출 수 자체가 이미 증거이고, 사용량 조회는
    // 그걸 저쪽 장부로 한 번 더 확인하는 보조 수단입니다.
    lines.push(`Twelve Data 사용량: 재지 못함 (${u.reason || '이유 없음'})`);
  }

  // 3) 기록이 이번 실행 것인가
  if (fresh && usage.generatedAt) {
    const ageH = (now.getTime() - new Date(usage.generatedAt).getTime()) / 3600000;
    if (!(ageH < FRESH_HOURS)) {
      problems.push(`기록이 ${ageH.toFixed(1)}시간 전 것입니다. `
        + '이번 실행에서 미국 수집이 돌지 않았습니다.');
    }
  }

  // 4) RS·히트맵이 그 데이터로 만들어졌는가
  if (!sectors) {
    problems.push('data/sectors.json 이 없습니다. 섹터 RS·히트맵이 읽을 파일이 없습니다.');
  } else {
    const prov = (sectors.provenance || {}).US;
    if (!prov) {
      problems.push('data/sectors.json 에 provenance 가 없습니다. '
        + 'generate-sector-rs.js 가 옛 버전으로 돌았습니다.');
    } else {
      const fromTd = Number((prov.sources || {}).twelvedata) || 0;
      lines.push(`섹터 RS·히트맵이 읽는 미국 파일 ${prov.symbols}개 중 `
        + `Twelve Data 산 ${fromTd}개 (${JSON.stringify(prov.sources)})`);
      if (fromTd === 0) {
        problems.push('RS·히트맵이 쓰는 미국 파일 중 Twelve Data 로 받은 것이 하나도 없습니다.');
      }
      // sectors.json 이 수집보다 먼저 만들어졌다면, 오늘 받은 값은 화면에 반영되지
      // 않은 것입니다. 스텝 순서가 뒤집히면 조용히 이렇게 됩니다.
      if (sectors.generatedAt && usage.generatedAt
          && new Date(sectors.generatedAt) < new Date(usage.generatedAt)) {
        problems.push('data/sectors.json 이 미국 수집보다 먼저 만들어졌습니다. '
          + '오늘 받은 시세가 RS·히트맵에 반영되지 않았습니다.');
      }
    }
  }

  if (Array.isArray(usage.failures) && usage.failures.length) {
    lines.push(`실패 ${usage.failed}심볼: `
      + usage.failures.map(f => f.symbol).join(', '));
  }

  return { ok: problems.length === 0, lines, problems };
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function main() {
  const fresh = process.argv.includes('--fresh');
  const result = checkUsage({
    usage: readJson(USAGE_FILE),
    sectors: readJson(SECTORS_FILE),
    fresh,
  });

  for (const line of result.lines) console.log('   ' + line);
  for (const p of result.problems) console.error('::error::' + p);

  // Actions 요약 패널에도 같은 내용을 남깁니다. 로그를 열어 30분치 줄을 넘기지 않고도
  // 실행 화면에서 바로 "몇 회 썼는지"가 보이게 하려는 것입니다.
  if (process.env.GITHUB_STEP_SUMMARY) {
    const body = ['### Twelve Data 사용량', '',
      ...result.lines.map(l => '- ' + l),
      ...(result.problems.length ? ['', '**문제**', ...result.problems.map(p => '- ⚠️ ' + p)] : ['', '문제 없음 ✅']),
      ''].join('\n');
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, body); } catch { /* 요약은 부가 기능 */ }
  }

  console.log(result.ok ? '✅ API 사용 확인됨' : `❌ 문제 ${result.problems.length}건`);
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { checkUsage, FRESH_HOURS, DELTA_TOLERANCE };
