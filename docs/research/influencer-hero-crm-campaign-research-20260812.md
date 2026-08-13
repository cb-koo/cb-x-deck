# Influencer Hero CRM·캠페인 관리 기능 리서치

**작성일**: 2026-08-12
**목적**: cb-x-deck에 "콘텐츠 발행 → 인플루언서 캠페인 진행 관리" 기능을 붙이기 위한 참고 자료. Influencer Hero(influencer-hero.com)의 CRM/캠페인 관리 구조를 분석하고, cb-x-deck(사용자 2~5명, X 전용, 발굴/분석은 범위 밖)에 차용할 만한 것과 과한 것을 구분한다.
**리서치 범위**: 공식 사이트 기능 페이지·블로그·헬프센터(help.influencer-hero.com) 우선, 보조로 리뷰 사이트(G2, Software Advice) 및 비교 블로그.

---

## 0. 전체 구조 한 줄 요약

Influencer Hero는 CRM을 3층 구조로 설계했다.

1. **Campaign Manager** — 캠페인(아웃리치 물량·이메일 플로우·발신 계정)을 정의하는 곳
2. **Campaign Board**(구 Dealflow) — 캠페인에 속한 인플루언서들이 단계별 칼럼을 이동하는 칸반 파이프라인
3. **Deal Page** — 인플루언서 1명 × 캠페인 1개의 "딜" 단위로 존재하는 상세 프로필(연락처·이력·메모·성과·결제를 모두 담는 허브)

캠페인 보드는 **캠페인에 종속**되어 있고(과거엔 "Dealflow"라는 독립 개념이었으나 리뉴얼로 캠페인 하위 탭으로 흡수됨), Deal Page가 실제 데이터의 최소 단위다. 즉 "인플루언서-캠페인 관계" 하나마다 Deal이 생성되고, 그 Deal이 보드 위 카드로 표현된다.

---

## 1. 인플루언서 CRM

### 파이프라인/스테이지 구조
Campaign Board는 두 종류로 나뉜다.

- **Outreach Board(아웃리치 보드)**: 신규 인플루언서 발굴~첫 협업까지, **좌→우 선형 흐름**. 기본 5칼럼:
  `Outreach(연락함, 미응답) → Negotiation(응답·협상 중) → On Hold(자유 칼럼, 보류) → Awaiting Post(발송 완료, 포스팅 대기) → Posted(포스팅 감지 완료)`
  칼럼 이동은 대부분 **자동화**로 일어난다(아래 3번 참조).
- **Relationship Board(관계 보드)**: 첫 협업이 끝난 인플루언서를 "선형이 아닌" 구조로 관리하는 보드. 예시 칼럼: `1회 활동 후 비활성 / 계속 활동 중(Active) / 상위 퍼포머(Top quartile) / 특별 관리 대상`. 브랜드가 성과 등급별로 자유롭게 칼럼을 정의하며, 목적은 "ROI 대부분을 만드는 재협업 파트너"를 놓치지 않는 것.

이 둘의 구분(첫 접촉용 선형 파이프라인 vs 기존 관계용 자유 보드)은 개념적으로 유용하다 — "발굴~1차 캠페인"과 "재협업 관리"는 다른 종류의 상태 머신이 필요하다는 뜻.

### 인플루언서 카드(Deal Page)에 담기는 정보
Deal Page는 탭 구조:
- **Home**: 현재 보드/스테이지, 인적정보, 어필리에이트/퍼포먼스 요약, 열린/보류 태스크, 활동 타임라인, 이메일 히스토리, 특수 액션(제품발송 등)
- **Posts**: 이 인플루언서가 올린 포스트 전체(플랫폼별)
- **Affiliate**: 할인코드/커스텀링크 생성·관리, 클릭·전환·커미션 트래킹
- **Analytics**: 소셜 팔로워/인게이지먼트 등 소셜 리포트(최초 로드 시점 기준, 새로고침 가능)
- **Payouts**: Creator Dashboard 연동 상태, 누적 수익, 잔액, 결제 이력
- **Details**: 배송지, 특이사항 메모, 프로필 검토 요청, 공유된 문서
- **Custom Fields**: 브랜드가 자유 정의하는 필드(예: "포스팅 예정일", 커미션 임계값 등) — 자동화 조건으로도 참조 가능

