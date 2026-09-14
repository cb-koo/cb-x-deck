# 캠페인 상세 페이지 UX 리서치 — 표(테이블) vs 캘린더, 진행/성과/비용의 공존

작성일: 2026-08-25
대상: cb-x-deck 캠페인 상세 페이지(A/B/C 시안 검토)
증거 표기: **[인용]** 원문 URL 포함 / **[패턴]** 복수 출처에서 공통 관찰 / **[추측]** 조사자 추론

---

## 1. 요약

- 인플루언서 캠페인 관리 도구(Upfluence, GRIN, Modash, Klear 등) 8종을 확인한 결과, **캠페인 상세의 기본 뷰는 예외 없이 표(테이블)**였다. 행 단위는 인플루언서 또는 콘텐츠이고, 진행 단계·비용성 필드는 컬럼으로, 성과는 별도 탭/섹션(Measure, Performance, Analytics)으로 분리되어 있었다. **주간 캘린더를 캠페인의 기본(primary) 뷰로 쓰는 사례는 발견하지 못했다.**
- 콘텐츠 캘린더/소셜 스케줄링 도구(Planable, Sprout Social, Hootsuite, Notion/Airtable 템플릿)는 캘린더를 제공하지만, 이는 "언제 발행할지"를 계획하는 스케줄링 전용 도구의 강점이며, 이들조차 리스트/테이블 뷰를 병행 제공하고 "날짜 없는 항목"은 캘린더 밖의 별도 트레이·드래프트함으로 뺀다.
- 운영형(operational) 대시보드 UX 문헌은 일관되게 "예외 우선(exception-first)" 구조를 권장한다: 지연·미처리 항목을 최상단에, 담당자·마감일·다음 행동과 함께 노출해야 실제 행동으로 이어진다는 것이 반복 확인됐다.
- 다중 통화는 어떤 소스도 합산을 권하지 않는다: 통화별로 그룹핑해 각각 소계를 내고, 절대 하나의 숫자로 더하지 않는 것이 일관된 규범이다.
- 소규모 컬렉션(2~20건)에서 반복적으로 항목을 오가며 즉시 편집하는 작업에는 master-detail(목록+상세 패널)이 별도 페이지 이동보다 적합하다는 것이 UI 패턴 가이드의 공통 결론이다.
- 결론적으로 **B(테이블 우선 + 일자별 요약 스트립)**가 조사된 증거와 가장 잘 부합하고, **A/C의 주간 캘린더-우선 구조는 업계 사례·UX 원칙 양쪽에서 지지 근거가 약하다.**

---

## 2. Q1 — 인플루언서 캠페인 관리 도구의 캠페인 상세 구조

| 도구 | 기본 뷰 | 진행 상태 표시 | 마감일/비용 | 성과 | 캘린더 사용 여부 |
|---|---|---|---|---|---|
| Upfluence | **테이블**(행=인플루언서) | 상단 "Campaign progress summary" 카운트(초대·숏리스트·배송/초안/게시 메일 수신·정산대상) + Status 컬럼 | Your Offer/Influencer Price 컬럼 | 별도 "Performance" 탭(주문/전환 테이블) | 없음 |
| GRIN | **테이블/Work Room**("Progress" 섹션) | "Content Progress does not have content" 같은 **예외 필터**로 미제출 인플루언서 걸러내기 | 별도 Reporting Dashboard | 별도 Reporting Dashboard(실시간 지표) | 없음(콘텐츠 캘린더는 마케팅 문구에서만 언급, 실 UI 확인 불가) |
| Aspire | 홈 = KPI 요약 + 7일 Activity Feed + Recent Content 캐러셀. 캠페인 내부는 substage별 **콘텐츠 승인 큐**(Pending Review/Rejected/Approve w/comments/Approved/Live) | substage 이동으로 표시, "+"로 전체 인플루언서 펼침 | Budget Ledger 별도 기능 | 별도 Impact/Sales/Social Dashboard | 없음 |
| CreatorIQ | 워크스페이스(온보딩-승인-추적-리포팅 통합) — 구체 UI 스크린샷 확인 불가 | 워크플로우 자동화로 표시 | 계약/결제 워크플로 통합 | 8시간 주기 갱신 리포트 | **[명시적으로 확인 불가]** |
| Traackr | 캠페인 워크스페이스(브리프·트래킹·승인·결제) | 워크플로우 단계 | 스펜드 트래킹, CPP/CPE 등 지표 | 실시간 트래킹 + 벤치마킹 | **[명시적으로 확인 불가]** |
| Modash | 캠페인 대시보드: Overview(KPI 카드) → Published content(리스트, creator/date/alert별 그룹핑) → Creators 탭(테이블, 비용·ROAS 포함) | 콤플라이언스 얼럿(태그 누락 등) | 크리에이터별 total cost 컬럼 | Views/Engagement/Clicks/Sales 카드 + 콘텐츠별 지표 | 없음 |
| Klear(Meltwater) | Campaign 탭 하위 **Members(테이블, CRM)** / Connect / **Measure**(Overview 총계 + Analytics 차트) | Members 테이블에 커스텀 컬럼(최대 10개) | 결제 처리 언급되나 상세 불가 | Measure 탭에서 posts/engagements/reach/EMV | 없음 |
| Later Influence(Mavrck) | 워크플로우 단계 테이블(Candidates→Deliverables→...), Reports는 별도 대시보드 | 단계(Stage) 컬럼 + 개별/일괄 마감일(Due Date) 업데이트 | Estimated/Total Cost of Campaigns, CPE/CPM 지표 | 캠페인별 리포트 테이블 + 트렌드 차트 | 없음 |
| Favikon V3 | 캠페인 대시보드 + **Kanban**(외주 단계: Contacted/Confirmed/Declined) | Kanban 단계 | Cost Metrics 섹션 | Content/Creators/Outreach analytics | **콘텐츠 캘린더**가 별도 기능으로 존재(예정/게시/대기 콘텐츠 한곳에) — 조사된 도구 중 유일하게 캘린더를 명시 |

