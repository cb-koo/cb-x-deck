# 컬럼 트윗 개수 배지 + 정렬 방향 토글

작성일: 2026-07-21

## 배경

덱 컬럼(`Column.tsx`)은 각 컬럼에 조회된 트윗을 리스트업하지만, 두 가지가 없다.

1. **개수 가시성 없음** — 해당 컬럼에 몇 개의 트윗이 리스트업돼 있는지 기본 뷰에서 알 수 없다. (필터가 걸렸을 때만 "N건 표시 중" 칩이 뜬다.)
2. **정렬 방향 조정 불가** — 정렬 기준(조회수/날짜/북마크/RT) 선택기는 있으나, DB에서 방향이 `desc`로 하드코딩돼 있어 오름/내림차순을 바꿀 수 없다.

## 목표

- 각 컬럼 헤더에 그 컬럼의 **정확한 전체 트윗 수**를 배지로 표시한다.
- 정렬 기준 옆에 **오름/내림차순 토글**(화살표 버튼)을 추가하고, 선택을 컬럼 설정에 저장한다.

비목표: 정렬 기준 자체 추가/변경, 필터·뷰 로직 변경, 페이지네이션 방식 변경.

## 대상 사용자

비개발 콘텐츠 기획 담당자. AGENTS.md UX 원칙 준수 — 특히 라벨은 이득/의미를 사용자 언어로, 화살표만으로 모호하지 않게 텍스트 라벨(aria/title) 부여.

---

## 기능 1 — 컬럼 트윗 개수 배지 (정확한 전체 수)

### 데이터 흐름

서버는 페이지당 최대 200개(`PAGE_SIZE`)만 내려주므로 클라이언트가 로드한 수(`tweets.length`)는 실제 총계와 다를 수 있다. 정확한 총계를 위해 별도 `COUNT` 조회를 추가하고, 기존 tweets 응답에 함께 실어 추가 왕복을 없앤다.

### DB (`src/lib/tweetStore.ts`)

- `getColumnTweetCount(sql, columnId, opts: { dismissed?: 'exclude' | 'only' }): Promise<number>` 신규 추가.
- `getColumnTweets`와 **동일한** `column_tweet` 조인 + dismissed 필터 조건으로 `count(*)`만 수행 (정렬/limit/offset 없음). 컬럼이 없으면 `0`.
- dismissed 기본값은 `getColumnTweets`와 동일하게 `'exclude'`.

### API (`src/app/api/columns/[id]/tweets/route.ts`)

- 응답 형태를 배열 → **객체**로 변경: `{ tweets: StoredTweet[]; total: number }`.
- `total`은 `offset > 0`일 때도 동일 값(총계)이어야 하므로, 매 요청 `getColumnTweetCount`를 함께 호출해 실어 보낸다. (같은 dismissed 조건 사용.)
- `getColumnTweets`와 `getColumnTweetCount`를 병렬(`Promise.all`)로 호출.

> 참고: 이 라우트의 유일한 소비자는 `Column.tsx`의 `load()`/`loadMore()`이므로 응답 형태 변경의 파급은 그 두 곳에 한정된다.

### 프론트 (`src/components/Column.tsx`)

- `const [total, setTotal] = useState(0)` 상태 추가.
- `load()`, `loadMore()`의 파싱을 `{ tweets, total }` 형태로 변경:
  - `load()`: `setTweets(res.tweets); setTotal(res.total); setHasMore(res.tweets.length === PAGE)`.
  - `loadMore()`: `setTweets((prev) => [...prev, ...res.tweets]); setTotal(res.total); setHasMore(res.tweets.length === PAGE)`.
- 헤더 제목 옆(현 182번 라인 근처)에 배지 표시. 형식: `제목 · {total}`.
  - 값이 로드되기 전(0이고 아직 미조회)엔 배지를 숨기거나 `·`만 두지 않도록 — `total > 0`일 때만 렌더.
  - 스타일은 기존 `text-caption text-x-muted` 계열 사용, 시각적으로 제목을 압도하지 않게.
- 배지가 뜻하는 것은 **현재 뷰(dismissed 여부)에 해당하는 컬럼 전체 수**. 필터(주제/NEW)가 걸렸을 때의 "N건 표시 중" 칩은 그대로 두어 역할을 분리한다(전체 수 vs 필터 후 표시 수).

---

## 기능 2 — 정렬 방향 토글

### 타입 (`src/lib/types.ts`)

- `export type SortDir = 'asc' | 'desc';` 추가.
- `SearchConfig`, `WatchlistConfig`에 `dir?: SortDir;` 추가 (기본 `'desc'`).

### DB (`src/lib/tweetStore.ts`)

