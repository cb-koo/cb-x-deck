# Favikon 인플루언서 CRM·캠페인 관리 기능 리서치 보고서

> 2026-08-12 · cb-x-deck 캠페인 관리 기능 기획 참고용 (발굴/스코어링 영역 제외)

---

## 1. Contacts / Lists (CRM) 모듈

**구조**: Favikon의 CRM은 "Contacts(전체 컨택 DB) + Lists(그 안의 하위 컬렉션)" 2단 구조다. 리스트는 클라이언트별·니치별·지역별로 자유롭게 만들 수 있고, 서치 결과에서 바로 크리에이터를 선택해 신규/기존 리스트에 추가하는 방식이다. "숏리스트/탤런트풀/워치리스트" 세 가지 용도로 공식 설명하고 있다.

**담아두는 정보**:
- 기본 프로필 데이터: 팔로워, 참여율, 플랫폼별 프레즌스, 콘텐츠 카테고리, 협업 브랜드 이력, 이메일(검증됨)
- **커스텀 속성(Custom Attributes)**: 숏리스트 체크박스, 별점, 마지막 컨택 날짜, 자유 메모 등 사용자가 임의로 필드를 만들어 붙일 수 있음
- **"last updated" 타임스탬프** — 데이터가 오래되면 재enrich(새로고침) 권장
- 컨택이 캠페인에 소속되면, 해당 컨택 프로필에 **캠페인 날짜, 계약 조건, 결제/청산 상태, 결과물(deliverable), 협업 상태(confirmed/in discussion/scheduled)**가 롤업되어 표시됨 — 즉 캠페인 참여 이력이 컨택 레코드 하나에 누적된다.

**화면 구성**: 기본은 테이블(필터·정렬), 비개발자용으로 **카드뷰**를 별도 제공("스킵 dense tables… 기술 이해도가 낮은 상대와 공유할 때 이상적"). 리스트는 팀/클라이언트와 공유 가능하며 권한을 view-only / edit / link-anyone 3단계로 설정. CSV export 지원.

주의: 컨택 자체에는 별도의 "파이프라인 스테이지" 값이 없다 — 스테이지(단계) 개념은 Campaigns 모듈의 Kanban에서 관리되고, 컨택 화면에는 그 결과가 참고 정보로만 노출된다.

출처: https://www.favikon.com/products/influencer-marketing-crm / https://www.favikon.com/products/contacts / https://help.favikon.com/en/articles/11375025-need-a-tutorial-brands-v2

---

## 2. Campaigns 모듈

### 생성 플로우 (사실상 5단계 위저드)

Help Center 기준 순서:
1. **기본 정보**: 제목, 브랜드명, 캠페인 설명(★AI가 크리에이터 타겟팅·메시지 작성에 이 텍스트를 사용하므로 상세히 쓰라고 안내), 시작/종료일(옵션), 예산(옵션), EMV 계산 설정(옵션)
2. **크리에이터 추가**: Suggestions(AI 추천) / Lists(저장된 리스트에서) / Manual(개별 추가) / Bulk CSV / Copy&Paste(프로필 URL) — 플랜별로 캠페인당 인원 상한 있음
3. **아웃리치 자동화 설정**(스킵 가능, 권장)
4. **트래킹 설정**: 해시태그/멘션/키워드 추적 여부, GA4 연동 여부
5. **공개 여부(Visibility)**: Public(크리에이터가 직접 지원 가능, 산업/니치/국가/언어/네트워크/팔로워 등 필터로 지원 자격 제한) vs Private(선별 초청만)

### 캠페인 단위로 관리되는 데이터
- 이름, 브랜드, 설명, 기간, 예산, EMV 환산 단가(재생/좋아요/댓글/노출당 $값을 콘텐츠 포맷별로 설정)
- 캠페인 레벨 상태: **Active / Draft / Paused / Archived**
- 크리에이터별 하위 데이터(**Creator Deal Management**): 결과물 스펙(포맷·수량·제출 예정일), 계약 조건, 가격/결제 이력·상태 — 이 모든 게 "캠페인 안의 크리에이터 프로필"에 저장돼서 다음 캠페인에서 재협상 없이 재사용됨

### 진행 상태 추적 — 두 개의 축이 공존
1. **크리에이터 파이프라인(Kanban)**: 캠페인마다 커스터마이즈 가능한 상태 컬럼. 기본값은 `New → To contact → Contacted → In discussion → Accepted → In collaboration` (+ `Rejected`). 다른 문서에서는 실제 운영 예시로 `Briefed → Content Pending → In Review → Approved → Live → Paid` 같은 커스텀 라벨도 제시.
2. **퍼널 애널리틱스(자동 집계, 별도 축)**: `Activated(캠페인 추가) → Replied(응답) → Accepted(수락) → Published(게시)` — Kanban의 사람이 옮기는 상태와 달리 시스템이 자동 판정하는 진행률 지표.

