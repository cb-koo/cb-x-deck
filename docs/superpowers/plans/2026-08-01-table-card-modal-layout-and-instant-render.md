# 카드 팝업 X 모달 레이아웃 · 즉시 렌더 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 표 보기 카드 팝업을 X 게시 모달 배치로 고치고(✕ 왼쪽·원문↗ 오른쪽·그 아래 컬럼명과 수집 정보), 행을 누르면 기다림 없이 카드가 뜨게 한다.

**Architecture:** 표 행(`TableRow`)이 이미 카드 내용의 대부분을 들고 있으므로, 클릭 즉시 그 값으로 잠정 `StoredTweet`을 만들어 렌더하고 아바타·미디어·인용RT만 조회 결과로 교체한다. 상단 메타 줄에 쓸 '수집' 날짜만 행에 없어 `TableRow`에 `firstSeenAt`을 추가한다. 표기·시간대는 표가 쓰는 함수(`ymd`/`ymdHm`)를 그대로 공유해 팝업과 표가 어긋나지 않게 한다.

**Tech Stack:** Next.js(App Router) · React 클라이언트 컴포넌트 · postgres.js · node:test(실 DB) · Tailwind

**설계 문서:** `docs/superpowers/specs/2026-08-01-table-card-modal-layout-and-instant-render-design.md`
**앞선 설계(이 기능의 1차):** `docs/superpowers/specs/2026-08-01-table-row-tweet-card-modal-design.md`

## Global Constraints

