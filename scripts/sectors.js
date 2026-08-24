// 섹터(테마) 정의 — 이 파일이 단 하나의 원본입니다.
//
// scripts/generate-sector-rs.js 가 이 목록을 읽어서 data/sectors.json 을 만들고,
// sector-rs.html 과 heatmap.html 이 그 파일 하나만 읽습니다.
//
// 설계 규칙: 테마는 "심볼 바구니"입니다. 바구니에 종목이 몇 개 들어가든 계산 엔진은
// 똑같이 동작합니다. 그래서 한국과 미국을 시장별 분기 없이 같은 코드로 처리합니다.
//
// 한국 코드는 scripts/kr-tickers.js 에 반드시 존재해야 합니다.
// 미국 심볼은 아래 US_SECTORS 자체가 수집 대상 목록이 됩니다.
// (오타로 섹터가 조용히 비는 것을 막으려고 generate-sector-rs.js 가 시작할 때 검사합니다)
//
// 분류 기준은 공식 산업분류(GICS·KRX 업종)가 아니라 "투자자들이 실제로 묶어 부르는 테마"
// 입니다. 예컨대 LG화학은 KRX 업종으로는 화학이지만 여기서는 2차전지에 넣습니다 —
// 주가가 화학이 아니라 배터리 업황을 따라 움직이기 때문입니다.

const KR_SECTORS = [
  { key: 'memory',    name: '반도체·메모리',    codes: ['005930', '000660', '000990'] },
  { key: 'semi-eqp',  name: '반도체 소부장',    codes: ['042700', '039030', '240810', '058470', '095340', '403870'] },
  { key: 'elec',      name: '전자부품·가전',    codes: ['066570', '009150'] },
  { key: 'battery',   name: '2차전지',          codes: ['373220', '006400', '051910', '247540', '086520', '066970'] },
  { key: 'bio',       name: '바이오·제약',      codes: ['207940', '068270', '196170', '028300', '128940', '000100'] },
  { key: 'software',  name: '인터넷·소프트웨어', codes: ['035420', '035720', '012510', '053800', '030520'] },
  { key: 'game',      name: '게임',             codes: ['259960', '036570', '251270', '263750', '293490', '112040'] },
  { key: 'enter',     name: '엔터·미디어',      codes: ['352820', '041510', '122870', '035900'] },
  { key: 'defense',   name: '방산·우주항공',    codes: ['012450', '047810', '064350', '079550'] },
  // HD현대미포(010620)는 2025-12-12 이후 시세가 끊겼습니다(합병·상장폐지로 보입니다).
  // 그대로 두면 최근 구간 계산에서 조용히 빠져 조선 섹터 숫자만 알 수 없게 달라집니다.
  { key: 'ship',      name: '조선',             codes: ['042660', '009540', '329180', '010140'] },
  { key: 'auto',      name: '자동차',           codes: ['005380', '000270', '012330', '204320', '161390'] },
  { key: 'bank',      name: '은행·금융지주',    codes: ['105560', '055550', '086790', '316140', '024110', '323410'] },
  { key: 'broker',    name: '증권·보험',        codes: ['032830', '000810', '006800', '016360', '071050', '039490'] },
  { key: 'holding',   name: '지주회사',         codes: ['034730', '003550', '402340'] },
  { key: 'telecom',   name: '통신',             codes: ['017670', '030200', '032640'] },
  { key: 'power',     name: '전력·원전',        codes: ['015760', '034020', '267260', '298040', '010120'] },
  { key: 'const',     name: '건설·기계',        codes: ['000720', '028260', '047040', '006360'] },
  { key: 'material',  name: '소재·철강·화학',   codes: ['005490', '010130', '011170', '011780', '004020', '096770'] },
  { key: 'consumer',  name: '화장품·소비재',    codes: ['090430', '161890', '192820', '097950', '033780', '139480'] },
  { key: 'transport', name: '해운·항공',        codes: ['011200', '003490', '028670'] },
  { key: 'robot',     name: '로봇',             codes: ['277810', '454910', '108490'] },
];

