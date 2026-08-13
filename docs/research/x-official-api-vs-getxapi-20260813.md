# X 공식 API v2(pay-per-usage) vs getxapi 전면 대체 검토

- 작성일: 2026-08-13
- 목적: cb-x-deck이 쓰는 getxapi(스크래핑형 서드파티 API)를 X 공식 API v2의 2026년 pay-per-usage 체제로 전면 대체할 수 있는지 검토
- 1차 출처: `xdevplatform/docs` GitHub 저장소(`raw.githubusercontent.com/xdevplatform/docs/main/...`) — X 공식 문서 사이트(docs.x.com)의 빌드 원본. docs.x.com은 직접 크롤링이 막혀 있어 이 저장소를 대신 사용함.
- 2차/참고 출처(서드파티 블로그·경쟁 API 마케팅 페이지): twitterapi.io, xpoz.ai, socialcrawl.dev 등 — 공식 문서와 상충하는 주장(예: "full-archive는 Enterprise 전용")이 섞여 있어 **1차 출처가 있으면 항상 1차 출처를 우선**했고, 상충 지점은 본문에 명시함.
- 표기 원칙: 공식 문서에서 명시적으로 확인한 것만 적음. 확인 못 한 것은 "명시 없음"으로 표기.

---

## 요약 결론 (먼저 보기)

**부분 병행 권고. 전면 대체는 불가능하지 않지만, 지금 당장 하기엔 두 가지 큰 장벽이 있다: (1) `min_faves:`/`min_retweets:`/`min_replies:` 인게이지먼트 연산자가 공식 검색에 없음(대체 불가 사유였던 "적정 기준 추천" 기능 자체를 다시 설계해야 함), (2) 리소스당 과금이라 검색·타임라인처럼 여러 건을 반환하는 호출의 실제 비용이 요청 수만으로는 계산이 안 되고, 우리 쪽 응답당 평균 반환 건수를 모르면 월 비용이 getxapi 대비 5~100배+ 로 벌어질 수 있음(추정 필요, 아래 4번 참조).**

- 검색(핵심 기능): 최근 검색(`/2/tweets/search/recent`, 최근 7일)과 전체 아카이브 검색(`/2/tweets/search/all`, 2006년~)이 **둘 다 pay-per-use에서 가능** — 이 부분은 공식 문서상 명확히 확인됨(일부 서드파티 블로그가 "full-archive는 Enterprise 전용"이라 주장하는데, 이는 **공식 1차 문서와 상충하며 틀렸다**로 판단).
- 단, `min_faves:`/`min_retweets:`/`min_replies:` 는 공식 검색 연산자 목록(Search·Filtered Stream 둘 다)에 **없음**. 과거 Premium/Enterprise 전용이던 이력이 있는데, 2026년 8월 현재 문서에는 아예 등재되어 있지 않다(대체 연산자도 없음). 유사하게 쓸 수 있는 건 응답에 포함되는 `public_metrics`(좋아요·리트윗·답글 수)를 받아 **클라이언트 측에서 필터링**하는 것뿐. 이러면 "기준 이하 트윗도 일단 다 읽어와서(=다 과금) 버린다"는 구조가 되어 비용이 커진다(4번 참조).
- 타임라인/유저 정보/트윗 상세/답글 조회: 전부 pay-per-use에서 가능. 답글은 전용 엔드포인트가 없고 `conversation_id:` 검색 연산자로 조회(공식 권장 방식).
- DM(레거시)·Chat(XChat): 둘 다 pay-per-use에서 가능(이미 파악된 대로).
- 계정 모니터링(새 트윗 감지) + 웹훅: **X Activity API(XAA)**가 pay-per-use에서 가능. `post.create` 이벤트를 `user_id`로 구독하면 공개 이벤트라 대상 계정의 OAuth 동의 없이도 구독 가능, 웹훅 배포도 지원. Self-serve 구독 한도는 1,500개. 이벤트당 $0.005 과금.
- 유저 검색: `/2/users/search` 존재, pay-per-use 가능.
- 비용: getxapi 월 ~$14 대비, 공식 API는 **"요청당"이 아니라 "응답에 포함된 리소스(트윗·유저 등 객체) 1건당"** 과금이라, 검색·타임라인처럼 여러 건을 반환하는 호출에서 실제 월 비용이 크게 달라진다. 정확한 배율은 getxapi 응답당 평균 반환 건수를 모르면 추정이 불가능(아래 4번에 시나리오별로 정리).