- **카드 안쪽 배치를 바꾸지 않는다.** `TweetCard.tsx`에 대한 변경은 `showCollectedAt` 프롭 추가 **하나뿐**이다. 지표 아이콘은 이미 X 원본이므로 손대지 않는다.
- **덱 카드의 겉모습이 달라지면 안 된다.** 새 프롭의 기본값은 `true`이고 덱 호출부는 넘기지 않으므로 지금과 동일해야 한다.
- **날짜 표기는 `tableColumns.ts`의 `ymd`/`ymdHm`을 쓴다.** 새로 구현하지 않는다 — 같은 규칙을 두 번 쓰면 갈라진다. 둘 다 한국 시간(KST +9 고정)이다.
- **표기 규칙:** `firstSeenAt` → `수집`(날짜만), `lastFetchedAt` → `최종 수집`(분까지). 카드가 쓰는 `갱신`이라는 말을 팝업 헤더에 쓰지 않는다 — 표의 `최종 수집 시간` 칸과 같은 값이기 때문이다.
- **타입 스케일:** `text-content` 15px · `text-ui` 13px · `text-caption` 11px. 링크·액션 파랑은 `text-x-blue-text`(#1573ad)를 쓴다 — 밝은 `x-blue`는 텍스트 대비가 AA에 미달해 이 저장소가 의도적으로 나눠 쓴다.
- `react-hooks/set-state-in-effect`는 이 저장소에서 **에러**다. `useEffect` 본문에서 **동기** `setState` 금지. `await` 뒤는 괜찮다. 초기 상태는 `useState` 초기값으로 준다. 린트 규칙을 끄지 않는다.
- **린트 기준선을 늘리지 않는다.** 작업 시작 전에 `npm run lint 2>&1 | grep problems`로 직접 재고, 끝나고 같은 숫자여야 한다.
- `npx tsc --noEmit`은 출력 없이 통과해야 한다.
- 사용자 대면 문구는 한국어. 내부 개념어(`StoredTweet`, `savedBy`, `firstSeenAt`)를 화면 문구에 쓰지 않는다.
- 커밋 메시지는 한국어, 저장소의 기존 형식(`feat(table):` / `fix(table):`)을 따른다.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/types.ts` | (수정) `TableRow`에 `firstSeenAt` |
| `src/lib/tweetStore.ts` | (수정) 표 쿼리 select·매핑에 `first_seen_at` |
| `src/lib/tweetStore.test.ts` | (수정) 표 행에 수집 시각이 실려 오는지 |
| `src/lib/tableColumns.ts` | (수정) `ymd`·`ymdHm`을 export — 동작 변경 없음 |
| `src/components/TweetCard.tsx` | (수정) `showCollectedAt` 프롭 하나 |
| `src/components/TweetCardModal.tsx` | (수정) 상단 바 재배치 · 메타 줄 · 잠정 카드 · 실패 문구 |
| `src/components/TweetTableView.tsx` | (수정) 열린 행 전달 · 완성본 캐시 |

**의존 방향:** `TweetTableView` → `TweetCardModal` → (`TweetCard`, `tableColumns`의 날짜 함수). 표 컴포넌트(`TweetTable.tsx`)는 이번에 건드리지 않는다.

**작업 순서:** Task 1·2(데이터·유틸)와 Task 3(카드 프롭)은 서로 독립이라 **동시에** 할 수 있다. Task 4·5는 셋 모두에 의존하고 서로 컴파일 단위 한 쌍이라 마지막에 이어서 한다.

---

### Task 1: 표 행에 수집 시각 싣기

**Files:**
- Modify: `src/lib/types.ts` (`TableRow`)
- Modify: `src/lib/tweetStore.ts` (`TableRowRaw`, `getWorkspaceTableRows`)
- Test: `src/lib/tweetStore.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `TableRow.firstSeenAt: string` (ISO). Task 4의 잠정 카드가 이 값을 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/tweetStore.test.ts`의 기존 테스트 `'표 쿼리 — 여러 컬럼에 걸린 트윗은 한 행, 버림 제외, 워크스페이스 격리, 서버 정렬'` 안에서, `assert.ok(t2.lastFetchedAt, ...)` 줄 **바로 다음**에 아래를 넣는다.

```ts
    // 팝업 헤더가 '수집'으로 쓰는 값 — 없으면 카드를 즉시 그릴 때 이 자리만 늦게 채워져 깜빡인다(2차 설계 §C-1)
    assert.ok(t2.firstSeenAt, '표 행에 수집 시각이 실려야 한다');
    assert.ok(Date.parse(t2.firstSeenAt) > 0, '수집 시각은 파싱 가능한 ISO여야 한다');
    assert.ok(Date.parse(t2.firstSeenAt) <= Date.parse(t2.lastFetchedAt), '수집은 최종 수집보다 앞선다');
```

- [ ] **Step 2: 실패를 확인한다**

```bash
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 \
  --test-name-pattern='표 쿼리 — 여러 컬럼' src/lib/tweetStore.test.ts
```

Expected: FAIL — `firstSeenAt`이 `undefined`라 `assert.ok`가 깨진다. (타입 오류로 먼저 막힐 수도 있다. 어느 쪽이든 통과하면 안 된다.)

- [ ] **Step 3: 타입에 추가한다**

`src/lib/types.ts`의 `TableRow` 위 주석과 본문을 아래로 바꾼다. 주석을 함께 고치는 이유: "미디어·인용RT를 안 쓴다"는 이유는 그대로 유효하지만, 날짜 하나를 왜 예외로 실었는지가 남아 있어야 다음 사람이 되돌리지 않는다.

```ts
// 표 보기 한 행. StoredTweet을 쓰지 않는 이유: 표는 미디어·인용RT를 안 쓰는데
// CSV 저장은 최대 5,000행을 한 번에 받으므로 그 JSON이 페이로드를 크게 부풀린다.
// firstSeenAt은 그 예외다 — 날짜 문자열 하나라 페이로드에 거의 영향이 없고, 없으면
// 카드 팝업 헤더가 '최종 수집'만 먼저 떴다가 조회가 끝나야 '수집'이 붙어 깜빡인다(2차 설계 §C-1).
export interface TableRow {
  tweetId: string;
  columnTitles: string[];        // 이 트윗이 걸린 컬럼 이름들 (여러 컬럼에 걸리면 여러 개)
  authorHandle: string;
  authorName: string | null;
  authorFollowers: number | null;
  text: string;
  tweetCreatedAt: string | null; // ISO
  metrics: DeckMetrics;
  savedBy: Member[];
  firstSeenAt: string;           // ISO — 이 트윗이 처음 들어온 시각 (팝업 헤더의 '수집')
  lastFetchedAt: string;         // ISO — 지표 기준 시각 (표의 '최종 수집 시간', 팝업 헤더의 '최종 수집')
}
```

- [ ] **Step 4: 쿼리와 매핑에 추가한다**

`src/lib/tweetStore.ts`에서 세 곳을 고친다.

(1) `TableRowRaw` 타입에 필드 추가:

```ts
type TableRowRaw = {
  tweet_id: string; column_titles: string[]; author_handle: string; author_name: string | null;
  author_followers: string | number | null; text: string; tweet_created_at: Date | null;
  metrics: TableRow['metrics']; saved_by: TableRow['savedBy']; first_seen_at: Date; last_fetched_at: Date;
};
```

(2) `getWorkspaceTableRows`의 select 목록에서 이 줄을

```
    `select t.tweet_id, t.author_handle, t.author_name, t.author_followers, t.text,
            t.tweet_created_at, t.metrics, t.last_fetched_at,
```

아래로 바꾼다:

```
    `select t.tweet_id, t.author_handle, t.author_name, t.author_followers, t.text,
            t.tweet_created_at, t.metrics, t.first_seen_at, t.last_fetched_at,
```

(3) 같은 함수 끝의 매핑에서 `savedBy` 줄과 `lastFetchedAt` 줄 사이에 한 줄 추가:

```ts
    savedBy: r.saved_by ?? [],
    firstSeenAt: r.first_seen_at.toISOString(),
    lastFetchedAt: r.last_fetched_at.toISOString(),
```

- [ ] **Step 5: 통과를 확인한다**

```bash
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/tweetStore.test.ts
```

Expected: `# fail 0` (파일 전체 — 표 쿼리 테스트가 여럿이라 하나만 돌리지 않는다)

- [ ] **Step 6: 커밋**

메시지를 파일로 쓰고 경로를 지정해 커밋한다(`-m`을 여러 개 쓰면 권한 분류기가 거절할 때가 있고, 경로 지정형은 다른 작업의 파일을 함께 담지 않는다):

```bash
cat > /tmp/t1-msg.txt <<'MSG'
feat(table): 표 행에 수집 시각을 싣는다

카드 팝업이 클릭 즉시 행 데이터로 그려지는데, 헤더의 '수집'만 행에 없어
조회가 끝나야 붙는다 — 그 자리만 깜빡인다. 날짜 문자열 하나라 CSV 페이로드에
거의 영향이 없어, '표엔 카드용 데이터를 싣지 않는다'는 원칙의 예외로 둔다.
MSG
git commit -F /tmp/t1-msg.txt -- src/lib/types.ts src/lib/tweetStore.ts src/lib/tweetStore.test.ts
```

<!-- 참고용 메시지 원문 (위 heredoc과 동일):

feat(table): 표 행에 수집 시각을 싣는다

카드 팝업이 클릭 즉시 행 데이터로 그려지는데, 헤더의 '수집'만 행에 없어
조회가 끝나야 붙는다 — 그 자리만 깜빡인다. 날짜 문자열 하나라 CSV 페이로드에
거의 영향이 없어, '표엔 카드용 데이터를 싣지 않는다'는 원칙의 예외로 둔다.
-->

이후 태스크의 커밋도 같은 방식으로 한다: 메시지를 `/tmp/tN-msg.txt`에 쓰고 `git commit -F <그 파일> -- <해당 태스크의 파일들>`. `git add -A`나 `git add .`는 쓰지 않는다.

---

### Task 2: 표의 날짜 함수를 팝업과 공유

**Files:**
- Modify: `src/lib/tableColumns.ts` (`ymd`, `ymdHm`)

**Interfaces:**
- Consumes: 없음
- Produces: `export function ymd(iso: string | null): string` (KST, `YYYY-MM-DD`), `export function ymdHm(iso: string | null): string` (KST, `YYYY-MM-DD HH:MM`). Task 4의 헤더가 쓴다.

> 동작을 바꾸지 않는 export 전용 변경이다. 기존 테스트(`src/lib/tableColumns.test.ts`)가 이미 두 함수의 결과를 `cellDisplay`를 통해 검증하고 있으므로 새 테스트를 만들지 않는다(YAGNI).

- [ ] **Step 1: 두 함수를 export 한다**

`src/lib/tableColumns.ts`에서 함수 선언 두 개에 `export`를 붙이고, 왜 밖으로 나갔는지 주석에 한 줄 남긴다.

`function ymd(iso: string | null): string {` 앞의 주석과 선언을:

```ts
// 표와 카드 팝업이 같은 함수를 쓴다 — 팝업은 표 바로 위에 뜨므로 같은 값이 다른 날짜로
// 보이면 안 된다(2차 설계 §B). 규칙을 두 번 구현하지 않으려고 export 한다.
export function ymd(iso: string | null): string {
  if (!iso) return '';
  return toKstIso(iso).slice(0, 10);   // 표는 정렬 축이라 상대 표기를 쓰지 않는다
}
```

`ymdHm`도 같은 방식으로:

```ts
// '최종 수집 시간'(last_fetched_at) 전용. 날짜만 찍으면 같은 날 09:00에 새로고침한 컬럼과
// 22:00에 새로고침한 컬럼이 같은 값으로 보여 "비교 가능"으로 오인된다(설계 §E) — 시:분까지 찍는다.
// ymd와 함께 카드 팝업 헤더도 쓴다(2차 설계 §B).
export function ymdHm(iso: string | null): string {
  if (!iso) return '';
  return toKstIso(iso).slice(0, 16).replace('T', ' ');   // YYYY-MM-DD HH:MM
}
```

- [ ] **Step 2: 기존 테스트가 그대로 도는지 확인한다**

```bash
node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 src/lib/tableColumns.test.ts
```

Expected: `# fail 0`

- [ ] **Step 3: 커밋**

메시지:

```
refactor(table): 표의 날짜 함수를 팝업과 공유할 수 있게 export

카드 팝업 헤더가 수집·최종 수집을 찍는데, 팝업은 표 바로 위에 뜬다.
같은 값이 다른 날짜(표=KST, 카드=UTC)로 보이지 않도록 표가 쓰는 함수를 그대로 쓴다.
동작 변경 없음.
```

---

### Task 3: 카드 맨 아래 수집·갱신 줄을 끌 수 있게

**Files:**
- Modify: `src/components/TweetCard.tsx` (`TweetCardProps`, 구조 분해, 풋터의 마지막 `<p>`)

**Interfaces:**
- Consumes: 없음
- Produces: `TweetCardProps.showCollectedAt?: boolean` (기본 `true`). Task 4가 `false`를 넘긴다.

> **이 태스크가 `TweetCard.tsx`에 허용된 변경의 전부다.** 다른 줄은 건드리지 않는다. 덱 카드(`Column.tsx`)는 이 프롭을 넘기지 않으므로 겉모습이 그대로여야 한다.

- [ ] **Step 1: 프롭을 추가한다**

`TweetCardProps`에 마지막 필드로 추가한다(기존 필드 순서는 그대로 둔다):

```ts
  translating?: boolean;                  // 이 카드 번역 진행 중
  showCollectedAt?: boolean;              // 기본 true. 표 보기 팝업은 이 정보를 모달 헤더로 올려서 false를 넘긴다
```

구조 분해에도 더한다. 기본값을 여기서 준다:

```tsx
export function TweetCard({ tweet: t, meId, onSave, onUnsave, onSaveMemo, libraryHref, onDismiss, onUndismiss, dismissedView, tourAnchor,
                            translation, showTranslation, onTranslate, translating, showCollectedAt = true }: TweetCardProps) {
```

- [ ] **Step 2: 마지막 줄을 조건부로 만든다**

풋터 존 맨 아래의 이 블록을

```tsx
        <p className="px-1 text-right text-caption text-x-muted">
          수집 {formatDate(t.firstSeenAt)} · 갱신 {formatDate(t.lastFetchedAt)}
        </p>
```

아래로 바꾼다:

```tsx
        {/* 표 보기 팝업은 이 정보를 모달 헤더로 올려 잡는다(2차 설계 §A-4) — 두 번 나오지 않게 여기선 끈다.
            덱 카드는 프롭을 안 넘겨 기본값 true라 지금 그대로다. */}
        {showCollectedAt && (
          <p className="px-1 text-right text-caption text-x-muted">
            수집 {formatDate(t.firstSeenAt)} · 갱신 {formatDate(t.lastFetchedAt)}
          </p>
        )}
```

- [ ] **Step 3: 타입·린트 확인**

```bash
npx tsc --noEmit && npx eslint src/components/TweetCard.tsx
```

Expected: `tsc` 출력 없음. eslint는 기존 경고 2건(`Unused eslint-disable directive`, `no-img-element`)만 — 새 항목이 늘지 않아야 한다.

- [ ] **Step 4: 커밋**

메시지:

```
feat(card): 하단 수집·갱신 줄을 끄는 옵션

표 보기 팝업이 이 정보를 모달 헤더로 올려 잡는데, 카드에도 남으면 같은 값이
위아래 두 번 나온다. 기본값은 true라 덱 카드는 그대로다.
```

---

### Task 4: 팝업 — X 모달 배치와 즉시 렌더

**Files:**
- Modify: `src/components/TweetCardModal.tsx` (전면 개편)

**Interfaces:**
- Consumes: `TableRow.firstSeenAt` (Task 1), `ymd`·`ymdHm` (Task 2), `showCollectedAt` (Task 3)
- Produces: `TweetCardModal`의 새 프롭 세 개 —
  ```ts
  row: TableRow | null;                      // 눌린 표 행. 있으면 즉시 렌더에 쓴다
  cached: StoredTweet | null;                // 이미 받아둔 완성본. 있으면 조회하지 않는다
  onLoaded: (tweet: StoredTweet) => void;    // 조회 성공 시 부모 캐시에 넣기
  ```
  기존 프롭(`wsId` `tweetId` `onClose` `onSavedByChange` `translation` `translating` `translateErr` `onTranslate`)은 그대로 둔다.

- [ ] **Step 1: 파일 전체를 아래로 교체한다**

바뀌는 것이 상태 모델·상단 바·본문 분기 전부라 부분 수정보다 전체 교체가 안전하다. 저장·메모·번역 배선은 기존 코드 그대로 옮긴다.

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { useMember } from '@/lib/memberContext';
import { useToast } from '@/lib/toastContext';
import { tweetPermalink } from '@/lib/tweetLink';
import { ymd, ymdHm } from '@/lib/tableColumns';
import type { Member, StoredTweet, TableRow, TweetTranslation } from '@/lib/types';
import { TweetCard } from './TweetCard';

// 조회 진행 상태. 카드가 보이는지와는 별개다 — 잠정 카드는 조회 전에도 떠 있다.
type Load = 'loading' | 'done' | 'error' | 'missing';

// 표 행이 이미 들고 있는 값으로 만드는 잠정 카드 — 클릭 즉시 그리기 위해서다(2차 설계 §C-2).
// 없는 것만 비워둔다. 비워도 TweetCard가 알아서 견딘다: 아바타 null이면 회색 원,
// tweetUrl null이면 시각이 링크 없는 텍스트, media []면 그리드 자체가 안 나온다.
function provisionalFrom(row: TableRow): StoredTweet {
  return {
    tweetId: row.tweetId,
    authorHandle: row.authorHandle,
    authorName: row.authorName,
    authorAvatarUrl: null,
    authorFollowers: row.authorFollowers,
    text: row.text,
    media: [],
    quoted: null,
    metrics: row.metrics,
    tweetUrl: null,
    tweetCreatedAt: row.tweetCreatedAt,
    firstSeenAt: row.firstSeenAt,
    lastFetchedAt: row.lastFetchedAt,
    isNew: false,          // NEW는 컬럼 개념이라 표에는 없다
    savedBy: row.savedBy,
  };
}

// 표 보기에서 행을 누르면 뜨는 트윗 카드.
// 카드 자체는 TweetCard 그대로다(= X 미러링). 이 파일은 모달 크롬·조회·저장 배선만 한다.
// 크롬 배치는 X의 게시 모달을 따른다(2차 설계 §A): ✕는 왼쪽, 오른쪽에 파란 텍스트 액션,
// 그 아래 한 줄에 컬럼명과 수집 정보.
export function TweetCardModal({ wsId, tweetId, row, cached, onLoaded, onClose, onSavedByChange,
                                 translation, translating, translateErr, onTranslate }: {
  wsId: string;
  tweetId: string;
  row: TableRow | null;
  cached: StoredTweet | null;
  onLoaded: (tweet: StoredTweet) => void;
  onClose: () => void;
  onSavedByChange: (tweetId: string, savedBy: Member[]) => void;
  translation: TweetTranslation | null;
  translating: boolean;
  translateErr: string;
  onTranslate: (tweetId: string) => void;
}) {
  // 초기값을 useState 초기화로 준다 — 이펙트 안에서 동기 setState를 하지 않기 위해서다
  // (react-hooks/set-state-in-effect). 호출부가 key={tweetId}로 렌더하므로 다른 행을 열면
  // 이 컴포넌트가 새로 마운트되어 자연히 초기값부터 시작한다.
  const [full, setFull] = useState<StoredTweet | null>(cached);
  const [load, setLoad] = useState<Load>(cached ? 'done' : 'loading');
  const [retry, setRetry] = useState(0);
  // translateErr는 useTranslations 훅의 값 — 카드마다 나뉘어 있지 않고, 실패 시 세팅된 채
  // 다음 성공 때만 지워진다. 그대로 렌더하면 방금 연 카드에 '다른 트윗'에서 난 실패가 튀어나온다.
  // key={tweetId} 리마운트 덕에 이 플래그는 카드마다 false로 시작해 남의 실패를 걸러낸다.
  const [translateAttempted, setTranslateAttempted] = useState(false);
  const { member } = useMember();
  const { show } = useToast();
  const closeRef = useRef<HTMLButtonElement>(null);
  // 저장으로 만들어진 내 candidate.id — 저장 직후 메모 PATCH 배선용 (Column.tsx와 같은 방식)
  const savedIdRef = useRef<string | null>(null);

  // 화면에 그릴 카드. 완성본이 있으면 그것, 없으면 표 행으로 만든 잠정 카드.
  // row가 갱신되면(저장으로 부모가 행을 고치면) 잠정 카드도 따라 갱신된다.
  const tweet = full ?? (row ? provisionalFrom(row) : null);

  function handleTranslate(id: string) {
    setTranslateAttempted(true);
    onTranslate(id);
  }

  useEffect(() => {
    if (cached) return;   // 이미 완성본을 받아둔 트윗 — 네트워크를 타지 않는다
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/tweets/${encodeURIComponent(tweetId)}?workspaceId=${encodeURIComponent(wsId)}`);
        if (!alive) return;
        if (r.status === 404) { setLoad('missing'); return; }
        if (!r.ok) { setLoad('error'); return; }
        const d = await r.json() as { tweet: StoredTweet };
        if (!alive) return;
        setFull(d.tweet);
        setLoad('done');
        onLoaded(d.tweet);
      } catch {
        if (alive) setLoad('error');
      }
    })();
    return () => { alive = false; };
    // onLoaded는 호출부에서 useCallback으로 안정화한다
  }, [wsId, tweetId, retry, cached, onLoaded]);

  // Esc로 닫기 — ColumnSettings와 같은 처리. IME 조합 중 Esc는 글자 조합 취소라 무시한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 열릴 때 포커스를 모달 안으로 — 그래야 Tab이 표 행이 아니라 카드를 돈다.
  // 닫을 때 눌렀던 행으로 되돌리는 것은 호출부(TweetTableView)가 한다.
  useEffect(() => { closeRef.current?.focus(); }, []);

  // 저장 상태를 카드와 표 행에 동시에 반영한다 — 한쪽만 바꾸면 팝업을 닫았을 때 표가 거짓말을 한다.
  // 잠정 카드는 row에서 파생되므로 부모가 행을 고치면 따라 바뀐다. 완성본은 여기서 직접 고친다.
  function applySavedBy(savedBy: Member[]) {
    setFull((cur) => (cur ? { ...cur, savedBy } : cur));
    onSavedByChange(tweetId, savedBy);
  }

  async function save() {
    if (!tweet) return;
    if (!member) { show('내 정보를 아직 불러오는 중이에요 — 잠시 후 다시 시도해주세요'); return; }
    const before = tweet.savedBy;
    if (before.some((m) => m.id === member.id)) return;   // 이미 저장됨 — 중복 추가 방지
    // 서버는 order by m.name으로 준다 — 같은 순서로 맞춰야 저장 직후와 재조회 후 배지 순서가 같다
    applySavedBy([...before, member].sort((a, b) => a.name.localeCompare(b.name)));
    try {
      // sourceColumnId를 보내지 않는다 — 표의 글은 특정 컬럼에서 온 게 아니다(서버에서 optional)
      const r = await apiFetch('/api/candidates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tweetId, workspaceId: wsId }),
      });
      if (!r.ok) { applySavedBy(before); show('저장하지 못했어요 — 잠시 후 다시 시도해주세요'); return; }
      const created = await r.json().catch(() => null) as { id?: string } | null;
      savedIdRef.current = created?.id ?? null;
    } catch {
      applySavedBy(before);
      show('저장하지 못했어요 — 잠시 후 다시 시도해주세요');
    }
  }

  async function unsave() {
    if (!tweet) return;
    if (!member) { show('내 정보를 아직 불러오는 중이에요 — 잠시 후 다시 시도해주세요'); return; }
    const before = tweet.savedBy;
    applySavedBy(before.filter((m) => m.id !== member.id));
    savedIdRef.current = null;
    try {
      const r = await apiFetch(`/api/candidates?tweetId=${encodeURIComponent(tweetId)}&workspaceId=${encodeURIComponent(wsId)}`, { method: 'DELETE' });
      if (!r.ok) { applySavedBy(before); show('저장을 취소하지 못했어요 — 잠시 후 다시 시도해주세요'); }
    } catch {
      applySavedBy(before);
      show('저장을 취소하지 못했어요 — 잠시 후 다시 시도해주세요');
    }
  }

  // 저장 시점 인라인 메모 — 방금 만든 candidate 행에 PATCH (Column.tsx의 saveMemo와 같다).
  // false를 돌려주면 카드가 입력을 보존하고 재시도 버튼을 보여준다.
  async function saveMemo(_tweetId: string, memo: string): Promise<boolean> {
    const id = savedIdRef.current;
    if (!id) return false;
    try {
      const r = await apiFetch(`/api/candidates/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memo }),
      });
      return r.ok;
    } catch { return false; }
  }

  const columnTitles = row?.columnTitles ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      {/* 카드 위에 별도 테두리·여백을 얹지 않는다 — 카드(<article>)가 이미 자기 배경·여백을 들고 있고
          그게 X 미러링의 결과물이다. 껍데기는 위치·모서리·세로 넘침만 담당한다. */}
      <div role="dialog" aria-modal="true" aria-label="트윗 카드"
           className="max-h-[90vh] w-[560px] max-w-[92vw] overflow-y-auto overflow-x-hidden rounded-2xl bg-white"
           onClick={(e) => e.stopPropagation()}>
        {/* 상단 바 — X 게시 모달과 같은 배치: ✕ 왼쪽, 오른쪽에 파란 텍스트 액션.
            파랑은 x-blue가 아니라 x-blue-text를 쓴다 — 밝은 쪽은 텍스트 대비가 AA에 미달한다(globals.css). */}
        <div className="flex min-h-[53px] items-center justify-between px-2 py-1.5">
          <button ref={closeRef} onClick={onClose} aria-label="닫기" title="닫기"
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-x-text hover:bg-x-hover">✕</button>
          {/* tweet이 null이면 row도 null이라(둘 다 없을 때만 이 상태다) 핸들 없는 /i/status/ 형식으로 떨어진다 */}
          <a href={tweetPermalink(tweet?.authorHandle ?? null, tweetId)}
             target="_blank" rel="noopener"
             className="rounded-full px-3.5 py-1.5 text-content font-bold text-x-blue-text hover:bg-x-hover">원문 ↗</a>
        </div>

        {/* 메타 줄 — 왼쪽에 이 글이 걸린 컬럼, 오른쪽에 언제 모았고 언제 마지막으로 가져왔는지.
            날짜는 표가 쓰는 함수를 그대로 쓴다(한국 시간) — 팝업은 표 바로 위에 뜨므로
            같은 값이 다른 날짜로 보이면 안 된다(2차 설계 §B). */}
        {(columnTitles.length > 0 || tweet) && (
          <div className="flex items-baseline justify-between gap-3 px-4 pb-3">
            <div className="flex flex-wrap gap-1.5">
              {columnTitles.map((title) => (
                <span key={title}
                      className="rounded-full border border-x-border-strong px-2.5 py-0.5 text-ui font-bold text-x-secondary">
                  {title}
                </span>
              ))}
            </div>
            {tweet && (
              <p className="shrink-0 text-ui text-x-muted">
                수집 {ymd(tweet.firstSeenAt)} · 최종 수집 {ymdHm(tweet.lastFetchedAt)}
              </p>
            )}
          </div>
        )}

        {/* 카드 — 잠정이든 완성본이든 같은 컴포넌트. 하단 수집·갱신 줄은 위 메타 줄로 올렸으므로 끈다. */}
        {tweet && (
          <TweetCard tweet={tweet}
                     meId={member?.id ?? null}
                     onSave={save}
                     onUnsave={unsave}
                     onSaveMemo={saveMemo}
                     libraryHref={`/w/${wsId}/library`}
                     translation={translation}
                     translating={translating}
                     onTranslate={handleTranslate}
                     showCollectedAt={false} />
        )}

        {/* 카드가 없을 때(표 행도 캐시도 없는 경우 — 팝업이 열린 사이 목록이 다시 로드된 상황)의 상태 */}
        {!tweet && load === 'loading' && <p className="px-4 pb-4 text-ui text-x-muted">불러오는 중…</p>}
        {!tweet && load === 'error' && (
          <p className="px-4 pb-4 text-ui text-red-500">
            글을 불러오지 못했어요. <button onClick={() => setRetry((n) => n + 1)} className="underline">다시 시도</button>
          </p>
        )}
        {!tweet && load === 'missing' && (
          <p className="px-4 pb-4 text-ui text-x-muted">
            이 글을 찾을 수 없어요 —{' '}
            <a href={tweetPermalink(null, tweetId)} target="_blank" rel="noopener" className="text-x-blue-text hover:underline">원문 보기 ↗</a>
          </p>
        )}

        {/* 카드는 이미 읽을 수 있는데 나머지를 못 받은 경우 — 본문이 보이므로 실패의 크기가 다르다(2차 설계 §D) */}
        {tweet && load === 'error' && (
          <p className="px-4 pb-3 text-caption text-red-500">
            이미지·인용을 불러오지 못했어요. <button onClick={() => setRetry((n) => n + 1)} className="underline">다시 시도</button>
          </p>
        )}
        {tweet && load === 'missing' && (
          <p className="px-4 pb-3 text-caption text-x-muted">
            이 글은 지금 목록에 없어요 — 표에 있던 내용만 보여드려요
          </p>
        )}

        {/* 이 카드에서 실제로 번역을 시도했고, 그 시도가 아직 진행 중이 아닌데 실패가 남아 있을 때만.
            유료 API 경로라 사용자가 실패 여부를 반드시 알아야 한다. */}
        {translateAttempted && !translating && translateErr && (
          <p className="px-4 pb-4 text-caption text-red-500">
            {translateErr} <button onClick={() => handleTranslate(tweetId)} className="underline">다시 시도</button>
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입 확인 — 호출부가 아직 새 프롭을 안 넘겨 에러가 하나 나야 한다**

```bash
npx tsc --noEmit
```

Expected: `TweetTableView.tsx`에서 `row`·`cached`·`onLoaded`가 없다는 에러 **하나만**. Task 5에서 사라진다. 다른 에러가 있으면 이 태스크의 문제다.

- [ ] **Step 3: 자기 파일 린트**

```bash
npx eslint src/components/TweetCardModal.tsx
```

Expected: 출력 없음. `set-state-in-effect`가 뜨면 이펙트 본문에서 동기 `setState`를 한 것이다 — `await` 뒤로 옮긴다.

- [ ] **Step 4: 커밋**

메시지:

```
feat(table): 팝업을 X 모달 배치로, 그리고 기다림 없이 뜨게

✕를 왼쪽으로 옮기고 오른쪽에 원문 링크를 두었다(X 게시 모달과 같은 자리).
그 아래 한 줄에 이 글이 걸린 컬럼과 수집·최종 수집을 올렸다 — 카드 맨 아래에
있던 정보라 거기선 끈다.

표 행이 이미 본문·계정·지표를 들고 있으므로 클릭 즉시 그걸로 카드를 그리고
아바타·미디어·인용RT만 조회로 채운다. 덕분에 실패가 "일부를 못 받았다"로 줄었다 —
본문은 이미 읽을 수 있다.

날짜는 표가 쓰는 ymd·ymdHm을 그대로 쓴다. 팝업은 표 바로 위에 뜨므로 같은 값이
다른 날짜로 보이면 안 된다.
```

---

### Task 5: 표 화면 — 열린 행 전달과 완성본 캐시

**Files:**
- Modify: `src/components/TweetTableView.tsx`

**Interfaces:**
- Consumes: `TweetCardModal`의 새 프롭 `row`·`cached`·`onLoaded` (Task 4)
- Produces: 없음(최상위 배선)

- [ ] **Step 1: import에 `StoredTweet`을 더한다**

```ts
import type { ColumnRow, Member, SortDir, SortKey, StoredTweet, TableRow } from '@/lib/types';
```

- [ ] **Step 2: 캐시 ref를 만든다**

`const [openTweetId, setOpenTweetId] = useState<string | null>(null);` 바로 아래에 넣는다.

```tsx
  // 한 번 받아온 완성본(미디어·인용RT까지)을 들고 있다가 같은 행을 다시 열면 즉시 보여준다.
  // 표를 다시 조회하거나 워크스페이스가 바뀌면 비운다 — 지표가 갱신됐는데 옛 숫자를 들고 있으면
  // 표와 팝업이 어긋난다(2차 설계 §C-3).
  const tweetCacheRef = useRef<Map<string, StoredTweet>>(new Map());
```

- [ ] **Step 3: 새 조회 때 캐시를 비운다**

`load` 콜백 안, `const id = ++reqIdRef.current;` 바로 다음 줄에 추가한다.

```tsx
    if (!append) tweetCacheRef.current.clear();   // 처음부터 다시 받는 조회 = 지표가 바뀌었을 수 있다
```

- [ ] **Step 4: 저장 반영이 캐시도 고치게 한다**

기존 `applySavedBy`를 아래로 바꾼다. 캐시를 안 고치면 저장 후 팝업을 닫았다 다시 열었을 때 옛 저장 상태가 나온다.

```tsx
  const applySavedBy = useCallback((tweetId: string, savedBy: Member[]) => {
    setRows((cur) => cur.map((r) => (r.tweetId === tweetId ? { ...r, savedBy } : r)));
    // 캐시에 완성본이 있으면 그것도 함께 — 안 그러면 닫았다 다시 열 때 옛 저장 상태가 나온다
    const hit = tweetCacheRef.current.get(tweetId);
    if (hit) tweetCacheRef.current.set(tweetId, { ...hit, savedBy });
  }, []);
```

- [ ] **Step 5: 조회 성공분을 캐시에 넣는 콜백을 만든다**

`applySavedBy` 아래에 추가한다. `useCallback`으로 안정화해야 팝업의 조회 이펙트가 매 렌더마다 다시 돌지 않는다.

```tsx
  const cacheTweet = useCallback((tweet: StoredTweet) => {
    tweetCacheRef.current.set(tweet.tweetId, tweet);
  }, []);
```

- [ ] **Step 6: 모달에 행과 캐시를 넘긴다**

> **구현 중 정정(2026-08-01).** 아래 코드의 `cached={tweetCacheRef.current.get(openTweetId) ?? null}`은
> **쓰면 안 된다** — 이 저장소는 렌더 중 `ref.current`를 읽는 것도 에러로 잡는다(`react-hooks/refs`,
> 기준선이 23 → 25로 늘어난다). 대신 캐시 읽기를 **행을 여는 이벤트 핸들러**로 옮긴다:
> `openTweet(id)` 콜백에서 `setOpenTweetId(id)`와 함께 `setOpenTweetCached(tweetCacheRef.current.get(id) ?? null)`을
> 하고, JSX에는 그 상태를 넘긴다. `TweetTable`의 `onOpenTweet`도 `setOpenTweetId`가 아니라 이 콜백을 받는다 —
> 진입점이 하나여야 마우스·키보드 양쪽에서 스냅샷이 갱신된다. 실제 구현은 이 정정을 따랐다(`e0f44e8`).

기존 모달 렌더 블록을 아래로 바꾼다.

```tsx
      {/* key={openTweetId}: 다른 행을 열면 새로 마운트되어 상태가 섞이지 않는다.
          row: 클릭 즉시 카드를 그리는 데 쓴다. 팝업이 열린 사이 목록이 다시 로드돼 그 행이
          사라졌으면 null이 되고, 그때는 팝업이 조회 결과를 기다린다(2차 설계 §C-4). */}
      {openTweetId && (
        <TweetCardModal key={openTweetId}
                        wsId={wsId}
                        tweetId={openTweetId}
                        row={rows.find((r) => r.tweetId === openTweetId) ?? null}
                        cached={tweetCacheRef.current.get(openTweetId) ?? null}
                        onLoaded={cacheTweet}
                        onClose={closeCard}
                        onSavedByChange={applySavedBy}
                        translation={translations[openTweetId] ?? null}
                        translating={translatingIds.has(openTweetId)}
                        translateErr={translateErr}
                        onTranslate={translateOne} />
      )}
```

- [ ] **Step 7: 타입·린트 확인**

```bash
npx tsc --noEmit && npm run lint 2>&1 | grep problems
```

Expected: `tsc` 출력 없음(Task 4의 에러가 사라진다). 린트는 작업 시작 전에 재둔 숫자와 같아야 한다.

- [ ] **Step 8: 전체 테스트와 빌드**

```bash
npm test 2>&1 | tail -8
npx next build 2>&1 | tail -5
```

Expected: `# fail 0` (실 DB, 약 4분). 빌드 성공.

- [ ] **Step 9: 커밋**

메시지:

```
feat(table): 눌린 행을 팝업에 넘기고 받아온 카드를 캐시한다

행을 넘기면 팝업이 조회를 기다리지 않고 바로 그린다. 받아온 완성본은 들고 있다가
같은 행을 다시 열면 네트워크 없이 띄운다.

캐시는 표를 처음부터 다시 조회할 때와 워크스페이스가 바뀔 때 비운다 — 지표가
갱신됐는데 옛 숫자를 들고 있으면 표와 팝업이 어긋난다. 저장도 캐시에 함께 반영한다.
```

---

## 완료 후 — 사용자 확인이 필요한 것

라우트·컴포넌트 테스트 하네스가 없고 화면은 OAuth 게이팅이라 구현자가 볼 수 없다. 완료 보고에 아래를 그대로 적는다.

1. 행을 클릭하면 **기다림 없이** 카드가 뜨는가 (이미지만 조금 뒤 나타남)
2. 같은 행을 닫았다 다시 열면 즉시 완성 상태로 뜨는가
3. 상단: ✕가 왼쪽, 원문 ↗이 오른쪽. 원문 ↗이 X로 이동하는가
4. 그 아래 줄: 컬럼명 알약과 `수집 … · 최종 수집 …`. **표의 '최종 수집 시간' 칸 값과 같은가**
5. 카드 맨 아래에 수집·갱신이 **더 이상 없는가**
6. **덱(카드 보기)의 카드 하단에는 수집·갱신이 그대로 있는가** — 회귀 확인
7. 저장 → 표의 '저장' 칸 반영 → 팝업 닫았다 다시 열어도 ★ 유지
8. 표를 정렬하거나 필터를 바꾼 뒤 같은 행을 열면 갱신된 지표가 보이는가(캐시가 비워졌는가)
9. 번역·메모·Esc/배경/✕ 닫기·행 포커스 후 Enter/Space·닫은 뒤 포커스 복귀 — 기존 동작 회귀 확인
