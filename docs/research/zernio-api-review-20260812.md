# Zernio(zernio.com) 검토 보고서 — getxapi 대체/보완 가능성

작성일: 2026-08-12
조사 방법: Exa 웹서치/fetch로 zernio.com, docs.zernio.com, docs.zernio.com/llms-full.txt, zernio.com/pricing.md, github.com/zernio-dev/openapi-specs, 외부 리뷰(Indie Hackers, Tinybird 고객사례, thatmarketingbuddy, synopolis 등) 확인. getxapi 쪽은 docs.getxapi.com / getxapi.com/pricing 웹페이지로 교차 확인(코드베이스 자체는 열지 않음).

## 0. 한 줄 결론

**Zernio는 getxapi를 대체할 수 없다.** 둘은 카테고리가 다르다.

- **getxapi**: X 계정 없이도(OAuth·개발자 계정 불필요, Bearer 키만) *임의의* 공개 트윗·유저·팔로워를 조회하는 "X 데이터 스크래핑형" API. 가격도 공식 API보다 훨씬 싸다($0.001/call).
- **Zernio**: *우리가 소유하고 OAuth로 연결한* 계정을 대신해 "발행(포스팅/스케줄링) + 받은 DM/댓글함 관리 + 자사 계정 분석"을 해주는, X 공식 API를 감싼 "소셜 퍼블리싱/인박스 SaaS"다. 16개 플랫폼 통합이 핵심 가치이고, 트위터는 그중 하나일 뿐이다.

cb-x-deck이 지금 쓰는 핵심 기능(임의 계정·트윗 검색/조회, 팔로워 수 조회, 계정 모니터링)은 애초에 Zernio의 제품 범위 밖이다. Zernio가 유용해질 수 있는 지점은 딱 하나, **"우리 소유 X 계정으로 인플루언서에게 DM을 보내고 받는 것"**이며, 이 경우에도 X 자체의 정책 제약(암호화 DM, Pro 티어 게이팅)이 걸린다.

---

## 1. Zernio란 무엇인가 (선이해)

- 2025년 스페인(지로나→바르셀로나) 설립, 부트스트랩(투자 無), 6~8인 팀. 창업자 Miquel "Miki" Palet(전직 VC 스타트업 창업자, Ucademy 출신).
- 제품: REST API + 호스티드 MCP 서버로 Instagram/TikTok/YouTube/X/LinkedIn/Facebook/Threads/Pinterest/Reddit/Bluesky/WhatsApp/Telegram/Discord/Snapchat/GoogleBusiness 등 14~16개 플랫폼에 **게시·예약·통합 인박스(DM/댓글)·분석·광고**를 제공.
- 창업 10개월 만에 ARR $1M+ 돌파(Indie Hackers 인터뷰, 2026-04), 이후 6M 발행/일, 2,000+ 유료고객, 15만+ 연결계정 규모로 성장(Tinybird 고객사례, 2026-06). Product Hunt 런칭 2026-06-19.
- 스택: Next.js/Vercel + MongoDB + Tinybird(분석). SOC2·GDPR 문서는 trust.zernio.com에서 제공.
- X(트위터)는 **공식 X API v2를 OAuth로 감싼 것**이라 확인됨(트위터 OAuth 스코프 목록이 `tweet.read`/`tweet.write`/`dm.read`/`dm.write` 등 X 공식 스코프와 정확히 일치, 요금표도 X 공식 pay-per-call 요율을 그대로 pass-through).

---

## 2. 질문 1 — getxapi 기능 커버리지 체크

### 현재 사용 중

| 기능 | Zernio 지원 | 비고 / 엔드포인트 |
|---|---|---|
| 트윗 고급 검색 (advanced search, min_faves 등 연산자) | ⚠️ 부분 | `GET /v1/twitter/search` (`docs.zernio.com/twitter-engagement/search-tweets`). X의 공식 검색 쿼리 문법을 "그대로 통과"시키는 방식. 단, **최근 7일**만 검색 가능(공식 X API v2 recent-search 한계), `accountId`(우리가 연결한 계정) 필수, 최소 결과수 10. 문서에 나열된 연산자는 `from:`, `-is:retweet`, `is:reply`, `lang:`, 정확 문구, `conversation_id:`, `OR` 등 — **`min_faves`/`min_retweets` 같은 인기도 필터 연산자는 목록에 없음**(공식 X API v2는 이 연산자를 지원하지 않는 것으로 알려져 있어, Zernio를 거쳐도 동작하지 않을 가능성이 높음 — 실제 미테스트, 정직히 추정임을 밝힘). 즉 "검색은 되지만 지금 쓰는 필터 방식·기간 범위가 그대로 옮겨가지 않음". |
| 유저 타임라인(user tweets) | ❌ | Zernio 문서·MCP 툴 카테고리(496개 툴 목록, `docs.zernio.com/mcp/tools`)에 "임의 유저의 트윗 목록 조회" 엔드포인트가 없음. `posts_list`류는 **우리 계정이 Zernio로 발행한 글**만 조회한다. |
| 유저 정보(user info: 팔로워 수·인증·프로필 이미지) | ❌ | 문서에 없음. `accounts/follower-stats`는 **우리 소유의 연결 계정**의 팔로워 추이만 제공(Analytics 애드온 필요). 임의 핸들로 유저 프로필을 조회하는 엔드포인트는 확인되지 않음. |
| 트윗 상세(tweet detail) | ❌ | 문서에 없음. 검색 결과(`/v1/twitter/search`)에 포함된 트윗 필드로 일부 대체 가능하나, 단일 트윗 ID로 상세를 조회하는 전용 엔드포인트는 없음. |
| 트윗 답글(replies) | ⚠️ 부분(다른 의미) | `tweet.moderate.write` 스코프로 **우리 트윗에 달린 답글을 숨기기/숨김해제**만 가능(comment moderation). "임의 트윗의 답글 목록을 읽어오는" 기능은 문서에 없음. |