### 멀티 캠페인 대시보드
캠페인 목록 뷰(이름·참여 크리에이터 수·상태·마감일 한눈에), **Kanban 뷰**(단계별 병목 파악), **Calendar 뷰**(전체 캠페인의 예정 게시물을 하나의 타임라인으로 — 중복·공백 구간 확인용).

출처: https://help.favikon.com/en/articles/13927401-how-to-set-up-and-launch-a-campaign / https://help.favikon.com/en/articles/12732804-managing-your-active-campaigns / https://www.favikon.com/products/influencer-campaigns / https://www.favikon.com/blog/how-to-manage-multiple-influencer-campaigns-simultaneously / https://www.favikon.com/pricing

---

## 3. Outreach / Inbox

캠페인 관리와 완전히 통합돼 있다 — 별도 툴이 아니라 캠페인 대시보드의 한 탭(Conversations)이다.

- **채널**: Email, Instagram DM, LinkedIn DM, Favikon 자체 DM(플랫폼에 가입된 크리에이터 대상). 하나의 시퀀스 안에 채널을 섞어 쓸 수 있음(예: 이메일 발송 → 3일간 무응답 시 LinkedIn DM으로 팔로업).
- **FavAI 자동 작성**: 크리에이터의 최근 게시물 + 캠페인 브리프를 읽고 개인화된 첫 메시지를 AI가 작성. 템플릿 복붙이 아니라 "이 브랜드와 이 크리에이터의 공통 지점"을 언급하는 문장을 생성한다고 광고.
- **팔로업 자동화**: 지연시간 설정 가능한 멀티스텝 시퀀스, 무응답 시 채널 전환.
- **통합 인박스(Global Inbox)**: 여러 캠페인의 대화를 한 화면에서 캠페인/채널/상태/읽음여부로 필터링. "캠페인 컨텍스트 안에서 메시지를 보내면 자동으로 그 캠페인 히스토리에 귀속된다"는 운영 팁도 있음(스레드가 캠페인별로 분리 보관).
- **플랜별 자동화 채널 제한**: Trial/Starter=이메일만, Standard=이메일+(Instagram 또는 LinkedIn 중 택1), Pro=전 채널, Enterprise=전 채널+.

출처: https://www.favikon.com/features/influencer-outreach-platform / https://help.favikon.com/en/articles/12732804-managing-your-active-campaigns / https://www.favikon.com/blog/how-to-manage-multiple-influencer-campaigns-simultaneously

---

## 4. Tracking / Reports

**콘텐츠 추적(캠페인 설정에 포함)**: 해시태그 / 멘션 / 키워드 매칭 또는 "크리에이터의 전체 게시물 자동추적" 옵션. 22시간 주기로 자동 갱신, 수동 새로고침은 2시간 주기 제한. 예정된 게시 슬롯(deliverable)과 실제 게시물은 24시간 이내 발행이면 자동 매칭 → "pending" 상태로 리뷰 큐에 올라가고, 24시간을 넘기면 매칭은 안 되지만 콘텐츠 자체는 수집됨.

**콘텐츠 승인**: 게시 전(또는 게시 후 확인) 리뷰 큐에서 승인/수정요청 → 캠페인 대시보드 상태 갱신.

**리포트/애널리틱스 지표**:
- Creator Funnel(Activated/Replied/Accepted/Published)
- Cost Metrics: Budget Engaged(총 소진), CPM, CPE(참여당 비용), CPV(조회당 비용)
- **EMV(Estimated Media Value)**: 참여 유형(재생/좋아요/댓글/노출)별로 $단가를 콘텐츠 포맷마다 직접 설정해 캠페인 생성 시점에 산정 방식을 정함
- GA4 연동으로 클릭→트래픽→전환(가입/데모신청 등)까지 추적, "reach가 아니라 실제 파이프라인 임팩트"를 강조
- Excel로 콘텐츠 개요 export 가능

**흐름상 역할**: Reports는 별도 최종 단계가 아니라, 캠페인이 살아있는 동안 계속 갱신되는 "Analytics 탭"이다. 즉 캠페인 관리 화면 자체가 실시간 리포트이고, 종료 시 그걸 그대로 내보내 대외 보고에 쓰는 구조.

출처: https://help.favikon.com/en/articles/12732804-managing-your-active-campaigns / https://www.favikon.com/blog/how-to-manage-multiple-influencer-campaigns-simultaneously / https://www.favikon.com/products/influencer-campaigns

