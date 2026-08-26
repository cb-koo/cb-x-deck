# 캠페인 관리 — 설계 스펙

작성: 2026-08-25 · 브랜치 `cb-koo/campaign-management` · 상태: 구현 완료(08-26, Task 1~15 리뷰 승인·최종 브랜치 리뷰 With fixes 반영) — koo QA·머지 대기
리서치: `docs/research/campaign-dashboard-ux-research-20260825.md` (표 vs 달력·예외 우선·통화 분리 근거)
시안: `.superpowers/brainstorm/22867-1787648782/content/{hybrid1,calendar-v1-v2}.html` (로컬, 미커밋)

## 0. 한 줄 정의

**캠페인 = 클라이언트 1 × 기간 1 동안 나가는 콘텐츠(원고)의 묶음.** 원고가 캠페인의 단위이고, 인플루언서는 원고에 배정된 값에서 파생되며, 비용은 원고(콘텐츠 비용)와 캠페인×인플루언서(추가 비용) 두 자리에만 붙는다. 진행 단계·인플 목록·캠페인 상태·합계는 전부 저장하지 않고 계산한다.

## 1. 목적과 사용 맥락

- 사용자: 콘텐츠 기획 담당자 2~5명. 한 클라이언트의 **주 단위(때로 더 긴) 캠페인을 운영하는 동안 매일 여는 작업 화면**. 보고용 대시보드가 아니라 그 자리에서 값을 고치는 운영 화면.
- 열었을 때 답해야 하는 질문(우선순위 순):
  1. **진행** — 콘텐츠별로 어디까지 왔나(초안→검수 대기→사용 확정→전달됨→게시됨), **밀린 것**(예정일 지났는데 미게시)은 무엇인가. 예외를 먼저.
  2. **성과** — 게시된 것의 조회·좋아요·링크 클릭. 행마다 한 줄 + 상단 합계.
  3. **비용** — 콘텐츠 비용 + 인플별 추가 비용. 통화(원/엔)는 합치지 않는다. 지급 관리는 범위 밖(다른 시스템).
  4. **계획** — 원고 추가·배정·예정일 조정. 별도 계획판 없이 화면 안의 동작.
- 규모: 캠페인당 콘텐츠 5~20개, 인플 2~6명. 필터·집계보다 "한눈에 전부"가 맞는 크기.

## 2. 데이터 모델 (마이그레이션 033)

main은 032까지(032 = 인플루언서 협찬 단가·계정 분석, 08-25 main 095b13f 머지됨 — 이 브랜치에 머지 완료) → 캠페인은 **033**. `influencer.pricing` 컬럼은 032가 만든다(당초 033에 멱등 DDL을 넣기로 했으나 머지로 불필요).

### 2-1. `campaign` (신설)

| 컬럼 | 타입 | 뜻 |
|---|---|---|
| `id` | uuid pk | |
| `client_id` | uuid → client, on delete set null | |
| `client_name` | text | 스냅샷(014 관례) |
| `name` | text not null | 화면 이름. 생성 시 기본 제안 `{클라} {M월 N주}`, 수정 가능. **N주 = 시작일이 든 주(월~일)의 목요일 기준**(구현 결정 08-26: 달력일 기준은 8/31 시작을 '8월 5주'로 제안해 실무 표기 '9월 1주'와 어긋남) |
| `name_en` | text not null | 영문 코드. `checkCampaign` 규칙(영어·숫자·하이픈·._). 기본 제안 `{클라 영문(name_en) 소문자}-{시작일 YYYYMMDD}`, 클라 영문명이 없으면 `{시작일}`. 트래킹 링크 `utm_campaign` 기본값으로 이어짐 |
| `starts_on` / `ends_on` | date not null | 서울 기준 날짜(`DateOnly`). `ends_on >= starts_on` check |
| `kind` | text null | `content`(콘텐츠 의뢰) · `visit`(방문협찬) · `seeding`(시딩) · null. 표시·필터용, 로직 분기 없음 |
| `note` | text not null default '' | |
| `created_by` | uuid → member, set null | |
| `created_at` / `updated_at` | timestamptz not null default now() | 트리거 없음 — 스토어가 `updated_at = now()` 수동 갱신(clientStore 관례) |

