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

// ── 테마 바스켓 ───────────────────────────────────────────────────────
//
// US_SECTORS 가 "시장 전체를 20칸으로 나눈 지도"라면, 이쪽은 그보다 훨씬 좁게 쪼갠
// 테마 지도입니다. AI 데이터센터 한 덩어리를 GPU·파운드리·패키징·전력·냉각·시공으로
// 갈라 놓으면, 같은 AI 랠리 안에서도 돈이 지금 어느 칸에 있는지가 드러납니다.
// (넓은 섹터 하나로 묶으면 그 안에서 무엇이 앞서 가는지는 보이지 않습니다)
//
// 두 목록은 겹칩니다. 일부러 그렇게 둡니다 — 지우면 "미국" 탭의 넓은 그림이 사라지고,
// 합치면 "반도체"와 "GPU·ASIC"이 한 화면에서 서로를 잡아먹습니다. 그래서 별도 탭입니다.
// 같은 종목이 여러 테마에 들어가는 것도 마찬가지입니다. AVGO 는 GPU·ASIC 이면서
// 네트워크 반도체입니다. 거래대금 분모는 종목을 한 번만 세므로(generate-sector-rs.js
// 의 universe) 중복이 비중을 부풀리지 않습니다.
//
// 종목 수 = 수집 비용입니다. Twelve Data 무료 플랜은 분당 8회라 심볼 하나에 8.5초를
// 씁니다. 여기에 종목을 열 개 더하면 워크플로우가 1분 24초 더 돕니다.
const THEME_SECTORS = [
  // AI 반도체
  { key: 'gpu',        name: 'GPU·ASIC',                codes: ['NVDA', 'AVGO', 'AMD', 'MRVL'] },
  { key: 'foundry',    name: '파운드리·CoWoS',          codes: ['TSM', 'UMC', 'GFS', 'ASX'] },
  { key: 'semi-eqp',   name: '반도체 장비',             codes: ['ASML', 'AMAT', 'LRCX', 'KLAC', 'TER'] },
  { key: 'osat',       name: '패키징·검사',             codes: ['AMKR', 'ASX', 'ONTO', 'TER'] },
  { key: 'hbm',        name: 'HBM·메모리',              codes: ['MU', 'WDC', 'STX'] },
  { key: 'net-semi',   name: '네트워크 반도체',         codes: ['AVGO', 'MRVL', 'CRDO', 'ALAB'] },
  { key: 'eda',        name: 'EDA·반도체 IP',           codes: ['SNPS', 'CDNS', 'ARM'] },

  // AI 인프라 하드웨어
  { key: 'ai-server',  name: 'AI 서버',                 codes: ['DELL', 'SMCI', 'HPE'] },
  { key: 'ai-fabric',  name: 'AI 패브릭',               codes: ['ANET', 'CSCO', 'CRDO', 'ALAB'] },
  { key: 'optics',     name: '광통신',                  codes: ['COHR', 'LITE', 'CIEN', 'FN'] },
  { key: 'net-gear',   name: '네트워크 장비',           codes: ['CSCO', 'MSI', 'UI', 'EXTR'] },
  { key: 'connector',  name: '랙·커넥터',               codes: ['APH', 'TEL', 'GLW', 'VRT'] },

  // 데이터센터
  { key: 'ups',        name: 'UPS·전력관리',            codes: ['VRT', 'ETN', 'EMR', 'GNRC'] },
  { key: 'cooling',    name: '데이터센터 냉각',         codes: ['VRT', 'TT', 'JCI', 'MOD'] },
  { key: 'dc-build',   name: '데이터센터 시공',         codes: ['PWR', 'EME', 'MTZ', 'FIX'] },
  { key: 'dc-reit',    name: '데이터센터 REIT',         codes: ['EQIX', 'DLR', 'IRM', 'AMT'] },

  // 전력
  { key: 'grid',       name: '송전·배전',               codes: ['AEP', 'ED', 'EXC', 'PPL'] },
  { key: 'grid-gear',  name: '전력망 장비',             codes: ['ETN', 'HUBB', 'POWL', 'NVT'] },
  { key: 'turbine',    name: '가스터빈·현장발전',       codes: ['GEV', 'CMI', 'CAT', 'GNRC'] },
  { key: 'ipp',        name: '발전사업자',              codes: ['CEG', 'VST', 'NRG', 'TLN'] },

  // 원자력
  { key: 'nuclear',    name: '원전',                    codes: ['CEG', 'VST', 'TLN', 'PEG'] },
  { key: 'nuke-chain', name: '원전 공급망',             codes: ['BWXT', 'LEU', 'GEV'] },
  { key: 'smr',        name: 'SMR',                     codes: ['SMR', 'OKLO', 'NNE', 'LEU'] },
  { key: 'uranium',    name: '우라늄',                  codes: ['CCJ', 'UEC', 'NXE', 'UUUU'] },

  // 에너지
  { key: 'ess',        name: 'ESS·에너지저장',          codes: ['TSLA', 'FLNC', 'ENPH'] },
  { key: 'solar',      name: '태양광',                  codes: ['FSLR', 'ENPH', 'NXT', 'RUN'] },
  { key: 'lng',        name: '천연가스·LNG',            codes: ['LNG', 'EQT', 'WMB', 'KMI', 'TRGP'] },

  // 소프트웨어
  { key: 'cyber',      name: '사이버보안',              codes: ['CRWD', 'PANW', 'FTNT', 'ZS', 'S'] },
  { key: 'cloud',      name: '클라우드',                codes: ['MSFT', 'AMZN', 'GOOGL', 'ORCL'] },
  { key: 'saas',       name: 'SaaS',                    codes: ['CRM', 'NOW', 'WDAY', 'HUBS', 'ADBE'] },
  { key: 'ai-soft',    name: 'AI 소프트웨어',           codes: ['PLTR', 'AI', 'SNOW', 'MSFT'] },
  { key: 'ai-agent',   name: 'AI 에이전트·자동화',      codes: ['NOW', 'PATH', 'TEAM', 'CRM'] },
  { key: 'bigdata',    name: '데이터 분석·빅데이터',    codes: ['SNOW', 'PLTR', 'TDC', 'CFLT'] },
  { key: 'database',   name: '데이터베이스',            codes: ['ORCL', 'MDB', 'CFLT', 'TDC'] },
  { key: 'devops',     name: 'DevOps·관측성',           codes: ['DDOG', 'DT', 'GTLB', 'ESTC', 'TEAM'] },

  // 금융
  { key: 'fintech',    name: '핀테크',                  codes: ['FI', 'FIS', 'GPN', 'AFRM'] },
  { key: 'payment',    name: '디지털 결제',             codes: ['V', 'MA', 'PYPL', 'AXP', 'TOST'] },
  { key: 'ebroker',    name: '온라인 증권·디지털은행',  codes: ['HOOD', 'SCHW', 'IBKR', 'SOFI'] },
  { key: 'crypto',     name: '암호화폐·블록체인 인프라', codes: ['COIN', 'MSTR', 'MARA', 'RIOT'] },

  // 로봇·모빌리티
  { key: 'robot',      name: '로봇·산업자동화',         codes: ['ROK', 'EMR', 'ZBRA', 'TER'] },
  { key: 'humanoid',   name: '휴머노이드 로봇',         codes: ['TSLA', 'NVDA', 'SERV'] },
  { key: 'autonomy',   name: '자율주행',                codes: ['TSLA', 'MBLY', 'AUR', 'UBER'] },
  { key: 'drone',      name: '드론',                    codes: ['KTOS', 'AVAV', 'RCAT', 'ONDS'] },

  // 방산·우주·양자
  { key: 'defense',    name: '방산',                    codes: ['LMT', 'RTX', 'NOC', 'GD', 'LHX'] },
  { key: 'space',      name: '우주항공·위성',           codes: ['RKLB', 'ASTS', 'IRDM', 'PL', 'BA'] },
  { key: 'quantum',    name: '양자컴퓨팅',              codes: ['IONQ', 'RGTI', 'QBTS', 'QUBT'] },

  // 헬스케어
  { key: 'biotech',    name: '바이오테크',              codes: ['AMGN', 'GILD', 'VRTX', 'REGN', 'BIIB'] },
  { key: 'geneedit',   name: '유전자 편집·정밀의료',    codes: ['CRSP', 'NTLA', 'BEAM', 'ILMN'] },
  { key: 'glp1',       name: 'GLP-1·비만치료',          codes: ['LLY', 'NVO', 'VKTX', 'AMGN'] },
  { key: 'medtech',    name: '의료기기·로봇수술',       codes: ['ISRG', 'MDT', 'SYK', 'BSX'] },
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

  // THEME_SECTORS 에서 새로 들어온 종목들.
  MRVL: '마벨테크놀로지', UMC: 'UMC', GFS: '글로벌파운드리', ASX: 'ASE테크놀로지',
  TER: '테라다인', AMKR: '앰코테크놀로지', ONTO: '온투이노베이션',
  CRDO: '크레도테크놀로지', ALAB: '아스테라랩스',
  SNPS: '시놉시스', CDNS: '케이던스', ARM: 'ARM홀딩스',
  DELL: '델테크놀로지스', SMCI: '슈퍼마이크로컴퓨터', HPE: 'HPE',
  COHR: '코히런트', LITE: '루멘텀', CIEN: '시에나', FN: '팹리넷',
  MSI: '모토로라솔루션스', UI: '유비쿼티', EXTR: '익스트림네트웍스',
  APH: '앰페놀', TEL: 'TE커넥티비티', GLW: '코닝',
  VRT: '버티브', ETN: '이튼', EMR: '에머슨일렉트릭', GNRC: '제너랙',
  TT: '트레인테크놀로지스', JCI: '존슨콘트롤스', MOD: '모다인',
  PWR: '콴타서비스', EME: 'EMCOR', MTZ: '매스텍', FIX: '컴포트시스템즈',
  DLR: '디지털리얼티', IRM: '아이언마운틴',
  AEP: '아메리칸일렉트릭파워', ED: '콘에디슨', EXC: '엑셀론', PPL: 'PPL',
  HUBB: '허벨', POWL: '파월인더스트리스', NVT: 'nVent일렉트릭',
  GEV: 'GE버노바', CMI: '커민스', NRG: 'NRG에너지', TLN: '탈렌에너지',
  PEG: '퍼블릭서비스엔터프라이즈',
  BWXT: 'BWX테크놀로지스', LEU: '센트루스에너지',
  SMR: '뉴스케일파워', OKLO: '오클로', NNE: '나노뉴클리어에너지',
  CCJ: '카메코', UEC: '우라늄에너지', NXE: '넥스젠에너지', UUUU: '에너지퓨얼스',
  FLNC: '플루언스에너지', ENPH: '엔페이즈에너지',
  FSLR: '퍼스트솔라', NXT: '넥스트래커', RUN: '선런',
  LNG: '셰니어에너지', EQT: 'EQT', WMB: '윌리엄스', KMI: '킨더모건', TRGP: '타가리소시스',
  ZS: '지스케일러', S: '센티넬원',
  NOW: '서비스나우', WDAY: '워크데이', HUBS: '허브스팟',
  AI: 'C3.ai', SNOW: '스노우플레이크', PATH: '유아이패스', TEAM: '아틀라시안',
  TDC: '테라데이타', CFLT: '컨플루언트', MDB: '몽고DB',
  DDOG: '데이터독', DT: '다이나트레이스', GTLB: '깃랩', ESTC: '일래스틱',
  FI: '파이서브', FIS: 'FIS', GPN: '글로벌페이먼츠', AFRM: '어펌',
  AXP: '아메리칸익스프레스', TOST: '토스트',
  HOOD: '로빈후드', SCHW: '찰스슈왑', IBKR: '인터랙티브브로커스', SOFI: '소파이',
  MSTR: '스트래티지', MARA: '마라홀딩스', RIOT: '라이엇플랫폼스',
  ROK: '로크웰오토메이션', ZBRA: '지브라테크놀로지스', SERV: '서브로보틱스',
  MBLY: '모빌아이', AUR: '오로라이노베이션', UBER: '우버',
  KTOS: '크라토스디펜스', AVAV: '에어로바이런먼트', RCAT: '레드캣홀딩스', ONDS: '온다스홀딩스',
  GD: '제너럴다이내믹스', LHX: 'L3해리스',
  RKLB: '로켓랩', ASTS: 'AST스페이스모바일', IRDM: '이리듐', PL: '플래닛랩스',
  IONQ: '아이온큐', RGTI: '리게티컴퓨팅', QBTS: 'D-Wave퀀텀', QUBT: '퀀텀컴퓨팅',
  BIIB: '바이오젠',
  CRSP: '크리스퍼테라퓨틱스', NTLA: '인텔리아테라퓨틱스', BEAM: '빔테라퓨틱스', ILMN: '일루미나',
  NVO: '노보노디스크', VKTX: '바이킹테라퓨틱스',
  ISRG: '인튜이티브서지컬', MDT: '메드트로닉', SYK: '스트라이커', BSX: '보스턴사이언티픽',
};

