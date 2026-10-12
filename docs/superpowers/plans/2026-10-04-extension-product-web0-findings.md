# WEB 0 / API 0 확인 결과와 채택한 기본값

작성일: 2026-10-04 · 브랜치 `feat/x-extension-product` (기준 `fe6c2a1`)

[cb-x-deck 구현 계획](2026-10-04-cb-x-deck-extension-product-implementation.md) §5 WEB 0과 [공통 API 계획](2026-10-04-extension-product-api-implementation.md) §11 API 0에서 확인하기로 한 항목의 결과다. 아래 "채택한 기본값"은 API 계획 §12의 권장안을 첫 구현 단위에 적용한 것이다. 바꾸려면 해당 줄을 고치고 관련 코드·테스트를 같이 고친다.

## 1 확인한 사실

### 동의서 PDF

> **2026-10-06 정정:** 아래 원래 결론은 틀렸다. 이 브랜치가 main보다 뒤처진 상태(`fe6c2a1`)에서 확인했기 때문이다. 운영 main에는 2026-09-29부터 **작업 단위 협찬 동의서**가 있고 실제로 쓰고 있다. 063_visit_time_agreement가 만든 `campaign_task.agreement`와 `task-agreement` 버킷(PDF·JPEG·PNG, 붙여넣기 지원)이며, 코드는 `taskAgreement.ts`와 `flow/panel/AgreementField.tsx`다. **결정: 예약용 동의서 저장소를 새로 만들지 않고 이 기능을 그대로 쓴다.** 방문 작업당 예약은 1개이므로 작업 단위 동의서가 곧 예약의 동의서다. 064에서 `reservation_consent`와 `reservation-consent` 버킷을 뺐다.

~~현재 체크아웃과 모든 로컬·원격 브랜치에 동의서 저장 기능은 없다. 결론: 독립 PDF 기능을 새로 만든다(`reservation-consent`).~~

### `campaign_task` 쓰기 경로 (WEB 6 차단 대상 목록)

예약이 붙은 visit 작업에서 아래 경로는 예약 command를 거치거나 거부해야 한다.

| 경로 | 위치 | 예약 연결 후 처리 |
| --- | --- | --- |
| 작업 PATCH(날짜·비용·사람) | `api/campaigns/[id]/tasks/[taskId]` PATCH → `updateTask` | `visitOn`·`scheduledOn` 변경은 `RESERVATION_COMMAND_REQUIRED`. 비용·noCost는 활성 정산 중 거부(현재 이 라우트는 활성 정산을 검사하지 않음) |
| 작업 취소 | `.../cancel` → `cancelTask`(원고 떼기) | 예약 연결 visit은 예약 종료 command로 분기 |
| 작업 복원 | `.../restore` → `restoreTask` | 예약 종료가 있으면 거부(복원 결정 전) |
| 작업 삭제 | `.../[taskId]` DELETE → `deleteTask` | 064의 FK restrict가 막는다. 화면 안내 필요 |
| 캠페인 삭제 | `api/campaigns/[id]` DELETE → `deleteCampaign`(cascade) | 064의 FK restrict가 막는다. 화면 안내 필요 |
| 사람 교체 | `.../replace` → `replaceInfluencer` | 예약 연결 시 거부 또는 예약 종료 후 진행 |
| 배정 해제·개명 | PATCH(`influencerChangeGuard`), `renameInfluencer` | 해제는 거부, 개명은 handle만 바뀌므로 허용 |
| 캘린더 끌어 놓기 | `CampaignDetail.tsx` WeekCalendar → PATCH | PATCH 차단으로 함께 막힘 |
| 취소 작업 메모 | PATCH(취소 작업은 note만 허용) | 예약 종료 visit은 메모도 거부 |

참고: 작업 삭제·캠페인 삭제의 활성 정산 검사는 삭제와 같은 트랜잭션이 아니다(기존 문제, 이번 범위 밖).

### 기존 판정과의 접점

- 활성 정산 요청 = `payment_request.status = 'requested'`(작업당 1건 unique). 지급 완료 = 같은 요청의 `external_status = 'paid'`. `flowStage`도 같은 기준이다.
- 정산 후보 SQL(`settlementStore.CANDIDATE_BASE`)과 `isSettlementCandidate`는 아직 `no_cost`를 모른다. 064 적용 후 같은 브랜치에서 둘을 함께 고친다(WEB 5).
- `/campaigns/flow`는 `id`만 읽는다. `task=` 진입은 WEB 3에서 추가한다.

## 2 채택한 기본값