---

## 1. 검색 — 대체 가능성의 관건

### 1-1. 엔드포인트·요금

| 엔드포인트 | 설명 | pay-per-use 가능 여부 | 요금 |
|---|---|---|---|
| `GET /2/tweets/search/recent` | 최근 7일 검색 | ✅ 전체 개발자(무료 티어 포함) | Post 읽기 $0.005/리소스(반환된 트윗 1건당) |
| `GET /2/tweets/search/all` | 전체 아카이브(2006년~) 검색 | ✅ **pay-per-use, Enterprise 둘 다** | Post 읽기 $0.005/리소스 |

- 출처: `x-api/posts/search/introduction.mdx` — "Full-archive search is available to pay-per-use and Enterprise customers." / "Enterprise" 뿐 아니라 **pay-per-use도 명시적으로 포함**. `enterprise-api/introduction.mdx`의 "Enterprise vs. pay-per-use" 비교표에서도 "Post search | 검색 | Recent and full-archive" 행이 pay-per-use·Enterprise 양쪽 모두에 동일하게 적용됨.
- ⚠️ **주의**: twitterapi.io·xpoz.ai 등 서드파티 블로그 다수가 "full-archive search는 Enterprise 전용($42,000+/월)"이라 주장하지만, 이는 **1차 문서와 정면으로 상충**한다. 이 서드파티들은 자사 API를 팔기 위한 비교 콘텐츠라 편향 가능성이 있어 신뢰도를 낮게 봄. 공식 문서(GitHub 원본)를 따른다.
- 요청당 한도(rate limit, `x-api/fundamentals/rate-limits.mdx`): recent 검색 450회/15분(앱), 100건/요청(최대); full-archive 검색 1회/초·300회/15분(앱), 500건/요청(최대).
- 쿼리 길이: self-serve는 recent 512자·full-archive 1,024자(Enterprise는 각 4,096자) — `x-api/posts/search/integrate/operators.mdx`.

### 1-2. 검색 연산자 커버리지 — ❌ min_faves 계열 없음

공식 연산자 문서(`x-api/posts/search/integrate/operators.mdx`, Search와 Filtered Stream 양쪽 다 확인) 전체 목록에 `min_faves:`, `min_retweets:`, `min_replies:` 는 **존재하지 않는다.**

공식 연산자 전체 목록(요약):
- 키워드/구문: `keyword`, `emoji`, `"exact phrase"`
- 엔티티: `#`, `@`, `$`
- 유저: `from:`, `to:`, `retweets_of:` (Filtered Stream에는 `from_affiliate_of:`, `to_affiliate_of:` 도 있음)
- URL: `url:` (Filtered Stream에는 `url_title:`, `url_description:`, `url_contains:` 도 있음)
- 컨텍스트: `context:`, `entity:`(recent search만), `conversation_id:`
- 리스트: `list:` (Search만)
- 포스트 참조: `in_reply_to_tweet_id:`, `retweets_of_tweet_id:`, `quotes_of_tweet_id:`
- 위치: `place:`, `place_country:`, `point_radius:`, `bounding_box:`
- 포스트 유형: `is:retweet`, `is:reply`, `is:quote`, `is:verified`, `-is:nullcast`
- 콘텐츠 유형: `has:hashtags`, `has:cashtags`, `has:links`, `has:mentions`, `has:media`, `has:images`, `has:video_link`, `has:geo`
- 언어: `lang:`
- (Filtered Stream 전용, 2026-05-27 추가) `min_followers:`, `followers_count:`, `tweets_count:`, `following_count:`, `listed_count:`, `bio:`, `bio_name:`, `bio_location:`, `sample:`, `source:`
- (Enterprise + Embedding tier 전용) `embedding:`, `embedding_threshold:` — 의미 기반 유사도 매칭

