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

### 3-1. 요청 수정은 "제자리 수정"이다 — 같은 `request_id`, `revision` +1 (2026-09-07 개정, 전환일부터 적용)

> **전환 안내.** 이 절은 그쪽 09-07 제안을 수용해 바꾼 것이다. **전환 스위치를 켜는 시각(양쪽 배포 완료 후 슬랙으로 합의)부터 적용**되며, 그 전까지는 아래 "전환 전(현행)" 동작이 그대로 유효하다.

**전환 후.** 지급 전(`settlement.status`가 `paid`가 아닌) 요청은 저희 담당자가 **제자리에서 고친다.** 그쪽 미러에는 이렇게 보인다:

| 필드 | 수정 전 | 수정 후 |
|---|---|---|
| `request_id` · `external_id` · `task_id` | 그대로 | **그대로** |
| `status` | `requested` | **`requested`** (수정은 취소가 아니다) |
| `revision` | n | **n+1** (수정 횟수, §5) |
| `revised_at` | 이전 수정 시각 또는 `null` | **이번 수정 시각** |
| `settlement.status`·`note`·`paid_*`·`updated_at` | 그쪽이 보낸 값 | **전부 `null`로 리셋** — 금액 등이 바뀌었으니 `received`부터 다시 처리해 달라 |
| `settlement.external_id` | 그쪽 정산코드 | **그대로 유지** |
| `updated_at` | | 갱신 → 다음 폴링에 다시 내려온다 |

- 고칠 수 있는 값: 요청을 만들 때 정하는 값 전부(금액·수수료·결제 수단·통화·분류·마감·참고 링크). 고친 값은 새 요청을 만들 때와 같은 검사(증빙·링크·결제 수단)를 통과한 것만 반영된다.
- **`paid` 이후에는 수정할 수 없다.** 지급 후 금액 정정은 종전처럼 그쪽의 `paid → paid` 재전송(§6)만 쓴다.
- **진짜 폐기는 종전처럼 `status: "cancelled"`** + `cancelled.reason`. 수정(`requested` + `revision`↑)과 폐기(`cancelled`)는 데이터로 구분된다. 취소된 요청의 `revision`은 그때까지의 수정 횟수를 그대로 가진다.
- 작업의 인플루언서가 바뀐 경우(재배정)는 수정이 아니라 다른 의무이므로 종전처럼 취소 + 새 요청이다(`task_id` 같음).
- 고치기 전 내용은 저희 쪽에 개정 이력으로 보관한다(이 API로는 내려가지 않는다).
- **예외 — 수취 정보 정정(2026-09-21, §6-1).** 그쪽이 `POST …/payment-info`로 이번 지급 건의 수취 정보(계좌·PayPal 등)를 고치면 **`revision`은 오르지 않고** `payment_method`만 바뀐다(`settlement.*`·금액·`external_id`도 그대로). 그 건은 `updated_at`이 갱신돼 다음 폴링에 다시 내려오며, Item의 `payment_method_correction.correction_id`가 그쪽이 보낸 값이면 **그쪽 자신의 정정의 회신**이다 — 저희 수정(`revision` 증가·`settlement` 리셋)과 혼동하지 않는다.

**그쪽이 함께 지켜야 하는 것.**
1. **수정을 원하면 `on_hold` + `note`로 보낸다.** `cancelled`를 보내면 저희 요청이 즉시 취소되어 고칠 수 없고, 저희는 새 요청을 만들게 된다(`task_id` 같음, 서류 두 장).
2. **상태 POST에 `revision`을 넣는다**(§6). 저희 현재 값과 다르면 409 `revision-mismatch` — 재전송하지 말고 응답의 최신 Item으로 다시 판단한다.
3. **`revision`은 +1씩 오지 않을 수 있다**(한 폴링 간격 안에 두 번 고치면 0 → 2). "저장값보다 커졌다"로 판단한다. **처음 보는 요청인데 `revision` > 0**이면(가져가기 전에 고친 것) 신규로 처리한다.
4. **신규 유입 집계는 `request_id` 첫 등장 기준**으로 한다 — 고친 요청도 `status: "requested"`로 다시 내려온다.
5. **송금 중 수정 방지(2026-09-07 합의 — 절차로 해결).** 그쪽 송금 흐름(수동 송금 → 실지급액 입력 → 확정)상 송금 시점에 `paid`를 보낼 수 없으므로, **그쪽이 이미 처리한 요청(`settlement.status`가 `null`이 아닌 건)을 저희가 고칠 때는 슬랙으로 그쪽 결제 담당자에게 먼저 확인하고 반영한다.** 저희 화면은 그런 건에 "담당자에게 확인했어요" 체크 없이는 반영 버튼을 열지 않고, 확인 여부를 개정 이력에 남긴다. 그쪽은 송금이 끝난 건에 수정본이 오면 금액을 덮지 않고 정합 오류로 막는 안전장치를 유지한다(그쪽 09-07 보고). 건수·담당자가 늘면 "송금 진행 중" 상태 추가로 격상할 수 있다.

**전환 전(현행).** 요청은 만든 뒤 내용이 바뀌지 않는다(스냅샷). 고쳐야 하면 담당자가 그 요청을 **취소하고 같은 작업으로 새 요청을 만든다** — 옛 건은 `status: "cancelled"` + `cancelled.reason`, 새 건은 새 `request_id` + `status: "requested"` + **같은 `task_id`**. 두 건을 이으려면 `task_id`로 묶는다. `revision`은 `0` 요청됨 / `1` 취소됨.

**그쪽이 `status: "cancelled"`를 보낸 경우**(전환 전후 동일): 우리 쪽 `status`가 `cancelled`로 바뀌고 `cancelled.by_name`은 `"정산 프로덕트"`, **`cancelled.reason`에는 그쪽이 보낸 `note`가 그대로 들어간다**(`note`가 없으면 `"정산에서 취소"`). 그 작업은 저희 검토 대기로 돌아간다.

