# 그쪽 요청 (정산 프로덕트 → 우리) — 2026-09-09 엔화 실지급액(paid_amount_jpy) 상태 POST 확장 요청

> 출처: https://share.onorca.dev/a/Ui_HKkf81-Fu (파일명 20260909_엔화_실지급액_POST_API_확장_요청.md). 텍스트 추출본. 협의용 제안 — 그쪽 JPY 송신은 미구현.



엔화 실지급액 상태 POST API 확장 요청

작성일: 2026-09-09

수신: cb-x-deck 개발팀

목적: 계좌이체·PayPay의 실제 엔화 지급액을 기존 정산 상태 API로 회신하기 위한 최소 호환 계약 합의

관련 경로: POST /api/external/settlement/requests/{request_id}/status

문서 상태: 양팀 협의용 제안. JPY 외부 송신은 아직 구현·배포되지 않음

1. 요청 배경과 범위

정산 미러는 계좌이체와 PayPay 지급에서 실제 송금 엔화와 서버가 확정한 원화 환산액을 함께 보존한다. 현행 외부 계약은 지급 완료 시 paid_amount_krw와 paid_at만 필수로 받으며, PayPal에 한해 선택 필드 paid_amount_usd를 추가로 받는다. 따라서 현재 cb-x-deck에는 계좌이체·PayPay의 실제 엔화 금액을 전달할 계약 필드가 없다.

이번 요청은 기존 상태 POST에 선택 필드 paid_amount_jpy를 추가하는 최소 확장이다. 환율·환율 기준일·출처 전송은 이번 범위에서 제외한다. 정산 미러가 서버에서 확정한 paid_amount_krw는 기존과 같이 그대로 보낸다.

별도로 진행한 지급방법 칼럼·paypal/bank/paypay 필터와 현황 summary 공통필터는 정산 미러의 목록 조회 기능이다. 이 기능에는 cb-x-deck POST 변경이 필요하지 않다.

2. 현행 계약과 제안 계약

 | 

 | 항목
 | 현행
 | 제안

 | 엔드포인트
 | 기존 건별 상태 POST
 | 변경 없음

 | paid_amount_krw
 | status: "paid"에서 필수인 0 이상 정수
 | 변경 없음

 | paid_at
 | status: "paid"에서 필수
 | 변경 없음

 | paid_amount_usd
 | 선택, PayPal 실제 USD 지급액
 | 변경 없음

 | paid_amount_jpy
 | 없음
 | 선택, 실제 JPY 지급액

 | GET/POST 응답
 | settlement.paid_amount_krw, 선택적 paid_amount_usd
 | settlement.paid_amount_jpy를 선택·nullable로 추가

paid_amount_jpy의 최소 검증 규칙을 다음과 같이 제안한다.

JSON number이며 0 이상, Number.MAX_SAFE_INTEGER 이하인 안전한 정수여야 한다. 허용 범위는 0..9,007,199,254,740,991이다.

status: "paid"에서만 허용한다.

0도 유효하므로 진릿값이 아니라 필드 존재 여부로 포함·검증을 판정한다.

문자열, null, 음수, 소수, 안전한 정수 상한 초과 값은 허용하지 않는다.

paid_amount_jpy가 있어도 기존 필수 필드 paid_amount_krw와 paid_at은 반드시 함께 보낸다.

paid_amount_usd와 paid_amount_jpy는 한 요청에 동시에 허용하지 않는다.

검증 실패는 기존 규약처럼 HTTP 400과 { "error": "...", "field": "paid_amount_jpy" }를 반환한다.

상태 잠금, revision, updated_at 단조 증가, stale, 409 규칙은 그대로 유지한다.

수신 검증의 최소 기대 결과는 다음과 같다.

 | 

 | 입력 조건
 | 기대 결과

 | paid, paid_amount_jpy: 1500, 기존 필수 필드 포함
 | 수용

 | paid, paid_amount_jpy: 0, 기존 필수 필드 포함
 | 수용, JPY 필드 존재로 판정

 | paid_amount_jpy: -1
 | 400, field: "paid_amount_jpy"

 | paid_amount_jpy: 1.5
 | 400, field: "paid_amount_jpy"

 | paid_amount_jpy: "1500" 또는 null
 | 400, field: "paid_amount_jpy"

 | paid_amount_jpy: 9007199254740992
 | 400, field: "paid_amount_jpy"

 | status가 paid가 아닌데 JPY 포함
 | 400, field: "paid_amount_jpy"

 | USD와 JPY를 동시에 포함
 | 400, 상호 배타 오류 필드 합의 필요

 | JPY는 있으나 paid_amount_krw 또는 paid_at 누락
 | 기존 필수 필드 규칙으로 400