인덱스: `(client_id)`, `(starts_on desc)`.

### 2-2. `campaign_influencer_cost` (신설)

**명단이 아니다.** 캠페인×핸들에 붙는 추가 비용·메모의 저장소. 행은 추가 비용이나 메모를 처음 적을 때 생긴다.

| 컬럼 | 타입 | 뜻 |
|---|---|---|
| `id` | uuid pk | |
| `campaign_id` | uuid → campaign, on delete cascade | |
| `influencer_handle` | text not null | 핸들 자연키(023 관례). `unique (campaign_id, lower(influencer_handle))` |
| `extra_costs` | jsonb not null default '[]' | `[{label: string, amount: int ≥ 0, currency: 'KRW'|'JPY'}]` |
| `note` | text not null default '' | 이 캠페인에서 이 사람에 대한 한 줄 |
| `created_at` / `updated_at` | timestamptz not null default now() | updated_at은 upsert 시 수동 갱신 |

### 2-3. `draft` 컬럼 3개 추가

| 컬럼 | 타입 | 뜻 |
|---|---|---|
| `campaign_id` | uuid → campaign, on delete set null | 소속 캠페인. null = 없음. 원고는 캠페인보다 오래 산다 |
| `scheduled_on` | date null | 게시 예정일(서울 기준). null = 미정 |
| `cost` | jsonb null | `{type: 'rt'|'quoteRt'|'post'|'visit', amount: int ≥ 0, currency: 'KRW'|'JPY'}`. 유형·통화 타입은 `src/lib/influencerPricing.ts`의 `PriceType`·`Currency`를 **import**(main 머지로 사용 가능 — 지역 정의 안 함). `campaignCost.ts`는 cost/extra_costs 검증·통화별 합계·`formatMoney` 재사용만 담당 |

인덱스: `(campaign_id)`.

**`updateDraft`·`updateDraftsBulk` 패치 규칙**: 세 필드는 `influencer_handle`과 같은 `case when {patch.x !== undefined} then {value} else x end` 패턴을 쓴다. `coalesce`는 "null이면 유지"라 예정일 지움·캠페인에서 빼기·비용 지움을 표현할 수 없다(현 코드 `draftStore.ts` updateDraft 주석 참조). `undefined` = 건드리지 않음 · `null` = 지움 · 값 = 설정. `updateDraftsBulk`에도 `campaignId?: string | null`을 같은 패턴으로 추가하고, bulk 라우트(`api/drafts/route.ts`)의 "바꿀 내용이 없어요" 400 가드 조건에 `campaignId === undefined`를 포함한다(현재 status·influencerHandle만 검사 — campaignId만 보낸 요청이 거절됨, 리뷰 Blocking 4).

### 2-4. 파생값(저장하지 않는다)

| 값 | 정의 |
|---|---|
| 콘텐츠 단계 | `draft.status` 5종 + **게시됨** = `exists(tracked_post where draft_id = draft.id)`. 게시됨이면 status와 무관하게 "게시됨"으로 표시(status 값 자체는 바꾸지 않는다) |
| 밀림 | `scheduled_on < 오늘(서울)` and not 게시됨 and status ≠ `unused` |
| 준비 중 | 합성 라벨 = `draft` + `review` + `approved` (초안·검수 대기·사용 확정). `STATUS_LABEL`에 없는 라벨이므로 이 정의를 `campaignJudgment`에 두고 칩·카드가 같은 함수를 쓴다 |
| 게시됨 n / N | N = 캠페인 원고 수 **미사용(`unused`) 제외** — 밀림 판정과 같은 모집단(라벨-값 일치). 미사용은 표에 흐리게 표시, 요약에서 제외 |
| 기간 밖 | `scheduled_on`이 `[starts_on, ends_on]` 밖 — 경고 표시만, 저장 차단 없음 |
| 캠페인 상태 | 오늘 < starts_on → **예정** · 안 → **진행 중** · 오늘 > ends_on → **종료**. 수동 상태 없음 |
| 인플 목록 | 캠페인 원고의 `influencer_handle` 집합(소문자 기준 중복 제거) ∪ `campaign_influencer_cost`에 행이 있는 핸들. 후자만 있고 원고 0이면 "배정 원고 없음" 표시 — 돈이 붙었는데 안 보이는 일을 막는다 |
| 인플 소계 | 콘텐츠 비용 합(통화별) + 추가 비용 합(통화별) |
| 캠페인 합계 | 인플 소계의 통화별 합. **통화 간 합산 금지**, 코드 병기(`360,000원 · 95,000엔`) |
| 성과 | 원고별 최신 `post_metric_snapshot`(lateral, trackingStore 관례) 합 + 최신 `link_click_snapshot` 합. 원고에 게시물이 여러 개면 합산 |