// 미국도 한국과 같은 개별 종목 바스켓입니다.
//
// 원래는 섹터 ETF(XLK, XLF …)를 썼습니다. 구성이 투명하고 편입/편출을 따라다니지 않아도
// 되기 때문이었는데, 화면에서 두 가지가 어긋났습니다.
//   1) 한국 탭은 종목 이름이 뜨는데 미국 탭은 "SPDR 기술" 같은 상품명만 떴습니다.
//      같은 히트맵인데 시장을 바꾸면 보는 방식이 달라집니다.
//   2) ETF 거래대금은 그 섹터에 들어간 돈이 아니라 그 ETF 를 사고판 돈이라서,
//      칸 크기(거래대금)를 쓸 수 없었습니다. 미국 탭만 "균등" 고정이었던 이유입니다.
//
// 개별 종목으로 바꾸면 둘 다 풀립니다. 대신 대표주를 우리가 골라야 하고, 그 선택이
// 곧 "이 섹터"의 정의가 됩니다. 그래서 시가총액·거래대금 상위 위주로 3~6개씩만 담았습니다.
// 종목 수는 수집 비용과 직결됩니다 — generate-us-data.js 주석 참고.
const US_SECTORS = [
  { key: 'semi',     name: '반도체',          codes: ['NVDA', 'AVGO', 'AMD', 'TSM', 'QCOM', 'INTC'] },
  { key: 'semi-eqp', name: '반도체 장비',     codes: ['ASML', 'AMAT', 'LRCX', 'KLAC'] },
  { key: 'memory',   name: '메모리',          codes: ['MU', 'WDC', 'STX'] },
  { key: 'software', name: '소프트웨어',      codes: ['MSFT', 'ORCL', 'CRM', 'ADBE', 'PLTR'] },
  { key: 'internet', name: '인터넷·플랫폼',   codes: ['GOOGL', 'META', 'AMZN', 'NFLX'] },
  { key: 'hardware', name: '하드웨어·네트워크', codes: ['AAPL', 'CSCO', 'ANET'] },
  { key: 'cyber',    name: '사이버보안',      codes: ['CRWD', 'PANW', 'FTNT'] },
  { key: 'auto',     name: '자동차·EV',       codes: ['TSLA', 'GM', 'F'] },
  { key: 'bank',     name: '은행',            codes: ['JPM', 'BAC', 'WFC', 'GS'] },
  { key: 'payment',  name: '결제·핀테크',     codes: ['V', 'MA', 'PYPL', 'COIN'] },
  { key: 'health',   name: '헬스케어·제약',   codes: ['LLY', 'JNJ', 'UNH', 'ABBV'] },
  { key: 'bio',      name: '바이오텍',        codes: ['AMGN', 'GILD', 'VRTX', 'REGN'] },
  { key: 'energy',   name: '에너지',          codes: ['XOM', 'CVX', 'COP', 'SLB'] },
  { key: 'power',    name: '전력·원자력',     codes: ['NEE', 'SO', 'CEG', 'VST'] },
  { key: 'indus',    name: '산업재',          codes: ['CAT', 'DE', 'HON', 'GE'] },
  { key: 'defense',  name: '방산·우주',       codes: ['LMT', 'RTX', 'NOC', 'BA'] },
  { key: 'material', name: '소재·화학',       codes: ['LIN', 'FCX', 'NEM'] },
  { key: 'staples',  name: '필수소비재',      codes: ['PG', 'KO', 'PEP', 'COST', 'WMT'] },
  { key: 'discret',  name: '경기소비재',      codes: ['MCD', 'NKE', 'HD', 'SBUX', 'DIS'] },
  { key: 'reit',     name: '부동산',          codes: ['PLD', 'AMT', 'EQIX'] },
];

