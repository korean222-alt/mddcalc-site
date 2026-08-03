# 진행 상황 인수인계

새 대화창에서 이어서 작업할 때 이 문서부터 읽으면 됩니다.
애드센스 거절 원인 분석과 지금까지의 수정 이력은 `docs/adsense-work-log.md` 에 따로 있습니다.
이 문서는 **그 이후에 한 일과 남은 일**만 다룹니다.

최종 갱신: 2026-08-01
작업 브랜치: `claude/korean-stock-symbols-lf6o5g`

---

## 0. 지금 상태 한눈에

| 항목 | 상태 |
|---|---|
| 애드센스 | 거절(2026-07-25). **아직 재신청 안 함** |
| 사이트 개설 | 2026-07-08 → 현재 약 3.5주 |
| 사이트맵 | 109개 URL (종목 69 / 블로그 25 / 기본 15) |
| 트래픽 | 하루 0~1명 |
| 검색 실적(3개월) | 클릭 33 / 노출 186 |
| 쿠팡 파트너스 배너 | 도구 페이지 9개에 적용됨 (**재신청 직전에 뺄 것**) |

### 재신청 전략 (합의된 내용)

1. **최소 2~4주 더 기다린다.** 도메인 나이가 지금 가장 큰 감점 요인이고,
   거절 통보 직후 재신청은 특히 불리하다.
2. **손볼 것 다 손보고 → 며칠 안정화 → 그다음 신청.** 개편과 신청을 동시에 하지 않는다.
   (작업 로그 5장: 심사 중 대규모 개편이 진행 중이면 심사자가 승인을 피한다)
3. **재신청 직전 쿠팡 배너를 뺀다.** 아래 4장 참고.

---

## 1. 이번에 끝낸 일

### (1) 한국 종목 지원 — 이미 되어 있었고, 터지던 버그를 잡음

`data/kr/` 에 67개 종목(삼성전자·SK하이닉스·코스피·코스닥 포함)이 정적 파일로 있고,
평일 18:30 KST 에 GitHub Actions 가 갱신한다. 검색·조회 로직은 전부 구현돼 있었다.

**고친 버그**: chart.js 를 CDN에서 받는데 광고 차단기·방화벽에 막히면 `drawDDChart` 가
던진 예외가 `render → setPreset → loadData` 의 catch 까지 올라갔다. 그래서 시세는 정상적으로
받아왔는데도 "데이터를 불러오지 못했어요" 라는 엉뚱한 메시지가 뜨고 MDD 숫자까지 사라졌다.

- `render()` 의 각 조각을 `renderStep()` 으로 감쌈 (index.html)
- 차트 두 개는 `Chart` 가 없으면 캔버스 자리에 안내만 남기고 넘어감

검증: 삼성전자/SK하이닉스/코스피/코스닥/6자리 코드/`.KS` 접미사/소문자/공백 등
13개 입력을 chart.js 차단·정상 양쪽에서 확인 → 13/13 통과.

> ⚠️ `mdd.html` 은 noindex 걸린 레거시 페이지(사용자 본인 API 키 방식)라 한국 종목
> 지원이 없다. 어디서도 링크되지 않으므로 그대로 두고 있다.

### (2) 계산기 8개 콘텐츠 보강 (거절 원인 대응)

리서치에서 지목된 "계산기 사이트 거절의 단골 사유 = 입력창 하나에 짧은 설명뿐"에 대응.
**실제 숫자로 푼 예시**가 전 페이지 통틀어 0개였던 게 핵심 결함이었다.

각 페이지에 `숫자로 따라가 보기` 예시 블록 + FAQ 3문항 추가:

| 페이지 | 이전 | 이후 | FAQ |
|---|---|---|---|
| index.html | 4,295자 | 5,333자 | 7문항 |
| rsi-calculator.html | 2,201자 | 3,159자 | 5문항 |
| dividend-calculator.html | 2,449자 | 3,275자 | 5문항 |
| compound-calculator.html | 2,409자 | 3,251자 | 5문항 |
| dca-planner.html | 2,462자 | 3,268자 | 5문항 |
| fx-calculator.html | 2,344자 | 3,104자 | 5문항 |
| roi-calculator.html | 2,213자 | 2,999자 | 5문항 |
| leverage-etf-simulator.html | 2,174자 | 3,080자 | 5문항 |

> **중요**: 예시의 숫자는 지어낸 게 아니라 각 계산기를 브라우저에서 실제로 돌려 받은
> 출력을 그대로 옮긴 것이다. 계산 로직을 바꾸면 예시 숫자도 같이 갱신해야 한다.
> (rsi·leverage 두 곳만 손으로 검산 가능한 산수 예시를 썼다)

### (3) 종목 페이지 생성기 개선 (`scripts/generate-stock-pages.js`)

**아직 실행되지 않았다.** 코드만 고쳐둔 상태다. 3장 참고.

- **분류별 섹션 분화**: 69개가 전부 같은 섹션 구성이라 "한 틀로 찍어낸 페이지"로 보이던 문제.
  `CATEGORY` 맵을 추가해 5종으로 나누고 각각 다른 카드를 붙인다.
  - `leveraged`(10개) / `inverse`(2개) → 변동성 감쇠 설명 + 배수 이탈
  - `income`(SCHD·JEPI·JEPQ) → 이 수치가 분배금 제외 주가 기준이라는 설명
  - `index`(SPY·QQQ·VOO·VTI·IVV·SOXX) → 지수 ETF의 회복 특성
  - `asset`(TLT·GLD) → 주식과 다른 자산군
  - `stock`(나머지 46개) → 개별 기업은 회복이 보장되지 않음
- **회복 필요 상승률** 지표 추가 (`recoveryGainPct`). −50%는 +100%가 있어야 본전이라는,
  이 사이트의 핵심 개념을 종목마다 실제 숫자로 보여준다.
- **벤치마크 비교 버그 수정**: IVV가 SPY와 비교되어 "−56.5%는 SPY보다 **0.0%p 더 깊었습니다**",
  VOO가 "17.1%로 SPY(17.1%)보다 **높았습니다**" 라고 쓰고 있었다.
  `SP500_TRACKERS`(SPY·VOO·IVV)는 비교 섹션을 건너뛰고, 차이가 0.1%p 미만이면
  "사실상 같은 수준" 으로 표현하도록 고쳤다.

### (4) 쿠팡 파트너스 배너

- 도구 페이지 9개(index, tools, 계산기 7개)의 푸터 위에 삽입
- **정책 페이지(privacy/terms/disclaimer/about/contact)와 블로그에는 넣지 않았다** —
  심사자가 규정 준수를 확인하러 보는 페이지다
- 화면 폭에 따라 배너를 고른다: PC/태블릿 `1012747`(680×140), 모바일 `1012749`(329×140).
  쿠팡이 주는 코드는 width 가 고정이라 그대로 넣으면 모바일에서 가로 스크롤이 생긴다
- **공정거래위원회 대가성 고지 문구**를 배너 아래 표기 (법적 의무)
- `g.js` 가 차단되면 고지 문구까지 통째로 숨겨 빈 상자가 남지 않게 처리

검증: 9페이지 × 4폭(375/393/768/1280) 전부 가로 넘침 0px.

### (5) 기타

- 홈 FAQ의 "한국 주식은 현재 지원하지 않습니다" 가 사실과 달라 정정

---

## 2. 남은 일 (우선순위 순)

### 🔴 A. 종목 페이지 생성기 실행 — 코드는 됐고 실행만 남음

**로컬에서는 못 돌린다.** `TWELVE_DATA_API_KEY` 가 필요한데 GitHub Actions 시크릿에만 있다.