판정 로직은 `src/lib/campaignJudgment.ts` 순수 함수로 단일화(`influencerJudgment.ts` 선례). 서버 요약·클라 표시가 같은 함수를 쓴다. "오늘"은 `kstToday()`.

### 2-5. 값은 하나 — 동기화 규칙

- 인플 배정은 `draft.influencer_handle` 하나. 캠페인 화면에서 바꾸면 기존 `PATCH /api/drafts/[id]`를 그대로 호출 → `syncInfluencerOnDraftUpdate`(인플 프로필 자동 로그)가 그대로 돈다. 캠페인 전용 배정 경로를 만들지 않는다.
- 인플 핸들 변경(`influencerStore.ts` renameInfluencer — sql 인자를 받고 트랜잭션은 호출자 소관): `draft.influencer_handle` 일괄 갱신과 **같은 트랜잭션에서 `campaign_influencer_cost.influencer_handle`도 갱신**한다. 빠지면 추가 비용이 옛 핸들에 고아로 남는다. **충돌 규칙**: 같은 캠페인에 옛·새 핸들 행이 둘 다 있으면 unique 위반이 나므로 — 옛 행의 `extra_costs`를 새 행 뒤에 이어붙이고 `note`는 새 행이 비어 있을 때만 옛 값을 쓰고, 옛 행을 삭제한다(리뷰 Blocking 5).
- 클라이언트 삭제: `campaign.client_id` null, `client_name` 스냅샷으로 표시 유지(원고와 동일).
- 캠페인 삭제: 원고는 지우지 않는다(`campaign_id` set null). 예정일·비용은 원고에 남는다. 확인 다이얼로그 필수.

## 3. 화면

### 3-1. 위치

사이드바 "콘텐츠 생성·인플루언서·트래킹" 그룹 **맨 위에 "캠페인"** (`/campaigns`). 캠페인이 셋을 묶는 상위 개념.

### 3-2. 구조 — 목록 + 상세(master-detail), 상세는 표 ↔ 주간 달력 전환

리서치 결론(인플 캠페인 도구 8종 전부 표가 기본·예외 우선·날짜 없는 항목은 달력 밖) + koo 결정(V2 전환형). 시안 `calendar-v1-v2.html`의 V2.

```
┌ 캠페인 목록 280px ─┬ 상세 ──────────────────────────────────────────────┐
│ [+ 새 캠페인]      │ 헤더: 이름 · 상태 pill · 클라 / 속성 한 줄(기간·유형·코드, 클릭 편집) / 메모(있을 때만) │
│ 진행 중 (1)        │        [+ 원고 추가] [···]                              │
│  ▸ 리프팅 8월 4주  │ 요약 카드 4: ⚠밀림 N | 게시 n/N | 비용(원|엔) | 조회 합계     │
│ 예정 (1)           │ [ 표 | 주간 달력 ]   기본 표 · 마지막 선택 기억(localStorage) │
│ 종료 (2) ▸접힘     │ ── 표: 예정일·콘텐츠·유형·인플루언서·비용·단계·성과 (밀림 먼저) │
│                    │ ── 달력: 월~일 7열 + 예정일 없음 열, 카드 드래그로 예정일 변경  │
│                    │ 인플루언서별 비용 표(공통): 콘텐츠 n·콘텐츠 비용·추가 비용·소계 │
└────────────────────┴──────────────────────────────────────────────────────┘
```

