# 정산 요청 연동 API

이 문서는 cb-x-deck(이하 **"소스"**, 우리)가 만든 결제 요청을 정산 프로덕트(이하 **"그쪽"**)가 가져가고, 그쪽에서 바뀐 처리 상태·실제 지급액을 우리에게 돌려주는 연동 API를 설명한다.

## 1. 개요·용어

- **소스는 우리, 그쪽은 미러다.** 결제 요청(`payment_request`)은 소스에서만 생성·취소된다. 그쪽은 폴링(GET)으로 가져가 자기 쪽에서 처리 상태를 관리하고, 처리 상태·실제 지급액을 POST로 우리에게 돌려준다. 우리 화면은 그쪽이 보낸 값을 그대로 비출 뿐이다.
- **엔드포인트 3개, 그 외 없음.**
  - `GET /api/external/settlement/requests` — 목록(폴링용, 커서 기반)
  - `GET /api/external/settlement/requests/{request_id}` — 단건
  - `POST /api/external/settlement/requests/{request_id}/status` — 처리 상태·실지급액 갱신
- **웹훅 없음.** 요청은 취소 외에는 바뀌지 않고, 마감이 주 단위라 분 단위 지연이 업무에 영향을 주지 않는다. 폴링 권장 주기는 5분(§3).
- **환경**

  | 환경 | Base URL |
  |---|---|
  | 스테이징(연동 개발·QA) | `https://cb-x-deck-staging.vercel.app` |
  | 운영(프로덕션) | `https://cb-x-deck.vercel.app` |

  스테이징과 운영은 완전히 별도의 DB·배포다. 연동 개발과 QA는 반드시 스테이징에서 먼저 하고, 운영 전환은 별도로 안내한다.
- **API 키는 1:1 채널로 별도 전달한다.** 이 문서에는 키 값을 싣지 않는다. 스테이징 키와 운영 키는 서로 다른 값이다.
- **키 회전 = 값 교체 + 재배포.** 이중 키를 동시에 받아주는 무중단 회전은 지원하지 않는다. 회전이 필요하면 미리 일정을 맞춘다.

## 2. 인증

모든 요청에 다음 헤더가 필요하다.

```
Authorization: Bearer <API 키>
```

- 키가 없거나 틀리면 **401**, 응답 본문은 없다(에러 JSON도 없음 — 헤더만으로 판단).
- 모든 응답에 `Cache-Control: no-store`가 붙는다. 캐시하지 말 것.

## 3. `GET /api/external/settlement/requests` — 목록(폴링)

### 쿼리 파라미터

| 이름 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `cursor` | 아니오 | 없음 | 이전 응답의 `next_cursor`를 그대로 붙인다. **첫 호출은 `cursor` 없이 보낸다**(전량이 최신 순서로 나오기 시작한다는 뜻이 아니라, 커서가 없으면 맨 앞부터 오름차순으로 준다는 뜻). |
| `limit` | 아니오 | 100 | 페이지당 건수. 최대 500 — 그 이상 값은 500으로 잘린다. 정수가 아니거나 1 미만이면 기본값(100)으로 처리된다. |

`cursor`는 서버가 만들어 준 불투명 문자열이다. 형식을 직접 만들지 말고 항상 이전 응답 값을 그대로 재사용한다. 해석할 수 없는 값을 보내면:

```json
{ "error": "cursor 값을 해석할 수 없어요 — 응답의 next_cursor를 그대로 보내 주세요", "field": "cursor" }
```
(HTTP 400)

### 응답 (200)

```json
{
  "version": 1,
  "items": [ /* Item, §5 */ ],
  "next_cursor": "string | null",
  "has_more": true
}
```

- `items`는 `(updated_at, id)` 오름차순이다.
- `next_cursor`: 이번 응답의 마지막 item 기준 커서. **응답이 비어 있으면 요청에 쓴 `cursor`를 그대로 돌려주고(첫 호출이었다면 `null`)**, 이 값도 반드시 저장해 다음 호출에 쓴다.
- `has_more`: `items.length === limit`이면 `true`. `true`면 **바로 다음 페이지를 이어서 호출**하고, `false`면 이번 폴링 사이클을 마치고 다음 주기(권장 5분 뒤)에 다시 `cursor` 없이가 아니라 마지막으로 저장해 둔 `next_cursor`로 호출한다.

### 폴링 절차 요약