---

## 5. 가격 티어별 CRM/캠페인 기능 차이 (favikon.com/pricing 기준, 2026년 시점)

| | Core (~$159~199/mo) | Pro (~$239~299/mo) | Enterprise |
|---|---|---|---|
| 컨택 수 | 3,000 | 5,000 | Custom |
| 활성 캠페인 수 | 1 | 5 | Custom(무제한) |
| 캠페인당 트래킹 크리에이터 상한 | 100 (캠페인 인원 캡 300) | 300 (캡 500) | Custom |
| 아웃리치 채널 | 이메일만 | 이메일 + 소셜 DM | 이메일 + 2개 이상 소셜 |
| GA4 연동 | ✗ | ✓ | ✓ |
| API 액세스 | ✗ | ✗ | ✓ |
| 우선 지원 / CSM | ✗ | 우선지원 | 전담 CSM + 온보딩 |

Kanban 뷰, 커스텀 캠페인 스테이지, Creator Deal Management, EMV/Cost Analytics, 콘텐츠 추적, 콘텐츠 승인 같은 **"기능 자체"는 티어 간 차이가 거의 없어 보이고, 갈리는 건 대부분 "용량"(컨택 수·캠페인 수·트래킹 인원)과 "아웃리치 채널 폭"**이다. 즉 Favikon은 CRM/캠페인 관리를 기능 차등이 아니라 규모 차등으로 과금하는 모델이다.

리뷰 기반 참고점(G2 4.3/5, Capterra 4.6/5, 리뷰 수는 적음): 발굴(discovery)/스코어링 쪽은 호평이 압도적이지만, **"캠페인 관리는 discovery 대비 가장 약한 부분", "덜 직관적·덜 커스터마이즈 가능"**이라는 지적이 여러 독립 리뷰 사이트(creator-hero.com, influencer-hero.com, thegtmdirectory.com)에서 공통적으로 나온다. 외부 CRM/캠페인 툴과의 통합(API·웹훅)도 약하다는 평가. → Favikon 자체 사용자들도 캠페인 관리 UX를 최선으로 보지 않으므로, 기능 목록을 그대로 베끼기보다 "무엇을 위해 그 필드가 존재하는가"를 취사선택하는 게 맞다.

출처: https://www.favikon.com/pricing / https://help.favikon.com/en/articles/15457650-understanding-plans-and-credits / https://www.g2.com/products/favikon/reviews / https://www.creator-hero.com/blog/favikon-pricing-and-review / https://www.influencer-hero.com/blogs/favikon-pricing / https://thegtmdirectory.com/tools/favikon

---

## 데이터 모델 힌트 (cb-x-deck에 적용한다면)

**Campaign**
`id, title, description(AI 참고용 자유텍스트), start_date?, end_date?, budget?, status(draft/active/paused/archived), visibility(public/private), pipeline_stages(순서있는 커스텀 라벨 배열), emv_config(참여유형→단가), tracking_config(hashtags[], mentions[], keywords[], auto_track_all:boolean, ga4_property?)`

**CampaignInfluencer (조인 엔티티 — 캠페인×인플루언서)**
`campaign_id, influencer_id, stage(현재 파이프라인 단계), added_via(suggestion/list/manual/csv), deliverables[](format, quantity, due_date), contract_terms?, payment_status(unpaid/invoiced/paid), funnel_stage(added/replied/accepted/published), conversation_thread_id`

**Contact/Influencer (이미 cb-x-deck에 있는 핸들=자연키 개념과 정합적)**
`handle, enriched_data(팔로워/참여율 등, last_refreshed_at), custom_attributes(자유 key-value: 메모/별점/최근접촉일), list_ids[], campaign_history_rollup(과거 협업 이력 요약)`

**Post/Content(게시물 매칭)**
`campaign_influencer_id, platform_post_url, matched_via(hashtag/mention/keyword/manual), scheduled_deliverable_id?, match_status(auto_matched_within_24h / unmatched), approval_status(pending/approved/revision_requested), fetched_at`

이 중 **"컨택 프로필에 캠페인 참여 이력이 롤업되어 보인다"**는 설계 원칙이 가장 눈여겨볼 부분이다 — 별도 "협업 히스토리" 테이블을 새로 만들지 않고, 인플루언서 프로필 화면에서 그 인플루언서가 걸린 모든 캠페인/원고를 조회하는 뷰만 만들면 동일한 효과를 낼 수 있다.

---

## 차용할 만한 것 vs 우리 규모에 과한 것