**목록**: 진행 중 / 예정 / 종료 그룹. 종료는 기본 접힘(koo 선택). 행 = 이름 + 보조줄(기간 · 콘텐츠 n개). 진입 시 진행 중 첫 캠페인 자동 선택(클라이언트 페이지 관례; 없으면 빈 상태 안내).

**요약 카드**(예외 우선 순서): ① ⚠ 밀림 N — 보조: 0이면 "없음 — 예정대로", N>0이면 판단 문구 ② 게시됨 n / N — 보조 "전달됨 a · 준비 중 b"(0 항목 생략, N=0 "콘텐츠 없음", 전부 게시 "모두 게시됨") ③ 비용 합계 — 원화만 "원화 기준 · 엔화 없음"/엔화만 그 반대/둘 다면 두 숫자·보조 없음/없으면 "비용 입력 없음"; 통화 설명은 라벨 옆 ⓘ ④ 조회 — 보조 "게시된 콘텐츠 없음 · 링크 클릭 n" 또는 "게시 n건 · 좋아요 · 링크 클릭". **보조 줄 = 판단 한 줄, 방법 설명은 ⓘ**(QA 1라운드 08-26, 리서치 `campaign-header-kpi-ux-research-20260826.md` §6). 숫자 24~26px, 라벨은 아래 13px.

**콘텐츠 표** — 열 7개 고정: 예정일(110) · 콘텐츠(남는 폭 전부) · **유형(120)** · 인플루언서(190) · 비용(120) · 단계(130) · 성과(180). (QA 1라운드: 유형은 스캔 대상이라 제목 보조줄이 아닌 열로; 단문/스레드 표기는 캠페인 관리에 중요치 않아 제거.)
- 기본 정렬 "밀린 것 먼저" → 예정일 오름차순 → 예정일 없음 마지막 → 미사용 맨 아래(흐리게). 정렬 드롭다운(예정일·단계·인플). 필터 칩: 전체·준비 중(§2-4 정의)·전달됨·게시됨.
- 밀린 행: 연한 빨강 배경 + 왼쪽 3px 빨간 막대 + "8/26 수 · 1일 지남".
- 콘텐츠 셀: 제목만(`title → koTitle → 첫 줄` 폴백, 2줄 말줄임). 클릭 → DraftCard 모달(단일 표면). 유형 셀 = `COST_TYPE_LABEL[cost.type]`, 비용 없으면 "—".
- 예정일 셀: 텍스트(밀림이면 "· n일 지남"), hover 편집 배경, 클릭 → 날짜 입력 + "지우기" 라벨 버튼(편집 상태 안). 상시 ✕ 아이콘 없음(QA 1라운드).
- 인플루언서 셀: 아바타 이니셜 + @핸들 + "변경" 텍스트 링크(InfluencerField 재사용, 명부 자동완성).
- 비용 셀: 클릭 → 유형·금액·통화 팝오버. 인플 배정·변경 시 **제안**: 금액 = `influencer.pricing[type]`, 통화 = `pricing.currency ?? 'KRW'`(통화는 유형별이 아니라 pricing 레벨 1개, 리뷰 Blocking 3). 비어 있을 때만 자동 채움 — 사람이 적은 값은 덮지 않음. `pricing`이 `{}`거나 그 유형 금액이 없으면 빈칸.
- 단계 셀: `DraftStatusChip` + 게시됨(초록 ✓). 클릭 → 상태 변경(기존 칩 동작). 옆에 "게시물 연결" 진입점(트래킹 등록 모달, `draft_id` 자동) — 소수 케이스용, 자동 매칭은 백로그.
- 성과 셀: 게시됨 행만 "조회 12,400 · 링크 96" 한 줄(koo 선택: 열 한 줄, 자세한 건 원고 카드). 나머지 "—".
- 행 메뉴(···): 캠페인에서 빼기 · 원고 열기.
- 표 규격: 행 ≥ 48px, 본문 15px, 보조 13px, 12px 이하 금지(단위 라벨 제외). **가독성 기준은 구현 체크리스트**(koo 08-25: "맨날 빽빽해서 보기 힘들다").