**`min_followers:`(2026-05-27 신규 추가, Filtered Stream 전용)는 "작성자의 팔로워 수"를 거르는 연산자이고, 우리가 필요한 "포스트 좋아요/리트윗 수"를 거르는 연산자는 아니다.** 즉 팔로워 기반 필터는 새로 생겼지만 인게이지먼트 기반 필터는 여전히 없다.

**결론: `min_faves:`/`min_retweets:`/`min_replies:` 는 Search에도 Filtered Stream에도 없다. Enterprise 문서(`enterprise-api/introduction.mdx`, `enterprise-api/getting-started/pricing.mdx`)에도 별도 언급이 없어, Enterprise로 올려도 해결되지 않는 것으로 보인다(명시적으로 "지원 안 함"이라고 쓰여 있진 않지만, 어떤 access level의 연산자 목록에도 등재되어 있지 않음).**

### 1-3. 대안과 비용 영향

- **`public_metrics` 필드로 클라이언트 필터링**: `tweet.fields=public_metrics`를 요청하면 `retweet_count`, `reply_count`, `like_count`, `quote_count`, `impression_count`, `bookmark_count`가 응답에 포함된다(`x-api/fundamentals/metrics.mdx`). 인증은 Bearer Token만으로 충분(Public 메트릭).
- **비용 영향**: pay-per-use는 "응답에 포함된 리소스 1건당" 과금이라(`x-api/getting-started/pricing.mdx`: "Charged per resource returned in the response"), `min_faves:` 없이 넓게 검색해서 기준 미달 트윗까지 다 받아와 걸러내면, **버리는 트윗도 전부 $0.005씩 과금된다.** "적정 기준 추천" 기능처럼 애초에 반응이 드문 걸 걸러내려는 기능일수록 역설적으로 비용이 커지는 구조다.
- 24시간 UTC 중복제거(같은 리소스를 같은 날 다시 요청하면 1회만 과금)가 있어 컬럼 새로고침으로 같은 상위 트윗을 반복 조회하는 경우엔 완화되지만, "새로운 트윗 발굴"처럼 매번 다른 트윗을 넓게 훑는 유스케이스에는 중복제거 효과가 거의 없다.

### 1-4. 7일 제한이 실질 문제인가

- 덱 컬럼 새로고침/최근 트윗 발굴: `/2/tweets/search/recent`(최근 7일)로 충분 — **실질 문제 아님.**
- 다만 오래된 인플루언서 트윗을 다시 찾아보는 케이스(예: 캠페인 회고, 과거 인용 트윗 추적)는 7일을 넘기므로 `/2/tweets/search/all`(전체 아카이브)이 필요한데, 이건 pay-per-use에서도 가능하다고 확인했으므로(1-1) 여기서 막히지 않는다.

---

## 2. 나머지 실사용 기능

| getxapi 기능 | 공식 대응 엔드포인트 | pay-per-use 가능 | 요금 | 비고 |
|---|---|:---:|---|---|
| `/user/tweets`(유저 타임라인) | `GET /2/users/:id/tweets` | ✅ | Post 읽기 $0.005/리소스 | 최근 3,200건까지, `exclude=retweets,replies` 지원. Rate limit: 10,000/15분(앱), 900/15분(유저) |
| `/user/info`(프로필) | `GET /2/users/by/username/:username` | ✅ | User 읽기 $0.010/리소스 | Rate limit: 300/15분(앱), 900/15분(유저) |
| `/tweet/detail`(트윗 상세) | `GET /2/tweets/:id` | ✅ | Post 읽기 $0.005/리소스 | Rate limit: 450/15분(앱), 900/15분(유저) |
| `/tweet/replies`(답글 조회) | 전용 엔드포인트 없음 → `GET /2/tweets/search/recent?query=conversation_id:{id}` (7일 이내) 또는 `/search/all`(그 이전) | ✅ (검색으로 대체) | Post 읽기 $0.005/리소스(검색과 동일 과금 체계) | 공식 가이드(`x-api/fundamentals/conversation-id.mdx`)가 명시적으로 이 방식을 권장. `to:작성자 -from:작성자` 등을 덧붙여 직접 답글만 추리는 패턴도 있음 |