// 거래대금 비중을 시장 안에서 비교해도 되는가.
//
// 양쪽 다 개별 종목만 담고 있으므로 서로 비교됩니다.
// 미국이 한때 false 였던 이유는 섹터 ETF 와 개별 종목이 섞여 있었기 때문입니다. 개별
// 대형주는 ETF 보다 거래대금이 훨씬 커서, 섞어서 비중을 내면 메모리 하나가 70% 를
// 차지하는 허수가 나왔습니다. 바스켓을 개별 종목으로 통일하면서 그 문제가 사라졌습니다.
// 이 스위치는 남겨 둡니다 — 언젠가 다시 ETF 를 섞는다면 그때 false 로 돌려야 합니다.
const TURNOVER_COMPARABLE = { KR: true, US: true, THEME: true };

// 벤치마크. RS 는 "무엇 대비 강한가"이므로 이 값이 지표의 기준점입니다.
const BENCHMARKS = {
  KR: { code: 'KS11', name: '코스피' },
  US: { code: 'SPY', name: 'S&P 500' },
  THEME: { code: 'SPY', name: 'S&P 500' },
};

// 화면의 탭 하나 = 여기 한 줄. generate-sector-rs.js 가 이 순서대로 계산하고,
// sector-rs.html·heatmap.html 은 만들어진 것만 탭으로 그립니다.
//   dir      data/<dir>/<코드>.json 을 읽습니다
//   defs     그 시장의 섹터 목록
//   flag     탭 앞에 붙는 기호 (화면 전용)
// THEME 은 US 와 같은 data/us 파일을 읽습니다. 시세 파일은 하나면 충분하고,
// 다른 건 "어떻게 묶어 보는가"뿐이기 때문입니다.
const MARKETS = [
  { key: 'KR',    label: '한국',        dir: 'kr', flag: '🇰🇷', hasForeign: true },
  { key: 'US',    label: '미국',        dir: 'us', flag: '🇺🇸', hasForeign: false },
  { key: 'THEME', label: 'AI·성장 테마', dir: 'us', flag: '🌐', hasForeign: false },
];

