# 캠페인 작업(campaign_task) — 설계 스펙

작성: 2026-08-28 · 브랜치 `cb-koo/campaign-task`(origin/main 77eea95에서 분기) · 상태: 구현 완료(08-28, Task 1~18) — 최종 리뷰 반영 · koo QA·이관·머지 대기
선행 스펙: `docs/superpowers/specs/2026-08-25-campaign-management-design.md`(캠페인 관리 — 이 문서가 §0·§2·§3·§4를 대체한다. 캠페인 표 자체·기간·이름 규칙·달력 격자·섹션 경계는 그대로)
인계: `~/claude-outputs/20260827_campaign-task_인계.md` · 근거 분석: `~/claude-outputs/20260827_결제요청_분류패턴분석.md`
시안(로컬, 미커밋): `.superpowers/brainstorm/30057-1787841572/content/{task-table-v4,task-add-v3}.html`

## 0. 한 줄 정의

**캠페인 = 클라이언트 1 × 기간 1 동안 나가는 작업(campaign_task)의 묶음.** 작업 = 인플루언서 한 사람에게 맡긴 일 하나 — 투고 · 인용RT · RT · 방문협찬 네 유형. 원고는 작업에 *붙을 수도 있는 것*(투고·인용RT·방문협찬을 우리가 써서 전달할 때, 작업 1개에 원고 최대 1개). 인플 목록·단계·합계·캠페인 상태는 저장하지 않고 작업에서 계산한다. **작업 1행 = 정산 후보 1건**이 정산 페이지(payment-data)와의 계약이다.

## 1. 왜 바꾸나

- 슬랙 정산 채널 756건(06-12~08-27): **RT 54% · 인용RT 37% · 투고 5% · 기타 4%**. RT는 원고가 없어 "원고 = 캠페인 단위" 모델에서는 비용을 붙일 자리가 없었다.
- 요청 형식 720/756이 `@핸들 {RT|인용RT|투고} 1건 정산` — 건 단위가 이미 현행. 같은 날·같은 핸들 반복 149건 = 한 사람이 여러 게시물을 RT → (캠페인·핸들·유형) 중복은 정상.
- RT 참고자료 405건 중 350건 없음 → 리포스터 조회로 게시 근거가 생기면 지금보다 낫다.
- 프로덕션에 캠페인 소속 원고 1건 → 지금이 가장 싼 전환 시점.

## 2. 데이터 모델 (마이그레이션 038)

main 최신 037(클라이언트 월 예산, main 머지본) → **038**. (037 번호로 먼저 만들어 프로덕션에 적용했으나 main의 월 예산이 037을 쓰게 되어 038로 옮겼다 — 추가만 하는 파일이라 재적용해도 안전.) `scripts/apply-migrations.sh`가 전 파일을 재실행하므로 모든 문장은 멱등.

### 2-1. `campaign_task` (신설)

| 컬럼 | 타입 | 뜻 |
|---|---|---|
| `id` | uuid pk | |
| `campaign_id` | uuid not null → campaign, on delete cascade | **소속 = 비용을 지는 캠페인.** 대상 게시물이 어느 캠페인 것이든 무관 |
| `influencer_handle` | text null | 핸들 자연키(023 관례), 표기 보존·비교는 lower(). **null 허용** — 원고만 먼저 준비하고 나중에 배정 |
| `type` | text not null check in ('post','quoteRt','rt','visit') | = `influencerPricing.PriceType` 집합. 라벨은 `PRICE_TYPE_LABEL` 재사용(투고·인용RT·RT·방문협찬) |
| `draft_id` | uuid null → draft, on delete set null | 붙은 원고. **unique partial index (draft_id) where draft_id is not null** — 원고 1개는 작업 1개에만 |
| `target_task_id` | uuid null → campaign_task, on delete set null | RT/인용RT 대상이 우리 작업일 때. **캠페인 제한 없음.** check `target_task_id <> id`. 대상 작업 유형은 API가 post·quoteRt·visit(게시물이 생기는 유형)로 검증 — DB check로는 표현 불가 |
| `target_tweet_url` | text null | RT/인용RT 대상이 우리 작업 밖의 게시물일 때(클리닉 공식 계정·도구 이전 글). `parseTweetLink`로 정규화한 URL 저장 |
| `post_url` | text null | 인플이 올린 게시물(투고·인용RT·방문협찬의 게시 증거, RT는 보통 null) |
| `posted_at` | date null | **게시 확인일**(서울 DateOnly). 한 번 찍히면 자동으로 되돌리지 않음(정산 근거) |
| `posted_source` | text null check in ('auto','manual') | 확인 방식 — 리포스터 조회 / 사람 체크. 정산 검토자가 근거 종류를 안다 |
| `removed_at` | date null | **게시 내림일.** posted_at이 있을 때만 의미. 정산 조건이 아니라 **판단 참고 정보**(koo 08-27) |
| `removed_reason` | text not null default '' | 사유 한 줄 |
| `scheduled_on` | date null | 게시 예정일 — 밀림 판정 기준 |
| `visit_on` | date null | 방문일. **type='visit'만** 사용(API가 다른 유형에서 거절) |
| `cost` | jsonb null | `{amount: int ≥0, currency: 'KRW'|'JPY'}`. **type 없음** — 작업 유형이 대신. 검증은 `campaignCost.parseAmount/isCurrency` 재사용 |
| `note` | text not null default '' | |
| `created_by` | uuid → member, set null | |
| `created_at` / `updated_at` | timestamptz not null default now() | 트리거 없음 — 스토어가 `updated_at = now()` 수동 갱신 |

