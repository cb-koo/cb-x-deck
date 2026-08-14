# 레퍼런스 칩 클릭 미리보기 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** /generate 패널의 레퍼런스 칩을 클릭하면 트윗 전문(본문·이미지·지표·메모)을 오버레이로 즉시 보여준다.

**Architecture:** RefPickerSheet의 트윗 카드 내용부를 `RefTweetCard`로 추출해 시트와 신규 `RefPreviewModal`이 공유. 데이터는 부모 `refRows`에 이미 있어 조회 0회. 신규 서버 코드 0.

**Tech Stack:** Next.js(App Router, 이 repo의 커스텀 버전) + React 클라이언트 컴포넌트 + Tailwind.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-15-ref-chip-preview-design.md`
- 컴포넌트 테스트 하네스 없음 — 검증은 `npx tsc --noEmit` + `npm run build` 성공 + `npm run lint` 기준선(24개) 유지.
- 서버·DB·API 변경 금지. RefTweetCard 추출은 **순수 추출**(시트의 시각·동작 변화 0)이어야 한다.
- Task 1(RefTweetCard.tsx 신규 + RefPickerSheet.tsx)과 Task 2(RefPreviewModal.tsx 신규 + DraftComposer.tsx + generate/page.tsx)는 파일이 겹치지 않는다 — 병렬 실행 가능. Task 2는 Task 1이 만들 RefTweetCard를 임포트만 한다(인터페이스는 아래에 고정). 커밋은 Task 3에서 한 번.

---

### Task 1: RefTweetCard 추출 + RefPickerSheet 재배선

**Files:**
- Create: `src/components/RefTweetCard.tsx`
- Modify: `src/components/RefPickerSheet.tsx`

**Interfaces:**
- Consumes: 없음 (독립)
- Produces: `export function RefTweetCard({ row, translation }: { row: ReferenceRow; translation?: string })` — Task 2의 RefPreviewModal이 임포트한다. **이 시그니처를 그대로 지킬 것.**

- [ ] **Step 1: RefTweetCard.tsx 생성**

RefPickerSheet.tsx의 카드 마크업(약 160~205행: 아바타 분기부터 도구층 밴드까지, **선택 체크 원 span 제외**)을 아래 파일로 옮긴다. 마크업·클래스는 한 글자도 바꾸지 않는다(순수 추출):

```tsx
'use client';
import { MediaGrid } from '@/components/MediaGrid';
import { formatCount } from '@/lib/format';
import { ReplyIcon, RepostIcon, LikeIcon, ViewIcon, BookmarkIcon } from '@/components/XIcons';
import type { ReferenceRow } from '@/lib/referenceStore';

// X 실측 트윗 카드(시안 A)의 내용부 — RefPickerSheet(선택 버튼으로 감쌈)와 RefPreviewModal(맨몸)이 공유한다.
// 카드는 단일 표면: 여기 고치면 두 화면에 함께 반영된다(DraftCard 선례). 선택 체크 원은 시트 전용이라 여기 없다.
// 전부 span인 이유: 시트에서 <button> 안에 들어가므로 block 요소를 둘 수 없다.
export function RefTweetCard({ row: r, translation }: { row: ReferenceRow; translation?: string }) {
  return (
    <>
      {r.authorAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- 외부 X 아바타는 next/image 최적화 대상 아님(덱 카드 관례)
        <img src={r.authorAvatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full" />
      ) : (
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-x-border-strong text-[15px] font-bold text-white">
          {(r.authorName ?? r.authorHandle).slice(0, 1)}
        </span>
      )}
      <span className="min-w-0 flex-1 pr-8">
        <span className="block text-[15px] leading-5"><b>{r.authorName ?? r.authorHandle}</b> <span className="text-x-muted">@{r.authorHandle}</span></span>
        <span className="block whitespace-pre-wrap text-[15px] leading-5">{r.text}</span>
        <MediaGrid media={r.media} />
        {/* X 액션 행 자리에 성과 지표 — 덱 카드와 같은 배치(19px 아이콘 + 13px 수치 분산) */}
        <span className="mt-3 flex max-w-[440px] items-center justify-between text-[13px] tabular-nums text-x-muted">
          <span className="flex items-center gap-1.5"><ReplyIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.replies)}</span>
          <span className="flex items-center gap-1.5"><RepostIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.retweets)}</span>
          <span className="flex items-center gap-1.5"><LikeIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.likes)}</span>
          <span className="flex items-center gap-1.5"><ViewIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.views)}</span>
          <span className="flex items-center gap-1.5"><BookmarkIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.bookmarks)}</span>
        </span>
        {translation && (
          <span className="mt-2.5 block rounded-xl border border-x-border bg-x-blue/5 px-3 py-2">
            <span className="block text-caption font-bold text-x-blue-text" title="AI 자동 번역입니다 — 원문을 함께 확인하세요">🌐 AI 번역</span>
            <span className="mt-1 block whitespace-pre-wrap text-[15px] leading-5">{translation}</span>
          </span>
        )}
        {/* 회색 = 도구층 밴드: 메모·태그·워크스페이스는 X에 없는 우리 요소라 층을 분리 */}
        <span className="mt-3 block rounded-xl bg-x-surface px-3 py-2.5">
          {r.memos.map((m, i) => (
            <span key={i} className="mb-1.5 block border-l-2 border-x-blue pl-2 text-[13px] leading-[18px] text-x-secondary"><b className="text-x-text">{m.member}</b> {m.text}</span>
          ))}
          <span className="block text-[13px] text-x-muted">
            {r.memos.length === 0 && '메모 없음 — 저장만 되어 있어요 · '}
            {r.tags.map((t) => `#${t}`).join(' ')}{r.tags.length > 0 && ' · '}
            {r.workspaces.length > 1 ? `${r.workspaces.length}곳에 저장됨 · ` : ''}{r.workspaces.map((w) => w.name).join(', ')}
          </span>
        </span>
      </span>
    </>
  );
}
```

주의: 기존 시트의 번역 블록 조건은 `showTranslations && translations[r.tweetId]`였다 — 카드에서는 `translation` prop 유무로 단순화했고, 조건 판정은 시트(Step 2)가 한다.

- [ ] **Step 2: RefPickerSheet 카드 본문을 RefTweetCard로 교체**

`visible.map((r) => …)` 안의 `<button key={r.tweetId} …>` 내용부를 다음으로 교체(바깥 button과 그 className·onClick·aria-pressed는 그대로):

```tsx
              // X 실측 트윗 카드 구조(시안 A) — 내용부는 RefTweetCard로 추출(미리보기와 공유), 선택 체크 원만 시트 소유
              <button key={r.tweetId} onClick={() => toggle(r.tweetId)} aria-pressed={on}
                      className={`relative flex w-full gap-3 border-b border-x-border px-4 pb-3.5 pt-3 text-left ${on ? 'bg-x-blue/5' : 'hover:bg-x-hover'}`}>
                <RefTweetCard row={r} translation={showTranslations && translations[r.tweetId] ? translations[r.tweetId].content : undefined} />
                <span aria-hidden
                      className={`absolute right-4 top-3 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 text-[13px] font-bold ${on ? 'border-x-blue bg-x-blue text-white' : 'border-x-border-strong bg-white'}`}>
                  {on ? '✓' : ''}
                </span>
              </button>