| 항목 | 채택 | 반영 위치 |
| --- | --- | --- |
| 확정 전 횟수 | 확정 전 수정과 첫 확정은 횟수에서 제외(최신 웹 규칙) | `planReservationSave` |
| 게시 후 예약 수정 | 업로드·정산 단계는 `correction`만 허용, 종료 불가 | `allowedVisitActions`·`planReservationSave` |
| 방문 완료 후 일정 수정 | 수동 완료는 날짜 변경으로 되돌리지 않음 | `visitPhase` |
| 종료 복원 | 예약 종료가 있는 작업은 복원 금지(쓰기 경로에서 적용) | WEB 6 |
| 금액 0과 무상 | 0/null을 `no_cost`로 자동 이관하지 않음 | 064 기본값 false |
| 최소 저장 항목 | 대기는 해석 불가 시트도 저장, 확정·확정 후는 유효 일시와 이름 필수 | `planReservationSave` |
| 직접 기한 | 방문일보다 이르면 거부하고 다시 확인 | `applyDeadlineMode` |
| task 종료 사유 컬럼 | 055의 `cancel_reason` 제약은 넓히지 않고 `other`로 둔다. 종류의 정본은 `reservation_end.kind` | 058 주석 |
| task version | 트리거가 실제 변경이 있는 모든 UPDATE에서 +1(기존 경로 누락 방지) | 064 |

결정이 남은 항목은 공휴일 제공처, 팀 공용 빠른 메시지, 운영시간 밖 예약 저장, 숫자 ID 보강, token 보관, DeepL 중계, 보관 기간이다. 첫 구현 단위와는 무관하다.

## 3 이번 단위의 산출물과 검증

| 파일 | 내용 |
| --- | --- |
| `src/lib/reservationSheet.ts` | 최종 시트 읽기·부분 갱신·무변경 정규화·전후 차이(목업 규칙 이식) |
| `src/lib/reservationPolicy.ts` | 방문 단계·허용 행동·요청 횟수·업로드 기한·저장/종료/중단/방문 완료 검증 |
| `src/lib/clinicHours.ts` | 날짜 예외 → 공휴일 → 요일 판정. 공휴일 자료가 없는 연도는 확인 필요 |
| `migrations/064_visit_reservation.sql` (처음 058로 작성 → main의 058~063과 겹쳐 064로 변경, 2026-10-06) | `campaign_task` 추가 컬럼·version 트리거, 본점, 예약·이력·종료, idempotency. 동의서는 063 재사용 |

- 순수 테스트: `node --import tsx --test src/lib/reservationPolicy.test.ts src/lib/reservationSheet.test.ts src/lib/clinicHours.test.ts`.
- 058(현 064): 로컬 임시 Postgres 17에서 001~058 전체를 두 번 적용해 재실행 안전을 확인했다. **2026-10-06 재확인:** 동의서 테이블을 뺀 064를 main(`b5b8cf2`)의 001~063 위에 두 번 적용해 통과했다. `reservation_consent` 없음, `task-agreement` 유지, no-op UPDATE는 version 유지·동의서 변경은 +1, 확장 조회 SQL 실행을 확인했다. Supabase의 `storage` 스키마·`authenticated` 역할은 stub으로 대신했다. 제약(본점 1개, 작업당 예약 1개, 회차 unique·범위, 활성 종료 1건, 10 MiB, cascade·클라이언트 삭제 차단)과 version 트리거(무변경 UPDATE는 유지, 변경은 +1, 직접 지정 무시)를 확인했다.
- `npx tsc --noEmit` 통과. `npm run lint`는 오류 13건으로 실패하지만 모두 이번에 손대지 않은 기존 파일(`BriefingSection.tsx`, `memberContext.tsx` 등)이다. 새 파일과 목업에는 오류가 없다.
- staging DB에는 아직 적용하지 않았다. 로컬에 `.env.staging`이 없어 `npm test`(DB 통합)는 실행하지 않았다.

## 4 다음 단위

1. **API 1 인증:** Supabase 프로젝트의 signing key 종류와 확장 redirect URL을 확인한 뒤 `extensionAuth.ts`(Bearer `getClaims(jwt)` + 기존 도메인·Google 정책)와 `proxy.ts`의 `/api/extension/v1` 경계를 추가한다. 착수 전에 `node_modules/next/dist/docs/`의 Route Handlers·Proxy 문서를 확인한다.
2. **WEB 1 / API 3 예약 command:** `reservationStore.ts`·`reservationCommands.ts`. lock 순서는 task → reservation이고 idempotency가 먼저다. staging 통합 테스트가 필요하다.
3. **API 4 동의서:** 새 저장소 없이 063의 `campaign_task.agreement`·`task-agreement` 버킷과 `taskAgreement.ts`를 확장 API에서 호출한다(2026-10-06 결정). 확장의 업로드도 이미지·PDF를 같은 규칙으로 받는다.
4. **WEB 6 선행 차단:** 위 표의 쓰기 경로 guard. 계획에 따라 쓰기 기능을 켜기 전에 배포한다.