```
Actions 탭 > Refresh stock report pages > Run workflow
(ref 를 claude/korean-stock-symbols-lf6o5g 로 골라 브랜치에서 먼저 검증 가능)
```

실행 후 확인할 것:
- [ ] `stock/soxl.html` 에 변동성 감쇠 섹션이 붙었는지
- [ ] `stock/ivv.html` 에서 SPY 비교 섹션이 사라졌는지
- [ ] `stock/schd.html` 에 분배금 관련 섹션이 붙었는지
- [ ] `stock/tsla.html` 에 개별 기업 섹션이 붙었는지
- [ ] 페이지 평균 분량이 1,949자에서 얼마나 늘었는지

### 🟡 B. 에디토리얼 페이지 5~8개 추가 (분모 늘리기)

종목 페이지가 사이트맵의 63%(69/109)를 차지하는 게 최대 콘텐츠 리스크다.
**페이지를 지우는 게 아니라 비템플릿 콘텐츠를 늘려 비중을 낮추는** 방향으로 합의했다.

손으로 쓴 비교/정리 글 후보:
- 반도체 3배 레버리지 ETF 4종(SOXL·SPXL·UPRO·TQQQ) MDD 비교
- 코스피 역대 하락장 정리 ← `data/kr/KS11.json` 활용
- 한국 주식 MDD 조회하는 법
- 커버드콜 ETF(JEPI·JEPQ) vs 배당성장 ETF(SCHD)

8개 추가하면 63% → 59%. 종목 페이지에 인바운드 링크도 생긴다.

### 🟢 C. 재신청 직전 체크리스트

- [ ] 쿠팡 배너 제거 (4장)
- [ ] Search Console URL 검사로 종목 페이지 몇 개가 "Google에 등록되어 있음"인지 확인
- [ ] 며칠간 변경 없이 안정화
- [ ] 재신청

### ⚪ D. 승인 후에 할 일 (작업 로그 7장에서 이어짐)

- [ ] 문의용 이메일 `gktgkt2309@gmail.com` 을 사이트에서 제거 (개인 계정)
- [ ] 광고 슬롯(`<ins class="adsbygoogle">`) 배치 — 현재 로더 스크립트만 있고 슬롯은 0개

---

## 3. 하지 말 것 (이유와 함께)

- **종목 페이지를 지우지 말 것.** 7월에 24개 지웠다가 이미 색인된 URL이 전부 404가 나서
  복구했다. 지금은 69개다. 검색 실적상 종목 검색어의 클릭이 0~1인 건 사실이지만,
  이는 페이지 품질이 아니라 순위 문제다(사이트 3주차, 일 방문 0~1명).
  노출 53회는 구글이 후보로 인정하고 있다는 뜻이고, 지우면 색인 콘텐츠가 급감한다.
- **한국 종목 67개를 `/stock/` 페이지로 자동 생성하지 말 것.**
  136/178 = 76%가 되어 "찍어낸 페이지" 패턴이 확정된다.
  한국 종목은 **홈 계산기 기능으로만** 두는 게 맞다. 페이지 수를 안 늘리면서 도구의
  고유 가치는 올리는 방향이라 지금 구조가 이상적이다.
- **사이트맵을 반복 재제출하지 말 것.** 이미 인식돼 있고 추가 이득이 없다.
- **심사 중 대규모 구조 변경 금지.**

---

## 4. 쿠팡 배너 제거 방법

각 페이지에서 아래 두 주석 **사이를 통째로** 지우면 된다. 다른 코드와 얽혀 있지 않다.

```html
<!-- COUPANG_PARTNERS_START ... -->
...
<!-- COUPANG_PARTNERS_END -->
```

대상 9개 파일: `index.html`, `tools.html`, `rsi-calculator.html`,
`dividend-calculator.html`, `compound-calculator.html`, `dca-planner.html`,
`fx-calculator.html`, `roi-calculator.html`, `leverage-etf-simulator.html`

