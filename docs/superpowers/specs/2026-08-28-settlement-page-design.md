# 정산 페이지(payment_request) — 설계 스펙

작성: 2026-08-28 · 브랜치 `cb-koo/payment-data` · 상태: 설계 확정, 구현 전
선행 스펙: `docs/superpowers/specs/2026-08-28-campaign-task-design.md` §7(정산 데이터 계약), `docs/superpowers/specs/2026-08-27-influencer-payment-method-design.md` §5(payment-data로 넘기는 계약)
근거 분석: `~/claude-outputs/20260827_결제요청_분류패턴분석.md`(슬랙 3채널 756건), `~/claude-outputs/20260827_결제요청_데이터리스트.md`
시안(로컬, 미커밋): `.superpowers/brainstorm/58705-1787881570/content/row-layout.html` — B안(두 줄 행) 채택

## 0. 한 줄 정의

**게시 확인된 캠페인 작업 1건 = 정산 후보 1건.** 담당자가 한 화면에서 후보를 훑어 금액·결제 수단·분류를 확인하고, 여러 건을 골라 한 번에 **결제 요청(`payment_request`)**으로 저장한다. 요청은 만든 시점의 값을 스냅샷으로 품고, 취소는 삭제가 아니라 사유가 남는 상태 전환이다. **이번 범위는 저장과 화면 확인까지** — 정산 프로덕트로의 송신은 다음 작업이며, 이 스펙은 그 자리(`sent_at`·`external_id`)만 비워 둔다.

## 1. 왜 만드나

- 지금은 슬랙 3채널(PayPal·PayPay·계좌이체)에 사람이 `@핸들 {RT|인용RT|투고} 1건 정산` 메시지를 손으로 올린다(주 30~116건, 평균 69건). 금액·통화 오입력(`¥20,000 (20만원)`), 스레드 정정("금액: 15만원"), 분류를 사람마다 다르게 고르는 문제가 실데이터에 있다.
- 캠페인 작업(`campaign_task`)과 인플루언서 결제 수단(`influencer.payment_methods`)이 갖춰져 양식 11항목의 출처가 전부 우리 데이터에 있다.
- 정산 데이터는 오차가 없어야 한다 → **계산은 서버의 순수 함수 한 곳**, 저장은 스냅샷, 중복은 DB 제약으로 막는다. 설명 문장이 아니라 구조로.

## 2. 데이터 모델 (마이그레이션 040)

main 최신 039 → **040**. `scripts/apply-migrations.sh`가 전 파일을 재실행하므로 모든 문장은 멱등(`if not exists`, `drop constraint if exists` + `add`).

### 2-1. `payment_request` (신설) — 요청 1건 = 행 1개, 만든 시점 스냅샷

