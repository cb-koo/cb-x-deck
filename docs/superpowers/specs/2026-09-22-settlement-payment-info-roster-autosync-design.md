# 2026-09-22 · 정산 수취정보 정정 — 명부 자동 반영 + "지급 정보 변경" 알림

> 선행: `2026-09-21-settlement-payment-info-correction-design.md`(정정 회신 수신 = 056). 이 스펙은 그 위에 **명부(원본) 자동 반영**과 **모아 보는 변경 알림**을 얹는다.

## 배경 / 문제

정산 프로덕트가 보낸 수취정보 정정은 지금 **해당 요청 건에만** 반영되고 **인플루언서 명부(`influencer.payment_methods`)는 일부러 건드리지 않는다**(handoff 26 §3 — "명부는 원본이라 사람이 확인"). 실사용 결과:

1. 정정이 와도 명부가 옛 값이라, 담당자가 **인플루언서를 한 명씩 열어 수동으로** 고쳐야 한다. 안 고치면 **같은 인플루언서의 다음 요청에 옛 값(오타)이 다시 나간다.**
2. 어떤 인플루언서의 지급 정보가 바뀌었는지 **한곳에서 볼 방법이 없다.**

실사용 피드백으로 자동화 승격 조건 충족(AGENTS.md UX 원칙 6). handoff 26 §3의 결정을 뒤집는다.

## 목표

- **G1.** 정정 수신 시 명부의 기본 결제수단도 **자동으로** 같은 값이 되게 한다 — 단 원본을 잘못 덮지 않는 **안전 조건**을 둔다.
- **G2.** "지급 정보 변경"을 **인플루언서를 하나씩 안 열어도 한곳에서** 모아 본다. 형식: `@handle · 수취인명 a→b · 명부 반영됨/확인 필요`.

## 비목표

- API 와이어(요청·응답 형태) 변경 없음 — 그쪽이 보내는 정정은 그대로. 이번 변화는 **우리 쪽 수신 후 처리**에만 있다.
- 수단 종류(PayPal↔계좌)·통화 변경 자동화 아님(종전대로 on_hold + note).
- 알림에 읽음/안읽음(확인함) 상태 없음 — **호출 기록 탭과 같은 정책**(롤링 목록). 별도 알림 상태 저장 안 함.

## 설계

### §1. 명부 자동 반영 — "고친 항목만" 병합(patch merge)

**사용자 결정(2026-09-22): 정정이 고친 항목만 명부 수단에 병합한다("결제 정보만 수정").** 요청 스냅샷 전체(`after`)로 덮으면 명부에서만 바뀐 값·통화·수수료·기본 여부까지 되돌아가므로(리뷰 지적), `after`가 아니라 **patch를 명부 수단의 현재 값에 얹는다**.

정정이 성공 적용될 때(`applyPaymentMethodCorrection`의 `kind:'applied'`), 같은 트랜잭션에서 `planRosterOverwrite(list, before, patch)`(순수, `settlementPaymentCorrection.ts`)가:

1. **대상 고르기:** 같은 종류 수단이 하나면 그것 / 여럿이면 요청 스냅샷 `before`의 식별값(paypal `email??paypalId`, bank `account`, paypay `identifier??holder`)과 일치하는 하나(유일할 때만) / 같은 종류가 없으면 명부 기본 수단.
2. **병합:** `mergePaymentMethodCorrection(toMethodSnapshot(target), patch)`로 patch 키만 얹는다 — 안 고친 항목·통화는 명부의 현재 값 그대로, `fee`·`memo`·`isDefault`·`id`는 보존(update op이 id·isDefault를 유지, fee·memo는 명시 복원). 요청 생성과 같은 검사(`parsePaymentMethodInput`)를 통과한 값만.

명부 쓰기는 `applyPaymentOp`(update) 경로. **명부 변경은 활동 기록에 따로 남기지 않는다**(§2 — payment_corrected 한 줄로 합침).

**`확인 필요`(반영 못 함) 사유 셋:** `no_method`(명부에 수단 없음) · `ambiguous`(같은 종류 여럿인데 일치가 유일하지 않음 — 엉뚱한 수단 오손 방지) · `invalid`(patch 병합이 검사 실패, 예: 같은 종류가 없어 기본 수단에 얹었으나 종류 불일치). 호출 기록에 사유별 문구로 `명부는 확인이 필요해요(...)`.

> reviseRequest 상호작용: 반영 후엔 명부가 이미 정정 값이므로, "고친 값으로 다시 반영"이 더 이상 옛 값으로 되돌리지 않는다 → §4에서 안내 문구를 바로잡는다.

### §2. "지급 정보 변경" 알림 — 정산 → `호출 기록` 탭 안에

**위치 확정: 정산 → `호출 기록` 탭.** 사용자가 이 탭을 가리키며 "이렇게 하고 싶다" 함(별도 화면 신설 아님). 정정 POST는 이미 이 탭에 기록되지만 **문구가 깨져 나온다**(아래) — 그 자리를 고쳐 정정을 사람 말로 띄운다. 동작(롤링·읽음구분 없음·행 펼치기·필터)은 이 탭 그대로.

**지금의 결함:** `describeExternalCall`의 `applied` 분기는 상태 POST 전제라 `'{상태}'을 보냈어요 — 반영했어요`로 찍는다. 정정 POST는 `sentStatus`가 없어 `''을 보냈어요 — 반영했어요`처럼 **빈 문구**가 된다. 정정 경로용 분기를 추가한다.

