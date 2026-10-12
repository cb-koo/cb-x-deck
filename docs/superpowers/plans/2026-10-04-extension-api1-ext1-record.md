# API 1 / EXT 1 구현 기록 — 확장 로그인과 조회 API

작성일: 2026-10-04 · 브랜치 `feat/x-extension-product` · 선행: [WEB 0 / API 0 확인 결과](2026-10-04-extension-product-web0-findings.md)

[공통 API 계획](2026-10-04-extension-product-api-implementation.md) §11의 API 1(Bearer guard·proxy·session·resolve·badge·tasks)과 확장의 회사 로그인을 구현했다. 쓰기·예약 command·PDF는 아직 없다(`session.featureFlags`가 모두 false).

## 1 cb-x-deck

| 파일 | 내용 |
| --- | --- |
| `src/lib/extensionClaims.ts` | Bearer 형식, 만료 선판정(TOKEN_EXPIRED 분리), issuer·audience·subject 확인, 기존 `isAllowedUser`(회사 도메인 + Google) |
| `src/lib/extensionAuth.ts` | `requireExtensionMember` — 쿠키 없는 supabase-js로 `getClaims(jwt)` 서명 검증 → claims 판정 → `resolveMember` |
| `src/lib/extensionApi.ts` | `{data, meta}` / `{error, meta}` envelope, 확장 origin CORS·OPTIONS, 064 미적용 감지(503 `SERVER_NOT_READY`) |
| `src/lib/extensionTasks.ts` | 작업 분류(active/completed/ended)·D-day·정렬·cursor·DTO. 목록 items·total·배지 activeCount가 같은 `classifyTask` |
| `src/lib/extensionReadStore.ts` | 핸들 정확 매칭·숫자 ID 불일치 판정, 사람별 작업 사실 1회 조회(예약·종료·요청 횟수·정산 포함) |
| `src/app/api/extension/v1/…` | `GET /session`, `POST /people/resolve`, `POST /people/badges`, `GET /people/{id}/tasks`, `GET /tasks/{id}` |
| `src/proxy.ts` | `/api/extension/v1` 경계(접두사 안전 매칭)에서 쿠키 세션 갱신을 생략. 인증은 각 핸들러가 Bearer로 수행 |

## 2 cb_x_extension

| 파일 | 내용 |
| --- | --- |
| `src/extension/auth.ts` | `launchWebAuthFlow` + PKCE(S256). 토큰은 `chrome.storage.session`(trusted contexts). 만료 60초 전 갱신, 갱신 1개로 합침(회전 토큰 재사용 방지). 거부된 refresh는 연결 해제, 오프라인은 보존 |
| `src/extension/background.ts` | 로그인 직후 `/session`으로 서버 판정. 회사 계정이 아니면 즉시 연결 해제. 로그인·해제 메시지는 확장 페이지에서만 허용 |
| `src/extension/options.tsx` | 회사 계정 연결하기 / 연결 상태 확인하기 / 연결 해제 |
| `src/extension/partnerLookup.ts`, `content.tsx` | 1대1 DM 상대 → 등록 여부·진행 중 협찬 건수·최근 3건(단계·D-day). 늦은 응답 폐기, 실패를 미등록으로 표시하지 않음 |
| `scripts/build-extension.mjs` | `CB_SUPABASE_URL`·`CB_SUPABASE_ANON_KEY` 주입(운영 빌드 필수, service-role 키 거부), Supabase host 권한 추가 |

## 3 계약에서 정한 것

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 응답 envelope | 성공 `{data, meta}`. 확장 client가 `data`를 꺼낸다 | API 계획 §6. 확장 OpenAPI·fixture를 이에 맞춰 0.2.0으로 갱신 |
| allowedActions | 서버 `reservationPolicy.VisitAction` 그대로 | 서버가 정본. 확장의 이전 초안(`confirm_reservation`, `open_consent`)은 폐기 |
| 작업 종류 | 서버 `quoteRt` ↔ wire `quote_rt`, 변환은 `extensionTasks.WIRE_KIND` 한 곳 | |
| noteVersion·pricingVersion | **null** | 컬럼이 없다(API 2). 상수 1을 주면 이후 If-Match가 무의미해진다 |
| 작업 `dDay` | Task DTO에 추가(배지와 같은 값) | D-day는 서버 결과를 쓴다(계획 §3). 추가 필드라 v1 호환 |
| `webUrl` | `/campaigns/flow?id=<campaignId>` | `task=` 진입은 WEB 3 전까지 없음 — 열리지 않는 링크를 주지 않는다 |
| 콘텐츠 작업 완료 | 지급 완료 또는 `posted + noCost`. 금액 0은 무상이 아님 | 계획 §2 비용·완료 |
| 미등록 핸들의 작업 | `GET /tasks/{id}`는 404 | 확장은 상대 기준으로 작업에 들어온다 |
| 숫자 ID | 저장 ID와 관찰 ID가 둘 다 있고 다를 때만 `identity_mismatch`. 빈 값 자동 보강 없음 | web0 findings 보수안 |

## 4 검증

- cb-x-deck: `npx tsc --noEmit` 통과. `node --import tsx --test src/lib/extensionApi.test.ts` 15건 통과(기존 예약 순수 테스트 포함 48건). 새 파일 eslint 오류 없음.
- 로컬 서버(3100) curl: 5개 경로 모두 로드·401 envelope 응답. 헤더 없음·위조 토큰·anon 키 → 401 `AUTH_REQUIRED`, 만료 토큰 → 401 `TOKEN_EXPIRED`, OPTIONS는 개발 확장 origin에만 CORS 헤더, `/api/extension/v1x`는 경계 밖(404), 쿠키 없는 기존 API(`/api/me`)는 기존 401 문구 그대로, 페이지는 `/login` 리다이렉트 그대로. 쿠키 로그인 상태의 정상 경로는 브라우저에서 한 번 확인 필요. 전체 `npm test`(DB 통합)는 `.env.staging`이 없어 실행하지 않았다.
- 확장: `tsc -b` 통과, vitest 6파일 44건 통과, OpenAPI 3.1 검증 통과, 개발 패키지 빌드에 service-role 키 없음 확인.
- **아직 못 한 것:** 실제 Google 로그인 성공 경로(사용자 브라우저 필요), 064(방문 예약) 적용 전이라 작업 조회는 staging에서 503 `SERVER_NOT_READY`. 064를 적용하면 같은 코드로 동작한다.

## 5 로컬에서 확인하는 순서

[확장 연동 로컬 테스트 절차](../../api/extension-v1-local-test.md)로 옮겼다. 그 문서에 준비물, Redirect URL 등록, 빌드·로드, 058 전후 테스트 케이스, 문제 해결을 정리했다.

## 6 다음

- 064 staging 적용(소유자에게 요청) 후 실제 작업 조회 E2E.
- EXT 1 본 UI(A/B/C)로 패널 교체, 목록 배지(`/people/badges`) 연결.
- API 2: 메모·단가 version 컬럼과 PATCH, 클리닉 설정·캘린더.
- main 머지 직전 `src/content/updates.ts` 항목 추가(AGENTS.md). 이번 단위는 화면 변화가 확장 쪽뿐이라 `내부` 또는 확장 공개 시점의 `새 기능` 한 건으로 묶는다.
