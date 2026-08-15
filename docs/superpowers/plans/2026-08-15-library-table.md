# 보관함 표 보기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보관함 트윗 뷰에 표 보기를 추가한다 — 클라이언트 정렬, 행 클릭 = CandidateCard 팝업, API 무변경.

**Architecture:** 순수 로직(`src/lib/libraryTable.ts`)과 표 컴포넌트(DraftTable 골격 이식), 모달 셸(CandidateCard 재사용)을 분리하고 페이지가 view(URL ?view=table)·정렬·팝업 상태를 소유한다. Task 1~3은 서로 다른 신규 파일이라 **병렬 실행 가능**, Task 4가 배선한다.

**Tech Stack:** Next.js app router 클라이언트 컴포넌트, Tailwind v4, node:test(순수 lib 테스트).

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-15-library-table-design.md`.
- 덱 표(TweetTable·tableColumns·/api/tweet-table)·생성 표(DraftTable)·CandidateCard는 **수정 금지**(재사용만).
- 검증: Task 1은 `npx tsx --test src/lib/libraryTable.test.ts`, Task 2·3은 `npx tsc --noEmit`, Task 4는 `npm run lint`(기준선 24건 초과 금지) + `npm run build`.
- 표 숫자 표기: 축약 없는 콤마 원값(formatFull), 없으면 '–'. 정렬 시 null은 방향과 무관하게 항상 뒤로.
- **서브에이전트는 git commit을 하지 않는다** — 병렬 실행이라 인덱스 경합 방지, 커밋은 오케스트레이터가 리뷰 후 수행.

---

### Task 1: 순수 로직 `libraryTable.ts` + 단위테스트 (병렬 A)

**Files:**
- Create: `src/lib/libraryTable.ts`
- Create: `src/lib/libraryTable.test.ts`

**Interfaces (Produces — Task 2·4가 이 시그니처에 의존):**
```ts
export type LibrarySortKey = 'addedAt' | 'date' | 'followers' | 'views' | 'likes' | 'retweets' | 'bookmarks' | 'replies' | 'comments';
export type LibrarySortDir = 'asc' | 'desc';
export interface LibrarySort { key: LibrarySortKey; dir: LibrarySortDir }
export interface LibraryTableColumn { key: string; label: string; sort?: LibrarySortKey; numeric?: boolean }
export const LIBRARY_TABLE_COLUMNS: LibraryTableColumn[];
export function sortLibraryEntries(entries: LibraryEntry[], sort: LibrarySort): LibraryEntry[];
export function commentSummary(e: LibraryEntry): string;
export function savedByLabel(e: LibraryEntry): string;
```

- [ ] **Step 1: 실패하는 테스트 작성** — 기존 스타일(node:test + assert/strict, `.ts` 확장자 import, 예: `src/lib/generate.test.ts`)을 따르되 DB 불필요. 픽스처는 최소 필드만 채우고 `as unknown as LibraryEntry`.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LibraryEntry } from './candidateStore.ts';
import { sortLibraryEntries, commentSummary, savedByLabel } from './libraryTable.ts';

function entry(over: {
  tweetId?: string; addedAt?: string; views?: number | null; followers?: number | null;
  tweetCreatedAt?: string | null; memos?: string[]; memberNames?: string[]; addedBy?: string | null;
}): LibraryEntry {
  const names = over.memberNames ?? (over.memos ?? []).map((_, i) => `멤버${i}`);
  return {
    tweet: {
      tweetId: over.tweetId ?? 't1',
      tweetCreatedAt: over.tweetCreatedAt ?? '2026-08-01T00:00:00Z',
      authorFollowers: over.followers ?? null,
      metrics: { views: over.views ?? null, likes: null, retweets: null, replies: null, quotes: null, bookmarks: null },
    },
    addedBy: over.addedBy === undefined ? null : over.addedBy === null ? null : { id: 'm0', name: over.addedBy, color: '#000' },
    addedAt: over.addedAt ?? '2026-08-10T00:00:00Z',
    candidates: (over.memos ?? []).map((memo, i) => ({
      id: `c${i}`, memo, savedAt: `2026-08-1${i}T00:00:00Z`,
      member: { id: `m${i + 1}`, name: names[i], color: '#000' },
    })),
  } as unknown as LibraryEntry;
}

test('지표 정렬 desc — null은 항상 뒤로', () => {
  const rows = [entry({ tweetId: 'a', views: 10 }), entry({ tweetId: 'b', views: null }), entry({ tweetId: 'c', views: 99 })];
  assert.deepEqual(sortLibraryEntries(rows, { key: 'views', dir: 'desc' }).map((e) => e.tweet.tweetId), ['c', 'a', 'b']);
  assert.deepEqual(sortLibraryEntries(rows, { key: 'views', dir: 'asc' }).map((e) => e.tweet.tweetId), ['a', 'c', 'b']);
});

test('담은 시각·게시일 문자열 정렬', () => {
  const rows = [entry({ tweetId: 'old', addedAt: '2026-08-01T00:00:00Z' }), entry({ tweetId: 'new', addedAt: '2026-08-14T00:00:00Z' })];
  assert.deepEqual(sortLibraryEntries(rows, { key: 'addedAt', dir: 'desc' }).map((e) => e.tweet.tweetId), ['new', 'old']);
});

test('코멘트 수 정렬 — 메모 있는 행만 센다', () => {
  const rows = [entry({ tweetId: 'a', memos: ['x', ' '] }), entry({ tweetId: 'b', memos: ['x', 'y'] })];
  assert.deepEqual(sortLibraryEntries(rows, { key: 'comments', dir: 'desc' }).map((e) => e.tweet.tweetId), ['b', 'a']);
});

test('sortLibraryEntries는 원본을 바꾸지 않는다', () => {
  const rows = [entry({ tweetId: 'a', views: 1 }), entry({ tweetId: 'b', views: 2 })];
  sortLibraryEntries(rows, { key: 'views', dir: 'desc' });
  assert.deepEqual(rows.map((e) => e.tweet.tweetId), ['a', 'b']);
});

test('commentSummary — 없음/1개/여러 개(최신 첫 줄)', () => {
  assert.equal(commentSummary(entry({ memos: [] })), '–');
  assert.equal(commentSummary(entry({ memos: ['하나뿐'] })), '하나뿐');
  assert.equal(commentSummary(entry({ memos: ['먼저', '최신 첫 줄\n둘째 줄'] })), '2 · 최신 첫 줄');
  assert.equal(commentSummary(entry({ memos: ['', '  '] })), '–');   // 빈 메모 후보행만 있으면 없음
});

test('savedByLabel — 코멘트 행 멤버, 없으면 담은 사람 폴백', () => {
  assert.equal(savedByLabel(entry({ memos: ['a', 'b'], memberNames: ['구건', '민지'] })), '구건, 민지');
  assert.equal(savedByLabel(entry({ memos: [], addedBy: '하늘' })), '하늘 (담음)');
  assert.equal(savedByLabel(entry({ memos: [], addedBy: null })), '–');
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx tsx --test src/lib/libraryTable.test.ts` → FAIL (모듈 없음).