3. 지급방법과 실제 지급통화

소스의 원본 payment_method와 요청 금액 정보는 변경하지 않는다. 실제 지급통화는 request.payout.currency에서 추론하면 안 된다. 요청 통화와 실제 송금 수단·통화가 다를 수 있기 때문이다.

 | 

 | payment_method.type
 | 정산 미러에서 허용하는 실제 지급통화
 | 상태 POST

 | bank
 | KRW 또는 JPY
 | KRW 지급은 JPY 생략, JPY 지급은 paid_amount_jpy 포함

 | paypay
 | JPY
 | paid_amount_jpy 포함

 | paypal
 | USD
 | 기존 paid_amount_usd 포함

cb-x-deck은 새 송신 규약으로 생성된 POST에 한해 외화 실지급 필드로 실제 지급통화를 판별할 수 있다. paid_amount_usd와 paid_amount_jpy가 모두 없으면 KRW 지급으로 해석하는 규칙은 신규 송신 전환 시점이나 payload 버전을 식별할 수 있을 때만 적용할 것을 제안한다.

기존 및 구버전 outbox에는 실제 JPY 지급도 paid_amount_krw만 들어 있으므로, 필드 부재만으로 KRW 지급이라고 확정할 수 없다. 과거 금액을 환율로 역산해 실제 JPY를 만들거나 추정해서도 안 된다. 식별 가능한 버전·전환 시점·게이트에 합의하지 못하면 외화 필드 부재를 이유로 저장된 JPY를 삭제하는 로직을 구현하면 안 된다.

최소 1필드 확장안은 paid_amount_jpy 추가까지다. KRW 정정의 필드 부재 의미까지 안전하게 적용하려면 paid_currency: "KRW" 같은 명시 필드 또는 기능 버전 식별자를 추가 합의하는 방식을 권장한다. 단순 수신 시각이나 updated_at 경계만으로는 배포 후 도착한 구버전 outbox 생성분·재시도를 확실히 구별할 수 없다.

4. 저장·응답과 정정 의미 제안

POST 성공 응답과 이후 GET의 Item.settlement에 다음 필드를 추가해 달라.

{
  "paid_amount_jpy": 1500
}

타입: number | null

신규 소스 배포 전 응답과 구버전 데이터에서는 필드 생략도 허용한다.

신규 소스는 지급 데이터에 JPY가 없으면 null로 되비치는 방식을 권장한다.

신규 송신 규약으로 식별된 paid → paid 금액 정정에서 이전 외화 값이 남지 않도록 다음 대체 저장 의미를 제안한다.

 | 

 | 새 paid POST 본문
 | 저장 결과 제안

 | paid_amount_jpy 포함
 | JPY 저장, 기존 USD는 null로 정리

 | paid_amount_usd 포함
 | USD 저장, 기존 JPY는 null로 정리

 | USD·JPY 모두 생략
 | bank의 KRW 지급으로 보고 기존 USD·JPY를 모두 null로 정리

 | stale POST
 | 어떤 지급 금액도 변경하지 않음

이 규칙은 bank JPY 지급을 KRW로 정정했는데 과거 JPY가 남거나, 외화 종류를 바꾼 뒤 이전 값이 함께 표시되는 일을 막기 위한 제안이다. PayPay는 JPY 전용이므로 JPY→KRW 정정 대상이 아니다. 기존 USD 저장 로직, 신규 규약 식별 방법, 필드 누락의 정리 의미는 수신팀 합의가 필요하다. 합의 전에는 기존 JPY·USD 값을 자동으로 지우지 않는다.

5. 요청 예시

아래 금액과 시각은 계약 설명을 위한 가상 값이다. updated_at은 실제 구현에서 정산 미러 서버가 상태를 확정한 시각을 쓴다. 네트워크 재시도 때는 본문과 시각을 변경하지 않는다. revision, operator, external_id는 기존 계약을 그대로 따르며 예시에서는 생략했다.

계좌이체·PayPay 엔화 지급 완료

