# 예산 기간 경계를 넘는 비용 처리 리서치 — "다음 기간에서 당겨쓰기" 정산 표시가 실무에 있는가

작성일: 2026-09-22
대상: cb-x-deck 예산 기간(기간형) 모델 — 캠페인 시작일이 속한 기간이 초과됐을 때, 다음 기간 잔여 예산과 합산해 보여주는 정산 표시가 타당한가
증거 표기: **[인용]** 원문 URL 포함 / **[패턴]** 복수 출처에서 공통 관찰 / **[추측]** 조사자 추론 / **[확인 불가]** 원문 접근 실패

---

## 1. 요약

- **결론부터: "초과분을 다음 기간 예산과 합산해서 보여주는" 방식을 기본(primary) 화면으로 채택한 실사례는 찾지 못했다.** 조사한 실사례들은 대체로 두 극단 중 하나였다 — **(A) 하루 단위로 잘라서 정확히 나누어 붙이거나(일할 계산/proration)**, **(B) 기간 경계와 무관하게 발생 시점 하나에 전액을 귀속시키고 절대 합산하지 않거나(원자적 귀속)**.
- 가장 가까운 광고 플랫폼 사례인 **Google Ads의 "지출 한도(spending limit)"**는 캠페인이 월 경계를 걸치면 **그 달에 실제로 집행된 일수만큼만 잘라서(일할)** 그 달의 한도를 계산한다 — 즉 월 경계에서 자동으로 쪼개는 쪽이다. Meta는 애초에 "월별 한도"라는 개념 자체가 약하고(라이프타임/일일 예산이 기본), 캘린더 월과 무관하게 광고주가 지정한 캠페인 자체 기간을 예산 단위로 쓴다 — 이 역시 "월 경계에서 재조정" 개념이 없다.
- **Stripe 구독 과금**은 기본값이 초 단위 일할 계산(proration)이며, 이는 우리가 찾는 "초과분을 다음 기간과 합산" 방식과는 다르다 — 오히려 "경계를 걸치면 아예 정밀하게 쪼갠다"는 정반대 철학이다. 다만 `proration_behavior=none` 옵션으로 언제든 "쪼개지 않고 한 시점에 전액 귀속"으로 바꿀 수 있게 해뒀다 — 즉 Stripe도 "부분 배분"과 "원자적 귀속" 두 가지만 공식 지원하고, 그 중간(초과분만 이월해 합산)은 지원하지 않는다.
- **가장 근접한 반례 하나를 찾았다**: 에이전시 리텐션 관리 도구 **Productive.io**의 "Retainer Hours Rollover(리텐션 시간 이월)" 기능은 실제로 **미사용분뿐 아니라 초과분(음수)도 다음 기간 예산에 합산**한다 — 우리가 검토 중인 "다음 기간에서 당겨쓰기" 발상과 개념적으로 동일하다. 단, 이 기능은 **① 상위 요금제(Ultimate)에서만 켤 수 있는 옵트인 기능이고, ② 명시적으로 "청구서(invoice)에는 영향을 주지 않는다"고 밝혀, 원래 기간별 숫자(초과 여부)는 그대로 별도로 유지한 채 이 합산 뷰를 "참고용 보조 지표"로만 얹는 구조**다. 즉 실무에 존재하긴 하지만 "기본 표시를 대체하는 것"이 아니라 "옵트인 보조 지표"로 존재한다.
- **회계 원칙(발생주의/대응원칙)**은 이론적으로는 "서비스가 제공되는 여러 기간에 걸쳐 비용을 나눠 인식하라"고 하지만, 이는 원가-수익 간 인과관계가 뚜렷할 때(예: 감가상각)만 해당하며, **인과관계가 불분명하면 "발생 시점에 즉시 전액 비용 처리"가 원칙**이다. 실제로 미국 GAAP(ASC 720-35)은 광고비를 **"집행되는 시점(또는 첫 노출 시점)에 전액 비용 처리"**하도록 명시하고 있어, 인플루언서 캠페인처럼 성격상 "광고비"에 가까운 지출은 회계 표준상으로도 **기간 안분보다 원자적 귀속(발생 시점 전액 인식)이 정석**에 더 가깝다.
- 건설/프로젝트 회계의 **약정원가(committed cost) / 커밋먼트 어카운팅** 관행도 동일한 결을 보인다 — 계약(PO)이 체결된 시점에 그 예산 항목 전체가 해당 시점의 예산에서 즉시 차감(reserve)되며, 계약 이행 기간이 여러 결산기를 걸쳐도 나누지 않는다.
- 종합하면: **"원자적 귀속(시작일이 속한 기간에 전액 귀속) + 초과 시 다음 기간과 자동 합산해 보여주는 방식"은 업계에서 사실상 전례가 없거나 극히 드물고(Productive.io가 유일한 근접 사례이며 그마저도 보조 지표), 실사례 대부분은 "완전 일할 계산" 아니면 "원자적 귀속 후 합산 없이 사람이 해석"** 둘 중 하나였다.