### 3-2. 예외 — `proof`만은 최신값이 내려간다

위 원칙(요청은 수정되지 않는다)은 금액·계좌·기한 등 **돈과 관련된 값**에 대한 것이다. **`proof`(§5, §4-1)는 예외다** — 이 항목만은 그 작업의 **지금 값**을 실어 보낸다. 그래서 `task_type == "rt"`인 요청을 `on_hold`로 돌려보낸 뒤 저희 담당자가 그 작업에 스크린샷을 올리면, **취소·재요청 없이 다음 폴링에 `proof`가 채워져 내려간다.** 돈 관련 값은 "요청 시점에 확정한 값"이 진실이어야 하지만, 증빙의 목적은 "지금 실제로 했는지 확인"이므로 최신이 맞다는 판단이다.

### 그쪽이 보낸 상태는 다음 폴링에 되돌아온다(에코)

그쪽이 `POST …/status`를 보내면 그 건의 최상위 `updated_at`이 갱신되므로 **다음 폴링 목록에 그 건이 다시 내려온다.** 그쪽 자신의 변경인지 구분하려면 `settlement.updated_at`(그쪽이 보낸 `updated_at`의 되비침)과 자기 마지막 전송 시각을 비교하면 된다 — 같으면 에코, 다르면 우리 쪽 변경(취소 등)이다. `revision`이 커졌다면 저희가 그 요청을 고친 것이다(§3-1, 전환 후) — 전환 전에는 0 → 1이 곧 취소였다. 취소 여부는 항상 `status`로 본다 — `cancelled.by_name`이 `"정산 프로덕트"`면 그쪽이 보낸 취소의 에코이고, 그 밖의 이름이면 우리 쪽 담당자의 취소다.

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

## 4-1. `GET /api/external/settlement/requests/{request_id}/proof` — 증빙 이미지

RT(단순 리트윗) 작업은 새 게시물 URL이 없어 `reference_url`이 확인 자료가 되지 못한다 — 원본 트윗(클리닉 자신의 글)만 가리키기 때문이다. 그래서 RT 작업만 저희가 받아 둔 **인플루언서 피드 스크린샷**을 이 엔드포인트로 내려받을 수 있다(다른 유형이 무엇을 확인 자료로 쓰는지는 §5 "유형별 확인 자료" 참고).

```
GET /api/external/settlement/requests/{request_id}/proof
Authorization: Bearer <API 키>          ← 같은 키, 같은 헤더(§2)
```

| 응답 | 조건 |
|---|---|
| **200** | 증빙이 있음. 본문은 이미지 바이트 그대로, `Content-Type: image/jpeg` \| `image/png` \| `image/webp` |
| **404** | 요청이 없거나, 있어도 증빙이 없음 — 저희 쪽 기록에는 둘을 구분해 남기지만 **응답은 둘 다 같은 404**다(본문 없음) |
| **401** | 키 불일치. 본문 없음 |

모든 응답에 `Cache-Control: no-store`가 붙는다(§2와 동일).

- **왜 Item에 서명 URL을 직접 넣지 않는가:** 서명 URL은 만료된다. 목록을 캐시해 두셨다가 며칠 뒤 여시면 죽은 링크가 됩니다. 이 엔드포인트는 **주소가 고정**이고 열 때마다 저희 쪽에서 새로 서명하므로 만료가 없습니다 — `proof.url`(§5)은 항상 이 주소이고, 그쪽 코드는 "GET 한 번"으로 끝납니다.
- **왜 302 리다이렉트가 아니라 바이트를 그대로 주는가:** 302는 그쪽 HTTP 클라이언트가 리다이렉트를 따라가야 하고, 안 따라가면 저희가 알 수 없는 실패가 됩니다. 증빙은 스크린샷 한 장(버킷 상한 10MB)이라 바이트로 주는 편이 모호함이 없습니다.
- **이 호출도 저희 쪽 호출 기록에 남습니다.** 이 API의 용도가 "지급 전 확인"이므로, **그쪽이 언제 이 증빙을 열어봤는지가 저희 쪽에 기록되는 것 자체가 근거**가 될 수 있습니다.

## 5. Item 필드

`GET` 목록의 `items[]`, `GET` 단건의 `item`, `POST` 응답의 `request`가 전부 같은 모양(`Item`)을 쓴다 — 세 곳이 서로 다른 모양을 낼 수 없다.