const SECTOR_DEFS = { KR: KR_SECTORS, US: US_SECTORS, THEME: THEME_SECTORS };

// 데이터가 자동으로 갱신되는 시각.
//
// .github/workflows/refresh-kr-data.yml 의 cron 과 반드시 같아야 합니다. 한쪽만 고치면
// 화면이 오지 않을 갱신 시각을 안내하게 되는데, 그건 틀린 걸 알아챌 방법이 없습니다.
// 그래서 scripts/test-sector-rs.js 가 워크플로우 파일을 읽어 이 표와 대조합니다.
//
// day 는 UTC 요일(0=일). 두 실행 모두 월~금이고, 22:30 UTC 는 한국시간으로 다음 날
// 아침이라 화면에는 화~토 07:30 으로 보입니다.
const REFRESH_SCHEDULE = {
  timeZone: 'Asia/Seoul',
  runs: [
    { cron: '30 9 * * 1-5',  hourUtc: 9,  minuteUtc: 30, daysUtc: [1, 2, 3, 4, 5], scope: 'KR' },
    { cron: '30 22 * * 1-5', hourUtc: 22, minuteUtc: 30, daysUtc: [1, 2, 3, 4, 5], scope: 'ALL' },
  ],
};

// 미국에서 실제로 받아와야 하는 심볼 = US·THEME 두 목록의 구성 심볼 + 벤치마크.
// generate-us-data.js 가 이 함수를 수집 목록으로 씁니다.
function usSymbols() {
  const set = new Set([BENCHMARKS.US.code, BENCHMARKS.THEME.code]);
  for (const s of [...US_SECTORS, ...THEME_SECTORS]) for (const c of s.codes) set.add(c);
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

module.exports = {
  KR_SECTORS, US_SECTORS, THEME_SECTORS, SECTOR_DEFS, MARKETS,
  US_NAMES, BENCHMARKS, TURNOVER_COMPARABLE, REFRESH_SCHEDULE, usSymbols, PERIODS,
};
