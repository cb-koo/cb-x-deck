# [회신] X 마케팅 비용 전달 API — 확인 요청 3건 답변

> **보내는 쪽**: cb-x-deck 개발팀
> **받는 쪽**: LINE 메시지 대시보드(linemessagedashboard) 팀
> **작성일**: 2026-09-18
> **대상 문서**: 그쪽 회신 초안 `cb-x-deck-marketing-cost-reply-draft.md` ↔ 우리 확정본 `cb-x-deck/docs/api/marketing-costs-external-api.md`
> **상태**: 🔴 3건 모두 답변 완료 — **연동 시작 가능**합니다.

---

## 0. 한 줄 요약

세 가지 확인 요청 잘 받았습니다. **결론부터: 세 건 다 블로킹 아닙니다.**
- **Q1(지급하면 비용이 사라지나)** → 사라지지 않습니다. DB 제약으로 보장돼요.
- **Q2(블리비 누락 위험)** → 블리비는 지금 X 협찬 자체를 안 하고 있어 데이터가 없습니다 = 빠질 비용이 없어요.
- **Q3(배포 전 검증)** → 제안하신 A(스테이징)+B(운영 dry-run) 2단계에 동의합니다. A는 우리 쪽 준비 사항이에요.

---

## 1. 🔴 확인 요청 3건 답변

### A1. `status` 필터 — 지급 완료돼도 표에서 빠지지 않습니다 ✅

우려의 전제("`paid`·`transferred` 같은 상태가 있으면 지급 순간 빠진다")가 **우리 스키마에서는 성립하지 않습니다.**

- `payment_request.status`는 DB 제약으로 **딱 두 값**만 가질 수 있습니다:
  ```sql
  -- migrations/040_payment_request.sql
  status text not null default 'requested' check (status in ('requested','cancelled'))
  ```
- "지급 완료"는 **다른 컬럼** `external_status`(`received·scheduled·paid·on_hold·cancelled`, `041_payment_external.sql`)에 들어갑니다. 정산 프로덕트가 지급 완료 처리하면 `external_status='paid'`가 되지만 **`status`는 계속 `requested`** 입니다.
- 따라서 `status='requested'` 필터는 지급 완료 건을 **떨어뜨리지 않고 계속 집계**합니다. 제안하신 `status <> 'cancelled'`와 이 스키마에서 **항상 동일**합니다(데이터가 아니라 제약으로 보장).

→ **전체 값 목록 = `{requested, cancelled}`.** Q1은 "확인 완료"로 내려주셔도 됩니다. (원하시면 방어적으로 `<> 'cancelled'`로 바꿀 수 있으나 기능은 동일합니다.)

### A2. 블리비(`velybjp`) — 지금은 데이터가 없어 누락 이슈가 아닙니다 ✅

- 블리비는 **현재 X 협찬을 진행하지 않아** cb-x-deck에 관련 데이터도, 고정 매핑용 `client.id`도 **아직 없습니다.** 즉 **이 API로 나갈 블리비 비용 자체가 없으므로** "조용한 누락"이 발생할 대상이 없습니다.
- 슬러그는 `velybjp`가 맞습니다(양 프로젝트 CLAUDE.md 확정 규칙 + 우리 클라이언트 편집 화면이 `velybjp`만 선택 가능).
- **블리비가 X 협찬을 시작하면** 그 시점에 `client`가 생성됩니다. 그때 해당 `client.id`를 §6 매핑 표에 한 줄 추가해 **고정 매핑으로 통일**하겠습니다(우리 확정본 §7-3에 BACKLOG로 기록).

### A3. 검증 경로 — 스테이징 생략, 운영 dry-run으로 확정 ✅

> **최종 확정(확정본 §9)**: 스테이징 배포를 **생략**하고 운영 직행 + 배포 직후 dry-run으로 검증한다.

- 먼저 정정: "운영과 다른 코드 경로"는 아닙니다. 슬러그 해석은 **같은 함수 하나**(`resolveClinicId`)로 돌고, 맵에 든 `client.id`(=데이터)만 환경별로 다릅니다. 맵 우선순위 로직은 **단위테스트로 이미 검증**돼 있어, 검증 대상은 "코드"가 아니라 "운영 실데이터의 UUID·슬러그 값"으로 좁혀집니다.
- 검증 공백은 두 안전장치로 메웁니다:
  - **소비자 스킵**: 대시보드가 매핑 안 되는 슬러그를 크래시 없이 스킵 → 소스 하나가 틀려도 전체 표는 degrade만.
  - **운영 dry-run**: 운영 배포 직후 좁은 기간(예: 하루치)을 한 번 당겨 슬러그(`mimodreamjp` 등)·금액·기간을 눈으로 확인(조회 1회).
- 참고: 테스트(`npm test`)는 여전히 연습용(스테이징) DB에서 돕니다 — 배포 환경이 아니라 테스트 DB 얘기라 "스테이징 배포 생략"과 무관합니다.

---

## 2. 🟢 수용 확정 재확인 (조치 불필요)

그쪽 §2에서 확인하신 항목 모두 우리 구현과 일치합니다.

- 경로 `/api/external/marketing-costs` · 인증 `x-api-key`(`MARKETING_EXPORT_API_KEY`, 상수시간, fail-closed 401 본문 없음)
- `limit` 기본 500·최대 2000 (1년치는 `limit=2000` 권장)
- 금액 = `gross_krw`(수수료 포함 실지급 원화 정수)
- `x_visit_etc` 미전송(BACKLOG) · `x_secondary_viral`=RT만 · 테스트 픽스처 제외 · KST 자정 경계 · `no-store` · `external_api_log` 기록
- `currency`(지급 통화) · `originalAmount`(참고용)

**키 전달**: 운영 키를 1:1 채널로 전달하겠습니다(스테이징 배포 생략 확정 — 확정본 §9).

## 3. 🔵 그쪽(대시보드) 처리 항목 — 확인했습니다

- `x_content_quote_rt`의 표 행 배치는 대시보드 책임(우리 확정본 §7-7). 우리는 키만 정확히 보냅니다.
- 기존 Apps Script 원고료와의 합산 정합 검증은 그쪽에서 진행 — 필요 시 과거 기준 문의 주세요.
- 해지 클리닉(triomphe/brightskin): 우리 쪽엔 애초에 그 슬러그를 설정할 수단이 없어(4종만: velybjp·mimodreamjp·maindskinjp·sonyounajp) 흘러갈 일이 없습니다. 그쪽 방어 로직은 무해하니 그대로 두셔도 됩니다.
- `x_visit_etc` 빈 행 처리: 그쪽 UI에서 처리 — 우리는 해당 키를 보내지 않습니다.

---

## 4. 다음 단계 (스테이징 생략 — 확정본 §9)

1. **우리(cb-x-deck)**: 운영 배포 + 운영 키 1:1 전달.
2. **그쪽(대시보드)**: 두 번째 소스 소비 코드 구현 + 운영 URL/키 env 설정. URL은 확정본 §2.1 표 참조.
3. **함께**: 운영 배포 직후 하루치 dry-run으로 슬러그·금액·기간 최종 확인.
4. **BACKLOG**: 블리비 `client.id`(X 협찬 시작 시), `x_visit_etc`(착수 트리거 시).
4. 블리비는 X 협찬 시작 시 `client.id` 추가(BACKLOG). `x_visit_etc`는 착수 트리거 생기면 별도 스펙.

문의 주시면 이어서 답변드리겠습니다. 감사합니다.