**표시(호출 기록 표 그대로 — 내용 / 대상 요청 / 응답):**
- 내용: `수취 정보를 정정했어요 — 명부에도 반영했어요` (거의 항상. 명부에 수단이 없을 때만 `— 명부는 확인이 필요해요`)
- 대상 요청: `@nako_beauty · 인용RT · 백수약국 · ¥4,000` (기존 `describeTarget` 그대로)
- 행 펼치면: `수취인명 羽生朝美 → ASAMI HANYU`, 사유·담당자, 명부 반영/미반영 사유
- (선택) 필터에 `지급 정보 변경만` 추가 — 폴링 GET 소음 속에서 "한번에 확인"이 되게. `거부된 것만` 체크박스와 같은 방식.

**구현 갈래:**
1. `describeExternalCall`(순수)에 `path.endsWith('/payment-info')` 분기 추가. 명부 반영 여부는 기록 시 `detail`에 인코딩(`roster-applied` / `roster-skip:{no_method|ambiguous|invalid}`)해 문구를 가른다.
2. 펼침 상세의 from→to는 `body`(정정 patch 원문) 또는 `payment_request_payment_correction` 조인으로. **새 테이블 없음.**
3. 각 줄 클릭 → 해당 인플루언서 **거래 정보 탭 딥링크**(호출 기록 행이 지금은 딥링크가 없다면 이 유형만 추가).

### §3. 데이터 모델 — 마이그레이션 057

- `payment_request_payment_correction`에 컬럼 2개 추가:
  - `roster_applied boolean not null default false` — 이 정정으로 명부를 실제로 덮었는지.
  - `roster_skip_reason text` — 반영 못 한 사유 `no_method`·`ambiguous`·`invalid` 중 하나(§1). 알림의 "확인 필요" 문구 출처.
- `influencer_log_event_type_check`: **056이 마지막 파일이라 `not valid` 없이 넣었으므로**, 057은 목록에 값 추가 시 **`not valid`를 붙인다**(036·048·055·056 주석 관례). 단 명부 자동 반영을 기존 `payment_method_changed`로 기록하면 event_type 추가가 없을 수 있음 — 그 경우 constraint 손대지 않음. (payload 표식 방식으로 확정 예정, §열린질문 1.)

### §4. 부수 변경(문구·표식)

- `ReviseDialog.tsx`(라인 118~121): "다시 반영하면 명부 값으로 되돌아가요" 경고 → 자동 반영 후 상황에 맞게 수정("명부는 이미 정정 값이라 되돌아가지 않아요" 취지).
- `RequestRow.tsx`(라인 66~69): "이 요청에만 반영됐어요 — 명부도 같은지 확인" 안내 → "명부에도 반영됐어요"(또는 확인 필요) 파생 표시.
- `Timeline.tsx`(payment_corrected, 라인 78~): "(명부는 그대로예요)" 문구를 반영/미반영 파생으로 교체.

### §5. 계약 / handoff 갱신

- `docs/api/settlement-external-api.md` §6-1: "명부는 건드리지 않는다"를 "명부 기본 수단도 조건부 자동 반영"으로 갱신(§3-1 관련 문구 포함).
- `docs/api/settlement-handoff/27_우리_명부자동반영_통지_...md` 신설 — 정산팀에 정책 변경 + 조건 통지.
- `src/content/updates.ts`: `개선` 항목. "쓰던 방식이 바뀐 것은 반드시 적는다."

### §6. 기존 7건 롤아웃

이미 200으로 받아 요청엔 반영된 7건(2026-09-21)은, 배포 시 §1 조건으로 명부에 **일괄 반영**(스크립트 또는 배포 후 1회 실행). 조건 불충족 건은 알림에 "확인 필요"로 남는다.

### §7. 테스트

- 순수: `mergePaymentMethodCorrection` 재사용 검증은 기존. **명부 조건부 적용 판정**(divergent/no_default/type_mismatch/applied) 순수 함수로 분리해 단위 테스트.
- 스토어(DB): 정정 적용 시 명부 반영됨 / divergent 시 명부 불변 + skip_reason 기록 / 활동 기록 생성.
- 라우트: 200 응답에 명부 반영 여부가 부수효과로 일어나는지(응답 형태는 불변 — 그쪽 strict 파서).

## 열린 질문

1. ~~명부 반영을 활동 기록에 어떻게 남길지~~ → **확정: 따로 남기지 않는다.** 같은 정정의 `payment_corrected` 한 줄이 결과를 말한다(정정 1건이 두 줄로 보이지 않게). event_type 추가·`payment_method_changed` 별도 줄 모두 없음.
2. ~~알림 위치~~ → **확정: 정산 → 호출 기록 탭**(§2). `지급 정보 변경만` 필터는 넣을지 구현 시 판단(동작 영향 없음).
3. 정정 POST 기록 시 `detail`에 명부 반영 결과를 인코딩(`roster-applied`/`roster-skip:*`)한다 — `applyPaymentMethodCorrection`이 명부 반영 결과를 라우트로 돌려주고, 라우트의 `recordExternalCallSafe(detail=...)`에 실어야 한다. 지금 `detail`은 `replayed`에 쓰이므로 충돌 없게 값 체계 정리.