**[인용]** 근거: help.upfluence.co/en/articles/9490861 (Understanding the Campaign table view), help.grin.co/docs/how-to-review-which-creators-have-not-delivered-content, help.aspireiq.com/en/articles/10471308, help.modash.io/en/articles/13717084, community.meltwater.com/meltwater-product-answers-428, help-influence.later.com/hc/en-us/articles/20462418701207, favikon.com/blog/favikon-v3-the-future-of-influencer-marketing-out-now

**[패턴]** 8개 중 7개 도구가 "진행"과 "성과"를 **같은 화면의 다른 섹션/탭**으로, "비용"을 **테이블 컬럼**으로 다루고, 시간축을 캘린더가 아니라 필드(마감일·상태)로 표현한다. Kanban은 존재하지만 콘텐츠의 "발행일"을 배치하는 용도가 아니라 **아웃리치/승인 파이프라인 단계**를 나타내는 용도로만 쓰인다.

**#paid, partnrUP, Cure Media**는 매니지드 서비스형이라 대시보드 상세 구조를 소스에서 검증하지 못했다. **[명시적으로 확인 불가]**로 남긴다.

---

## 3. Q2 — 콘텐츠 캘린더/소셜 스케줄링 도구의 캘린더 vs 리스트

| 도구 | 캘린더 뷰 | 리스트/테이블 뷰 | 날짜 없는 항목 처리 |
|---|---|---|---|
| Planable | 주/월 단위, 드래그앤드롭, 여러 채널 통합 | List view(대량 작업·필터·저장뷰 전용, 유료 플랜) | 캘린더 좌측 **"Saved" 컬럼(트레이)**에 위치, 준비되면 드래그로 배치 **[인용]** |
| Sprout Social | List/Week/Month 3뷰 | List View: "게시 순서를 파악하기 가장 좋음" | Scheduled Drafts만 노란색으로 캘린더 표시, **Unscheduled Drafts는 캘린더에 노출 안 됨** → 별도 Drafts 폴더 **[인용]** |
| Hootsuite Planner | Day/Week/Month, "post status별 월 보기"로 지연/실패 등 필터 | List view("2일 단위 리스트 + 상단 볼륨 그래프") | Unscheduled Draft는 캘린더에 안 나타남, Drafts 필터에서만 확인 **[인용]** |
| Notion 콘텐츠 캘린더 템플릿 | Publish Date 있는 항목만 필터링해 표시 | Table view("Status is not Published" 필터로 백로그 확인), Kanban(단계별) | 별도 뷰(테이블/칸반)로 전환해 확인 — 캘린더 안에 트레이 없음 **[패턴]** |
| Airtable 콘텐츠 캘린더 템플릿 | Calendar view(갭·중복 파악용) | List/Gallery/Kanban 뷰 병행 | 동일 데이터, 뷰 전환 방식 **[인용]** |