| 필드 | 타입 | null 가능 | 뜻 |
|---|---|---|---|
| `request_id` | string(uuid) | 아니오 | 결제 요청 ID. 상태 POST의 경로 파라미터로 그대로 쓴다. |
| `revision` | number(정수 ≥ 0) | 아니오 | **저희가 이 요청을 고친 횟수**(§3-1). `0` 최초, `1` 1차 수정, … 취소 여부는 이 값이 아니라 `status`로 본다(취소된 요청도 수정 횟수를 그대로 가진다). 그쪽 처리 상태(`settlement.status`)가 바뀌어도 변하지 않는다. **정렬·중복 판정에 쓰지 말 것**(`updated_at` 사용). **전환 전(현행)**: `0` 요청됨 / `1` 취소됨. |
| `revised_at` | string(ISO 8601) \| null | 예 | 마지막으로 고친 시각(§3-1). 한 번도 안 고쳤으면 `null`. 전환 전에는 항상 `null`. |
| `payment_method_correction` | object \| null | 예 | **그쪽이 `POST …/payment-info`(§6-1)로 마지막에 보낸 수취 정보 정정의 표식**(2026-09-21 추가). `{ correction_id, at, by_name }` — `correction_id`는 그쪽이 보낸 값 그대로, `at`은 저희가 반영한 시각, `by_name`은 `operator.name`. 이 값이 있는 건이 폴링에 내려오면 `correction_id`를 자기 기록과 대조해 **자기 정정의 회신인지** 가른다. `null` = 정정된 적 없음, **또는 그 뒤 저희가 제자리 수정(§3-1)을 함**(그때는 `revision`도 함께 커진다). 표식만 사라질 뿐, 명부가 이미 정정 값이라(2026-09-22 자동 반영) 결제 수단 값은 유지된다. |
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
| `campaign.starts_on` | string(`YYYY-MM-DD`) \| null | 예 | **요청 시점 캠페인 시작일 스냅샷**(2026-09-14 추가). 그 뒤 캠페인 기간을 고쳐도 이 값은 그대로다 — 고친 값을 보내야 하면 저희가 제자리 수정(§3-1)으로 다시 반영하고, 그때 `revision`·`updated_at`이 함께 바뀐다. `null`은 2026-09-14 이전에 만들어졌고 캠페인이 삭제된 요청뿐. |
| `campaign.ends_on` | string(`YYYY-MM-DD`) \| null | 예 | 요청 시점 캠페인 종료일 스냅샷(2026-09-14 추가). 규칙은 `starts_on`과 같다. |
| `clinic.id` | string(uuid) | 아니오 | 우리 클라이언트(병원). 그쪽 체크리스트의 `clinic_id`에 대응. **요청 시점에 스냅샷으로 저장되어 클라이언트가 나중에 삭제·개명되어도 그대로 유지**된다. 매핑·집계는 id 기준으로. |
| `clinic.name` | string | 아니오 | |
| `influencer.id` | string(uuid) | 아니오 | 그쪽 체크리스트의 `influencer_uuid`에 대응. **요청 시점 스냅샷 — 핸들이 바뀌거나 인플루언서가 삭제되어도 이 id는 유지**된다. 집계 키로 이걸 쓸 것. |
| `influencer.handle` | string | 아니오 | 요청 시점의 핸들 표기(표시용). |
| `influencer.display_name` | string \| null | 예 | 인플루언서 **명부의 지금 표시명**(X 프로필 이름, 2026-09-21 추가 — 그쪽 미러 표시용). 핸들과 달리 스냅샷이 아니라 최신값이다(`proof`와 같은 판단 — 표시용은 최신이 맞다). 프로필을 아직 조회하지 않았거나 인플루언서가 삭제됐으면 `null`. 집계·매핑 키로 쓰지 말 것(`influencer.id`). |
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
| `posted_on` | string(`YYYY-MM-DD`) \| null | 예 | **게시일(서울 날짜) — `task_type`이 `post`·`quoteRt`·`visit`일 때만 값이 있다**(2026-09-14 추가). 인플루언서 본인 게시물의 트윗 시각에서 뽑은 날짜의 요청 시점 스냅샷. `rt`에서는 항상 `null`(아래 `confirmed_on`). |
| `confirmed_on` | string(`YYYY-MM-DD`) \| null | 예 | **RT 확인일 — `task_type`이 `rt`일 때만 값이 있다**(2026-09-14 추가). 단순 RT는 새 게시물이 없어 실제 리트윗 시각을 알 수 없다. 저희 담당자가 피드 스크린샷(`proof`)을 확인하고 적은 날짜다. `rt`가 아닌 유형에서는 항상 `null`. 두 필드는 한쪽만 값이 있고, "날짜 하나"가 필요하면 둘 중 값이 있는 쪽을 쓰면 된다. 2026-09-14 이전 요청 중 작업이 삭제된 건만 둘 다 `null`. |
| `reference_url` | string \| null | 예 | 참고 링크. **투고·인용RT·방문 협찬에서는 이 값이 인플루언서 본인 게시물 링크라 지급 전 확인 자료가 된다.** `rt`(단순 RT)에서는 클리닉 원본 트윗이라 확인 자료가 아니다 — 아래 "유형별 확인 자료"·`proof` 참고. |
| `proof` | object \| null | 예 | **RT 작업의 지급 전 확인 자료(스크린샷).** `{ url, uploaded_at, uploaded_by }`. `null`인 경우 둘: ① RT가 아닌 유형(→ `reference_url`로 확인) ② RT인데 아직 스크린샷이 없음. **`task_type == "rt"`이고 `proof == null`이면 확인 자료가 없는 요청 — `on_hold`로 돌려보내 달라(§6, §7).** `proof`만은 스냅샷이 아니라 최신값이다(§3-2). **2026-09-02부터 저희 쪽에서 증빙 없는 RT는 요청 자체를 만들 수 없게 막았다** — 그 이후 새 요청에서 이 조합은 나오지 않고, 그 전에 만든 요청에만 남아 있을 수 있다. 같은 날부터 `rt`가 아닌 유형은 `reference_url`이 항상 채워진다. |
| `proof.url` | string | | 증빙 이미지의 고정 주소(§4-1). 서명 URL이 아니다 — 만료되지 않는다. |
| `proof.uploaded_at` | string(ISO 8601) | | 스크린샷을 올린 시각. |
| `proof.uploaded_by` | string | | 스크린샷을 올린 사람 이름. |
| `payment_method` | object(문자열 값만) | 아니오 | 결제 수단 스냅샷. **`type`(`"paypal"` \| `"paypay"` \| `"bank"`)·`holder`(수취인)·`currency`(`"KRW"` \| `"JPY"`)는 항상 있다** — 결제 수단이 없는 작업은 요청을 만들 수 없기 때문. 나머지 `email`, `paypal_id`, `identifier`, `bank`, `branch`, `account`는 수단 종류에 따라 있는 키만 내려온다(paypal: `email` 또는 `paypal_id`, paypay: `identifier`(**2026-09-03부터 새 요청에서는 항상 있음** — 없는 PayPay 인플루언서는 요청을 만들 수 없게 막았다. 그 전 요청에만 빠져 있을 수 있다), bank: `bank`·`account`·`branch`(일본 계좌만)). 전부 snake_case(원본 `paypalId` → `paypal_id`). **값이 없는 키는 `null`이 아니라 키 자체가 없다.** |
| `requester.name` | string | 아니오 | 요청자 이름. |
| `requester.email` | string \| null | 예 | 운영에서는 요청자가 로그인한 멤버라 사실상 항상 값이 있다(멤버 계정이 삭제된 경우에만 `null`). **스테이징의 슬랙 이관 데이터는 요청자에 멤버 계정이 없어 전부 `null`** — 스테이징에서 이 필드로 매핑을 검증하지 말 것. |
| `requester.slack_id` | string \| null | 예 | 우리 쪽에 Slack ID가 등록된 요청자만 값이 있다(스테이징 이관 데이터는 전부 `null`). 없으면 `email`로 Slack `users.lookupByEmail`을 쓰면 된다. **`payer`/`cc`에 대응하는 필드는 없다** — 아래 참고. |
| `note` | string | 아니오 | 요청 메모(빈 문자열일 수 있음). |
| `settlement.status` | `"received"` \| `"scheduled"` \| `"paid"` \| `"on_hold"` \| `"cancelled"` \| `null` | 예 | **그쪽이 마지막으로 보낸 처리 상태**를 그대로 되비친 값. `null` = 그쪽이 아직 한 번도 상태를 보내지 않음. |
| `settlement.paid_amount_krw` | number(정수) \| null | 예 | 그쪽이 보낸 실제 지급 원화 금액. `paid` 상태에서만 값이 있다. |
| `settlement.paid_amount_usd` | number(소수 2자리) \| null | 예 | 그쪽이 보낸 달러 실지급액(PayPal 지급, 2026-09-09 추가). 그쪽이 `paid_amount_usd`를 보낸 경우에만 값이 있다. 되비침용 — 차액 판정은 `paid_amount_krw`로만 한다. |
| `settlement.paid_amount_jpy` | number(정수) \| null | 예 | 그쪽이 보낸 엔화 실지급액(계좌(일본)·PayPay 지급, 2026-09-09 추가). 그쪽이 `paid_amount_jpy`를 보낸 경우에만 값이 있다. 한 요청에 `paid_amount_usd`와 동시에 값이 있지 않다. |
| `settlement.paid_at` | string(ISO 8601) \| null | 예 | 그쪽이 보낸 실제 지급 시각. |
| `settlement.note` | string \| null | 예 | 그쪽이 상태와 함께 보낸 메모(보류 사유·차액 설명·취소 이유 등). |
| `settlement.updated_at` | string(ISO 8601) \| null | 예 | 그쪽이 그 상태를 찍은 시각(POST 본문의 `updated_at` 되비침). |
| `settlement.external_id` | string \| null | 예 | 그쪽 자체 건 ID(그쪽이 보내준 경우만). |