- **User: Read가 Post: Read보다 2배 비쌈(0.010 vs 0.005)** — `/user/info` 호출이 잦다면 이 부분이 비용에서 상대적으로 크게 잡힐 수 있음.
- 답글 조회는 엔드포인트가 통합되어(검색으로 흡수) 별도 요금 체계가 아니라 검색과 동일한 리소스당 과금이 적용된다.

---

## 3. 도입 예정 기능

### 3-1. DM / Chat — 이미 확인된 대로, 간단 재확인

- 레거시 DM: `POST/GET /2/dm_conversations`, `/2/dm_events` 등 — pay-per-use에서 가능(`x-api/direct-messages/manage/introduction.mdx`, `x-api/direct-messages/lookup/introduction.mdx`). DM 이벤트 조회는 **최근 30일치만** 조회 가능(getxapi가 이 제한이 있는지는 "명시 없음" — 비교 필요).
- 요금: DM Event 읽기 $0.010/리소스, DM Interaction 생성(발송) $0.015/요청.
- Chat(XChat, 신규 암호화 DM): `/2/chat/*` 엔드포인트군(`send-chat-message`, `get-chat-conversation`, `initialize-conversation-keys` 등) 존재. 종단간 암호화라 클라이언트에서 별도 암호화 SDK(`chat-xdk`, Rust 코어 + 여러 언어 바인딩) 연동이 필요함 — 단순 REST 호출이 아니라 **키 관리·암복호화 로직 구현이 추가로 필요**하다는 점이 레거시 DM과 다름.

### 3-2. 계정 모니터링(새 트윗 감지) + 웹훅 — ✅ 가능, 폴링 불필요

- **X Activity API(XAA)**가 정답. `/2/activity/subscriptions`로 특정 `user_id`에 대해 `post.create`(포스트 작성), `post.delete`, `post.mention.create` 등 이벤트를 구독하고, `/2/activity/stream`(persistent HTTP stream) 또는 **웹훅**으로 배달받을 수 있음(`x-api/activity/introduction.mdx`, `x-api/webhooks/introduction.mdx`).
- **중요**: `post.create`/`post.delete`/프로필 변경은 "공개 이벤트(Public event)"로 분류되어, **모니터링 대상 계정의 OAuth 동의 없이 `user_id`만으로 구독 가능**하다("For these public events, you can create subscriptions by specifying the user ID in your filter"). 우리 유스케이스(타 인플루언서 계정의 새 트윗 감지)에 딱 맞음.
- 구독 한도(Self-serve/pay-per-use): **1,500개**(Enterprise 75,000개, Partner 150,000개) — `x-api/activity/introduction.mdx`. 인플루언서 수가 1,500명을 넘지 않는 한 문제 없음.
- 요금(웹훅 이벤트 배달 기준, `x-api/getting-started/pricing.mdx`): `post.create` **$0.005/이벤트**, `post.delete`는 과금 안 함. `follow.follow`/`follow.unfollow` $0.010, `chat.received`/`dm.received` $0.010, `news.new`(Enterprise 전용) $0.005, `spaces.start`/`spaces.end` $0.005 등.
- **참고**: 구식 "Account Activity API(AAA)"는 `tag: DEPRECATED`로 표시되어 있고, pay-per-use 구독 한도가 3개(웹훅 1개)뿐이라 지금 신규로 쓸 게 아님. XAA가 그 후속.
- 참고: "필터드 스트림 웹훅 배달"(키워드/불리언 조건 기반, 특정 유저 무관하게 전체 스트림에서 매칭)은 **Enterprise 전용**(`x-api/webhooks/stream/introduction.mdx`: "This endpoint is currently available to Enterprise developers"). 우리가 원하는 건 "특정 계정의 새 트윗"이므로 XAA 경로로 충분하고 이 Enterprise 전용 기능은 필요 없음.
- **결론: 폴링 불필요, 웹훅으로 실시간 감지 가능(pay-per-use).**