인덱스: `(campaign_id, created_at)`(표 기본 정렬 = 만든 순) · `(lower(influencer_handle))` · `(target_task_id)` · unique partial `(draft_id)`.

**허용되는 중복**: (campaign_id, influencer_handle, type)에 unique 없음 — 같은 인플이 하루에 여러 게시물을 RT하는 것이 실무(§1). 같은 대상에 같은 인플 작업 두 개도 막지 않고 UI에서 주황 표시만(§4-2).

### 2-2. `draft` 3컬럼 삭제 + 이관

`campaign_id · scheduled_on · cost`를 작업으로 옮기고 **삭제**한다(되돌림은 배포 전 백업).

**전환 순서(계획 단계에서 확정 — 테스트는 프로덕션 DB를 쓰므로 컬럼 삭제를 038에 넣으면 배포 전 main 코드가 즉시 500)**: ① **038 = 추가만**(`campaign_task` · `tracked_post.task_id`) — 옛 코드와 공존, 구현·테스트 중 적용. ② 이관은 SQL 파일이 아니라 스토어 함수 `cutoverDraftsToTasks(sql)`(재실행 안전, 테스트로 검증) + `scripts/cutover-campaign-task.ts` — 새 코드 배포 **직전**에 실행. ③ 새 코드 배포. ④ **039 = 3컬럼 drop** — 배포 후 적용. 새 코드는 `draft.campaign_id`를 읽지 않으므로 ③과 ④ 사이에 컬럼이 남아 있어도 무해.

```sql
insert into campaign_task (campaign_id, influencer_handle, type, draft_id, scheduled_on, cost, created_by, created_at)
select d.campaign_id, d.influencer_handle,
       coalesce(d.cost->>'type', 'post'),            -- 비용 유형이 곧 작업 유형. 없으면 투고
       d.id, d.scheduled_on,
       case when d.cost is null then null
            else jsonb_build_object('amount', d.cost->'amount', 'currency', d.cost->'currency') end,
       d.created_by, d.created_at
from draft d where d.campaign_id is not null
  and not exists (select 1 from campaign_task t where t.draft_id = d.id);   -- 재실행 안전
```
프로덕션 대상 1건(마인드스킨 9월 1주 · quoteRt ₩30,000 · delivered). 이어서 `tracked_post.draft_id`가 그 원고를 가리키면 `tracked_post.task_id`로 옮기고(§2-4) 작업 `posted_at = (tp.posted_at at time zone 'Asia/Seoul')::date`(timestamptz → 서울 날짜), `posted_source='manual'`, `post_url`을 채운다. 마지막에 `alter table draft drop column if exists campaign_id, drop column if exists scheduled_on, drop column if exists cost`. (033이 재실행 때 3컬럼을 다시 만들고 039가 끝에서 지우므로 전체 재실행도 안전. 프로덕션 확인 08-28: 캠페인 1 · 소속 원고 1(@minchannell quoteRt ₩30,000 delivered 9/9) · 연결된 tracked_post 0 · `campaign_influencer_cost` 1행(@aik_ooooo, extra_costs 비어 있음 → 인플 목록에 "배정 작업 없음"으로 남음).)

### 2-3. 그대로 두는 것

`campaign_influencer_cost.extra_costs / note` — 작업이 아닌 비용(교통비 등)·인플 한 줄 메모. 핸들 변경 전파(`influencerStore.renameInfluencer`, 호출자 트랜잭션 안): 기존 `draft` → `campaign_influencer_cost` 병합 규칙에 **`update campaign_task set influencer_handle = 새 where lower(influencer_handle) = lower(옛)`를 같은 트랜잭션에 추가**한다(작업은 unique 제약이 없어 병합 불필요).

`target_tweet_url` 저장 형식: 입력 URL을 `parseTweetLink`로 ID를 뽑아 검증하고 `tweetPermalink(handle|null, id)`로 **정규화한 permalink를 저장**(같은 트윗을 x.com/twitter.com 두 표기로 적어도 §3-2 묶음이 한 번에 잡히게). 조회 시 ID는 다시 `parseTweetLink`.

### 2-4. `tracked_post.task_id` 추가

게시물 연결이 원고가 아니라 **작업**에 걸린다: `alter table tracked_post add column if not exists task_id uuid references campaign_task(id) on delete set null` + 인덱스. 기존 `draft_id`는 **남긴다**(트래킹·성과 화면이 원고 기준으로도 읽음 — 038에서 건드리지 않음). 이관: `update tracked_post tp set task_id = t.id from campaign_task t where t.draft_id = tp.draft_id and tp.task_id is null`.