**주간 달력**(구현 순서상 마지막 — 표·연결점이 동작한 뒤 붙인다. koo가 V2로 확정한 범위이므로 후속 릴리스로 미루지는 않는다) — 캠페인 기간을 주 단위로: 7일 이하면 한 주, 넘으면 ◀ 8/24 주 ▶ 넘김(기본은 오늘이 든 주, 기간 밖이면 시작 주). 열 = 월~일 + "예정일 없음"(오른쪽, 점선). 카드 = 제목(2줄 말줄임) · @핸들 · 단계 칩. 밀린 카드 빨간 막대 + "n일 지남". 오늘 헤더 파란 강조. **카드 드래그 → 예정일 변경**(요일 ↔ 예정일 없음 포함, `PATCH scheduled_on`). 기간 밖 카드는 "기간 밖" 배지. 달력에서 새 원고 만들기는 백로그.

**인플루언서별 비용 표**(두 보기 공통, 하단) — 열 5: 인플루언서(+메모 보조줄) · 콘텐츠 n · 콘텐츠 비용 · 추가 비용(항목 나열 + [+ 추가]) · 소계. 하단 합계 통화별. 도움말 한 줄 "콘텐츠 비용 + 추가 비용을 사람별로 모았어요. 통화가 다르면 따로 보여요." 추가 비용 [+ 추가] → 항목명·금액·통화 팝오버, 항목 클릭으로 수정·삭제. 메모 클릭 인라인 편집.

### 3-3. 캠페인 만들기·수정·삭제

- [+ 새 캠페인] 모달: 클라이언트(필수, 명부 select) → 기간(기본 다음 월~일, DateOnly 두 칸) → 이름(자동 제안, 수정) → 영문 코드(자동 제안, `checkCampaign` 검사·메시지 재사용) → 유형(선택) → 메모. 만들면 그 캠페인이 선택된 상세로.
- 수정: 헤더는 제목 줄 + **속성 한 줄**(`기간 8/31 월 ~ 9/6 일 · 7일 · 유형 콘텐츠 의뢰 · 코드 mindskin-20260831 ⧉`, 좁으면 줄바꿈) — 값 클릭 시 그 값만 편집(hover에 연필, Enter/이탈 저장·Esc 취소, 유형은 선택 즉시 저장·닫힘, 기간은 두 날짜라 이탈까지 열림). **메모는 값이 있을 때만** 그 아래 패널로 표시, 추가는 [···] 메뉴 "메모 추가"(빈 칸 상시 노출 금지 — QA 2라운드 08-26 결정 A; 컬럼은 유지). 상시 폼 입력·긴 도움말 없음 — "기간 밖" 규칙은 기간 라벨 옆 ⓘ(QA 1라운드 08-26). 기간 변경으로 예정일이 기간 밖이 되면 막지 않고 카드·행에 "기간 밖" 표시.
- 삭제: [···] → 확인 다이얼로그("원고 N개는 남고 캠페인 소속만 풀립니다") → `DELETE`. 실행취소 없음(원고 무손실이라 위험 낮음).

## 4. 연결 흐름 — 원고를 캠페인에 넣는 입구 3개 (전부 `draft.campaign_id` 하나를 고친다)

1. **캠페인 화면 [+ 원고 추가]** → 분기
   - **기존 원고 고르기**: 그 클라이언트의 캠페인 미소속 원고를 검색 모달로(트래킹 원고 연결 모달 골격). 형제 시안(batch)은 A/B/C 라벨 표시 — **하나만 넣는 게 기본**(전부 넣으면 비용이 중복 집계됨을 모달 도움말에 명시). 여러 개 체크 → 한 문장 `update draft set campaign_id where id in`(updateDraftsBulk 관례, 커넥션 1개). 예정일은 비워두고 표에서 채움.
   - **새로 만들기**: `/generate?campaign={id}` — 클라이언트 자동 선택 + 이 화면에서 만든 원고(생성·직접 쓰기 모두)는 `campaign_id` 자동. 상단에 "리프팅클리닉 8월 4주 캠페인에 추가 중 [해제]" 배너로 상태를 보이게. 제목만 있는 "미작성" 칸도 직접 쓰기로 이 경로.