**`payer`/`cc`는 제공하지 않는다.** 그쪽 체크리스트에 있는 이 두 항목은 우리 데이터가 아니라 그쪽 자체 설정(누가 결제 담당·누구를 참조에 넣을지)이므로 이 API에 해당 필드가 없다. 요청자 정보는 `requester` 하나뿐이다.

### 유형별 확인 자료 — 지급 전에 무엇을 볼 것인가

`task_type`에 따라 "그 작업이 실제로 이루어졌는지" 확인할 자료가 다른 필드에 있다.

| `task_type` | 확인할 필드 | 왜 |
|---|---|---|
| `post`(투고) · `quoteRt`(인용RT) · `visit`(방문협찬) | `reference_url` | 인플루언서 본인 게시물 링크 — 그 자체가 증거다 |
| `rt`(단순 RT) | `proof`(§4-1) | 새 게시물이 없어 `reference_url`은 **클리닉 원본 트윗**이 된다 — 원본을 보여줄 뿐 그 인플루언서가 RT했다는 증거는 아니다. 그래서 저희가 별도로 받아 둔 피드 스크린샷이 확인 자료다. |

`task_type == "rt"`이고 `proof == null`이면 확인 자료가 아직 없는 요청이다 — **`on_hold`로 돌려보내 주시면 감사하겠다.** 저희 담당자가 스크린샷을 올리면 취소·재요청 없이 다음 폴링에 `proof`가 채워져 내려간다(§3-2).

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
| `paid_amount_usd` | 아니오 | number(≥0, 소수 허용) | **PayPal 지급의 달러 실지급액**(2026-09-09). `paid`에서만 — 다른 상태에 보내면 400. `paid_amount_krw`와 **함께** 보낸다(원화 없이 외화만 오면 400 `paid_amount_krw`). 소수 셋째 자리부터 반올림. `paid_amount_jpy`와 동시에 보낼 수 없다. |
| `paid_amount_jpy` | 아니오 | number(0 이상 안전 정수) | **계좌(일본)·PayPay 지급의 엔화 실지급액**(2026-09-09 그쪽 요청 22 수용). `paid`에서만. `null`·소수·문자열·2^53 초과는 400 `field: "paid_amount_jpy"`. 0은 유효(필드 존재로 판정). `paid_amount_usd`와 동시에 오면 400 `field: "paid_amount_jpy"`. |
| `paid_currency` | 아니오 | `"KRW"` \| `"JPY"` \| `"USD"` | **실제 지급 통화 명시(저희 제안, 2026-09-09).** `paid`에서만. 보내면 그 통화로 확정한다 — `"KRW"`면 저장된 외화(USD·JPY)를 둘 다 지운다(계좌 엔화 지급을 원화 지급으로 정정할 때). 외화 필드와 어긋나면(예: `"USD"` + `paid_amount_jpy`) 400 `field: "paid_currency"`. **안 보내면 "부재는 의미 없음"** — 저장된 외화를 건드리지 않는다. 그래서 버전 게이트·전환 시점 합의 없이도 구버전 전송(외화 없는 원화 정정)이 외화를 지우지 않는다. |
| `external_id` | 아니오 | string, ≤100자 | 그쪽 자체 건 ID. |
| `revision` | **전환 후 필수**(전환 전 무시) | number(정수 ≥ 0) | 그쪽이 마지막으로 받은 Item의 `revision`. 저희 현재 값과 다르면 **409 `revision-mismatch`**(아래 규칙 3-1) — 옛 판에 대한 늦은 상태가 새 판에 붙는 것을 막는다. |
| `operator` | 아니오 | `{ id: string, name: string }` (각 ≤100자, 비어 있지 않음) | **이 상태 전이를 실행한 그쪽 결제 담당자**(2026-09-07 추가, 그쪽 09-04 요청). 사람이 실행한 전이(취소·보류·재개·지급·정정)에만 넣고, 자동 전이(수신 즉시 `received→scheduled`)에는 키를 넣지 않는다. 저희는 마지막으로 적용된 전이의 담당자를 요청에 남겨 화면에 "처리한 사람"으로 보인다. `null`은 "없음"과 같다. 모양이 틀리면 400 `{ field: "operator" }`. |

