# 실질 비용(수수료 포함 원화) 보이기 — 설계 (2026-09-01)

브랜치 `cb-koo/payment-api`(main 8bdc728). 선행: `2026-08-28-payment-api-design.md`(정산 프로덕트 연동), `2026-08-28-settlement-page-design.md`(정산 페이지).

## 0. 한 줄 정의

**송금 수수료까지 포함한 "실제로 나가는 원화"를 우리 화면에서도 볼 수 있게 한다.** 지금은 그 값이 외부 API(`payout.gross_krw`)로만 나가고 우리 쪽에는 어디에도 보이지 않는다.

## 1. 왜 (koo, 2026-09-01)

- 실질 비용 파악 필요가 제기됨. 엔화 정산 건의 수수료 포함 금액을 원화로 관리해야 한다.
- 인플루언서마다 **수수료를 우리(CB)가 부담하는 사람과 인플루언서가 부담하는 사람이 섞여 있다**(운영: 인플 부담 53 · CB 비율 5% 6 · CB 고정 ¥165 5). 이 설정은 이미 프로필 결제 수단에 있고 계산에도 반영되지만, **명부 목록에서는 보이지 않아** 한 명씩 프로필을 열어야 한다.
- 캠페인단은 **계획**이 중요하고, 실지급액은 정산단에서 볼 요소다(koo). 그래서 이번 범위는 계획 금액에 수수료를 얹은 값까지이고, 그쪽이 보낸 실지급액(`paid_amount_krw`) 집계는 **다음 작업**이다.
- 예산 입력 방식은 **바뀌지 않는다.** 예산은 지금처럼 원화 한 값이고, **지출을 보는 기준만 두 가지**로 고른다(예산 초과가 제약을 만들지는 않으므로 현황 파악이 목적).

## 2. 지금 상태 (조사 결과)

| 항목 | 현재 |
|---|---|
| 수수료 계산 | `settlementCalc.computeMoney(cost, payoutCurrency, fee, rate)` — 순수 함수, 이미 있음. `fee` 없으면 `feeAmount = 0` |
| 인플별 수수료 설정 | `influencer.payment_methods[].fee` — 프로필 거래 탭에서 편집. 비어 있으면 화면에 `인플 부담`으로 명시 |
| 실지출 원화 | 외부 API `payout.gross_krw`만. **저장 안 함 · 화면 없음 · 집계 없음** |
| 요청 내역 금액 | `¥3,158 (3,000 + 158 수수료)` + `원화 30,000원` — **이 원화는 단가(수수료 제외)인데 라벨이 그냥 "원화"라 실지출로 오해할 수 있다** |
| 예산 화면 지출 | **이미 원화 환산**(`toKrw`, 1엔=10원 상수 `JPY_TO_KRW`). 출처는 `campaign_task.cost` + `campaign_influencer_cost.extra_costs` — **결제 요청과 무관하고 수수료가 들어갈 자리가 없다** |
| 인플 명부 목록 | `InfluencerRow`에 `payment_methods` 없음 — 목록 조회 SQL이 안 가져온다 |

## 3. 결정

### 3-1. `gross_krw`는 생성 컬럼으로 저장한다

계산으로만 두면 SQL 합계를 못 내고, 일반 컬럼으로 두면 원본(`amount_gross`·`payout_currency`·`rate_krw_per_jpy`)과 갈릴 수 있다. **생성 컬럼**이 둘을 모두 푼다 — 스테이징에서 실제로 확인했다:

- 값을 직접 쓰려 하면 `ERROR: column "gross_krw" can only be updated to DEFAULT`로 **DB가 거부**한다 → 손으로 어긋나게 만들 수 없다
- 원본을 바꾸면 자동 재계산(환율 10→11로 바꾸니 20,000 → 22,000)
- `sum(gross_krw)`로 집계·인덱스 가능

### 3-2. 캠페인단 두 기준은 **같은 대상, 다른 계산**

| 모드 | 세는 대상 | 계산 |
|---|---|---|
| **단가**(기본, 지금과 동일) | 캠페인 작업 비용 + 추가 비용 | 통화별 합 → 원화 환산(1엔=10원) |
| **수수료 포함** | **같은 대상** | 작업마다 그 인플의 기본 결제 수단 수수료를 얹어(`computeMoney`) 원화로 |

"정산 요청된 것만"으로 하지 않는다 — 아직 요청 안 한 작업이 빠져 계획 대비 숫자가 뚝 떨어지고 담당자가 오해한다.

**예상치임을 화면이 밝힌다.** 결제 수단이 없는 인플은 수수료를 구할 수 없으므로 단가만 넣고 `수수료 미확인 N건은 단가만 넣었어요`로 표시한다(운영 인플 150 중 결제 수단 64).

### 3-3. 예산 입력은 그대로

예산은 원화 한 값. 토글은 **지출·잔액 계산만** 바꾼다. 두 벌 관리는 하지 않는다 — 어느 게 진짜인지 흐려진다.

### 3-4. 정산단(실지급) 집계는 이번 범위 밖

그쪽이 보낸 `settlement.paid_amount_krw` 기준 집계는 별도 작업(koo).

## 4. 데이터 모델 — 마이그레이션 045 (멱등)

```sql
-- 045: 실제 송금액의 원화 환산을 생성 컬럼으로. 손으로 채우는 사본이 아니라 DB가 계산한다(원본과 갈릴 수 없다).
-- bigint + ::bigint 캐스팅 — int4 상한(약 21억) 우려를 여기서 없앤다.
alter table payment_request add column if not exists gross_krw bigint
  generated always as (
    case when payout_currency = 'KRW' then amount_gross::bigint
         else amount_gross::bigint * rate_krw_per_jpy end
  ) stored;
create index if not exists idx_payment_request_gross_krw on payment_request (gross_krw);
```