```

체크 원 span은 원래 내용부 span 안에 있었지만 absolute 기준이 버튼(relative)이라 직계 자식으로 옮겨도 위치가 같다.

- [ ] **Step 3: 시트의 불필요해진 임포트 정리**

카드로 옮겨진 것만 제거: `MediaGrid`, `formatCount`, `ReplyIcon, RepostIcon, LikeIcon, ViewIcon, BookmarkIcon`(XIcons 줄 전체). `RefTweetCard` 임포트 추가. `useTranslations`·`ReferenceRow` 등 나머지는 그대로(시트가 여전히 사용).

- [ ] **Step 4: 타입 확인**

Run: `npx tsc --noEmit` — RefTweetCard.tsx·RefPickerSheet.tsx 관련 오류 0건이어야 한다. (RefPreviewModal/DraftComposer/page 관련 오류는 병렬 Task 2 진행 중이면 나올 수 있음 — 무시)

- [ ] **커밋하지 않는다** — Task 3에서 통합 커밋.

---

### Task 2: RefPreviewModal + 칩 진입점 + 페이지 배선

**Files:**
- Create: `src/components/RefPreviewModal.tsx`
- Modify: `src/components/DraftComposer.tsx`
- Modify: `src/app/generate/page.tsx`

**Interfaces:**
- Consumes: `RefTweetCard`(Task 1이 병렬로 생성 중 — `{ row: ReferenceRow; translation?: string }`, 임포트만 하면 됨).
- Produces: `DraftComposer` prop `onPreviewRef: (tweetId: string) => void`; `RefPreviewModal({ row, onClose, onRemove })`.

- [ ] **Step 1: RefPreviewModal.tsx 생성**

```tsx
'use client';
import { useEffect } from 'react';
import { RefTweetCard } from '@/components/RefTweetCard';
import type { ReferenceRow } from '@/lib/referenceStore';