**양방향 연결 규칙(리뷰 반영)** — 게시물 1건은 작업·원고 어느 쪽으로 연결하든 두 칸이 함께 맞춰진다. 스토어 함수 하나 `linkTrackedPost(tx, trackedPostId, { taskId } | { draftId })`가 담당하고 기존 `setDraftLink`는 이 함수로 대체:
- 작업으로 연결(캠페인 단계 셀·`LinkPostModal`): `task_id = 작업`, `draft_id = 작업.draft_id`(있으면). 그 작업의 `post_url`을 게시물 permalink로, `posted_at`이 비어 있으면 `(tp.posted_at at time zone 'Asia/Seoul')::date`(없으면 오늘)로, `posted_source='manual'`.
- 원고로 연결(트래킹 페이지 기존 `PATCH /api/tracking/[id] {draftId}`): `draft_id = 원고`, 그 원고가 붙은 작업이 있으면 `task_id`도 채우고 위와 같이 작업 `post_url/posted_at` 보충.
- 연결 해제(null)는 두 칸 모두 null. 작업의 `posted_at`은 되돌리지 않는다(§3-4).
- 라우트: `POST /api/tracking {url, taskId?}`(등록 + 연결) · `PATCH /api/tracking/[id] {taskId | draftId | role}`. 트래킹·성과 페이지(`src/app/tracking`, `src/app/performance`, `influencers/Timeline.tsx`)는 `draft_id`만 읽으므로 무변경.

### 2-5. 파생값 (저장하지 않는다) — `src/lib/campaignJudgment.ts`

| 값 | 정의 |
|---|---|
| **단계** `TaskStage` | 우선순위: `removed_at` → **내려짐** · `posted_at` → **게시됨** · 원고 있음 → 원고 status(초안·검수 대기·사용 확정·전달됨·미사용) · type=visit & `visit_on < 오늘` → **방문 완료** · type=visit → **방문 전** · 그 외 → **예정** |
| 밀림 | `scheduled_on < 오늘` and `posted_at is null` and 원고 status ≠ unused. **방문일은 밀림 판정에 쓰지 않는다**(방문→게시 사이 기간이 긴 것이 정상) |
| 대상 확정 | `target_task.post_url`이 있거나 `target_tweet_url`이 있음. 대상 트윗 ID = 그 URL의 `parseTweetLink` |
| 대상 상태 | 둘 다 null → **대상 미정** · target_task는 있는데 post_url 없음 → **대상 게시 대기** · 확정 |
| 준비 중 | 원고 있는 작업 중 status ∈ {draft, review, approved} + 원고 없는 작업의 예정·방문 전·방문 완료 (필터 칩 "준비 중"의 모집단) |
| 게시됨 n / N | N = 작업 수 − 미사용 원고 작업. n = posted_at 있음(내려짐 포함 — 게시는 했음) |
| 캠페인 상태 | 기간 파생(변경 없음) |
| 인플 목록 | 작업의 influencer_handle 집합(lower 중복 제거) ∪ `campaign_influencer_cost` 행 핸들 |
| 인플 소계 | 작업 비용 합(통화별) + 추가 비용 합(통화별). **유형별 건수**(`투고 1 · RT 3`)도 같이 |
| 캠페인 합계 | 통화별, 합산 금지. **내려짐 작업도 포함**(제외는 정산 판단 — 빼면 "정산했는데 합계엔 없는" 불일치) |
| 유형별 소계(표 하단 한 줄) | 유형별 건수 · 통화별 비용 · 게시됨 n/N · 밀림 · 내려짐 |
| **정산 후보** | `posted_at` 있음 + `cost` 있음 + `influencer_handle` 있음. 활성 payment_request 없음은 payment-data가 판단. `removed_at`은 조건이 아님 |
| 성과 | 작업의 `tracked_post`(task_id) 최신 스냅샷 합 + 원고 트래킹 링크 클릭 합 |

## 3. 게시 확인 — 리포스터 조회

### 3-1. 원리
RT 요청은 항상 "대상 게시글 링크"를 인플에게 준다 → 그 트윗의 리포스터 목록(`getxapi.getTweetRetweeters`, 기존 구현 `src/lib/getxapi.ts:129`, 1회 $0.001, 덱 "리포스터" 확장 탐색과 같은 엔드포인트)에 작업 인플의 `userName`이 있으면 게시 확인. 인용RT는 별개 게시물이라 리포스터 목록에 안 잡힌다 → 인용RT·투고·방문협찬은 `post_url`/게시물 연결이 근거.

