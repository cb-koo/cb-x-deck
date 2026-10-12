# 실제 화면·익스텐션 연동 전달 문서

2026-10-06. 이 레포에서 구현한 웹 화면과 공통 API의 현재 계약이다. 익스텐션 레포의 화면·빌드는 별도 작업이다. 코드 적용 후 테스트·빌드·브라우저 확인은 수행하지 않았다.

## 적용 전제와 실제 화면

로컬 `.env.local`은 공유 staging DB를 사용한다. 준비 상태 조사에서 064 예약 테이블은 있고, 065 클리닉 설정과 첨부 요청 테이블은 없었다. **065 적용 전 새 저장 기능은 비활성**이다. DB 설정 적용은 소유자에게 요청하며, [로컬 테스트 문서 §10](extension-v1-local-test.md#10-065-적용--소유자-나는-요청)에 실행 방법이 있다. 063의 `task-agreement` 비공개 버킷도 필요하다.

실제 화면의 경로:

| 화면 | 경로 | 저장하는 내용 |
| --- | --- | --- |
| 방문 작업 상세 | `/campaigns/flow?id=<campaignId>&task=<taskId>` | 예약 원문·최종 기재 시트·확정·변경 내역·동의서·종료 |
| 클리닉 설정 | `/clients?client=<clientId>&tab=hours` · `&tab=forms` (클라이언트 상세의 운영시간·방문 안내·양식 탭) | 본점 운영시간·날짜별 예외·지도·언어별 안내·고객 양식·기재 시트. 소개·금지 표현은 기존 기본 정보 탭 |
| 빠른 메시지 | `/quick-messages` (사이드바 미노출 — 포함 여부 결정 전) | 팀 메시지·언어·순서·사용 여부 |
| 인물 상세 | `/influencers?i=<personId>` | 기존 메모·단가와 각 항목의 저장 버전 |

`/mockup/x-extension`은 참고용 샘플 화면이다. 실제 업무 화면에는 샘플 예약·지도·공휴일·운영시간을 넣지 않았다. 공휴일 자료가 없는 연도는 운영 여부를 확인하도록 표시한다. 담당자가 저장한 양식은 새 버전으로 보관하며 과거 예약의 최종 시트는 유지한다.

## 인증과 공통 저장 계약

- 확장 API 기준 주소: `http://127.0.0.1:3100/api/extension/v1` (실제 개발 서버 포트에 맞춘다).
- 확장 요청: `Authorization: Bearer <회사 계정 access token>`. 쿠키로 확장을 인증하지 않는다.
- 웹은 같은 경로를 `/api/extension-product` 아래로 호출하며 웹 로그인 쿠키를 사용한다. 두 경로는 동일한 업무 처리 함수를 사용한다.
- 조회 성공: `{ data, meta: { apiVersion, serverNow, requestId } }`.
- 실패: `{ error: { code, message }, meta: { requestId } }`.
- 저장 요청은 `Content-Type: application/json`, `Idempotency-Key: <새 UUID>`가 필요하다. 같은 저장을 재시도할 때는 같은 키·내용·버전을 보낸다. 입력 또는 저장 대상이 바뀌면 새 키를 만든다.
- 기존 기록 수정에는 `If-Match: "<version>"`도 필요하다. 생성은 제외하며 기존 task에 예약을 연결할 때는 `target.expectedTaskVersion`을 보낸다.
- 개별 자원 응답은 현재 `version` 또는 `revision`에 대응하는 `ETag`를 제공한다. task와 reservation의 version은 서로 다르다.
- `/session`의 `featureFlags.writes/reservations/consents`를 보고 쓰기 화면을 연다(`writes`가 false면 모든 비GET이 `503 SERVER_NOT_READY`). 064·070 테이블이 있으면 기본으로 켜진다(2026-10-12 결정). 비상시 `EXTENSION_PRODUCT_ENABLED=false`로 끈다.

다른 담당자가 먼저 저장한 경우 `409 VERSION_CONFLICT`다. 입력을 지우지 말고 최신 GET 결과와 비교한 뒤 새 버전·새 키로 저장한다. 같은 키로 다른 입력을 보내면 `409 IDEMPOTENCY_KEY_REUSED`, 이미 예약이 연결된 작업은 `409 RESERVATION_ALREADY_EXISTS`, 준비가 안 된 서버는 `503 SERVER_NOT_READY`다.

서버가 실제로 내는 오류 코드(정본은 코드 — `src/lib/productCommand.ts`, `reservationPolicy.ts`, `reservationCommands.ts`, `reservationAgreement.ts`). 같은 코드가 다른 HTTP 상태로 올 수 있으므로 분기는 `code`로 한다.

| 코드 | 상태 | 어디서 |
| --- | --- | --- |
| `INVALID_INPUT` | 400 (드물게 409) | 모든 쓰기 — 본문 모양·필수 값 |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | 모든 쓰기 |
| `VERSION_REQUIRED` | 428 | `If-Match` 없음(생성에서 `expectedTaskVersion` 없음 포함) |
| `VERSION_CONFLICT` | 409 | 버전 불일치 |
| `IDEMPOTENCY_KEY_REUSED` | 409 | 같은 키·다른 본문 |
| `RESOURCE_NOT_FOUND` | 404 | 없는 기록 |
| `SERVER_NOT_READY` | 503 | `writes`가 false인 서버의 비GET |
| `STATE_CHANGED` | 409 | 지금 단계에서 허용되지 않는 저장·종료·동의서 |
| `CHANGE_LIMIT_REACHED` | 409 | 3회 이후의 고객 요청 변경 |
| `REASON_REQUIRED` | 422 | 확정 후 저장에 사유 없음 |
| `CONFIRM_FIELDS_MISSING` | 422 | 확정에 희망 일시·이름 없음 |
| `DATE_INVALID` | 422 (캘린더 month는 400) | 기한·방문 일시 형식 |
| `DEADLINE_BEFORE_VISIT` | 422 | 직접 지정한 기한이 방문일보다 이름 |
| `PERSON_REQUIRED` · `LOCATION_MISMATCH` · `TEMPLATE_MISMATCH` · `RESERVATION_ALREADY_EXISTS` | 422 / 422 / 422 / 409 | 예약 생성 |
| `IDENTITY_MISMATCH` | 422 (register는 409) | 시트 계정이 작업의 인플루언서와 다름 |
| `UNSUPPORTED_FILE` · `FILE_TOO_LARGE` · `UPLOAD_INCOMPLETE` | 422 | 동의서 prepare / finalize |
| `PROVIDER_UNAVAILABLE` | 503 | 저장소·AI 호출 실패 |
| `SETTLEMENT_REQUESTED` · `ACTIVE_SETTLEMENT` · `RESERVATION_COMMAND_REQUIRED` | 409 | 작업 삭제·정산 중인 작업·레거시 경로의 우회 변경 |
| `PROFILE_LOOKUP_FAILED` | 502 | `/people/register`의 외부 프로필 조회 실패 |
| `HOURS_INVALID` · `MAP_URL_INVALID` | 400/422 | 클리닉 설정(익스텐션은 안 씀) |

`REASON_REQUIRED_FOR_END`는 `/end`에서 더 이상 나지 않는다 — 메모·사유 칩이 비면 서버가 '진행 안 됨'으로 채운다.

## 주요 API

아래 경로는 `/api/extension/v1` 기준이다. 기존 `/session`, `/people/resolve`, `/people/badges`, `/people/{id}/tasks`도 유지한다.

| 요청 | 경로 | 입력·결과 |
| --- | --- | --- |
| POST | `/people/register` | `{handle, observedXUserId?}` → `{created, renamed, person}`. 버튼을 누를 때 외부 프로필을 조회할 수 있어 비용 발생 |
| GET | `/people/{id}` | 기존 인물 상세 |
| GET / PATCH | `/people/{id}/note` | PATCH `{note}`, 메모 독립 버전 |
| GET / PATCH | `/people/{id}/pricing` | PATCH `{pricing: <변경 키>}`, 단가 독립 버전 |
| GET | `/tasks/{id}` | 작업 단계·비용·예약 요약·version·allowedActions·webUrl·reservationId |
| GET | `/tasks/{id}/reservation` | 예약 상세 또는 `null` |
| GET | `/campaigns?kind=visit&includeEnded=false` | `{items,total}`, 캠페인·본점 ID |
| GET | `/campaigns/{id}/visit-task-candidates?personId=<id>` | 같은 상대의 미취소·미게시 방문 작업·version·reservationId |
| GET | `/clinics` | `{items,total}`, 본점 목록·configured |
| GET | `/clinics/{id}` | 기존 소개·금지 표현·settings·version·templates |
| GET | `/clinics/{id}/guidance?language=JA` | 지도·언어별 안내·고객 양식·기재 시트 버전 |
| GET | `/clinics/{id}/calendar?month=2026-10` | days·공휴일 자료의 범위·출처. 자료 없는 연도는 unknown |
| PATCH | `/clinics/{id}/settings` | `{settings}`, 설정 version |
| PATCH | `/clinics/{id}/templates/form` 또는 `/sheet` | `{body}`, 각각의 revision. 변경 후 parserCompatible=false |
| GET | `/quick-messages?language=JA&q=...` | `{items,total}`. 기본은 사용 중인 메시지만, 관리 화면은 includeInactive=true |
| POST / PATCH | `/quick-messages` 또는 `/{id}` | `{title,language,body,order,active}`, 수정 시 version 필요 |
| POST | `/reservation-extractions` | `{sourceText,personId,locationId}` → 202 `{id,status:'succeeded',result}`. 현재 요청 안에서 AI 추출을 마치며 예약 저장·확정은 하지 않음 |
| GET | `/reservation-extractions/{id}` | 본인 결과만 1시간 동안 조회 가능 |
| POST | `/reservations` | 아래 생성 예시. 대기 상태로 저장 |
| GET / PATCH | `/reservations/{id}` | 원문·최종 시트·fields·sheetFields·phase·version·task·allowedActions·consent |
| POST | `/reservations/{id}/confirm` | 현재 최종 시트와 기한 방식 → 필수 항목 검증 후 확정 |
| GET | `/reservations/{id}/changes?cursor=0&limit=3` | `{items,total,nextCursor}`, 전후 값·담당자·고객 요청 회차 |
| POST | `/tasks/{id}/complete-visit` | `{}`, task version. 허용되는 당일 수동 완료 |
| POST | `/tasks/{id}/end` | `{reason?:'declined'|'no_response'|'other', note?}`, task version. 웹 작업 취소 창과 같은 입력. 종료 종류는 서버가 단계로 정한다(취소 가능하면 취소 → 아니면 업로드 노쇼 → 방문 노쇼). `kind`를 함께 보내면 그 종류로 검증(선택, 방문 노쇼 명시용). 예약 없는 방문 작업은 일반 취소와 같아 되돌릴 수 있고, 응답은 예약 상세가 아니라 작업 사실 객체 — 끝난 뒤 `GET /tasks/{id}`를 다시 읽는다 |
| POST | `/reservations/{id}/stop-for-change-limit` | `{}`, reservation version. 3회 이후 명시적인 추가 요청 기록·종료 |
| POST | `/reservations/{id}/consents/uploads` | `{name,mime,size}`, reservation version → `{uploadId,path,signedUrl,token,mime,size}`. 취소·노쇼로 끝나기 전 어느 단계든 가능(대기·완료 포함, 2026-10-07) |
| POST | `/reservations/{id}/consents/finalize` | `{uploadId}`, reservation version → 실제 파일 검증 후 연결 |
| GET | `/reservations/{id}/consent-url` | `{url}`. 기존 동의서를 여는 5분 유효 URL |
| DELETE | `/reservations/{id}/consent` | 첨부 연결 제거, reservation version |
| POST | `/operations/lookup` | `{operation:'PATCH:/reservations/<id>',key:'<저장 때 쓴 UUID>'}` → 본인 요청 상태·result |

동의서 업로드는 `signedUrl`에 파일을 PUT한 뒤 finalize를 호출한다. PDF/JPEG/PNG, 최대 10MiB. 파일 내용과 크기를 서버에서 검증한다. 첨부 교체 실패 시 기존 연결은 유지한다. task-agreement 비공개 버킷을 재사용한다.

## 예약 생성·수정 예시

기존 방문 작업에 연결:

```json
{
  "target": { "kind": "existingTask", "taskId": "<uuid>", "expectedTaskVersion": 3 },
  "locationId": "<본점 uuid>",
  "sourceText": "<고객 응답 원문>",
  "sheetText": "<담당자가 확인한 최종 기재 시트>",
  "deadlineMode": "default",
  "templateRevisionId": null
}
```

작업까지 새로 만들 때는 target을 `{ "kind":"createTask", "campaignId":"<uuid>", "personId":"<uuid>" }`로 바꾼다. 본점은 해당 캠페인의 클라이언트와 일치해야 한다. templateRevisionId가 있으면 해당 본점의 sheet 양식이어야 한다.

수정·확정은 `{ "sheetText":"<최종 시트>", "deadlineMode":"default", "reason":"customer_request" }`처럼 보낸다. 확정 전 수정은 reason 생략 가능. 확정 후에는 `customer_request` 또는 `correction`을 명시한다. 실제 변경이 있는 고객 요청만 회차로 센다. 정정은 요청 횟수에 포함하지 않는다.

시트 대신 `fields`의 변경 키를 보낼 수도 있다. `visitAt`·`preferred`·`preferred2`, `name`·`romanizedName`, `treatment`·`uploadDeadline` 등을 지원한다. 날짜·시간은 서울 현지 `YYYY-MM-DDTHH:mm` 또는 명시적인 시간대가 있는 ISO 값이다. 서로 모순되는 fields와 sheetText를 함께 보내면 거부한다. 업로드 기한의 기본 방식은 방문 후 14일이며 직접 지정은 `deadlineMode:'manual'`이다.

종료는 예약·시트·동의서·변경 내역을 보존한다. 작업에는 웹 취소와 같은 효과를 낸다 — 취소일·사유 칩·메모를 적고, 붙어 있던 원고는 떼어 다른 작업에 쓸 수 있게 하며(제목은 기억), 거절·무응답은 인플루언서 타임라인에 남긴다. 예약이 연결된 작업의 종료는 되돌릴 수 없다. 화면 버튼은 API의 allowedActions를 따르고, 서버도 현재 단계와 요청 횟수를 다시 판정한다. 기존 날짜 PATCH·취소·복원·교체·삭제 경로로 예약 기록을 우회 변경할 수 없다.

## 로컬 적용에서 남은 일

1. 소유자 승인으로 공유 staging에 065를 적용한다.
2. 익스텐션 레포에서 실제 서버 주소·공개 로그인 설정으로 개발 빌드를 만든다.
3. 사용자가 [로컬 테스트 절차](extension-v1-local-test.md)에 따라 웹 ↔ 익스텐션 연동 테스트를 진행한다.

main 머지·배포는 이 작업에 포함하지 않았다. 배포 전에 QA와 업데이트 소식 추가 절차를 별도로 진행한다.