1. 저장해 둔 `next_cursor`(없으면 처음이므로 파라미터 없이)로 호출한다.
2. 응답의 `next_cursor`를 **항상** 덮어써 저장한다(비어 있는 응답이어도).
3. `has_more: true`면 1로 돌아가 즉시 다시 호출한다.
4. `has_more: false`면 이번 사이클 종료. 다음 사이클(권장 5분 뒤)에 저장해 둔 `next_cursor`로 다시 1부터.

새로 만들어지거나 바뀐 요청은 약 30초 뒤부터 목록에 나타납니다(동시에 진행 중인 저장을 건너뛰지 않기 위한 안전 지연).

### 시간대

- 시각 필드(`created_at`, `updated_at`, `cancelled.at`, `settlement.*_at`, 그쪽이 보내는 `updated_at`·`paid_at`)는 **ISO 8601, UTC**(`Z` 접미). 표시할 때 그쪽 시간대로 바꿔 쓰면 된다.
- 날짜 필드(`deadline`)는 **한국(Asia/Seoul) 기준 날짜** `YYYY-MM-DD`다. 시각이 아니라 날짜이므로 변환하지 않는다.

### 3-1. 요청은 수정되지 않는다 — "수정"과 "보류 해결"은 취소 + 새 요청

우리 쪽 결제 요청은 만든 뒤 내용이 바뀌지 않는다(스냅샷). 금액·계좌·분류 등을 고쳐야 하면 담당자가 **그 요청을 취소하고 같은 작업으로 새 요청을 만든다.** 그쪽 미러에는 이렇게 보인다:

1. 옛 건: `status: "cancelled"`, `cancelled.reason`에 사유 — 폴링 목록에 `updated_at`이 갱신되어 다시 나온다. 그쪽이 `on_hold`를 걸어 둔 건이었다면 이 취소가 곧 "보류에 대한 응답"이다.
2. 새 건: 처음 보는 `request_id`, `status: "requested"`, **`task_id`는 옛 건과 같다.**

**그쪽이 `status: "cancelled"`를 보낸 경우**도 같은 모양이다: 우리 쪽 `status`가 `cancelled`로 바뀌고 `cancelled.by_name`은 `"정산 프로덕트"`, **`cancelled.reason`에는 그쪽이 보낸 `note`가 그대로 들어간다**(`note`가 없으면 `"정산에서 취소"`).

그쪽에서 두 건을 이어 보고 싶으면 `task_id`로 묶으면 된다(한 작업에 활성 요청은 항상 1건이고, 취소된 건은 여러 개일 수 있다). 옛 건의 `on_hold`·`note`는 옛 건에 남고 새 건은 `settlement.status: null`로 시작하므로, 새 건에 대해 `received`부터 다시 보내 달라.

### 그쪽이 보낸 상태는 다음 폴링에 되돌아온다(에코)

그쪽이 `POST …/status`를 보내면 그 건의 최상위 `updated_at`이 갱신되므로 **다음 폴링 목록에 그 건이 다시 내려온다.** 그쪽 자신의 변경인지 구분하려면 `settlement.updated_at`(그쪽이 보낸 `updated_at`의 되비침)과 자기 마지막 전송 시각을 비교하면 된다 — 같으면 에코, 다르면 우리 쪽 변경(취소 등)이다. `revision`이 0 → 1로 바뀌었다면 그 요청이 취소된 것이다 — `cancelled.by_name`이 `"정산 프로덕트"`면 그쪽이 보낸 취소의 에코이고, 그 밖의 이름이면 우리 쪽 담당자의 취소다.

### 커서가 무효해지는 경우

커서는 그 건의 `updated_at`(마이크로초)과 `id`에서 파생한 값이라 **서버 재배포나 스키마 변경으로 무효해지지 않는다** — 저장해 둔 커서는 언제든 이어 쓸 수 있다. 커서 문자열이 해석되지 않으면(형식 손상) **항상 400** `{ "error": …, "field": "cursor" }`를 준다 → 그쪽은 커서를 버리고 `cursor` 없이 첫 호출부터 다시 받으면 된다(멱등 upsert라 안전). 형식이 유효한데 그 시점 이후 바뀐 건이 없으면 정상 200 빈 목록이다. 커서 형식을 바꿔야 하는 일이 생기면 `/v2`로 올리고 옛 형식은 400으로 거절한다.