### 3-2. `POST /api/campaigns/[id]/check-posted`
1. 대상: 이 캠페인의 `type='rt'` 작업 중 `posted_at is null` and 대상 확정 + **이미 확인된 RT 작업**(사라짐 감지용). 인플 없는 작업 제외.
2. 대상 트윗 ID별로 묶어 **트윗당 1회 호출**, `has_more`면 최대 5쪽까지(그 이상 "목록이 길어 일부만 확인"). 다른 캠페인의 같은 트윗은 이 API 범위 밖(캠페인 단위 버튼).
3. 판정: 리포스터 raw user를 `mapRawUser`로 정규화한 뒤 `lower(user.handle) === lower(influencer_handle)`(`mappers.ts`가 `userName ?? screen_name`을 `handle`로 노출) → `posted_at = kstToday()`, `posted_source = 'auto'`. 일치 안 하면 변경 없음.
4. 이미 확인된 작업의 인플이 목록에 없으면 **변경하지 않고** 결과에 `missing`으로 보고.
5. 응답: `{ confirmed: [{taskId, handle}], pending: [...], skipped: [{taskId, handle, reason: 'no_target'|'target_not_posted'|'no_handle'}], missing: [...], unreadable: [{tweetId, reason}], partial: [tweetId] }`.
6. 오류: `GetxapiAuthError` → 401 기존 문구. 트윗 삭제/비공개 → 그 트윗은 `unreadable`, 나머지 계속. 사용량은 기존 `getxapi.retweeters` 기능명으로 기록(비용 대시보드 그대로).

### 3-3. 화면 — 툴바 `[게시 확인하기]`
버튼 옆 도움말 한 줄: "RT 대상 게시글의 리포스트 계정을 찾아 게시 확인을 채워요 · 게시글 1개당 $0.001". 결과 모달(판단까지 서술):
- "확인됨 3건 — @a @b @c → 게시 확인을 채웠어요"
- "아직 2건 — @d @e (목록에 없음 · 비공개 계정이거나 아직 안 했을 수 있어요)"
- "건너뜀 — @f: 대상 미정 / @g: 대상 게시글(@mika_skin 투고)이 아직 게시 전"
- "@h의 RT가 목록에 없어요 — 내려졌을 수 있어요 [게시 내림으로 표시]"
- 확인할 RT 작업이 0건이면 버튼 비활성 + "확인할 RT 작업이 없어요".

### 3-4. 수동 경로 (모든 유형)
단계 셀 클릭 → 게시 전: "오늘 게시됨으로 표시" / 날짜 지정 / 게시물 링크 입력(입력 시 트래킹 등록 + task_id 연결, §2-4). 게시 후: "게시 내려짐으로 표시"(날짜 + 사유). 내림 후: "내림 취소"(removed_at·reason 지움). `posted_at` 자체를 지우는 UI는 없다(잘못 찍었으면 삭제 후 다시 만들기 — 정산 근거 보호).

## 4. 화면 — 캠페인 상세

레이아웃(목록 280px + 상세, 흰 패널 섹션, 요약 카드 4, 표↔주간 달력 전환, 하단 인플별 비용 표)은 캠페인 스펙 §3 그대로. 바뀌는 것만 적는다.

### 4-1. 작업 표 (시안 `task-table-v4.html`, koo 확정 08-28)

섹션 제목 "작업 진행 현황 · N건". 툴바: `[+ 작업 추가]` `[게시 확인하기]` │ 필터 칩(전체 · 준비 중 · 전달됨 · 게시됨 — 4개, 기존 화면 계승) │ 정렬(기본 **만든 순**, 예정일·단계·인플).

**표 하나, 열 7개 고정**(유형별로 2개는 항상 "—"라 실제 정보 5~6개):

(구현 결정 08-28: 예정일 열은 방문협찬의 `방문 [날짜] · 게시 [날짜]` 두 입력을 한 줄에 담기 위해 170→230px, 표 최소 폭 1260px.)

| 열 | 폭 | 내용 |
|---|---|---|
| 유형 | 110 | 칩(투고·인용RT·RT·방문협찬, 유형별 색) — **1열** |
| 인플루언서 | 180 | 아바타 이니셜 + @핸들. 없으면 "미배정"(연하게). 클릭 → 명부 자동완성 변경 |
| 원고 | 나머지 | 제목 한 줄(title → koTitle → 첫 줄, 말줄임). RT는 "—". 원고 없는 투고·인용RT·방문협찬은 "붙이기" 링크 |
| RT/인용RT 대상 | 250 | `@핸들 유형`(다른 캠페인이면 회색 `· 캠페인명`) / 링크면 `x.com/… ` 축약 / "대상 미정" / "대상 게시 대기"(연하게). 투고·방문협찬은 "—" |
| 예정일 | 230 | `9/3 수`. 밀림은 같은 줄 빨간 글씨 `8/26 수 · 1일 지남`. 방문협찬은 `방문 9/10 · 게시 미정` 한 줄. 미정은 연하게 |
| 단계 | 170 | 칩: 예정·방문 전·방문 완료·초안·검수 대기·사용 확정·전달됨·**게시됨 9/3**·**내려짐 9/5**. 부가 정보는 회색 작은 태그(`자동`, 내림 사유) |
| 비용 | 180, 우측 정렬 | `¥3,000` tabular. 옆 배지 자리 = **정산 상태**(payment-data가 `payment_request` 상태를 채움 — 이번 릴리스는 빈 자리) |