한 번에 지우려면:

```bash
node -e '
const fs=require("fs");
for (const f of ["index.html","tools.html","rsi-calculator.html","dividend-calculator.html",
  "compound-calculator.html","dca-planner.html","fx-calculator.html","roi-calculator.html",
  "leverage-etf-simulator.html"]) {
  const h=fs.readFileSync(f,"utf8");
  const out=h.replace(/<!-- COUPANG_PARTNERS_START[\s\S]*?COUPANG_PARTNERS_END -->\n*/g,"");
  if(out!==h){ fs.writeFileSync(f,out); console.log("제거:",f); }
}'
```

---

## 4-1. 홍보/노출 자동화 (2026-08-03 추가)

"사이트를 자동으로 홍보해달라"는 요청으로 넣은 것들이다.
**커뮤니티에 글을 자동으로 올리는 기능은 넣지 않았다.** 각 플랫폼 약관 위반이고,
도메인이 스팸으로 찍히면 애드센스 재신청이 더 어려워진다. 대신 "사용자가 자발적으로
퍼뜨릴 때 출처가 따라가게" + "검색엔진이 빨리 알게" 두 갈래로 만들었다.

### (1) 결과 이미지 카드 — `index.html`

분석 결과 밑에 `🖼️ 결과 이미지로 저장 · 공유` 버튼이 생겼다. 1080x1350 JPEG 한 장에
종목명·하락률·차트·`mddcalc.com` 이 함께 들어간다. 카톡에 올리면 도메인이 같이 간다.

- 휴대폰: `navigator.share` 공유 시트 → "이미지 저장"으로 갤러리에 바로 들어감
- PC / 공유 미지원 브라우저: 자동으로 다운로드로 대체
- 관련 함수: `buildShareCard` / `drawShareDDChart` / `shareResultImage`
- 차트는 Chart.js 를 쓰지 않고 캔버스에 직접 그린다. **광고 차단기로 CDN 이 막혀도
  이미지 카드는 나와야 하기 때문이다.** Chart.js 인스턴스에서 가져오도록 바꾸지 말 것.
- PNG 가 아니라 JPEG(q92)다. 같은 카드가 PNG 780KB / JPEG 116KB 인데 눈으로 차이가 없다.
- `navigator.share` 는 사용자 제스처가 살아있는 동안만 호출할 수 있어서, 비동기 `toBlob`
  대신 동기 `toDataURL` → `File` 로 만든다. **`await` 를 끼워넣으면 iOS 에서 깨진다.**

### (2) 미리보기 썸네일 (og:image) — 메인 페이지만

지금까지 109개 페이지 전부 `og:image` 가 없어서 링크를 공유해도 썸네일이 안 떴다.
메인만 붙였다(요청 범위).

```bash
node scripts/generate-og-image.js   # scripts/og-template.html → og-image.jpg (1200x630)
```

- npm 의존성 없이 로컬 크롬의 헤드리스 스크린샷만 쓴다. 못 찾으면 `CHROME_PATH` 로 알려주면 된다.
- 헤드리스 크롬의 `--window-size` 는 창 크기라 뷰포트가 85px쯤 작게 잡힌다. 그래서
  넉넉하게 찍고 위쪽 1200x630 만 잘라낸다. 이 크롭을 빼면 아래가 흰 띠로 잘린다.
