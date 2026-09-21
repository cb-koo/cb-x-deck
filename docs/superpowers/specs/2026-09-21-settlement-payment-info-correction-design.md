# 정산 쪽 수취 정보(결제 수단) 정정 회신 — 설계

결정: 2026-09-21(그쪽 09-21 요청 수용, 우리 답은 handoff 26번 문안). 그쪽 계약 문장: `docs/api/settlement-external-api.md` §6-1(신설)·§3-1 예외 문단·§5 `payment_method_correction`·`influencer.display_name`.
선행: `2026-09-07-settlement-in-place-revision-design.md`(제자리 수정·revision 의미), `2026-08-27-influencer-payment-method-design.md`(결제 수단 검증 규칙), `2026-09-01-settlement-partner-result-design.md`(그쪽 결과 필드).
그쪽 원문: 그쪽 저장소 `docs/etc/20260921_결제정보정정_API_회신_소스팀.md`(미러 구현 완료·전송 OFF 대기).

## 1. 문제와 결정

그쪽 정산 담당자가 지급 직전에 계좌번호·PayPal 아이디 오타를 발견하면, 현행 계약(§3-1)으로는 우리에게 알려 취소 + 새 요청(정산코드 2개, 이력·집계 단절)을 만들거나 `on_hold`로 돌려보내 우리가 명부를 고치고 제자리 수정을 해야 했다. 그쪽은 정정을 **로컬에서 즉시 유효**하게 반영하고 지급을 진행하며 우리에게는 **비동기로 회신**하는 흐름을 이미 구현했고, 그 회신을 받을 엔드포인트를 요청했다.

**결정: 같은 요청의 `payment_method`(스냅샷)만 바꾸는 `POST …/payment-info`를 연다.** 우리 원칙 "돈 값은 요청 시점 확정값"은 유지된다 — 바뀌는 것은 돈이 아니라 받을 곳이고, 정정 전·후를 별도 이력 표에 남긴다.

### 1-1. `revision`을 올리지 않는다

제자리 수정(09-07)의 `revision`은 "우리가 요청을 고쳐 돈 값이 재계산됐고 그쪽 처리는 `received`부터 다시"라는 신호다(계약 §3-1 규칙 3, 그쪽은 revision 증가 = settlement 리셋으로 처리). 정정은 리셋을 동반하지 않으므로 같은 신호를 쓰면 안 되고, 올리면 그쪽 outbox에 이미 쌓인 상태 POST(옛 revision)가 전부 409 `revision-mismatch`가 된다. 대신 **별도 표식 `payment_method_correction`**으로 그쪽이 자기 정정의 회신을 알아본다(그쪽 §3-5).

따라서 `payment_request_revision`(unique `(request_id, revision)`)에 넣을 수 없고 정정 이력은 새 표(§3)에 둔다 — 멱등 판정도 이 표가 한다.

### 1-2. `base_source_updated_at`은 판정에 쓰지 않는다

그쪽 목 서버는 revision과 `updated_at` 둘 다 정확히 일치해야 통과시키지만, 우리 `payment_request.updated_at`은 **그쪽 자신의 상태 POST**로도 갱신된다 — `received`를 보낸 뒤 정정을 보내면 그쪽이 들고 있던 `updated_at`은 이미 옛것이다. revision만 본다: 취소는 `status`, 지급 완료는 `external_status`가 따로 막으니 빠지는 경우가 없다. 형식(ISO)만 검사한다(400).

### 1-3. 명부는 건드리지 않는다

정정은 "이번 지급 건"의 수취 정보다. 인플루언서 명부의 `payment_methods`는 우리 원본 데이터라 사람이 확인해 고친다 — 화면(요청 내역 결제수단 줄·명부 활동 기록·수정 대화상자)이 "정산 쪽이 고쳤어요, 명부도 확인"을 띄운다. 다음 요청에 옛 값이 다시 나갈 수 있음은 계약 §6-1에 적어 그쪽도 안다.

## 2. 계약 요약 (정본은 계약 문서 §6-1)

- 요청: `correction_id`(uuid, 필수) · `base_source_revision`(필수) · `base_source_updated_at`(필수, 정보용) · `payment_method`(바뀐 키만, 7키: holder·paypal_id·email·identifier·bank·branch·account; `type`·`currency` 불가) · `operator { id, name }`(**필수** — 상태 POST와 달리) · `reason`(필수, ≤500) · `idempotency_key`(선택).
- 판정 순서: 본문 모양 400 → 없는 요청 404 → 멱등 재전송 200(쓰기 없음; 다른 요청에 쓴 correction_id는 400) → 취소 409 `request-cancelled` → 지급 완료 409 `paid-locked` → 판 불일치 409 `revision-mismatch` → 수단 종류에 없는 키·결제 수단 규칙 위반 400 → 적용 200.
- 200 `{ applied: true, correction_id, request: Item }` — **`version` 없음**(그쪽 파서가 세 키만 엄격히 받는다; 이 엔드포인트만의 예외, 계약 §8에 기록).
- Item 추가 키: `payment_method_correction { correction_id, at, by_name } | null`, `influencer.display_name`(명부 최신 표시명, 그쪽 §3-7).

## 3. 데이터 (마이그레이션 056)