### 도입 검토 중

| 기능 | Zernio 지원 | 비고 / 엔드포인트 |
|---|---|---|
| DM 전송(핸들 또는 user id) | ✅ (핸들) / ⚠️ (id 미확인) | `POST /v1/inbox/conversations` — `participantUsername`으로 신규 대화 시작 확인. 응답 스키마에 `participantId` 필드가 존재해 ID 지정도 가능할 개연성은 있으나 X 전용 예시는 핸들만 문서화됨. **주의**: "X DM 쓰기(write) 엔드포인트는 X API Pro 티어($5,000/월) 또는 엔터프라이즈 액세스가 필요. 단, 이는 BYOK(자체 X API 키 사용) 고객에게 적용됨"이라 문서에 명시 — Zernio 자체 앱을 쓰는 일반 고객은 이 $5,000를 직접 내지 않고 건당 과금($0.015/req)으로 흡수되는 것으로 보이나(요금표상 "DM: Send"가 건당 과금 항목으로 존재), 이 해석은 문서의 행간을 읽은 것이며 명시적 확인은 아님. DM 발송 전 `receives_your_dm` 사전체크가 기본 동작(끄려면 `skipDmCheck:true`). |
| DM 받은함 목록(inbox 탭 구분) | ⚠️ 부분 | `GET /v1/inbox/conversations` — 플랫폼별(twitter 포함) 대화 목록 통합 조회, 페이지네이션·`status`(active/archived) 필터 지원. **다만 X 자체의 "primary/general/requests" 같은 인박스 탭 구분은 문서에 없음** — Zernio는 단일 리스트로만 노출. |
| DM 대화 스레드 조회 | ✅ | 대화(`conversationId`) 단위로 메시지 조회/응답 가능(`sendInboxMessage` 등). |
| 계정 모니터링(특정 계정 새 트윗 감지) + 웹훅 실시간 전달 | ❌ | **핵심 한계**: Zernio의 웹훅(`post.external.*`, `account.connected/disconnected` 등)은 전부 **우리가 OAuth로 연결한 계정**에만 적용된다. 인플루언서처럼 우리가 소유/연결하지 않은 제3자 계정의 새 트윗을 감지하는 기능은 Zernio 제품 범위에 존재하지 않음(문서 어디에도 없음). getxapi의 `add_monitor`/`create_monitor_webhook`류에 대응하는 기능이 Zernio엔 없다. |
| 유저 검색(search_users) | ❌ | 문서에 없음. MCP 툴 카테고리 목록에도 별도 "Twitter Users" 카테고리가 없고 `Twitter Engagement (6)`만 존재(retweet/unretweet/bookmark/unbookmark/follow/unfollow 6종으로 추정). |
| 팔로우 관계 확인 | ❌ (X 기준) | 문서에 "Check whether an Instagram user follows the account"(`GET /v1/accounts/{accountId}/follow-status/{userId}`)는 **Instagram 전용**으로 명시. X/Twitter용 팔로우 관계 확인 엔드포인트는 문서에 없음. X는 `follows.write`(팔로우 실행)만 지원. |
| X 리스트 멤버 조회 | ❌ | Zernio가 참조하는 X 공식 OpenAPI 원본(`github.com/zernio-dev/openapi-specs/twitter.yaml`, 147개 엔드포인트)에는 List 관련 스키마가 존재하지만, 이는 **X 공식 API 전체 스펙 원본**이고 Zernio가 실제로 감싸서 노출한 API 표면(문서·MCP 툴 카탈로그)에는 리스트 멤버 조회가 보이지 않음. 문서에 없음. |
| 트윗 작성/미디어 업로드 | ✅ | Zernio의 핵심 기능. `createPost`(텍스트/이미지/GIF/영상, 스레드 `threadItems` 포함), 미디어는 presigned upload(`POST /v1/media/presign`) 또는 MCP의 브라우저 업로드 플로우. 280자(무료)/25,000자(X Premium) 제한, 이미지 4장(또는 GIF 1장), 영상 512MB/140초까지. |

**요약**: 8개 "도입 검토 중" 항목 중 확실한 ✅는 DM 관련 2개(전송·스레드 조회) 뿐이고, 나머지(계정 모니터링·유저 검색·팔로우 확인·리스트 멤버)는 전부 ❌. "현재 사용 중" 4개 항목은 검색만 ⚠️(제한적), 나머지 3개는 ❌.

---

## 3. 질문 2 — Zernio만의 기능 중 유용할 것

