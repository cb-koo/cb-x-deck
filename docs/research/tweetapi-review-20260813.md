# TweetAPI(tweetapi.com) 검토 — getxapi 대체 가능성

- 조사일: 2026-08-13
- 대상: https://tweetapi.com/ , https://tweetapi.com/docs/*, https://github.com/tweetapi/{node,python}, PyPI `tweetapi`
- 방법: 공식 사이트/문서 페이지 직접 열람(Exa fetch) + 보충 웹 검색. `docs.tweetapi.com`, `llms.txt`, `llms-full.txt`는 존재하지 않음(fetch 실패, 404/에러) — 문서는 `tweetapi.com/docs/...` 경로에 있음.
- 표기 원칙: 문서에 명시된 것만 확인(✅)으로 적었고, 마케팅 문구와 실제 파라미터/응답 스펙이 다른 경우 둘을 구분해서 썼다. 확인 못 한 항목은 "문서에 없음"으로 표기.

**검토 배경**: cb-x-deck은 현재 getxapi(Bearer 키 스크래핑형 REST, OAuth·X 개발자 계정 불필요)를 쓰고 있다. tweetapi.com이 대체 후보로 오른 이유는 "암호화 DM(X Chat)을 제공한다"는 점 때문이다. getxapi는 X Chat에 접근하지 못한다.

---

## 0. 핵심 요약 (TL;DR)

1. **암호화 DM(X Chat)은 실제로 API로 노출되어 있다** — `setup` / `send` / `getConversations` / `getHistory` / `canDm` 5개 엔드포인트. 단, **암호화를 "우회"하는 게 아니라, X의 공식 X Chat 프로토콜(PIN 기반 Juicebox 키 복구)을 그대로 자동화 대행**하는 방식이다. 이 과정에서 사용자의 `authToken`(세션 쿠키)과 **X Chat PIN**을 TweetAPI 서버에 넘겨야 하며, TweetAPI가 대신 로그인해 키를 복구/보관하는 것으로 보인다. 결과적으로 "X도 못 읽는다"는 E2EE의 신뢰 경계에 제3자(TweetAPI)가 끼어드는 구조다 — 이는 마케팅 문구("End-to-end encrypted DMs with libsodium")가 강조하는 지점과 실제 리스크(계정 자격증명+PIN을 제3자에게 위임)가 다르다는 뜻이다.
2. **일반(비암호화) DM은 getxapi 대비 오히려 더 넓다** — 전송/받은함(신뢰함·요청함 분리)/대화조회/DM 권한확인/DM 업데이트 폴링/미디어 첨부까지 문서화되어 있다. getxapi에도 `send_direct_message`/`list_direct_messages`/`get_direct_message_conversation`가 있어 이 영역은 병행 가능.
3. **계정 모니터링(신규 트윗 웹훅)은 tweetapi에 없다.** getxapi는 `monitor`/`webhook` 전용 엔드포인트(구독형, 콜당 과금 없음)를 제공하지만, tweetapi 문서·SDK 어디에도 monitor/webhook API가 없다. tweetapi 자체 블로그의 "브랜드 모니터링" 가이드도 **클라이언트가 직접 폴링(cron)하는 파이썬 스크립트**일 뿐, 서버 쪽 웹훅 기능이 아니다.
4. **쓰기 계열 엔드포인트(DM 전송·트윗 작성·좋아요 등) 다수가 `proxy` 파라미터를 요구한다**(`send-dm`, `create-post`, `reply-post`는 required). 이는 X의 자동화 탐지를 피하기 위해 사용자가 별도로 레지덴셜 프록시를 구해 붙여야 한다는 뜻이고, 운영 복잡도와 계정 정지 리스크를 모두 끌어올리는 신호다.
5. **회사 자체가 매우 신생이다** — GitHub org 생성 2026-04-01(조사 시점 기준 약 4.5개월), 독립 리뷰 없음(SaaSHub 페이지는 빈 템플릿), EU 소재 법인이라는 것 외 확인 불가.
6. **권고: 전면 대체는 부적합, "병행(DM만 tweetapi 시범)"도 조건부 — 현재는 도입 보류(도입 안 함)를 권한다.** 이유는 결론(§4) 참조.

---

## 1. 암호화 DM(X Chat) — 최우선 검토 항목

### 1-1. 실제로 읽기/쓰기 가능한가, 어떤 엔드포인트인가