`createRequests`의 insert 컬럼 목록에 이 컬럼을 넣으면 안 된다(생성 컬럼은 직접 쓸 수 없다). 현재 코드는 컬럼을 명시적으로 나열하므로 그대로 두면 된다.

## 5. 바뀌는 것

### 5-1. `payment_request` 행 타입·조회

`PaymentRequestRow`에 `grossKrw: number` 추가, `R_SELECT`·`RRow`·`toRequest`에 반영.

### 5-2. 외부 API — 값은 그대로, 출처만 이동

`settlementExternal.grossKrw(r)` 계산을 없애고 `r.grossKrw`를 그대로 싣는다. **응답 JSON은 한 글자도 바뀌지 않는다**(그쪽 코드 영향 없음). 기존 테스트가 그대로 통과해야 한다.

### 5-3. 요청 내역 — 실지출 표시와 라벨 정정

`RequestRow.tsx` 펼침의 금액 항목:

```
금액        ¥3,158 (3,000 + 158 수수료)
            단가 30,000원 · 환율 10원 = 1엔        ← 기존 '원화 30,000원'을 '단가'로 정정
            실지출 31,580원                        ← 신설(수수료 포함)
```

수수료가 0이면 두 값이 같으므로 `실지출` 줄을 넣지 않는다(같은 숫자를 두 번 보이면 "왜 두 개지?"가 된다).

### 5-4. 인플 명부 — 정산 조건 배지·필터

- `InfluencerRow`에 `settlement: { currency: 'KRW'|'JPY'; fee: PaymentFee | null } | null` 추가. 목록 조회 SQL이 `payment_methods`에서 **기본 수단 하나만** 뽑아 싣는다(전체 배열을 목록에 싣지 않는다 — payload 절약).
- 목록 행에 배지: `¥ 엔화 · CB 5%` / `¥ 엔화 · CB ¥165` / `₩ 원화 · 인플 부담` / 결제 수단 없으면 `정산 조건 없음`(연한 회색).
- 필터: `정산 통화`(전체·원화·엔화) · `수수료 부담`(전체·CB 부담·인플 부담·미등록). 기본값은 둘 다 **전체** — 미등록 86명이 목록에서 사라지지 않게.

### 5-5. 예산 화면 — 지출 기준 토글

`clientBudget.ts`:
- `MonthSpend`에 `feeKrw: number`(수수료 합, 원화)와 `feeUnknown: number`(수수료를 못 구한 작업 수) 추가.
- `MonthRow`에 `spentWithFeeKrw: number`·`feeUnknown: number` 추가. `remaining`은 화면이 고른 기준으로 계산하도록 `remainingOf(budget, 고른 지출)`를 화면에서 부른다(두 값을 미리 다 담아 두고 화면이 고른다 — 서버 왕복 없음).

`campaignStore.spendByMonth`가 수수료를 계산하려면 작업별 인플 결제 수단이 필요하다 → 기존 `totalsFor`의 SQL에 `left join influencer i on lower(i.handle) = lower(t.influencer_handle)`를 더해 `payment_methods`를 가져오고, 행마다 `getDefaultPaymentMethod` + `computeMoney`로 수수료를 구한다. **추가 비용(`campaign_influencer_cost.extra_costs`)에는 수수료를 얹지 않는다**(인플에게 송금하는 돈이 아니다).

화면(`BudgetPanel.tsx`):
```
지출 기준:  [ 단가 ]  [ 수수료 포함 ]        ← 기본 '단가'
지출 3,053,000원   잔액 1,947,000원 남음
송금 수수료 53,000원이 포함된 금액이에요 · 수수료 미확인 3건은 단가만 넣었어요
```
- 토글은 **클라이언트 예산 화면에만** 둔다. 캠페인 상세는 이미 정보가 빽빽하고, 캠페인 단위 실질 비용은 이번 요구가 아니다(koo: 캠페인단은 계획이 중요).
- 도움말 문구(`budgetTipText`)에 기준 설명을 한 줄 더한다.

## 6. UX 원칙 체크 (AGENTS.md)

① 라벨은 사용자 말 — `단가`/`수수료 포함`/`실지출`/`인플 부담`. `gross_krw`·`grossUp` 같은 내부어 노출 없음 ② 행동 전 기대 — 토글 아래 한 줄로 무엇이 포함됐는지 ③ 판단까지 — `수수료 53,000원 포함`·`미확인 3건은 단가만` ④ 라벨-값 일치 — 기존 `원화 30,000원`이 실지출로 오해되던 것을 `단가`로 정정하는 것이 이번 작업의 일부 ⑤ 기술 값은 맥락으로 — 환율은 숫자 옆에 뜻 ⑥ 비용 유발 액션 없음.

## 7. 테스트

- 045: 생성 컬럼에 직접 쓰기가 거부되는지, 원본 변경 시 재계산되는지, 원화·엔화 각각 값이 맞는지(실 DB).
- `settlementExternal`: 기존 테스트가 **변경 없이** 통과(응답 모양 불변 확인).
- `clientBudget`: 같은 데이터에서 `단가`/`수수료 포함` 두 값이 각각 맞는지, `feeUnknown` 집계, 수수료 0일 때 두 값이 같은지.
- `spendByMonth`: 인플 부담·CB 비율·CB 고정·결제 수단 없음 네 경우가 섞인 캠페인에서 합계가 맞는지.
- 인플 목록: 기본 수단만 실리는지, 결제 수단 없는 인플이 `null`인지.

## 8. 범위 밖

정산단 실지급(`paid_amount_krw`) 집계 · 캠페인 상세의 수수료 포함 표시 · 예산 입력 방식 변경 · 결제 수단 없는 인플의 수수료 추정.