### 정렬·중복 판정 기준은 `updated_at`이다

- 커서와 정렬은 전부 `updated_at`(+동률 시 `id`) 기준이다. **`revision`은 정렬·페이지네이션에 쓰지 않는다** — §5에서 설명하듯 `revision`은 우리 쪽 원본 요청의 변경 횟수(0 또는 1)일 뿐이고, 우리가 그쪽 처리 상태를 반영해도 값이 바뀌지 않는다.
- 배달은 **최소 1회(at-least-once)**다. 같은 `request_id`를 두 번 이상 받을 수 있다는 뜻이며, 그쪽 미러는 이를 허용해야 한다. 멱등 처리는 다음과 같이 한다:

  **GET(가져오기) 쪽 멱등:** 그쪽은 받은 item을 **`request_id` 기준으로 upsert**한다. 같은 `request_id`를 다시 받아도 최신 값으로 덮어쓰면 되고, 별도 중복 판정이 필요 없다.

## 4. `GET /api/external/settlement/requests/{request_id}` — 단건

경로의 `{request_id}`는 uuid다.

- 200: `{ "version": 1, "item": { /* Item, §5 */ } }`
- 404: uuid 형식이 아니거나 존재하지 않는 id — `{ "error": "요청을 찾을 수 없어요" }`

## 5. Item 필드

`GET` 목록의 `items[]`, `GET` 단건의 `item`, `POST` 응답의 `request`가 전부 같은 모양(`Item`)을 쓴다 — 세 곳이 서로 다른 모양을 낼 수 없다.

