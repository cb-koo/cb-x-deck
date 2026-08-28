# 정산 프로덕트 연동 API — 설계 (2026-08-28)

브랜치 `cb-koo/payment-api`(main 9622b85 = 정산 페이지 배포 직후). 선행 스펙: `2026-08-28-settlement-page-design.md`(이하 "정산 스펙"). 그쪽 요구 원문: `~/Downloads/0828-API협의사항.md`(그쪽 용어 "소스" = 우리 cb-x-deck, "우리" = 협찬 비용 관리 프로덕트 — 이 문서에선 **"그쪽"**).

## 0. 한 줄 정의

우리가 만든 결제 요청(`payment_request`)을 그쪽이 **가져가고**(폴링 GET), 그쪽에서 바뀐 처리 상태·실제 지급액을 우리가 **받아**(POST) 요청 내역과 캠페인 배지에 보여준다. 우리가 원본, 그쪽은 읽기 전용 미러. 연동 개발·QA는 새로 만드는 **스테이징**(별도 DB·별도 배포)에서 한다.

## 1. 왜

정산 스펙은 "저장 + 우리 화면 확인"까지였고 `sent_at`·`external_id`·지급완료 상태 자리를 비워 뒀다. 그쪽 프로덕트가 인플·클리닉별 집계와 결제 처리를 맡기로 확정됐으므로 그 자리를 채운다. 담당자 입장에서 달라지는 것: **요청을 만든 뒤 "정산에서 어디까지 처리됐는지"가 화면에 보인다.** 정산 쪽으로 보내는 버튼은 생기지 않는다.

## 2. 결정 이력 (koo, 2026-08-28 브레인스토밍)

| # | 결정 | 이유 |
|---|---|---|
| 1 | **진짜 스테이징 신설**(Supabase 프로젝트 + Vercel 프로젝트 각 1개) + **가짜 데이터 시드** | 외부 개발자가 붙는 첫 연동 — "가장 안정적이고 정확한 것". 프로덕션 복사는 인플 계좌·PayPal 유출 위험이라 제외. 대안(테스트 키 샌드박스·is_test 행)은 실 흐름을 못 검증하거나 화면 오염 |
| 2 | **폴링 GET + API Key만**, 웹훅 없음 | 요청은 취소 외 불변이고 마감이 주 금요일 — 분 단위 지연이 업무에 무의미. outbox·재시도·HMAC 운영을 안 짊어진다. 웹훅은 필요가 확인되면 2차 |
| 3 | 그쪽 상태·실지급액 **전부 표시** + **지급 완료 건은 우리 쪽 취소를 구조적으로 차단** | 지출 확정 데이터 보호(그쪽 4-3). 그쪽 '취소' 수신은 우리 요청도 취소 처리해 재요청 가능하게 |
| 4 | 수정 요청 알림은 **별도 API 없이 상태 변경(보류) + 사유 한 줄**로 | 우리 요청은 수정이 없어 "수정 요청" = "지금 못 나가요 + 이유" = 보류. 받는 문이 하나면 양쪽 구현·합의 절반. 슬랙 멘션은 그쪽 몫 |
| 5 | Slack ID는 **요청자 이메일 송신 + `member.slack_id` 컬럼** 둘 다 | 그쪽이 이메일로 Slack 조회 가능하지만 슬랙 가입 이메일이 다른 사람 대비. 컬럼은 SQL로 채움, 화면은 나중 |

## 3. 스테이징 환경

### 3-1. 구성