// 미국 종목 이름표. 화면에 한글로 보여주기 위한 것뿐입니다.
// 여기 없는 심볼은 티커가 그대로 나옵니다(틀린 이름을 지어내는 것보다 낫습니다).
const US_NAMES = {
  NVDA: '엔비디아', AVGO: '브로드컴', AMD: 'AMD', TSM: 'TSMC', QCOM: '퀄컴', INTC: '인텔',
  ASML: 'ASML', AMAT: '어플라이드머티어리얼즈', LRCX: '램리서치', KLAC: 'KLA',
  MU: '마이크론', WDC: '웨스턴디지털', STX: '씨게이트',
  MSFT: '마이크로소프트', ORCL: '오라클', CRM: '세일즈포스', ADBE: '어도비', PLTR: '팔란티어',
  GOOGL: '알파벳(구글)', META: '메타', AMZN: '아마존', NFLX: '넷플릭스',
  AAPL: '애플', CSCO: '시스코', ANET: '아리스타네트웍스',
  CRWD: '크라우드스트라이크', PANW: '팔로알토네트웍스', FTNT: '포티넷',
  TSLA: '테슬라', GM: '제너럴모터스', F: '포드',
  JPM: 'JP모건', BAC: '뱅크오브아메리카', WFC: '웰스파고', GS: '골드만삭스',
  V: '비자', MA: '마스터카드', PYPL: '페이팔', COIN: '코인베이스',
  LLY: '일라이릴리', JNJ: '존슨앤드존슨', UNH: '유나이티드헬스', ABBV: '애브비',
  AMGN: '암젠', GILD: '길리어드', VRTX: '버텍스', REGN: '리제네론',
  XOM: '엑슨모빌', CVX: '셰브론', COP: '코노코필립스', SLB: '슐럼버거',
  NEE: '넥스트에라에너지', SO: '서던컴퍼니', CEG: '컨스텔레이션에너지', VST: '비스트라',
  CAT: '캐터필러', DE: '디어', HON: '허니웰', GE: 'GE에어로스페이스',
  LMT: '록히드마틴', RTX: 'RTX', NOC: '노스럽그러먼', BA: '보잉',
  LIN: '린데', FCX: '프리포트맥모란', NEM: '뉴몬트',
  PG: '프록터앤드갬블', KO: '코카콜라', PEP: '펩시코', COST: '코스트코', WMT: '월마트',
  MCD: '맥도날드', NKE: '나이키', HD: '홈디포', SBUX: '스타벅스', DIS: '디즈니',
  PLD: '프로로지스', AMT: '아메리칸타워', EQIX: '에퀴닉스',
  SPY: 'S&P 500',
};

// 거래대금 비중을 시장 안에서 비교해도 되는가.
//
// 양쪽 다 개별 종목만 담고 있으므로 서로 비교됩니다.
// 미국이 한때 false 였던 이유는 섹터 ETF 와 개별 종목이 섞여 있었기 때문입니다. 개별
// 대형주는 ETF 보다 거래대금이 훨씬 커서, 섞어서 비중을 내면 메모리 하나가 70% 를
// 차지하는 허수가 나왔습니다. 바스켓을 개별 종목으로 통일하면서 그 문제가 사라졌습니다.
// 이 스위치는 남겨 둡니다 — 언젠가 다시 ETF 를 섞는다면 그때 false 로 돌려야 합니다.
const TURNOVER_COMPARABLE = { KR: true, US: true };

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
const PERIODS = [
  { key: '1w',  label: '1주',    days: 5 },
  { key: '1m',  label: '1개월',  days: 20 },
  { key: '3m',  label: '3개월',  days: 60 },
  { key: '6m',  label: '6개월',  days: 120 },
  { key: '12m', label: '12개월', days: 250 },
];

module.exports = { KR_SECTORS, US_SECTORS, US_NAMES, BENCHMARKS, TURNOVER_COMPARABLE, usSymbols, PERIODS };