| 기능 | 평가 |
|---|---|
| **DM 수신 웹훅/실시간 알림** | **유용할 수 있음(유일한 강점)**. `message.received` 웹훅이 X를 포함한 여러 플랫폼에서 실시간으로 발화됨(`docs.zernio.com/webhooks`). getxapi 쪽은 DM을 폴링(`list_direct_messages`)으로만 가져오는 구조라, "인플루언서가 DM 답장했을 때 즉시 알림"이 필요하면 Zernio가 유일하게 이걸 제공한다. 다만 이는 **우리 소유 X 계정을 Zernio에 OAuth 연결**해야 성립하는 전제. |
| **DM 미디어 첨부** | 가능. Twitter/X 인박스에서 이미지·영상 첨부 최대 25MB(문서 명시). getxapi MCP 툴 목록에는 DM 첨부 관련 파라미터가 안 보여 이 점은 Zernio가 우위일 수 있음(단, getxapi 쪽 실제 스펙을 이번 조사에서 상세히 확인하지 않았으므로 확정은 아님). |
| **인플루언서/유저 분석 계열 기능** | 없음. Zernio의 분석은 전부 "우리 계정이 발행한 포스트/우리 계정의 팔로워 추이"에 한정. 임의 인플루언서를 분석하는 기능은 전혀 없음 — 이 축에서는 Zernio가 getxapi보다 명백히 열세. |
| **대량 조회/배치 기능** | 없음(X 기준). Reddit/Instagram 등 일부 플랫폼엔 "배치" 성격 기능이 있지만 X 전용 배치 조회는 문서에 없음. 반면 X API 자체가 pay-per-call 과금이라 Zernio도 "대량 조회를 부추기지 않는" 설계로 보임(대시보드에서 월 X 지출 캡 설정 가능 — 80% 도달 시 경고, 100% 도달 시 X 분석·인박스 폴링 자동 일시정지). |
| (부가) **댓글 관리(자기 트윗)** | 자기 트윗에 달린 댓글 조회/답글/삭제/좋아요/숨김 — 브랜드 계정 운영 관점에서는 쓸모 있으나 cb-x-deck의 핵심 use case(인플루언서 캠페인)와는 거리가 있음. |
| (부가) **X 지출 캡 + 경고 이메일** | 요금 통제 장치가 잘 만들어져 있음(80%/100% 임계치). X 종속 비용이 예측불가능하다는 리뷰들의 공통 지적을 회사가 인지하고 설계에 반영한 것으로 보임. |

---

## 4. 인증 방식

- **Zernio API 자체**: `Authorization: Bearer <api_key>` (`sk_`+64자리 hex). 서드파티 앱 연동 시엔 OAuth 2.1 + PKCE도 지원.
- **X(트위터) 계정 연동**: 별도로 **OAuth 인가 플로우 필수**. `GET /v1/connect/twitter?profileId=...`가 X 로그인 페이지로 리다이렉트 → 사용자가 X 계정으로 로그인/권한 승인 → 콜백으로 연결 완료. 요청 스코프는 한 번에 전부(`tweet.read/write`, `users.read`, `dm.read/write`, `media.write`, `like.write`, `bookmark.write`, `follows.write`, `tweet.moderate.write`, `offline.access`) — 스코프 개별 선택 불가.
- **DM은 특히**: `dm.read`/`dm.write` 스코프가 필요하고, DM *쓰기(발송)*는 X API Pro 티어($5,000/월) 이상이 필요하다는 X 자체 정책이 명시돼 있음(BYOK 고객 대상 문구; Zernio 자사 앱 이용 시엔 건당 과금으로 흡수되는 것으로 추정 — 미확정).
- **getxapi와의 차이(중요)**: getxapi는 "Bearer 키만으로, OAuth 없이, X 개발자 계정도 불필요"하게 동작한다고 자체 문서에 명시(`docs.getxapi.com`: "Authentication is a single Bearer key, with no OAuth flow and no X developer account required"). 즉 getxapi는 X 계정 세션/로그인 기반(비공식/스크래핑형)으로 작동하고, Zernio는 X 공식 OAuth 앱 기반으로 작동한다. 이 차이가 두 서비스의 기능 격차(임의 계정 조회 가능 여부)를 그대로 설명한다.

---

## 5. 가격 체계 비교

### Zernio
- 계정당 과금(플랫폼당 연결 계정 1개 = 1 unit): 1~2개 무료, 3~10개 $6/월, 11~100개 $3/월, 101개+ $1/월(계단식, 상한 없음). 일 단위 프로레이션.
- 모든 기능(발행·분석·인박스·웹훅)이 계정 요금에 포함 — 별도 기능 등급 없음.
- **X(트위터) 전용 추가 과금**: X 공식 API가 건당 과금이라 Zernio가 마진 없이 그대로 전달(pass-through). 문서상 요율:
  - 읽기(포스트/분석/리스트): $0.005/req
  - 유저 읽기·팔로우: $0.010/req
  - 포스트·DM 발송: $0.015/req
  - URL 포함 포스트: $0.200/req (X가 링크 포함 트윗에 13배 요금을 매김)
- 즉 X 계정 1개를 붙이면 매달 "$6(또는 $3/$1) + X 건당 과금"이 든다.

### getxapi (참고 확인)
- 구독 없이 **건당 과금이 기본값**: 표준 엔드포인트(검색/유저정보/타임라인 등) $0.001/call(~20트윗), DM $0.002/call, User Tweets Complete $0.003/call, Article $0.005~0.01/call. 가입 시 $0.10 무료 크레딧.
- 별도로 선불 크레딧팩($10=1만콜, $50=5만콜, 만료 없음)이나 월 구독제(Starter $5 1회성, Pro $15/월, Growth $49/월, Scale $99/월)도 선택 가능.
- 실시간 모니터링 9개 엔드포인트는 건당 과금이 아니라 별도 Monitoring 플랜에 포함.