### 3-3. 유저 검색 / 팔로우 관계 / 리스트 멤버

| 기능 | 엔드포인트 | pay-per-use | 요금 |
|---|---|:---:|---|
| 유저 검색 | `GET /2/users/search` | ✅ | User 읽기 $0.010/리소스(추정 — 검색도 User: Read 카테고리로 과금될 것으로 보이나, pricing.mdx에 "User Search" 전용 행이 별도로 없어 **일반 User: Read 요금 적용으로 추정. 정확한 확정 문구는 명시 없음**) |
| 팔로우 관계(팔로잉/팔로워 조회) | `GET /2/users/:id/following`, `GET /2/users/:id/followers` | ✅ | Following/Followers 읽기 $0.010/리소스 |
| 리스트 멤버 | `GET /2/lists/:id/members` | ✅ | 명시 없음(List: Read $0.005/리소스로 추정되나 List Member 전용 항목은 pricing.mdx에 없음) |

---

## 4. 비용 시뮬레이션 — 리소스당 과금 vs 요청당 과금

### 4-1. 과금 단위(가장 중요한 구조적 차이)

공식 pay-per-use는 **"요청 1건" 기준이 아니라 "응답에 실제로 담겨 돌아온 리소스(트윗·유저 객체 등) 1건" 기준으로 과금**된다(`x-api/getting-started/pricing.mdx`: "All prices are per resource fetched (reads) or per request (writes/actions)." / "Read operations — Charged per resource returned in the response.").

즉:
- `/2/tweets/:id` 처럼 항상 1건만 돌아오는 호출 → 요청 1건 = 리소스 1건 = $0.005
- `/2/tweets/search/recent?max_results=100` 처럼 최대 100건이 한 번에 돌아오는 호출 → 요청 1건이 **최대 $0.50**(100건 × $0.005)까지 될 수 있음
- 이 배율이 정확히 얼마인지는 **"getxapi 호출 1건당 평균 몇 건의 트윗/유저가 반환되는가"** 에 좌우되는데, 이 값은 현재 코드(`src/lib/getxapi.ts`, `usageStore`)에 기록되어 있지 않다(호출 성공 여부만 `units: 1`로 기록). **→ 정확한 비용 환산을 위해 이 값을 먼저 파악해야 함(명시 없음, 추정 필요).**

### 4-2. 시나리오별 월 비용 추정

기준: 월 ~12,536 요청(31,339건 ÷ 2.5개월), 대부분 검색(`advanced_search`)·유저 타임라인(`user/tweets`) 읽기. Post 읽기 $0.005/리소스로 단순화(User 읽기 $0.010은 별도 가산 필요하므로 아래는 하한에 가까운 추정).

| 시나리오 | 가정: 응답당 평균 반환 트윗 수 | 월 비용(추정) | getxapi 대비 |
|---|---:|---:|---:|
| A. 단건 위주(상세 조회·프로필 조회가 대부분) | 1건 | 약 $63 | ~4.5배 |
| B. 검색/타임라인이 페이지당 20건 반환(흔한 기본 페이지 크기) | 20건 | 약 $1,250 | ~90배 |
| C. 검색/타임라인이 페이지당 100건(최대치)까지 채워서 반환 | 100건 | 약 $6,270 | ~450배 |