각 카드에는 **태스크 상태 배지**가 붙는다: `To Do(즉시 조치 필요) / Waiting(상대 응답 대기) / Overdue(응답기한 초과, 보통 48시간) / Follow Up(팔로업 필요)`. 이 배지가 "지금 누구부터 봐야 하는지"를 알려주는 핵심 UX 장치다.

### 화면 구성 특징
- 칸반(보드) + 딜 상세(사이드/전체 페이지) 조합. 다중 보드를 동시에 열어 볼 수 있음.
- **Bulk 선택 + 필터 + AI 선택자**: 체크박스, "지난 30일 매출 $500 이상" 같은 조건 필터, 또는 자연어로 이메일 스레드를 읽어 대상군을 찾는 AI 선택자로 대량의 딜을 한 번에 다룸(예: "매출 $500 이상인 3명에게 이메일 플로우 3번 발송").
- 팝업/전용 뷰로 **Content Review**, **Influencer Reviews**(대량 리뷰 처리), **Payouts** 등 "여러 딜을 가로질러 보는" 화면을 별도로 제공 — 딜 하나씩 열지 않고도 밀린 작업을 처리할 수 있게 함.

---

## 2. 캠페인 관리

### 캠페인 생성 플로우
캠페인이 "가동(Start)"되려면 3요소가 필수:
1. **Email flow**(아웃리치 시퀀스, AI 생성 또는 수동 작성 + 팔로업)
2. **Influencer list**(Influencer Finder에서 검색해 추가, 또는 CSV 업로드)
3. **Campaign Board**(신규 생성 또는 기존 보드 재사용)

캠페인 설정값: 일일 아웃리치 수(권장 30~50/일, 스팸 방지), 발신 이메일 계정(다중 계정 지원), 브랜드, **Natural Email Sending**(발송 시간을 분산시켜 스팸 필터·"봇처럼 안 보이게" 처리, 기본 ON — 원하면 즉시 발송으로 전환 가능).

캠페인을 시작(Start Campaign)하면 24시간마다 지정된 수만큼 아웃리치가 나가고, 응답 없으면 이메일 플로우에 설정된 팔로업이 자동 발송된다.

### 캠페인 단위 데이터
- 캠페인 = 아웃리치 볼륨 + 이메일 플로우 + 참여 인플루언서 리스트 + 전용 Campaign Board
- 예산/기간 필드는 캠페인 객체 자체보다는 **Reporting(리포트) 필터**와 **제품 발송 비용(COGS)**, **커미션/페이아웃** 데이터로 사후 집계되는 방식. 즉 "캠페인에 예산을 미리 배정"하는 하드 필드보다 "캠페인 기간 동안 발생한 비용·매출을 리포트에서 합산"하는 방식에 가깝다.
- **Deliverables(결과물)** 개념은 명시적 필드보다 "Awaiting Post → Posted" 스테이지 전환 + Content Review 워크플로우로 구현되어 있다(아래 4번).

### 진행 상태 추적
- 캠페인 진행은 Campaign Board의 칼럼 분포로 시각화(몇 명이 Outreach/Negotiation/Awaiting Post/Posted에 있는지 한눈에 파악).
- 각 캠페인의 "Influencer List" 탭에서 참여자 전원의 하이레벨 상태(연락함/응답함/협상 중/발송함 등)를 표 형태로도 확인 가능 — 보드(시각적) + 리스트(표) 두 뷰를 병행.
- **Analytics 탭**에서 캠페인별 리포트 생성(아래 4번).

### 자동화(Campaign Board Automations 2.0)
가장 정교한 부분. 구성: **Trigger(이벤트) → Condition(조건/분기) → Action(액션) → Delay(대기)**를 비주얼 플로우 빌더로 조립.
- Trigger 예: "크리에이터가 특정 스테이지로 이동", "캠페인에 크리에이터 추가됨"
- Condition: 단일 조건 분기, 또는 멀티 브랜치(응답 긍정/부정/무응답 각각 다른 경로)
- Action 예: 이메일(플로우) 발송, 어필리에이트 정보 생성, 스테이지/보드 이동, 연동 액션(계약서 발송 등), 태스크 생성, Slack/이메일 알림
- Delay: 팔로업 간 대기시간 등
- Custom Field를 조건/액션에서 참조 가능 (예: "포스팅 예정일이 지났으면 Overdue 태스크 생성")
- 자동화 세트를 **템플릿화**해서 여러 캠페인에 재사용 가능