2. **DraftCard 캠페인 칸** — 인플루언서 칸 옆 "캠페인: 없음 ▾". 목록 = 그 원고 클라이언트의 진행 중·예정 캠페인(종료는 "종료 캠페인 보기"로 펼침). 클라이언트 없는 원고는 전체 캠페인. 여기서 바꾸면 캠페인 화면 즉시 반영. 예정일·비용 칸도 캠페인 소속일 때 카드에 함께 표시(값은 하나).
3. **/generate 표 보기 캠페인 열 + 필터 칩** — 새 화면 없이 축 추가.

**DraftRow 확장**: `campaignId · campaignName · campaignCode(name_en) · scheduledOn · cost` — draft select는 `draftStore.ts`의 `SELECT()` 한 곳이므로 `left join campaign` 1회로 전 경로 충족. `campaignName/Code`는 표시·트래킹 링크 제안용 파생 필드. **DraftCard prop**: 이미 18개 — 캠페인 관련(옵션 목록·onChange·예정일·비용)은 `campaign={{...}}` 객체 하나로 묶어 넘긴다(리뷰 Should 4).

## 5. 다른 기능과의 연결 (스키마 변경 없음)

| 기능 | 연결 |
|---|---|
| 트래킹 링크 | `TrackingLinkSection` prefill에 `campaignCode` 추가(DraftCard → 페이지까지 prop 배선) → `LinkCreateModal`의 `utm_campaign` 기본값 = 캠페인 코드(있으면), 없으면 현행 `suggestCampaign(클라)`. **모달 안 세팅 지점이 두 곳**(open 리셋 `useEffect`, 클라 로드 후 `suggestCampaign(c.nameEn\|\|c.name)`) — 둘 다 `campaignCode` 우선 규칙을 적용해야 조용히 덮이지 않는다(리뷰 Should 2). 캠페인 요약의 링크 클릭 = 그 캠페인 원고들의 `tracking_link` 최신 스냅샷 합 |
| 게시물 트래킹 | 게시됨 판정·조회수 = `tracked_post.draft_id`. 연결 안 된 게시물은 캠페인이 모른다 — 단계 셀 옆 "게시물 연결" 진입점으로 보완, 자동 매칭은 백로그 |
| 인플루언서 프로필 | "참여 캠페인" 섹션: 캠페인명·기간·배정 콘텐츠 n·비용 소계(통화별). 조회만, 새 로그 이벤트 없음. 캠페인명 클릭 → `/campaigns?id=` |
| 인플루언서 단가 | `influencer.pricing[type]`을 비용 제안에 사용. 032가 만든 컬럼·`influencerPricing.ts`(`Pricing`, `normalizeCurrency`)를 그대로 사용. `{}`거나 유형 금액이 없으면 제안 없음 |

## 6. API

| 메서드·경로 | 역할 |
|---|---|
| `GET /api/campaigns` | 목록 + 그룹용 상태(파생)·콘텐츠 수·통화별 합계 |
| `POST /api/campaigns` | 생성(검증: 클라 존재·기간·`checkCampaign`) |
| `GET /api/campaigns/[id]` | 상세 = 캠페인 + 원고 목록(DraftRow 확장 + 게시됨·성과) + 인플 목록(파생) + 추가 비용 행 + 요약 |
| `PATCH /api/campaigns/[id]` | 이름·코드·기간·유형·메모 |
| `DELETE /api/campaigns/[id]` | 삭제(원고 `campaign_id` null은 FK set null) |
| `PUT /api/campaigns/[id]/influencers/[handle]` | 추가 비용·메모 upsert(`campaign_influencer_cost`) |
| `PATCH /api/drafts/[id]` (기존) | `campaignId · scheduledOn · cost` 필드 추가. 인플 변경도 이 라우트 |
| `PATCH /api/drafts` bulk (기존) | `campaignId` 일괄 설정·해제 추가(400 가드 조건 확장, §2-3) |