| 컬럼 | 타입 | 뜻 |
|---|---|---|
| `id` | uuid pk | 재전송 멱등 키로도 쓴다(송신 작업) |
| `task_id` | uuid null → campaign_task, on delete **set null** | 어느 작업인지. 작업이 지워져도 요청 기록은 남는다 |
| `campaign_id` | uuid null → campaign, set null | |
| `campaign_name` | text not null | 스냅샷 |
| `client_id` | uuid null → client, set null | 정산 쪽에 ID+이름 동봉 |
| `client_name` | text not null | 스냅샷 |
| `influencer_handle` | text not null | 표기 보존 |
| `task_type` | text not null check in ('post','quoteRt','rt','visit') | = `TaskType` |
| `category` | text not null | 양식 '분류' — 옵션의 **정산 쪽 이름(sendAs)** 스냅샷 |
| `category_default` | text null | 화면이 미리 채웠던 값(없었으면 null). 사람이 바꿨는지 추적 — 인용RT 규칙 정할 근거 |
| `item_text` | text not null | 양식 '항목' |
| `purpose_text` | text not null | 양식 '목적' |
| `amount_krw` | int not null | 원화 기준 금액(§3-1) |
| `cost_currency` | text not null check in ('KRW','JPY') | 작업 비용에 적힌 통화 |
| `payout_currency` | text not null check in ('KRW','JPY') | 인플이 받는 통화(결제 수단) |
| `rate_krw_per_jpy` | int not null | 환율 스냅샷(설정값, 현재 10) |
| `amount_net` | int not null | 지급 통화 순액 |
| `fee` | jsonb null | 결제 수단 `fee` 스냅샷(`{mode:'grossUp',percent}` / `{mode:'fixed',amount}`) · null = 인플 부담 |
| `fee_amount` | int not null default 0 | 지급 통화 수수료 금액 |
| `amount_gross` | int not null | `amount_net + fee_amount` = 실제 송금액 = 양식 '금액' |
| `deadline_on` | date not null | 양식 '데드라인' |
| `reference_url` | text null | 양식 '참고자료' |
| `payment_method` | jsonb not null | 결제 수단 스냅샷: `type, holder, currency, email?, paypalId?, identifier?, bank?, branch?, account?` (id·isDefault·updatedAt·fee·memo 제외) |
| `requester_member_id` | uuid null → member, set null | 양식 '요청자' = 만든 사람 |
| `requester_name` | text not null | 스냅샷 |
| `status` | text not null check in ('requested','cancelled') | `지급완료`는 송신 작업에서 추가 |
| `cancelled_at` / `cancelled_by`(→member, set null) / `cancelled_by_name` / `cancel_reason` | timestamptz / uuid / text / text | 취소 기록. `status='cancelled'`이면 넷 다 채운다 |
| `sent_at` / `external_id` | timestamptz null / text null | **송신 작업이 채운다. 이번엔 항상 null** |
| `note` | text not null default '' | 담당자 메모(슬랙 스레드 정정 대신) |
| `created_at` / `updated_at` | timestamptz | updated_at은 스토어가 수동 갱신(캠페인 관례) |

인덱스·제약:
- `create unique index … on payment_request (task_id) where status = 'requested'` — **작업당 활성 요청 1건**을 DB가 보장(koo 08-28). 취소 후 재요청은 허용된다.
- `idx_payment_request_created on (created_at desc)`, `idx_payment_request_handle on (lower(influencer_handle))`, `idx_payment_request_campaign on (campaign_id)`.

### 2-2. `settlement_setting_version` (신설) — 설정은 버전 행

`prompt_template_version`(021)과 같은 문법: 행을 덧붙이고 마지막 행이 현재값. 누가 언제 무엇을 바꿨는지 남는다.

```
id uuid pk, settings jsonb not null, member_id uuid → member set null, created_at timestamptz
```

`settings` 모양(`SettlementSettings`):
```ts
{
  categories: Array<{ id: string; label: string; sendAs: string; hidden: boolean; defaultFor: TaskType[] }>,
  rateKrwPerJpy: number   // 정수 ≥ 1
}
```
행이 하나도 없으면 코드 상수 `SETTLEMENT_DEFAULTS`를 쓴다(첫 화면부터 동작):
- `프로모션 RT·인용RT` → sendAs `마케팅비 > X(트위터) 프로모션 RT·인용RT`, defaultFor `['rt']`
- `인플루언서 협찬 원고료` → `마케팅비 > X(트위터) 인플루언서 협찬 원고료`, defaultFor `[]`(visit 캠페인의 post·visit — 캠페인 종류를 보는 규칙은 §3-3)
- `정보성콘텐츠 업로드 (게시물)` → `마케팅비 > X(트위터) 정보성콘텐츠 업로드 (게시물)`, defaultFor `[]`
- `rateKrwPerJpy: 10`

`defaultFor`에 `quoteRt`는 어느 옵션에도 없다 — 인용RT는 요청자 최근 선택으로 채운다(§3-3). 한 유형은 최대 한 옵션의 defaultFor에만 있을 수 있다(저장 시 검증).

### 2-3. `influencer_log` 이벤트 추가

