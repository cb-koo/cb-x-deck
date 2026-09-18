# X 마케팅 비용 전달 API (cb-x-deck → LINE 대시보드)

이 문서는 cb-x-deck(이하 **"소스"**, 우리)가 만든 X(트위터) 마케팅 비용을 LINE 메시지 대시보드(이하 **"그쪽"**)가 폴링(GET)으로 가져가는 연동 API를 설명한다. 그쪽 원본 요청 스펙은 `linemessagedashboard/docs/api/cb-x-deck-marketing-cost-export.md`(2026-09-18)이고, 이 문서는 그에 대한 **우리 쪽 구현·확정본**이다(그쪽 부록 B "확인 필요 항목"의 답).

## 1. 개요

- **엔드포인트 1개, POST 없음.** 그쪽이 기간을 정해 GET으로 당겨가고, 우리는 정산 요청(`payment_request`)을 클리닉·비용 종류별로 넘긴다. 우리 화면에 바뀌는 것은 없다.
  - `GET /api/external/marketing-costs?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=500&page=1`
- **DB에 따로 저장하지 않는다.** 요청 시점에 `payment_request`를 그대로 읽어 넘긴다. 그쪽도 저장하지 않고 매번 새로 당겨가므로, 취소·수정이 자동으로 반영된다.
- **환경**

  | 환경 | Base URL |
  |---|---|
  | 스테이징(연동 개발·QA) | `https://cb-x-deck-staging.vercel.app` |
  | 운영(프로덕션) | `https://cb-x-deck.vercel.app` |

  최종 경로는 `/api/external/marketing-costs`다(그쪽 스펙의 `/api/marketing-costs`와 접두어가 다르다 — 우리 외부 API는 `/api/external/*` 아래에 둔다). 스테이징·운영은 완전히 별도의 DB·배포이니 연동 개발·QA는 반드시 스테이징에서 먼저 한다.

## 2. 인증

모든 요청에 다음 헤더가 필요하다(그쪽 스펙 §2.2 그대로).

```
x-api-key: <API 키>
```

- 키는 우리 env `MARKETING_EXPORT_API_KEY`와 상수 시간으로 비교한다. **fail-closed**: env 미설정이거나 키 불일치면 **401**(본문 없음, 정상/오류 구분 없음 — 키 오라클 방지).
- 정산 API(`Authorization: Bearer`)와는 **다른 헤더·다른 키**다. 서로 섞어 쓸 수 없다.
- 키는 1:1 채널로 별도 전달한다. 이 문서·커밋·로그에 값을 싣지 않는다. 스테이징 키와 운영 키는 다른 값이다.

## 3. 요청 파라미터

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `from` | ✅ | 조회 시작일(**포함**). **KST** `YYYY-MM-DD`. 형식 오류·누락은 400 |
| `to` | ✅ | 조회 종료일(**포함**). **KST** `YYYY-MM-DD` |
| `limit` | 선택 | 페이지당 행 수. 기본 **500**, 최대 **2000**. 1년치를 몇 요청에 당기려면 `limit=2000` 권장 |
| `page` | 선택 | 1부터. 기본 1 |

> **1년치 조회**: 이 엔드포인트는 PostgREST가 아니라 DB 직결이라 1000행 상한이 없다. `limit=2000`이면 X 정산 요청 볼륨상 1년치가 대개 1페이지(많아도 2~3페이지, `totalPages`로 순차 조회)에 들어온다. 그 이상은 응답이 무거워져 상한을 2000으로 둔다.

- `from`/`to` 필터·정렬 기준은 **귀속일**(게시일)이다 — **지급 요청일(`created_at`)이 아니다**(LINE 대시보드 변경요청 2026-09-18로 변경. 지급요청은 게시 며칠 뒤 배치로 생겨 주 경계에서 캠페인이 쪼개졌다). 귀속일 정의는 §4.2. 정렬은 귀속일 오름차순 + `id` 보조 정렬(페이지 간 누락/중복 방지).
- `from`/`to`는 **양끝 포함**(귀속일 `>= from` AND `<= to`)이다. 귀속일이 date라 날짜 그대로 비교한다.

## 4. 응답

`Content-Type: application/json`. 그쪽 스펙 §2.3 봉투와 호환된다.