**[패턴]** 캘린더의 명시된 장점은 반복적으로 "**갭(공백) 발견**", "**케이던스 균형**", "**일정 시각화**"이며, 리스트/테이블의 장점은 "**게시 순서 파악**", "**대량 작업**", "**세밀한 검토**"다. 그리고 **날짜 없는 항목은 예외 없이 캘린더 밖에서 관리**된다 — Planable만 유일하게 캘린더에 붙은 전용 트레이를 제공하고, 나머지(Sprout, Hootsuite, Notion)는 완전히 별개의 리스트/필터 화면으로 뺀다. 이는 우리 케이스에서 "예정일 없는 콘텐츠"가 드물지 않게 존재한다는 조건과 마찰이 있다 — 캘린더가 기본 뷰라면 상당수 콘텐츠(초안·검수 단계에서 아직 날짜 미정)가 캘린더 밖 트레이에 쌓여, 정작 "지연 여부"를 봐야 하는 화면에서 안 보이게 될 위험이 있다. **[추측]**

---

## 4. Q3 — 운영형 대시보드 UX: 예외 우선, 요약 스트립, master-detail

**운영형 vs 분석형 구분 (원류 정의)**
> "Operational dashboards exist to provide information quickly to users that are making immediate decisions and carrying out time-sensitive tasks... Analytical dashboards help users identify the need for further thought, investigation, research, or analysis." **[인용]** (NN/g, "Dashboards: Making Charts and Graphs Easier to Understand", nngroup.com/articles/dashboards-preattentive)

이 정의에 따르면 캠페인 상세 페이지는 명백히 **운영형**이다 (기획자가 매일 열어 즉시 행동을 취함). NN/g는 운영형 대시보드에서 "허용 범위를 벗어난 편차"를 빠르게 식별하는 것이 핵심이라고 명시한다.

**예외 우선(Exception-first) 구조의 근거**
- "Exception-led dashboards had a 100% decision spine pass rate, compared with 9 of 22 value-led views." **[인용]** (ofspace.co, "We Reviewed 53 SaaS and Fintech Dashboards")— 즉 지연/예외 중심으로 짜인 화면은 사용자가 "무엇을 해야 하는지"까지 구조적으로 안내하지만, 성과(숫자) 중심 화면은 해석 단계가 따로 필요해 실패율이 높다.
- "Overdue measures are the single most actionable data point... They show exactly where the process has stalled: a named person, a named risk, a specific action that is late." **[인용]** (Risk Companion, "Risk Dashboard Design: Signal Over Noise")
- 운영자 대시보드의 표준 컬럼 스펙: **우선순위 점수, 담당자(개인), SLA/마감일(경과율에 따라 amber→red), 제안된 다음 행동, 근본원인 드릴다운 링크.** "해결된 예외는 자동으로 빠지고 새 예외가 나타난다." **[인용]** (DataCult, "Executive vs Operator Dashboards")
- "Priority-driven layout. Critical events and active tasks must dominate the UI... Action proximity to insight. Each surfaced item should be paired with a direct action." **[인용]** (Lazarev.agency, "Data dashboard design that drives action")

**테이블 설계 원칙**
NN/g는 표가 지원해야 할 4대 과제를 제시한다: 조건에 맞는 레코드 찾기(필터/정렬), 데이터 비교(헤더 고정·줄무늬·인접 컬럼), 단일 행 보기/편집("사이드 패널로 전체 표를 가리지 않고 편집" — master-detail과 동일 원리), 레코드에 액션 취하기(단일/일괄 액션). **[인용]** (NN/g, "Data Tables: Four Major User Tasks")

카드 vs 리스트: "List view allows for easy sorting and is space efficient, while card view is visually engaging and creates effective groupings." **[인용]** (NN/g, "Card View vs. List View") — 숫자 비교(비용·성과)가 목적이라면 카드보다 표가 유리하다는 근거로 읽힌다.

**5~7개 위젯 상한, 좌상단 우선순위**는 여러 소스에서 반복됐다: "5-7 widgets per view", "Position 3-4 critical scorecards... in the top-left viewport." **[패턴]** (Valiotti Data "10 Dashboard Design Rules, 6 Years Later"; uxmagic.ai "Dashboard UI Design")

---

