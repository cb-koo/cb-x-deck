# X Chat(XChat) 자체 구현 가능성 리서치

- 작성일: 2026-08-13
- 목적: cb-x-deck의 DM 조회 갭(getxapi가 X Chat 암호화 DM을 못 읽음) 해소를 위해, tweetapi.com처럼 authToken+PIN을 제3자에게 위임하지 않고 "우리가 직접" X Chat을 읽기/쓰기 구현하는 것이 현실적인지 판단하기 위한 재료 수집. 구현 가이드가 아니라 판단 재료 정리.
- 범위: 간단한 리서치(Exa 웹서치/웹페치)로 확인 가능한 공개 자료만. 직접 프로토콜을 테스트하거나 코드를 작성하지 않았음.

---

## 핵심 결론 먼저

1. **공개 기술 자료는 예상보다 훨씬 풍부하다.** 보안 연구자 다수(Matthew Garrett, Matthew Green), 전문 보안기업(Trail of Bits)의 공식 감사, 독립 리버스엔지니어링 블로그, 학술 평가 논문까지 존재한다. 프로토콜의 약점과 구조가 상세히 문서화돼 있다.
2. **가장 중요한 발견: X가 최근(2026-07-20) 공식 오픈소스 암호화 SDK(`xdevplatform/chat-xdk`)와 공식 X API v2 Chat 엔드포인트(`/2/chat/...`)를 공개했다.** 이는 리버스엔지니어링이나 제3자 위임 없이, 표준 OAuth 사용자 토큰 + 공식 SDK로 XChat을 읽고 쓸 수 있는 정식 경로가 이미 존재한다는 의미다. 다만 생성 3주 정도밖에 안 된 매우 초기 단계(스타 15개)라 안정성은 검증되지 않았다.
3. **프로토콜은 계속 빠르게 바뀌고 있다.** 2023년 최초 출시 이후 중단·재출시·확대·전면교체·독립 앱 출시까지 1년 반 사이 최소 6번의 큰 변화가 있었고, 지금도 진화 중이다. 유지보수 부담은 상당할 것으로 판단된다.
4. **보안 커뮤니티의 평가는 일관되게 비판적이다.** Forward secrecy 없음, MITM 방지 없음(X 스스로 인정), 개인키가 X 서버(Juicebox)에 PIN으로 보호되어 저장 — 이는 "우리가 직접 구현"해도 사라지지 않는 구조적 특성이다(PIN이 궁극적으로 X에 도달하는 것은 tweetapi를 거치든 우리 서버가 직접 하든 동일. 차이는 "중간에 신뢰해야 할 제3자가 있는지"뿐).

---

## 1. 공개 기술 분석

### X 자체 공식 문서
- X 지원 문서(help center)는 짧고 기술적 세부사항이 없다. "MITM 방지 기능 없음", "악의적 내부자나 X 자신이 대화를 훼손해도 알 수 없음"을 스스로 인정.
- 2025년 중반 "화이트페이퍼를 연내 공개하겠다"고 약속했으나, 2026년 4월 기사(tesorb.com) 기준까지도 **화이트페이퍼는 미공개** — 확인됨(추측 아님).

### 독립 보안 연구자 분석 (다수, 상세)
- **Matthew Garrett** (mjg59.dreamwidth.org, 2025-06): X Android 앱을 리버스엔지니어링해 프로토콜 초기 버전 분석. Juicebox 기반 키 복구, Argon2id PIN 해싱(4자리 PIN, 최대 10,000 조합), MITM 취약점을 구체적으로 지적. "Use Signal."
- **Matthew Green** (Johns Hopkins, blog.cryptographyengineering.com, 2025-06): Juicebox 프로토콜 자체의 설계(OPRF, threshold recovery)와 X 배포에서의 신뢰 문제를 깊게 분석.
- **David Nepozitek** (2025-11): X Android 앱을 다시 리버스엔지니어링해 프로토콜을 상세 재구성(ECDH P-256 + HKDF + libsodium SecretBox 등 구체적 알고리즘, 부록에 코드 스니펫 포함). "X Chat은 E2EE가 아니다"라고 결론.
- **Trail of Bits** (trailofbits.com/library/x-xchat/, 2025-10): X의 요청으로 수행된 **공식 보안 감사**. 6건의 이슈 발견 — High 3건(암호화된 대화키 미검증, 서명 없는 장기 식별키 미거부, 서버 재생 공격에 대한 대화키 미검사), Medium 1건(그룹 키 불일치로 인한 "Invisible Salamander" 공격 가능), Informational 1건(아바타/첨부파일 암호화의 confused deputy 공격), Undetermined 1건(잘린 SHA-1 사용).
- **학술 평가**: ResearchGate에 게재된 "A Security Evaluation of XChat End-to-End Encryption Claims"(2026-01) — 블랙박스 방식(리버스엔지니어링 없이 더미 계정으로 행동 테스트)으로 forward secrecy·post-compromise security·metadata 보호 부재를 확인. 결론: "암호화된 메시징으로 분류해야 하며, 암호학적으로 견고한 E2EE는 아니다."