이 자동화 레이어가 "24시간 상시 대응 인력 없이도 스테이지 이동·팔로업·태스크 생성이 굴러가게" 만드는 핵심이다.

---

## 3. 아웃리치·커뮤니케이션

- **아웃리치 엔진**: Influencer Finder(발굴, 이번 범위 아님)에서 추린 리스트에 AI가 생성한 이메일 시퀀스(초기 컨택 + N차 팔로업)를 발송. Spam Score 기능으로 콘텐츠·발신 계정 평판을 분석해 스팸함 회피 팁 제공.
- **CRM과의 양방향 동기화**: 인플루언서가 이메일에 답장하면 시스템이 감지해 Deal을 자동으로 `Outreach → Negotiation`으로 이동. 즉 커뮤니케이션 이벤트가 곧 파이프라인 상태 전이의 트리거다(별도 관리자 입력 없이).
- **통합 인박스**: Deal Page 안에 이메일 히스토리 전체가 저장되고, WhatsApp 메시지도 딜 페이지에 동기화(공식 사이트 기능 설명 기준) — "받은 편지함 여러 개를 오가지 않도록" 설계.
- **협상 단계**는 별도 필드 구조가 아니라 "Negotiation 칼럼 + 자유 메모/커스텀 필드 + 이메일 스레드"로 처리. 계약서는 자체 계약 관리 기능보다는 **연동(Integrations)을 통한 액션**(예: 자동화에서 "계약서 발송" 액션 트리거)으로 처리 — 즉 계약은 Influencer Hero의 자체 강점 영역이 아니라 외부 연동에 의존.
- **팔로업 자동화**: Waiting 상태에서 기한(기본 48h~3일, 커스터마이즈 가능) 초과 시 Follow Up 배지 부여 + 자동화로 팔로업 메일 발송 가능.

---

## 4. 콘텐츠·성과 추적

### 콘텐츠 수집
- **Post Detection**: Awaiting Post 스테이지 진입 시 시스템이 하루 3회 인플루언서 계정을 스캔해 신규 포스트를 감지·저장하고, 감지되면 자동으로 Posted 칼럼으로 이동. 지원 플랫폼: Instagram, TikTok, YouTube(Instagram Stories는 제외).
- **Content Wall**: 전체 캠페인/인플루언서를 가로지르는 콘텐츠 갤러리. 정렬(추천/좋아요/조회수/인게이지먼트/최신), 필터(플랫폼, 게시일, 미디어 타입, 포스트 타입, **AI 비주얼 퀄리티 점수**, **AI 제품 노출 가능성 점수**, 화면비), **자연어 AI 검색**("제품이 잘 보이는 언박싱 영상" 같은 프롬프트로 검색). Social Listening(브랜드 태그한 일반 고객 콘텐츠)도 같은 화면에서 별도 필터로 조회.
- **Content Review Workflow**: 딜 페이지에서 "콘텐츠 요청" → 인플루언서가 Creator Dashboard로 파일 업로드 또는 구글드라이브 링크 제출 → 브랜드가 승인/반려(반려 시 사전 정의된 이유 태그: 제품 미노출/할인코드 누락/캡션 수정/화질 문제 등, 또는 커스텀 코멘트) → 재제출 반복. 여러 캠페인에 걸친 승인 대기 건을 모아 보는 전용 뷰도 있음.