## 5. Q4 — 비용/다중 통화 표시 패턴

일관된 결론: **서로 다른 통화는 절대 합산하지 않는다.**

- "Multi-currency reporting is not solved by attaching a currency code and summing everything... Never sum unlike currencies... A combined total is valid only after conversion under one documented policy." **[인용]** (GraphJSON Docs, "Multi-currency and FX analytics")
- Shopify Polaris는 혼합 통화 맥락에서 **"explicit format"**(통화 코드+금액, 예: `JPY ¥120,000`)을 총액에 항상 쓰고, 개별 항목에는 문맥상 통화가 분명할 때만 짧은 형식(기호만)을 허용하라고 규정한다. "Always use explicit format for cart total, checkout total, and notification totals." **[인용]** (Shopify Polaris, "Formatting localized currency")
- "Not all currencies have currency symbols... more than 15 currencies use the '$' symbol." 따라서 기호 단독 표기는 모호하며 코드를 병기해야 한다. **[인용]** (Maersk Design System, "Currency and pricing")
- 실무 아키텍처 관점: "a `usd_equivalent_minor` column so dashboards can sum across currencies... is fine as long as everyone understands it is a derived, lossy reporting convenience... never the basis for a refund, a tax filing, or a payout match." **[인용]** (SaaS Billing Architecture, "Multi-Currency Checkout & Localization") — 즉 합산 표시 자체가 금지되는 것은 아니나, **반드시 "참고용 환산치"라고 명시**해야 하며 우리 스펙(두 통화를 "절대 합산하지 않고 별도 표시")과 정확히 부합한다.
- Airtable 요약 바(Summary bar)는 그룹별로 자동 소계를 내지만 **통화를 구분해 그룹핑하는 기능은 없어**, 실무자들은 통화별로 별도 컬럼(Request in USD, Request in NIS 등)을 만들어 우회한다. **[인용]** (Airtable Community; support.airtable.com "Rollup field overview") — 이는 "인플루언서별 소계" 테이블에서 **통화를 그룹 기준(row grouping) 또는 별도 컬럼**으로 명시적으로 분리해야 한다는 실무적 시사점을 준다.

---

## 6. Q5 — 소규모 컬렉션의 리스트+상세(master-detail) 패턴

- "Use master-detail when users move repeatedly between a collection of items and full detail content... Avoid master-detail when no stable selected item exists." **[인용]** (uxpatternsguide.com, "Master-detail UX Pattern")
- "Locate and prioritize a large collection of content. Allow the quick addition and removal of items from a list while working back-and-forth between contexts." 641px 이상에서는 side-by-side, 그 이하는 stacked 권장. **[인용]** (Microsoft Learn, "List/details pattern")
- "Use a two-pane master+detail layout only when users need to switch between records rapidly without leaving context — grade adjudication or approval queues are good fits." 반대로 "a single-pane layout works best"인 경우는 필드·이력이 많아 "그 자체로 URL을 가질 만큼" 복잡할 때다. **[인용]** (CSI.UI Pattern Guide, "detail-pages")
- Linear의 UI는 리스트 행에서 아이덴티티(상태 마커)+제목+담당자를 한 줄에 압축하고, 선택된 행만 미묘하게 강조하며, 상세는 호버/선택 시에만 드러내는 **점진적 노출(progressive disclosure)**을 쓴다. **[패턴]** (Linear 공식 블로그 "behind-the-latest-design-refresh" + 3rd-party 디자인 분석, blakecrosley.com/design.withfudge.com) — 이는 2차 분석 자료 기반이라 **[패턴]**으로 표기.

우리 케이스(5~20건 콘텐츠, 2~6명 인플루언서, 매일 열어 즉시 수정)는 CSI.UI가 명시한 "빠르게 항목을 오가며 컨텍스트를 잃지 않아야 하는" 조건과 정확히 일치한다. **[추측]** 이는 A/B/C 모두 유지하는 master-detail(캠페인 목록 좌측 고정) 구조 자체는 타당함을 시사한다 — 갈리는 지점은 "그 안에서 콘텐츠 목록을 무엇으로 보여줄 것인가"다.

---

## 7. A/B/C 시안에 대한 함의