| 층 | 프로덕션 | 스테이징(신설) |
|---|---|---|
| DB | Supabase `cb-x-deck`(ref `xdwtehjlxsnntsuizxba`, 싱가포르) | Supabase **`cb-x-deck-staging`** — 같은 조직(`jlsetstofdcgpahulhjh`), 싱가포르 |
| 앱 | Vercel `cb-x-deck` → cb-x-deck.vercel.app | Vercel **`cb-x-deck-staging`** → cb-x-deck-staging.vercel.app (Production 환경 — Preview 배포 보호에 걸리지 않게) |
| 로그인 | Google OAuth + clinicbridge 도메인 게이팅(`isAllowedUser`, 코드) | 같은 Google OAuth 클라이언트 재사용, Supabase 스테이징의 콜백 URI만 추가. 도메인 게이팅은 코드라 자동 |
| 외부 API 키 | `SETTLEMENT_API_KEY` 운영값 | 같은 변수명, **다른 값** |
| 외부 서비스 키(X API·Anthropic·Exa·short.io·LANDING_EVENTS_SECRET) | 있음 | **같은 값** — 동작을 동일하게(비워 두면 어느 기능이 왜 안 되는지 헷갈림). 사용은 QA 때만 |
| Storage 버킷 | 원고 이미지 첨부용 | 셋업 스크립트가 같은 이름으로 생성(마이그레이션은 버킷을 만들지 않는다) |
| Data API | 비활성(anon 키 노출 차단) | 콘솔에서 동일하게 비활성 |

### 3-2. 스크립트·명령

- `scripts/apply-migrations.sh [env파일]` — 첫 인자 기본 `.env`. `npm run migrate:staging` = `bash scripts/apply-migrations.sh .env.staging`. `.env*`는 gitignore.
- `scripts/deploy-staging.sh` — **링크 파일에 의존하지 않고** `VERCEL_ORG_ID`·`VERCEL_PROJECT_ID`를 스테이징 값으로 고정해 `npx vercel@58.9.1 --prod --yes`. 엉뚱한 프로젝트 배포 사고를 구조로 막는다(`cb-x-deck-vercel-link-trap`). 프로덕션 배포 절차는 기존 그대로.
- `scripts/setup-staging.ts` — Storage 버킷 생성(없으면). 멱등.
- `scripts/seed-staging.ts`(`npm run seed:staging`) — §3-3.
- `scripts/smoke-external-api.ts` — §9.

### 3-3. 가짜 데이터 시드

- **안전장치(구조):** `.env.staging`의 `PGHOST`(또는 `SUPABASE_URL`)에 스테이징 프로젝트 ref가 들어 있지 않으면 첫 줄에서 종료. 프로덕션에는 돌 수 없다.
- **내용**(모두 `seed_` 접두어): 클라이언트 3(가짜 클리닉명) · 인플루언서 6(PayPal·PayPay·일본 계좌·한국 계좌 + 수수료 grossUp/fixed 예외, 식별값은 명백히 가짜) · 멤버 2(`seed_a@example.com`류) · 캠페인 2(방문협찬 1·일반 1) · 게시 완료+비용 있는 작업 ~10 · 결제 요청 6(요청 4·취소 2). 요청은 **실제 `createRequests`로 생성**(계산 로직이 그대로 검증되게).
- **멱등:** 재실행 시 `seed_` 행을 FK 순서로 지우고 다시 만든다. 우리 팀이 스테이징에 로그인해 만든 데이터는 건드리지 않는다.
- 핸들이 `seed_`로 시작하므로 실제 X 계정 조회가 일어나지 않는다.

### 3-4. koo 콘솔 작업(1회)

① Supabase 조직 플랜 확인(Free면 1주 무활동 시 정지 → Pro 권장, 프로젝트 추가 ≈ $10/월) ② 스테이징 프로젝트의 Google 제공자 켜기(기존 클라이언트 ID·시크릿) ③ Google Cloud 콘솔 OAuth 클라이언트에 `https://<staging-ref>.supabase.co/auth/v1/callback` 추가 ④ Data API 비활성. 프로젝트 생성·Vercel 프로젝트·env 등록은 CLI로 가능(구현 단계에서 수행).

### 3-5. 이후 규칙

머지 전 **스테이징에 migrate + deploy → koo QA → 프로덕션.** 기존 "빌드 후 127.0.0.1로 프로덕션 DB QA"를 대체한다.

## 4. 데이터 모델 — 마이그레이션 041 (멱등, `if not exists`)

### 4-1. `payment_request` 추가 컬럼 — 스냅샷은 그대로, 외부 상태는 옆 칸