### 성과·매출 추적
- **Affiliate Tracking**: 인플루언서별 할인코드/커스텀링크 생성 → Shopify 네이티브 연동 또는 비-Shopify는 GoAffPro 연동으로 클릭·주문·매출·커미션을 자동 계산. Deal Page의 Affiliate 탭에 실시간 반영.
- **Gifting(제품 시딩)**: Shopify 연동 시 $0 주문을 자동 생성해 발송, 배송 추적 태스크 자동 생성, 배송 완료 시 Awaiting Post로 자동 전환 + Post Detection 자동 활성화.
- **Reporting/Analytics**: 캠페인·기간 필터로 생성하는 종합 리포트. 탭 구성: `Overall(퍼널: Contacted→Responded→Onboarded→Posted) / UGC(콘텐츠 KPI, Top 3 콘텐츠) / Social Listening / ROI(매출·Top 상품) / Email(오픈율·스팸·구독취소) / Payments / Products(발송 제품·비용, Shopify 전용)`. PDF/Excel 내보내기 지원.
- **Payout Manager**: 커미션(변동) + Fixed Fee(고정) 결제를 한 곳에서. Creator Dashboard에 초대된 인플루언서가 본인 결제 정보를 직접 입력(브랜드가 은행정보를 주고받을 필요 없음) → 브랜드는 Stripe 결제(즉시/저장된 결제수단/1회성 체크아웃 3가지 옵션) 또는 오프라인 결제 기록. **Auto-Submit/Auto-Pay**: 잔액이 임계값(예 $50) 넘으면 결제 요청 자동 생성, 원하면 전체 자동 처리까지 가능. Invoicing(인보이스 요청→승인/반려→결제 전 인보이스 필수화 옵션)도 이 안에 포함.
- **Creator Dashboard(크리에이터용 별도 앱, creator-hero.com)**: 인플루언서 본인이 실적·수익·결제정보를 보는 포털. 브랜드-크리에이터 데이터 흐름의 "셀프서비스" 축.

---

## 5. 가격 티어와 타깃 고객

Shopify 앱스토어 기준, 3개월 최소 약정, 분기/연납 시 할인(~20%/~30%).

| 플랜 | 월 요금(월납) | 좌석 | 월 아웃리치 | 핵심 |
|---|---|---|---|---|
| Standard | $649 | 1 | 1,000 | 발굴·아웃리치·CRM·어필리에이트&페이먼트(20건)·기프팅 |
| Pro | $1,049 | 3 | 5,000 | +UGC/포스트 캡처, 리포팅, 전담 매니저, 무제한 템플릿, 페이먼트 100건 |
| Business | $2,490 | 8(사실상 무제한) | 10,000 | +UGC 트래킹 1,500건, 커스텀 API, 무제한 페이먼트 |
| Custom & Agency | 별도 협의 | 커스텀 | 무제한 | 커스텀 UGC 쿼터, 에이전시 부가서비스 |

- **타깃**: Shopify/WooCommerce/Magento 등 이커머스·DTC 브랜드. "스프레드시트+DM+이메일로 관리하던 스타트업"이 다음 단계로 넘어가는 지점을 노림(리뷰 사이트 표현: "5~10명 인플루언서까진 스프레드시트로 되지만 그 이상부터 무너진다").
- 가격이 창작자 발굴~아웃리치 볼륨 기준으로 스케일링되고, **UGC/콘텐츠 트래킹은 Business($2,490) 이상에서만 전면 개방** — 즉 "관계관리(CRM)"는 최하위 플랜에도 있지만 "콘텐츠·성과 트래킹 고도화"는 상위 플랜 전용.
- 리뷰 평가(Software Advice, G2): Ease of use 4.5~9.1/10대 만점 기준 대체로 높음. 불만은 주로 **발굴/검색 필터의 정확도**(이번 범위 밖) 및 "브랜드 여러 개 운영 시 구독이 브랜드별로 따로 부과되어 비용이 커짐" 등.

---

## 데이터 모델 힌트 (필드·상태값 추출)

캠페인/인플루언서 관계를 모델링할 때 참고할 최소 스키마 후보:

**Campaign**
- id, name, status(draft/running/paused/ended)
- outreach_volume_per_day, email_flow_id, sender_accounts[]
- board_id(1:1, 캠페인 종속 보드)
- 기간 필드는 별도 start/end보다는 "가동 시작 시각 + 진행 중 여부"로 충분해 보임(리포트가 기간 필터로 사후 계산)

**Deal (Influencer × Campaign)**
- id, influencer_id, campaign_id, board_column(stage), stage_entered_at
- task_status(none/todo/waiting/overdue/follow_up), task_deadline
- communication_log[](이메일/DM 스레드 참조)
- notes(자유 텍스트 메모)
- custom_fields{}(브랜드 자유 정의 key-value, 자동화 조건에서 참조)
- affiliate: discount_code, link, commission_rate, clicks, conversions, revenue
- fulfillment: shipped_at, tracking_url, delivered_at
- content: post_urls[], detected_at[], review_status(pending/approved/edit_requested)
- payout: balance, requested_amount, paid_amount, payout_status(ready_to_pay/requested/paid), method(stripe/offline)