문서상 X Chat 카테고리는 5개 엔드포인트로 구성된다(`tweetapi.com` 홈페이지 문구: "X Chat — 5 — End-to-end encrypted DMs with libsodium — Setup / List Conversations / Send Message +2 more"):

| 엔드포인트 | 메서드 경로 | 기능 |
|---|---|---|
| Setup | `POST /tw-v2/xchat/setup` | 계정의 X Chat(암호화 DM) 초기화 — 최초 1회 필요 |
| List Conversations | (Node) `client.xchat.getConversations({ authToken })` | 암호화 대화 목록 조회 |
| Send Message | `POST` (Node: `client.xchat.send`) — 문서 URL `tweetapi.com/docs/xchat/send` | 암호화 메시지 전송 |
| Get History | (Node) `client.xchat.getHistory({ authToken, conversationId })` | 대화 기록(복호화된 메시지) 조회 |
| Can DM | `POST /tw-v2/xchat/can-dm` | 특정 유저가 X Chat으로 DM 받을 수 있는지(공개키 보유 여부) 확인 |

즉 **읽기/쓰기 모두 문서상 지원**된다고 나와 있다(실제 호출 테스트는 하지 않음 — API 키 없이는 검증 불가, "문서에 없음" 수준이 아니라 "미검증"으로 별도 표기).

### 1-2. "암호화"를 어떻게 다루는가 — 우회인가, 정식 절차 대행인가

`POST /tw-v2/xchat/setup` 파라미터:

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `authToken` | 필수 | 계정 인증 토큰(`auth_token` 쿠키 값) |
| `userId` | 필수 | 내 플랫폼 유저 ID |
| `pin` | 필수 | **공식 앱에서 이미 설정해 둔 X Chat PIN(4~6자리)** |
| `proxy` | 선택 | 프록시 |

문서에 명시된 주의문: *"You must have X Chat already set up in the official app before using this endpoint."* — 즉 tweetapi가 X Chat을 처음부터 새로 만들어주는 게 아니라, **사용자가 X 공식 앱에서 이미 활성화한 X Chat 계정에 대해, 그 PIN을 tweetapi 서버에 제출해 세션을 복구/초기화**하는 구조다.

X Chat(=X의 신규 E2EE 메시징)의 실제 암호화 설계는 Signal 계열 더블래칫 + **Juicebox**라는 분산 비밀 저장 프로토콜을 쓴다는 것이 외부 암호학자 분석(Matthew Green, "A bit more on Twitter/X's new encrypted messaging", 2025-06)으로 확인된다. Juicebox는 "사용자 PIN → 서버 3곳에 샤딩된 비밀과 혼합 → 강한 키 도출"이라는 절차라서, **PIN 자체가 곧 개인키 복구의 핵심 자격증명**이다.

따라서 tweetapi의 `setup` 호출은:
- 암호 알고리즘 자체를 깨거나 우회하는 게 아니라, **X가 공식적으로 요구하는 "로그인 + PIN 입력" 절차를 서버 사이드에서 사용자 대신 수행**하는 것으로 보인다(추정 — tweetapi가 내부적으로 Juicebox 복구 절차를 그대로 재현하는지, 자체 백엔드에 다른 방식을 쓰는지는 **문서에 없음**).
- 결과적으로 **TweetAPI 서버가 사용자의 X 계정 자격증명(authToken)과 X Chat PIN을 동시에 보관/처리**하게 되고, `getHistory`(대화 기록=복호화된 메시지) 호출도 이후 `authToken`만으로 가능한 것으로 보인다 — 즉 **한 번 setup 후에는 tweetapi가 계속 복호화된 메시지를 대신 읽어서 넘겨주는 상태**가 된다는 뜻이다.
- **이 지점이 핵심 리스크다**: X 본사도 원칙상 못 읽는다고 홍보하는 암호화 DM을, "본인 계정을 대행하는 제3의 SaaS 업체"가 PIN까지 쥐고 상시로 열어볼 수 있는 위치에 서게 된다. 이는 암호학적 결함이 아니라 **신뢰 경계(trust boundary)의 이동** 문제이며, 계정 자격증명 유출·오남용 시 피해 범위가 "공개 데이터 스크래핑"보다 훨씬 크다(개인 대화 내용 + 로그인 세션 + PIN).
- 참고로 X Chat 자체의 암호학적 완성도에 대해서도 외부 전문가 평가는 우호적이지 않다("XChat isn't great" — Green). 즉 원본 프로토콜부터 논쟁이 있는 상태에서, 거기에 신생 제3자 업체가 자격증명 대행 계층을 하나 더 얹는 구조다.

