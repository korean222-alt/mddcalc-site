// 섹터(테마) 정의 — 이 파일이 단 하나의 원본입니다.
//
// scripts/generate-sector-rs.js 가 이 목록을 읽어서 data/sectors.json 을 만들고,
// sector-rs.html 이 그 파일 하나만 읽습니다.
//
// 설계 규칙: 테마는 "심볼 바구니"입니다. 바구니에 종목 6개가 들어가든 ETF 하나만
// 들어가든 계산 엔진은 똑같이 동작합니다. 그래서 한국(개별 종목 묶음)과 미국(섹터 ETF)을
// 시장별 분기 없이 같은 코드로 처리할 수 있습니다.
//
// 한국 코드는 scripts/kr-tickers.js 에 반드시 존재해야 합니다.
// 미국 심볼은 아래 US_SECTORS 자체가 수집 대상 목록이 됩니다.
// (오타로 섹터가 조용히 비는 것을 막으려고 generate-sector-rs.js 가 시작할 때 검사합니다)

const KR_SECTORS = [
  { key: 'memory',    name: '반도체·메모리',    codes: ['005930', '000660', '000990'], group: 'tech' },
  { key: 'semi-eqp',  name: '반도체 소부장',    codes: ['042700', '039030', '240810', '058470', '095340', '403870'], group: 'tech' },
  { key: 'battery',   name: '2차전지',          codes: ['373220', '006400', '051910', '247540', '086520', '066970'], group: 'material' },
  { key: 'bio',       name: '바이오·제약',      codes: ['207940', '068270', '196170', '028300', '128940', '000100'], group: 'health' },
  { key: 'software',  name: '인터넷·소프트웨어', codes: ['035420', '035720', '012510', '053800', '030520'], group: 'tech' },
  { key: 'game',      name: '게임',             codes: ['259960', '036570', '251270', '263750', '293490', '112040'], group: 'comm' },
  { key: 'enter',     name: '엔터·미디어',      codes: ['352820', '041510', '122870', '035900'], group: 'comm' },
  { key: 'defense',   name: '방산·우주항공',    codes: ['012450', '047810', '064350', '079550'], group: 'indus' },
  { key: 'ship',      name: '조선',             codes: ['042660', '009540', '329180', '010140', '010620'], group: 'indus' },
  { key: 'auto',      name: '자동차',           codes: ['005380', '000270', '012330', '204320', '161390'], group: 'cyclical' },
  { key: 'bank',      name: '은행·금융지주',    codes: ['105560', '055550', '086790', '316140', '024110', '323410'], group: 'finance' },
  { key: 'broker',    name: '증권·보험',        codes: ['032830', '000810', '006800', '016360', '071050', '039490'], group: 'finance' },
  { key: 'telecom',   name: '통신',             codes: ['017670', '030200', '032640'], group: 'comm' },
  { key: 'power',     name: '전력·원전',        codes: ['015760', '034020', '267260', '298040', '010120'], group: 'utility' },
  { key: 'const',     name: '건설·기계',        codes: ['000720', '028260', '047040', '006360'], group: 'indus' },
  { key: 'material',  name: '소재·철강·화학',   codes: ['005490', '010130', '011170', '011780', '004020'], group: 'material' },
  { key: 'consumer',  name: '화장품·소비재',    codes: ['090430', '161890', '192820', '097950', '033780', '139480'], group: 'cyclical' },
  { key: 'transport', name: '해운·항공',        codes: ['011200', '003490', '028670'], group: 'indus' },
  { key: 'robot',     name: '로봇',             codes: ['277810', '454910', '108490'], group: 'tech' },
];

// 미국은 섹터 ETF 를 씁니다. 개별 종목을 묶는 것보다 구성이 투명하고, 편입/편출을
// 우리가 따라다니지 않아도 됩니다. 메모리처럼 순수 ETF 가 없는 테마만 종목을 묶습니다.
const US_SECTORS = [
  { key: 'memory',   name: '메모리 반도체',  codes: ['MU', 'WDC', 'STX'], group: 'tech' },
  { key: 'semi',     name: '반도체 전체',    codes: ['SMH'], group: 'tech' },
  { key: 'software', name: '소프트웨어',     codes: ['IGV'], group: 'tech' },
  { key: 'health',   name: '헬스케어',       codes: ['XLV'], group: 'health' },
  { key: 'bio',      name: '바이오텍',       codes: ['XBI'], group: 'health' },
  { key: 'tech',     name: '기술',           codes: ['XLK'], group: 'tech' },
  { key: 'comm',     name: '커뮤니케이션',   codes: ['XLC'], group: 'comm' },
  { key: 'finance',  name: '금융',           codes: ['XLF'], group: 'finance' },
  { key: 'energy',   name: '에너지',         codes: ['XLE'], group: 'energy' },
  { key: 'indus',    name: '산업재',         codes: ['XLI'], group: 'indus' },
  { key: 'material', name: '소재',           codes: ['XLB'], group: 'material' },
  { key: 'staples',  name: '필수소비재',     codes: ['XLP'], group: 'defensive' },
  { key: 'discret',  name: '경기소비재',     codes: ['XLY'], group: 'cyclical' },
  { key: 'utility',  name: '유틸리티',       codes: ['XLU'], group: 'utility' },
  { key: 'reit',     name: '부동산',         codes: ['XLRE'], group: 'reit' },
  { key: 'defense',  name: '방산·우주',      codes: ['ITA'], group: 'indus' },
  { key: 'cyber',    name: '사이버보안',     codes: ['CIBR'], group: 'tech' },
  { key: 'nuclear',  name: '원자력·우라늄',  codes: ['URA'], group: 'energy' },
  { key: 'robot',    name: '로봇·AI',        codes: ['BOTZ'], group: 'tech' },
];