### 차용 가치 있음 (가볍게 적용 가능)
- **Campaign 엔티티 자체**: 이름·설명·기간·예산(옵션)·소속 인플루언서 목록. 이미 cb-x-deck에 "원고 인플루언서 배정" 기능이 있으니, 그 위에 "캠페인"이라는 상위 그루핑 한 단계만 추가하면 충분.
- **고정된(커스텀 편집 UI는 불필요) 진행 상태 enum**: `논의중 → 확정 → 진행중 → 게시완료` 정도의 4~5단계. 사용자가 2~5명이라 팀 내 합의된 고정 값으로 충분하고, 오히려 자유도가 낮은 게 UX 원칙(라벨-값 일치)에도 맞음.
- **결과물(deliverable) 스펙**: 포맷(트윗/스레드/RT 등)·수량·마감일 정도의 심플한 필드 — X 전용이라 Favikon의 "포스트 포맷+수량+제출일" 개념을 그대로 축소 적용 가능.
- **인플루언서 프로필에 캠페인 히스토리 롤업 뷰**: 별도 CRM 모듈을 새로 만들 필요 없이, 기존 인플루언서 카드에 "이 사람이 참여한 캠페인/원고 목록"을 추가하는 정도로 Favikon의 "컨택=관계 히스토리 중심" 철학을 구현할 수 있음.
- **자유 메모/커스텀 태그 필드**: 인플루언서 카드에 메모 한 줄, 마지막 컨택일 정도만 있어도 실무 가치가 큼.

### 우리 규모(사용자 2~5명, X 전용, 이미 관계 있는 인플루언서 위주)에 과한 것
- **멀티채널 아웃리치 자동화(이메일+Instagram DM+LinkedIn DM+시퀀스, AI 개인화 메시지)**: 콜드 아웃리치용 기능이라 "이미 협업 관계가 있는" 우리 시나리오와 맞지 않음.
- **Waterfall 이메일 enrichment(9개 플랫폼 크로스체크)**: 발굴 단계 기능이라 이번 범위 밖.
- **Public 캠페인(크리에이터가 직접 지원)**: B2B 마켓플레이스형 기능, cb-x-deck엔 해당 사용자층이 없음.
- **팀스페이스/멀티 권한 레벨(view/edit/link 3단계), 클라이언트 공유**: 내부 소규모 도구라 단일 권한이면 충분.
- **GA4 연동 전환 추적**: 현재 X 콘텐츠 발행 도구 범위에서는 우선순위 낮음.
- **자동 해시태그/멘션/키워드 크롤링(22시간 주기 매칭 엔진)**: getxapi 연동으로 나중에 "게시 확인 자동화"로 발전시킬 여지는 있으나, 초기 구현은 "게시 링크 수동 붙여넣기 → 상태를 게시완료로 변경" 수준이면 충분. Favikon 리뷰에서도 이 계열 자동추적이 "약한 지점"으로 지적됨.
- **EMV/CPM/CPE/CPV 같은 유료 광고 단가 지표**: 오가닉 협업 중심이면 도입 이유가 약함. 실제 협찬비가 오가는 캠페인이 생기면 "예산 대비 성과" 정도의 단순 지표만 최소 도입 검토.
- **크레딧 과금 모델, 멀티캠페인 캘린더 뷰**: 규모가 커지기 전엔 관리 부담이 이득보다 큼.

---

## 참고 출처 목록

- https://www.favikon.com/products/influencer-marketing-crm
- https://www.favikon.com/products/contacts
- https://help.favikon.com/en/articles/11375025-need-a-tutorial-brands-v2
- https://help.favikon.com/en/articles/13927401-how-to-set-up-and-launch-a-campaign
- https://help.favikon.com/en/articles/12732804-managing-your-active-campaigns
- https://www.favikon.com/products/influencer-campaigns
- https://www.favikon.com/features/campaigns
- https://www.favikon.com/features/influencer-outreach-platform
- https://www.favikon.com/blog/favikon-v3-the-future-of-influencer-marketing-out-now
- https://www.favikon.com/blog/how-to-manage-multiple-influencer-campaigns-simultaneously
- https://www.favikon.com/pricing
- https://help.favikon.com/en/articles/15457650-understanding-plans-and-credits
- https://help.favikon.com/en/articles/10118033-how-do-favikon-credits-work
- https://help.favikon.com/en/articles/12802141-favikon-v2-v3-what-changes-and-how-to-migrate
- https://www.g2.com/products/favikon/reviews
- https://www.creator-hero.com/blog/favikon-pricing-and-review
- https://www.influencer-hero.com/blogs/favikon-pricing
- https://thegtmdirectory.com/tools/favikon
