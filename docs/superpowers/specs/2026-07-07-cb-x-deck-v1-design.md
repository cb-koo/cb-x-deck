# cb-x-deck v1 설계 (2026-07-07)

## 1. 목적과 배경

X 콘텐츠 생산 프로세스의 병목인 **기획(글감·포맷 발굴)의 탐색 단계**를 지원하는 TweetDeck식 벤치마크 리서치 도구.

- 방법론: 패턴 일반화가 아닌 **개별 사례 벤치마크** — 사례를 원형 그대로 수집·보관
- 현재 수작업 워크플로우(GetXAPI 검색 스윕 → 마크다운 산출물 정리)를 상시 사용 가능한 웹앱으로 전환. 2026-07-06 스윕에서 검증된 쿼리 골격(키워드 × min_faves × lang:ja × 기간 × filter:images × 조회수 재필터)을 그대로 제품화
- **X-Virality 프로젝트와 별개.** 그 결론(공식·지표)을 이 도구의 전제로 사용하지 않음. 도구 인프라(GetXAPI 호출 패턴)만 재사용

## 2. 사용자와 단계

- **v1(이 spec)**: 박구건 개인용, 이 맥북에서 로컬 실행 (`npm run dev`)
- **v2(후속)**: 담당자 포함 팀용 — Vercel 배포 + 로그인 추가. v1 스택 선택은 이 전환을 전제로 함(데이터가 처음부터 클라우드 Supabase에 있어 이전 작업 0)

## 3. 스택

| 항목 | 선택 | 근거 |
|---|---|---|
| 앱 | Next.js (App Router) + TypeScript | 팀 익숙 스택(cb-social-content-workflow와 동일), v2 배포 용이 |
| DB | 클라우드 Supabase **신규 프로젝트** (무료 티어) | cb-sponsorship-tracker와 분리. 로컬 DB 배제(이 맥북 Homebrew/Docker 불가 + v2 전환) |
| X 데이터 | GetXAPI REST 직접 호출 ($0.001/call) | cb-sponsorship-tracker에서 실검증된 패턴 재사용. 읽기 전용이라 `GETXAPI_KEY`만 필요(auth_token 불필요) |
| 연관 키워드 | Anthropic API (Haiku급) | 호출당 비용 무시 가능 |
| 갱신 | **수동만** — 컬럼별 새로고침 버튼 | 벤치마크 탐색은 실시간성 불필요, 비용은 사용 세션 중에만 발생 |

키(`GETXAPI_KEY`, `ANTHROPIC_API_KEY`, Supabase 접속정보)는 전부 서버측 `.env`(gitignore)에만. GetXAPI·Claude 호출은 Next.js API Route 경유, 브라우저에 키 미노출.

## 4. 컬럼 (v1 = 2종)

### 4-1. 검색 컬럼 (search)
- `advanced_search_tweets` + 페이지네이션
- 사용자 설정 필터: 키워드(복수, OR 조합) / min_faves 하한 / 기간(since–until) / 언어(기본 ja) / 이미지만(filter:images) / **조회수 하한(API 미지원 → 수신 후 클라이언트 재필터)**
- 기본값 = 2026-07-06 스윕 확정치(min_faves 200–500 하한, lang:ja, filter:images)

### 4-2. 워치리스트 컬럼 (watchlist)
- `get_user_tweets`로 특정 계정 최신 트윗 (예: @hadakan__ 같은 주목 신생 계정)
- 미해결 과제였던 "워치리스트 보완"의 해소 수단

### v1 제외 (후속 백로그)
Bookmarks 컬럼(`list_bookmarks`, 수집 인박스) / Likes 컬럼(`get_user_likes`, 큐레이터 좋아요 훔쳐보기) / List 합성 컬럼(멤버 tweets 병합) / 자동 폴링 / 급상승·재발견 추적. GetXAPI에 없는 것: 트렌드, 검색 자동완성(typeahead).

## 5. 연관 키워드 발굴 (v1 포함)

1. **LLM 확장 제안 (검색 전)** — 키워드 입력 시 Claude가 연관어 제안: 일본어 표기 변형(레티날→レチナール/レチノール/ビタミンA 등)·인접 개념(성분→고민→시술명). UI = 입력창 옆 제안 칩, 클릭으로 쿼리에 OR 추가
2. **해시태그 공출현 패널 (검색 후)** — 이미 받아온 검색 결과에서 해시태그 빈도 집계(추가 API 호출 0회). 패널에서 클릭 → 그 키워드로 새 검색 컬럼 생성. "함께 붙어 다니는 말"의 실데이터 신호(예: 레티날 담론 상승 같은 발견의 자동화)
3. **v1.5 후속**: 형태소 분석(kuromoji.js, 순수 JS) 기반 일반 명사 공출현

## 6. 데이터 모델 (Supabase, 5테이블 + 조인 1)

**조회된 모든 트윗을 저장한다** (뷰어가 아니라 아카이브). 근거:
- 갱신 간 검색 결과가 대부분 겹침 → 열람 추적 없이는 "봤던 글 또 나옴"으로 탐색 효율 하락 (핵심 문제)
- 앱 시작 시 마지막 결과를 API 호출 0회로 즉시 표시
- 흘러간 트윗의 로컬 아카이브 (검색 재실행 불필요)
- 단, 검색 API는 페이지 단위 반환이므로 **새로고침 시 호출 비용 자체는 저장과 무관하게 동일**