```json
{
  "success": true,
  "total": 3,
  "page": 1,
  "limit": 500,
  "totalPages": 1,
  "data": [
    { "id": "xdeck:<uuid>", "timestamp": "2026-09-08 00:00:00", "clinicId": "mimodreamjp", "clinic": "미모드림의원",
      "category": "x_content_quote_rt", "amountKrw": 52630, "currency": "JPY", "originalAmount": 5263, "splitCount": 1 }
  ]
}
```

- 데이터가 없으면 `200 + {"success":true,"data":[],"totalPages":1}`. 인증·기간 오류만 각각 401·400.
- `totalPages`가 2 이상이면 `page`를 올려가며 순차 조회한다.

### 4.1 행 필드

| 필드 | 규칙 |
|---|---|
| `category` | §5의 enum 키. 우리는 **작업 유형(task_type)** 으로 정한다 |
| `amountKrw` | **`payment_request.gross_krw`** — 수수료 포함 **실지급 원화(정수)**. "실제 나간 돈" (koo 확정 2026-09-18) |
| `timestamp` | KST `YYYY-MM-DD 00:00:00` — **귀속일**(§4.2). 게시일엔 시각이 없어 항상 `00:00:00`. 제자리 수정에도 안 바뀐다 |
| `clinicId` | LINE 슬러그(§6). `client.id` 고정 매핑 우선, 없으면 `clinic_code` 폴백 |
| `clinic` | 클라이언트 한글명(요청 시점 스냅샷). 폴백용 |
| `id` | `xdeck:<payment_request.uuid>`. 추적·중복제거용 |
| `currency` | 지급(요청) 통화(`payout_currency`) |
| `originalAmount` | 환산 전 지급액(`amount_gross`, 요청 통화). 참고용, 집계엔 미사용 |
| `splitCount` | 항상 1 — 우리 요청은 이미 클리닉 단위라 배분이 없다 |

### 4.2 귀속일 (`timestamp`·`from`/`to` 필터·정렬 기준)

`timestamp`와 기간 필터·정렬은 모두 **귀속일**을 쓴다(지급요청일 `created_at`이 아니다 — LINE 대시보드 변경요청 2026-09-18). 작업 유형별로 다르다.

| 작업 유형 → `category` | 귀속일 |
|---|---|
| `post`·`quoteRt` → `x_content_quote_rt` | **게시일** `task_posted_on` |
| `visit` → `x_visit_manuscript` | **게시일** `task_posted_on` |
| `rt` → `x_secondary_viral` | **캠페인 시작일** `campaign_starts_on` |

- **`rt`가 캠페인 시작일인 이유**: RT는 실제 리트윗 시각(`posted_at`)이 없고 담당자 확인일뿐이라, 주차 귀속엔 캠페인 시작일 앵커링이 안정적이다(대시보드 측 결정).
- **폴백(값이 null일 때)**: `task_posted_on` → `campaign_starts_on` → `created_at`(서울 자정 기준 date). 054 백필 전 옛 요청도 날짜가 비어 누락되지 않게. 정리하면
  - `rt`: `campaign_starts_on ?? created_at`
  - 그 외: `task_posted_on ?? campaign_starts_on ?? created_at`
- 필요한 컬럼(`task_posted_on`·`campaign_starts_on`)은 마이그레이션 054(koo 2026-09-14)에 이미 있다 — 새 마이그레이션 없음.
- 게시일은 date라 시각이 없으므로 `timestamp`는 항상 `YYYY-MM-DD 00:00:00`. WHERE·ORDER BY·SELECT가 모두 같은 귀속일 식을 써 필터·표시·정렬이 함께 움직인다(`src/lib/settlementStore.ts` `listMarketingCosts`의 `attrDate`).

### 4.3 집계에 넣는 행의 조건

- `status <> 'cancelled'`(취소만 제외). 그쪽 정산 프로덕트가 취소한 건도 `status='cancelled'`로 떨어져 한 조건이 둘을 덮는다. (§7-6: `status`는 DB CHECK로 `{requested, cancelled}` 뿐이라 `= 'requested'`와 현재 동일하나, 미래 상태값 추가에 안전하도록 `<> 'cancelled'` 채택.)
- `client.id` 고정 매핑 또는 `client.clinic_code`가 있는 클라이언트만(둘 다 없으면 그쪽이 집계에서 제외하므로 애초에 안 보낸다 — §6).
- 자동 테스트 픽스처는 제외(2026-09-09 사고 재발 방지 — 정산 API와 같은 필터).

## 5. `category` enum (작업 유형 → 키)