### 비교 판단
- **읽기(검색/유저정보) 단가**: getxapi가 Zernio보다 압도적으로 저렴하고 유연함(Zernio는 애초에 해당 기능 자체가 없어 비교 불가). 공식 X API 자체가 getxapi의 100배 비싸다는 게 getxapi 자체 계산기의 주장인데, Zernio는 공식 API 요율을 그대로 물리는 구조라 이 비교가 그대로 적용됨.
- **DM 발송 단가**: Zernio $0.015/req vs getxapi $0.002/req — 7배 이상 차이.
- **트윗 작성**: Zernio는 계정 월정액(getxapi는 건당 $0.002)에 포함이라 발행량이 많으면 Zernio가 오히려 유리할 수 있음(다만 URL 포함 트윗은 $0.200/req로 급등).

---

## 6. 신뢰성 신호

- **운영 기간**: 2025년 창업, 이 보고서 작성 시점(2026-08) 기준 약 1년 차 — 신생 서비스. 다만 매출·연결계정 성장 속도는 빠름(10개월 ARR $1M, 6개월 뒤 6M 발행/일·15만 계정).
- **팀 규모**: 6~8인, 부트스트랩(투자 없음), 이익 실현 중(Indie Hackers 인터뷰 자체 언급).
- **인프라**: Vercel + MongoDB + Tinybird, Cloudflare 일부. 99.7%+ 업타임 자체 주장, 상태 페이지(status.zernio.com) 운영.
- **컴플라이언스**: SOC2 + GDPR 문서 보유(trust.zernio.com).
- **문서 품질**: 매우 높음 — Fumadocs 기반, OpenAPI 3.1 스펙 공개, llms.txt/llms-full.txt 별도 제공, SDK 7개 언어, MCP 서버(496개 툴), 용어집(Glossary)까지 잘 정리됨. 이번 조사가 수월했던 이유.
- **외부 리뷰 신호**: 대체로 호평("설정 30분 안에 완료", "SDK가 깨끗함")이나, 독립 리뷰(synopolis.com, 2026-06)는 "버전 번호·안정성 선언이 없고 Java SDK가 아직 0.0.307에 머물러 있어 초기 단계 소프트웨어라는 신호", "일반(비X) 레이트리밋이 아직 공개돼 있지 않음"을 지적함. Rate limit는 X 관련해서는 구체적으로 문서화되어 있음(검색 300/15분, 참여 액션 50/15분, 트윗 생성 300/3시간).
- **X API 의존 리스크**: Zernio 자체가 아니라 X 정책 리스크. 암호화 X Chat DM은 제3자 API로 접근 불가(모든 서드파티 공통 한계라고 명시), DM 쓰기는 Pro 티어 게이팅.
- **SLA**: 명시적 SLA 계약(엔터프라이즈 제외)은 확인되지 않음. 셀프서브 요금제는 상태 페이지·업타임 수치만 제공.

**종합 판단**: 문서·엔지니어링 품질은 좋아 보이나, 1년차 부트스트랩 회사이고 X 관련 기능은 애초에 부가 기능(16개 플랫폼 중 하나)에 불과해 X 특화 지원의 깊이나 장기 투자 우선순위를 신뢰하기엔 이르다. **cb-x-deck의 핵심 워크플로우를 여기에 의존하는 것은 권장하지 않음.**

---

## 7. 마이그레이션 난이도

- **응답 형태**: getxapi는 X API v2 원형에 가까운 응답(트윗/유저 raw 필드)을 반환하는 것으로 보이는 반면, Zernio는 자체 추상화 모델(MongoDB `_id`, `post`/`conversation`/`account` 오브젝트)로 감싸져 있어 **응답 스키마가 서로 다름**. 헤더/베이스URL만 바꿔서 되는 수준이 아님.
- **기능 자체가 없는 항목(고급검색 상세, 유저정보, 타임라인, 계정모니터링, 유저검색, 팔로우확인, 리스트멤버)**: 이식이 아니라 **해당 기능 전체를 새로 설계하거나 포기**해야 함 — "마이그레이션 난이도"를 논할 대상이 아님.
- **겹치는 기능(트윗 작성, DM 발송)**: 별도 OAuth 연결 플로우(계정별 X 로그인 승인)를 cb-x-deck에 새로 구축해야 하고, getxapi의 Bearer-키-only 방식보다 운영 복잡도가 늘어남.

---

## 8. 최종 권고

1. **getxapi를 Zernio로 교체/이관하지 말 것.** 인플루언서 DB의 핵심(검색·유저정보·모니터링)이 Zernio 제품 범위에 없다.
2. **DM 기능은 getxapi로 충분히 커버 가능**해 보이며(문서상 `send_direct_message`/`list_direct_messages`/`get_direct_message_conversation` 존재), Zernio를 추가로 들일 실익은 "실시간 웹훅 알림" 하나뿐이다. 이 하나 때문에 별도 SaaS 구독 + OAuth 연결 + X Pro 티어/암호화 DM 제약을 감수할 가치가 있는지는 낮다고 판단됨.
3. 굳이 실시간 DM 알림이 꼭 필요해지면, "getxapi를 폴링으로 주기 조회 + 우리 쪽에서 변경감지"가 Zernio 신규 도입보다 낮은 리스크의 대안이다.
4. Zernio는 향후 cb-x-deck이 "우리 브랜드 계정으로 X 외 다른 플랫폼(Threads, LinkedIn 등)에도 예약 발행"을 하게 될 때 재검토할 후보로 남겨두는 정도가 적절하다.