### 1-3. 일반(비암호화) DM

`unencrypted-dm` 카테고리(문서 경로 `tweetapi.com/docs/unencrypted-dm/*`)에 확인된 엔드포인트:

| 기능 | 엔드포인트 | 필수 파라미터 | 비고 |
|---|---|---|---|
| DM 전송 | `POST /tw-v2/interaction/send-dm` | `authToken`, `conversationId`, `text`, **`proxy`(필수)** | 미디어 1개 첨부 가능(`{url}` 또는 `{data, type}`), 최대 10,000자 |
| 대화 조회 | `GET /tw-v2/interaction/conversation` | `authToken`, `conversationId` | 커서 페이지네이션 |
| DM 권한 확인 | `GET /tw-v2/interaction/dm-permissions` | `authToken`, `recipientIds`(최대 50개) | 상대가 DM 받을 수 있는지 사전 체크 |
| 받은함 초기 상태 | `GET /tw-v2/interaction/inbox-initial-state` | `authToken` | 대화 목록+커서, `dm-user-updates` 폴링용 시작점 |
| 받은함 업데이트(폴링) | `GET /tw-v2/interaction/dm-user-updates` | `authToken` | 신규 메시지 폴링 |
| 신뢰함/요청함 구분 | SDK: `getInboxTrusted` / `getInboxUntrusted` / `acceptConversation` | `authToken` | "message request"(낯선 사람) 수락 흐름까지 지원 |

- **수신 웹훅은 없음** — "문서에 없음". DM 신규 수신 확인은 `dm-user-updates` 커서 **폴링** 방식만 문서화되어 있다(웹훅 아님).
- **미디어 첨부 가능**: 이미지/GIF/영상, DM당 최대 1개, URL 또는 base64 인라인.
- 쓰기(전송) 엔드포인트는 `proxy`가 **required**, 읽기(조회/권한확인/받은함) 엔드포인트는 `proxy`가 optional — 즉 "전송"만 프록시를 강제한다(자동화 탐지 회피 목적으로 보임).

---

## 2. getxapi 기능 커버리지 체크 (tweetapi 기준 ✅/⚠️/❌)

### 현재 사용 중인 기능

| 기능 | tweetapi 대응 | 상태 |
|---|---|---|
| 트윗 고급 검색(연산자) | `GET` 검색, SDK `client.explore.search(query, type)` — `min_faves:N`, `min_retweets:N`, `min_replies:N`, `-min_faves:N` 등 문서 확인 | ✅ |
| 유저 타임라인 | `client.user.get_tweets(user_id)`, `get_tweets_and_replies(user_id)` | ✅ |
| 유저 정보(팔로워·인증·프로필이미지) | `client.user.get_by_username`/`get_by_user_id` 응답에 `followerCount`, `verified`, `isBlueVerified`, `avatar`, `banner`, `profileImageShape` 등 포함(예시 응답으로 확인) | ✅ |
| 트윗 상세 | `GET /tw-v2/tweet/details`(=`getDetailsAndConversation`), `details-by-ids`(최대 200개) | ✅ |
| 트윗 답글 | `getDetailsAndConversation`이 상세+대화(답글) 함께 반환(문서: "Get tweet details and replies") — 답글 전용 별도 엔드포인트는 아님 | ✅ (통합형) |

### 도입 검토 중인 기능