### Juicebox 프로토콜 자체 (X의 배포 방식이 아니라 프로토콜 원본)
- Juicebox Systems가 공개한 화이트페이퍼(juicebox.xyz)와 IACR ePrint 2025/348 학술 논문으로 프로토콜 자체는 투명하게 문서화됨. 오픈소스 클라이언트/서버 구현도 GitHub(`juicebox-systems/juicebox-sdk`)에 존재.
- X의 구체적 배포 파라미터(realm 3개 중 2개로 복구, Argon2id m_cost=16MB·t_cost=32, PIN 4자리 제한 등)는 리버스엔지니어링을 통해 확인됨 — X가 직접 공개한 것은 아님.

**요약**: 프로토콜 분석 자료는 "전무"가 아니라 매우 풍부하고 구체적이다. 알고리즘 수준(P-256 ECDH, HKDF-SHA256, libsodium SecretBox/secretstream, Thrift 와이어 포맷)까지 재구성되어 있다.

---

## 2. 오픈소스 구현체

### 공식 (X 제공) — 가장 중요한 발견
- **`xdevplatform/chat-xdk`** (GitHub, MIT 라이선스, 생성 2026-07-20): X의 공식 개발자 플랫폼 조직(`xdevplatform` — developer.x.com 운영 주체, 6,000+ 팔로워, 113개 공개 저장소를 보유한 실제 공식 조직)이 공개한 **암호화 SDK**. Rust 코어 + Python(PyO3)/JavaScript(WASM)/Go/.NET/JVM 바인딩 6종 언어 지원.
  - 키 관리 방식 두 가지 지원: (a) Juicebox로 PIN 기반 키 복구, (b) `selfCustody: true`로 Juicebox를 건너뛰고 새 디바이스 키를 직접 등록(이 경우 PIN 자체가 필요 없음. 단, 기존 대화의 과거 키를 이 방식으로 복구할 수 있는지는 문서상 명확치 않음 — **확인 안 됨**).
  - `docs/CRYPTO.md`에 알고리즘까지 투명하게 문서화(P-256, AES-128-GCM ECIES, XSalsa20-Poly1305, HKDF-SHA256 — 순수 Rust 구현, libsodium C 바인딩 불필요).
  - `xdevplatform/xchat-bot-python` 저장소에 공식 봇 예제(로그인→언락→실행 흐름)도 제공.
  - **주의**: 생성된 지 약 3주(스타 15개, open issue 0개)로 매우 초기 단계. 실사용 안정성·API 변경 가능성은 검증되지 않았다.