우리는 자유 텍스트(정산 카테고리)가 아니라 **작업 유형**으로 카테고리를 정한다. 정산 카테고리는 설정에서 편집할 수 있어 코드 변경 없이 흔들리지만, 작업 유형은 고정 4종이고 그쪽 부록 A·`0918.md`가 옛 "프로모션 RT·인용RT" 버킷을 **인용RT(콘텐츠)** 와 **RT(2차 바이럴)** 로 가르는 경계와 정확히 일치한다.

| 작업 유형 | → `category` | 뜻 |
|---|---|---|
| `post`(투고), `quoteRt`(인용RT) | `x_content_quote_rt` | X 콘텐츠 게시 및 인용 RT |
| `rt`(RT) | `x_secondary_viral` | X 2차 바이럴 작업 (RT, 댓글) |
| `visit`(방문협찬) | `x_visit_manuscript` | X 방문형 협찬 원고 |
| — | `x_visit_etc` | **현재 미전송**(아래 §7 참조) |

## 6. 클리닉 식별자 (`clinicId`)

`clinicId`로 나가는 값은 그쪽 스펙 §5의 **LINE 슬러그**다. 다만 어느 클라이언트가 어느 슬러그인지는 **cb-x-deck의 `client.id`(불변 UUID)에 고정 매핑**해서 정한다 — 편집 가능한 `clinic_code`나 한글명은 표기가 흔들릴 수 있어서다(예: '마인드스킨클리닉'↔'마인드피부과', '닥터손유나클리닉'↔'손유나클리닉'). 매핑 표는 `src/lib/marketingCostExport.ts`의 `CLIENT_ID_TO_CLINIC_ID`에 있다(koo 2026-09-18 확정).

| `client.id` (cb-x-deck) | → `clinicId` | 클리닉 |
|---|---|---|
| `6a2405e8-…-06e5a6e25641` | `mimodreamjp` | 미모드림 |
| `70baf347-…-4bb18cca50ff` | `maindskinjp` | 마인드스킨클리닉 |
| `904cb696-…-803033f5fbe2` | `sonyounajp` | 닥터손유나클리닉 |
| `3e9e4e61-…-df72a7bd32d5` | `thesquaredentaljp` | 더스퀘어치과 |

- 위 표에 없는 클라이언트는 `client.clinic_code`(리포트 연동에서 쓰던 슬러그 컬럼, 마이그레이션 052)를 **폴백**으로 쓴다. 스테이징·테스트 DB는 UUID가 달라 이 폴백을 탄다. 둘 다 없는 클라이언트는 집계에서 제외한다.
- 신규 클리닉은 이 표에 `client.id`와 슬러그를 추가한다(한 줄).

## 7. 검토에서 나온 확인 필요 항목 (양 팀 합의용)

그쪽 부록 B와 우리 구현을 대조하며 나온 것. **연동 전에 맞춰야 할 것들**이다.

1. **`x_visit_etc`(방문 기타·실비)는 지금 나가지 않는다 — 📌 BACKLOG(koo 2026-09-18, 아직 케이스 없음).** cb-x-deck는 방문 비용을 원고/기타로 가르지 않고, 교통·실비는 `campaign_influencer_cost.extra_costs`에 있는데 이 값은 인플에게 송금하는 돈이 아니라 **정산 요청(`payment_request`)으로 흐르지 않는다**. 이 API는 정산 요청을 소스로 하므로 기타 비용은 소스가 없다. enum 키·자리는 `x_visit_etc`로 남겨 뒀다.
   - **착수 트리거**: 방문형 협찬의 교통·시술·실비를 LINE 마케팅 비용 표에 실제로 넣어야 하는 건이 생겼을 때.
   - **해야 할 일(별도 스펙)**: `extra_costs`를 소스로 추가하되, ① `timestamp`(기간 필터 기준)를 무엇으로 잡을지(캠페인 기간/게시일), ② 취소·요청됨 같은 라이프사이클이 없으니 집계 포함 규칙, ③ 원화 환산·클리닉 매핑 경로를 정해야 한다. `payment_request` 경로와 성격이 달라 그대로 얹을 수 없다.