**본문에 저희가 모르는 키가 있으면 무시한다** — 400을 내지 않는다. 그쪽이 필드를 먼저 추가해 보내도 상태 전송이 깨지지 않는다(단, 저희가 저장·표시하려면 위 표에 올라와야 한다 — 미리 알려 주시면 반영한다).

### 적용 규칙 (아래 순서대로 판정 — **본문을 먼저 검사하고, 그다음 요청을 찾는다**: 본문이 틀리면 없는 id여도 400)

| 순서 | 조건 | 결과 |
|---|---|---|
| 1 | 본문이 JSON 객체가 아님 / `status` 값이 5개 중 하나가 아님 / `updated_at`이 ISO 8601이 아님 / `note`·`external_id`가 최대 길이 초과 또는 문자열이 아님 / `operator`가 있는데 `{ id, name }` 모양이 아님 / (전환 후) `revision`이 정수가 아님 / `status: paid`인데 `paid_amount_krw`·`paid_at`이 없거나 형식이 틀림 / `paid_amount_usd`·`paid_amount_jpy`·`paid_currency`가 `paid`가 아닌 상태에 있음, 형식이 틀림, 서로 어긋남(USD·JPY 동시, 통화와 외화 불일치) | **400** `{ "error": "...", "field": "..." }` — 첫 번째로 걸리는 필드 하나만 알려준다 |
| 2 | 본문이 유효한데 `request_id`가 uuid가 아니거나 존재하지 않음 | **404** |
| 2-1 | (전환 후) 본문의 `revision`이 없음 → **400** `{ field: "revision" }` / 저희 현재 `revision`과 다름 → **409** `{ "error": "이 요청은 그 사이 고쳐졌어요 — 최신 내용으로 다시 확인해 주세요", "code": "revision-mismatch", "request": Item }`. 재전송하지 말고 `request`(최신 Item)로 다시 판단한다. (전환 전에는 `revision`을 무시한다.) |
| 3 | 위 조건을 다 통과했지만, 보낸 `updated_at`이 **저장된 `settlement.updated_at`보다 이전이거나 같음** | **200** `{ "version": 1, "applied": false, "reason": "stale", "request": Item }` — 적용하지 않고 무시(재전송·순서 뒤바뀐 옛 변경 흡수) |
| 4 | 우리 쪽 `status`(Item 최상위, §5)가 이미 `"cancelled"`인데 보낸 `status`가 `"cancelled"`가 아님 | **409** `{ "error": "이 요청은 취소됐어요 — 다시 가져가 확인해 주세요", "code": "request-cancelled", "request": Item }` |
| 5 | 저장된 `settlement.status`가 이미 `"paid"`인데 보낸 `status`가 `"paid"`가 아님 | **409** `{ "error": "이미 지급 완료된 요청이에요", "code": "paid-locked", "request": Item }` |
| 6 | 그 외(정상 적용 — `paid → paid` 정정 포함) | **200** `{ "version": 1, "applied": true, "request": Item }` |

401(인증 실패)은 본문 없음. 200·409 응답은 최신 `Item`을 `request`에 담아 돌려주므로(400·404에는 없음), 그쪽은 이 응답만으로도 자기 미러를 즉시 맞출 수 있다.

### 외화 실지급액의 저장 의미 (2026-09-09)

`paid` 적용 시 외화(`paid_amount_usd`·`paid_amount_jpy`)는 **보낸 것만 갱신**한다.

| 새 `paid` 본문 | 저장 결과 |
|---|---|
| `paid_amount_jpy` 포함 | JPY 저장, 기존 USD는 `null` |
| `paid_amount_usd` 포함 | USD 저장, 기존 JPY는 `null` |
| 외화 없음 + `paid_currency: "KRW"` | USD·JPY 둘 다 `null`(원화 지급으로 정정) |
| 외화 없음 + `paid_currency` 없음 | **기존 USD·JPY 유지**(구버전 전송·원화만 정정) |
| stale(§6 규칙 3) | 아무것도 바꾸지 않음 |

과거 금액을 환율로 역산해 외화를 만들지 않는다. 차액 판정(§5 "원화 집계")은 종전대로 `paid_amount_krw` vs `payout.gross_krw`.

### 그쪽에 요구하는 것 (반드시 지켜야 함)

- **가져간 직후 `received`를 보내 달라.** 우리 화면의 "정산 접수" 표시는 이 POST로만 바뀐다. 보내지 않으면 우리 담당자에게는 계속 "요청됨"(정산 쪽이 아직 안 봄)으로 보인다.