- **공식 X API v2 `/2/chat/*` 엔드포인트**: `developer.x.com` 하위에 `GetChatConversations`, `SendChatMessage`, `AddConversationKeys`(대화키 등록/회전), `GetUserPublicKeys`(공개키 + Juicebox 설정 조회) 등 15개 오퍼레이션이 표준 OAuth 2.0 사용자 토큰(`dm.read`/`dm.write` 스코프)으로 문서화되어 있다(서드파티 API 문서 미러 사이트인 apis.io/api-evangelist를 통해 스펙을 확인; developer.x.com 원본 페이지는 직접 열지 않았음 — **원본 페이지 직접 확인은 안 됨**, 다만 스펙의 `externalDocs`가 일관되게 `developer.x.com`을 가리키고 있어 공식 스펙일 가능성이 높음).
  - 이 엔드포인트는 표준 X API v2 요금제(2026년 기준 pay-per-use, DM 이벤트류 읽기 약 $0.01/건)에 포함되어 있어 별도 Enterprise 계약 없이 접근 가능해 보인다.
  - **의미**: `chat-xdk`(클라이언트 크립토) + 공식 `/2/chat/*`(전송) 조합이면, 계정 소유자 본인의 OAuth 토큰만으로 — 즉 tweetapi 같은 제3자에게 authToken+PIN을 넘기지 않고 — 자체 서버가 직접 X와 통신하며 XChat을 읽고 쓸 수 있는 정식 경로가 이미 존재한다.

### 리버스엔지니어링 기반 오픈소스
- **emusks** (JS, 리버스엔지니어링): "XChat 전체 지원"을 주장하며 `createIdentity({ pin })` → `message()` 한 줄로 E2E 암호화 DM 발송 가능. **X로부터 DMCA 통지를 받은 유일한 오픈소스 트위터 클라이언트**라고 자체 명시 — 리버스엔지니어링 방식의 법적 리스크를 보여주는 실제 사례.
- **Rettiwt-API PR #856** (draft, 2026-04~06 활동): 암호화 이벤트를 로컬에 이미 있는 대화키로 복호화하는 데는 성공했지만, 키 배포·회전(`conversation_key_change` 이벤트) 자체를 재구성하는 작업은 2026-06 시점에도 "아직 크래킹하지 못함"으로 draft 상태 유지 — 활발한 오픈소스 시도조차 완성까지 시간이 걸린다는 근거.
- **twitter-web-exporter PR #138**: 크립토를 재구현하지 않고, 공식 웹 클라이언트가 브라우저 안에서 스스로 복호화한 결과를 훅(`Worker.postMessage` 감청)으로 가로채는 "패시브" 방식. 자체 암호화 구현이 필요 없다는 점에서 리스크가 낮지만, 브라우저 자동화가 전제됨.
- **`@higuchan123/twitter_lib`** (npm): authToken+passcode로 시크릿을 복구해 DM을 읽고/쓰는 라이브러리. tweetapi와 로직은 유사하지만 **라이브러리 형태**라 자사 서버에서 직접 실행 가능(제3자에게 PIN을 넘기지 않음).
- **twscrape / twikit**: **미지원 확인됨**. twikit GitHub 이슈 #401에서 기여자가 "암호화라 엄청난 작업이 필요할 것 같고, 나는 암호학에 능숙하지 않다"고 명시 — 두 라이브러리 모두 XChat을 지원하지 않는다.

---

## 3. 보안 커뮤니티의 평가

일관되게 비판적이며, 여러 독립 연구자와 공식 감사(Trail of Bits)가 같은 결론에 도달함.

- **Forward Secrecy·Post-Compromise Security 없음**: 대화키(conversation key)가 정적이고, 참가자의 장기 식별키(identity key)로 언제든 재구성 가능. 식별키 하나만 유출돼도 그 사용자의 과거·미래 메시지 전체가 노출됨.
- **MITM/AITM 방지 없음**: X가 공식 지원 문서에서 스스로 인정. 서버가 공개키 배포 과정을 장악하고 있어, 악의적 내부자나 법적 강제 절차로 X 자신이 통신을 가로챌 수 있어도 사용자는 알 방법이 없음.
- **개인키가 X 서버에 저장됨**: Juicebox로 3개 realm(모두 x.com 도메인, 즉 X 통제 하)에 샤딩되어 저장. PIN(4자리로 제한, Juicebox 프로토콜 자체는 더 긴 PIN을 지원함에도)으로 보호되며, HSM 사용 주장은 검증되지 않음("trust us, bro" — Garrett).
- **Trail of Bits 공식 감사(2025-10)**: High 3건 포함 총 6건 이슈. 그룹 대화에서 "Invisible Salamander" 공격(그룹 키 불일치를 이용한 공격) 가능성까지 확인됨.
- **종합 평가**: 여러 소스가 "XChat은 E2EE라 부르기엔 부족하며, Signal보다 명백히 약하다"는 데 동의. 다만 "완전히 깨진 것"도 아니고, libsodium 등 검증된 1차 암호 라이브러리를 사용하며 지속적으로 개선 중(포워드 시크러시 추가를 "향후 계획"으로 공표).