| 컬럼 | 뜻 | 제약 |
|---|---|---|
| `external_status text` | 그쪽 상태 `received`(접수) `scheduled`(지급예정) `paid`(완료) `on_hold`(보류) `cancelled`(취소). **null = 그쪽이 아직 안 봄** | check 5값 |
| `paid_amount_krw int` | 실제 지급 원화 확정치 | |
| `paid_at timestamptz` | 실제 지급 시각 | |
| `external_note text` | 사유 한 줄(보류 사유·차액 설명·취소 이유) | ≤ 500자(check `char_length`) |
| `external_updated_at timestamptz` | **그쪽이 찍은 변경 시각** — 이보다 오래된 변경은 무시(순서 보장) | |
| `influencer_id uuid → influencer(id) on delete set null` | 인플 UUID 스냅샷(개명 뒤에도 조인 가능). 생성 시 저장, 기존 행은 `lower(handle)`로 백필 | |
| `category_option_id text` | 요청 때 고른 분류 옵션의 안정 키(`promo-rt` 등, 사용자 추가 옵션은 uuid 문자열). 기존 행은 null | |
| `sent_at`(기존) | **새 뜻: 그쪽이 첫 상태를 보낸 시각 = 도달 확인.** 폴링 모델엔 "보낸 시각"이 없다 | 첫 수신 때 1회 |
| `external_id`(기존) | 그쪽 건 ID(상태 POST에 동봉, 선택) | |

- check `payment_request_paid_fields`: `external_status is distinct from 'paid' or (paid_amount_krw is not null and paid_at is not null)`.
- 인덱스 `idx_payment_request_updated on (updated_at, id)` — 폴링 커서.

### 4-2. 지급 완료는 종점 — 트리거

`before update` 트리거 `payment_request_guard_paid`: `old.external_status = 'paid' and new.status <> old.status`이면 `raise exception 'paid-locked'`. 스토어 `cancelRequest`도 같은 조건을 미리 판정해 `'paid-locked'`를 돌려주지만(화면 문구용), 트리거는 다른 쓰기 경로가 생겨도 뚫리지 않는 마지막 벽. 함수·트리거는 `create or replace` + `drop trigger if exists`로 멱등.

### 4-3. 그쪽 취소 수신 = 우리 취소 처리

`status='cancelled'`, `cancelled_at=now()`, `cancelled_by=null`, `cancelled_by_name='정산 프로덕트'`, `cancel_reason = note ?? '정산에서 취소'`. 작업은 다시 검토 대기에 나타난다(기존 partial unique index가 재요청 허용). 활동 기록 `payment_cancelled`(actor 없음 → `authorId null`).

### 4-4. `member.slack_id text`

nullable. 값은 SQL로 채움. 화면 없음.

### 4-5. `influencer_log` 이벤트 추가 `payment_paid`

제약 재생성(`drop constraint if exists` + `add … not valid`, 040 관례). payload `{ requestId, amountGross, currency, taskType, paidAmountKrw }`. 문구 `지급 완료 · ¥3,158 → 실지급 29,700원`. 접수·지급 예정·보류는 타임라인에 남기지 않는다(배지로 충분).

### 4-6. `updated_at` 규칙

우리 취소·외부 상태 반영 모두 `updated_at = now()`를 찍는다(트리거 없음 — 스토어가 수동 갱신하는 기존 관례). 그래야 그쪽 다음 폴링에 "바뀐 것"으로 흘러간다.

### 4-7. 만들지 않는 것

API 키 테이블(단일 상대 → 환경 변수) · outbox · 상태 변경 이력 테이블(결정 4 — 마지막 값만) · `revision` 컬럼(`updated_at`+`status`로 충분, 페이로드에서 파생).

### 4-8. 042 — ID 스냅샷·non-null