- 행 순서 **만든 순**(오래된 것 위). 밀린 행은 자리를 바꾸지 않고 **연한 빨강 배경 + 왼쪽 3px 빨간 막대**.
- **연한 글씨 규칙**(koo 08-28): 흐린 행 = **미사용 원고 작업만**(합계·게시 n/N에서 빠지는 것). 내려짐 행은 일반 진하기(합계에 들어가므로). 값 없는 칸("—"·미정·미배정)만 연하게.
- 표 하단 한 줄: `투고 1 · 인용RT 3 · RT 3 · 방문협찬 1` │ `비용 ¥53,000 · ₩300,000` │ `게시됨 2 / 8 · 밀림 1 · 내려짐 1`.
- 행 메뉴(···): 작업 삭제(확인: "원고는 남고 작업만 사라져요") · 원고 열기(있을 때).
- 규격: 행 ≥ 52px, 본문 15px, 보조 13px, 12px는 태그만.

### 4-2. `[+ 작업 추가]` 모달 (시안 `task-add-v3.html`, koo 확정 08-28)

한 창에서 **유형 세그먼트를 바꾸면 칸이 바뀐다**(입력한 인플·예정일은 유지). 유형별 칸 순서:

| 유형 | 순서 |
|---|---|
| RT | 유형 → **RT 대상** → 인플루언서(여러 명) → 비용(사람별) → 게시 예정일 · 메모 |
| 인용RT | 유형 → **인용RT 대상** → 인플루언서 → 원고 → 비용 → 게시 예정일 · 메모 |
| 투고 | 유형 → 인플루언서 → 원고 → 비용 → 게시 예정일 · 메모 |
| 방문협찬 | 유형 → 인플루언서 → 원고 → 비용 → **방문일** · 게시 예정일 → 메모 |

- **대상 칸(RT·인용RT)** — 입력 한 칸: @핸들/원고 제목을 치면 아래로 작업 목록(post·quoteRt·visit 유형, 기본 **같은 클라이언트**·최근 만든 순, "전체 클라이언트 보기"), **X 링크를 붙이면 자동 인식**해 `target_tweet_url`. 칸 아래 **빠른 선택 칩** = 이 캠페인의 게시된/예정 대상 작업 최근 3~5개 + "다른 게시물 찾기 / 링크 붙이기…". 게시 전 작업도 고를 수 있고 "게시 전" 표시. 선택되면 회색 카드로 접히고 "바꾸기". 비워둘 수 있음("나중에 정해도 돼요").
- 대상이 정해지면 그 아래 한 줄: "이 게시물을 이미 RT하기로 한 사람: @kei_st · @hana_bt". 인플 칸에서 그 사람을 고르면 칩이 **주황 "이미 있음"** — 막지 않는다(같은 게시물 재요청이 실제 있음).
- **인플루언서 칸** — RT·인용RT·투고·방문협찬 모두 **여러 명 허용**(칩). 여러 명이면 "사람 수만큼 작업이 생겨요" 도움말, 버튼 라벨 `작업 N개 만들기`. **0명도 허용** — 미배정 작업 1개가 생긴다(원고만 먼저 준비하는 경우, 표에 "미배정"). 원고 붙이기는 **인플 0~1명일 때만** 활성(원고 1개 = 작업 1개) — 2명 이상 + 원고 선택 시 "원고는 한 사람에게만 붙일 수 있어요".
- **비용 칸 — 사람별 금액 줄**: 인플을 고르는 순간 `influencer.pricing[type]`로 채운 금액 칸이 사람마다 한 줄, 옆에 근거 "단가 RT ¥3,000". 단가 없으면 빈 칸(점선) + 주황 "명부에 RT 단가 없음 — 비워두면 비용 없이 만들어요". 하단 "모두 같은 금액으로" · "통화 바꾸기(¥)". 사람이 적은 값은 덮지 않는다.
- **원고 칸**(투고·인용RT·방문협찬): 라디오 없음(인플이 직접 씀) / 있는 원고 고르기(그 클라이언트의 **작업에 안 붙은** 원고 검색 모달, 형제 시안 A/B/C 표시, 하나만) / 새로 만들기(`/generate?task={id}` — 작업을 먼저 만들고 이동).
- 만들기 → `POST /api/campaigns/[id]/tasks` 한 번(배열) → 표에 즉시 반영, 토스트 "작업 3개를 만들었어요".

### 4-3. 표 셀 편집
- 인플: 변경 시 붙은 원고의 `influencer_handle`도 같은 트랜잭션에서 갱신(값은 하나). 원고에 인플이 있고 작업이 비어 있으면 붙일 때 작업 쪽으로 채움.
- 대상: 4-2와 같은 입력 한 칸(인라인 팝오버).
- 원고: 제목 클릭 → DraftCard 모달. "—" 클릭 → 붙이기(고르기/새로 만들기). 떼기는 DraftCard의 작업 칸에서.
- 예정일·방문일: 날짜 입력 + 지우기. 방문일 셀은 visit만.
- 단계: §3-4.
- 비용: 금액·통화 팝오버(유형 없음).