`influencer_log_event_type_check`를 drop+add로 확장: `'payment_requested','payment_cancelled'` 추가. `payload = { requestId, amountGross, currency, taskType }`, `kind='auto'`, actor = 만든/취소한 멤버. 타임라인 문구: `정산 요청 · ¥3,158` / `정산 요청 취소 · ¥3,158 — {사유}`.

### 2-4. 정산 후보는 저장하지 않고 계산한다

후보 = `campaign_task` 중 `posted_at is not null and cost is not null and influencer_handle is not null` **and** 활성 `payment_request` 없음(`not exists … where task_id = t.id and status = 'requested'`). `removed_at`은 조건이 아니라 배지 정보(캠페인 스펙 §7, koo 08-27). 캠페인·클라이언트·인플 결제 수단(`getDefaultPaymentMethod`)을 조인해 §3의 계산을 끝낸 `SettlementCandidate`로 돌려준다. 캠페인 쪽 판정은 기존 `isSettlementCandidate`(campaignJudgment)를 SQL에 그대로 옮긴 것이다 — 두 곳이 다른 답을 내면 안 되므로 스토어 테스트가 둘을 대조한다.

## 3. 규칙 — `src/lib/settlementCalc.ts` (순수, DB 없음)

입력: 작업(type·cost·postUrl·target…) · 캠페인(kind·clientName) · 결제 수단(또는 null) · 설정 · 요청자 최근 인용RT 분류 · 오늘(서울). 출력: 아래 값 전부 + 신호등. 화면·확인 창·서버 저장이 **같은 함수**를 부른다.

### 3-1. 금액 (원화·지급 통화 둘 다 보존 — koo 08-27)

```
rate = settings.rateKrwPerJpy
if cost.currency == payout.currency:  net = cost.amount
elif KRW → JPY:                        net = round(cost.amount / rate)
elif JPY → KRW:                        net = cost.amount * rate
amount_krw = cost.currency == 'KRW' ? cost.amount : cost.amount * rate
```
결제 수단이 없으면 payout 통화를 알 수 없다 → 금액 칸은 `₩30,000 → —`로 두고 신호등 🔴.

### 3-2. 수수료 (지급 통화에 적용, 반올림은 `Math.round`)

| 결제 수단 `fee` | fee_amount | 근거 |
|---|---|---|
| 없음(인플 부담) | 0 | |
| `grossUp p%` | `round(net / (1 − p/100)) − net` | 슬랙 실측 1000→1053 · 3000→3158 · **8000→8421**(올림이면 8422로 틀림) · 10000→10526 · 20000→21053 |
| `fixed a` | `a` | 일본 계좌 165엔 |

`amount_gross = net + fee_amount`.

### 3-3. 분류 기본값 (`category_default`)

1. 설정 옵션 중 `defaultFor`에 작업 유형이 있으면 그 옵션. (기본 설정: RT → 프로모션 RT·인용RT)
2. 없고 유형이 `post`·`visit`이면: 캠페인 `kind === 'visit'` → `인플루언서 협찬 원고료`, 아니면 `정보성콘텐츠 업로드 (게시물)`. (슬랙 투고 33건 중 28건 일치)
3. 없고 유형이 `quoteRt`면: **같은 요청자**의 가장 최근 `payment_request(task_type='quoteRt')`의 `category`가 숨김 아닌 옵션의 sendAs와 일치하면 그 값, 아니면 **빈칸**.
4. 그 외(설정이 바뀌어 매칭이 없을 때) 빈칸.

빈칸은 🔴(분류 없이는 양식이 성립하지 않는다 — koo 08-28). 사람이 고른 값은 `category`, 미리 채운 값은 `category_default`에 따로 저장한다.

### 3-4. 데드라인 기본값

`kstToday()` 기준 요일: 월~금 → **그 주 금요일**, 토 → 다음 금요일(+6), 일 → **다음날 월요일**(+1). (슬랙 739건 중 금 624·월 115, 일요일 요청 65건 전부 월요일.) 수정 가능.

