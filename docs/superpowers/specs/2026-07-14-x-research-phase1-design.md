# X 리서치 Phase 1 — 벤치마크 검색 + 큐레이션 신호 + 규제 경고

날짜: 2026-07-14 · 상태: 승인됨(박구건) · 상위: `2026-07-14-x-research-roadmap.md` · 근거: `~/claude-outputs/X콘텐츠리서치-방법론조사-클리닉브릿지선별-20260714.md`

## 목표

기존 검색 컬럼을 "지표 기반 벤치마크 발굴" 도구로 굳히고(엔게이지먼트 연산자 확장 + 실측 가드레일), 담당자의 저장/버림을 신호로 남겨 향후 자동 필터의 토대를 만들며, 일본 규제 리스크에 가벼운 경고를 붙인다. 주간 루틴 사용이 무게중심.

## 범위

**포함**: ①min_retweets/min_replies 연산자 ②밀도 확인 버튼(임계치 제안) ③버림(dismiss) 신호 ④薬機法 경고 배지 ⑤OR괄호·Top모드 회귀 테스트.
**제외(다음 Phase)**: 계정 필러 분석(②축), 리플/스레드 확장(③축), 트렌드·종합(④축), 자동 관련성 필터(신호가 쌓인 뒤). 인용 역탐색은 엔드포인트 부재로 영구 제외.

## 컴포넌트 설계

### 1. 엔게이지먼트 연산자 확장

`src/lib/types.ts` — `SearchConfig`에 추가:
```ts
minRetweets?: number | null;
minReplies?: number | null;
```
`src/lib/queryBuilder.ts` — `buildSearchQuery`에 추가(min_faves 다음 위치):
```ts
if (c.minRetweets) parts.push(`min_retweets:${c.minRetweets}`);
if (c.minReplies) parts.push(`min_replies:${c.minReplies}`);
```
`src/components/ColumnSettings.tsx` — 필터 섹션 그리드에 "최소 RT"·"최소 답글" 입력 2개 추가(기존 최소 좋아요와 동일 패턴, 기본 빈값=미적용).

**가드레일(회귀 테스트로 고정)**: 다중 키워드는 반드시 `(a OR b)`로 괄호(이미 구현됨) — 안 그러면 min_faves가 첫 키워드에 안 걸림(실측 확인). `searchTweets`는 `type=Top` 유지(Latest는 임계치 무시).

### 2. 밀도 확인 버튼 (임계치 제안)

신규 API `POST /api/research/density` — body `{ keywords: string[], lang?: string }`:
- 쿼리 `(kw1 OR kw2 ...) lang:ja min_faves:50 since:<오늘-7일>` 를 `type=Top`으로 1페이지(20건) 조회.
- 반환 트윗의 likeCount 분포로 제안:
  - 20건 미만 → 밀도 낮음 → 제안 `min_faves: 100`
  - 20건(꽉 참) → 밀도 높음 → 제안 `min_faves = round(p25(likes))` (그 페이지 하위 25% 좋아요 ≈ 선별력 유지 컷). 최소 100.
- 응답 `{ suggested: number, sampleSize: number, likeRange: [min, max], density: 'high'|'low' }`.
- 비용 1콜 $0.001. 서버는 기존 `makeClient().searchTweets()` 재사용하되, **프로브 전용 최소 쿼리**(`(kw OR ...) lang:ja min_faves:50 since:7일전`)를 직접 조립한다 — `buildSearchQuery`의 `filter:images` 등은 밀도 측정에 불필요하므로 쓰지 않는다. `since` 날짜는 서버에서 계산(라우트는 Next 서버라 Date 사용 가능).

`src/lib/densityProbe.ts` (순수 함수) — `suggestMinFaves(likes: number[], sampleSize: number): { suggested; density }` 로직 분리해 단위 테스트.
`ColumnSettings.tsx` — 최소 좋아요 입력 옆 "밀도 확인" 버튼 → 호출 후 "최근 7일: 좋아요 X~Y, 제안 min_faves:Z [적용]" 표시. [적용] 클릭 시 min_faves 필드 채움.

### 3. 버림(dismiss) 신호 — 워크스페이스 단위, 숨김 기본·복구 가능