- `payment_request.payment_method_correction jsonb` — 마지막 정정 표식 `{ correction_id, at, by_id, by_name, reason }`. 화면·그쪽 Item의 출처. `reviseRequest`가 결제 수단을 명부에서 다시 스냅샷할 때 `null`로 되돌린다(정정이 사라졌으므로).
- `payment_request_payment_correction` — `id`(= 그쪽 `correction_id`, PK), `request_id`(FK cascade), `idempotency_key`, `base_revision`, `patch`(그쪽이 보낸 키만), `before`/`after`(스냅샷), `reason`, `operator_id`/`operator_name`, `created_at`. partial unique `(request_id, idempotency_key) where idempotency_key is not null`.
- `influencer_log_event_type_check`에 `payment_corrected` 추가(055 목록 + 1). 번호가 056인 이유: 캠페인 v2의 `055_campaign_task_cancel.sql`이 먼저 main에 들어왔다. 앞 파일(048·055)의 제약은 이미 `not valid`라 재실행 안전.

## 4. 적용 규칙 (`settlementStore.applyPaymentMethodCorrection`)

한 트랜잭션, `for update`. 결과 유니언: `'not-found'` | `{ kind: 'replayed' | 'applied', correctionId, row }` | `{ kind: 'conflict', code }` | `{ kind: 'invalid', field, error }`(행을 읽어야 아는 검증 — 라우트가 400으로 매핑).

1. 멱등 조회: `id = correction_id` 또는 `(request_id, idempotency_key)` 일치 행이 있으면 → 다른 요청의 것이면 `invalid(correction_id)`, 같은 요청이면 `replayed`(쓰기 없음, 최초 id 반환).
2. `status = cancelled` → `request-cancelled`. `external_status = paid` → `paid-locked`. `base_revision ≠ 노출 revision`(`isRevisionV2() ? revision : 0`) → `revision-mismatch`.
3. `mergePaymentMethodCorrection(before, patch)`(순수, `settlementPaymentCorrection.ts`): 수단 종류에 허용된 키만(paypal: holder·email·paypal_id / paypay: holder·identifier / bank: holder·bank·branch·account) — 아니면 `invalid(payment_method.<key>)`. null은 키 제거(파서가 `branch`·`email`·`paypal_id`만 허용). 합친 값을 `parsePaymentMethodInput`(새 요청과 같은 검사·정규화)에 통과시킨다 — 실패면 `invalid(payment_method)`. diff는 camelCase 필드명(`PAYMENT_FIELD_LABEL` 키).
4. 이력 insert → `payment_request` update(`payment_method`, `payment_method_correction`, `updated_at = now()`) → `influencer_log` `payment_corrected`(payload: `PaymentLogPayload` + `byName`·`fields`).

바뀐 항목 0건(같은 값)도 적용으로 처리한다 — 재전송·정규화 차이는 흔하고, 그쪽에는 표식이 필요하다.

## 5. 화면

- 요청 내역(`RequestRow`) 결제수단 줄 아래: "정산 쪽이 수취 정보를 고쳤어요 · {by_name} · {시각} — {사유} / 이 요청에만 반영됐어요 — 인플루언서 명부의 결제 수단도 같은지 확인해 주세요".
- 수정 대화상자(`ReviseDialog`): 표식이 있으면 "다시 반영하면 결제 수단이 명부의 값으로 되돌아가요 — 명부가 고친 값과 같은지 먼저 확인" 경고(막지는 않는다).
- 명부 타임라인(`Timeline`): `payment_corrected` → "정산 쪽이 수취 정보 정정 · {by_name}: {항목} {이전} → {이후} — {사유} (명부는 그대로예요)".
- UX 원칙 점검: 라벨은 이득/사실을 사용자 말로(메커니즘 용어 없음), 결과에 다음 행동(명부 확인)을 붙였다.

## 6. 테스트

- 순수: `settlementPaymentCorrection.test.ts`(파서 필드 단위 거절·병합·수단 종류 검사), `settlementExternal.test.ts`(표식·display_name 되비침, 키 집합 기준선 +1).
- DB(스테이징): `settlementStore.test.ts` — 정정 뒤 수취 정보만 바뀌고 revision·금액·그쪽 결과 유지, 표식·이력·활동 기록, 멱등(쓰기 없음), 다른 요청 correction_id 재사용 400, 정정 뒤 같은 revision의 상태 POST 통과, 판정 순서, reviseRequest가 표식을 지움. `payment-info/route.test.ts` — 401/400/404 모양, 200 세 키(version 없음), 409 `code` + `request`.

## 7. 전환 순서

우리 스테이징 배포(056 + 엔드포인트) → 스테이징 공동 점검(그쪽 전송 ON → 정정 → 폴링 재유입 상관관계 → 재전송 200 → 409 확인) → 우리 운영 배포 → "운영 수신 준비 완료" 통지 → **그쪽 운영 전송 ON**. 우리 쪽 수신에는 스위치가 없다(받아도 해가 없다).

## 8. 남긴 것

- 명부 결제 수단 자동 갱신 — 넣지 않음(§1-3). 화면 안내로 사람이 처리. 반복 마찰이 확인되면 "정정 값을 명부에도 반영" 버튼을 검토(UX 원칙 6).
- 정정 이력 화면(정정 전·후 비교) — 이력 표에는 있으나 화면은 없음. 필요해지면 `RevisionHistory` 옆에 붙인다.