### 4-4. 나머지 섹션
- **요약 카드 4개**: 정의만 원고→작업(§2-5). 밀림 N · 게시됨 n/N · 비용 · 조회.
- **주간 달력**: 카드 = 작업(유형 칩 + @핸들 + 원고 제목 있으면). 게시 예정일에 놓이고, **방문협찬은 방문일에도 카드**(아이콘 "방문", 드래그 시 visit_on 변경). 예정일 미정 섹션 그대로. 드래그 → `PATCH scheduled_on`.
- **인플루언서별 비용 표**: 인플 · 작업 n(`투고 1 · RT 3`) · 작업 비용 · 추가 비용(항목 + [+ 추가]) · 소계. 도움말 "작업 비용 + 추가 비용을 사람별로 모았어요. 통화가 다르면 따로 보여요."
- **캠페인 삭제 확인 문구**: "작업 N개가 함께 지워져요. 원고 M개는 남아요." + 다른 캠페인 작업이 이 캠페인 게시물을 대상으로 참조 중이면 "다른 캠페인 작업 k건의 대상이 '대상 미정'으로 바뀌어요".

## 5. 캠페인 밖 — 원고 쪽 변화

**DraftRow**: `campaignId · campaignName · campaignCode · scheduledOn · cost` 유지(이름 그대로, 값은 `left join campaign_task t on t.draft_id = d.id left join campaign c on c.id = t.campaign_id`) + **`taskId · taskType`** 추가. `draftStore.SELECT()` 한 곳.

- **DraftCard 작업 칸**(기존 "캠페인: 없음 ▾" 자리): 붙어 있으면 `작업: 마인드스킨 9월 1주 · 투고 @mika_skin`(클릭 → `/campaigns?id=`) + "떼기". 안 붙어 있으면 **[작업에 붙이기]** → 캠페인 선택(그 원고 클라이언트의 진행 중·예정, 종료 펼침) → 그 캠페인의 **원고 없는 post·quoteRt·visit 작업** 목록 / "새 작업 만들기"(유형·인플만 물음, 원고 자동 붙음). 예정일·비용은 **읽기만** + "작업에서 고치기" 링크(koo 결정 08-28: 고치는 자리는 캠페인 화면 하나).
- **`/generate?task={id}&campaign={campaignId}`**(기존 `?campaign=` 대체 — 계획 단계 결정: 작업 단건 조회 라우트를 만들지 않고 캠페인 상세 응답에서 작업을 찾기 위해 캠페인 id를 함께 싣는다): 배너 "마인드스킨 9월 1주 · 투고 @mika_skin 작업에 붙이는 원고를 만들고 있어요 [해제]". 생성·직접 쓰기(`/api/drafts`, `/api/drafts/manual`)에 `taskId` → 트랜잭션으로 원고 insert + `campaign_task.draft_id` set(이미 원고가 붙어 있으면 409 "이 작업엔 이미 원고가 있어요"). 클라이언트 자동 선택은 작업의 캠페인에서.
- **/generate 표 보기 캠페인 열·필터 칩**: 값 출처만 바뀜, 화면 동일.
- **기존 "원고를 캠페인에 넣는" 경로 전부 제거**(리뷰 반영 — 남기면 컬럼 삭제로 500): `GET /api/campaigns/[id]/drafts`(`listUnassignedDrafts`) · `campaignApi.fetchCandidateDrafts/bulkCampaignApi` · `AddDraftsModal.tsx` · `useCampaignDraftActions`의 `patchDraft {campaignId}` 빼기/옮기기 · `updateDraftsBulk.campaignId`(bulk 라우트 400 가드는 `status·influencerHandle` 2필드로) · `draftFieldPatch`의 campaign 필드. 대체: 원고 고르기는 `GET /api/drafts?clientId=&unattached=1`(§6), 붙이기/떼기는 `PATCH /api/drafts/[id] {taskId}`, 캠페인에서 빼기는 작업 삭제 또는 원고 떼기. `DraftFilterBar`는 캠페인 **필터 select**만 있으므로 값 출처만 바뀜.
- **`DraftRow.cost` 형 변경** `{type,amount,currency}` → `{amount,currency}`(type은 `taskType`): 소비자 `CostPopover`(defaultType 제거) · `campaignTableView.contentTypeLabel` · `campaignJudgment.defaultCostType`(삭제 — 단가 제안은 `taskType`으로) · `DraftCard` 비용 표시 · `parseDraftCost` → `parseTaskCost`(type 없음).
- **인플루언서 프로필 "참여 캠페인"**: 캠페인명 · 기간 · **작업 n(투고 1 · RT 3)** · 비용 소계(통화별). `listInfluencerCampaigns`가 작업 기준.
- **트래킹 링크**: `campaignCode` prefill 출처만 바뀜.
- **`syncInfluencerOnDraftUpdate`**(원고 인플 변경 → 프로필 로그): 작업에서 인플을 바꿔 원고가 따라 바뀔 때도 같은 함수가 돈다(기존 `PATCH /api/drafts/[id]` 경로를 서버 내부에서 호출하지 않고 스토어 함수 공유).

## 6. API

