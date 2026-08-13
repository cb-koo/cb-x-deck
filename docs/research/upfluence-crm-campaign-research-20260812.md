# Upfluence 인플루언서 CRM·캠페인 관리 리서치

- 작성일: 2026-08-12
- 목적: cb-x-deck에 "콘텐츠 발행 → 인플루언서 캠페인 진행 관리"를 붙이기 위한 비교 리서치 (3번째 대상, Favikon·Influencer Hero 다음)
- 범위: 인플루언서 발굴/디스커버리는 제외. 이미 관계 있는/후보 인플루언서의 관계관리(CRM)·캠페인 진행 관리에 집중.
- 도구: Exa 웹서치/페이지 fetch로 공식 사이트(upfluence.com), 공식 헬프센터(help.upfluence.co), G2/리뷰 블로그를 조사.

---

## 0. Upfluence 한 줄 포지셔닝

Upfluence는 "디스커버리 + CRM(IRM) + 캠페인 관리 + 어필리에이트/판매 귀속 + 글로벌 페이먼트"를 하나로 묶은 **이커머스 중심 인플루언서 마케팅 플랫폼**이다. Shopify/WooCommerce/Amazon과 깊게 연동되어 "콘텐츠"만이 아니라 "그 콘텐츠가 낸 매출"까지 귀속시키는 것이 핵심 차별점이며, 2025~2026년에는 Jaice라는 AI 코파일럿(캠페인 설계·아웃리치 작성·초안 검수까지 자동 수행)을 전면에 내세우고 있다.
(출처: https://www.upfluence.com/ , https://www.upfluence.com/manage-creator-programs)

---

## 1. 인플루언서 CRM (IRM) — Community 앱

### 1.1 구조
- 앱 이름은 **Community (IRM)**. "모든 인플루언서를 한 테이블에서" 보는 중앙 허브로, 캠페인 여부와 무관하게 "함께 작업했거나, 작업 중이거나, 작업할" 모든 인플루언서를 관리한다.
- Community 테이블 vs Campaign 테이블은 별개 화면이다. Community = 전체 인플루언서 데이터베이스/관계 이력, Campaign 테이블 = 특정 캠페인에 배정된 인플루언서의 진행 상태. 한 인플루언서가 여러 캠페인에 동시에 속할 수 있고, Community 프로필에는 "몇 개 캠페인에 참여 중"이 표시된다.
(출처: https://help.upfluence.co/en/articles/7005349-how-to-manage-your-influencer-database-with-the-community-irm-app , https://www.upfluence.com/manage-creator-programs)

### 1.2 관계 상태(Status) — 자동 + 수동 이원 체계
이 부분이 Upfluence IRM의 핵심 설계다. **자동 상태**와 **수동(커스텀) 상태**를 분리해서 운영한다.

| 유형 | 상태명 | 부여 조건 |
|---|---|---|
| 자동 | Lead | 인플루언서가 Community에 처음 추가되면 기본값 |
| 자동 | Contacted | 팀원 누구든 1:1 또는 캠페인 메일을 보내면 자동 전환 |
| 자동 | Engaged (캠페인 사용자만) | 지원서 제출 / 캠페인 테이블에서 수동 Approve / Approve 단계 스킵 시 |
| 수동 | (사용자 정의, 예: VIP·재섭외 대상 등) | 사용자가 직접 지정. 우선순위가 자동보다 높아 자동으로 되돌아가지 않음 |

- 수동 상태를 지우면 해당 인플루언서는 자동 상태 체계로 복귀한다(Lead→Contacted→Engaged 규칙 재적용).
- 상태 아이콘도 커스터마이징 가능.
(출처: https://help.upfluence.co/en/articles/9795200-how-to-manage-influencer-statuses-in-upfluence)

캠페인 내부에서는 이보다 훨씬 세분화된 **스테이지(=파이프라인)** 가 따로 존재한다 (2.3절 참조). 즉 Upfluence는 "관계 전체의 큰 상태(Lead/Contacted/Engaged/커스텀)"와 "캠페인 안에서의 세부 진행 단계"를 계층적으로 분리해 관리한다.

### 1.3 인플루언서 레코드에 담기는 정보
Community 프로필(사이드 패널)에는 아래가 들어간다:
- **연락처/기본정보**: 이름, 이메일, 소셜 핸들, 위치, 언어 등
- **상태(Status)**: 위 1.2
- **태그(Tags)**: 자유 키워드, 팀 전체 공유, 다중 부여·필터링 가능
- **평점(Rating)**: 자체 기준으로 인플루언서를 평가하는 커스텀 값 (팀의 성과/신뢰 판단 축적용)
- **커스텀 값(Custom values)** — Rating은 이 박스 안에 있는 항목 중 하나로 노출됨. 즉 "Custom values"라는 확장 가능한 필드 그룹이 존재
- **머지 필드(Merge fields)**: 프로필별 자유 키/값 (예: product, shoe_size, 반려동물 이름 등). 이메일 개인화에 그대로 꽂힘. 개별 입력 또는 CSV 일괄 업로드/내보내기로 관리
- **캠페인 참여 이력**: 몇 개 캠페인에 참여했는지, 캠페인별 상태
- **어필리에이트 커미션 섹션**: 총 매출·총 커미션 금액(캠페인/전체 단위)
- **연락 이력**: 이메일 스레드, 답장 여부(빨간 편지 아이콘), 응답 점수(response score = 과거 응답 여부·평균 응답 시간)
(출처: https://help.upfluence.co/en/articles/7017109-how-to-add-tags-to-influencers-profiles , https://help.upfluence.co/en/articles/4130922-how-to-add-ratings-to-influencers-profiles , https://help.upfluence.co/en/articles/6989154-how-to-create-custom-merge-fields-for-influencer-outreach , https://help.upfluence.co/en/articles/5361498-how-to-understand-data-on-the-creator-side-panel , https://www.upfluence.com/influencer-marketing/influencer-email-outreach-template)

주의: 공식 문서에서 "메모(note)" 필드를 명시적으로 이름 붙인 문서는 찾지 못했다. 다만 제품 마케팅 페이지(manage-creator-programs)의 UI 목업에는 인플루언서 카드에 자유 텍스트 메모("+ Add note", "mention her launch…", "remember: no Fridays…")가 노출되어, 실제로는 자유 노트 기능이 있는 것으로 보인다(공식 헬프 아티클로 별도 확인은 안 됨 — UI 스크린샷 근거).

### 1.4 화면 구성 — 테이블 뷰
- **Manage Fields**로 표시할 컬럼(필드)을 선택/재배치 — 태그, 평점, 머지필드, 트래킹플랜 관련(할인코드/판매수/총매출 등) 컬럼까지 자유 추가.
- 필터: 캠페인, 리스트, 메일링, 위치, 태그, 상태 등 다축 필터.
- **List(리스트)**: 캠페인과 별개로 인플루언서를 임의로 묶는 저장된 세그먼트 (검색 결과 저장, 벌크 아웃리치 대상 선정 등에 사용).
- **벌크 액션**: 캠페인/리스트/메일링/스트림에 추가, 할인 오퍼 배정, 상태 변경, 데이터 내보내기(CSV/XLSX) 등.
(출처: https://help.upfluence.co/en/articles/7005349-how-to-manage-your-influencer-database-with-the-community-irm-app)

---

## 2. 캠페인 관리

### 2.1 캠페인 3종 타입
캠페인 생성 시 반드시 아래 3가지 중 하나를 선택하며, 타입에 따라 이후 스텝(보상 설정, 이메일 플로우, 진행 상태값)이 달라진다.

| 타입 | 정의 | 물리적 제품 배송 | 고정 보상 | 커미션 |
|---|---|---|---|---|
| Product gifting | 제품 제공 후 리뷰/콘텐츠 기대, 고정비 없음 | O | X | 선택 가능 |
| Paid promotion | 고정비 지급, 제품 배송 없음 | X | O | 선택 가능 |
| Paid promotion with gifting | 제품 배송 + 고정비 지급 | O | O | 선택 가능 |

(출처: https://help.upfluence.co/en/collections/9162103-the-three-campaign-types 및 하위 3개 아티클)

### 2.2 캠페인 생성 플로우 (수동 vs Jaice AI 가이드)
**수동 생성 7단계** (help.upfluence.co "How to create a new Campaign"):
1. 캠페인 타입 선택
2. 기본 정보: 이름, 담당자(오너=알림 수신자), 로고, **판매·활동 트래킹 설정(선택)** — 주문/판매 실적 트래킹 on/off, 클릭·조회 트래킹 on/off, **콘텐츠 트래킹 설정(선택)** — 인스타 스토리 등 성과 공유 요청 여부, 캠페인 키워드/해시태그/멘션
3. 보상(Compensation) 설정 — 고정비/커미션/제품
4. 지원서 폼(Application form) 생성 — 지원, 제품 선택, 오퍼 수락, 계약서 서명, 캠페인 상세 확인이 한 폼에서 처리됨
5. 이메일 기본 설정 — 발신자 이메일(연동된 Gmail/Outlook), 서명. **주의: 발송 시작 후 발신자 변경 불가** (단, 스레드 단위로는 중간 변경 가능하다는 FAQ도 있어 세부 조건이 있음)
6. 퍼블리케이션(게시) 안내문 편집 — 필수 해시태그/멘션, 트래킹 링크, 톤 가이드. 이 내용이 "게시 안내" 이메일에 그대로 삽입됨
7. 캠페인 생성 → 캠페인 테이블 뷰로 리다이렉트

**Jaice AI 가이드 생성** (2025~2026 신규): 브랜드 URL 입력 → AI가 브랜드 프로필 자동완성 → 목표/예산/타깃 오디언스/이상적 크리에이터 프로필을 버블 클릭으로 설정 → 마켓플레이스 노출 여부 → 보상 구조 → 트래킹 플랜 → 제품 시딩 → 신청 브리프(텍스트 생성 또는 PDF 업로드) → 계약서(선택) → 이메일(팔로업 자동 작성 여부) → 발사. AI가 브리프·이메일·팔로업 문구까지 초안을 써준다.
(출처: https://help.upfluence.co/en/articles/6989223-how-to-create-a-new-campaign , https://help.upfluence.co/en/articles/13158687-how-to-create-a-campaign-using-jaice-ai)

### 2.3 캠페인 내부 진행 스테이지(파이프라인) — 전체 상태값
캠페인 테이블에서 인플루언서 1명당 다음 단계 중 하나의 상태를 가진다 (help.upfluence.co "How to understand each stage/status in Campaign"):

| Status | 의미 |
|---|---|
| Ready to invite | 아직 초대 안 보냄 |
| Waiting application | 초대 발송, 응답 대기 (답장 오면 빨간 편지 아이콘) |
| Influencer responded | 지원서 폼으로 지원 완료 |
| Counter-offer received | 인플루언서가 역제안(다른 가격) 제출 |
| Shortlisted / Influencer applied(고정비 캠페인) | 담당자가 Shortlist 클릭 |
| Influencer approved | 승인 클릭(자동 알림 발송) |
| Influencer rejected | 거절(알림 없음, 수동 팔로업 권장) |
| Influencer not interested | 인플루언서가 오퍼 거절 |
| Shipped product | 제품 발송 처리 |
| Draft requested | 초안 요청 메일 발송 |
| Draft(s) to review | 인플루언서가 초안 업로드, 검토 대기 |
| Draft approved | 초안 승인 |
| Ready to publish | 게시 승인, 알림 대기 |
| Publishing | 게시 안내 메일 발송, 게시 대기 |
| Authorized for Payment | 게시 확인 후 결제 승인 |
| Waiting to be claimed | 결제요청 메일 발송, 인보이스/세금서류 대기 |
| Ready to pay | 서류 수집 완료, 결제 앱에서 처리 대기 |

이 스테이지는 **선형이지만 캠페인 타입에 따라 일부 단계가 생략**된다(예: 제품 배송 없는 Paid promotion은 Shipped product 단계 없음). 캠페인 대시보드 상단에 초대 발송 수/숏리스트 수/배송·초안·게시 메일 수신 수/고정비 지급 대상 수를 요약하는 **진행 요약(progress summary)** 바가 있다.
(출처: https://help.upfluence.co/en/articles/7026285-how-to-understand-each-stage-status-in-campaign , https://help.upfluence.co/en/articles/9490861-understanding-the-campaign-table-view)

### 2.4 캠페인 테이블 컬럼 (= 캠페인×인플루언서 조인 레코드의 필드)
- Profile Name, Status, Action(다음 단계 버튼)
- Your Offer(고정비 오퍼), Influencer Price(역제안가)
- Product Gifting(선택 제품), Shipping Address
- Commission(커미션율), Discount Code(전용 할인코드), Affiliate link(전용 어필리에이트 링크)
- 벌크 액션: Invite / Email / Create Payments / Set Offers / New Extra Order / Add Tracking Links / Add to(다른 캠페인·리스트로 이동) / Campaign Data 내보내기
(출처: https://help.upfluence.co/en/articles/9490861-understanding-the-campaign-table-view)

### 2.5 캠페인 단위 메타데이터
- 이름, 오너(알림 수신자), 로고, 타입(3종 중 1)
- 예산: 캠페인 전체 예산(Jaice 플로우에서 total budget + currency로 설정), 인플루언서별 오퍼/커미션율
- 기간: 트래킹 플랜의 Active dates(시작/종료), 콘텐츠 트래킹 기간(CPM/캠페인 비용 입력 시 ROI 자동 계산)
- 지원서 폼, 브리프(텍스트 or PDF), 계약서 템플릿(캠페인 전체 공통 1종, 개별 맞춤은 수동 이메일로 별도 처리)
- 이메일 플로우 설정(발신자, 스텝별 초기메일+팔로업 규칙)
- 트래킹 플랜(할인코드/어필리에이트링크/AST 연결)
- 마켓플레이스 노출 여부(공개 지원 허용 여부)

---

## 3. 아웃리치·커뮤니케이션

### 3.1 이메일 플로우 = "스텝 + 초기메일 + 자동 팔로업"의 조합
캠페인은 타입별로 **4~5개의 프리셋 키 스텝**(초대, 배송 안내, 초안 요청, 게시 안내, 결제 안내 등)을 가지며, 각 스텝은 다음 구조:
- **초기 메일(Initial email)**: 담당자가 액션 버튼(예: "Invite")을 눌러야 수동 발송(1건씩 또는 벌크)
- **자동 팔로업(Follow-up email)**: 응답 없을 시 자동 발송. 구성은 **DELAY(며칠 후) → CONDITION(중단 조건: 답장/지원서 제출/상태 수동 변경) → ACTION(팔로업 메일 발송)** 노드 방식(간단한 시퀀스 빌더 UI로 보임)
- 팔로업은 답장·지원서 제출·상태 변경 시 자동 중단됨(불필요한 스팸성 리마인더 방지)
(출처: https://help.upfluence.co/en/articles/8478732-how-to-set-up-email-automation-for-your-campaign , https://help.upfluence.co/en/articles/10353954-how-to-schedule-automated-follow-up-emails)

### 3.2 발신 방식과 개인화
- 캠페인 이메일은 **담당자 본인의 Gmail/Outlook 계정**에서 발송(플랫폼 도메인이 아님) → 인플루언서 입장에서 "사람이 보낸 메일"로 인식.
- **머지 필드**로 이름/핸들/커스텀 값을 자동 삽입해 대량 발송도 개인화.
- Jaice AI가 각 크리에이터의 플랫폼/언어/니치에 맞춰 템플릿을 변형(같은 템플릿이라도 두 크리에이터가 동일한 문구를 받지 않음).
- 오픈/답장/전환율을 템플릿·시퀀스 단위로 추적해 어떤 문구가 더 잘 통하는지 비교 가능.
(출처: https://www.upfluence.com/influencer-outreach)

### 3.3 벌크 이메일의 4가지 경로
1. 캠페인 모듈 있는 경우: 캠페인 이메일 플로우(권장, 자동 팔로업 포함)
2. 캠페인 모듈 없는 경우: Community 테이블에서 다중 선택 후 "+ Create > Email"
3. 저장된 List에서 벌크 발송
4. Inbox 테이블 뷰에서 팔로업 목적 발송
- CC 주의: 벌크 메일에서 CC하면 그 사람이 "각 인플루언서와의 개별 스레드 전체"에 계속 포함됨.
(출처: https://help.upfluence.co/en/articles/6988949-how-to-mass-email-influencers)

### 3.4 협상(카운터오퍼)
- 지원서 폼에서 인플루언서가 고정비 오퍼에 역제안 가능 → 상태가 "Counter-offer received"로 전환 → 담당자가 검토 후 오퍼 금액을 수정하고 확인 메일 발송(1:1 이메일). 즉 협상은 상태값 + 1:1 이메일 스레드로 처리되며 별도 "협상 로그" UI는 없어 보인다.
(출처: https://www.upfluence.com/guides/upfluence-campaign-management-tutorial)

### 3.5 브리프·계약서 전달
- **브리프**: 지원서 폼에 내장(텍스트 에디터 or PDF 업로드). 권장 구성: 요약 → 다음 단계 플랜 → 보상 → 핵심 제품 소개 → 콘텐츠 실행 디테일(해시태그/CTA) → 이용약관. 무료 템플릿 4종 제공(어필리에이트/고정비/기프팅-경품/기프팅-할인코드).
- **계약서**: 캠페인 전체 공통 1종을 업로드해 "지원 전 서명 필수"로 강제하는 **자동 방식**과, 지원 후 개별 이메일로 맞춤 계약서를 보내는 **수동 방식**이 있음(표로 비교 제공: 자동은 표준화·강제 서명 O, 맞춤화 X / 수동은 반대). 계약서 추가는 소급 적용되지 않음(기존 지원자에게는 요구 안 됨).
(출처: https://help.upfluence.co/en/articles/8637541-how-to-make-a-brief-a-z , https://help.upfluence.co/en/articles/7016907-how-to-add-a-contract-to-your-campaign , https://help.upfluence.co/en/articles/7004653-how-to-set-up-the-application-form-for-influencers)

---

## 4. 콘텐츠·성과 추적 (매출 귀속·어필리에이트·페이먼트 포함)

### 4.1 콘텐츠 수집 — Content 탭 vs Stream 툴
- **Content 탭**(캠페인 전용): 그 캠페인에 배정된 인플루언서만 대상으로, 지정한 해시태그/멘션/키워드가 포함된 게시물을 자동 수집. Instagram(포스트+스토리 별도)/X 등 플랫폼 선택, 트래킹 기간, CPM/캠페인 지출 입력 시 자동 ROI 계산.
- **Stream 툴**(캠페인 무관): 전체 DB의 임의 인플루언서 게시물을 조건 기반으로 추적. Content 탭의 상위 개념.
- 게시물 반영까지 몇 시간~4일 지연, 누락 시 수동 추가 가능. 스토리 트래킹은 크리에이터가 프로 인스타 계정을 연결해야 함.
(출처: https://help.upfluence.co/en/articles/7004646-how-to-track-influencer-posts-with-the-content-tab-in-campaigns)

### 4.2 매출 귀속 — 트래킹 플랜
- **트래킹 플랜**을 캠페인에 붙이면 인플루언서별로 **고유 할인코드**와(플랫폼 지원 시) **고유 어필리에이트 링크**가 자동 생성됨(코드 패턴 커스터마이징 가능, 예: `{{username}}10OFF`).
- 지원 연동: Shopify(코드+링크 모두), WooCommerce/BigCommerce/Magento(코드만, 링크는 AST로 대체), Amazon(Amazon Attribution).
- **AST(Agnostic Sales Tracking)**: 네이티브 연동이 없어도 추적 스크립트를 체크아웃/전체 페이지에 심어 링크 기반으로 매출 귀속. 할인 자동 적용은 안 되지만 클릭·매출 추적 가능.
- 클릭 추적: Total Clicks / CVR(=매출건수÷클릭수) / EPC(=매출액÷클릭수) 지표를 표준 제공.
(출처: https://help.upfluence.co/en/articles/6997271-how-to-set-up-and-track-influencer-sales-with-a-tracking-plan , https://help.upfluence.co/en/articles/7026095-how-to-set-up-and-use-upfluence-s-agnostic-sales-tracking-ast , https://help.upfluence.co/en/articles/8685313-how-to-monitor-both-clicks-and-sales-using-affiliate-links)

### 4.3 성과 대시보드
- 캠페인 **Performance 탭 → Conversions**: 인플루언서별 매출 귀속, 할인코드/링크별 전환 상세.
- **Sales Reporting 대시보드**(전역, 캠페인 가로지르는 뷰): 매출/주문수/아이템수/Amazon 전용 지표(클릭·상세페이지뷰·장바구니추가·브랜드추천보너스)까지 세분화, 크리에이터/트래킹플랜/스토어 단위로 필터. 캠페인 Performance 탭은 "인플루언서당 합산 1줄"인 반면, Reporting 앱은 "전환 이벤트당 1줄"(클릭·조회 등 $0 이벤트도 표시)이라는 명확한 차이가 있음.
- 인플루언서 자신도 Creator Space에서 자기 판매실적을 볼 수 있게 토글 가능(투명성).
(출처: https://help.upfluence.co/en/articles/9414714-how-to-check-and-validate-sales-commissions , https://help.upfluence.co/en/articles/12130328-how-to-use-the-sales-reporting-dashboard)

### 4.4 커미션 검증 → 결제 플로우
1. Performance 탭에서 인플루언서별 총매출/총커미션 확인(취소·환불 주문 제외, 세금/배송비 제외 후 계산)
2. **15일 대기 권장**(환불 유예기간 고려) 후 개별 또는 벌크로 "Authorize" → 결제요청 생성
3. 결제 앱(Payment app)에서 실제 지급

### 4.5 결제(Payment) 앱
- 결제수단: **Upfluence Pay**(자체, 벌크 지원, 기본 120시간/5일 지연, 5% 수수료로 즉시 수령 옵션), **PayPal Payouts**, **오프라인 계좌이체**(수동으로 "Mark as Paid" 처리).
- 결제 상태값: `Unclaimed`(인플루언서가 청구 정보 미입력) → `Ready to pay`(정보 입력 완료) → `Processing`(처리 중) → `Paid` / `Canceled` / `Error`.
- **KYC/세금서류(W-9, W-8, 1099 등)를 플랫폼이 수집·보관** — "컴플라이언스"를 명시적 셀링포인트로 강조.
- 환율 변환 수수료(1~2%) 부담자(브랜드/크리에이터)를 결제 시점에 선택 가능.
(출처: https://help.upfluence.co/en/articles/6993076-how-to-manage-creator-payments-with-the-payment-app , https://help.upfluence.co/en/articles/8768954-how-to-pay-creators-using-upfluence-pay)

---

## 5. 가격 티어 · 타깃 고객

- **공개 가격표 없음.** "Pay only for what you need" — 모듈(Find Creators / Scale Programs / Auto-pilot Plan) × 시트수 × 커뮤니티(DB 접근) 규모로 견적. **연 매출의 %를 떼지 않는 고정 플랫폼비**가 핵심 세일즈 포인트.
- **최소 계약 12개월**(연간 약정), 셀프서비스 무료체험 없음(데모 후 견적).
- 3rd-party 추정 가격대(G2/Vendr/여러 리뷰 블로그 종합, 실제와 차이 가능):
  - 엔트리(Growth, 1시트): 월 $478~800
  - 미드(Scale, 3~5시트): 월 $795~1,750
  - 상위(Business/Enterprise, 10~25시트): 월 $2,000~$5,000+
  - AWS Marketplace 실가: Growth $11,940/yr(1시트·5천 인플루언서 DB), Scale $19,800/yr(5시트·1만), Enterprise $42,600/yr(25시트·2만)
  - Vendr 실거래 중간값: 약 $15,000/yr
- **타깃**: 이커머스/D2C 브랜드(특히 Shopify·WooCommerce·Amazon 셀러) 및 이들을 대행하는 에이전시. 소규모 1인팀도 엔트리 플랜으로 진입 가능하지만, 세일즈 구조·연간계약·시트 기반 과금 특성상 **중견~엔터프라이즈 팀, 다수 담당자가 다수 캠페인을 동시 운영하는 규모**를 실제로 타깃.
- G2 평점 4.6/5(139건), Trustpilot 3.4/5 — 낮은 평점의 대부분은 "월 단위로 해지 가능하다고 들었는데 실제론 12개월 락인"이라는 계약 관련 불만.
(출처: https://www.upfluence.com/pricing , https://aws.amazon.com/marketplace/pp/prodview-4tb2mpef4kzty , https://www.vendr.com/marketplace/upfluence , https://www.creator-hero.com/blog/upfluence-pricing-and-review , https://findclout.com/blog/upfluence , https://www.g2.com/compare/neoreach-vs-upfluence)

---

## 6. 데이터 모델 힌트 (요약 정리)

**인플루언서(Creator) 엔티티**
- 식별: 이름, 소셜 핸들(플랫폼별), 이메일, 위치, 언어
- 관계축: `relationship_status`(자동: Lead/Contacted/Engaged | 수동: 커스텀, 수동이 자동을 오버라이드)
- 분류축: `tags[]`(자유 텍스트, 팀 공유), `rating`(자체 평가 스케일), `custom_values{}`(확장형 키-값, rating 포함), `merge_fields{}`(개인화용 키-값)
- 이력축: 캠페인 참여 목록 + 캠페인별 상태, 이메일 스레드/응답여부/응답점수(response score), 누적 매출·누적 커미션
- (UI 목업 근거, 미확인) 자유 노트

**캠페인(Campaign) 엔티티**
- 메타: 이름, 오너, 로고, `type`(gifting | paid | paid+gifting), 마켓플레이스 노출 여부
- 보상: 고정비 여부/금액, 커미션율, 제품 목록(재고 연동)
- 트래킹: `tracking_plan`(할인코드 패턴, 값, 유효기간, UTM, AST 여부), 클릭 트래킹 on/off
- 콘텐츠: 추적 대상 플랫폼, 해시태그/멘션/키워드 목록, 추적 기간, CPM/지출(ROI 계산용)
- 문서: 지원서 폼 구성, 브리프(텍스트/PDF), 계약서 템플릿(단일, 캠페인당)
- 커뮤니케이션: 이메일 발신자, 스텝별 {초기메일, 팔로업 시퀀스[](delay, stop-condition, action)}

**캠페인×인플루언서(조인) 엔티티** — 실질적으로 "배정" 레코드에 대응
- `stage`(17종 선형 상태, 캠페인 타입별 일부 스킵) — Ready to invite → Waiting application → Influencer responded/Counter-offer received → Shortlisted → Approved/Rejected/Not interested → Shipped product → Draft requested → Draft(s) to review → Draft approved → Ready to publish → Publishing → Authorized for Payment → Waiting to be claimed → Ready to pay
- `offer`(브랜드 제안가), `counter_offer`(인플루언서 역제안가)
- `product_selection`, `shipping_address`
- `commission_rate`, `discount_code`, `affiliate_link`
- 성과 파생값: clicks, sales_count, sales_value, CVR, EPC

**결제(Payment) 엔티티**
- `status`: Unclaimed → Ready to pay → Processing → Paid | Canceled | Error
- `method`: Upfluence Pay | PayPal | Offline wire
- 첨부: 인보이스, 세금서류(W-9/W-8/1099), 은행정보(KYC)

---

## 7. cb-x-deck에 차용할 것 vs 과한 것

### 차용할 만한 것
1. **자동상태 + 수동상태 이원 체계 (1.2)**: 로직으로 굴러가는 기본 상태(예: "연락함"→시스템이 자동 판단)와, 사람이 직접 얹는 상태(예: "재섭외 우선")를 분리하고, 수동이 자동을 이긴다는 규칙. 이건 AGENTS.md의 "라벨과 값은 항상 일치시킨다" 원칙과도 정확히 맞물린다 — 상태가 파생값이면 라벨-값 불일치가 원천적으로 안 생긴다.
2. **캠페인 진행 스테이지를 선형 파이프라인으로 명시하고, 캠페인 타입에 따라 일부 단계를 스킵**: cb-x-deck의 "원고 → 배정 → 게시" 흐름에도 적용 가능한 패턴. 단, 17단계는 너무 세분화되어 있으니 실제로는 5~7단계 정도로 압축해서 차용.
3. **인플루언서당 태그/평점/자유노트**: 비개발 기획자가 "이 사람 까칠함, 금요일엔 연락 피할 것" 같은 맥락을 남기는 용도로 유용. 자유노트(메모)는 Community/카드 UI에 이미 있는 assign 카드 패턴과 자연스럽게 결합 가능.
4. **캠페인 단위 진행 요약 바(초대 수/응답 수/게시 수 등)**: 이미 진행 중인 배정 카드 UI(cb-x-deck influencer assign)에 상위 요약 뷰로 붙이면 "지금 몇 명 중 몇 명이 어디 단계인지"를 한눈에 보여줄 수 있음.
5. **머지 필드를 활용한 아웃리치 개인화 + 담당자 본인 메일함으로 발송**: 이메일 아웃리치를 붙일 경우, 플랫폼 도메인이 아니라 실제 담당자 Gmail에서 보내는 방식은 신뢰도가 높고 참고할 가치가 있음.

### 과한 것 (cb-x-deck 범위에서 배제 권장)
1. **트래킹 플랜/할인코드/어필리에이트 링크/AST**: cb-x-deck은 X(트위터) 콘텐츠 발행 도구이고, 이커머스 판매 귀속은 범위 밖. Upfluence의 핵심 차별점이지만 우리 맥락엔 전혀 맞지 않음.
2. **결제(Payment) 앱 전체(KYC, 세금서류, PayPal/자체 페이먼트, 환율수수료)**: 정산·페이먼트를 자체 처리하는 건 인플루언서 DB 기능 범위를 완전히 벗어나는 별개 시스템. 초기엔 배제, 필요해지면 외부 툴 연동으로 우회.
3. **자동 팔로업 시퀀스 빌더(Delay/Condition/Action 노드형 UI)**: 이메일 발송 자체가 cb-x-deck 범위에 없다면 시퀀스 빌더는 명백한 과잉. 아웃리치를 붙이더라도 처음엔 "1회성 수동 발송 + 상태 수동 갱신"으로 충분.
4. **계약서 자동 강제 서명 워크플로우, 지원서 폼(퍼블릭 신청 링크), 마켓플레이스 노출**: 이는 "다수의 외부 인플루언서가 스스로 지원하는" 발굴형 플로우에 필요한 기능이라 "이미 관계 있는 인플루언서 관리"라는 이번 범위와 어긋남.
5. **3가지 캠페인 타입 분기(gifting/paid/paid+gifting) 및 제품 배송/재고 연동**: 물리 제품 시딩이 없는 콘텐츠 비즈니스에는 불필요.
6. **17단계 세분화 상태값 전체**: 그대로 가져오면 비개발 사용자에게 과도한 인지 부하. UX 원칙 1(메커니즘이 아닌 이득 언어)·2(행동 전 기대 설정)에 위배될 소지가 크므로, 실제 차용 시 5~7단계로 압축하고 각 단계 옆에 "무엇을 하면 무엇이 되는지" 한 줄을 붙여야 함.

---

## 8. 출처 목록

**공식 사이트 (upfluence.com)**
- https://www.upfluence.com/creator-relationship-management
- https://www.upfluence.com/manage-creator-programs
- https://www.upfluence.com/campaign-management
- https://www.upfluence.com/features
- https://www.upfluence.com/analytics
- https://www.upfluence.com/influencer-outreach
- https://www.upfluence.com/pricing
- https://www.upfluence.com/
- https://www.upfluence.com/guides/upfluence-campaign-management-tutorial
- https://www.upfluence.com/influencer-marketing/influencer-email-outreach-template
- https://www.upfluence.com/influencer-marketing/influencer-contract-template-practical-tips

**공식 헬프센터 (help.upfluence.co)**
- https://help.upfluence.co/en/articles/7005349-how-to-manage-your-influencer-database-with-the-community-irm-app
- https://help.upfluence.co/en/articles/9795200-how-to-manage-influencer-statuses-in-upfluence
- https://help.upfluence.co/en/articles/7017109-how-to-add-tags-to-influencers-profiles
- https://help.upfluence.co/en/articles/4130922-how-to-add-ratings-to-influencers-profiles
- https://help.upfluence.co/en/articles/6989154-how-to-create-custom-merge-fields-for-influencer-outreach
- https://help.upfluence.co/en/articles/5361498-how-to-understand-data-on-the-creator-side-panel
- https://help.upfluence.co/en/articles/6989223-how-to-create-a-new-campaign
- https://help.upfluence.co/en/articles/13158687-how-to-create-a-campaign-using-jaice-ai
- https://help.upfluence.co/en/articles/9490861-understanding-the-campaign-table-view
- https://help.upfluence.co/en/articles/7026285-how-to-understand-each-stage-status-in-campaign
- https://help.upfluence.co/en/collections/9162103-the-three-campaign-types (+ 하위 3개 아티클: 6989236, 6989805, 6997160)
- https://help.upfluence.co/en/articles/8478732-how-to-set-up-email-automation-for-your-campaign
- https://help.upfluence.co/en/articles/10353954-how-to-schedule-automated-follow-up-emails
- https://help.upfluence.co/en/articles/6988949-how-to-mass-email-influencers
- https://help.upfluence.co/en/articles/9657231-reach-out-to-creators-with-the-right-approach
- https://help.upfluence.co/en/articles/6997325-how-to-invite-influencers-to-join-your-campaign
- https://help.upfluence.co/en/articles/8588489-how-to-reach-out-to-your-influencers-initial-outreach
- https://help.upfluence.co/en/articles/8637541-how-to-make-a-brief-a-z
- https://help.upfluence.co/en/articles/7016907-how-to-add-a-contract-to-your-campaign
- https://help.upfluence.co/en/articles/7004653-how-to-set-up-the-application-form-for-influencers
- https://help.upfluence.co/en/articles/5831295-free-campaign-brief-templates
- https://help.upfluence.co/en/articles/7004646-how-to-track-influencer-posts-with-the-content-tab-in-campaigns
- https://help.upfluence.co/en/articles/6993032-how-to-set-up-stream-to-track-and-analyze-influencer-posts
- https://help.upfluence.co/en/articles/6997271-how-to-set-up-and-track-influencer-sales-with-a-tracking-plan
- https://help.upfluence.co/en/articles/4582817-how-to-create-and-track-influencer-discount-codes-in-the-community-app
- https://help.upfluence.co/en/articles/9414714-how-to-check-and-validate-sales-commissions
- https://help.upfluence.co/en/articles/7026095-how-to-set-up-and-use-upfluence-s-agnostic-sales-tracking-ast
- https://help.upfluence.co/en/articles/12130328-how-to-use-the-sales-reporting-dashboard
- https://help.upfluence.co/en/articles/8685313-how-to-monitor-both-clicks-and-sales-using-affiliate-links
- https://help.upfluence.co/en/articles/6993076-how-to-manage-creator-payments-with-the-payment-app
- https://help.upfluence.co/en/articles/8768954-how-to-pay-creators-using-upfluence-pay
- https://help.upfluence.co/en/articles/6993094-how-to-pay-influencers-using-paypal-payouts

**리뷰/비교 사이트**
- https://www.g2.com/compare/upfluence-vs-influence-co-influence-co
- https://www.g2.com/compare/neoreach-vs-upfluence
- https://www.g2.com/compare/insense-vs-upfluence
- https://www.g2.com/compare/creatoriq-vs-upfluence
- https://www.g2.com/compare/aspireiq-aspire-vs-upfluence
- https://www.getapp.com/marketing-software/a/upfluence/
- https://www.vendr.com/marketplace/upfluence
- https://aws.amazon.com/marketplace/pp/prodview-4tb2mpef4kzty
- https://toolradar.com/tools/upfluence/calculator
- https://www.creatorstackclub.com/software/upfluence
- https://www.creator-hero.com/blog/upfluence-pricing-and-review
- https://findclout.com/blog/upfluence
- https://archive.com/blog/upfluence-pricing
- https://getpulsesignal.com/pricing/upfluence
- https://mentionagent.ai/blog/upfluence-review/

**주의**: 가격 관련 숫자는 Upfluence가 공개 가격표를 두지 않아 대부분 3rd-party 추정치(G2, Vendr, 리뷰 블로그)이며 실제 견적과 차이가 있을 수 있음. 1.3절의 "자유노트" 기능은 공식 헬프 문서로 확인되지 않았고 마케팅 페이지 UI 목업에서만 관찰됨 — 실제 기능 여부는 별도 확인 필요.