- getxapi 현재 비용: 월 ~$14(2.5개월 $34, 콜당 $0.001~0.002).
- **이 표는 24시간 중복제거 효과를 반영하지 않은 상한 쪽 추정이다.** 같은 상위 트윗을 하루 안에 여러 컬럼·여러 새로고침에서 반복 조회한다면 실제 비용은 표보다 낮아질 수 있다. 그러나 "새로운 트윗 발굴"처럼 매번 다른 결과를 받는 호출에는 중복제거가 거의 도움이 안 된다.
- **결론: 시나리오 A(단건 위주)가 아니라면, 공식 API 비용은 getxapi 대비 최소 수십 배~수백 배 커질 가능성이 높다.** 실제 배율을 확정하려면 getxapi 응답의 평균 반환 건수(특히 `advanced_search`, `user/tweets`)를 로그에서 확인해야 한다.
- 2백만 Post reads/월 캡(pay-per-use 공통, `x-api/getting-started/pricing.mdx`, `x-api/fundamentals/post-cap.mdx`)은 시나리오 C(월 1,253,600건)에서도 캡의 약 63%로, 캡 자체에 걸릴 가능성은 낮지만 저 비용을 낸다는 뜻이지 캡이 방지책이 되어주진 않는다.

---

## 5. 마이그레이션 난이도·기타

| 항목 | 내용 | 판단 |
|---|---|:---:|
| 응답 스키마 | v2는 `fields`/`expansions` 파라미터로 원하는 필드만 골라 요청하는 구조(예: `tweet.fields=public_metrics`, `expansions=author_id`). getxapi는 스크래핑 응답을 그대로 평탄화한 구조로 추정(`getxapi.ts`의 관대한 파싱 로직 — `raw.tweets`/`raw.replies`/`raw.data` 중 배열인 첫 필드를 쓰는 방어 코드가 있음 — 을 보면 응답 계약이 느슨하거나 엔드포인트별로 달랐던 것으로 보임). → **파싱 계층 재작성 필요, 검색 결과의 좋아요/리트윗 수 등은 `public_metrics`로 재매핑 필요.** | ⚠️ 재작성 필요하지만 기계적 |
| 개발자 계정 심사 | `x-api/getting-started/getting-access.mdx`: console.x.com 가입 → 개발자 계약 동의 → 앱 생성, 3단계로 서술. 과거 "Elevated access" 같은 별도 수동 심사 절차는 pay-per-use 안내문에 **언급 없음**. 승인 소요 기간·거절 기준은 **명시 없음**. | ✅(문서상 장벽 낮음, 실제 소요는 확인 필요) |
| 2백만 Post reads/월 캡 | pay-per-use 공통 상한. 초과 시 Enterprise 전환 필요(`/forms/enterprise-api-interest`). 우리 규모(4번 시나리오 기준 월 최대 ~126만 건)에서는 캡 자체는 안 걸릴 전망. | ✅ |
| ToS/계정 리스크 | getxapi는 스크래핑형 서드파티라 X 이용약관상 리스크(계정·API 키 정지 가능성)가 존재하는 구조. 공식 API는 계약된 접근이라 이 리스크가 없음 — **문서로 직접 명시된 비교는 아니지만, "스크래핑 API vs 공식 계약 API"의 구조적 차이로서 합리적 추론.** | ✅(공식 API가 유리) — 단, "getxapi 계정이 실제로 정지된 적 있는지"는 명시 없음 |
| 결제/한도 관리 | 크레딧 선불, auto-recharge(임계값 이하 시 자동 충전, 5분당 1회 제한), 지출 한도(spending limit) 설정 가능(`x-api/getting-started/pricing.mdx`). 잔액이 소진되면 요청이 막히고, 잔액이 소폭 음수까지는 허용됨. | ✅ 운영 도구는 준비돼 있음 |

---

## 항목별 커버리지 표 (총괄)