2. **"댓글"은 별도 작업 유형이 없다.** `x_secondary_viral`의 "(RT, 댓글)" 중 댓글은 cb-x-deck에 유형이 없어 **RT만** 이 키로 나간다.
3. **`thesquaredentaljp`(더스퀘어치과) 포함 4개 클리닉은 `client.id` 고정 매핑으로 해결했다**(§6). 편집 가능한 드롭다운/`clinic_code`에 기대지 않으므로 표기 흔들림·미설정에 안전하다. 블리비(`velybjp`)는 **현재 X 협찬을 진행하지 않아 cb-x-deck에 데이터·`client.id`가 아직 없다** — 나갈 비용 자체가 없으므로 누락 이슈가 아니다. X 협찬을 시작해 client가 생기면 그때 그 `client.id`를 §6 표에 한 줄 추가한다. 📌 BACKLOG(koo 2026-09-18).
4. **한글명 표기 차이는 무해하다.** `clinicId`(슬러그)로 매핑하고 그 슬러그는 `client.id`에 고정돼 있어, `clinic`(한글명)이 '마인드스킨클리닉'/'마인드피부과' 어느 쪽이든 집계에 영향이 없다.
5. **금액 기준은 `gross_krw`(수수료 포함 실지급 원화)로 확정**(koo 2026-09-18). 단가(`amount_krw`)가 아니라 실제 나간 돈이다.
6. **집계 범위는 "요청됨 전부(취소 제외)"** — 지급 완료 건만이 아니라 요청된 시점부터 집계에 들어간다(확정된 지출 약정). Apps Script 구데이터의 "비용 입력 시점" 성격과 같다.
   - **필터는 `status <> 'cancelled'`(취소만 제외). 지급 완료돼도 표에서 빠지지 않는다.** `payment_request.status`는 DB 제약(`040_payment_request.sql`: `check (status in ('requested','cancelled'))`)으로 **`requested`/`cancelled` 두 값만** 가진다. "지급 완료"는 별도 컬럼 `external_status`(`received·scheduled·paid·on_hold·cancelled`, `041`)에 들어가고, 트리거 `payment_request_guard_paid`가 `external_status='paid'` 후 `status` 변경을 잠근다. 지급 완료 시 `status`는 `requested` 그대로이므로 집계에서 사라지지 않는다. 현재는 `= 'requested'`와 동일하나, 미래에 상태값이 추가돼도 "취소 아닌 것 전부"가 흔들리지 않도록 `<> 'cancelled'`로 둔다.
7. `x_content_quote_rt`를 그쪽 표의 어느 행에 합칠지(정보성 콘텐츠 행 vs 별도 행)는 **대시보드 측 책임**이다(그쪽 부록 A). 우리는 키만 정확히 보낸다.

## 8. 성능·에러

- 인증 실패 401(본문 없음), 기간 오류 400, 데이터 없음 200(빈 배열), 서버 오류 5xx.
- `count(*)`와 목록은 같은 WHERE를 쓴다(total·totalPages 정합). 응답 캐시 없음(`Cache-Control: no-store`).
- 모든 호출은 정산 API와 같은 `external_api_log`에 기록된다.

## 9. 롤아웃 계획 (확정본 §9, koo 2026-09-18 — 스테이징 생략)

**결정: 스테이징 배포를 생략하고 운영으로 직행한다.** 검증 공백은 아래 안전장치로 메운다.

- **검증 공백**: 스테이징 배포를 안 쓰면 운영이 실제 쓰는 `CLIENT_ID_TO_CLINIC_ID` 경로를 배포 전 E2E로 태워 볼 수 없다. 단, 슬러그 해석은 단일 함수(`resolveClinicId`) + 맵 우선순위 **단위테스트로 검증**돼 있어, 검증 대상은 "코드"가 아니라 "운영 실데이터의 UUID·슬러그 값"으로 좁혀진다.
- **안전장치 ①(소비자 코드)**: 대시보드는 **매핑 안 되는 슬러그를 크래시 없이 스킵**한다(확정본 §5). 잘못된 슬러그가 나가도 그 소스만 degrade, 전체 표는 안 죽는다.
- **안전장치 ②(운영 dry-run)**: 운영 배포 직후 **좁은 기간(예: 하루치)** 을 한 번 당겨 슬러그(`mimodreamjp` 등)·금액·기간 필터를 눈으로 확인한다. 별도 배포가 아니라 조회 1회.

> 참고: **테스트(`npm test`)는 여전히 연습용(스테이징) DB에서 돈다** — 이건 배포 환경이 아니라 테스트 DB 얘기라 "스테이징 배포 생략"과 무관하다.