외부 API가 이미 `influencer.id`·`clinic.id`·`category.code`를 non-null로 약속했으니(`docs/api/settlement-external-api.md`) DB도 그렇게 만든다. (a) `payment_request`의 `client_id`·`campaign_id`·`influencer_id` FK를 떼어 평범한 uuid 컬럼으로 — 참조가 지워져도(`client_name`·`influencer_handle`처럼) 값이 그대로 남는 진짜 스냅샷이 된다. `task_id` FK만 남긴다 — 다른 세 ID는 그쪽이 조인·집계에 쓰는 식별자라 삭제 후에도 반드시 남아야 하지만, `task_id`는 우리 앱 안에서 조인·딥링크 용도라 작업이 지워지면 그 포인터도 null로 비는 게 맞다(가리킬 작업 자체가 더는 없어 보존할 스냅샷도 없음). (b) 레거시 행의 `category_option_id`는 최신 설정 행의 `sendAs`로 역매치, 실패하면 `settlementSettings.ts` 기본 3종으로 폴백해 백필. (c) 세 컬럼 모두 guarded `alter … set not null`(매치 안 된 행이 남으면 그 컬럼만 nullable로 남기고 마이그레이션은 항상 성공). 생성 시점 검증(`createRequests`)도 `client_id`·`influencer_id`가 null이면 저장을 거절하고, 화면 신호등(`assessReadiness`)이 `no-client` blocked 이슈로 클릭 전에 미리 보여준다.

## 5. 송신 API — 그쪽이 가져가기

### 5-1. 인증 (공통)

`Authorization: Bearer <SETTLEMENT_API_KEY>`. `src/lib/externalAuth.ts`의 `bearerAuthorized(req, envName)` — env 비어 있으면 **닫힌 API**(항상 401), 길이 확인 후 `timingSafeEqual`, 실패는 401 본문 없음. 기존 `landing-events` 라우트의 인라인 함수를 이 헬퍼로 교체(동작 동일). 모든 응답 `Cache-Control: no-store`.

### 5-2. 엔드포인트

- `GET /api/external/settlement/requests?cursor=&limit=` — `(updated_at, id)` 오름차순. `limit` 기본 100, 최대 500(초과는 500으로 클램프). 첫 호출은 `cursor` 없이. 응답 `{ version: 1, items: Item[], next_cursor: string | null, has_more: boolean }`. `next_cursor` = 마지막 item의 커서(items가 비면 요청에 쓴 cursor 그대로, 첫 호출이면 null) — 그쪽은 **항상 이 값을 저장**해 다음 호출에 쓴다. `has_more = items.length === limit`이면 즉시 다음 페이지, 아니면 다음 주기에.
- `GET /api/external/settlement/requests/{request_id}` — 단건. 없거나 uuid 아님 → 404 `{ error }`.
- 커서 = `base64url("<updated_at epoch µs>:<id>")`. 해석 실패 → 400 `{ error: 'cursor', field: 'cursor' }`. ISO가 아니라 정수 마이크로초로 인코딩해 반올림으로 한 건 빠지는 일을 막는다. 조회 조건 `(updated_at, id) > (ts, id)` 행 비교.

### 5-3. Item 모양 (snake_case, 그쪽 체크리스트 용어 — 금액은 분리 그대로)

```jsonc
{
  "request_id": "uuid", "revision": 0,            // revision: 0 요청됨 / 1 취소됨 — 우리 원본의 변경 횟수. 정렬·중복 판정은 updated_at으로
  "status": "requested" | "cancelled",
  "created_at": "ISO", "updated_at": "ISO",
  "cancelled": { "at": "ISO", "by_name": "모에카", "reason": "…" } | null,
  "task_id": "uuid|null",
  "campaign": { "id": "uuid|null", "name": "…" },
  "clinic":   { "id": "uuid|null", "name": "…" },  // 우리 client. 이름 불일치는 그쪽이 id로 매핑
  "influencer": { "id": "uuid|null", "handle": "sawada_k" },   // id는 핸들이 바뀌어도 유지, handle은 요청 시점 표기
  "task_type": "post" | "quoteRt" | "rt" | "visit",
  "category": { "code": "promo-rt|null", "label": "마케팅비 > X(트위터) …" },
  "item": "…", "purpose": "…",
  "amount_krw": 30000,                 // 우리 기준 원화(환율 출처 = 우리 설정값, 요청 시점 스냅샷). "잠정"이 아니라 우리 확정값
  "cost_currency": "KRW" | "JPY",
  "payout": { "currency": "JPY", "net": 3000, "fee": { "mode": "grossUp", "percent": 5 } | { "mode": "fixed", "amount": 165 } | null,
              "fee_amount": 158, "gross": 3158, "rate_krw_per_jpy": 10 },   // gross = 실제 송금액 = 양식 '금액'
  "deadline": "2026-08-29", "reference_url": "…|null",
  "payment_method": { "type": "paypal", "holder": "…", "currency": "JPY", "email": "…", "paypal_id": "…", "identifier": "…", "bank": "…", "branch": "…", "account": "…" },  // 있는 키만
  "requester": { "name": "모에카", "email": "…|null", "slack_id": "U…|null" },   // 멤버 아닌 요청자는 email·slack_id null
  "note": "",
  "settlement": { "status": "paid|null", "paid_amount_krw": 29700, "paid_at": "ISO|null", "note": "…|null", "updated_at": "ISO|null", "external_id": "…|null" }  // 그쪽이 보낸 값의 되비침
}
```