인증·멤버 해석은 기존 `requireMember` 관례. 워크스페이스 FK 없음(클라이언트·원고와 동일 — 전 워크스페이스 공유 설계).

## 7. 오류·경계

- 기간 역순 → 400 + "종료일이 시작일보다 앞이에요". 영문 코드 위반 → 규칙은 `checkCampaign` 재사용, **문구는 캠페인 전용 `NAME_EN_EMPTY_MESSAGE`/`NAME_EN_FORMAT_MESSAGE`**(구현 결정 08-26: 한 폼에 이름·영문 코드 두 칸이 있어 `campaignMessage`의 "캠페인명…"은 어느 칸인지 가리키지 못함).
- 캠페인 미존재 `?id=` → 토스트 + 첫 캠페인 선택.
- 비용 금액은 0 이상 정수만(단가 검증 `parsePricingPatch` 규칙과 동일). 통화 바꿔도 금액 변환 안 함(도움말 한 줄).
- 달력 드래그 실패(네트워크) → 카드 원위치 + 토스트.
- 성과 스냅샷 없음 → "—", 합계 카드는 "게시 0건".
- 원고가 다른 캠페인에 이미 소속 → 고르기 모달에 나오지 않음(미소속만). DraftCard에서 바꾸면 그냥 이동(경고 없음 — 값은 하나).

## 8. 테스트

- 순수 함수: `campaignJudgment`(단계 승격·밀림·기간 밖·상태·통화별 합계·인플 목록 파생) · 이름/코드 제안 · 주 범위 계산(`weekRangeLabel` 연계).
- 스토어(실 DB, npm test 관례): 생성·목록 그룹·상세 조인(게시됨·성과 lateral)·추가 비용 upsert·핸들 변경 전파·클라 삭제 시 스냅샷·캠페인 삭제 시 원고 보존·`updateDraft` 새 필드 null=지움.
- 라우트 하네스 없음(리포 관례) → 라우트 검증은 스토어 테스트 + koo 화면 QA. (`scripts/smoke-*`는 외부 API 전용 — 캠페인엔 해당 없음.) `npm test` = `src/**/*.test.ts`, `--test-concurrency=1`, 실 DB.
- 화면 확인은 `build + start -p 3001 + 127.0.0.1`.

## 9. 범위 밖 (백로그)

게시물 자동 매칭 · 캠페인 복제 · 달력에서 새 원고 만들기 · 예산 상한/경고 · 캠페인 Slack 알림 · 클라이언트 보고 내보내기 · 원화 환산 참고치 · 지급 상태 · 섭외 파이프라인 · 커스텀 단계.

## 10. 결정 기록

| 결정 | 근거 |
|---|---|
| 원고가 단위, 인플은 파생 | koo 08-25. 명단 별도 저장안은 "원고 배정과 어긋나는 값"이 생겨 폐기 |
| 유형은 캠페인 속성(선택) | 유형별로 캠페인을 쪼개면 같은 주 같은 클라를 한눈에 못 봄 |
| 콘텐츠 비용 + 인플 추가 비용 두 자리 | A(콘텐츠 비용)가 압도적, 패키지/교통비는 추가 비용 항목으로 흡수 |
| 표 기본 + 달력 전환 | 리서치(8종 도구 전부 표 기본·예외 우선) + koo V2 선택. V1(둘 다 표시)은 중복·길어짐으로 기각 |
| 종료 캠페인 접힌 그룹 · 성과는 열 한 줄 | koo 브라우저 선택 08-25 |
| 캠페인 수동 상태 없음 | 기간에서 파생 — 라벨-값 일치 |
| 통화 합산 금지 | 리서치 [인용] Shopify Polaris 등 일관 |