- **`updated_at`은 실제 변경 시각(서버 시각)이어야 한다.** 재전송 시각이나 클라이언트 시각을 넣지 않는다.
- **실패(네트워크 오류·5xx 등)하면 같은 본문 그대로 재전송한다.** `updated_at`을 갱신하지 말고 원래 본문 그대로 다시 보낸다 — 이 API는 그 경우를 멱등하게 처리한다(위 3번 규칙, 또는 정상 재적용).
- **409를 받으면 그 건을 다시 GET해서 미러를 맞춘다.**
- **폴링 응답에서 특정 요청의 `status`(최상위)가 `"cancelled"`로 바뀐 것을 보면, 지급을 중단하고 그쪽 자기 상태도 취소로 바꾼다.** (우리가 "지급 예정" 상태의 요청을 취소할 수 있다.)
- **`paid` 반영 뒤 되돌리기는 API로 하지 않는다.** 지급 완료된 요청은 우리 쪽에서 취소가 구조적으로 막혀 있고(§7), 그쪽 상태도 `paid` 외로 바꿀 수 없다(위 규칙 5). 지급 완료 건을 정정해야 하면 **API가 아니라 사람(정산 담당자)이 처리**한다.

## 6-1. `POST /api/external/settlement/requests/{request_id}/payment-info` — 수취 정보(결제 수단) 정정 회신 (2026-09-21 추가)

그쪽 정산 담당자가 **이번 지급 건의 수취 정보**(계좌·PayPal·PayPay 식별값 등)의 오타를 고쳤을 때, 취소·재요청 없이 **같은 요청의 `payment_method`만** 바꾸는 엔드포인트다(그쪽 09-21 요청 수용). §3-1 "요청 내용 변경은 저희 쪽 제자리 수정"의 유일한 예외이며, 바뀌는 것은 `payment_method`·`payment_method_correction`·`updated_at` 셋뿐이다 — **`revision`·`revised_at`·`status`·금액·`settlement.*`(처리 상태·정산코드·실지급액·담당자)는 건드리지 않는다.**

- **명부 자동 반영(2026-09-22 변경).** 정정이 **고친 항목만** 저희 인플루언서 명부(원본)의 해당 결제 수단에 함께 반영된다 — 이전에는 요청에만 반영하고 명부는 사람이 확인했으나(handoff 26 §3), 실사용 피드백으로 자동 반영으로 바꿨다. 수수료·기본 수단 설정 등 정정과 무관한 값은 그대로 둔다. 그래서 같은 인플루언서의 **다음 요청부터는 정정 값이 나간다.** 명부에 수단이 없거나, 같은 종류가 여럿이라 어느 것인지 못 가리거나, 정정이 명부 수단과 맞지 않는 경우에는 명부를 못 고치고 저희 화면(호출 기록)에 "명부는 확인이 필요해요"로 표시한다. (그쪽 API 동작·응답 형태는 이 변경으로 달라지지 않는다.)
- 저희가 그 뒤 제자리 수정(§3-1)으로 결제 수단을 명부에서 다시 스냅샷하면 정정 표식(`payment_method_correction`)은 `null`로 돌아간다(`revision`은 커진다). 명부가 이미 정정 값이므로 결제 수단 자체는 바뀌지 않는다.

### 요청 본문

```
POST {base}/api/external/settlement/requests/{request_id}/payment-info
Authorization: Bearer <운영키>
Content-Type: application/json
```

| 필드 | 필수 | 타입 | 설명 |
|---|---|---|---|
| `correction_id` | 예 | string(uuid) | 그쪽이 발급한 정정 식별자. **멱등 키이자 회신 상관관계 키** — 반영 뒤 Item의 `payment_method_correction.correction_id`로 되돌아온다. 요청 하나에 한 번만 쓴다(다른 요청에 재사용하면 400 `field: "correction_id"`). |
| `base_source_revision` | 예 | number(정수 ≥ 0) | 정정이 기준한 Item의 `revision`. 저희 현재 값과 다르면 **409 `revision-mismatch`**. |
| `base_source_updated_at` | 예 | string(ISO 8601) | 기준한 Item의 `updated_at`. **형식만 검사하고 판정에는 쓰지 않는다**(정보용·로그용) — 그쪽 자신의 상태 POST도 저희 `updated_at`을 갱신하므로 정확히 일치하기를 요구하면 정상 흐름에서도 거절이 난다. 동시성 판정은 `base_source_revision`으로 충분하다(취소는 `status`, 지급 완료는 `settlement.status`가 따로 막는다). |
| `payment_method` | 예 | object | **바뀐 키만** 담는다(부분 전송). 허용 키 7개: `holder`·`paypal_id`·`email`·`identifier`·`bank`·`branch`·`account`. 값은 문자열(앞뒤 공백 제거, ≤200자). **`type`·`currency`는 보낼 수 없다**(400) — 수단 종류·통화를 바꾸는 것은 다른 의무라 `on_hold` + `note`로 알려 달라. 7개 밖의 키·비어 있는 객체도 400. **비우기(`null` 또는 `""`)는 선택 항목만**: `branch`, 그리고 PayPal의 `email`·`paypal_id`(둘 중 하나는 남아야 한다). 그 외 키를 비우면 400. |
| `operator` | **예** | `{ id: string, name: string }` (각 ≤100자) | 정정을 실행한 그쪽 담당자. 상태 POST(§6)에서는 선택이지만 정정은 사람이 하는 일이라 **필수** — 없으면 400 `field: "operator"`. 저희 화면과 명부 활동 기록에 "정산 쪽이 수취 정보를 고쳤어요 · {name}"로 보인다. |
| `reason` | 예 | string, ≤500자 | 정정 사유(자유 텍스트). 저희 화면·활동 기록에 그대로 보인다. |
| `idempotency_key` | 아니오 | string(≤200자) \| null | 재전송 안전 키. 같은 요청 안에서 같은 키가 이미 반영됐으면 **다시 적용하지 않고 최초 결과를 돌려준다**(아래 규칙 3). `correction_id`만으로도 멱등이므로 없어도 된다. |

