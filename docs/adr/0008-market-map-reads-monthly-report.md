---
status: accepted
date: 2026-10-17
---

# 클리닉 지도는 monthly-report 테이블을 읽기만 한다

클리닉 지도(`/market-map`, 스펙 `docs/superpowers/specs/2026-10-17-clinic-map-design.md`)는 병원마다 '서비스 중 · 리포트 준비 · 제안서 발송'을 보여준다. 이 정보의 원본은 monthly-report 앱의 테이블이다.

- 고객 · 월간 리포트: `report.clinic`, `report.report`
- 리드 · 제안서: `report.lead`, `report.proposal`

두 앱은 같은 Supabase 프로젝트를 쓴다.

## 결정

- cb-x-deck은 `report.*`를 **읽기만** 한다. 쓰지 않고, FK도 걸지 않는다.
  - `market_clinic_link.report_clinic_id`와 `lead_id`는 id만 담는다.
  - 반대 방향(`report.clinic.client_id` → `public.client`)이 FK 없이 이쪽을 가리키는 것과 같은 방식이다.
- 읽을 때는 `read only` 트랜잭션을 쓴다(`readCrm`).
- `report` 스키마가 없는 DB(연습용)면 영업 상태를 빈 값으로 둔다. 화면은 그래도 정상이다.
- 개인정보 칸(`contact_name` · `phone` · `email`)은 읽지 않는다. 읽는 것은 병원 이름, 리포트 수와 마지막 달, 제안서 수, 열람 수뿐이다.
- 리드 등록과 제안서 작성은 monthly-report에서 한다. 지도는 그 화면으로 넘기기만 한다.

## 왜

- monthly-report는 고객이 보는 제품(`/r` · `/p` · `/o`)이라 지도를 그 안에 넣지 않았다(koo 10-16).
  - 지도는 cb-x-deck(팀원 전용)에 둔다.
  - 영업 상태는 원본을 그대로 읽어야 두 곳의 숫자가 어긋나지 않는다.
- 쓰기를 허용하면 두 앱이 같은 행을 고치게 되고, 한쪽 배포가 다른 쪽 데이터를 깨뜨릴 수 있다.

## 결과

- monthly-report가 위 테이블의 칸 이름을 바꾸거나 지우면 지도의 영업 상태가 깨진다.
  - 읽는 칸은 `report.clinic(id, display_name)`, `report.report(clinic_id, month)`, `report.lead(id, clinic_name, status, converted_clinic_id)`, `report.proposal(lead_id, view_count)`뿐이다.
  - 이 사실을 monthly-report 쪽에 알린다.
- 지도 쪽 연결(어느 병원이 어느 고객인지)은 cb-x-deck의 `market_clinic_link`에 있다.
  - 처음에는 `scripts/market-map-link-seed.ts`가 이름 규칙으로 채운다.