## 부록 — 확인 못 한 항목 (추측하지 않음)
- DM을 user id(핸들이 아닌 숫자 ID)로 보낼 수 있는지: 스키마상 `participantId` 필드는 있으나 X 전용 예시가 핸들만 제공돼 확정 못함 — 문서에 명확한 확인 없음.
- Zernio 자사 X 개발자 앱이 실제로 Pro/Enterprise 티어를 보유해 일반 고객의 DM 발송 시 $5,000/월을 대신 흡수하는지: 정황상 추정되나 문서에 명시적 확인 없음.
- getxapi의 DM 미디어 첨부 지원 여부: 이번 조사 범위(Zernio 중심)에서 getxapi 쪽은 상세 검증하지 않음 — 문서에 없음(미조사).
- Zernio의 일반(비X) API 레이트리밋 공개 여부: 외부 리뷰는 "미공개"라고 지적하나 Zernio 자체 문서에서 직접 재확인하지 않음.

---

## 9. 후속 조사 — 클라이언트 계정 관리 관점 (2026-08-12 추가)

**질문**: cb-x-deck이 클리닉(클라이언트)별 X 계정을 연결해 발행·운영까지 대리 관리하는 "에이전시형" 시나리오에서 Zernio가 본업(퍼블리싱 SaaS)과 맞는가?

**한 줄 결론**: 이 시나리오는 Zernio의 **정확한 홈그라운드**다. 1절~8절에서 다룬 "임의 계정 읽기/모니터링" 시나리오와는 정반대로, "우리가 위임받아 클라이언트 계정에 발행"하는 이 용도는 Zernio가 스스로 마케팅하는 핵심 유스케이스(멀티테넌트 API, 에이전시 협업, 화이트라벨)와 정확히 일치한다. 다만 **"클라이언트 승인 게이트"는 네이티브 기능이 아니라 직접 구축해야 한다**는 점이 가장 중요한 함정이다.

### 9-1. 멀티 클라이언트 계정 구조

Zernio의 계층 구조는 3단계로 명확하다: **Team(워크스페이스) → Profile(클라이언트 단위) → Account(연결된 소셜 계정)**.

- **Team**: 우리 회사 전체 계약 단위. 청구·레이트리밋이 팀 단위로 집계됨.
- **Profile**: 클라이언트(테넌트) 격리 단위. "새 팀은 기본적으로 'Default' 프로필로 시작하고, 고객마다 프로필을 하나씩 만든다"(`docs.zernio.com/multi-tenant`). 클리닉 A용 프로필, 클리닉 B용 프로필처럼 분리 가능. 프로필명은 팀 내에서 고유해야 함.
- **Account**: 프로필 안에 속한 실제 연결 계정(클리닉 A의 X 계정 등). 한 계정은 정확히 하나의 프로필에만 속함.
- **팀 협업/권한 분리**: `zernio.com/social-media-collaboration` 마케팅 페이지에 "무제한 팀원 초대, 프로필 단위 공유, 클라이언트 분리(Client Isolation) — 사용자는 자신에게 배정된 프로필만 본다"고 명시. 초대 API(`POST /v1/invite/tokens`)는 `scope: "all" | "profiles"` + `profileIds` + `role`(`admin`/`member`/`billing_admin`/`viewer`)를 지정할 수 있어, **"클라이언트 A 담당자는 A 프로필만"** 같은 권한 분리가 실제로 API 레벨에서 구현돼 있다. `viewer` 역할은 발행/수정/연결 권한 없이 조회만 가능 — 클라이언트 본인에게 읽기 전용 접근을 주는 용도로도 쓸 수 있음(단, 이 경우 클라이언트가 보는 화면은 **Zernio 자체 대시보드**이지 cb-x-deck 화면이 아님).
- **계정 공유**: "같은 프로필의 멤버는 모두 같은 소셜 계정에 발행 가능. 게시 한도는 계정 단위로 추적되고 사용자 단위가 아님"(`zernio.com/social-media-collaboration`) — 팀원별 발행량 제한이나 귀속(attribution) 추적은 없음.

### 9-2. 계정 연결(OAuth) 플로우

- **클라이언트가 직접 승인하는 구조가 맞다.** 흐름은 `GET /v1/connect/{platform}?profileId=...&redirect_url=...` → `authUrl` 반환 → **이 URL을 클라이언트에게 보내 클라이언트 본인이 클릭해 X 로그인 화면에서 직접 승인**. 우리는 클라이언트의 X 아이디/비밀번호를 절대 받지 않는다(X의 정식 OAuth 동의 화면에서 클라이언트가 직접 로그인·승인).
- **두 가지 모드**:
  - **Standard(기본)**: Zernio가 호스팅하는 선택 UI를 거쳐 클라이언트의 브라우저가 우리 `redirect_url`로 돌아옴. 클라이언트는 이 과정에서 "Zernio"라는 브랜드를 보게 됨.
  - **Headless(`headless=true`)**: 선택 UI를 우리가 직접 만들어(완전 화이트라벨) 클라이언트에게 Zernio 브랜드가 노출되지 않게 할 수 있음. OAuth 완료 후 `tempToken`/`connect_token` 등을 우리 서버가 받아 마무리 처리.
  - X(트위터)는 표준 OAuth 플랫폼이라 Facebook/LinkedIn/Pinterest처럼 "2차 선택"(페이지·조직 고르기) 단계가 없음 — X 계정 연결은 단순한 단일 OAuth 리다이렉트로 끝남.