| 메서드·경로 | 역할 |
|---|---|
| `GET /api/campaigns` | 목록 + 상태·**작업 수**·통화별 합계 |
| `GET /api/campaigns/[id]` | 상세 = 캠페인 + **작업 목록**(TaskRow + 원고 요약 + 대상 요약 + 게시물·성과) + 인플 파생 + 추가 비용 행 + 요약 + 유형별 소계 |
| `POST /api/campaigns/[id]/tasks` | 생성. body `{ type, targetTaskId?, targetTweetUrl?, influencers: [{handle, cost?}], draftId?, scheduledOn?, visitOn?, note? }` → 한 트랜잭션에 `max(1, influencers.length)`행(`[]`이면 미배정 1행, cost는 body 최상위 `cost?`). 검증: type · 대상 작업 존재·유형(post/quoteRt/visit) · 링크 `parseTweetLink` → permalink 정규화 · draftId는 `influencers.length ≤ 1`일 때만·미부착 원고만 · visitOn은 visit만 · 금액 규칙. 응답 `{ tasks: TaskRow[] }` |
| `PATCH /api/campaigns/[id]/tasks/[taskId]` | `influencerHandle · targetTaskId · targetTweetUrl · postUrl · postedAt(+source) · removedAt · removedReason · scheduledOn · visitOn · cost · note`. `undefined`=유지 · `null`=지움 · 값=설정(case when 패턴). `postedAt: null`은 거절(§3-4). 원고 붙이기/떼기는 `PATCH /api/drafts/[id] {taskId}` 하나로(구현 결정) — 이 라우트는 `draftId`를 받지 않는다 |
| `DELETE /api/campaigns/[id]/tasks/[taskId]` | 삭제(원고 set null, 참조 작업 target set null, tracked_post.task_id set null) |
| `POST /api/campaigns/[id]/check-posted` | §3-2 |
| `GET /api/campaigns/tasks/targets?clientId=&q=&all=1` | 대상 고르기 목록(post·quoteRt·visit 작업, 캠페인명·게시 여부 포함, 최근 순, 50건) |
| `GET /api/drafts?clientId=&unattached=1` (기존 라우트에 필터 추가) | 원고 고르기 — 작업에 안 붙은 원고만. 새 라우트를 만들지 않는다 |
| `DELETE /api/campaigns/[id]` | `deleteCampaign` 반환형을 `{ ok, deleted, taskCount, detachedTargets }`로 확장(삭제 전 count) — 확인 다이얼로그 문구(§4-4)는 `GET 상세`의 요약값으로 미리 표시 |
| `GET /api/campaigns/[id]/drafts` | **삭제**(§5) |
| `PUT /api/campaigns/[id]/influencers/[handle]` | 변경 없음 |
| `PATCH /api/drafts/[id]` | `campaignId · scheduledOn · cost` **제거**. `taskId`(붙이기/떼기: 값=붙임(미부착 검증), null=떼기) 추가 |
| `PATCH /api/drafts` bulk | `campaignId` 제거 |
| `POST /api/drafts`, `/api/drafts/manual` | `taskId?` 추가 |
| `POST /api/tracking {url, taskId?}` · `PATCH /api/tracking/[id] {taskId \| draftId \| role}` | 기존 트래킹 등록·연결 라우트에 `taskId` 추가. 연결은 `linkTrackedPost` 한 함수(§2-4 양방향 규칙) |

인증·멤버 해석 `requireMember` 관례. 워크스페이스 FK 없음(전 워크스페이스 공유).

## 7. 정산(payment-data)과의 데이터 계약

정산 후보 = `campaign_task` 중 **`posted_at` 있음 + `cost` 있음 + `influencer_handle` 있음** (+ 활성 `payment_request` 없음은 정산 측 판단).

| task 필드 | 정산에서 쓰는 곳 |
|---|---|
| `type` | 분류 기본값(RT→프로모션 RT·인용RT 확정 / 투고→visit 캠페인이면 원고료·아니면 정보성 / 인용RT→정산 쪽 결정 대기), 항목 문구 `@핸들 {유형} 1건 정산` |
| `influencer_handle` | 항목 문구 · `influencer.payment_methods` 기본 수단 조회 |
| `cost.amount/currency` | 금액(환산·수수료는 정산 측) |
| `post_url` / `target_tweet_url`·`target_task.post_url` | 참고자료(인용RT·투고·방문협찬은 post_url, RT는 대상 URL) |
| `posted_at` / `posted_source` | 게시 근거(자동/수동) |
| `removed_at` / `removed_reason` | **판단 참고 정보** — 후보 행에 "⚠ 게시 내려짐(9/5) · 사유" 배지. 조건으로 쓰지 않는다. 이미 보낸 건도 배지만 |
| `campaign → client_id/client_name` | 클리닉(ID+이름) |
| `draft_id` | 있으면 원고 제목 표시용 |

캠페인 표의 비용 옆 배지 자리는 `payment_request(task_id, status)`를 정산 측이 만들면 그 상태 문구를 그대로 표시. 이번 릴리스는 빈 자리.

## 8. 오류·경계

- 대상 작업 유형이 rt → 400 "RT 작업은 대상이 될 수 없어요". 자기 자신 → 400. 캠페인 삭제된 대상 → FK set null → "대상 미정".
- draftId가 이미 다른 작업에 붙음 → 409 "이 원고는 이미 다른 작업에 붙어 있어요(캠페인명)". 여러 인플 + draftId → 400.
- visitOn을 visit 아닌 유형에 → 400. removedAt을 posted_at 없는 작업에 → 400 "게시 확인이 없는 작업이에요".
- 리포스터 조회 실패(인증·잔액) → 401 기존 문구, 부분 실패는 `unreadable`로 계속.
- 인플 없는 작업은 게시 확인 대상 아님(`skipped: no_handle`), 정산 후보 아님, 인플별 비용 표에 "미배정" 행으로 합산.
- 기간 밖 예정일·방문일 → 경고 표시만(기존 규칙).
- 통화 바꿔도 금액 변환 안 함(기존).