`payment_method`의 카멜 키(`paypalId`)는 스네이크로 바꾼다. `payer`/`cc`는 **제공하지 않는다**(우리 데이터가 아닌 그쪽 설정값).

### 5-4. 직렬화는 한 함수

`toExternalItem(row, joins)` — GET 목록·GET 단건·POST 응답이 전부 이 함수를 쓴다. 두 곳이 다른 모양을 낼 수 없다.

## 6. 수신 API — 그쪽 상태·실제 금액 받기

### 6-1. 엔드포인트

`POST /api/external/settlement/requests/{request_id}/status` — 건별(그쪽 상태 변경은 담당자 액션 단위. 일괄은 "일부 실패" 의미론이 따라온다). 인증 §5-1.

본문:
```
status           received | scheduled | paid | on_hold | cancelled    필수
updated_at       그쪽 서버가 찍은 ISO 8601 변경 시각                     필수
note?            ≤ 500자
paid_amount_krw? 정수 ≥ 0   ┐ status = paid 면 둘 다 필수
paid_at?         ISO 8601   ┘
external_id?     ≤ 100자
```

### 6-2. 적용 규칙 (한 트랜잭션, `select … for update`)

| 순서 | 상황 | 처리 |
|---|---|---|
| 1 | id가 uuid 아님·없음 | 404 `{ error: '요청을 찾을 수 없어요' }` |
| 2 | `updated_at` ≤ 저장된 `external_updated_at` | **적용 안 함**. 200 `{ applied: false, reason: 'stale', request }`. 늦게 온 옛 변경·재시도 중복을 여기서 흡수(멱등) |
| 3 | 우리 `status = 'cancelled'`이고 들어온 status ≠ `cancelled` | 409 `{ error: '이 요청은 취소됐어요 — 다시 가져가 확인해 주세요', code: 'request-cancelled' }` (지급 사고 방지) |
| 4 | 저장된 `external_status = 'paid'`이고 들어온 status ≠ `paid` | 409 `{ error: '이미 지급 완료된 요청이에요', code: 'paid-locked' }` |
| 5 | `paid` → `paid` | 정정으로 적용(금액·시각·note·external_id) |
| 6 | `cancelled` 수신(우리 status = requested) | §4-3 취소 처리 + 외부 컬럼 갱신 + 로그 `payment_cancelled` |
| 6' | `cancelled` 수신(우리 status = cancelled) | 외부 컬럼만 갱신(ack) |
| 7 | `paid` 수신(첫) | 외부 컬럼 갱신 + 로그 `payment_paid` |
| 8 | received·scheduled·on_hold | 외부 컬럼 갱신 |
| 공통 | 첫 수신(`sent_at is null`) | `sent_at = now()` |
| 공통 | 적용 시 | `external_*` 갱신, `updated_at = now()` |

응답 200 `{ applied: true, request: Item }`. 400 `{ error, field }`(한 필드씩 — `landingEvent` 파서 관례, 한국어 문구). 401 본문 없음.

### 6-3. 그쪽에 요구하는 것(문서에)

- `updated_at`은 실제 변경 시각(서버 시각). 실패 시 **같은 본문 그대로 재전송**(멱등).
- 409를 받으면 그 건을 다시 GET해 미러를 맞춘다.
- 폴링에서 `status: cancelled`를 보면 지급을 중단하고 자기 상태를 취소로(우리가 `지급 예정` 상태의 요청을 취소할 수 있다).