- **연결 유지·토큰 만료 처리**: 두 겹의 안전장치가 문서화돼 있음.
  1. **실시간**: `account.disconnected` 웹훅이 토큰이 죽을 때(비밀번호 변경, 접근 취소, 플랫폼 보안 체크 등) `accountId`+`profileId`를 담아 발화 → 정확히 어떤 클라이언트를 재연결 요청해야 하는지 즉시 알 수 있음.
  2. **주기적 안전망**: `GET /v1/accounts/{accountId}/health`(또는 전체 조회 `/v1/accounts/health`)가 `tokenStatus.valid`, `expiresAt`, `needsRefresh`, 부족한 권한(`missingRequired`) 등을 반환 — 웹훅을 놓쳤을 때 대비한 폴링 안전망으로 공식 가이드가 권장.
  - 재연결은 "같은 `profileId`로 새 connect 플로우를 다시 시작"하면 됨 — 계정을 새로 만들지 않고 기존 연결을 갱신.
- **오프보딩**: 클라이언트 계약 종료 시 계정 연결 해제 → 프로필 삭제. 연결 해제 안 된 계정이 있으면 프로필 삭제가 막힘(안전장치). 남는 리소스는 삭제되지 않고 다른 프로필로 이동됨(데이터 유실 방지).

### 9-3. 발행·운영 기능의 깊이 (X 기준)

기존 1절에서 확인한 내용과 결합하면, X 발행 기능은 실제로 상당히 성숙하다:

| 기능 | 지원 여부 |
|---|---|
| 예약 발행 | ✅ `scheduledFor`+`timezone`, 또는 즉시발행(`publishNow`), 또는 초안(`draft`) — 세 모드가 한 엔드포인트(`createPost`)에서 분기됨 |
| 큐/드립 발행 | ✅ `queuedFromProfile` — 프로필(클라이언트)별로 반복 슬롯(예: 평일 9시/17시)을 정의해두면 이후 포스트들이 자동으로 다음 빈 슬롯에 배정됨. 클라이언트별로 다른 발행 리듬을 유지하기 좋음 |
| 캘린더 | ⚠️ 확인됨(제한적) — 요금 페이지에 "Scheduling + publishing"에 캘린더가 포함된다고 명시되나, 이는 Zernio 자체 대시보드의 캘린더(우리 앱 안에 임베드되는 게 아님). cb-x-deck 자체 캘린더 UI에서 쓰려면 API로 직접 구축해야 함 |
| 스레드 발행 | ✅ `threadItems` 배열로 스레드 구성, 각 항목이 이전 포스트의 답글로 자동 연결 |
| 미디어 | ✅ 이미지 4장(또는 GIF 1장, 5MB/15MB), 영상 512MB/140초(MP4/MOV) — presigned upload 또는 MCP 브라우저 업로드 플로우 |
| 크로스포스트 | ✅ 여러 클라이언트 계정에 동일/커스텀 콘텐츠를 한 호출로 동시 발행(`platforms[]` 배열, `customContent`로 계정별 문구 다르게 가능) |
| 발행 실패 처리 | ✅ 상당히 정교함 — 플랫폼별(`platforms[]`) 개별 상태(`pending/processing/uploading/published/failed/cancelled`) + 에러를 7개 카테고리(`auth_expired`/`user_content`/`user_abuse`/`account_issue`/`platform_rejected`/`platform_error`/`system_error`)로 기계 판독 가능하게 분류. 실패한 플랫폼만 재시도(`retry`), 이미 성공한 건 건드리지 않음 |
| 게시 후 수정 | ⚠️ X만 가능 — X Premium 연결 계정 한정, 게시 1시간 이내에만 |
| 게시 취소(unpublish) | ✅ X 지원(Instagram/TikTok/Snapchat은 미지원) |

**클라이언트별 운영 관점에서 강점**: 큐 스케줄링이 프로필(=클라이언트) 단위이므로 클리닉마다 다른 발행 리듬을 유지하기 쉽고, 에러 분류가 세밀해 "이건 클라이언트가 고쳐야 할 문제(콘텐츠 위반)"와 "이건 우리가 재연결을 요청해야 할 문제(토큰 만료)"를 코드로 구분해 자동 알림을 만들 수 있음.

**⚠️ 가장 중요한 발견 — 클라이언트 승인 게이트는 네이티브 기능이 아님**: Zernio 공식 문서의 포스트 상태 기계는 `draft → scheduled → publishing → published/partial/failed/cancelled` 뿐이고, **"승인 대기(pending review)"나 "승인됨(approved)" 상태가 없다.** 검색 중 발견된 `zernio_approve_post` 툴이나 "승인 후에만 발행" 스킬들은 전부 **Zernio가 아닌 서드파티/커뮤니티 레이어**(`glama.ai`에 올라온 비공식 `zernio-mcp` 래퍼, `danielfoch/supoclip-zernio-approval`, 개인 개발자의 `zernio-cli` 스킬)가 Zernio의 `draft` 상태 + 자체 챗봇/승인 로직을 얹어 흉내낸 것이다. Zernio 자사 블로그(`zernio.com/blog/white-label-social-media-scheduler`, `.../social-media-management-platform-comparison`)조차 "클라이언트 승인 워크플로"를 Hootsuite·Sendible·SocialPilot·Statusbrew 같은 **경쟁사의 강점**으로 소개하며, Zernio 자신은 "이런 걸 API로 직접 만들 수 있는 인프라"로만 포지셔닝한다. 즉 **"클리닉이 콘텐츠를 승인해야 발행되는" 게이트는 cb-x-deck이 `isDraft:true`로 저장 → 우리 앱 안에서 승인 상태를 자체 관리 → 승인되면 API로 `scheduledFor`/`publishNow`로 전환하는 방식으로 직접 구현해야 한다.**(Zernio는 이 그릇만 제공)

### 9-4. API-first 통합 (cb-x-deck에서 프로그래매틱하게)