| 기능 | tweetapi 대응 | 상태 | 비고 |
|---|---|---|---|
| DM 전송 | `send-dm` | ✅ | `proxy` 필수, 미디어 1개 첨부 |
| DM 받은함 | `inbox-initial-state`, `getInboxTrusted`/`getInboxUntrusted` | ✅ | 신뢰함/요청함 분리 |
| DM 대화 조회 | `conversation` | ✅ | 커서 페이지네이션 |
| 계정 모니터링(신규 트윗 감지) | — | ❌ | 문서·SDK에 monitor 엔드포인트 없음 |
| 웹훅(모니터링 알림) | — | ❌ | 문서에 webhook 개념 자체가 없음. 자체 블로그 가이드도 클라이언트 폴링 스크립트일 뿐 |
| 유저 검색 | `explore.search(type="People")` | ✅ | 별도 "search-users" 엔드포인트가 아니라 통합 검색의 type 파라미터로 구현 |
| 팔로우 관계 확인 | `client.user.check_follow(subject_id, target_id)` | ✅ | |
| X 리스트 멤버 조회 | `client.list.get_members(list_id)` | ✅ | 리스트 상세/트윗/팔로워/멤버추가·삭제까지 세트로 존재 |
| 트윗 작성 | `create_post`, `create_post_quote`, `create_post_with_media`, `reply_post`, `delete_post` | ✅ | `authToken`+`proxy` 필수(대부분) |
| 미디어 업로드 | 독립 업로드 엔드포인트가 아니라 `create_post_with_media`/DM `media` 파라미터에 URL 또는 base64(`{data, type}`)를 인라인으로 넘기는 방식 | ⚠️ | getxapi의 별도 `upload_media`(업로드→media_id 발급→첨부) 2단계 흐름과 다름 — 마이그레이션 시 첨부 로직 재작성 필요 |

---

## 3. 운영 특성

### 3-1. 인증 방식

- **API 키(`X-API-Key` 헤더)**: 공개 데이터 조회용. `tweetapi.com` 대시보드에서 발급, X 개발자 계정 불필요 — getxapi와 동일한 철학.
- **계정 인증(쓰기/DM/X Chat)**: `authToken`(=X의 `auth_token` 쿠키 값)을 요청 바디에 **평문으로** 넘긴다. 이를 어떻게 얻는지는 SDK에 `client.auth.login(username, password, proxy)` — 즉 **아이디/비번을 tweetapi 서버에 직접 제출해 로그인 대행**을 시키는 방식이 있다는 것이 PyPI 문서에서 확인된다(README: `client.auth.login(username=..., password=..., proxy=...)` → "Log in, get auth tokens"). getxapi도 유사하게 `x_login`/`user_login_v2`가 있어 이 구조 자체는 두 서비스가 공유하는 "스크래핑형 API"의 일반적 패턴이다.
- **계정당 단일 세션**: 문서상 계정별로 여러 `authToken`을 동시에 관리하는 멀티 계정 전용 기능(계정 풀, 세션 매니저 등)은 **문서에 없음**. 호출 시마다 파라미터로 `authToken`을 넘기는 구조라 애플리케이션 쪽에서 직접 다중 계정을 관리해야 한다.
- **X Chat만 추가로 PIN 필요**: 위 §1-2 참조.

### 3-2. 가격 체계 (getxapi $0.001~0.002/call 대비)

tweetapi는 **월 구독 + 요청 할당량 + 분당 rate limit** 모델이며, getxapi처럼 콜당 종량제가 아니다.

| 플랜 | 가격 | 월 요청 할당량 | 분당 rate limit | 요청당 환산 단가 |
|---|---|---|---|---|
| Free | $0(1회성) | 100회(1회성) | 10/분 | — |
| Pro | $17/월 | 100,000/월 | 60/분 | 약 $0.00017/call |
| Ultra | $57/월 | 500,000/월 | 120/분 | 약 $0.000114/call |
| Mega | $197/월 | 2,000,000/월 | 180/분 | 약 $0.0000985/call |

- **요청당 단가 자체는 getxapi(0.001~0.002)보다 5~20배 낮다.** 다만 이는 **월 정액 선구매** 구조라, 사용자 2~5명 수준의 저사용량 팀은 실제 소비량과 무관하게 매달 최소 $17을 내야 하고, getxapi의 "쓴 만큼만 낸다" 종량제보다 유휴 비용이 발생할 수 있다.
- Monitoring/webhook 같은 별도 구독형 상위 플랜은 tweetapi에 존재하지 않음(기능 자체가 없으므로).
- **주의**: `create-post`/`send-dm`류의 계정 인증 필요 엔드포인트가 이 요청 할당량에 포함되는지, 별도 과금 체계가 있는지는 **문서에 명확한 표가 없음**(가격 페이지는 "공개 엔드포인트 카테고리 접근"만 명시하고 있어, 계정 인증 엔드포인트의 과금 방식은 "문서에 없음"으로 남겨둠).

### 3-3. Rate limit