## 7. 화면

### 7-1. 원칙 — 상태 표시는 한 자리, 파생값 하나

`src/lib/settlementDisplay.ts`(순수) `displayStatus(row)` → `{ key, label, tone, date, detail }`. 요청 내역 배지·상태 필터·캠페인 작업 표 배지·활동 기록이 전부 이 함수를 쓴다(UX 원칙 4).

| 우리 · 그쪽 | key | 라벨 | tone |
|---|---|---|---|
| requested · null | `requested` | `요청됨 8-28` | blue(기존 `bg-x-blue/10 text-x-blue-text`) |
| requested · received | `received` | `정산 접수 8-29` | blue |
| requested · scheduled | `scheduled` | `지급 예정` | blue |
| requested · on_hold | `on_hold` | `보류 · {note 앞 20자…}` | warn(`bg-amber-50 text-amber-700` — 신호등 🟡 톤) |
| requested · paid | `paid` | `지급 완료 8-30` | done(`bg-emerald-50 text-emerald-700` — 🟢 톤) |
| cancelled · * | `cancelled` | `취소됨 8-29` | gray(기존) |

날짜는 `external_updated_at`(없으면 `created_at`), 취소는 `cancelled_at`. `kstMonthDay`.

### 7-2. 요청 내역 (`RequestRow`, `RequestList`)

- 접힌 줄: 상태 배지 라벨만 바뀐다. 둘째 줄 끝에 지급 완료면 `실지급 29,700원 (요청 30,000원, −300)`; 차이 0이면 `실지급 30,000원`.
- 펼침 `<dl>`에 `정산` 항목 1개(11항목 아래, 만든 사람 위):
  - 없음: `아직 정산 쪽에서 확인 전이에요`
  - 접수/지급 예정: `정산 접수 · 8-29 09:12` / `지급 예정 · 8-29 09:12` (+ `· 메모: {note}` 있으면)
  - 보류: `보류 · 8-29 09:12 · {note 전문}`
  - 완료: `지급 완료 · 8-30 14:10 · 실지급 29,700원 (요청 30,000원, −300)` (+ `· 메모: {note}`)
  - 그쪽 취소: 기존 취소 줄이 `취소 · 정산 프로덕트 · 8-29 · {사유}`로 자연히 표시.
- 취소 버튼: `paid`면 버튼 대신 문장 `지급 완료된 요청은 취소할 수 없어요 — 정산 담당자에게 알려 주세요`. 서버 `paid-locked` 409 같은 문구.
- 상태 필터: `전체 · 진행 중(요청됨·접수·지급 예정) · 보류 · 지급 완료 · 취소됨` — `displayStatus().key`로 그룹.

### 7-3. 캠페인 작업 표 배지 (`TaskTable.tsx`)

같은 함수·같은 라벨: `정산 요청됨 8-28`(기존 접두어 유지) → `정산 접수` → `지급 예정` → `지급 완료 8-30` / `정산 보류 — 확인 필요`(warn) / `취소됨`. 클릭은 기존 딥링크. `settlementByTaskIds`가 `externalStatus`·`externalNote`·`externalUpdatedAt`·`cancelledAt`도 돌려주고 `CampaignTaskItem.settlement` 타입을 그만큼 넓힌다.

### 7-4. 인플루언서 활동 기록

`payment_paid` 문구 §4-5. 그쪽 취소는 기존 `정산 요청 취소 · ¥… — 사유`.

### 7-5. 넣지 않는 것

정산 탭 요약 카운트·사이드바 알림 점(사용자 2~5명, 배지로 충분 — 필요 확인 시) · 상태 변경 이력 표 · 정산 쪽으로 보내는 버튼.

### 7-6. UX 원칙 체크

① 내부어 비노출(external_status·on_hold·stale) ② 취소 불가 이유를 그 자리에 문장으로 ③ 실지급은 차이 해석까지 ④ 라벨은 서버값 파생·화면 계산 없음 ⑤ 기술값 없음 ⑥ 비용 액션 없음.