### A안 — master-detail + 주간 캘린더(요일 7컬럼) + 미정 트레이 + 인플루언서 소계 표
- 지지 근거: Planable의 "캘린더+Saved 트레이" 구조와 형태적으로 가장 유사하다 **[패턴]**.
- 반박 근거:
  - 조사한 8개 인플루언서 캠페인 관리 도구 중 캘린더를 **기본** 뷰로 쓰는 곳은 하나도 없었다 **[패턴]** — 업계 관행과 어긋난다.
  - "지연(마감일 경과, 미게시)"을 최우선으로 보여줘야 하는데, 캘린더는 구조적으로 **지난 날짜가 뒤로 밀려나 스크롤해야 보이는 형태**라 예외 우선 원칙(Q3, DataCult/ofspace/Risk Companion)과 정면으로 배치된다. 캘린더에서 지연 항목만 모아 "떠오르게" 하려면 별도 로직이 필요한데, 이는 결국 표 형태의 필터/정렬 기능을 재발명하는 것이다 **[추측]**.
  - 콘텐츠 카드 하나에 단계+비용+조회수+좋아요+링크클릭까지 넣으면 7일×N인플루언서 그리드 안에서 밀도가 과도해진다 — NN/g의 "인접 컬럼 비교" 원칙이 캘린더 그리드에서는 성립하기 어렵다 **[추측]**.
  - "미정 트레이"가 우리 케이스에서는 (예정일 없는 콘텐츠가 드물지 않으므로) 상당한 비중을 차지할 수 있어, 캘린더가 실제 작업량의 일부만 보여주는 화면이 될 위험이 있다.

### B안 — master-detail + 콘텐츠 테이블(날짜·제목·인플루언서·유형·비용·단계·성과) + 7-dot 일자별 요약 스트립 + 소계 표
- 지지 근거: Upfluence Campaign table view, GRIN Work Room, Modash Creators/Published content 탭, Klear Members 테이블 등 **조사된 사실상 전 도구의 기본 패턴과 구조적으로 일치**한다 **[인용/패턴]**.
- NN/g Data Tables의 4대 과제(찾기·비교·단일행 편집·액션)를 모두 그대로 지원할 수 있다 **[인용]**.
- "7-dot 요약 스트립"은 Sprout Social List View의 "상단 볼륨 그래프", Hootsuite Drafts의 "날짜별 드래프트 수 그래프"와 같은 계열의 하이브리드로, **표를 주가 되게 하면서 시간축 감각만 가볍게 보완**하는 선례가 있다 **[패턴]**.
- 인플루언서별 소계를 표로 두면 Airtable 그룹 요약 바처럼 통화별 분리가 자연스럽다 **[패턴]**.

### C안 — 전체 페이지 상세(목록은 별도 페이지) + 와이드 캘린더 + 우측 인플루언서 카드 사이드바 + 비용 총계 박스
- A안과 동일한 캘린더-우선 약점을 그대로 안고 있다.
- 목록을 별도 페이지로 분리하는 것은 master-detail 권장 조건("반복적으로 빠르게 항목을 오가며 컨텍스트 유지")과 어긋난다 — 매일 여러 건을 오가며 수정하는 우리 사용 패턴에서는 페이지 이동이 매번 컨텍스트 손실 비용을 발생시킨다 **[인용 기반 추론]** (CSI.UI, Microsoft List/details).
- 인플루언서를 카드로 나열하는 것은 "시각적으로 매력적이나 비교엔 불리하다"는 NN/g의 카드 vs 리스트 결론과 어긋난다 — 비용·통화 소계를 비교해야 하는 목적에는 표가 낫다 **[인용]**.

### 하이브리드 제안 (최대 2개)

**하이브리드 1 — "표 우선 + 일자 요약 스트립 + 예외 정렬 기본값" (B안의 구체화, 권장안)**
master-detail 골격은 유지하되, 콘텐츠 테이블을 기본 화면으로 삼고: (1) 상단에 Hootsuite/Sprout식 일자별 볼륨 스트립을 얇게 배치해 캘린더의 "케이던스 파악" 장점만 흡수하고, (2) 기본 정렬을 "지연 임박/경과순"으로 설정해 DataCult가 제시한 예외 큐 컬럼(담당 인플루언서, 마감 경과일, 다음 행동)을 지연 행에 붙이고, (3) 인플루언서 소계는 표 하단 접이식 섹션에, 통화별로 분리된 별도 열/구획으로 보여준다.