- 문구를 바꾸려면 `scripts/og-template.html` 을 고치고 위 명령을 다시 돌린다.
- 카톡·네이버는 썸네일을 캐시한다. 바꾼 뒤 바로 반영이 안 되면
  [카카오 디버거](https://developers.kakao.com/tool/debugger/sharing) 에서 캐시를 지운다.

### (3) 검색엔진 자동 통보 — `.github/workflows/notify-search-engines.yml`

main 에 HTML 이 올라가면 자동으로 돈다.

```bash
node scripts/sitemap-lastmod.js            # lastmod 를 실제 커밋 날짜로 교정
node scripts/sitemap-lastmod.js --check    # 어긋난 게 있는지만 확인 (있으면 종료코드 1)
node scripts/submit-indexnow.js a.html b.html   # 지정 페이지를 IndexNow 로 통보
node scripts/submit-indexnow.js --all           # sitemap 전체 통보
node scripts/submit-indexnow.js --dry-run ...   # 보내지 않고 목록만 확인
```

- **IndexNow 를 받는 곳은 빙·네이버·얀덱스다. 구글은 IndexNow 를 쓰지 않는다.**
  구글 쪽은 `lastmod` 가 정확한 sitemap 이 담당한다. 그래서 두 개가 한 세트다.
- 기존 sitemap 의 lastmod 15개가 `2026-07-25` 로 굳어 있던 것을 전부 교정했다.
  크롤러는 lastmod 가 거짓이라고 판단하면 그 뒤로 아예 무시한다.
- 키 파일 `3a437d1698d094bb66ae274682805aa8.txt` 는 **비밀이 아니다.** 사이트 루트에
  그대로 올라가 있어야 소유 검증이 되고, 지우면 403 으로 전부 거부된다.
- 수동 실행(Actions 탭 > Run workflow)하면 전체 URL 을 다시 통보한다. 색인이 밀렸을 때 쓴다.

> ⚠️ **배포 후 한 번 확인할 것**: `https://mddcalc.com/3a437d1698d094bb66ae274682805aa8.txt`
> 가 열려야 한다. 안 열리면 IndexNow 가 403 으로 전부 거부된다(워크플로는 실패시키지 않고
> 경고만 남기므로 로그를 봐야 안다).

### 아직 안 한 것

- 나머지 108개 페이지의 `og:image` (메인만 해달라는 요청이었음)
- 블로그 RSS 피드
- 커뮤니티 홍보 문구/가이드 문서

---

## 5. 개발 메모

### 빌드 스크립트

```bash
node scripts/generate-blog-pages.js      # 블로그 정적 페이지 (API 키 불필요)
node scripts/generate-kr-data.js         # 한국 주식 데이터 + 15개 HTML의 KR_STOCKS 표
TWELVE_DATA_API_KEY=xxxx node scripts/generate-stock-pages.js   # 종목 리포트 (키 필요)
node scripts/test-kr-parse.js            # 한국 시세 파서 테스트 (5개 케이스)
```

### 알아둘 구조

- 메인 HTML 15개는 **손으로 관리**한다. 공용 JS가 각 파일에 복제돼 있는데,
  차트를 실제로 그리는 건 `index.html` 뿐이라 다른 페이지의 차트 코드는 죽은 코드다.
  그래서 `index.html` 만 다른 14개와 내용이 다르다(원래부터 그랬다).
- `KR_STOCKS` 표와 종목 칩은 `scripts/generate-kr-data.js` 가 자동으로 쓴다.
  직접 고치지 말고 `scripts/kr-tickers.js` 에 한 줄 넣고 생성기를 돌릴 것.
- 종목 추가 시 시세 파일·검색표·칩 버튼이 한 번에 생성돼서
  "검색은 되는데 데이터가 없는 종목"이 생기지 않는 구조다.

### 로컬 확인 방법

브라우저 검증은 Playwright 로 했다. 외부 CDN(chart.js, adsense, 쿠팡)은 샌드박스에서
막히므로 `page.route` 로 스텁을 넣고 사이트 자체 로직만 본다.

```bash
python3 -m http.server 8099    # 저장소 루트에서
```

`/api/*` 는 Vercel 함수라 정적 서버로는 안 돈다(POST 501). 한국 종목은 정적 파일이라
정상 동작하고, 미국 종목 조회와 SPY 벤치마크만 로컬에서 확인이 안 된다.