**시사점**: 이 구조적 약점(개인키의 X 서버 보관, MITM 무방비)은 우리가 "직접 구현"해도 없어지지 않는다 — XChat 프로토콜 자체의 설계이기 때문이다. 다만 tweetapi처럼 PIN을 제3자 서버에 한 번 더 위임하는 "추가" 신뢰 지점은 우리가 직접 공식 SDK/API를 쓰면 제거된다.

---

## 4. 프로토콜 변동성 (유지보수 부담 판단 재료)

출시 이후 확인된 주요 변화 타임라인:

| 시기 | 변화 |
|---|---|
| 2023 | Twitter 시절 최초 암호화 DM 출시(디바이스별 키, 확장성 문제, 매우 제한적) |
| 2025-05 | 기존 암호화 DM 기능 일시 중단("개선" 작업 이유) |
| 2025-06 | XChat이라는 이름으로 재출시(베타, X Premium 한정, 1:1만·그룹/미디어 미암호화) |
| 2025-09 | 비구독자까지 확대 롤아웃 |
| 2025-11 | 전체 공개 출시. 그룹 메시지·미디어 암호화 추가, 영상/음성 통화, 사라지는 메시지, 스크린샷 알림/차단 등 대거 추가 |
| 2025-12 | 레거시 DM을 전면 대체(전 사용자, 전 플랫폼) |
| 2026-04 | Voice Notes 기능 복귀 + XChat 독립 iOS 앱 출시(Communities 대체 목적) |
| 2026-07 | (이번 리서치에서 확인) 공식 오픈소스 SDK(`chat-xdk`) + 공식 API v2 Chat 엔드포인트 공개 |
| 진행 중 | 다중 첨부파일, 키 검증/안전번호(세이프티 넘버) 기능 등 예고 상태 |

**판단**: 1년 반 사이 최소 6차례의 대규모 변화(중단→재출시→기능 추가→전면 교체→앱 분리→공식 SDK 공개)가 있었고, 지금도 활발히 개발 중이다. 자체 구현체를 유지한다면 X의 각 변경마다 프로토콜/엔드포인트 추적·대응이 필요해 유지보수 부담이 상당할 것으로 판단된다. 다만 공식 SDK가 이제 존재하므로, 이를 채택하면 X가 SDK를 업데이트하는 한 우리가 프로토콜 변경을 직접 추적할 필요는 줄어든다(SDK 자체의 신뢰성·업데이트 주기는 아직 검증 안 됨).

---

## 5. tweetapi 외 대안

| 서비스 | 방식 | PIN/authToken 위임 여부 |
|---|---|---|
| tweetapi.com | `/tw-v2/xchat/*` — authToken+userId+PIN을 요청 본문에 전달 | 위임함(문서에 명시) |
| TwexAPI | "XChat v3" 엔드포인트(DM 조회/전송/미디어) 제공. 문서상 "auth_token 또는 쿠키를 요청 본문에 전달"이 필요하다고 명시 | 위임함(PIN 요구 여부는 문서에서 구체적으로 확인 안 됨이나 구조상 유사할 가능성이 큼) |
| twitterapi.io | 비교 표에 "DM workflows"는 있으나 XChat 특정 지원 여부는 "정확한 동작 확인 필요"라고 자체 언급 | **확인 안 됨** |
| ApiTwitter | DM 엔드포인트는 있으나 XChat(암호화) 관련 언급 없음 | 해당 없음(미지원으로 추정, 확인 안 됨) |
| **공식 X API v2 `/2/chat/*`** | 계정 소유자 본인의 OAuth 토큰 + 공식 `chat-xdk` SDK로 직접 암복호화 | **위임 없음** — 제3자 서버를 거치지 않음 |

