# 정산 요청 제자리 수정(in-place revision) — 설계

브랜치: `cb-koo/payment-api`. 결정: koo 2026-09-07(그쪽 제안 14 수용, 우리 조건은 15번 문안). 그쪽 계약 문장: `docs/api/settlement-external-api.md` §3-1·§5·§6(2026-09-07 개정).
선행: `2026-08-28-settlement-page-design.md`(스냅샷 원칙), `2026-09-01-settlement-partner-result-design.md`(그쪽 결과·차액), `2026-09-02-settlement-required-gate-design.md`(관문).

## 1. 문제와 결정

취소+새 요청 모델은 그쪽 화면에서 "취소 1건 + 신규 1건, 정산코드 2개"로 갈라져 담당자 혼선을 낳았다(09-07 @Qni6F 사건). 그쪽 제안대로 **같은 요청을 제자리에서 고치고 `revision`을 올린다.** 우리 원칙 "돈 값은 요청 시점 확정값"은 **개정 이력 보존**으로 지킨다 — 고치기 전 행을 그대로 이력 표에 남기므로 어느 판의 값이 얼마였는지는 항상 답할 수 있다.

## 2. 전환 스위치

`SETTLEMENT_REVISION_V2=on`(환경 변수, 운영·스테이징 각각). 꺼짐(기본)이면 외부에는 지금과 똑같이 나가고 수정 기능은 화면·API 모두 닫힌다.

| | 꺼짐(전환 전) | 켜짐(전환 후) |
|---|---|---|
| Item `revision` | `status === 'cancelled' ? 1 : 0` | `payment_request.revision` |
| Item `revised_at` | `null` | `payment_request.revised_at` |
| 상태 POST `revision` | 무시 | 필수(없으면 400), 불일치 409 `revision-mismatch` |
| 요청 내역 [고친 값으로 다시 반영] | 없음 | 있음(조건 §4) |
| PATCH action `revise` | 409 `not-enabled` | 동작 |

우리가 먼저 배포(꺼짐) → 그쪽 배포 → 슬랙으로 시각 합의 → 켬. 스위치는 `src/lib/settlementRevisionFlag.ts` 한 곳에서 읽는다(`isRevisionV2()`); 테스트는 env를 바꿔 양쪽을 다 본다.

## 3. 데이터

마이그레이션 048.
- `payment_request.revision int not null default 0`, `revised_at timestamptz`.
- `payment_request_revision`(개정 이력): `id uuid pk`, `request_id uuid not null references payment_request`, `revision int not null`(보관하는 판 번호 = 고치기 **전** 값), `snapshot jsonb not null`(고치기 전 행 전체 — R_SELECT 컬럼 그대로 + 그쪽 결과 필드 + `external_operator_*`), `reason text not null`, `revised_by uuid`, `revised_by_name text not null`, `created_at timestamptz default now()`. `unique (request_id, revision)`.
- 기존 트리거 `payment_request_guard_paid`는 그대로 — `external_status = 'paid'`면 status 변경 차단. 수정 차단은 앱(§4)에서.

## 4. 수정 규칙 (`settlementStore.reviseRequest`)

입력: `id`, `expectedRevision`, `reason`(필수, 취소 사유와 같은 규칙), `edits { category, deadlineOn, referenceUrl }`, `member`.

한 트랜잭션, `for update`. 판정 순서 → 실패 종류:
1. 스위치 꺼짐 → `not-enabled`
2. 없음/uuid 아님 → `not-found`
3. `status = 'cancelled'` → `cancelled`
4. `external_status = 'paid'` → `paid-locked`
5. `revision !== expectedRevision` → `revision-mismatch`(우리 화면 둘이 동시에 고치는 것 방지)
6. `task_id null`(작업 삭제) → `task-gone`
7. 작업의 현재 `influencer_id !== payment_request.influencer_id` → `influencer-changed`(재배정은 취소+새 요청)
8. 작업이 후보 조건을 잃음(게시 취소·비용 삭제) → `not-candidate`
9. `computeCandidate`(현재 작업·인플루언서·설정·오늘) + `effectiveIssues(cand, edits)`에 🔴 → `blocked`(문구 그대로)
10. 통과 → (a) 현재 행을 `payment_request_revision`에 `revision = 현재값`으로 보관 (b) 행 갱신: 돈 필드 전부(amount_*·fee·fee_amount·rate·payout_currency·gross_krw는 045 생성 컬럼이라 자동)·`payment_method` 스냅샷·`category`·`category_option_id`·`deadline_on`·`reference_url`·`revision = +1`·`revised_at = now()`·`updated_at = now()`, 그쪽 결과 리셋: `external_status, paid_amount_krw, paid_at, external_note, external_updated_at, external_operator_* = null`, `diff_ack_* = null`. **유지**: `external_id`, `sent_at`, `created_at`, `requester_*`, `proof`(라이브라 무관). (c) `influencer_log` `payment_revised` { requestId, revision, before: { amountGross, payoutCurrency }, after: {...}, reason }.