- [ ] **Step 3: 구현**

```ts
import type { LibraryEntry } from './candidateStore.ts';

// 보관함 표: 컬럼 정의·정렬·셀 파생값. 순수 함수만 — 컴포넌트는 이 모듈이 계산한 값을 그린다.
// 숫자 표기 규칙은 덱 표와 동일(축약 금지·null은 '–')하되, TableRow에 결합된 tableColumns.ts는 재사용하지 않는다.
export type LibrarySortKey = 'addedAt' | 'date' | 'followers' | 'views' | 'likes' | 'retweets' | 'bookmarks' | 'replies' | 'comments';
export type LibrarySortDir = 'asc' | 'desc';
export interface LibrarySort { key: LibrarySortKey; dir: LibrarySortDir }
export interface LibraryTableColumn { key: string; label: string; sort?: LibrarySortKey; numeric?: boolean }

export const LIBRARY_TABLE_COLUMNS: LibraryTableColumn[] = [
  { key: 'text', label: '본문' },
  { key: 'handle', label: '계정' },
  { key: 'followers', label: '팔로워', sort: 'followers', numeric: true },
  { key: 'date', label: '게시일', sort: 'date' },
  { key: 'views', label: '조회수', sort: 'views', numeric: true },
  { key: 'likes', label: '좋아요', sort: 'likes', numeric: true },
  { key: 'retweets', label: '리포스트', sort: 'retweets', numeric: true },
  { key: 'bookmarks', label: '북마크', sort: 'bookmarks', numeric: true },
  { key: 'replies', label: '답글', sort: 'replies', numeric: true },
  { key: 'savedBy', label: '저장한 사람' },
  { key: 'comments', label: '코멘트', sort: 'comments' },
  { key: 'addedAt', label: '담은 시각', sort: 'addedAt' },
  { key: 'link', label: '링크' },
];

// 메모가 있는 후보행만 코멘트로 센다 — 저장만 하고 메모를 안 단 행은 코멘트가 아니다(카드 뷰와 같은 해석)
function memoEntries(e: LibraryEntry) {
  return e.candidates.filter((c) => c.memo?.trim());
}

function sortValue(e: LibraryEntry, key: LibrarySortKey): number | string | null {
  switch (key) {
    case 'addedAt': return e.addedAt;
    case 'date': return e.tweet.tweetCreatedAt;
    case 'followers': return e.tweet.authorFollowers;
    case 'comments': return memoEntries(e).length;
    default: return e.tweet.metrics[key];
  }
}

// null·undefined는 방향과 무관하게 항상 뒤로 — 모르는 값이 1등이 되면 안 된다
export function sortLibraryEntries(entries: LibraryEntry[], sort: LibrarySort): LibraryEntry[] {
  const mul = sort.dir === 'desc' ? -1 : 1;
  return [...entries].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === 'string' && typeof vb === 'string') return mul * va.localeCompare(vb);
    return mul * ((va as number) - (vb as number));
  });
}

// 'N · 최신 메모 첫 줄' (1개면 첫 줄만) — candidates는 savedAt 오름차순이라 마지막이 최신
export function commentSummary(e: LibraryEntry): string {
  const memos = memoEntries(e);
  if (memos.length === 0) return '–';
  const firstLine = memos[memos.length - 1].memo.trim().split('\n')[0];
  return memos.length > 1 ? `${memos.length} · ${firstLine}` : firstLine;
}

// 코멘트(=저장) 행 멤버 나열, 아무도 없으면 담은 사람 폴백 — 카드 풋터의 '담은 사람' 표기와 같은 해석
export function savedByLabel(e: LibraryEntry): string {
  if (e.candidates.length > 0) return e.candidates.map((c) => c.member.name).join(', ');
  return e.addedBy ? `${e.addedBy.name} (담음)` : '–';
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx tsx --test src/lib/libraryTable.test.ts` → 전부 PASS. `npx tsc --noEmit`도 통과.