### 3-5. 문구

- `item_text = '@' + handle + ' ' + TASK_TYPE_LABEL[type] + ' 1건 정산'` (라벨: RT · 인용RT · 투고 · 방문협찬)
- `purpose_text = clientName + ' ' + 문구`: `kind='content'` → `정보성 콘텐츠 Viral 협찬` / `kind='visit'` → rt·quoteRt는 `방문협찬 리뷰 바이럴 목적`, post·visit은 `방문협찬 원고료` / `kind='seeding'` → `제품협찬 바이럴 목적` / kind null → `콘텐츠 협찬`. 사람이 고칠 수 있다(자유 텍스트).

### 3-6. 참고자료 기본값

post·quoteRt·visit → `task.postUrl`. rt → `task.targetTweetUrl ?? task.target?.postUrl`. 없으면 null(🟡, 저장 가능 — koo 08-28; 슬랙 RT 405건 중 350건이 링크 없이 갔다).

### 3-7. 신호등 (`readiness`)

| 색 | 조건 | 행 표시 |
|---|---|---|
| 🔴 `blocked` | 명부에 없는 인플 / 결제 수단 없음 / 분류 빈칸 | 체크 불가. 이유 + 해결 동작: `명부에 없는 인플루언서예요 — 명부에 추가하고 결제 수단을 등록해 주세요`(`/influencers` 링크) / `결제 수단이 없어요 — 프로필에서 등록 →`(거래 정보 탭 링크) / `분류를 골라 주세요` |
| 🟡 `warn` | 참고 URL 없음 / `removed_at` 있음(게시 내려짐 M-D · 사유) / PayPay인데 identifier 없음 | 체크 가능. 문구는 회색·주황 |
| 🟢 `ready` | 나머지 | `보낼 수 있음` |

여러 이유가 겹치면 🔴 > 🟡, 문구는 전부 나열.

## 4. 화면 — `/settlement`

사이드바 `globalNav`에 `{ href: '/settlement', label: '정산' }`을 **캠페인 바로 아래**에 넣는다(캠페인 → 정산: 만든 것 → 돈 보내는 것 순). 레이아웃은 `/campaigns`와 같이 `GlobalShell + ToastProvider`. 탭은 `?tab=candidates|requests|settings`(기본 candidates).

### 4-1. 탭 ① 검토 대기

상단: 필터 4개 `클라이언트 ▾ · 캠페인 ▾ · 유형 ▾ · 결제 수단 ▾`(클라이언트 선택 시 캠페인 목록이 좁혀짐) + 오른쪽 회색 한 줄 `이번 주 마감 8-29(금)`(§3-4 기본값 그대로) + 도움말 한 줄 "캠페인에서 게시 확인된 작업이 자동으로 모여요. 확인하고 골라서 요청을 만들어요."

**행 = B안 두 줄**(시안 `row-layout.html`). 행 높이 ≥ 76px, 본문 14~15px, 숫자는 `tabular-nums`.
- **윗줄 — 읽기만(오차 검증 정보 6개, 왼→오)**: ☐ · `@핸들`(굵게) · 유형 칩 · `클리닉 · 캠페인명`(회색) · **`₩30,000 → ¥3,000`** + 수수료 회색 조각 `+ 158`(없으면 조각 없음; 결제 수단 없으면 `→ —`) · `PayPal · ucymk…@gmail.com`(수단 라벨 + 식별값, `describeMethod` 재사용) · 신호등 문구(오른쪽 끝).
- **아랫줄 — 고칠 수 있는 칸 3개**: `분류 [select]`(숨김 아닌 옵션, 빈칸이면 빨간 테두리) · `마감 [date]` · `참고 [URL 입력, 있으면 링크 표시 + 바꾸기]`. 값은 화면 상태에만 있다가 만들기 때 함께 보낸다(저장 전엔 DB에 없음).
- 금액은 **이름만 바꿔 붙이지 않는다**: 원가와 지급액을 항상 둘 다, 통화 기호와 함께, 수수료는 분리해 보여준다.
- 정렬: 🔴을 **맨 아래**, 나머지는 `posted_at` 오래된 순(먼저 게시된 것부터 처리). 🔴 행은 체크박스 비활성.
- 하단 고정 바: 왼쪽 `선택 2건 · ¥5,323 / ₩0`(지급 통화별 합계, 0인 통화는 생략), 오른쪽 파란 `[선택 2건 요청 만들기]`(0건이면 비활성).
- 빈 상태: `게시 확인된 작업이 없어요 — 캠페인에서 게시된 날을 적으면 여기 나타나요`.

