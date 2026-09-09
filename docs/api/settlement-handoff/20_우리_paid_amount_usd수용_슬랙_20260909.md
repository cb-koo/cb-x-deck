# 우리 회신 (우리 → 정산 프로덕트, 슬랙용) — 2026-09-09 paid_amount_usd 수용

> 아래 그대로 붙여넣기. 첨부: `settlement-external-api.md` 현재 판(§5 `settlement.paid_amount_usd`, §6 `paid_amount_usd` 행, §8 개정 기록).

---

`paid_amount_usd` 확인했습니다. **받도록 반영했고 오늘 배포합니다.** 지금 보내셔도 깨지지 않고(모르는 키는 무시), 배포 뒤부터는 저장·표시·되비침됩니다.

*받는 규칙*
• `paid` 완료·정정 POST에 `paid_amount_krw`와 **함께** 보내 주세요. 원화 없이 달러만 오면 지금처럼 400(`field: "paid_amount_krw"`)입니다 — 차액 판정은 원화로만 합니다.
• `paid_amount_usd`는 0 이상의 숫자, 소수 허용(셋째 자리부터 반올림). 문자열이면 400 `field: "paid_amount_usd"`.
• 아이템(GET)에 `settlement.paid_amount_usd`로 되비칩니다. 달러를 안 보낸 지급(계좌·PayPay)은 `null`.
• 저희 화면에는 "실지급 25,934원 · 달러로 $18.62 송금"처럼 보입니다. 원화가 송금액과 다를 때 환율 차이인지 판단하는 근거로 씁니다.

*부탁*
• @_mi_pi03(CBX-260908-011) 지급 완료에 `paid_amount_usd`를 붙여 보내 주시면 바로 확인하겠습니다.
• @_____noay 25,934원의 환율 기준(어느 시점 환율인지)은 기록용으로 한 줄만 알려 주세요.
• @pichan_032 계좌 건 보류 + "25,000원으로 수정" 메모는 앞서 부탁드린 대로 진행해 주세요.