---

### Task 2: 표 컴포넌트 `LibraryTable.tsx` (병렬 B)

**Files:**
- Create: `src/components/LibraryTable.tsx`

**Interfaces:**
- Consumes: Task 1의 `LIBRARY_TABLE_COLUMNS`·`LibrarySort`·`LibrarySortKey`·`commentSummary`·`savedByLabel` (시그니처는 Task 1 블록 참조 — 파일이 아직 없어도 그 시그니처로 작성).
- Produces: `LibraryTable({ entries, sort, onSortChange, onOpenTweet })`.

- [ ] **Step 1: 구현** — DraftTable(`src/components/DraftTable.tsx`)의 골격(행 클릭 판정 `opensCard`, tabIndex+Enter/Space, sortBtn, aria-sort)을 먼저 읽고 이식한다. 체크박스 없음.

```tsx
'use client';
import type { LibraryEntry } from '@/lib/candidateStore';
import { LIBRARY_TABLE_COLUMNS, commentSummary, savedByLabel, type LibrarySort, type LibrarySortKey } from '@/lib/libraryTable';
import { formatFull } from '@/lib/format';
import { kstDate, kstShort } from '@/lib/datetime';
import { tweetPermalink } from '@/lib/tweetLink';

// 훑기 전용 표 — 조작(코멘트·빼기·번역)은 행 클릭으로 여는 카드 팝업에서 (spec 2026-08-15-library-table).
// 받은 순서를 그대로 그린다 — 정렬은 페이지 소유(DraftTable과 같은 규칙).
export function LibraryTable({ entries, sort, onSortChange, onOpenTweet }: {
  entries: LibraryEntry[];
  sort: LibrarySort;
  onSortChange: (next: LibrarySort) => void;
  onOpenTweet: (tweetId: string) => void;
}) {
  // 셀 안의 링크 클릭·글자 드래그 선택은 팝업을 열지 않는다 (DraftTable과 동일)
  function opensCard(e: React.MouseEvent): boolean {
    if (e.target instanceof Element && e.target.closest('a, button')) return false;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim() !== '') return false;
    return true;
  }

  const sortBtn = (key: LibrarySortKey, label: string) => (
    <button onClick={() => onSortChange({ key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' })}
            className="flex items-center gap-1 hover:text-x-text">
      {label}{sort.key === key && <span aria-hidden>{sort.dir === 'desc' ? '↓' : '↑'}</span>}
    </button>
  );

  const num = (v: number | null) => (v === null || v === undefined ? '–' : formatFull(v));

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-ui">
        <thead>
          <tr className="border-b border-x-border text-left text-caption text-x-muted">
            {LIBRARY_TABLE_COLUMNS.map((c) => (
              <th key={c.key}
                  aria-sort={c.sort && sort.key === c.sort ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}
                  className={`whitespace-nowrap px-3 py-2 font-normal ${c.numeric ? 'text-right' : ''}`}>
                {c.sort ? <span className={c.numeric ? 'flex justify-end' : ''}>{sortBtn(c.sort, c.label)}</span> : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const t = e.tweet;
            const m = t.metrics;
            return (
              <tr key={t.tweetId}
                  data-tweet-id={t.tweetId}
                  tabIndex={0}
                  onClick={(ev) => { if (opensCard(ev)) onOpenTweet(t.tweetId); }}
                  onKeyDown={(ev) => {
                    if (ev.key !== 'Enter' && ev.key !== ' ') return;
                    if (ev.target !== ev.currentTarget) return;
                    ev.preventDefault();
                    onOpenTweet(t.tweetId);
                  }}
                  className="relative cursor-pointer border-b border-x-border hover:bg-x-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-x-blue">
                <td className="max-w-[360px] truncate px-3 py-2" title={t.text}>{t.text}</td>
                <td className="whitespace-nowrap px-3 py-2 text-x-secondary" title={t.authorName ?? undefined}>@{t.authorHandle}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(t.authorFollowers)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-x-secondary">{t.tweetCreatedAt ? kstDate(t.tweetCreatedAt) : '–'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(m.views)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(m.likes)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(m.retweets)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(m.bookmarks)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(m.replies)}</td>
                <td className="max-w-[160px] truncate whitespace-nowrap px-3 py-2 text-x-secondary" title={savedByLabel(e)}>{savedByLabel(e)}</td>
                <td className="max-w-[240px] truncate px-3 py-2" title={commentSummary(e)}>{commentSummary(e)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-caption text-x-muted">{kstShort(e.addedAt)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <a href={tweetPermalink(t.authorHandle, t.tweetId)} target="_blank" rel="noopener"
                     className="text-x-blue-text hover:underline" onClick={(ev) => ev.stopPropagation()}>원문 ↗</a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: 확인** — `formatFull`·`kstDate`·`kstShort`·`tweetPermalink`의 실제 시그니처를 각 모듈에서 확인하고 (null 허용 여부) 맞춘다. Run: `npx tsc --noEmit` → 통과. (Task 1과 병렬이면 libraryTable.ts가 아직 없어 실패할 수 있다 — 그 경우 자기 파일의 문법·타입만 자체 점검하고 보고에 명시.)

---

### Task 3: 모달 셸 `LibraryCardModal.tsx` (병렬 C)

**Files:**
- Create: `src/components/LibraryCardModal.tsx`

**Interfaces:**
- Consumes: `CandidateCard`(수정 금지 — props는 `src/components/CandidateCard.tsx`에서 확인).
- Produces: `LibraryCardModal({ entry, meId, wsId, onChanged, onRemoveTeam, translation, showTranslation, onTranslate, translating, onClose })`.

- [ ] **Step 1: 구현**

```tsx
'use client';
import { useEffect } from 'react';
import type { LibraryEntry } from '@/lib/candidateStore';
import type { TweetTranslation } from '@/lib/types';
import { CandidateCard } from './CandidateCard';