본문에 저희가 모르는 **최상위** 키가 있으면 무시한다(§6과 같다). 단 `payment_method` 안의 모르는 키는 400이다 — "정정했다고 믿은 값이 조용히 버려지는 것"이 가장 나쁜 실패라서다.

### 적용 규칙 (아래 순서대로 판정)

| 순서 | 조건 | 결과 |
|---|---|---|
| 1 | 본문 모양 오류(위 표의 필수·형식·허용 키·비울 수 없는 키) | **400** `{ "error": "...", "field": "..." }` — 첫 번째로 걸리는 필드 하나. `payment_method` 안의 키는 `field: "payment_method.account"`처럼 점으로 잇는다 |
| 2 | `request_id`가 uuid가 아니거나 존재하지 않음 | **404** `{ "error": "..." }` |
| 3 | 같은 `correction_id`가 이 요청에 이미 반영됨, 또는 같은 `idempotency_key`가 이 요청에 이미 반영됨 | **200** `{ "applied": true, "correction_id": <최초 반영된 id>, "request": Item }` — **쓰기 없음**(`updated_at`도 그대로). 본문이 달라도 다시 보지 않는다(재전송은 같은 본문이어야 한다는 §6 규칙과 같다). `correction_id`가 **다른 요청**에 이미 쓰인 값이면 **400** `field: "correction_id"` |
| 4 | 저희 `status`가 `"cancelled"` | **409** `{ "code": "request-cancelled", "error": "...", "request": Item }` — 판이 틀려도 취소가 먼저(종점) |
| 5 | `settlement.status`가 `"paid"` | **409** `{ "code": "paid-locked", "error": "...", "request": Item }` — 지급 뒤 수취 정보 정정은 사람이 협의 |
| 6 | `base_source_revision`이 저희 현재 `revision`과 다름 | **409** `{ "code": "revision-mismatch", "request": Item }` — 재전송하지 말고 `request`(최신 Item)의 `payment_method`·`revision`으로 다시 판단해 필요하면 새 `correction_id`로 보낸다 |
| 7 | 바뀐 키가 **현재 수단 종류에 없는 항목**(예: PayPal 수단에 `bank`), 또는 합친 결과가 저희 결제 수단 규칙을 통과하지 못함(이메일 형식, PayPal.me 아이디 형식(영문·숫자·`._-` 3~50자), 은행·계좌번호 비움, PayPal에 이메일·아이디 둘 다 없음, 수취인 80자 초과 등) | **400** `{ "error": "...", "field": "payment_method.bank" \| "payment_method" }` — 행을 읽어야 아는 검증이라 404 뒤에 난다 |
| 8 | 그 외(정상 적용 — 같은 값이어서 바뀐 항목이 0건이어도 적용으로 처리) | **200** `{ "applied": true, "correction_id": "<보낸 값>", "request": Item }` |

- **200 응답에는 다른 200과 달리 `version`이 없다** — 그쪽 파서가 `{ applied, correction_id, request }` 세 키만 엄격히 받기 때문(§8). 409의 `code`는 위 세 가지만 쓴다(그쪽이 엄격 파싱).
- `request`는 §5의 Item(정정 반영 후 최신 상태). `payment_method`에는 합친 결과가 전부(바뀐 키만이 아니라) 들어 있고, `payment_method_correction`에 표식이 있다.
- 반영되면 그 건의 `updated_at`이 갱신돼 **다음 폴링에 다시 내려온다.** `payment_method_correction.correction_id`가 자기 것이면 회신이다 — 담당 해제·재검토 경로를 타지 않는다. `revision`은 그대로이므로 그쪽 outbox에 남아 있던 상태 POST도 그대로 통한다.
- 합친 결과는 저희가 **새 요청을 만들 때와 같은 검사**를 통과해야 한다(규칙 7) — 정정으로 "요청 생성이 막혔을 값"이 들어오는 일을 막는다. PayPal.me 아이디는 `@`·`paypal.me/` 접두어를 떼고 저장한다(새 요청과 같은 정규화).
- 저희는 정정마다 이력(정정 전·후 스냅샷·사유·담당자)을 보관하고, 인플루언서 명부의 활동 기록에 "정산 쪽이 수취 정보 정정 — {항목} {이전} → {이후}"를 남긴다. 이 이력은 이 API로는 내려가지 않는다.

### curl 예시

```bash
curl -sS -X POST "$BASE/api/external/settlement/requests/$REQUEST_ID/payment-info" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "correction_id": "5f2b9c1e-6d3a-4b7c-9e0f-1a2b3c4d5e6f",
    "base_source_revision": 1,
    "base_source_updated_at": "2026-09-21T05:00:00.000Z",
    "payment_method": { "account": "7654321", "branch": null },
    "operator": { "id": "8f2c9e10-1b2a-4c3d-9e4f-000000000001", "name": "정산 담당자" },
    "reason": "계좌번호 마지막 자리 오타, 지점 없음",
    "idempotency_key": "corr-2026-09-21-0001"
  }'
# 200 { "applied": true, "correction_id": "5f2b9c1e-…", "request": { …, "revision": 1, "payment_method": { "type": "bank", "holder": "…", "currency": "JPY", "bank": "…", "account": "7654321" },
#                                                                    "payment_method_correction": { "correction_id": "5f2b9c1e-…", "at": "2026-09-21T05:03:12.481Z", "by_name": "정산 담당자" }, … } }
```

## 7. 상태 값의 뜻