## 8. 모듈 경계 / 파일

| 파일 | 역할 |
|---|---|
| `migrations/041_payment_external.sql` | §4 |
| `src/lib/externalAuth.ts` (+test) | Bearer 시크릿 비교 헬퍼. `landing-events` 라우트가 이걸 쓰도록 교체 |
| `src/lib/settlementExternal.ts` (+test) | 순수: `encodeCursor`/`decodeCursor`, `parseStatusUpdate(body)`, `toExternalItem(row, joins)` |
| `src/lib/settlementDisplay.ts` (+test) | 순수: `displayStatus`, 필터 그룹, 실지급 차이 문구 |
| `src/lib/settlementStore.ts` | `PaymentRequestRow`에 외부 필드 + `influencerId`·`categoryOptionId` 추가, `R_SELECT` 확장, `createRequests`가 두 컬럼 저장, `cancelRequest` → `'paid-locked'` 추가 + 내부 `cancelInTx` 공유, 신설 `listForExport(sql, cursor, limit)`, `getForExport(sql, id)`, `applyExternalStatus(sql, id, update)` |
| `src/lib/campaignTaskStore.ts` | `settlementByTaskIds` 확장 |
| `src/lib/campaignStore.ts` | `CampaignTaskItem.settlement` 타입 확장 |
| `src/app/api/external/settlement/requests/route.ts` | GET 목록 |
| `src/app/api/external/settlement/requests/[id]/route.ts` | GET 단건 |
| `src/app/api/external/settlement/requests/[id]/status/route.ts` | POST 상태 |
| `src/app/api/settlement/requests/[id]/route.ts` | `paid-locked` → 409 문구 |
| `src/app/settlement/RequestRow.tsx`, `RequestList.tsx` | §7-2 |
| `src/app/campaigns/TaskTable.tsx` | §7-3 |
| `src/app/influencers/Timeline.tsx`, `src/lib/influencerStore.ts`(이벤트 타입) | `payment_paid` 문구·타입 |
| `scripts/apply-migrations.sh`, `deploy-staging.sh`, `setup-staging.ts`, `seed-staging.ts`, `smoke-external-api.ts` | §3, §9 |
| `docs/api/settlement-external-api.md` | 그쪽 전달 문서(§5·§6 + 상태 뜻 + 폴링 절차 + §6-3 + `payer/cc` 없음 + 키 회전 = env 교체·재배포) |
| `src/content/updates.ts` | §10-3 |

## 9. 테스트

실 DB, 접두어 `tstl`+pid, `after()` FK 순서 정리(기존 관례). 단일 파일은 `node --import tsx --env-file-if-exists=.env --test <file>`.

- **순수**: 커서 인코딩 왕복·잘못된 문자열 거부 / `parseStatusUpdate` — 필수 누락·잘못된 status·paid인데 금액 없음·시각 형식·note 501자·external_id 101자 / `toExternalItem` — 금액 분리·fee null·멤버 없는 요청자·settlement 전부 null / `displayStatus` 표 6행 + 필터 그룹 + 차이 문구(±·0).
- **스토어**: `listForExport` — 같은 초에 갱신된 3건이 limit 2로 두 페이지에 빠짐없이 / `applyExternalStatus` 규칙표 2·3·4·5·6·6'·7·8 + `sent_at` 1회 / 트리거 — 스토어 우회 `update … set status='cancelled'`가 paid 행에서 실패 / 041 백필 — 핸들 일치 행에 `influencer_id` 채워짐 / `createRequests`가 `influencer_id`·`category_option_id` 저장 / `settlementByTaskIds`가 외부 필드 반환 / `cancelRequest` paid → `'paid-locked'`.
- **인증**: `externalAuth` — env 없음·키 다름·길이 다름·정확히 일치.
- **스모크(스테이징)**: `scripts/smoke-external-api.ts BASE_URL KEY` — 목록(첫 페이지)→커서 이어받기→단건→`received` POST→같은 본문 재전송(`applied:false`)→`paid` POST(금액 없음 400)→`paid` 정상→`scheduled` POST(409 paid-locked)→틀린 키 401. 결과를 표로 출력.
- 라우트 하네스는 없다(기존과 동일) — 라우트는 얇게, 판정은 lib에.