- `ORDER` 맵을 방향 없는 컬럼 식으로 변경:
  ```ts
  const ORDER_EXPR: Record<SortKey, string> = {
    views: `(t.metrics->>'views')::bigint`,
    date: `t.tweet_created_at`,
    bookmarks: `(t.metrics->>'bookmarks')::bigint`,
    retweets: `(t.metrics->>'retweets')::bigint`,
  };
  ```
- `getColumnTweets` opts에 `dir?: SortDir` 추가 (기본 `'desc'`).
- `order by` 절: `${ORDER_EXPR[sort] ?? ORDER_EXPR.views} ${dir === 'asc' ? 'asc nulls first' : 'desc nulls last'}, t.tweet_id`.

### API (`src/app/api/columns/[id]/tweets/route.ts`)

- `dir` 쿼리 파라미터 화이트리스트: `sp.get('dir') === 'asc' ? 'asc' : 'desc'`.
- `getColumnTweets(..., { sort, offset, dismissed, dir })`로 전달.

### 프론트 (`src/components/Column.tsx`)

- `const [dir, setDir] = useState<SortDir>(column.config.dir ?? 'desc')` 상태 추가.
- `load()`/`loadMore()` URL에 `&dir=${dir}` 추가.
- 재조회 트리거: `useEffect(() => { load(sort); }, [load, sort])`가 `dir`에도 반응하도록 `load`를 `dir` 의존성에 포함(현재 `load`는 `useCallback`이므로 deps에 `dir` 추가하면 자동 재발화).
- 정렬 기준 버튼 줄(현 190번 라인) 옆에 방향 토글 버튼 1개:
  - 표시: `dir === 'desc' ? '↓' : '↑'`.
  - `title` / `aria-label`: 내림차순일 때 "높은 순 (내림차순)", 오름차순일 때 "낮은 순 (오름차순)". (날짜 기준일 땐 "최신 순"/"오래된 순"으로 문구 분기 — `sort === 'date'`.)
  - 클릭 시 `setDir((d) => (d === 'desc' ? 'asc' : 'desc'))`.

### 설정 저장 (`src/components/ColumnSettings.tsx`)

**정책은 기존 `sort`와 동일하게 맞춘다** (코드 확인 결과):

- 현재 `sort`는 컬럼 내 정렬 버튼 변경 시 config에 자동 저장되지 않는 **세션 상태**다. 초기값만 `column.config.sort ?? 'views'`에서 읽고, `ColumnSettings`는 `sort: init.sort ?? 'views'`로 기존 값을 통과(pass-through) 저장할 뿐이다.
- 따라서 `dir`도 동일하게: 초기값은 `column.config.dir ?? 'desc'`에서 읽고, 컬럼 내 토글 변경은 세션 상태(별도 PATCH 없음), `ColumnSettings`는 `dir: init.dir ?? 'desc'`로 통과 저장해 config 값을 보존한다.
- 결론: 컬럼 내 방향 토글은 즉시 저장하지 않는다(기존 `sort` UX와 일치). 새 자동-PATCH를 추가하지 않는다.

---

## 에지 케이스

- **미조회 컬럼**: `total = 0`, 배지 숨김.
- **dismissed 뷰**: 배지·정렬 모두 dismissed 집합 기준으로 일관 동작.
- **정렬 방향 변경 중 loadMore 상태**: `dir`/`sort` 변경 시 `load()`가 첫 페이지로 리셋되므로 offset 정합성 유지(기존 동작과 동일).
- **날짜 오름차순 + nulls**: `asc nulls first`로 tweetCreatedAt이 null인 트윗이 맨 앞 — 의도된 동작(값 없는 항목을 방향 극단에 고정).

## 테스트

- `getColumnTweetCount`: dismissed exclude/only 각각, 없는 컬럼(0), 200개 초과 컬럼에서 총계 정확.
- `getColumnTweets` dir: `asc`/`desc`에서 정렬 순서 반전 확인, 각 SortKey별.
- API 라우트: `dir` 화이트리스트(잘못된 값 → `desc`), 응답에 `total` 포함.
- 프론트: 배지 렌더 조건(`total > 0`), 방향 토글 클릭 시 재조회 + 라벨 문구 분기.

## 파급 파일 요약

- `src/lib/types.ts` — `SortDir`, config에 `dir`.
- `src/lib/tweetStore.ts` — `getColumnTweetCount`, `ORDER_EXPR`, `getColumnTweets` dir.
- `src/app/api/columns/[id]/tweets/route.ts` — 응답에 `total`, `dir` 파라미터.
- `src/components/Column.tsx` — `total`/`dir` 상태, load/loadMore 파싱, 헤더 배지, 방향 토글 버튼.
- `src/components/ColumnSettings.tsx` — `dir` 설정 저장.