| `settlement.status` | 뜻 |
|---|---|
| `null` | 그쪽이 아직 이 요청을 확인하지 않음 |
| `received` | 정산 접수 |
| `scheduled` | 지급 예정 |
| `paid` | 지급 완료(실제 지급액·시각 확정). 지급 완료(paid) 이후에는 우리 쪽에서도 요청을 취소할 수 없도록 막혀 있습니다 — 되돌려야 하면 사람이 협의합니다. |
| `on_hold` | 보류 — 사유는 `note`에 |
| `cancelled` | 그쪽이 취소 — 수신 시 우리 쪽 요청도 취소 처리되고, 그 작업은 다시 검토 대기로 돌아간다 |

**"수정 요청"에 해당하는 별도 API는 없다.** 요청 내용을 우리 쪽이 다시 확인해야 하면 `status: "on_hold"` + `note`에 사유를 적어 보낸다. 저희가 고치면 같은 요청이 `revision`이 커진 채 `settlement.status: null`로 다시 내려온다(§3-1) — `cancelled`로 보내면 고칠 수 없게 되니 수정 요청에는 쓰지 않는다. 예: `{ "status": "on_hold", "updated_at": "...", "note": "계좌 정보 확인 필요" }`. `note`는 `on_hold`뿐 아니라 어떤 상태에도 함께 보낼 수 있다.

## 8. 버전 관리·문의

- 목록·단건·상태 갱신(200) 응답에는 `"version": 1`이 들어 있다.
- 하위 호환을 깨는 변경은 이 경로를 그대로 두고 새 `/v2` 경로로 낸다. 이 문서·엔드포인트가 예고 없이 모양을 바꾸는 일은 없다.
- 이 API에는 `event_id`나 웹훅이 없다(§1). HMAC 서명도 쓰지 않는다 — 웹훅이 없으므로 필요하지 않다.
- 담당자·연락 채널은 운영 단계에서 별도 안내한다.
- **개정 기록.** 2026-09-01 `payout.gross_krw` 추가 / 2026-09-02 `proof`·`GET …/proof` 추가, 증빙만 최신값(§3-2) / 2026-09-02 요청 생성 사전 차단(RT `proof`·그 외 `reference_url` 필수) / 2026-09-03 PayPay `identifier` 필수, `payment_method` 빈 키 생략 명시 / 2026-09-07 상태 POST `operator` 선택 필드, 모르는 키 무시 명시 / **2026-09-07 제자리 수정(§3-1 개정, `revision` 의미 변경, `revised_at` 추가, 상태 POST `revision` 필수·409 `revision-mismatch`) — 2026-09-08 양쪽 스위치 ON, 전환 완료.** / 2026-09-09 상태 POST `paid_amount_usd` 선택 필드 수용, Item `settlement.paid_amount_usd` 되비침 추가. / 2026-09-09 `paid_amount_jpy`·`paid_currency` 선택 필드 수용(외화는 paid에서만·한 요청에 하나·보낸 것만 갱신), Item `settlement.paid_amount_jpy` 되비침 추가. / **2026-09-14 Item에 `campaign.starts_on`·`campaign.ends_on`(캠페인 기간)·`posted_on`(게시일, RT 외)·`confirmed_on`(RT 확인일) 추가 — 전부 요청 시점 스냅샷, 기존 요청은 현재값으로 백필. 키만 늘었고 기존 키·의미 변화 없음.** / **2026-09-21 `POST …/payment-info`(§6-1) 신설 — 그쪽 09-21 요청 수용. 같은 요청의 `payment_method`만 정정, `revision`·`settlement.*` 불변, 멱등(`correction_id`·`idempotency_key`), 409 코드는 §6과 같은 세 가지. 200 응답은 `{ applied, correction_id, request }`로 `version`이 없다(그쪽 엄격 파서, 이 엔드포인트만의 예외). Item에 `payment_method_correction`(정정 표식)·`influencer.display_name`(명부 표시명, 최신값) 추가 — 키만 늘었고 기존 키·의미 변화 없음.** / **2026-09-22 정정이 고친 항목을 인플루언서 명부(원본)의 해당 수단에도 함께 반영으로 변경(§6-1) — 이전엔 요청에만 반영. 그쪽 API 요청·응답·판정은 불변, 저희 쪽 수신 후 처리만 달라졌다.**

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
      "campaign": { "id": "c1a2...", "name": "8월 캠페인", "starts_on": "2026-08-24", "ends_on": "2026-08-30" },
      "clinic": { "id": "cl01...", "name": "OO클리닉" },
      "influencer": { "id": "in01...", "handle": "sawada_k" },
      "task_type": "rt",
      "category": { "code": "promo-rt", "label": "마케팅비 > X(트위터) > 프로모션" },
      "item": "RT 진행", "purpose": "노출 확대",
      "amount_krw": 30000, "cost_currency": "KRW",
      "payout": { "currency": "JPY", "net": 3000, "fee": { "mode": "grossUp", "percent": 5 }, "fee_amount": 158, "gross": 3158, "rate_krw_per_jpy": 10, "gross_krw": 31580 },
      "deadline": "2026-08-29", "reference_url": null,
      "posted_on": null, "confirmed_on": "2026-08-27",
      "proof": { "url": "https://cb-x-deck.vercel.app/api/external/settlement/requests/3fa85f64-5717-4562-b3fc-2c963f66afa6/proof", "uploaded_at": "2026-08-31T10:12:00.000Z", "uploaded_by": "박구건" },
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

### 9-4. 증빙 이미지 내려받기 (§4-1)

```bash
curl -s \
  -H "Authorization: Bearer $SETTLEMENT_API_KEY" \
  -o proof.png \
  "https://cb-x-deck-staging.vercel.app/api/external/settlement/requests/3fa85f64-5717-4562-b3fc-2c963f66afa6/proof"
```

성공하면 `proof.png`에 이미지 바이트가 그대로 저장된다(`Content-Type` 헤더로 실제 형식을 확인). 증빙이 없거나 요청이 없으면 본문 없이 404다.