## 9. 테스트

- **순수 함수** `campaignJudgment`: taskStage 우선순위(내려짐>게시됨>원고 status>방문>예정) · 밀림(방문일 무시·unused 제외) · 대상 상태 3종 · 준비 중 모집단 · 게시 n/N(내려짐 포함) · 정산 후보 · 유형별 소계 · 인플 목록 파생. `campaignCost`: cost `{amount,currency}` 파서(type 없음).
- **리포스터 판정**(`checkPosted` 순수 부분): 가짜 페이지로 confirmed/pending/skipped/missing/partial 분기, lower 비교, 트윗별 묶음(같은 트윗 두 작업 = 호출 1회).
- **스토어(실 DB, `npm test` 4분 / 단일 `node --import tsx --test <file>`)**: 작업 N개 트랜잭션 생성 · draft unique partial · 대상 참조(캠페인 밖) · 삭제 시 set null 3종 · 핸들 변경 전파(campaign_task 포함) · 인플 변경 시 원고 동기화 · posted/removed 규칙 · **이관 SQL**(원고 1건 → 작업 1건 + tracked_post 이전, 재실행 안전) · `listInfluencerCampaigns` 작업 기준 · drafts `taskId` 붙이기/떼기 · `/generate?task=` 생성 시 부착.
- **스모크**: `scripts/smoke-expansion.ts <tweetId>`로 리포스터 응답 형태 재확인(비용 $0.001).
- **화면 QA(koo, build + start -p 3001 + 127.0.0.1)**: 작업 표 · 작업 추가(RT 3명·투고+원고·방문협찬) · 셀 편집 · 게시 확인 모달 · 게시 내림 · DraftCard 작업 칸 · `/generate?task=` 배너 · 달력 방문일 카드 · 인플 프로필 참여 캠페인.

## 10. 범위 밖 (백로그)

게시물 중심 트리 보기(브레인스토밍 E안) · 투고/인용RT 게시물 삭제 자동 감지(트래킹 수집기 `unavailable_at` 연결 후보) · RT 자동 확인의 주기 실행(트래킹 자동화 때) · 인용RT 정산 분류 규칙(정산 측 결정) · 정산 배지 실제 표시(payment-data) · 작업 복제 · 캠페인 간 작업 이동 · `draft.kind`·`campaign.kind` 정리 마이그레이션 · 피드 모니터링과 `post_url` 자동 채움.

## 11. 결정 기록

| 결정 | 근거 |
|---|---|
| 작업이 단위, 원고는 붙는 것(통합안) | koo 08-27. 절충안(원고 있는 것만 draft)은 인용RT가 두 곳에 갈림 |
| 작업 1개 = 원고 최대 1개 | koo 08-27 "거의 대부분". 예외는 작업 하나 더 |
| 방문협찬도 게시물이 결과 — 후속 투고 별개 작업 안 함 | koo 08-27: 방문일 협의→시술→업로드가 한 작업. 인계 문서의 "visit+post 별개" **폐기** |
| 방문일 별도 칸, 밀림엔 안 씀 | koo 08-27 A안. 칸 하나에 두 뜻은 라벨-값 불일치 |
| 게시 확인 = `posted_at` 저장(자동/수동), 되돌리지 않음 | RT 취소 시 파생이면 되돌아감 → 정산 근거 불안정 |
| RT 게시 확인은 리포스터 조회로, 버튼 opt-in | koo 아이디어 08-27. 엔드포인트 기존·$0.001·트윗당 1회. UX 원칙 6 |
| 대상 = 작업 참조 또는 URL, 캠페인 경계 없음 | koo 08-27: 한 게시물은 한 캠페인에 속하지 않음, 인용RT의 인용RT 있음 |
| 게시 내림은 저장하되 정산 조건 아님 | koo 08-27: 내림≠정산 취소, 사람이 판단 |
| 표: 유형 1열·만든 순·표 하나·요약 타일 없음·정산은 배지 | koo 08-28 (A→B→D 순으로 시안 비교 후 D 수정) |
| 흐린 행 = 미사용 원고 작업만 | koo 08-28 질문 → 합계 제외 여부와 일치시킴 |
| 작업 추가: RT는 대상 먼저, 비용은 사람별 줄, 대상 칸은 입력 하나+칩 | koo 08-28 "사용자 입장에서 대상 먼저" |
| 예정일·비용 고치는 자리는 캠페인 화면만 | koo 08-28. 원고 카드는 읽기 + 링크 |
| `tracked_post.task_id` 추가, `draft_id` 유지 | 트래킹 화면 무변경으로 범위 억제 |
| `draft` 3컬럼 038에서 삭제 | 프로덕션 1건, 남기면 두 소스 |