**하이브리드 2 — "표 우선 + 필요시 캘린더 오버레이" (일정 재배치 전용)**
평상시엔 하이브리드 1과 동일하되, "이번 주 일정 재배치"처럼 캘린더가 실제로 강점을 갖는 순간(Q2에서 확인된 "갭 발견·드래그앤드롭 재배치")에만 슬라이드오버/모달로 해당 캠페인의 주간 캘린더를 열람할 수 있게 한다. Planable이 List(대량작업)와 Calendar(배치 조정)를 별도 뷰로 병행 제공하는 것과 같은 발상이다 **[패턴]**. 캘린더를 상시 화면이 아니라 특정 작업(재배치)의 보조 도구로 격하시켜, 매일 여는 기본 화면은 늘 표 형태를 유지한다.

---

## 8. 추천

1. **기본(primary) 뷰는 표(테이블)로 한다.** B안 계열을 기반으로 진행할 것을 권장한다. 근거: 조사된 인플루언서 캠페인 관리 도구 전체의 관행 **[패턴]**, NN/g의 테이블 4대 과제 부합 **[인용]**, 운영형 대시보드는 "열거(enumeration)가 과제일 때 답은 표"라는 지침과 일치 **[인용]**(Valiotti Data).
2. **헤더 요약 스트립**에는 KPI 카드보다 "지연 N건"과 같은 예외 카운트를 최상단 좌측에 우선 배치하고(예외 우선 원칙 **[인용]** ofspace/DataCult), 그 다음에 단계별 카운트(초안/검수/승인/전달/게시), 통화별 비용 총계 순으로 둔다. 5~7개 카드 상한을 지킨다 **[인용]**(Valiotti Data, uxmagic.ai).
3. **지연 표시**는 행 강조(색상) + 별도 필터/정렬 옵션으로 구현하고, 지연 행에는 "담당 인플루언서 · 경과일 · 재촉 액션 버튼"을 붙인다. DataCult가 제시한 예외 큐 컬럼 스펙을 참고 모델로 삼을 수 있다 **[인용]**.
4. **일자별 감각**은 캘린더 전체 화면이 아니라 Sprout/Hootsuite식의 얇은 요약 스트립(또는 하이브리드 2의 오버레이)으로 보완한다. 캘린더를 기본 화면으로 승격시킬 근거는 조사에서 발견하지 못했다 **[패턴]**.
5. **인플루언서별 소계는 표 형태**로 하단(또는 접이식)에 배치한다. 카드가 아니라 표를 쓰는 것이 비용 비교에 유리하다 **[인용]**(NN/g Card vs List).
6. **혼합 통화**는 절대 하나의 숫자로 합산하지 않는다. 통화별로 그룹핑해 각각 소계를 내고(KRW 총계 / JPY 총계를 나란히, 별도 박스로), 통화 코드를 항상 금액과 함께 명시("JPY ¥120,000" 형태)한다 **[인용]**(GraphJSON, Shopify Polaris, Maersk Design System). 만약 참고용 원화 환산 합계를 굳이 보여주고 싶다면, "환산 참고치"임을 명확히 라벨링해야 한다 **[인용]**(SaaS Billing Architecture).
7. **목록+상세 구조(master-detail)** 자체는 유지한다 — 소규모 컬렉션을 매일 반복적으로 오가며 즉시 편집하는 우리 사용 패턴과 정확히 일치하는 권장 조건이다 **[인용]**(CSI.UI, Microsoft Learn List/details, uxpatternsguide.com).

---

## 9. 출처 목록