| 필드 | 타입 | null 가능 | 뜻 |
|---|---|---|---|
| `request_id` | string(uuid) | 아니오 | 결제 요청 ID. 상태 POST의 경로 파라미터로 그대로 쓴다. |
| `revision` | `0` \| `1` | 아니오 | **우리 원본 요청의 변경 횟수** — `0` 요청됨, `1` 취소됨. 그쪽 처리 상태(`settlement.status`)가 바뀌어도 이 값은 바뀌지 않는다. **정렬·중복 판정에 쓰지 말 것**(§3 참고, `updated_at` 사용). |
| `status` | `"requested"` \| `"cancelled"` | 아니오 | **우리 쪽 요청 자체의 상태.** 그쪽 처리 상태가 아니다 — 그쪽 처리 상태는 `settlement.status`. `cancelled`가 되는 경우는 (a) 우리 담당자가 취소, (b) 그쪽이 POST로 `status: cancelled`를 보내 우리가 취소 처리한 경우(§6, §7) 둘 다. |
| `created_at` | string(ISO 8601) | 아니오 | 요청 생성 시각. |
| `updated_at` | string(ISO 8601) | 아니오 | 이 요청 행이 마지막으로 바뀐 시각. 폴링 정렬·커서 기준. |
| `cancelled` | object \| null | `status`가 `cancelled`일 때만 값 있음 | `{ at, by_name, reason }` — 취소 시각·취소한 사람 이름(그쪽이 취소시킨 경우 `"정산 프로덕트"`)·사유. |
| `cancelled.at` | string(ISO 8601) \| null | | |
| `cancelled.by_name` | string \| null | | |
| `cancelled.reason` | string \| null | | |
| `task_id` | string(uuid) \| null | 예(드묾) | 원본 캠페인 작업 ID. **같은 작업을 다시 요청하면(취소 → 새 요청) 새 `request_id`가 생기고 `task_id`는 같다** — 옛 건과 새 건을 잇는 열쇠(§3-1). 작업 자체가 삭제된 경우에만 `null`. |
| `campaign.id` | string(uuid) \| null | 예 | |
| `campaign.name` | string | 아니오 | |
| `clinic.id` | string(uuid) | 아니오 | 우리 클라이언트(병원). 그쪽 체크리스트의 `clinic_id`에 대응. **요청 시점에 스냅샷으로 저장되어 클라이언트가 나중에 삭제·개명되어도 그대로 유지**된다. 매핑·집계는 id 기준으로. |
| `clinic.name` | string | 아니오 | |
| `influencer.id` | string(uuid) | 아니오 | 그쪽 체크리스트의 `influencer_uuid`에 대응. **요청 시점 스냅샷 — 핸들이 바뀌거나 인플루언서가 삭제되어도 이 id는 유지**된다. 집계 키로 이걸 쓸 것. |
| `influencer.handle` | string | 아니오 | 요청 시점의 핸들 표기(표시용). |
| `task_type` | `"post"` \| `"quoteRt"` \| `"rt"` \| `"visit"` | 아니오 | 투고 / 인용RT / RT / 방문협찬. |
| `category.code` | string | 아니오 | 분류 옵션의 안정 키(예 `promo-rt`, `fee`, `info-post`). 사용자가 추가한 옵션은 uuid 문자열. 옵션은 삭제되지 않고 숨김만 되므로 코드는 항상 유효하다. |
| `category.label` | string | 아니오 | 분류 표시 문구(예 `마케팅비 > X(트위터) …`). |
| `item` | string | 아니오 | 품목. |
| `purpose` | string | 아니오 | 목적. |
| `amount_krw` | number(정수) | 아니오 | **단가의 원화 금액 — 송금 수수료는 빠져 있다.** 우리 캠페인 단가(원화 관리)의 확정값이며 잠정치가 아니다. 환율은 요청 시점 우리 설정값의 스냅샷. 그쪽 체크리스트의 `amount_krw_estimated`에 대응하되 "estimated"가 아니라 확정값. **실제로 나간 돈은 `payout.gross_krw`를 쓸 것**(아래 "원화 집계" 참고). |
| `cost_currency` | `"KRW"` \| `"JPY"` | 아니오 | 원가 통화. |
| `payout.currency` | `"KRW"` \| `"JPY"` | 아니오 | 인플루언서가 받는 통화. |
| `payout.net` | number | 아니오 | 인플루언서가 실수령하는 순액. |
| `payout.fee` | `{ mode: "grossUp", percent: number }` \| `{ mode: "fixed", amount: number }` \| `null` | 예 | 송금 수수료를 우리(CB)가 부담하는 방식. `null`이면 수수료 부담 없음. |
| `payout.fee_amount` | number | 아니오 | 수수료 금액(부담 없으면 0). |
| `payout.gross` | number | 아니오 | **실제 송금액 — 결제 양식의 "금액"에 해당하는 값**. `net + fee_amount`. |
| `payout.rate_krw_per_jpy` | number | 아니오 | 요청 시점 스냅샷 환율(원/엔). 지급 통화가 `KRW`면 환산에 쓰이지 않는다. |
| `payout.gross_krw` | number(정수) | 아니오 | **실제 송금액을 원화로 환산한 값 — 원화 지출 집계에 쓸 값.** 우리가 계산해서 보낸다: 지급 통화가 `KRW`면 `gross` 그대로, `JPY`면 `gross × rate_krw_per_jpy`. **그쪽이 통화별로 분기할 필요가 없다.** |
| `deadline` | string(`YYYY-MM-DD`) | 아니오 | 처리 마감일. |
| `reference_url` | string \| null | 예 | 참고 링크. |
| `payment_method` | object(문자열 값만) | 아니오 | 결제 수단 스냅샷. **`type`(`"paypal"` \| `"paypay"` \| `"bank"`)·`holder`(수취인)·`currency`(`"KRW"` \| `"JPY"`)는 항상 있다** — 결제 수단이 없는 작업은 요청을 만들 수 없기 때문. 나머지 `email`, `paypal_id`, `identifier`, `bank`, `branch`, `account`는 수단 종류에 따라 있는 키만 내려온다(paypal: `email` 또는 `paypal_id`, paypay: `identifier`(없을 수 있음), bank: `bank`·`account`·`branch`(일본 계좌만)). 전부 snake_case(원본 `paypalId` → `paypal_id`). |
| `requester.name` | string | 아니오 | 요청자 이름. |
| `requester.email` | string \| null | 예 | 운영에서는 요청자가 로그인한 멤버라 사실상 항상 값이 있다(멤버 계정이 삭제된 경우에만 `null`). **스테이징의 슬랙 이관 데이터는 요청자에 멤버 계정이 없어 전부 `null`** — 스테이징에서 이 필드로 매핑을 검증하지 말 것. |
| `requester.slack_id` | string \| null | 예 | 우리 쪽에 Slack ID가 등록된 요청자만 값이 있다(스테이징 이관 데이터는 전부 `null`). 없으면 `email`로 Slack `users.lookupByEmail`을 쓰면 된다. **`payer`/`cc`에 대응하는 필드는 없다** — 아래 참고. |
| `note` | string | 아니오 | 요청 메모(빈 문자열일 수 있음). |
| `settlement.status` | `"received"` \| `"scheduled"` \| `"paid"` \| `"on_hold"` \| `"cancelled"` \| `null` | 예 | **그쪽이 마지막으로 보낸 처리 상태**를 그대로 되비친 값. `null` = 그쪽이 아직 한 번도 상태를 보내지 않음. |
| `settlement.paid_amount_krw` | number(정수) \| null | 예 | 그쪽이 보낸 실제 지급 원화 금액. `paid` 상태에서만 값이 있다. |
| `settlement.paid_at` | string(ISO 8601) \| null | 예 | 그쪽이 보낸 실제 지급 시각. |
| `settlement.note` | string \| null | 예 | 그쪽이 상태와 함께 보낸 메모(보류 사유·차액 설명·취소 이유 등). |
| `settlement.updated_at` | string(ISO 8601) \| null | 예 | 그쪽이 그 상태를 찍은 시각(POST 본문의 `updated_at` 되비침). |
| `settlement.external_id` | string \| null | 예 | 그쪽 자체 건 ID(그쪽이 보내준 경우만). |