`migrations/005_dismissed.sql` (멱등):
```sql
create table if not exists dismissed_tweet (
  workspace_id uuid not null references workspace(id) on delete cascade,
  tweet_id text not null references tweet(tweet_id) on delete cascade,
  dismissed_by uuid references member(id) on delete set null,
  dismissed_at timestamptz not null default now(),
  primary key (workspace_id, tweet_id)
);
```
`src/lib/dismissStore.ts` — `dismiss(sql, {workspaceId, tweetId, memberId})`, `undismiss(sql, {workspaceId, tweetId})`, `listDismissed(sql, workspaceId): string[]`.
`src/app/api/dismissed/route.ts` — POST(버림)·DELETE(복구).
`tweetStore.getColumnTweets` — 옵션 `includeDismissed`(기본 false)일 때 `and not exists (select 1 from dismissed_tweet d where d.workspace_id=$2 and d.tweet_id=t.tweet_id)` 조건 추가. `includeDismissed=true`면 버림만/전체 볼 수 있게.
`Column.tsx` — 헤더에 "버림 보기" 토글(기본 꺼짐). `TweetCard`에 "✕ 버림" 버튼(저장 버튼 옆), 버림 보기 상태에선 "되돌리기"로 바뀜. 버림 시 그 트윗 즉시 숨김(재조회).

> **신호 의미**: candidate(저장)=양성, dismissed=음성. 이 둘이 향후 자동 관련성 필터의 학습 데이터. Phase 1은 신호 축적만, 필터는 안 만듦.

### 4. 薬機法 경고 배지

`src/lib/complianceFlags.ts` (순수 함수) — `flagYakkiho(text: string): string[]` 정적 리스크 용어 매칭 후 매칭된 용어 반환. 초기 용어(뷰티·의료 광고 리스크): `効く`, `効果がある`, `治る`, `治療`, `完治`, `シミが消える`, `シワがなくなる`, `医薬品`, `副作用`, 体験담 단정(`使ったら〜なった` 류는 v1 제외 — 오탐 위험). 리스트는 파일 상단 주석에 "법률 자문 아님, 담당자 확인용 힌트" 명시.
`TweetCard.tsx` — `flagYakkiho(t.text)` 결과 있으면 카드에 작은 ⚠️ 배지 + hover 시 매칭 용어 표시. **필터링·차단 없음**, 순수 표식.

## 데이터 흐름

검색 컬럼 새로고침(기존) → 결과에서 버림된 트윗 제외 → 카드에 薬機法 배지 표시 → 담당자가 저장(양성)/버림(음성) → 저장분은 기존 보관함으로. 밀도 확인은 컬럼 생성/편집 시 1회성 보조 호출.

## 에러 처리

- 밀도 API: getxapi 실패 시 제안 없이 "밀도 확인 실패 — 수동 입력" 메시지, min_faves 필드는 유지.
- dismiss API: 중복 버림은 `on conflict do nothing`. 존재 안 하는 복구는 무시(멱등).
- 薬機法 배지: 순수 함수라 실패 없음(빈 배열=배지 없음).

## 테스트

- `queryBuilder.test.ts`: min_retweets/min_replies 출력, **다중 키워드+min_faves가 `(a OR b) min_faves:N` 형태 회귀 잠금**.
- `densityProbe.test.ts`: 꽉 참(20건 고좋아요)→고밀도 높은 제안, 희소(수건)→100, 경계값.
- `complianceFlags.test.ts`: 리스크 용어 매칭/비매칭, 빈 문자열.
- `dismissStore.test.ts`(실DB): 버림·복구·목록·멱등, 컬럼 조회에서 제외/포함.
- 빌드 통과 + 브라우저: 필터 입력 2개·밀도 버튼·버림 토글·경고 배지 육안 확인.

## 파일 요약

- 수정: `types.ts`, `queryBuilder.ts`, `ColumnSettings.tsx`, `tweetStore.ts`, `Column.tsx`, `TweetCard.tsx`
- 신규: `migrations/005_dismissed.sql`, `lib/densityProbe.ts`, `lib/dismissStore.ts`, `lib/complianceFlags.ts`, `app/api/research/density/route.ts`, `app/api/dismissed/route.ts` (+ 각 테스트)