{
  "status": "paid",
  "updated_at": "2026-09-09T06:00:00.000Z",
  "paid_amount_krw": 13685,
  "paid_amount_jpy": 1500,
  "paid_at": "2026-09-09T05:59:00.000Z"
}

엔화 지급액 정정

{
  "status": "paid",
  "updated_at": "2026-09-09T06:10:00.000Z",
  "paid_amount_krw": 14597,
  "paid_amount_jpy": 1600,
  "paid_at": "2026-09-09T05:59:00.000Z",
  "note": "실지급 엔화 금액 정정"
}

기존 bank 엔화 지급을 원화 지급으로 정정

{
  "status": "paid",
  "updated_at": "2026-09-09T06:20:00.000Z",
  "paid_amount_krw": 14000,
  "paid_at": "2026-09-09T05:59:00.000Z",
  "note": "실제 지급통화를 KRW로 정정"
}

마지막 예시는 신규 송신 규약의 bank 정정으로 식별되는 경우에만 paid_amount_jpy 생략을 KRW 정정으로 해석하고 기존 JPY를 null로 정리한다. 구버전 또는 식별할 수 없는 POST에는 이 규칙을 적용하지 않는다.

6. 양팀 작업과 배포 순서

cb-x-deck 개발팀

POST 검증에 선택 필드 paid_amount_jpy와 USD/JPY 상호 배타 규칙을 추가한다.

지급 저장 모델에 JPY를 추가하고 신규 송신 규약 식별 방법 및 paid → paid 정정의 외화 필드 정리 의미를 확정한다.

POST 응답과 GET 목록·단건의 Item.settlement.paid_amount_jpy 되비침을 추가한다.

배포 후 지원 시작 시점과 최종 계약을 회신한다.

정산 미러 개발팀

수신 계약 확정 후 송신 타입과 paid outbox 생성에 paid_amount_jpy를 추가한다.

계약 목 서버의 검증·저장·POST 응답·GET 되비침을 동일하게 구현한다.

완료, paid → paid JPY 정정, JPY→KRW 정정, 재시도 동일 본문을 통합 검증한다.

수신 배포 확인 뒤 송신 애플리케이션을 배포한다.

권장 배포 순서는 신규 규약 식별 방법 합의 → cb-x-deck 수신 호환 배포 → 수신 스모크 검증 → 정산 미러 송신 배포와 게이트 전환이다. 기존 지급건을 일괄 소급 전송하지 않는다. 송신 게이트 전환 이후 새 완료·정정에서 생성된 outbox부터 적용하며, 이미 생성된 outbox 본문에는 JPY 필드를 추가하거나 내용을 변경하지 않는다.

outbox 재시도는 최초 저장한 동일 body와 동일 updated_at을 사용한다. 재시도 시 금액이나 시각을 새로 계산하지 않는다.

7. 회신 요청 항목

paid_amount_jpy 필드명과 0 이상 안전한 정수 규칙 수용 여부

paid_amount_usd와 paid_amount_jpy 동시 금지 여부

신규 송신과 구버전 outbox를 구별할 payload 버전·전환 시점·게이트 방식

신규 규약으로 식별된 bank의 paid → paid POST에서 외화 필드 생략을 KRW 정정으로 보고 기존 외화를 null로 정리할지

식별할 수 없는 구버전 POST에서는 기존 외화 값을 유지할지

JPY 수신 저장과 POST·GET 되비침 배포 예정일 및 실제 배포 완료 시점

구버전 데이터와 배포 전 응답에서 paid_amount_jpy 생략을 허용할지

차액 판정이 기존처럼 paid_amount_krw 기준인지

현재 자료만으로 cb-x-deck의 JPY 수신 배포 여부는 확인되지 않았다. 또한 이전 인계에는 정산 미러 운영 DB의 020_jpy_payment.sql 적용이 아직 필요하다고 기록되어 있으며, 이 문서 작성 과정에서는 원격 DB의 현재 적용 상태를 확인하지 않았다. 수신 API 배포 확인과 정산 미러 DB 마이그레이션 확인은 서로 다른 배포 항목이다.

8. 근거

외부 정산 API 계약 정본

JPY 지급 저장·검증 마이그레이션

상태 액션과 현행 outbound 생성

상태 POST 송신 클라이언트

outbox 송신기

상태 POST 타입 계약

프로젝트 인계 기록