**만들기 흐름**
1. 버튼 → 확인 창: 제목 `결제 요청 2건을 만들어요`, 합계 한 줄, 건별 한 줄(`@핸들 · 유형 · ¥3,158 · PayPal`), 마감 요약. `[만들기]` / `[취소]`.
2. 서버 검증·저장(§5-2). 성공 → 토스트 `2건 만들었어요` + 행 사라짐(후보 조건에 "활성 요청 없음"이 있어 목록 재조회로 자연히 빠진다).
3. 실패(전체 거절, §5-2) → 확인 창 닫히고 목록 재조회, 실패 건에 빨간 문구(`금액이 바뀌었어요 — 다시 확인해 주세요` / `이미 요청됐어요 (모에카, 방금)` / `결제 수단이 바뀌었어요`). 체크는 해제.

### 4-2. 탭 ② 요청 내역

같은 두 줄 행, 편집 칸 대신 값 표시. 윗줄 끝에 상태 배지 `요청됨 8-28` / `취소됨 8-29`(회색 취소선 없음 — 취소도 읽혀야 한다). 필터: 클라이언트 · 캠페인 · 상태 · 기간(생성일, 기본 전체). 최신순. 전량 로드(주 70건 규모 — 원고 목록 선례).

행 클릭 → **그 자리에서 펼침**(별도 페이지 없음): 양식 11항목을 라벨: 값 목록으로(요청자 · 클리닉 · 분류 · 항목 · 목적 · 금액 `¥3,158 (3,000 + 158 수수료) · 원화 ₩30,000 · 환율 10` · 데드라인 · 결제수단 `PayPal | SAWADA KEIKO | ucymk@…` · 참고자료 · 메모) + 만든 사람·시각 + 취소면 `취소 · 모에카 · 8-29 14:10 · 사유`. 복사 버튼은 넣지 않는다(koo 08-28 — 송신은 API 작업).

`요청됨` 행 오른쪽 `[취소]` → 다이얼로그: 사유 입력(필수, 1~200자) + `이 작업은 다시 검토 대기에 나타나요` 도움말 → `[취소 확정]`. 성공 토스트 `취소했어요`.

### 4-3. 탭 ③ 설정

- **분류 목록** 표: 표시명(편집) · 정산 쪽 이름(편집) · 기본값 유형(체크 4개: RT·인용RT·투고·방문협찬 — 한 유형은 한 옵션에만, 이미 다른 옵션에 있으면 그쪽에서 자동 해제되며 문구로 알림) · 숨김 토글. `[+ 분류 추가]`. 숨긴 옵션은 새 요청 드롭다운에서만 사라지고 기존 요청 표시엔 영향 없음(스냅샷). 삭제 없음.
- **환율**: `10 원 = 1 엔` 정수 입력 + 도움말 `바꿔도 이미 만든 요청은 안 바뀌어요 — 만든 시점 값이 저장돼 있어요`.
- `[저장]` 한 번에 전체 저장(버전 행 1개). 저장자는 서버가 해석한 멤버. 하단에 최근 변경 5건(`8-28 14:00 모에카`).

### 4-4. 다른 화면에 붙는 것