**`payer`/`cc`는 제공하지 않는다.** 그쪽 체크리스트에 있는 이 두 항목은 우리 데이터가 아니라 그쪽 자체 설정(누가 결제 담당·누구를 참조에 넣을지)이므로 이 API에 해당 필드가 없다. 요청자 정보는 `requester` 하나뿐이다.

### 원화 집계 — 어느 필드를 쓸까

원화로 합계를 낼 때 쓸 값이 두 개이고 **뜻이 다르다.**

| 목적 | 쓸 필드 | 뜻 |
|---|---|---|
| 실제 지출(실제로 나간 돈) | **`payout.gross_krw`** | 송금 수수료 포함, 원화 환산 완료 |
| 예산 대비·단가 집계 | `amount_krw` | 우리 캠페인 단가의 원화, **수수료 제외** |

두 값은 수수료만큼 다르다. 예: 순액 ¥3,000 + 수수료 ¥158 = 송금 ¥3,158, 환율 10 →
`amount_krw` = 30,000원 / `payout.gross_krw` = 31,580원 (**1,580원 차이**).

정산은 **원화로 하는 경우와 엔화로 하는 경우가 섞여 있다.** `payout.gross_krw`는 두 경우를 우리가 이미 정리해서
보내는 값이므로 그쪽에서 `payout.currency`로 분기하거나 환율을 곱할 필요가 없다.
`settlement.paid_amount_krw`(그쪽이 실제 지급한 원화)와 대조할 상대도 이 값이다.

## 6. `POST /api/external/settlement/requests/{request_id}/status` — 처리 상태·실지급액 갱신

건별로 호출한다(한 요청 = 한 호출). 일괄 처리 API는 없다.

### 요청 본문

| 필드 | 필수 | 타입 | 설명 |
|---|---|---|---|
| `status` | 예 | `"received"` \| `"scheduled"` \| `"paid"` \| `"on_hold"` \| `"cancelled"` | |
| `updated_at` | 예 | string(ISO 8601) | **그쪽 서버가 그 상태를 확정한 실제 시각.** 클라이언트가 보낸 시각이 아니라 그쪽 서버 시각이어야 한다 — 이 값이 순서·중복 판정 기준이다(아래 "적용 규칙" 참고). |
| `note` | 아니오 | string, ≤500자 | 어떤 상태에도 함께 보낼 수 있다(보류 사유·차액 설명·취소 이유 등 자유 텍스트). |
| `paid_amount_krw` | `status: "paid"`일 때 필수 | number(정수, ≥0) | |
| `paid_at` | `status: "paid"`일 때 필수 | string(ISO 8601) | |
| `external_id` | 아니오 | string, ≤100자 | 그쪽 자체 건 ID. |

### 적용 규칙 (아래 순서대로 판정 — **본문을 먼저 검사하고, 그다음 요청을 찾는다**: 본문이 틀리면 없는 id여도 400)