// 표 행 클릭으로 여는 카드 팝업 — 카드 보기와 완전히 같은 표면(코멘트·빼기·번역·초안)을 그대로 얹는다.
// 표 전용 상세 UI를 따로 만들지 않는다 (DraftCard 단일 표면 원칙과 동일).
export function LibraryCardModal({ entry, meId, wsId, onChanged, onRemoveTeam, translation, showTranslation, onTranslate, translating, onClose }: {
  entry: LibraryEntry;
  meId: string | null;
  wsId: string;
  onChanged: () => void;
  onRemoveTeam: (tweetId: string) => void;
  translation?: TweetTranslation | null;
  showTranslation?: boolean;
  onTranslate?: (tweetId: string) => void;
  translating?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={onClose}>
      {/* CandidateCard 자체가 테두리·라운드를 가진다 — 셸은 폭·배경만 준다 */}
      <div role="dialog" aria-modal="true" className="w-full max-w-[560px] rounded-xl bg-white"
           onClick={(e) => e.stopPropagation()}>
        <CandidateCard entry={entry} meId={meId} wsId={wsId} onChanged={onChanged}
                       onRemoveTeam={onRemoveTeam}
                       translation={translation} showTranslation={showTranslation}
                       onTranslate={onTranslate} translating={translating} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 확인** — CandidateCard의 실제 props 이름·타입을 파일에서 확인해 어긋나면 이 셸 쪽을 맞춘다(CandidateCard 수정 금지). Run: `npx tsc --noEmit` → 통과.

---

### Task 4: 페이지 배선 (Task 1~3 완료 후)

**Files:**
- Modify: `src/app/w/[wsId]/library/page.tsx`

**Interfaces:**
- Consumes: Task 1~3의 export 전부.

- [ ] **Step 1: view 상태(URL) 추가** — 덱 페이지(`src/app/w/[wsId]/page.tsx`)의 `?view=table` 패턴을 그대로 이식.

```tsx
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
// ...
const router = useRouter();
const pathname = usePathname();
const searchParams = useSearchParams();
const tweetView = searchParams.get('view') === 'table' ? 'table' : 'cards';
// 주소에 보기 모드를 남긴다 — 새로고침·링크 공유로 유지 (덱과 같은 패턴)
function setTweetView(next: 'cards' | 'table') {
  const p = new URLSearchParams(searchParams.toString());
  if (next === 'table') p.set('view', 'table'); else p.delete('view');
  const q = p.toString();
  router.replace(q ? `${pathname}?${q}` : pathname);
}
```

- [ ] **Step 2: 정렬·팝업 상태 + 파생값**

```tsx
const [tableSort, setTableSort] = useState<LibrarySort>({ key: 'addedAt', dir: 'desc' });
const [openTweetId, setOpenTweetId] = useState<string | null>(null);
// 표는 정렬해서 그린다 — 전량이 메모리에 있어 절단이 없으므로 순수 정렬만으로 안전
const sortedGroups = useMemo(
  () => (tweetView === 'table' ? sortLibraryEntries(groups, tableSort) : groups),
  [tweetView, groups, tableSort],
);
// 팝업 엔트리는 파생 — 목록 갱신으로 사라지면(팀에서 빼기 등) 모달도 자연히 언마운트된다(effect 없이)
const openEntry = openTweetId ? groups.find((g) => g.tweet.tweetId === openTweetId) ?? null : null;
// 닫을 때 포커스를 눌렀던 행으로 복귀 (TweetTableView와 같은 패턴)
const closeCard = useCallback(() => {
  const id = openTweetId;
  setOpenTweetId(null);
  if (!id) return;
  requestAnimationFrame(() => {
    document.querySelector<HTMLTableRowElement>(`tr[data-tweet-id="${CSS.escape(id)}"]`)?.focus();
  });
}, [openTweetId]);
```

- [ ] **Step 3: 필터 줄에 토글 + 전체 번역 조건부** — 멤버 칩 줄(`<div className="flex flex-wrap items-center gap-1 border-b ...">`)에서:
  - 줄 오른쪽에 `카드 | 표` 칩 추가(기존 `chip`/`on`/`off` 클래스, `aria-pressed`), 기존 전체 번역 버튼의 `ml-auto`는 토글 묶음 쪽으로 이동.
  - '전체 번역' 버튼은 `tweetView === 'cards'`일 때만 렌더 — 표엔 번역 표시 지점이 없어 거짓 어포던스가 된다. (`translateErr` 줄은 그대로 둔다 — 카드로 돌아오면 재시도 가능.)

```tsx
<span className="ml-auto flex items-center gap-1">
  <button onClick={() => setTweetView('cards')} aria-pressed={tweetView === 'cards'} className={`${chip} ${tweetView === 'cards' ? on : off}`}>카드</button>
  <button onClick={() => setTweetView('table')} aria-pressed={tweetView === 'table'} className={`${chip} ${tweetView === 'table' ? on : off}`}>표</button>
  {tweetView === 'cards' && (
    <Button variant="ghost" onClick={() => translateAll(groups.map((g) => g.tweet.tweetId))} disabled={translatingAll} /* 기존 props 그대로 */>…</Button>
  )}
</span>
```

- [ ] **Step 4: 렌더 분기** — 기존 `groups.length === 0 ? … : (<main>열 분배</main>)`의 else 갈래를:

```tsx
) : tweetView === 'table' ? (
  <div className="p-4">
    <LibraryTable entries={sortedGroups} sort={tableSort} onSortChange={setTableSort} onOpenTweet={setOpenTweetId} />
  </div>
) : (
  <main className="flex items-start gap-3 p-4">…기존 열 분배 그대로…</main>
)
```

팝업 렌더(페이지 말미, AddByLinkModal 옆):

```tsx
{openEntry && (
  <LibraryCardModal key={openEntry.tweet.tweetId} entry={openEntry} meId={meId} wsId={wsId}
                    onChanged={load}
                    onRemoveTeam={(id) => { setOpenTweetId(null); requestRemoveTeam(id); }}
                    translation={translations[openEntry.tweet.tweetId] ?? null}
                    showTranslation={showTranslations}
                    onTranslate={translateOne}
                    translating={translatingIds.has(openEntry.tweet.tweetId)}
                    onClose={closeCard} />
)}
```

- [ ] **Step 5: 검증** — `npx tsx --test src/lib/libraryTable.test.ts` PASS, `npm run lint` ≤24건, `npm run build` 성공.

---

## 최종 검증

- lint 기준선 ≤24, build 성공, libraryTable 테스트 PASS.
- koo 화면 QA: 카드↔표 토글(URL 유지)·정렬 각 키(null 뒤로)·행 클릭 팝업에서 코멘트 달기/수정·팀에서 빼기(닫힘+실행취소 토스트)·번역·멤버 필터 공통 적용·카드 보기 회귀 없음.