가격 페이지 표 그대로: Free 10/분, Pro 60/분, Ultra 120/분, Mega 180/분. `429` 응답 시 `Retry-After`/`X-RateLimit-*` 헤더를 **주지 않는다**고 문서에 명시(에러 메시지를 직접 파싱해서 "요청 할당량 초과"인지 "분당 한도 초과"인지 구분해야 함) — 이는 getxapi 대비 운영 편의성이 떨어지는 지점이다.

### 3-4. 신뢰성 신호

- **운영 기간**: GitHub 조직(`github.com/tweetapi`) 생성일 2026-04-01 — 조사 시점(2026-08-13) 기준 **약 4.5개월** 된 신생 서비스. 블로그 포스트도 2026-01~08 사이에 몰려 있음.
- **평판**: 독립적인 사용자 리뷰를 찾지 못했다. SaaSHub 페이지는 실제 리뷰가 아니라 "SimilarWeb/Ahrefs/Reddit에서 직접 찾아보라"는 안내 템플릿뿐이었다. Reddit(make.com 커뮤니티)에서 발견된 언급은 `tweetapi.com`이 아니라 `xtweetapi.com`(다른 서비스, 이름이 유사해 혼동 주의)에 대한 것이었다.
- **문서 품질**: 엔드포인트별 파라미터 표, curl/JS 예시, 에러 코드 정의가 일관되게 잘 갖춰져 있음 — 이 점은 긍정적.
- **상태 페이지**: `tweetapi.com/status` 존재(공개 업타임/인시던트 페이지). 다만 조사 시점에 구체적 수치를 확인하지 못함 — "문서에 없음"에 준함(페이지 존재는 확인, 과거 이력 수치는 미확인).
- **법인 정보**: 이용약관에 "TweetAPI is operated and registered in the European Union"이라고만 명시. 구체적 법인명·국가는 **문서에 없음**.

### 3-5. 계정 제재 리스크에 대한 tweetapi의 입장

- 자체 블로그("Get Twitter Data Without a Developer Account")에서 웹 스크래핑 방식은 "ToS 위반, IP 차단, 계정 정지, 서면 경고, 법적 조치 리스크"가 있다고 명시하면서, **자사 서비스는 그와 별개의 "독립 서드파티 API"로 포지셔닝**한다. 그러나 계정 인증이 필요한 엔드포인트(로그인 대행, 쓰기 작업, DM, X Chat)는 사실상 사용자의 실제 X 계정 세션을 자동화하는 것이므로, **X의 자동화 탐지 정책 위반 리스크는 그대로 사용자에게 전가**된다.
- `create-post`/`reply-post`/`send-dm`에 `proxy`를 **필수**로 요구한다는 것 자체가 "탐지를 피하려면 프록시를 쓰라"는 암묵적 신호이며, 반대로 말하면 **프록시 없이 쓰면 계정이 더 쉽게 걸릴 수 있다**는 뜻이다.
- 이용약관은 표준적인 "as is, 무보증, 위반 시 계정 정지" 조항만 있고, **계정 정지·밴 발생 시 tweetapi가 책임지거나 보상한다는 조항은 없음**("문서에 없음" — 오히려 면책 조항만 확인됨).

### 3-6. 응답 형태 유사성 (마이그레이션 난이도)

- 응답 필드명(`followerCount`, `isBlueVerified`, `avatar`, `mediaCount` 등)은 getxapi와 세부 스키마가 다르며 매핑 작업이 필요하다(둘 다 X 내부 GraphQL 응답을 감싼 형태라 "같은 계열"이지만 필드명이 1:1 동일하지는 않음 — 정확한 getxapi 필드명 대조표는 이번 조사 범위 밖).
- SDK 설계(Python/Node, 리소스별 네임스페이스: `user`/`tweet`/`post`/`interaction`/`list`/`explore`/`dm`/`xchat`)는 getxapi의 MCP 도구 네이밍(`get_user_info`, `create_tweet` 등)과 개념적으로 유사해 **학습 곡선 자체는 낮다.** 다만 실제 마이그레이션 비용은 응답 필드 리매핑 + 인증 흐름 변경(Bearer 키 단일 → API키+authToken+proxy 이중 구조) + 미디어 첨부 로직 재작성(업로드 2단계 → 인라인 방식)에서 발생한다.

---

## 4. 인플루언서 캠페인 시나리오 적합성 판단