- **캠페인 상세 작업 표** `TaskTable.tsx:171` 빈 자리: 작업에 활성 요청이 있으면 `정산 요청됨 8-28`, 마지막 요청이 취소면 `취소됨`, 없으면 빈 자리 유지. 클릭 → `/settlement?tab=requests&task={id}`(내역에서 그 건 펼침). `getCampaignDetail`이 `TaskRow.settlement: { status, createdAt } | null`을 함께 돌려준다(lateral join 1개).
- **인플루언서 프로필 타임라인**: §2-3 이벤트 두 종 문구.
- **삭제 보호**: 활성(`requested`) 요청이 붙은 작업은 지울 수 없다 — `DELETE /api/campaigns/[id]/tasks/[taskId]`가 409 `정산 요청된 작업이에요 — 먼저 정산에서 요청을 취소해 주세요`. 캠페인 삭제도 활성 요청이 하나라도 있으면 같은 이유로 막고(`countTasksForCampaignDelete`에 `activeRequests` 추가), 삭제 확인 문구에 건수를 보인다. 취소된 요청만 있으면 삭제 가능(`task_id`는 set null로 기록만 남는다).

### 4-5. UX 원칙 체크(AGENTS.md)

① 라벨은 사용자 말 — `요청 만들기 · 보낼 수 있음 · 결제 수단 없음 · 게시 내려짐`(grossUp·readiness 같은 내부어 노출 없음) ② 행동 전 기대 — 탭 상단 도움말, 확인 창, 취소 다이얼로그 도움말 ③ 결과는 판단까지 — 신호등 문구에 이유 + 해결 동작 ④ 라벨-값 일치 — 신호등·배지·합계는 전부 서버 계산값에서 파생, 화면은 계산하지 않음 ⑤ 기술 값은 맥락으로 — 환율·수수료는 숫자 옆에 뜻 ⑥ 비용 유발 액션 없음.

## 5. 서버 — 내부 API(우리 화면 ↔ 우리 서버)와 정합성

정산 프로덕트로 보내는 API가 아니다. 그 API는 다음 작업이고, 이 스펙은 `sent_at`·`external_id`와 `settlementSender` 인터페이스 자리만 남긴다(§8).

### 5-1. 라우트

| 라우트 | 하는 일 |
|---|---|
| `GET /api/settlement/candidates` | §2-4 후보를 §3 계산까지 끝내 `SettlementCandidate[]`로. 쿼리 필터 없음(화면에서 거른다 — 주 100건 규모) |
| `GET /api/settlement/requests?…` | 요청 목록(필터: clientId · campaignId · status · from · to · taskId) |
| `POST /api/settlement/requests` | 일괄 생성. body `{ items: Array<{ taskId, category, deadlineOn, referenceUrl, expected: { amountGross, payoutCurrency, paymentMethodId } }> }` |
| `PATCH /api/settlement/requests/[id]` | 취소만. body `{ action: 'cancel', reason }` |
| `GET / PUT /api/settlement/settings` | 설정 읽기 / 저장(`sanitizeSettlementSettings`로 검증, 버전 행 추가) |

가드: `GET candidates`는 `requireMember`(§3-3의 "요청자 최근 인용RT 분류"에 멤버가 필요하다), 그 외 GET은 `requireAllowedUser`, 쓰기는 `requireMember`(프롬프트 설정 관례). 요청자·취소자는 서버가 해석한 멤버 — body의 사람 정보는 무시. 활동 기록은 `insertAutoLog`에 `findByHandle(lower)`로 찾은 influencer_id — 요청은 결제 수단이 있는(=명부에 있는) 인플에만 생기므로 항상 찾아진다.

### 5-2. 일괄 생성은 "전부 검증 → 전부 저장" 한 트랜잭션

