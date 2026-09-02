// 한국 주식 지원 종목 목록 — 이 파일이 단 하나의 원본입니다.
//
// scripts/generate-kr-data.js 가 이 목록을 읽어서
//   1) data/kr/{code}.json  (일봉 시세)
//   2) 15개 HTML 페이지 안의 KR_STOCKS 표 (종목명 → 코드)
// 둘 다 만들어냅니다. 그래서 "검색은 되는데 데이터가 없는 종목"이 생길 수 없습니다.
//
// 종목을 추가하려면 여기에 한 줄 넣고 생성기를 다시 돌리면 됩니다.
//   code    : 6자리 종목코드 (지수는 KS11 / KQ11)
//   name    : 대표 표기명 (검색어로도 쓰임)
//   market  : 'KS'(코스피/ETF) | 'KQ'(코스닥) | 'IDX'(지수)
//   aliases : 같은 종목을 부르는 다른 이름들

const KR_TICKERS = [
  // ── 코스피 대형주 ──
  { code: '005930', name: '삼성전자', market: 'KS' },
  { code: '000660', name: 'SK하이닉스', market: 'KS' },
  { code: '000990', name: 'DB하이텍', market: 'KS' },
  { code: '373220', name: 'LG에너지솔루션', market: 'KS' },
  { code: '207940', name: '삼성바이오로직스', market: 'KS' },
  { code: '005380', name: '현대차', market: 'KS', aliases: ['현대자동차'] },
  { code: '000270', name: '기아', market: 'KS', aliases: ['기아차'] },
  { code: '068270', name: '셀트리온', market: 'KS' },
  { code: '035420', name: 'NAVER', market: 'KS', aliases: ['네이버'] },
  { code: '035720', name: '카카오', market: 'KS' },
  { code: '051910', name: 'LG화학', market: 'KS' },
  { code: '006400', name: '삼성SDI', market: 'KS' },
  { code: '005490', name: 'POSCO홀딩스', market: 'KS', aliases: ['포스코홀딩스', '포스코'] },
  { code: '012330', name: '현대모비스', market: 'KS' },
  { code: '204320', name: 'HL만도', market: 'KS', aliases: ['만도'] },
  { code: '161390', name: '한국타이어앤테크놀로지', market: 'KS', aliases: ['한국타이어'] },
  { code: '066570', name: 'LG전자', market: 'KS' },
  { code: '009150', name: '삼성전기', market: 'KS' },
  { code: '028260', name: '삼성물산', market: 'KS' },
  { code: '034730', name: 'SK', market: 'KS' },
  { code: '003550', name: 'LG', market: 'KS' },
  { code: '402340', name: 'SK스퀘어', market: 'KS' },

  // ── 금융 ──
  { code: '105560', name: 'KB금융', market: 'KS' },
  { code: '055550', name: '신한지주', market: 'KS' },
  { code: '086790', name: '하나금융지주', market: 'KS' },
  { code: '316140', name: '우리금융지주', market: 'KS' },
  { code: '024110', name: '기업은행', market: 'KS' },
  { code: '032830', name: '삼성생명', market: 'KS' },
  { code: '000810', name: '삼성화재', market: 'KS' },
  { code: '323410', name: '카카오뱅크', market: 'KS' },
  { code: '006800', name: '미래에셋증권', market: 'KS' },
  { code: '016360', name: '삼성증권', market: 'KS' },
  { code: '071050', name: '한국금융지주', market: 'KS' },
  { code: '039490', name: '키움증권', market: 'KS' },

  // ── 에너지·산업재·방산 ──
  { code: '015760', name: '한국전력', market: 'KS', aliases: ['한전'] },
  { code: '034020', name: '두산에너빌리티', market: 'KS' },
  { code: '012450', name: '한화에어로스페이스', market: 'KS' },
  { code: '042660', name: '한화오션', market: 'KS' },
  { code: '009540', name: 'HD한국조선해양', market: 'KS' },
  { code: '329180', name: 'HD현대중공업', market: 'KS' },
  // 'KAI' 는 뉴욕증권거래소 Kadant Inc. 의 티커라 별칭에서 뺐습니다.
  { code: '047810', name: '한국항공우주', market: 'KS' },
  { code: '010130', name: '고려아연', market: 'KS' },
  { code: '096770', name: 'SK이노베이션', market: 'KS' },
  { code: '011200', name: 'HMM', market: 'KS' },
  { code: '003490', name: '대한항공', market: 'KS' },
  { code: '000720', name: '현대건설', market: 'KS' },
  { code: '064350', name: '현대로템', market: 'KS' },
  { code: '079550', name: 'LIG넥스원', market: 'KS' },
  { code: '010140', name: '삼성중공업', market: 'KS' },
  { code: '010620', name: 'HD현대미포', market: 'KS' },
  { code: '267260', name: 'HD현대일렉트릭', market: 'KS' },
  { code: '298040', name: '효성중공업', market: 'KS' },
  { code: '010120', name: 'LS ELECTRIC', market: 'KS', aliases: ['LS일렉트릭'] },
  { code: '047040', name: '대우건설', market: 'KS' },
  { code: '006360', name: 'GS건설', market: 'KS' },
  { code: '011170', name: '롯데케미칼', market: 'KS' },
  { code: '011780', name: '금호석유', market: 'KS', aliases: ['금호석유화학'] },
  { code: '004020', name: '현대제철', market: 'KS' },
  { code: '028670', name: '팬오션', market: 'KS' },

  // ── 통신·소비재 ──
  { code: '017670', name: 'SK텔레콤', market: 'KS', aliases: ['SKT'] },
  { code: '030200', name: 'KT', market: 'KS', aliases: ['케이티'] },
  { code: '032640', name: 'LG유플러스', market: 'KS', aliases: ['LGU+', 'LG유플'] },
  { code: '033780', name: 'KT&G', market: 'KS' },
  { code: '097950', name: 'CJ제일제당', market: 'KS' },
  { code: '139480', name: '이마트', market: 'KS' },
  { code: '090430', name: '아모레퍼시픽', market: 'KS' },
  { code: '161890', name: '한국콜마', market: 'KS' },
  { code: '192820', name: '코스맥스', market: 'KS' },
  { code: '012510', name: '더존비즈온', market: 'KS' },
  { code: '128940', name: '한미약품', market: 'KS' },
  { code: '000100', name: '유한양행', market: 'KS' },
  { code: '454910', name: '두산로보틱스', market: 'KS' },

  // ── 게임·엔터 ──
  { code: '259960', name: '크래프톤', market: 'KS' },
  { code: '352820', name: '하이브', market: 'KS', aliases: ['HYBE'] },
  { code: '036570', name: '엔씨소프트', market: 'KS', aliases: ['NC소프트'] },
  { code: '251270', name: '넷마블', market: 'KS' },

  // ── 반도체 장비 ──
  { code: '042700', name: '한미반도체', market: 'KS' },

  // ── ETF ──
  { code: '069500', name: 'KODEX 200', market: 'KS', aliases: ['코덱스200'] },
  { code: '122630', name: 'KODEX 레버리지', market: 'KS', aliases: ['코덱스레버리지'] },
  // 국고채 10년 ETF. 공포·탐욕 지수의 "안전자산 선호"가 이 종목을 씁니다 —
  // CNN 이 주식 대비 국채 수익률 차이를 보는 것과 같은 자리입니다(scripts/fear-greed.js).
  // 3년물이 아니라 10년물인 이유는 듀레이션이 길어야 위험회피가 가격에 크게 찍히기 때문입니다.
  { code: '148070', name: 'KOSEF 국고채10년', market: 'KS', aliases: ['코세프국고채10년', '국고채10년'] },

  // ── 코스닥 ──
  { code: '247540', name: '에코프로비엠', market: 'KQ' },
  { code: '086520', name: '에코프로', market: 'KQ' },
  { code: '196170', name: '알테오젠', market: 'KQ' },
  { code: '028300', name: 'HLB', market: 'KQ' },
  { code: '058470', name: '리노공업', market: 'KQ' },
  { code: '277810', name: '레인보우로보틱스', market: 'KQ' },
  { code: '263750', name: '펄어비스', market: 'KQ' },
  { code: '293490', name: '카카오게임즈', market: 'KQ' },
  // 'SM' 은 뉴욕증권거래소 SM Energy 의 티커라 별칭에서 뺐습니다.
  { code: '041510', name: '에스엠', market: 'KQ', aliases: ['SM엔터'] },
  { code: '039030', name: '이오테크닉스', market: 'KQ' },
  { code: '240810', name: '원익IPS', market: 'KQ' },
  { code: '112040', name: '위메이드', market: 'KQ' },
  { code: '066970', name: '엘앤에프', market: 'KQ' },
  { code: '095340', name: 'ISC', market: 'KQ' },
  { code: '403870', name: 'HPSP', market: 'KQ' },
  { code: '053800', name: '안랩', market: 'KQ' },
  { code: '030520', name: '한글과컴퓨터', market: 'KQ', aliases: ['한컴'] },
  { code: '122870', name: '와이지엔터테인먼트', market: 'KQ', aliases: ['YG엔터', 'YG'] },
  { code: '035900', name: 'JYP Ent.', market: 'KQ', aliases: ['JYP엔터', 'JYP'] },
  { code: '108490', name: '로보티즈', market: 'KQ' },

  // ── 지수 ──
  { code: 'KS11', name: '코스피', market: 'IDX', aliases: ['KOSPI'] },
  { code: 'KQ11', name: '코스닥', market: 'IDX', aliases: ['KOSDAQ'] },
];

// 야후 파이낸스에서 쓰는 심볼로 바꿉니다. (005930 → 005930.KS, KS11 → ^KS11)
function yahooSymbol(t) {
  if (t.market === 'US') return t.code; // 미국 종목은 접미사가 없습니다. (AAPL, XLV …)
  return t.market === 'IDX' ? `^${t.code}` : `${t.code}.${t.market}`;
}

// 검색어 정규화: 공백 제거 + 대문자. ("sk 하이닉스" 와 "SK하이닉스" 를 같게 취급)
function normalizeKrName(s) {
  return String(s || '').trim().replace(/\s+/g, '').toUpperCase();
}

module.exports = { KR_TICKERS, yahooSymbol, normalizeKrName };