| 항목 | 공식 엔드포인트 | pay-per-use 가능 | 요금 | 판정 |
|---|---|:---:|---|:---:|
| 최근 검색(7일) | `GET /2/tweets/search/recent` | ✅ | $0.005/리소스 | ✅ |
| 전체 아카이브 검색 | `GET /2/tweets/search/all` | ✅ | $0.005/리소스 | ✅ |
| 인게이지먼트 연산자(`min_faves:` 등) | 없음 | ❌ | — | ❌ |
| 유저 타임라인 | `GET /2/users/:id/tweets` | ✅ | $0.005/리소스 | ✅ |
| 유저 정보 | `GET /2/users/by/username/:username` | ✅ | $0.010/리소스 | ✅ |
| 트윗 상세 | `GET /2/tweets/:id` | ✅ | $0.005/리소스 | ✅ |
| 답글 조회 | 검색(`conversation_id:`)으로 대체 | ✅ | $0.005/리소스 | ✅(대체 방식) |
| 레거시 DM | `/2/dm_conversations`, `/2/dm_events` | ✅ | $0.010~0.015 | ✅ |
| XChat | `/2/chat/*` | ✅ | 웹훅 `chat.received` $0.010 | ✅(암호화 SDK 연동 필요) |
| 계정 모니터링(새 트윗 웹훅) | X Activity API `/2/activity/*` | ✅ | `post.create` $0.005/이벤트 | ✅ |
| 유저 검색 | `GET /2/users/search` | ✅ | 명시 없음(추정 $0.010) | ⚠️ |
| 필터드 스트림 웹훅(전체 스트림) | `/2/tweets/search/stream` 웹훅 배달 | ❌(Enterprise 전용) | — | ❌(우리 유스케이스엔 불필요) |
| 월 비용(현 사용량 기준) | — | — | 시나리오별 $63~$6,270(getxapi $14 대비 4.5~450배) | ⚠️ |

---

## 최종 권고: 부분 병행

**전면 대체는 지금 시점엔 권하지 않음.** 이유:

1. `min_faves:`류 인게이지먼트 연산자가 공식 검색에 없어, "적정 기준 추천" 기능의 근간 로직(min_faves 기반 추천)을 클라이언트 필터링으로 다시 짜야 하고, 그 과정에서 버리는 트윗까지 리소스당 과금되어 비용이 늘어난다.
2. 검색·타임라인처럼 여러 건을 반환하는 호출이 전체 사용량의 대부분을 차지하는데, 리소스당 과금 구조 때문에 실제 월 비용이 getxapi의 수십~수백 배가 될 가능성이 있다(정확한 배율은 getxapi 응답의 평균 반환 건수를 확인해야 확정 가능 — 현재 로그에 기록되어 있지 않음).

**권장 조합(부분 병행):**

- **계정 모니터링(새 트윗 감지) + 웹훅은 공식 X Activity API로 전환.** getxapi에는 없던 "웹훅 기반 실시간 감지"를 공식 API가 폴링 없이 제공하고, 이벤트당 $0.005로 비용도 예측 가능하다. 이 기능은 원래 "도입 예정"이라 getxapi 의존이 없으므로 마이그레이션 리스크 없이 바로 공식 API로 시작 가능.
- **검색·타임라인·인게이지먼트 필터링이 필요한 핵심 덱 기능은 getxapi를 유지.** `min_faves:` 계열이 없는 한 공식 API로는 이 부분을 대체할 방법이 없고, 리소스당 과금 때문에 비용도 불리하다.
- **DM/Chat 신규 기능은 공식 API로 시작하는 게 자연스럽다.** 어차피 새로 만드는 기능이라 getxapi 의존이 생기지 않고, 공식 API가 계약 기반이라 ToS 리스크도 없다. 다만 XChat은 암호화 SDK(`chat-xdk`) 연동이라는 추가 구현 비용이 든다.
- **다음 액션(전면 전환 재검토 트리거):** (a) X가 검색에 인게이지먼트 연산자를 다시 추가하거나, (b) getxapi 응답의 평균 반환 건수를 실측했을 때 시나리오 A(단건 위주)에 가깝다고 확인되는 경우, (c) getxapi 계정이 실제로 정지되는 등 ToS 리스크가 현실화되는 경우 — 이 중 하나라도 발생하면 전면 전환을 다시 검토.