---

## 2. 소스별 상세 근거

### 2-1. 광고 플랫폼 — 월 경계를 걸치는 캠페인의 예산 처리

**Google Ads — 지출 한도(Spending Limit)**
> "If your campaign starts during a calendar month, we'll only take into account the days the campaign was running."
**[인용]** [About spending limits – Google Ads Help](https://support.google.com/google-ads/answer/10486637?hl=en)

- 평균 일일예산 × 30.4(연간 평균 월간 일수)로 월 지출 한도를 계산하는데, 캠페인이 월 중간에 시작하거나 끝나면 **그 달에 실제로 게재된 일수만 반영**해 한도를 다시 계산한다. 즉 캘린더 월 경계에서 **자동으로 일할 쪼개기**를 하는 쪽이며, "이번 달이 초과됐으니 다음 달 한도에서 당겨쓴다"는 개념은 없다. 반대로 하루 지출은 일일예산의 최대 2배까지 허용하고 그 초과분은 "다른 날의 저지출로 상쇄"하는 방식으로, **같은 예산 기간 내부의 일별 변동을 흡수하는 로직은 있지만, 그 로직이 서로 다른 결제/캘린더 기간 사이로 넘어가지는 않는다.** **[인용]** (동일 출처, [평균 일일예산 안내](https://support.google.com/google-ads/answer/6385083?hl=en))
- Google Ads Developers 문서에서도 예산은 캠페인 단위로 설정되고 일별 페이싱 로직이 있지만, "월 예산 초과분을 다음 달 예산에 반영한다"는 서술은 확인되지 않았다. **[확인 불가]** ([Campaign Budgets Overview – Google Ads API](https://developers.google.com/google-ads/api/docs/campaigns/budgets/overview))

**Meta Ads — 캠페인/라이프타임 예산**
- Meta의 예산 개념은 애초에 "달력 월" 단위가 아니라 **광고주가 지정한 캠페인 자체의 시작일~종료일(라이프타임)** 또는 "일일" 단위다. 라이프타임 예산은 그 전체 기간에 걸쳐 Meta 알고리즘이 자체적으로 페이싱하며, "이 캠페인이 몇 개의 달력 월에 걸치는지"와는 무관하게 캠페인 종료 시점까지 총액만 맞추면 된다는 구조다. **[패턴]** (Meta 공식 도움말 발췌 인용은 접근 제한으로 실패 — 아래 참고)
- 공식 Meta Business Help Center 문서(`facebook.com/business/help/481733105308636` "About Campaign Spending Limits")는 이 세션에서 접근이 차단(403)되어 원문 전체 인용을 확보하지 못했다. **[확인 불가]** — 검색 스니펫 수준에서는 "캠페인 지출 한도는 조정 가능한 상한이며 광고 게재에는 영향을 주지 않고, 도달 시 캠페인 내 모든 광고세트가 정지된다"는 서술만 확인됨.
- 시사점: Meta는 Google Ads처럼 "캘린더 월 단위로 재계산"하는 로직 자체가 없다 — **예산 기간의 단위를 아예 캘린더 월이 아니라 캠페인 자신의 기간으로 잡아버려서, "월 경계를 걸치는 문제"를 애초에 구조적으로 회피**한 것에 가깝다. 이는 우리 케이스(클라이언트의 예산 기간과 캠페인 기간이 서로 다른 축이라 어긋날 수 있는 상황)와는 전제가 다르다. **[추측]**

### 2-2. SaaS 빌링 — Stripe의 프로레이션(proration) 철학

> "Proration is where the customer is charged a percentage of a subscription's cost to reflect partial use... If a customer upgrades from a 10 USD monthly plan to a 20 USD option halfway through the billing period, the customer is billed an additional 5 USD."
**[인용]** [Prorations – Stripe Docs](https://docs.stripe.com/billing/subscriptions/prorations)

- Stripe는 **기본값(`proration_behavior=create_prorations`)이 초 단위 프로레이션**이다. 청구 기간 경계를 걸치는 변경(플랜 업그레이드, 수량 변경 등)이 발생하면, "남은 기간에 대한 크레딧"과 "새 조건에 대한 차변"을 그 즉시 정밀하게 나눠 계산한다. **[인용]** (동일 출처)
- 동시에 Stripe는 **`proration_behavior=none`**을 공식 지원해, "쪼개지 않고 다음 청구서에서 정가 전액을 청구"하는 원자적 귀속 방식으로 완전히 전환할 수 있게 한다. **[인용]** (동일 출처) — 즉 Stripe 생태계 안에도 "정밀 일할" vs "원자적 귀속"이라는 두 옵션만 있고, "초과분을 다음 기간과 합산해 순액만 보여주는" 제3의 표시 방식은 공식 기능으로 존재하지 않는다.
- Stripe가 프로레이션을 하는 이유는 명시적 "철학 선언" 문서는 찾지 못했으나, 문서 전반의 논조는 **"고객이 실제로 사용한 만큼만 공정하게 청구한다(정확성)"**는 프레이밍이다 — 이는 구독처럼 **일 단위로 균질하게 소비되는 서비스**(하루하루가 동일 가치)에 최적화된 논리이며, 우리 케이스처럼 "하루 단위로 쪼갤 수 없는 정액 계약(인플루언서 1건 고정비)"에는 애초에 적용 전제가 다르다. **[추측]**

### 2-3. 에이전시/리텐션 관리 도구 — 기간 경계를 걸치는 작업의 처리

**Productive.io — Retainer Hours Rollover (가장 근접한 반례)**
> "you only work 30 hours (billable, approved)... the remaining 10 hours roll over to the next month." / "you work 60 hours in October (out of 50 available/budgeted)... only 30 carry over to November because of the overuse. The negative 10 hours in the Rolled over time column indicate this deficit and reduce the current month's budgeted time." / "The rollover feature doesn't affect invoicing but provides better insight into budget profitability."
**[인용]** [Retainer Hours Rollover – Productive Help Center](https://help.productive.io/en/articles/9902502-retainer-hours-rollover)

- 이 기능은 **미사용분(플러스)뿐 아니라 초과분(마이너스)도 다음 기간 예산에 그대로 합산**한다. 우리가 검토 중인 "8월 -100만원을 9월 예산과 합쳐서 보여준다"는 발상과 메커니즘상 거의 동일하다 — 실무에 존재하는 패턴이 맞다.
- 다만 세 가지 단서가 붙는다: **(1) 옵트인 — Ultimate 요금제에서 "Roll over unused hours to next occurrence" 토글을 켜야만 작동**한다(기본값이 아님). **(2) 청구에는 영향 없음 — "청구서(invoice)에는 영향을 주지 않는다"고 명시**돼 있어, 정산/청구용 숫자는 항상 원래 기간별 원자적 숫자를 그대로 쓰고, 이월 합산 수치는 "수익성 파악용 보조 뷰"로만 별도 컬럼("Rolled over time")에 얹는다. **(3) 이 기능은 시간(hours) 단위에만 적용되고 금액(revenue)에는 적용되지 않는다.** **[인용]** (동일 출처)
- 즉 Productive.io 사례는 "합산 정산 표시 자체는 실무에 존재한다"는 근거가 되면서도, 동시에 **"원래의 원자적 기간별 숫자를 없애거나 대체하지 않고, 항상 병기(竝記)한다"**는 설계 원칙까지 함께 보여준다.

**Harvest — "Budget resets every month(예산 매월 초기화)"**
> 매월 시작 시 예산 소진율이 0%로 리셋되고, 그 달 안에 실제로 기록된(tracked) 시간/비용만으로 소진율을 계산한다.
**[인용]** [How to set project budgets – Harvest Help Center](https://support.getharvest.com/hc/en-us/articles/360048686811-How-to-set-project-budgets)
- Harvest는 **시간 기록(time entry)이 실제로 찍힌 날짜 기준**으로 그 달의 예산에 귀속시킨다 — 작업이 여러 달에 걸쳐도 "작업 시작일에 전액 귀속"이 아니라, **일별로 자연히 쪼개지는 구조**(시간을 매일 기록하므로 자동으로 일할 계산이 되는 효과)다. 이는 우리 케이스의 "정액 단건 계약"(하루 단위로 쪼갤 수 없는 캠페인비)과는 성격이 달라 직접 대응은 어렵다. **[추측]**
- 리텐션(retainer) 자체에 대해서는 "선불로 받은 시간/금액을 소진해가는 방식"이라는 개념만 확인됐고, 리텐션이 여러 기간에 걸친 단건 비용을 어떻게 귀속하는지에 대한 구체 규칙은 문서에서 확인하지 못했다. **[확인 불가]**

**Function Point / Deltek**
- Function Point는 공식 문서에서 리텐션 청구 관련 세부 로직(기간 경계 처리)을 확인하지 못했고, 3자 리뷰에서 "리텐션 청구가 다루기 까다롭다(clunky)"는 언급만 있었다. **[확인 불가]**
- Deltek(Vantagepoint/Costpoint)은 "회계 기간(Accounting Period)"이라는 개념 자체는 명확히 문서화돼 있으나(월별 오픈/마감 기간), 프로젝트 원가가 여러 회계기간에 걸칠 때 시작일 기준으로 원자적 귀속하는지 일할 계산하는지에 대한 구체 규칙은 이번 조사에서 원문으로 확인하지 못했다. **[확인 불가]** ([Accounting Periods and Processing Cycles – Deltek Help](https://help.deltek.com/product/Vision/7.6/PCC_About_Accounting_Periods.html))

### 2-4. 회계 원칙 — 발생주의/대응원칙과 실제 관행

**대응원칙(Matching Principle)의 일반 규칙과 예외**
> "If there is a cause-and-effect relationship between revenue and certain expenses, then record them at the same time... In some cases, it will be necessary to conduct a systematic allocation of a cost across multiple reporting periods, such as when the purchase cost of a fixed asset is depreciated over several years. **If there is no cause-and-effect relationship, then charge the cost to expense at once.**"
**[인용]** [Matching principle definition – AccountingTools](https://www.accountingtools.com/articles/the-matching-principle)

- 핵심은 "여러 기간에 걸쳐 나눠 인식하라"는 규칙이 **무조건 적용되는 것이 아니라, 원가와 수익 사이에 뚜렷한 인과관계가 있을 때만** 적용된다는 점이다. 인플루언서 캠페인비처럼 특정 수익과 1:1로 대응시키기 어려운 지출은 **"발생 시점에 즉시 전액 비용 처리"**가 원칙적으로 더 맞다.

**미국 GAAP의 광고비 처리 규정 (ASC 720-35)**
> "ASC 720-35-25-1 allows reporting entities to elect an accounting policy to either expense advertising costs the first time the advertising takes place or expense them as they are incurred."
**[인용]** (PwC Viewpoint 요약 및 SEC 공시 자료 기반 검색 결과 종합 — 원문 FASB 코드는 유료 구독 필요로 1차 확인 불가, PwC/SEC 자료는 신뢰도 높은 준1차 자료로 취급)

- 즉 미국 회계기준은 광고비(우리 캠페인비와 성격이 가장 가까운 비용 항목)를 **"집행 시점" 또는 "첫 노출 시점"에 전액 비용 처리하도록 명시**하며, 캠페인의 서비스 제공 기간에 걸쳐 나눠 인식하는 것을 표준으로 요구하지 않는다. 이는 우리 케이스의 "시작일이 속한 기간에 전액 귀속"과 원칙적으로 정합적이다.

**약정원가(Committed Cost) / 커밋먼트 어카운팅**
> "A committed cost is an investment that a business entity has already made and cannot recover by any means, as well as obligations already made that the business cannot get out of." / "Recording committed expenditure against budget occurs when the purchase order is approved, at which point a corresponding portion of the budget is reserved."
**[인용]** [Committed cost definition – AccountingTools](https://www.accountingtools.com/articles/what-is-a-committed-cost.html), [Tracking Committed Costs in Construction Projects – Mastt](https://www.mastt.com/blogs/tracking-committed-costs)

- 건설/프로젝트 관리 분야의 예산 통제 관행은 **계약(주문)이 확정된 시점에 그 총액을 즉시 해당 시점의 예산에서 차감**하고, 계약 이행이 여러 결산기에 걸쳐도 그 배분을 다시 조정하지 않는다. 이는 "캠페인 시작일에 전액 귀속, 이후 재배분 없음"이라는 우리 설계와 구조적으로 가장 가까운 실무 관행이다.

---

## 3. 우리 설계에 대한 함의 (비개발자용 요약)

**결론: "8월이 초과된 건 9월 예산에서 당겨쓴 걸로 봐서 실제론 괜찮다"는 식으로 두 기간을 자동으로 합쳐서 보여주는 방식은, 조사한 범위에서 업계 표준이라 부를 만한 사례가 없었습니다.** 실제 시스템들은 거의 다 아래 둘 중 하나를 택하고 있었습니다.

1. **완전히 일할 계산(날짜 비례로 쪼개기)** — Google Ads가 이 방식입니다. 캠페인이 월을 걸치면 "이 달에 며칠 돌았는지"를 계산해서 그 달의 한도를 다시 산정합니다. 하지만 이 방식은 "인플루언서에게 얼마를 줬는지"처럼 **날짜별로 쪼갤 수 없는 정액 계약비**에는 애초에 적용하기 어렵습니다(구독료처럼 매일 균등하게 소비되는 게 아니니까요).
2. **원자적 귀속(발생 시점 하나에 전액을 붙이고, 기간끼리 서로 건드리지 않기)** — 건설/프로젝트 예산 관리(약정원가 방식)와 미국 회계기준(광고비는 집행 시점에 전액 비용 처리)이 이 방식입니다. **이 접근이 우리가 이미 정한 "캠페인 시작일이 속한 기간에 전액 귀속"이라는 규칙과 가장 잘 맞아떨어집니다.**

**"초과분을 다음 기간과 합산해서 보여주는" 방식의 유일한 실사례(Productive.io)조차, 우리가 검토 중인 형태와는 다릅니다.** 이 도구는 미사용/초과 시간을 다음 달로 이월해 보여주긴 하지만, ① 기본값이 아니라 사용자가 따로 켜야 하는 옵션이고, ② "이월 합산 숫자"는 어디까지나 참고용 보조 지표일 뿐, **원래 그 달의 초과/미달 숫자(진짜 청구 기준)는 항상 그대로 따로 보여줍니다.** 즉 "합쳐서 하나의 숫자로 만들어 보여주는" 게 아니라 "원래 숫자는 그대로 두고, 옆에 참고 정보 하나를 더 붙이는" 방식입니다.

**정리하면, 세 가지 선택지 중 실무 근거가 가장 탄탄한 순서는 다음과 같습니다.**

1. **① 원자적 귀속만 하고 기간 간 합산은 하지 않는다 (가장 근거 탄탄)** — 광고비 회계 기준, 약정원가 관행과 정합적이고, 지금 캠페인 귀속 규칙("시작일 기준 전액 귀속, 안분 없음")과도 논리가 일관됩니다. 사람이 "8월은 초과했지만 9월 초 캠페인 때문이구나"를 스스로 판단하게 두는 방식입니다.
2. **② 원자적 귀속 + 옵트인 보조 지표로만 합산 정보를 곁들인다 (근거 있으나 제한적)** — Productive.io 사례처럼, 기본 화면은 ①과 동일하게 유지하되, 필요할 때만 "이 초과분 중 얼마가 다음 기간 캠페인 때문인지"를 보조적으로 보여주는 것은 실무에 전례가 있습니다. 다만 이 경우에도 **원래의 초과 숫자를 지우거나 상쇄된 것처럼 보이게 해선 안 됩니다** — 항상 "원래 숫자 + 참고 설명"의 형태여야 한다는 게 Productive.io 사례의 핵심 교훈입니다.
3. **③ 초과분과 다음 기간 잔여를 합쳐 "실질적으로는 괜찮다"는 하나의 숫자로 대체 표시 (근거 없음, 권장하지 않음)** — 이번 조사에서 이 방식을 그대로 채택한 실사례는 찾지 못했습니다. 이 방식의 위험은, 8월 담당자·9월 담당자가 서로 다른 기준으로 예산을 관리하고 있을 수 있는데(특히 클라이언트 예산 기간이 계약상 월 단위로 딱 끊기는 경우), 시스템이 임의로 "괜찮다"고 판정해버리면 실제로는 조율이 필요한 상황을 가려버릴 수 있다는 점입니다. AGENTS.md의 UX 원칙 4번("라벨과 값은 항상 일치시킨다")과도 상충할 위험이 있습니다 — "8월 초과"라는 사실 자체가 사라지면, 나중에 "왜 이때 초과였는지 몰랐다"는 문제로 이어질 수 있습니다.

**권장: ①을 기본으로 하고, 꼭 필요하다면 ②의 형태(원래 숫자는 그대로 두고 보조 설명만 추가)로 보완하는 것을 추천합니다.**