**인플루언서 캠페인 관리 도구**
- https://help.grin.co/docs/how-to-review-which-creators-have-not-delivered-content
- https://grin.co/product/influencer-content-management-platform/
- https://help.aspireiq.com/en/articles/10370687-how-do-i-review-content-using-group-content-review
- https://www.aspire.io/content-managers
- https://www.aspire.io/platform/content-management
- https://help.aspireiq.com/en/articles/10471308-navigating-the-aspire-platform
- https://www.aspire.io/
- https://help.upfluence.co/en/articles/6997281-how-to-track-and-manage-campaign-sales-result-using-the-performance-tab
- https://help.upfluence.co/en/articles/12130328-how-to-use-the-sales-reporting-dashboard
- https://help.upfluence.co/en/articles/9490861-understanding-the-campaign-table-view
- https://help.upfluence.co/en/articles/6997271-how-to-set-up-and-track-influencer-sales-with-a-tracking-plan
- https://help.upfluence.co/en/articles/8685313-how-to-monitor-both-clicks-and-sales-using-affiliate-links
- https://www.creatoriq.com/influencer-marketing-solution/influencer-campaign-management
- https://www.creatoriq.com/whats-new-in-creatoriq/smarter-campaigns
- https://www.traackr.com/influencer-tracking
- https://academy.traackr.com/campaign-creation
- https://www.traackr.com/influencer-marketing-blog/influencer-marketing-platform-evaluation
- https://help.modash.io/en/articles/13717084-understanding-campaign-analytics
- https://help.modash.io/en/articles/5467242-start-a-campaign
- https://www.modash.io/features/influencer-tracking
- https://community.meltwater.com/meltwater-product-answers-428/meltwater-klear-11557
- https://www.meltwater.com/en/blog/meltwater-influencer-marketing-user-guide-klear
- https://help-influence.later.com/hc/en-us/articles/20462335644567-Deliverables
- https://help-influence.later.com/hc/en-us/articles/20462367230871-Create-a-New-Campaign
- https://help-influence.later.com/hc/en-us/articles/20462418701207-Campaign-Due-Dates
- https://help-influence.later.com/hc/en-us/articles/20462357864599-Reports
- https://www.favikon.com/features/campaigns
- https://help.favikon.com/en/articles/12732804-managing-your-active-campaigns
- https://www.favikon.com/blog/favikon-v3-the-future-of-influencer-marketing-out-now
- https://hashtagpaid.com/how-it-works (#paid — 상세 대시보드 구조 미검증)
- https://partnrup.ai/platform/campaign-management/ (상세 대시보드 구조 미검증)

**콘텐츠 캘린더/스케줄링**
- https://help.planable.io/hc/en-us/articles/21715383136924-Calendar-view
- https://help.planable.io/en/articles/9076171-how-can-i-find-my-draft-posts
- https://planable.io/product/
- https://planable.io/universal-content/
- https://support.sproutsocial.com/hc/en-us/articles/360000121343-How-do-I-use-the-Publishing-Calendar
- https://support.sproutsocial.com/hc/en-us/articles/38373940164877-Troubleshooting-Sprout-Social-Publishing-Calendar-Issues
- https://help.hootsuite.com/s/article/manage-content-calendar
- https://help.hootsuite.com/s/article/drafts
- https://help.hootsuite.com/s/article/create-and-schedule
- https://www.airtable.com/templates/content-calendar/exp3FNmOkdHZvprXB
- https://autoflowguide.com/how-to-build-notion-content-calendar-solopreneurs/
- https://uxerwave.com/productivity-workflow/how-to-use-notion-content-calendar/
- https://help.asana.com/s/article/campaign-management
- https://asana.com/templates/campaign-management

**운영형 대시보드/테이블 UX**
- https://www.nngroup.com/articles/dashboards-preattentive/
- https://www.nngroup.com/articles/data-tables/
- https://www.nngroup.com/videos/card-view-vs-list-view/
- https://www.ofspace.co/blog/dashboard-audit
- https://valiotti.com/dashboard-design-rules/
- https://www.lazarev.agency/articles/data-dashboard-design
- https://www.datacult.ai/2026/03/16/resources-executive-vs-operator-dashboard/
- https://uxmagic.ai/blog/dashboard-ui-design
- https://risk-companion.com/blog/risk-dashboard-signal-over-noise/
- https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards

**다중 통화/비용**
- https://www.graphjson.com/docs/Guides/multi-currency-and-fx-analytics
- https://polaris-react.shopify.com/foundations/formatting-localized-currency
- https://designsystem.maersk.com/content/currency-and-pricing/
- https://www.saas-billing-architecture.com/frontend-checkout-ux-dunning-recovery-flows/multi-currency-checkout-localization/
- https://community.airtable.com/automations-8/automatically-converting-between-multiple-currencies-24518
- https://support.airtable.com/articles/7497685062-rollup-field-overview
- https://support.airtable.com/articles/7344081006-using-the-summary-bar-in-airtable-views

**소규모 컬렉션의 master-detail**
- https://uxpatternsguide.com/patterns/master-detail/
- https://developer.android.com/develop/adaptive-apps/guides/list-detail
- https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/list-details
- https://www.patternfly.org/patterns/primary-detail/design-guidelines
- https://design.csi.byui.edu/patterns/detail-pages
- https://linear.app/now/behind-the-latest-design-refresh
- https://linear.app/now/how-we-redesigned-the-linear-ui