| 순서 | 조건 | 결과 |
|---|---|---|
| 1 | 본문이 JSON 객체가 아님 / `status` 값이 5개 중 하나가 아님 / `updated_at`이 ISO 8601이 아님 / `note`·`external_id`가 최대 길이 초과 또는 문자열이 아님 / `status: paid`인데 `paid_amount_krw`·`paid_at`이 없거나 형식이 틀림 | **400** `{ "error": "...", "field": "..." }` — 첫 번째로 걸리는 필드 하나만 알려준다 |
| 2 | 본문이 유효한데 `request_id`가 uuid가 아니거나 존재하지 않음 | **404** |
| 3 | 위 조건을 다 통과했지만, 보낸 `updated_at`이 **저장된 `settlement.updated_at`보다 이전이거나 같음** | **200** `{ "version": 1, "applied": false, "reason": "stale", "request": Item }` — 적용하지 않고 무시(재전송·순서 뒤바뀐 옛 변경 흡수) |
| 4 | 우리 쪽 `status`(Item 최상위, §5)가 이미 `"cancelled"`인데 보낸 `status`가 `"cancelled"`가 아님 | **409** `{ "error": "이 요청은 취소됐어요 — 다시 가져가 확인해 주세요", "code": "request-cancelled", "request": Item }` |
| 5 | 저장된 `settlement.status`가 이미 `"paid"`인데 보낸 `status`가 `"paid"`가 아님 | **409** `{ "error": "이미 지급 완료된 요청이에요", "code": "paid-locked", "request": Item }` |
| 6 | 그 외(정상 적용 — `paid → paid` 정정 포함) | **200** `{ "version": 1, "applied": true, "request": Item }` |

401(인증 실패)은 본문 없음. 200·409 응답은 최신 `Item`을 `request`에 담아 돌려주므로(400·404에는 없음), 그쪽은 이 응답만으로도 자기 미러를 즉시 맞출 수 있다.

### 그쪽에 요구하는 것 (반드시 지켜야 함)

- **가져간 직후 `received`를 보내 달라.** 우리 화면의 "정산 접수" 표시는 이 POST로만 바뀐다. 보내지 않으면 우리 담당자에게는 계속 "요청됨"(정산 쪽이 아직 안 봄)으로 보인다.

- **`updated_at`은 실제 변경 시각(서버 시각)이어야 한다.** 재전송 시각이나 클라이언트 시각을 넣지 않는다.
- **실패(네트워크 오류·5xx 등)하면 같은 본문 그대로 재전송한다.** `updated_at`을 갱신하지 말고 원래 본문 그대로 다시 보낸다 — 이 API는 그 경우를 멱등하게 처리한다(위 3번 규칙, 또는 정상 재적용).
- **409를 받으면 그 건을 다시 GET해서 미러를 맞춘다.**
- **폴링 응답에서 특정 요청의 `status`(최상위)가 `"cancelled"`로 바뀐 것을 보면, 지급을 중단하고 그쪽 자기 상태도 취소로 바꾼다.** (우리가 "지급 예정" 상태의 요청을 취소할 수 있다.)
- **`paid` 반영 뒤 되돌리기는 API로 하지 않는다.** 지급 완료된 요청은 우리 쪽에서 취소가 구조적으로 막혀 있고(§7), 그쪽 상태도 `paid` 외로 바꿀 수 없다(위 규칙 5). 지급 완료 건을 정정해야 하면 **API가 아니라 사람(정산 담당자)이 처리**한다.

## 7. 상태 값의 뜻

| `settlement.status` | 뜻 |
|---|---|
| `null` | 그쪽이 아직 이 요청을 확인하지 않음 |
| `received` | 정산 접수 |
| `scheduled` | 지급 예정 |
| `paid` | 지급 완료(실제 지급액·시각 확정). 지급 완료(paid) 이후에는 우리 쪽에서도 요청을 취소할 수 없도록 막혀 있습니다 — 되돌려야 하면 사람이 협의합니다. |
| `on_hold` | 보류 — 사유는 `note`에 |
| `cancelled` | 그쪽이 취소 — 수신 시 우리 쪽 요청도 취소 처리되고, 그 작업은 다시 검토 대기로 돌아간다 |

**"수정 요청"에 해당하는 별도 API는 없다.** 요청 내용을 우리 쪽이 다시 확인해야 하면 `status: "on_hold"` + `note`에 사유를 적어 보낸다. 예: `{ "status": "on_hold", "updated_at": "...", "note": "계좌 정보 확인 필요" }`. `note`는 `on_hold`뿐 아니라 어떤 상태에도 함께 보낼 수 있다.

## 8. 버전 관리·문의