**Stage 상태값 (Outreach형 보드 기준)**
`outreach → negotiation → (on_hold) → awaiting_post → posted` — 그리고 별도로 posted 이후 **relationship 상태값**(예: `dormant/active/top_performer`)으로 넘어가는 2단 구조.

**자동화(Automation) 최소 요소**
`trigger(event) + condition(field/branch) + action(list) + delay` — 이 4요소 구조는 범용적이라 규모를 줄여도 재사용 가치가 큼.

---

## 우리가 차용할 만한 것 vs 우리 규모(2~5명, X 전용)에 과한 것

### 차용할 만한 것
1. **스테이지 상태 머신 + 태스크 배지 조합**: `outreach → negotiation → awaiting_post → posted` 같은 단순 선형 스테이지 + `todo/waiting/overdue/follow_up` 배지는 cb-x-deck의 인플루언서 배정(핸들 자연키 기반, 이미 존재)에 그대로 얹기 좋다. 지금은 "배정됨" 정도의 단일 상태인데, 여기에 진행 단계를 추가하는 정도면 충분 — Influencer Hero처럼 자동 감지형 다단 보드까지는 불필요.
2. **Deal Page 개념(인플루언서×캠페인 단위 상세 화면)**: 인플루언서 프로필과 캠페인 참여 이력을 분리해서, "이 인플루언서가 이 캠페인에서 무엇을 했는지"를 한 화면에 모으는 패턴은 유용하다. 다만 우리는 캠페인이 X 콘텐츠 발행이므로, Deal Page ≈ "발행 원고 + 인플루언서 배정" 카드를 확장하는 정도로 축소 가능.
3. **간단한 커스텀 필드**: 브랜드/캠페인마다 다른 추적 항목(예: "쿠폰코드", "포스팅 예정일")을 하드코딩 대신 자유 key-value로 두는 아이디어는 소규모 팀에도 유효 — 스키마 변경 없이 필드 확장 가능.
4. **결과물(Deliverable) 상태 = 콘텐츠 감지/제출 + 승인 플로우**: "Awaiting Post → Posted" + 승인/반려(이유 태그) 워크플로우는 X 콘텐츠에도 자연스럽게 적용된다. X는 getxapi로 포스트 감지가 가능하니 "인플루언서가 실제로 올렸는지" 자동 확인은 우리 규모에서도 저비용으로 구현 가능.
5. **리포트의 퍼널 구조**(Contacted→Responded→Onboarded→Posted)는 캠페인 성과를 한눈에 보여주는 데 참고할 만하다. 다만 자동 생성 대시보드보다 필요한 시점에 수동 집계로도 충분.

### 우리 규모엔 과한 것
1. **대량 아웃리치 엔진 + Natural Email Sending + Spam Score**: 우리는 "이미 협업 중이거나 후보인" 소수의 인플루언서를 다루므로, 수백~수천 명 대상 콜드 이메일 자동화·스팸 회피 로직은 전혀 불필요.
2. **Payout Manager의 Stripe 통합·Bulk Pay·Auto-Submit/Auto-Pay·인보이스 워크플로우**: 결제 인프라(Stripe Connect, 다중 통화, ACH/SEPA)까지 자체 구축하는 건 사용자 2~5명 규모에 명백히 과함. 정산이 필요하면 "결제 상태 메모" 필드 정도로 충분하고, 실제 이체는 계좌/카카오페이 등 기존 수단으로 처리하면 된다.
3. **Creator Dashboard(크리에이터용 별도 포털)**: 인플루언서가 로그인해 스스로 실적을 보는 앱을 따로 만드는 건 이번 범위를 크게 벗어난다. 우리는 내부 운영자만 보는 도구로 충분.
4. **Bulk Actions + AI Selector**: "조건에 맞는 N명을 골라 일괄 이메일 발송" 같은 대량 처리 UX는 소수 인플루언서 운영에는 불필요 — 개별 카드 처리로 충분.
5. **Content Wall의 AI 비주얼 퀄리티 점수·AI 자연어 콘텐츠 검색**: 콘텐츠 볼륨이 적은 우리 상황에서는 과투자. 대신 "게시된 X 포스트 링크 + 기본 지표(좋아요/노출)"를 배정 카드에 붙이는 정도가 실속 있다.
6. **자동화 빌더(Trigger/Condition/Action/Delay 비주얼 플로우)**: 범용 자동화 엔진을 직접 만드는 건 과설계. 우리에게 필요한 자동화는 "포스팅 감지되면 상태를 자동으로 '완료'로 바꾼다" 정도의 하드코딩된 몇 가지 규칙이면 충분하며, 이는 getxapi 모니터링과 결합해 간단히 구현 가능.
7. **Shopify/WooCommerce/GoAffPro 어필리에이트 연동, $0 주문 생성, 배송 추적**: 우리는 이커머스 제품 시딩이 캠페인의 핵심이 아니므로(콘텐츠 발행 중심), 이 전체 레이어는 해당 없음.
8. **다중 브랜드/에이전시용 좌석·요금 구조, API 레이트리밋 관리** 등 엔터프라이즈 운영 요소는 논외.