**결론**: tweetapi와 동일한 "authToken+PIN 위임" 구조를 쓰는 대안(TwexAPI 등)은 더 있지만, 근본적으로 같은 신뢰 문제를 갖는다. 유일하게 위임 문제 자체를 없애는 경로는 제3자 서비스가 아니라 **X 공식 SDK+API를 직접 채택하는 것**이다.

---

## 종합 판단

- **공개 재료**: 풍부함. 프로토콜 분석(다수 독립 연구자 + 공식 Trail of Bits 감사), 오픈소스 참고 구현(리버스엔지니어링 기반 다수 + 이제는 **공식 SDK까지**) 모두 존재.
- **자체 구현 난이도**: 처음 가정했던 "리버스�스니어링을 우리가 직접 해야 한다"는 전제가 최근(2026-07) X의 공식 SDK/API 공개로 상당히 낮아졌다. 다만 그 공식 경로는 매우 초기 단계(3주 차)라 실전 안정성은 미검증이며, 기존 대화(이미 Juicebox로 백업된 키)를 새 "디바이스"로 읽어오려면 결국 PIN 기반 Juicebox 복구를 우리 서버가 X와 직접 수행해야 할 가능성이 높다(제3자 위임은 없어지지만, PIN을 X에 제출하는 행위 자체는 여전히 필요 — 이는 프로토콜 설계상 불가피).
- **한 줄 결론**: 리버스엔지니어링 없이도 자체 구현이 가능해 보이는 정식 경로(공식 SDK+API)가 방금 등장했으나 극히 초기 단계이므로, 바로 채택하기보다는 이 SDK의 안정성·문서화 진행 상황을 몇 주~몇 달 지켜본 뒤 소규모 PoC(우리 소유 테스트 계정으로 1:1 대화 하나만 읽기)로 재검증하는 것을 권장한다.

---

## 부록 (08-13 추가 확인): `/2/chat/*` 티어 요건·요금 — 비용 장벽 소멸

같은 날 후속 핀포인트 확인 결과 (소스: `xdevplatform/docs` 저장소 = docs.x.com 빌드 원본, X 개발자 약관 PPU Pilot Agreement):

**티어 요건**
- X API는 2026-02-06부터 신규 개발자에게 Free/Basic($200)/Pro($5,000) 구독 티어를 폐지하고 **pay-per-usage(선불 크레딧 차감형)** 로 전환. Basic/Pro는 기존 구독자 전용 유산.
- `/2/chat/*` 전 엔드포인트(대화 목록·조회·전송·키 관리)는 **Enterprise 전용 목록에 미포함** = 일반 pay-per-use 계정에서 사용 가능. 엔드포인트별 등급 차이 없음.
- OAuth `dm.read`/`dm.write` 스코프 승인은 티어와 무관 (사용자 동의 절차일 뿐).

**고정비 없음 (공식 문서 원문 확인)**
- "No contracts, subscriptions, or minimum spend. Start and stop anytime." (pricing.mdx)
- "You can have months with zero usage and zero cost." (post-cap.mdx FAQ)
- 크레딧: 원칙적 무만료("Credits do not expire unless otherwise specified", PPU 약관). 수동 충전 최소액은 공식 문서에 숫자 없음, 자동재충전 규정만 $10~$100(임계값 통상 $5). 신규 가입 무료 크레딧 없음(문서화된 "무료"는 지출액 기준 xAI 크레딧 캐시백뿐).
- 요금: DM 읽기 $0.010/리소스, 쓰기 $0.015/요청. 웹훅 이벤트 `chat.received` $0.010, `chat.sent`·`chat.conversation_join` 무과금.

**미확인으로 남은 것**: `/2/chat/*` 전용 rate limit(공식 rate-limits 문서에 항목 자체가 없음), chat REST 호출이 DM 과금 SKU를 공유하는지 여부.

**결론 갱신**: 본문의 "티어 게이팅 여부가 선결 확인 사항"은 해소됨 — 필요한 것은 개발자 계정(무료) + 계정 소유자 OAuth 승인 + 크레딧(~$10 시작)뿐. 남은 유보는 SDK 성숙도(공개 3주차)뿐이며, 안정화 관망 후 테스트 계정 PoC 권고는 유지.