- **가능하다.** 이것이 Zernio의 설계 목적 그 자체다. 공식 "Build a Platform" 가이드(`docs.zernio.com/multi-tenant`)가 정확히 이 패턴을 다룬다: (1) 클리닉 온보딩 시 `POST /v1/profiles`로 프로필 생성 → `profile._id`를 우리 클리닉 레코드에 저장, (2) `GET /v1/connect/twitter?profileId=...`로 연결 링크 생성해 클리닉에 전달(=**API로 계정 연결 링크 생성 가능, 요청하신 항목 확인됨**), (3) `account.connected` 웹훅으로 `accountId`↔`profileId` 매핑을 우리 DB에 저장, (4) 이후 `POST /v1/posts`로 해당 `accountId`를 지정해 발행.
- 웹훅은 **팀당 최대 10개, 프로필별이 아님** — 여러 클리닉을 운영해도 엔드포인트 하나로 받고, payload의 `accountId`/`profileId`로 우리 쪽에서 클리닉별로 라우팅해야 함(공식 가이드가 이 라우팅 테이블 예시까지 제공).
- **레이트리밋은 팀 전체 연결계정 수에 비례**해 자동으로 늘어남(0~2계정: 60회/분, 3~2,000계정: 600회/분, 2,001+: 1,200회/분) — 클리닉이 몇 개든 API 키 하나로 충분하고, 클리닉 수가 늘수록 예산도 같이 늘어나는 구조. 다만 그 예산은 "우리 팀 전체가 공유"하는 것이라, 특정 클리닉이 몰아서 대량 작업을 하면 다른 클리닉 몫을 잠식할 수 있어 우리 쪽에서 큐잉으로 공정성을 관리해야 한다고 가이드가 직접 권고함.
- **Scoped API Key**로 특정 프로필(클리닉)에만 접근 가능한 키, 읽기 전용 키, 만료 기한이 있는 임시 키를 발급할 수 있음 — 예: 특정 클리닉 전용 백엔드 서비스나 분석 대시보드에 발급.
- MCP 서버 관점에서도 `posts_create`류 코어 툴이 "멀티 계정/에이전시" 상황을 1급 시민으로 취급함: 동일 플랫폼에 계정이 여러 개면 `account_id` 또는 `profile_id`로 명시하게 강제하고, 모호하면 조용히 아무거나 고르지 않고 후보 목록과 함께 에러를 반환함(`docs.zernio.com/mcp/tools`) — 여러 클리닉 계정을 다루는 자동화에서 실수로 잘못된 클리닉에 발행되는 사고를 막는 설계.

### 9-5. 가격 관점 — 클라이언트 계정 N개 연결 시

- 계단식: 1~2개 무료, 3~10개 $6/월/개, 11~100개 $3/월/개, 101개+ $1/월/개(상한 없음). 일 단위 프로레이션(월 중 연결/해지 시 일할 계산).
- **예시 계산(X 계정만 기준)**:
  - 클리닉 10곳(각 X 계정 1개) = 계정 10개 → 처음 2개 무료 + 나머지 8개 × $6 = **월 $48** (기본 구독료만)
  - 클리닉 20곳 = 계정 20개 → 2개 무료 + 8개×$6 + 10개×$3 = **월 $78**
  - 클리닉 100곳 = **월 $318** (본문 1절 표와 동일한 산정식)
- **여기에 더해 X 전용 건당 과금이 별도로 붙는다**(마진 없이 X 공식 요율 그대로 pass-through): 읽기/분석 $0.005/req, 유저읽기·팔로우 $0.010/req, **포스트 발행·DM발송 $0.015/req**, **URL 포함 포스트는 $0.200/req**. 클리닉이 자기 홈페이지·예약 링크를 트윗에 자주 넣는 업종 특성상, "URL 포함 포스트 13배 요금"이 실제 비용에서 무시 못 할 변수가 될 수 있음(예: 클리닉 10곳이 각각 월 20건씩 링크 포함 트윗을 올리면 200건 × $0.200 = **월 $40 추가**, 링크 없는 트윗이었다면 200 × $0.015 = $3에 불과).
- 대시보드에서 **월 X 지출 캡**을 설정할 수 있어(80% 도달 시 경고 메일, 100% 도달 시 X 분석·인박스 폴링 자동 일시정지) 클리닉 수가 늘어날 때 예산 폭주를 막는 장치는 마련돼 있음.
- **비교 감각**: 클리닉 10곳 규모라면 월 $48 기본료 + 건당 과금 수$~수십$ 수준으로, 이 정도 규모에선 부담스러운 금액은 아님. 다만 클리닉이 늘어날수록(11개부터 $3, 101개부터 $1로 계단이 낮아지므로) 스케일업 자체는 가격 구조상 자연스럽게 유리해진다 — 에이전시 규모 확장을 전제로 설계된 요금제라는 점이 뚜렷하다.

### 9-6. 에이전시 유스케이스 평판/한계