### 판단 기준 요약
Influencer Hero의 가치는 "발굴부터 아웃리치·결제까지 전체를 대체하는 올인원"에 있는데, 우리는 발굴은 이미 끝났고 결제 인프라도 필요 없다. 우리가 진짜 필요한 건 이 셋뿐이다: **(1) 스테이지가 있는 배정 상태 관리, (2) 인플루언서×원고 단위의 진행 카드(연락·게시 이력·메모), (3) 게시 여부의 반자동 확인(getxapi 연동)**. 나머지(아웃리치 자동화, 결제, 크리에이터 포털, AI 콘텐츠 분석, 범용 자동화 엔진)는 전부 백로그 이하로 취급해도 무방하다.

---

## 출처 목록

**공식 사이트 — 기능 페이지**
- https://www.influencer-hero.com/influencer-page/influencer-crm
- https://www.influencer-hero.com/influencer-page/content-library-ugc
- https://www.influencer-hero.com/influencer-page/affiliate-payments
- https://www.influencer-hero.com/pricing

**공식 사이트 — 블로그**
- https://www.influencer-hero.com/blogs/influencer-hero-crm
- https://www.influencer-hero.com/blogs/influencer-outreach
- https://www.influencer-hero.com/blogs/affiliate-tracking-payments
- https://www.influencer-hero.com/blogs/influencer-gifting
- https://www.influencer-hero.com/blogs/updated-content-wall
- https://www.influencer-hero.com/blogs/reporting-analytics
- https://www.influencer-hero.com/blogs/payout-manager

**공식 헬프센터(help.influencer-hero.com)**
- https://help.influencer-hero.com/en/articles/9775883-the-campaign-board
- https://help.influencer-hero.com/en/articles/13263623-the-new-campaign-manager
- https://help.influencer-hero.com/en/articles/9740028-how-to-set-up-your-first-campaign
- https://help.influencer-hero.com/en/articles/15192750-campaign-boards-automations-2-0
- https://help.influencer-hero.com/en/articles/9775949-influencer-s-deal-page
- https://help.influencer-hero.com/en/articles/15868712-content-review-workflows
- https://help.influencer-hero.com/en/articles/13677794-content-wall-everything-you-need-to-know
- https://help.influencer-hero.com/en/articles/10722199-generating-complete-reports
- https://help.influencer-hero.com/en/articles/9778262-the-payout-manager
- https://help.influencer-hero.com/en/articles/9775873-the-creator-dashboard
- https://help.influencer-hero.com/en/articles/9739842-shopify-app-integration

**영상**
- https://www.youtube.com/watch?v=EvqWABTxY-8 (The Influencer Hero CRM Explained – Dealflows)

**리뷰·비교(보조 참고, 공식 정보와 교차 확인용)**
- https://www.softwareadvice.com/influencer-marketing/influencer-hero-profile/
- https://influencermarketinghub.com/influencer-hero/
- https://www.g2.com/compare/influencer-hero-vs-later-influence
- https://blocksentient.com/review/influencer-hero/
- https://www.authencio.com/blog/influencer-hero-review-best-startup-outreach-tool
- https://apps.shopify.com/influencer-hero (Shopify 앱스토어 가격/리뷰)
- https://appnavigator.io/app/influencer-hero/reviews/1771176