1. 건마다 작업·캠페인·결제 수단·설정을 **다시 읽어 §3을 재계산**한다.
2. 검증: 여전히 후보인가(게시됨·비용·인플) / 활성 요청 없는가 / 결제 수단 있는가 / `category`가 숨김 아닌 옵션의 sendAs인가 / `deadlineOn` 날짜 형식 / `referenceUrl`은 null 또는 http(s) / **재계산값이 `expected`와 같은가**(amountGross·payoutCurrency·paymentMethodId).
3. **하나라도 실패하면 아무것도 저장하지 않고** 409로 건별 이유를 돌려준다 — koo 08-28 "튕겨서 다시 보게 한다". 담당자는 최신 목록을 다시 보고 다시 고른다. (건별 부분 저장은 하지 않는다: 담당자가 보지 않은 값이 저장되는 길을 하나도 남기지 않기 위해. 동시 클릭으로 unique 위반이 나면 그 건도 같은 이유로 전체 거절.)
4. 전부 통과 → 한 트랜잭션에서 insert N건 + `influencer_log` N건. 응답 `{ created: PaymentRequestRow[] }`.

### 5-3. 정합성 장치 정리

| 장치 | 막는 사고 |
|---|---|
| 계산 함수 한 곳(§3) | 화면 3,158 / 저장 3,157 |
| 저장 직전 재계산 + expected 대조 → 전체 거절 | 담당자가 보지 않은 금액·수단이 저장됨 |
| partial unique index(task_id, requested) | 두 사람이 동시에 눌러 같은 사람에게 두 번 |
| 스냅샷 컬럼 | 인플이 계좌를 바꾸거나 작업 비용을 고쳐도 지난 요청이 변함 |
| 취소 = 상태 전환 + 사유·사람·시각 | 누가 왜 취소했는지 모름 |

## 6. 파일 구조 / 모듈 경계

| 파일 | 하나의 책임 | 의존 |
|---|---|---|
| `migrations/040_payment_request.sql` | §2 | — |
| `src/lib/settlementCalc.ts` (+ `.test.ts`) | §3 전부 — 순수 함수 `computeCandidate(input) → SettlementComputed`, `defaultDeadline(today)`, `defaultCategory(...)`, `computeMoney(...)` | `influencerPricing`(Currency·라벨), `influencerPayment`(PaymentMethod·fee 타입), `campaignJudgment`(TaskType) |
| `src/lib/settlementSettings.ts` (+ `.test.ts`) | 설정 타입·기본값·`sanitizeSettlementSettings`(순수) | — |
| `src/lib/settlementStore.ts` (+ `.test.ts`, 실 DB) | 후보 조회 `listCandidates(sql, settings)`, `createRequests(sql, items, member)`, `cancelRequest`, `listRequests`, `getSettings/saveSettings`, `settlementByTaskIds`(캠페인 배지용) | `campaignTaskStore`, `influencerStore`(payment_methods·log), `settlementCalc` |
| `src/lib/settlementApi.ts` | 클라이언트 fetch 래퍼(`campaignApi` 문법) | — |
| `src/app/api/settlement/{candidates,requests,requests/[id],settings}/route.ts` | §5-1 | store, authGuard |
| `src/app/settlement/layout.tsx`, `page.tsx` | 셸 + 탭 라우팅 | |
| `src/app/settlement/CandidateTable.tsx`, `CandidateRow.tsx`, `CreateConfirmDialog.tsx` | 탭 ① | |
| `src/app/settlement/RequestList.tsx`, `RequestRow.tsx`, `CancelDialog.tsx` | 탭 ② | |
| `src/app/settlement/SettingsTab.tsx` | 탭 ③ | |
| `src/components/Sidebar.tsx` | 메뉴 1줄 | |
| `src/app/campaigns/TaskTable.tsx`, `src/lib/campaignStore.ts`, `campaignTaskStore.ts` | 배지(§4-4) — `TaskRow.settlement` 추가 | |
| `src/app/influencers/Timeline.tsx`, `src/lib/influencerStore.ts` | 이벤트 2종 문구·타입 | |
| `src/content/updates.ts` | 새 기능 항목(머지 직전) | |

캠페인 모듈은 **읽기 + 배지 한 줄**만 바뀐다. 정산 상태는 캠페인 스토어에 저장하지 않는다(캠페인 스펙 §0 "지급 관리는 범위 밖").