## 10. 운영·릴리스

### 10-1. 환경 변수

`SETTLEMENT_API_KEY` — 프로덕션·스테이징 각각 `openssl rand -hex 32`. 그쪽엔 1:1 채널로 전달, 문서에 값 없음. 회전 = 값 교체 + 재배포(무중단 이중 키 없음 — 필요해지면).

### 10-2. 순서

041 스테이징 적용 → 스테이징 배포 → 셋업·시드 → 스모크 → 그쪽에 스테이징 URL·키·문서 전달 → 그쪽 개발 → koo QA(스테이징) → 041 프로덕션 적용 → `updates.ts` → main 머지 → 프로덕션 배포 → 운영 키 전달.

### 10-3. 업데이트 소식 2건

- `개선` — 「정산 요청이 어디까지 처리됐는지 배지로 볼 수 있어요」: 접수·지급 예정·지급 완료·보류가 요청 내역과 캠페인 작업 표에 표시, 지급 완료면 실지급 금액과 차이, 보류면 정산팀 사유, 지급 완료된 요청은 취소 불가.
- `내부` — 「정산 프로그램이 결제 요청을 가져가고 처리 상태를 알려 주는 연결 통로를 만들었어요」: 담당자가 하는 일은 그대로(요청 만들기까지), 그쪽이 알아서 가져감 · 연습용 서버(스테이징)가 생겨 앞으로 새 기능은 실데이터에 손대지 않고 먼저 확인.

## 11. 그쪽 체크리스트 대응표

| 항목 | 대응 |
|---|---|
| 0 전제 | 일치 — 우리 원본·그쪽 미러 |
| 1-1 REST+JSON | §5·§6 |
| 1-2 웹훅+폴링 백업 | **폴링만**(결정 2). 웹훅은 필요 확인 시 2차 |
| 1-3 API Key + HMAC | Bearer 키. HMAC은 웹훅이 없어 불필요 |
| 1-4 스테이징 | §3 |
| 1-5 버저닝 | 봉투 `version: 1`, 파손 변경은 `/v2` 경로 |
| 2 request_id·influencer_uuid·handle·clinic·amount+currency·amount_krw·payment_method·deadline·category·item·purpose·reference_url·updated_at/revision | §5-3 전부. `amount_krw`는 잠정이 아니라 우리 확정값(환율 = 우리 설정 스냅샷) |
| 2 requester/payer/cc Slack ID | requester만 `{name, email, slack_id}`(결정 5). **payer/cc 없음** |
| 3 인플 엔티티 | 우리가 UUID 발급 주체, 개명 시 유지, "Supabase 마스터" = 우리 influencer 테이블 |
| 4-1 수정 전파 | 수정 없음, 취소만 → 폴링 `status: cancelled` |
| 4-2 삭제 | 없음 |
| 4-3 완료 건 보호 | 트리거 + 409(결정 3) |
| 5-1 상태 수신 | §6 |
| 5-2 실지급액 저장·표시 | 저장·표시(결정 3) |
| 5-3 수정 요청 형태 | 보류 + note(결정 4). 슬랙은 그쪽 |
| 5-4 이중 표기 기준 | 요청 원본 = 우리, 처리 상태 = 그쪽. 우리 화면은 그쪽 상태를 그대로 비춤 |
| 6-1 event_id | 폴링 = `request_id + updated_at`; 역방향 멱등 = 그쪽 `updated_at` |
| 6-2 재전송·주기 | 웹훅 없음. 폴링 주기 권장 5분(그쪽 결정) |
| 6-3 백필 | 범위 밖(슬랙 756건은 우리 DB에 없음) |
| 6-4 담당·채널 | 운영 결정, 코드 밖 |

## 12. 범위 밖

웹훅 push · 요청 생성/수정 API(우리가 원본) · 상태 이력 표 · `slack_id` 편집 화면 · 알림 점/카운트 · 프로덕션 → 스테이징 데이터 복사 · CI 자동 배포 · 이중 API 키.