// 대분류(그룹). 히트맵에서 섹터 위에 한 겹 더 씌우는 묶음입니다.
//
// 왜 필요한가: 섹터 19개를 한 판에 늘어놓으면 "반도체 소부장"과 "은행"이 나란히 붙어
// 서로 아무 관계도 없는 칸끼리 이웃합니다. Finviz 처럼 대분류 → 섹터 → 종목으로 겹치면
// "기술이 통째로 빨갛다" 같은 큰 그림이 먼저 보이고, 그 안에서 어디가 버텼는지가 보입니다.
//
// 이 목록은 표시 순서가 아니라 이름표일 뿐입니다. 화면에서는 거래대금이 큰 그룹이
// 먼저 자리를 잡습니다. 시장에 없는 그룹은 그냥 안 그려집니다.
const GROUPS = [
  { key: 'tech',      name: '기술' },
  { key: 'comm',      name: '커뮤니케이션' },
  { key: 'cyclical',  name: '경기소비재' },
  { key: 'defensive', name: '필수소비재' },
  { key: 'health',    name: '헬스케어' },
  { key: 'finance',   name: '금융' },
  { key: 'indus',     name: '산업재' },
  { key: 'material',  name: '소재' },
  { key: 'energy',    name: '에너지' },
  { key: 'utility',   name: '유틸리티' },
  { key: 'reit',      name: '부동산' },
];

// 미국 종목 이름표. 표에서 구성 종목을 한글로 보여주기 위한 것뿐입니다.
const US_NAMES = {
  MU: '마이크론', WDC: '웨스턴디지털', STX: '씨게이트',
  SMH: 'VanEck 반도체', IGV: 'iShares 소프트웨어', XLV: 'SPDR 헬스케어',
  XBI: 'SPDR 바이오텍', XLK: 'SPDR 기술', XLC: 'SPDR 커뮤니케이션',
  XLF: 'SPDR 금융', XLE: 'SPDR 에너지', XLI: 'SPDR 산업재',
  XLB: 'SPDR 소재', XLP: 'SPDR 필수소비재', XLY: 'SPDR 경기소비재',
  XLU: 'SPDR 유틸리티', XLRE: 'SPDR 부동산', ITA: 'iShares 방산·우주',
  CIBR: 'First Trust 사이버보안', URA: 'Global X 우라늄', BOTZ: 'Global X 로봇·AI',
  SPY: 'S&P 500',
};

// 거래대금 비중을 시장 안에서 비교해도 되는가.
//
// 한국은 전부 개별 종목이라 서로 비교됩니다.
// 미국은 대부분 섹터 ETF 인데 "메모리 반도체"만 개별 종목 바스켓입니다. 개별 대형주는
// ETF 보다 거래대금이 훨씬 크기 때문에, 섞어서 비중을 내면 메모리 하나가 70% 를 차지하는
// 허수가 나옵니다. 실제로 그렇게 나왔습니다. 비교가 성립하지 않는 숫자는 아예 만들지
// 않습니다 — 화면에 나오면 누군가는 그걸 읽습니다.
const TURNOVER_COMPARABLE = { KR: true, US: false };

// 벤치마크. RS 는 "무엇 대비 강한가"이므로 이 값이 지표의 기준점입니다.
const BENCHMARKS = {
  KR: { code: 'KS11', name: '코스피' },
  US: { code: 'SPY', name: 'S&P 500' },
};

// 미국에서 실제로 받아와야 하는 심볼 = 모든 섹터 구성 심볼 + 벤치마크.
// generate-us-data.js 가 이 함수를 수집 목록으로 씁니다.
function usSymbols() {
  const set = new Set([BENCHMARKS.US.code]);
  for (const s of US_SECTORS) for (const c of s.codes) set.add(c);
  return [...set];
}

// 기간 정의. 거래일 기준입니다. (달력일이 아니라 데이터 행 수)
//
// 1일은 "직전 거래일 종가 대비 오늘 종가"입니다. 달력의 하루가 아니라 거래일 하루라서,
// 월요일에 보면 금요일 대비이고 연휴 뒤에는 연휴 직전 대비입니다.
// 데이터가 하루에 한 번(장 마감 뒤) 갱신되므로 화면의 "1일"은 늘 마지막으로 마감된
// 거래일 하루치입니다 — 장중 실시간이 아닙니다.
const PERIODS = [
  { key: '1d',  label: '1일',    days: 1 },
  { key: '1w',  label: '1주',    days: 5 },
  { key: '1m',  label: '1개월',  days: 20 },
  { key: '3m',  label: '3개월',  days: 60 },
  { key: '6m',  label: '6개월',  days: 120 },
  { key: '12m', label: '12개월', days: 250 },
];

module.exports = { KR_SECTORS, US_SECTORS, US_NAMES, GROUPS, BENCHMARKS, TURNOVER_COMPARABLE, usSymbols, PERIODS };