우리 시나리오: **(a) 인플루언서 DB 자동 보강**(핸들→프로필), **(b) 원고 전달·협의 DM**(opt-in 전송 + 답장 확인 폴링), **(c) 향후 업로드 확인**(계정 모니터링).

| 시나리오 | tweetapi 적합성 | 비교 |
|---|---|---|
| (a) 프로필 자동 보강 | 충분 — getxapi와 기능적으로 동등 | 대체할 이유 없음 |
| (b) DM 전송+답장 폴링 | 가능하나 대가가 크다 — `authToken`(+로그인 대행 or 직접 쿠키 확보) 관리, `send-dm`에 프록시 필수, 계정 정지 리스크가 사용자(=클리닉브릿지 소유 X 계정)에게 전가 | getxapi도 동일한 계정-인증 구조로 DM을 제공(`send_direct_message`)하므로, **"DM 기능이 있다/없다"가 아니라 "암호화 DM까지 되느냐"가 유일한 차별점**. 일반 DM만 필요하다면 굳이 신생 업체로 옮길 이유가 약함 |
| (b-확장) **X Chat(암호화 DM)까지 필요한 경우** | 기술적으로는 유일하게 지원 | 그러나 PIN+authToken을 4.5개월 된 무평판 업체에 넘겨야 함. 인플루언서와의 협의가 실제로 X Chat(암호화 DM)으로 이뤄지는 케이스가 얼마나 되는지부터 확인 필요 — 대부분의 인플루언서 협업 DM은 일반 DM으로 오갈 가능성이 높음 |
| (c) 계정 모니터링(업로드 확인) | ❌ 네이티브 기능 없음. 직접 폴링 스크립트를 만들어야 함 | getxapi는 구독형 웹훅(`monitor`+`webhook`, 콜당 과금 없음)을 이미 제공 — 이 항목은 **tweetapi가 getxapi보다 명백히 후퇴** |

### 결론 및 권고

- **"전면 대체"는 권하지 않는다.** getxapi가 이미 잘 지원하는 모니터링/웹훅을 tweetapi는 지원하지 않고, 신생 업체 특유의 신뢰성 미검증 리스크(운영 4.5개월, 리뷰 없음, 응답 SLA 없음)까지 새로 떠안게 된다.
- **"병행(DM만 tweetapi)"도 지금 단계에서는 시기상조로 판단한다.** 병행을 정당화하는 유일한 이유는 "암호화 DM 필요성"인데, 이는 (1) 인플루언서 협업에서 실제로 X Chat(암호화 DM)을 써야 하는 케이스가 있는지 확인되지 않았고, (2) 그 기능의 실제 작동 방식이 "PIN+계정 자격증명을 신생 서드파티에 위임"하는 구조라 UX/UI 원칙의 "계정 리스크" 기준을 훨씬 넘어서는 민감 정보(로그인 세션 + 결제/개인정보 급의 PIN)를 다뤄야 한다.
- **권고: 도입 보류.** 대신 다음 조건이 확인되면 재검토한다 — ① 실제로 협업 상대(인플루언서)가 X Chat(암호화 DM)을 쓰는 사례가 나타나는지, ② tweetapi가 6개월~1년 더 운영되며 독립 리뷰/인시던트 이력이 쌓이는지, ③ 계정 정지 발생 시 배상/지원 정책이 명문화되는지. 그 전까지는 getxapi의 일반 DM + 수동 계정 모니터링(폴링)으로 충분히 커버 가능하다.

---

## 부록: 확인하지 못한 항목("문서에 없음")

- X Chat `setup`이 내부적으로 Juicebox 프로토콜을 그대로 재현하는지, 다른 방식(예: 자체 키 캐싱)을 쓰는지의 기술적 세부
- `authToken`/PIN의 저장 기간, 암호화 저장 여부, 삭제 정책(Privacy Policy는 일반적 문구만 있고 X Chat 자격증명에 대한 별도 조항 없음)
- 계정 인증이 필요한 엔드포인트(쓰기/DM/X Chat)가 월 요청 할당량에 포함되는지, 별도 과금되는지의 명확한 가격 표
- `tweetapi.com/status` 페이지의 실제 과거 업타임/인시던트 수치
- 운영 법인의 정확한 법인명·소재국(EU 등록이라는 문구만 확인)
- 실제 API 키를 발급해 호출 테스트한 결과(응답 스키마 예시는 모두 문서상의 "Sample" 더미 데이터이며, 실제 호출 검증은 하지 않음)