## 7. 테스트

- **`settlementCalc.test.ts`(순수, 수초)**: grossUp 실측 5쌍(1000→1053, 3000→3158, 8000→8421, 10000→10526, 20000→21053) · fixed 165 · 인플 부담 0 · 환산 KRW→JPY(30000→3000, 30005→3001 반올림)·JPY→KRW·같은 통화 · 결제 수단 없음 → 🔴·금액 null · 데드라인 요일 7개 · 분류 기본값(설정 defaultFor / post·visit×kind 3종 / quoteRt 최근값·없음 / 숨긴 옵션 매칭 제외) · 문구 `item/purpose` 조합 · 참고 URL rt 대상 분기 · 신호등 우선순위(🔴>🟡, 문구 나열).
- **`settlementSettings.test.ts`**: 기본값 모양, sanitize(빈 label 거절, defaultFor 중복 유형 거절, rate 정수 ≥1, hidden 불리언).
- **`settlementStore.test.ts`(실 DB, `P{pid}` 접두어 + `after()` 정리)**: 후보 조회가 `isSettlementCandidate`와 같은 답 · 활성 요청 있으면 후보에서 빠짐 · 생성 성공 시 스냅샷 값·로그 1건 · 같은 작업 두 번 → 두 번째 전체 거절(409 사유) · expected 불일치 → 전체 거절, 0건 저장 · 취소 → 상태·사유·사람·시각, 후보 복귀 · 취소 후 재생성 성공 · 설정 버전 행 추가·마지막 행 읽기 · `settlementByTaskIds` 배지값.
- **화면(koo QA, 자동 하네스 없음)**: 신호등 3색 각 1건 · 만들기 → 내역 이동 · 값 바뀐 뒤 만들기 → 튕김 문구 · 취소 → 대기 복귀 · 캠페인 배지·클릭 이동 · 설정 저장 후 기본값 반영 · 빈 상태 · 사이드바 위치. 화면 확인은 `npm run build && npx next start -p 3001` + `127.0.0.1`(로컬 관례).

## 8. 범위 밖 / 다음 작업의 자리

- **정산 프로덕트 송신** — `src/lib/settlementSender.ts`에 `send(request: PaymentRequestRow): Promise<{ externalId }>` 인터페이스만 두고 구현은 다음 작업. `sent_at`·`external_id`는 그때 채운다. 상태 `paid`(지급완료)도 그때.
- 요청 후 작업 비용·수단이 바뀌었을 때 알림(요청은 스냅샷이라 그대로, 배지는 유지 — 차이를 보여주는 건 다음) · 슬랙 게시 · 11항목 복사 버튼(koo 08-28: 넣지 않음) · 인플별 묶어 보기 · 인용RT 분류 규칙 확정(`category_default` vs `category` 비교로 근거 생김) · 앳홈·종근당 등 비클라이언트(필요 시 클라이언트 생성으로) · 권오윤 계정(운영).

## 9. 결정 이력

- 08-27 koo: payment_request 신설·스냅샷 / 클리닉 ID+이름 동봉 / 데드라인 금요일 / 원화·엔화 둘 다 / 분류는 옵션 선택 + 사용자 편집 목록, 저장·송신은 텍스트.
- 08-28 koo: 1차 범위 = 저장 + 화면 확인(송신·슬랙·복사 없음) / 지급완료 상태는 API 때 / 표에서 일괄 확정 / 평평한 목록 + 필터 / 설정은 정산 페이지 안 탭 / B안 두 줄 행, **클리닉·캠페인은 윗줄** / 분류 빈칸 = 🔴, 참고 URL 없음 = 🟡 / 값 바뀌면 **튕김**(A) / 취소는 사유 기록.
- 08-28 설계: 일괄 생성은 부분 저장 없이 전체 검증·전체 저장(§5-2) — 튕김 결정의 일관된 귀결.