| 테이블 | 필드 요지 |
|---|---|
| `column` | id, kind(`search`\|`watchlist`), title, position, config jsonb(검색: keywords[]·min_faves·since·until·lang·images_only·min_views / 워치: handle), **last_refreshed_at** |
| `tweet` | tweet_id PK, 본문, 작성자(handle·표시명·아바타 URL·**팔로워수**), 미디어 jsonb(이미지 URL들), 인용트윗 jsonb, 지표 jsonb(views·likes·rt·quotes·bookmarks·replies), tweet_created_at, **first_seen_at(최초 조회)**, **last_fetched_at(마지막 지표 갱신)**, **seen_at(사용자 열람 시각, null=미열람)** |
| `column_tweet` | column_id + tweet_id (어느 컬럼에서 잡혔는지, 컬럼 간 중복 식별) |
| `candidate` | id, tweet_id FK, memo, saved_at, source_column_id (페이로드는 tweet 참조, 중복 저장 없음) |
| `tag` / `candidate_tag` | 태그 다대다 |

- 재조회 시 `tweet` upsert: 지표·last_fetched_at만 갱신, first_seen_at·seen_at 보존
- v1은 단일 사용자이므로 seen 상태는 사용자 구분 없이 tweet에 직접 (v2에서 user별 분리 필요 시 마이그레이션)

## 7. 화면

### 7-1. 덱 보드 (메인)
- 가로 스크롤 컬럼 배치 (TweetDeck식)
- 컬럼 헤더: 제목 · **새로고침 버튼 · 마지막 새로고침 시각** · 설정 · 보기 모드 토글
- **보기 모드: "새 트윗만"(기본, seen_at null만) / "전체"**. 열람한 카드는 흐리게(dim) 처리. seen 처리 = **명시적 조작만**: 카드의 "읽음" 버튼 + 컬럼 헤더의 "모두 읽음" 버튼 (스크롤 노출 자동 처리는 오판 위험이 있어 v1 제외)
- 카드 하단에 **최초 조회 날짜 · 마지막 업데이트 날짜** 표시 — 목적: 컬럼의 최종 조회/업데이트 시점을 확인하고 추가 조회/업데이트 여부를 사용자가 판단하도록 보조 (컬럼 헤더의 마지막 새로고침 시각과 동일 목적의 카드 레벨 표시)

### 7-2. 트윗 카드 — 실제 X UI 재현
X 공식 embed 위젯은 덱 구조(컬럼당 수십 카드)에 과중 → **직접 만든 X 스타일 컴포넌트**:
- 아바타 · 표시명 · @핸들 · 타임스탬프 · 본문(줄바꿈 보존) · **이미지 1~4장 X식 그리드** · 인용 트윗 중첩 카드 · 하단 지표 아이콘 행(답글/RT/좋아요/조회/북마크)
- 폰트만 시스템 서체로 대체(X 전용 서체 Chirp 제외)
- 추가 요소(X에 없는 것): 작성자 팔로워수 표기(극소형 계정 폭발 식별용), "후보 저장" 버튼, 최초조회/마지막업데이트 날짜, 원문 링크(x.com으로)

### 7-3. 후보 보관함 페이지
- 저장한 트윗 카드 그리드, 태그 필터, 메모 인라인 편집, 태그 추가/제거

## 8. API Route

| Route | 역할 |
|---|---|
| `POST /api/columns/:id/refresh` | 컬럼 종류에 따라 GetXAPI 호출(search/user tweets) + 페이지네이션 + 조회수 재필터 → tweet upsert → column_tweet 기록 → last_refreshed_at 갱신 → 결과 반환 |
| `POST /api/suggest-keywords` | Claude Haiku로 연관 키워드 제안 |
| CRUD | 컬럼/후보/태그/메모/seen 처리 (Server Actions 또는 route handlers) |

## 9. 에러 처리

- GetXAPI 실패는 **해당 컬럼에만** 에러 표시 + 재시도 버튼 (다른 컬럼 무영향)
- 401(키 문제)·잔액 부족은 구분된 명시 메시지
- 페이지네이션 중간 실패 시 받은 페이지까지 저장하고 부분 성공 표시

## 10. 비용

수동 갱신만이므로: 새로고침 1회 = 페이지 수 × $0.001 (통상 1–5페이지). 자동 호출 없음. LLM 제안은 Haiku급으로 회당 무시 가능 수준.

## 11. 테스트

- 로직(검색 쿼리 빌더 · 조회수 재필터 · GetXAPI 응답 매퍼 · 해시태그 공출현 집계 · upsert 시 first_seen/seen_at 보존)은 단위 테스트
- GetXAPI는 **실호출 스모크 스크립트 1개** (cb-sponsorship-tracker 검증 원칙: 모킹 테스트만으로 닫지 않는다)
- UI는 수동 확인 (개인 도구 v1)

## 12. 시작 전 준비물 (사용자 몫)

1. 신규 Supabase 프로젝트 생성 (무료 티어) → 접속정보 전달
2. `GETXAPI_KEY` · `ANTHROPIC_API_KEY` 기존 값 재사용 → `.env` 세팅 (안내 예정)

## 13. v1 범위 밖 (백로그)

Bookmarks/Likes/List 컬럼 · 자동 폴링 · 명사 공출현(kuromoji) · 급상승/재발견 추적 · 팀 배포/로그인(v2) · 저장 트윗 지표 일괄 재추적