같은 값으로 고치기(변경 없음)도 허용한다 — 그쪽 재검토를 다시 태우는 용도.

## 5. 외부 API 변화 (`settlementExternal`)

- `toExternalItem`: `revision`·`revised_at`을 §2 표대로. `ExternalItem.revision` 타입 `number`.
- `parseStatusUpdate`: `revision` 정수(≥0) 선택 파싱 → `StatusUpdate.revision: number | null`. 스위치 켜짐이면 라우트가 없을 때 400 `field: 'revision'`.
- `applyExternalStatus`: 스위치 켜짐 + `u.revision !== null` + 불일치 → `{ kind: 'conflict', code: 'revision-mismatch' }`. 판정 순서: not-found → **revision-mismatch** → stale → request-cancelled → paid-locked → 적용. 라우트는 409 + `request: Item`.
- 호출 기록 문구(`externalLogCopy`): conflict `revision-mismatch` → "그 사이 고쳐진 요청이라 거부했어요 — 그쪽이 최신 내용으로 다시 보내요".

## 6. 화면 (요청 내역)

- `RequestRow` 펼침에 **[고친 값으로 다시 반영]**: 조건 = 스위치 켜짐 ∧ `status === 'requested'` ∧ `externalStatus !== 'paid'`. 옆 도움말 "프로필·캠페인에서 고친 값을 이 요청에 반영해요. 정산 쪽에는 같은 건의 수정으로 전달돼요."
- `ReviseDialog`: 열리면 `GET /api/settlement/requests/{id}/revision-preview`로 **지금 값과 고쳤을 때 값**을 나란히(금액·수수료·송금액·결제 수단·분류·마감·링크, 바뀐 줄 강조). 분류·마감·참고 링크는 창 안에서 편집(검토 대기 행과 같은 컨트롤·같은 🔴 표시). 사유 필수. 🔴가 남으면 [반영] 비활성 + 이유. 확인 → `PATCH … { action: 'revise', expectedRevision, reason, edits }`.
- 결과 토스트 "2판으로 반영했어요 — 정산 쪽이 다시 검토해요". 실패 사유는 §4 종류별 사용자 문구(`paid-locked` "이미 지급 완료돼 고칠 수 없어요 — 금액 정정은 정산 쪽에 요청해요", `influencer-changed` "인플루언서가 바뀐 작업이라 취소 후 새로 요청해야 해요" 등).
- 배지(`settlementDisplay`): `requested`일 때 `revision > 0`이면 "요청됨 · 2판 M/D"(revised_at). title "고쳐서 다시 보낸 요청이에요 — 정산 쪽이 다시 검토 중".
- 펼침에 **개정 이력** 블록: `GET /api/settlement/requests/{id}/revisions` → "1판 ¥8,000 → 2판 ¥8,421 · 9/7 12:50 · 박구건 · 수수료 재설정 · 그쪽 메모 '수수료 추가해서…'(전태정)". 이력이 없으면 블록 없음.
- 취소된 요청·지급 완료 요청에는 버튼 없음(이력 블록은 있으면 보임).

## 7. 검증

- 순수: `toExternalItem` 스위치 양쪽 / `parseStatusUpdate` revision / `settlementDisplay` 배지.
- 실 DB(`settlementStore.test.ts`): reviseRequest 판정 10단계 각 1건 · 이력 행·스냅샷 값 · 리셋/유지 필드 · 같은 값 재반영 · applyExternalStatus revision-mismatch(스위치 켜짐)·무시(꺼짐) · 라우트 400/409.
- 스테이징: 스위치 켠 채 @Qni6F 시나리오 재연(보류 → 수수료 변경 → 다시 반영 → 그쪽 received/scheduled) — 그쪽 스테이징과 함께.
- 업데이트 소식: "정산 요청을 취소하지 않고 고칠 수 있어요"(전환 후 배포 시점에 올림 — 스위치 꺼진 배포에서는 화면 변화가 없으므로 그때 쓰지 않는다).

## 8. 범위 밖

`paid` 이후 정정(그쫉 paid→paid 유지) · 그쪽 미러 내부 전이 · 개정 이력의 외부 노출 · 알림.