// 레퍼런스 미리보기 — 패널 칩 클릭으로 연다. 데이터가 부모 refRows에 이미 있어 조회 없이 즉시 뜬다(스펙 §B).
// z-50: AddByLinkModal과 같은 층. 시트(z-40)와는 동시에 열릴 수 없다 — 시트가 열리면 패널이 오버레이에 덮인다.
export function RefPreviewModal({ row, onClose, onRemove }: {
  row: ReferenceRow | null; onClose: () => void; onRemove: (tweetId: string) => void;
}) {
  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); }; // IME 조합 중 Esc 무시
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [row, onClose]);

  if (!row) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="max-h-full w-full max-w-[480px] overflow-y-auto rounded-2xl bg-white" role="dialog" aria-modal="true"
           aria-label="레퍼런스 미리보기" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center border-b border-x-border bg-white px-4 py-3">
          <h2 className="text-[15px] font-bold">참고할 레퍼런스</h2>
          <button onClick={onClose} aria-label="닫기" className="ml-auto rounded px-1.5 text-x-secondary hover:bg-x-border">✕</button>
        </div>
        <div className="relative flex gap-3 px-4 pb-3.5 pt-3">
          <RefTweetCard row={row} />
        </div>
        {/* 확인 후의 다음 행동을 그 자리에 — 빼기(이건 아니네) / 원문(맥락 더 볼래) (스펙 의도) */}
        <div className="flex items-center gap-3 border-t border-x-border px-4 py-3">
          <button onClick={() => { onRemove(row.tweetId); onClose(); }}
                  className="text-ui text-x-secondary hover:text-red-500 hover:underline">
            이 레퍼런스 빼기
          </button>
          <a href={`https://x.com/${row.authorHandle}/status/${row.tweetId}`} target="_blank" rel="noopener noreferrer"
             className="ml-auto text-ui text-x-blue-text hover:underline">
            X에서 원문 보기 ↗
          </a>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: DraftComposer 칩에 미리보기 진입점**

시그니처에 prop 추가 — `onOpenAddLink` 뒤에 `onPreviewRef: (tweetId: string) => void;` (구조분해에도 추가). 칩 렌더(refRows.map 안의 `<span key={r.tweetId} …>@{r.authorHandle}…`)를 다음으로 교체:

```tsx
                <span key={r.tweetId} className="inline-flex h-7 items-center gap-1 rounded-full border border-x-border-strong bg-white px-2.5 text-ui">
                  {/* 본문 클릭=미리보기, ✕=빼기 — 링크+닫기 조합이라 타깃 둘이어도 관례적(스펙 §C) */}
                  <button onClick={() => onPreviewRef(r.tweetId)} title="클릭해서 내용 보기" className="hover:underline">
                    @{r.authorHandle}
                  </button>
                  <button onClick={() => onRemoveRef(r.tweetId)} aria-label={`@${r.authorHandle} 레퍼런스 빼기`} className="text-x-muted hover:text-red-500">✕</button>
                </span>
```

- [ ] **Step 3: generate/page.tsx 배선**

(a) 임포트 추가: `import { RefPreviewModal } from '@/components/RefPreviewModal';`

(b) `const [addLinkOpen, setAddLinkOpen] = useState(false);` 아래에:

```tsx
  const [previewRefId, setPreviewRefId] = useState<string | null>(null); // 칩 미리보기 — row는 refRows에서 파생(스펙 §D)
```

(c) 피크 Esc 가드 확장 — 기존 `if (!peekId || editing || addLinkOpen) return;`을 다음으로, 의존성 배열에도 `previewRefId` 추가:

```tsx
    if (!peekId || editing || addLinkOpen || previewRefId) return;
```
```tsx
  }, [peekId, editing, addLinkOpen, previewRefId]);
```

(d) `const peeked = …` 근처(파생값 모인 곳)에:

```tsx
  // 칩 미리보기 대상 — 원본이 refRows에서 빠지면 모달도 자연 소멸(peeked와 같은 파생 패턴)
  const previewRefRow = previewRefId ? refRows.find((x) => x.tweetId === previewRefId) ?? null : null;
```

(e) `<DraftComposer …>`에 prop 추가 — `onOpenAddLink` 줄 다음에:

```tsx
                         onPreviewRef={setPreviewRefId}
```

(f) `<AddByLinkModal …/>` 바로 아래에:

```tsx
      <RefPreviewModal row={previewRefRow} onClose={() => setPreviewRefId(null)}
                       onRemove={(id) => setRefRows((cur) => cur.filter((x) => x.tweetId !== id))} />
```

- [ ] **Step 4: 타입 확인**

Run: `npx tsc --noEmit` — Task 1이 아직 안 끝났으면 RefTweetCard 모듈 미존재 오류 1건만 허용, 그 외 0건.

- [ ] **커밋하지 않는다** — Task 3에서 통합 커밋.

---

### Task 3: 통합 검증 + 커밋 (Task 1·2 완료 후)

- [ ] **Step 1**: `npx tsc --noEmit && npm run build` — 성공.
- [ ] **Step 2**: `npm run lint 2>&1 | tail -3` — 24개 기준선 유지, 신규 오류 0.
- [ ] **Step 3**: 커밋

```bash
git add src/components/RefTweetCard.tsx src/components/RefPreviewModal.tsx src/components/RefPickerSheet.tsx src/components/DraftComposer.tsx src/app/generate/page.tsx
git commit -m "feat(generate): 레퍼런스 칩 클릭 미리보기 — 시트 카드를 RefTweetCard로 추출·공유"
```

- [ ] **Step 4**: 재빌드 후 로컬 서버(127.0.0.1:3001) 갱신 → koo 화면 QA(칩 클릭 즉시 표시·시트 카드 회귀 없음·빼기/원문 링크 동작).