- 목록·단건·상태 갱신(200) 응답에는 `"version": 1`이 들어 있다.
- 하위 호환을 깨는 변경은 이 경로를 그대로 두고 새 `/v2` 경로로 낸다. 이 문서·엔드포인트가 예고 없이 모양을 바꾸는 일은 없다.
- 이 API에는 `event_id`나 웹훅이 없다(§1). HMAC 서명도 쓰지 않는다 — 웹훅이 없으므로 필요하지 않다.
- 담당자·연락 채널은 운영 단계에서 별도 안내한다.

## 9. curl 예시

환경변수로 키를 미리 넣어 둔다고 가정한다: `export SETTLEMENT_API_KEY=...`

### 9-1. 목록 조회 (첫 호출)

```bash
curl -s \
  -H "Authorization: Bearer $SETTLEMENT_API_KEY" \
  "https://cb-x-deck-staging.vercel.app/api/external/settlement/requests?limit=100"
```

응답 예:

```json
{
  "version": 1,
  "items": [
    {
      "request_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "revision": 0,
      "status": "requested",
      "created_at": "2026-08-28T02:10:00.000Z",
      "updated_at": "2026-08-28T02:10:00.000Z",
      "cancelled": null,
      "task_id": "b6f1...",
      "campaign": { "id": "c1a2...", "name": "8월 캠페인" },
      "clinic": { "id": "cl01...", "name": "OO클리닉" },
      "influencer": { "id": "in01...", "handle": "sawada_k" },
      "task_type": "rt",
      "category": { "code": "promo-rt", "label": "마케팅비 > X(트위터) > 프로모션" },
      "item": "RT 진행", "purpose": "노출 확대",
      "amount_krw": 30000, "cost_currency": "KRW",
      "payout": { "currency": "JPY", "net": 3000, "fee": { "mode": "grossUp", "percent": 5 }, "fee_amount": 158, "gross": 3158, "rate_krw_per_jpy": 10, "gross_krw": 31580 },
      "deadline": "2026-08-29", "reference_url": null,
      "payment_method": { "type": "paypal", "holder": "Sawada K", "currency": "JPY", "email": "sawada@example.com", "paypal_id": "sawada-pp" },
      "requester": { "name": "모에카", "email": "moeka@clinicbridge.co.kr", "slack_id": "U0123ABC" },
      "note": "",
      "settlement": { "status": null, "paid_amount_krw": null, "paid_at": null, "note": null, "updated_at": null, "external_id": null }
    }
  ],
  "next_cursor": "MTc4Nzg4MzAwMDAwMDAwMDozZmE4NWY2NC01NzE3LTQ1NjItYjNmYy0yYzk2M2Y2NmFmYTY",
  "has_more": false
}
```

### 9-2. 처리 상태 갱신 (지급 완료)

```bash
curl -s -X POST \
  -H "Authorization: Bearer $SETTLEMENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "status": "paid",
        "updated_at": "2026-08-30T05:10:00.000Z",
        "paid_amount_krw": 29700,
        "paid_at": "2026-08-30T05:10:00.000Z",
        "external_id": "settle-88213"
      }' \
  "https://cb-x-deck-staging.vercel.app/api/external/settlement/requests/3fa85f64-5717-4562-b3fc-2c963f66afa6/status"
```

응답(200):

```json
{
  "version": 1,
  "applied": true,
  "request": {
    "request_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "revision": 0,
    "status": "requested",
    "...": "...",
    "settlement": {
      "status": "paid",
      "paid_amount_krw": 29700,
      "paid_at": "2026-08-30T05:10:00.000Z",
      "note": null,
      "updated_at": "2026-08-30T05:10:00.000Z",
      "external_id": "settle-88213"
    }
  }
}
```

### 9-3. 409 — 이미 지급 완료된 요청을 다른 상태로 되돌리려는 경우

같은 요청에 다시 `scheduled`를 보내면:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $SETTLEMENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "status": "scheduled", "updated_at": "2026-08-30T06:00:00.000Z" }' \
  "https://cb-x-deck-staging.vercel.app/api/external/settlement/requests/3fa85f64-5717-4562-b3fc-2c963f66afa6/status"
```

응답(409):

```json
{
  "error": "이미 지급 완료된 요청이에요",
  "code": "paid-locked",
  "request": { "request_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6", "...": "최신 Item" }
}
```

지급 완료 건을 정정해야 하면 API가 아니라 사람이 처리한다(§6).