- Zernio 자사 콘텐츠(`zernio.com/social-media-collaboration`, `/blog/white-label-social-media-management`, `/blog/white-label-social-media-scheduler`, `/blog/hootsuite-alternative-for-agencies`, `/blog/social-media-management-platform-comparison`)가 에이전시·화이트라벨 유스케이스를 **명시적 타깃**으로 밀고 있음 — "Agencies managing 100+ client social accounts programmatically", "Multi-Client & Team Collaboration... thousands of posts across dozens of client profiles". 다만 이건 전부 **Zernio 자신이 쓴 마케팅/SEO 블로그**라는 점을 감안해야 함(중립적 3자 검증 아님).
- 독립 리뷰(`thatmarketingbuddy.com`)는 에이전시 관점에서 정직한 트레이드오프를 짚음: *"계정당 과금이라 브랜드 프로필을 많이 운영하는 팀은 유저당 과금(Buffer/Publer 등)보다 비쌀 수 있다. 클라이언트 계정 10개를 관리하는 소셜미디어 매니저는 무료 티어 이후 월 $48을 내야 하는데, 이는 전통적 유저당 스케줄러보다 훨씬 비싸다."* — cb-x-deck처럼 "계정 수는 늘고 담당 인원(2~5명)은 적은" 구조에는 오히려 유리하지만, 반대로 "인원은 많고 계정 수는 적은" 조직에는 불리한 가격 구조라는 점은 명확히 인지해야 함.
- Zernio 자신이 쓴 경쟁사 비교글이 스스로 인정하는 한계: *"Zernio는 기계 대면(machine-facing) API다 — Hootsuite/Sendible/Agorapulse/SocialPilot/Statusbrew처럼 클라이언트 승인 워크플로, 클라이언트 포털 UI, 화이트라벨 리포트가 기본 제공되는 인간 대면(human-facing) 툴이 아니다. 개발 리소스가 있는 기술 중심 에이전시에게 적합하고, UI 그대로 쓰고 싶은 에이전시는 Sendible/Agorapulse/SocialPilot을 보라"*(요약). cb-x-deck은 이미 자체 앱(Next.js)이 있으므로 이 한계는 "우리가 UI를 이미 만들고 있으니 문제 없음"으로 해석할 수 있음 — 오히려 API-first라는 점이 cb-x-deck 같은 자체 도구 보유 조직에는 자연스럽게 맞는 포지셔닝.
- 신뢰성 신호는 1~8절과 동일(2025년 창업, 부트스트랩 6~8인, ARR $1M+, 15만+ 연결계정, 문서 품질 우수) — 다만 에이전시向 SLA/전담 지원은 "2,000+ 계정부터" 엔터프라이즈 계약에서만 제공(전담 Slack, SSO/SCIM, postpaid 인보이싱). 클리닉 10~50개 규모라면 셀프서브 요금제로 충분하지만, 엔터프라이즈급 지원(전담 채널)은 기대하기 어려움.

### 9-7. 종합 판단 (클라이언트 계정 관리 관점)

이 시나리오는 1~8절의 "인플루언서 데이터 조회" 시나리오와 **완전히 다른 결론**이 나온다.

- **구조적 적합성**: 높음. Team/Profile/Account 3단 구조, 프로필 단위 권한 분리, OAuth 기반 클라이언트 자기승인 연결, 웹훅+헬스체크 기반 재연결 관리, 프로필 단위 큐 스케줄링, 세밀한 에러 분류 — 이 전부가 "에이전시가 다수 클라이언트 X 계정을 대리 운영"하는 요구를 정확히 겨냥해 설계돼 있고, 우리처럼 자체 앱을 API로 붙이는 조직에 자연스럽게 맞는다.
- **가장 큰 빈틈**: 클라이언트 승인 게이트(콘텐츠 발행 전 클리닉 확인·승인)가 네이티브 기능이 아니다. `draft` 상태 + 우리 앱의 자체 승인 로직으로 직접 만들어야 한다. 다만 이건 애초에 cb-x-deck이 자체 프로덕트 로직(승인 상태·알림 등)을 이미 자체 DB/UI에 갖고 있을 가능성이 높으므로, "Zernio의 draft를 우리 앱의 승인 큐와 연동"하는 정도의 추가 구현이면 될 것으로 보임 — 큰 장애물은 아니나 "그냥 되는 기능"으로 기대하면 안 됨.
- **비용은 계정 수 기준**이라 클리닉 수가 늘수록 계단식으로 유리해지지만, 클리닉이 링크 포함 트윗을 자주 올리면 X 자체의 "URL 포함 포스트 13배 요금" 때문에 예상보다 청구서가 튈 수 있어 지출 캡 설정이 실질적으로 필요함.
- **다만 이것이 getxapi를 대체한다는 의미는 아니다.** 1~8절 결론은 그대로 유효하다: 인플루언서(제3자) 데이터 조회·검색·모니터링은 여전히 getxapi 몫이고, Zernio는 "우리가 위임받아 운영하는 클리닉 자체 계정"의 발행·DM·분석 레이어에서만 검토 대상이 된다. cb-x-deck이 클리닉 X 계정을 직접 운영대행하는 기능을 만들 계획이 실제로 있다면, Zernio는 이번 조사 대상 중 처음으로 "본업이 맞아떨어지는" 후보다.

## 부록 2 — 클라이언트 계정 관리 관점에서 확인 못 한 항목
- Zernio 자체 대시보드에서 클라이언트(viewer 역할)에게 보이는 화면이 실제로 얼마나 "클라이언트 친화적"인지(캘린더/리포트 UI 품질)는 스크린샷·데모를 직접 보지 못해 확인 못함.
- 프로필당 큐(queue) 개수 제한, 팀당 프로필 개수 제한이 있는지: 문서에 명시적 상한이 없음(무제한으로 보이나 별도 확인 없음).
- X 계정의 OAuth 리프레시 토큰(`offline.access`)이 실제로 몇 일/개월 주기로 재인증을 요구하는지 X 전용 수치: Instagram 예시(180일)만 문서에서 확인, X 전용 수치는 문서에 없음.
