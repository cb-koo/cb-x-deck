# 보관함 카드 밀도 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보관함 카드의 높이 편차를 줄이고(본문 클램프·이미지 상한·인용 접기·코멘트 접기) 그리드 강제 스트레칭을 없애(items-start) 빈 공간을 제거한다.

**Architecture:** 모든 카드 축소 동작은 opt-in prop(기본 false)으로 구현해 덱·generate·모달은 무영향. TweetCard에 `dense` 단일 prop을 추가하고, 그 아래 MediaGrid(`compactSingle`)·QuotedCard(`collapsible`)로 배선. 본문 클램프+더 보기는 재사용 컴포넌트 `ClampedText`로 분리.

**Tech Stack:** Next.js(app router)·React 클라이언트 컴포넌트·Tailwind v4(line-clamp 내장).

## Global Constraints

- 컴포넌트 테스트 하네스 없음 → 태스크별 검증은 `npm run lint`(기준선 24건 초과 금지) + `npm run build`. 화면 확인은 koo QA(OAuth 게이팅).
- 덱·generate·표 팝업·브리핑의 기존 렌더는 바이트 단위로 동일해야 함(모든 신규 prop 기본값 false).
- "더 보기"는 실제로 잘렸을 때만 표시(거짓 어포던스 금지) — `scrollHeight > clientHeight` 측정.
- 스펙: `docs/superpowers/specs/2026-08-15-library-density-design.md`.

---

### Task 1: ClampedText 컴포넌트 + TweetCard `dense` prop (본문·번역 클램프)

**Files:**
- Create: `src/components/ClampedText.tsx`
- Modify: `src/components/TweetCard.tsx` (props 인터페이스, 본문 `TweetText` 분기, 번역 박스 분기)

**Interfaces:**
- Produces: `ClampedText({ text, className? })` — 6줄 클램프 + 페이드 + "더 보기 ▾"/"접기 ▴" 알약 버튼. `TweetCardProps.dense?: boolean`.

- [ ] **Step 1: ClampedText 작성**

```tsx
'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { TweetText } from './TweetText';

// 밀도 모드 본문: 6줄 클램프. 실제로 잘렸을 때만 페이드+'더 보기'를 보여준다(거짓 어포던스 금지, spec §2).
// 측정은 열 너비 변화(창 크기)에도 따라가야 해서 ResizeObserver로 유지한다.
export function ClampedText({ text, className = '' }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const p = boxRef.current?.querySelector('p');
    if (!p) return;
    const measure = () => setClipped(!expanded && p.scrollHeight > p.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(p);
    return () => ro.disconnect();
  }, [text, expanded]);
  return (
    <div>
      <div ref={boxRef} className="relative">
        <TweetText text={text} className={`${className} ${expanded ? '' : 'line-clamp-6'}`} />
        {clipped && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-white/0 to-white" />}
      </div>
      {(clipped || expanded) && (
        <button onClick={() => setExpanded((v) => !v)}
                className="mt-1.5 rounded-full bg-x-blue/10 px-3 py-1 text-ui font-medium text-x-blue-text hover:bg-x-blue/20">
          {expanded ? '접기 ▴' : '더 보기 ▾'}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TweetCard 배선**

`TweetCardProps`에 `dense?: boolean;  // 보관함 밀도 모드 — 본문·번역 6줄 클램프, 이미지 상한, 인용 접기` 추가, 함수 시그니처에 `dense` 구조분해. `import { ClampedText } from './ClampedText';` 추가.

본문(기존 `<TweetText text={t.text} className="mt-0.5" />`):
```tsx
{dense ? <ClampedText text={t.text} className="mt-0.5" /> : <TweetText text={t.text} className="mt-0.5" />}
```

번역 박스 내용(기존 `<TweetText text={translation.content} />`):
```tsx
{dense ? <ClampedText text={translation.content} /> : <TweetText text={translation.content} />}
```

- [ ] **Step 3: 검증** — `npm run lint`(≤24건), `npm run build` 성공.

- [ ] **Step 4: Commit** — `feat(library): 밀도 모드 본문 클램프 — ClampedText(페이드+더 보기, 잘린 카드만) + TweetCard dense prop`

---

### Task 2: MediaGrid 단일 이미지 상한 `compactSingle`

**Files:**
- Modify: `src/components/MediaGrid.tsx`, `src/components/TweetCard.tsx`(MediaGrid 호출)

**Interfaces:**
- Consumes: Task 1의 `dense`.
- Produces: `MediaGrid({ media, renderOverlay?, compactSingle? })` — true면 단일 이미지 `max-h-52`(208px), 기본 `max-h-96`.

- [ ] **Step 1: MediaGrid prop 추가**

```tsx
export function MediaGrid({ media, renderOverlay, compactSingle }: { media: DeckMedia[]; renderOverlay?: (i: number) => ReactNode; compactSingle?: boolean }) {
```
이미지 클래스:
```tsx
className={`h-full w-full object-cover ${imgs.length === 1 ? (compactSingle ? 'max-h-52' : 'max-h-96') : 'aspect-square'}`}
```

- [ ] **Step 2: TweetCard에서 전달** — `<MediaGrid media={t.media} compactSingle={dense} />`

- [ ] **Step 3: 검증** — lint·build.

- [ ] **Step 4: Commit** — `feat(library): 단일 이미지 세로 상한 208px — MediaGrid compactSingle(밀도 모드 한정)`

---

### Task 3: QuotedCard 접기 `collapsible`

**Files:**
- Modify: `src/components/QuotedCard.tsx`, `src/components/TweetCard.tsx`(QuotedCard 호출)

**Interfaces:**
- Produces: `QuotedCard({ quoted, translation?, collapsible? })`. 접힘: 본문 2줄 클램프 + "▾ 눌러서 펼치기", 박스 클릭=펼침, 미디어·번역 숨김. 펼침: 박스 클릭=원문 열기(기존), 별도 "▴ 접기"(stopPropagation).

- [ ] **Step 1: QuotedCard 수정**

```tsx
import { useState } from 'react';
// ...
export function QuotedCard({ quoted, translation, collapsible = false }: { quoted: DeckQuoted & { enriched?: DeckTweet | null }; translation?: string | null; collapsible?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const collapsed = collapsible && !expanded;
  // ... 기존 e/handle/name/url 유지
  return (
    <div
      role={collapsed ? 'button' : url ? 'link' : undefined}
      onClick={collapsed ? () => setExpanded(true) : url ? () => window.open(url, '_blank', 'noopener') : undefined}
      className={`mt-3 overflow-hidden rounded-2xl border border-x-border-strong text-[15px] ${collapsed || url ? 'cursor-pointer transition-colors hover:bg-x-hover' : ''}`}
    >
      <div className="px-3 pt-2.5 pb-3">
        {/* 헤더 기존 그대로 */}
        <TweetText text={e?.text ?? quoted.text} className={`mt-1 text-x-text ${collapsed ? 'line-clamp-2' : ''}`} />
        {collapsed ? (
          <p className="mt-1 text-caption text-x-blue-text">▾ 눌러서 펼치기</p>
        ) : (
          <>
            {translation && (/* 기존 번역 블록 그대로 */)}
            {collapsible && (
              <button onClick={(ev) => { ev.stopPropagation(); setExpanded(false); }}
                      className="mt-1 text-caption text-x-muted hover:text-x-blue-text">▴ 접기</button>
            )}
          </>
        )}
      </div>
      {!collapsed && e && e.media.length > 0 && (/* 기존 미디어 블록 그대로 */)}
    </div>
  );
}
```

- [ ] **Step 2: TweetCard에서 전달** — `<QuotedCard quoted={t.quoted} translation={...} collapsible={dense} />`

- [ ] **Step 3: 검증** — lint·build.

- [ ] **Step 4: Commit** — `feat(library): 인용 트윗 접기 — 접힘 클릭=펼침, 펼침 클릭=원문(기존 동작 복원)`

---

### Task 4: CandidateCard 코멘트 접기 + `dense` 배선

**Files:**
- Modify: `src/components/CandidateCard.tsx`

**Interfaces:**
- Consumes: `TweetCardProps.dense`. `entry.candidates`는 savedAt 오름차순(candidateGroups) → 최신 = 마지막 요소.

- [ ] **Step 1: TweetCard 호출에 `dense` 추가** — `<TweetCard tweet={{ ...entry.tweet, isNew: false }} dense meId={meId} ... />`

- [ ] **Step 2: 코멘트 접기**

```tsx
const [commentsOpen, setCommentsOpen] = useState(false);
// 표시 순서는 기존 오름차순 유지 — 접힘일 땐 최신(마지막) 1개만. 펼치면 이전 코멘트가 위로 드러나 최신 위치가 안 튐.
const visibleComments = commentsOpen ? entry.candidates : entry.candidates.slice(-1);
```
렌더부(기존 `entry.candidates.map` → `visibleComments.map`), 목록 위에 토글 행 추가:
```tsx
{entry.candidates.length >= 2 && (
  <div className="px-2 py-1.5">
    <button onClick={() => setCommentsOpen((v) => !v)} className="text-caption text-x-blue-text hover:underline">
      {commentsOpen ? '코멘트 접기 ▴' : `코멘트 ${entry.candidates.length - 1}개 더 보기 ▾`}
    </button>
  </div>
)}
```
주의: 코멘트 1개 이하면 토글 없이 현행 그대로. AddComment(미저장 멤버 입력창)는 항상 표시 유지. 내 코멘트가 숨김 상태면 펼친 뒤 수정·제거(스펙 §5).

- [ ] **Step 3: 검증** — lint·build.

- [ ] **Step 4: Commit** — `feat(library): 코멘트 접기 — 최신 1개+N개 더 보기, 카드 밀도 모드(dense) 배선`

---

### Task 5: 그리드 items-start

**Files:**
- Modify: `src/app/w/[wsId]/library/page.tsx:155`

- [ ] **Step 1:** `<main className="grid grid-cols-1 items-start gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">`

- [ ] **Step 2: 검증** — lint·build.

- [ ] **Step 3: Commit** — `feat(library): 그리드 items-start — 카드가 내용 높이만큼만 그려짐`

---

## 최종 검증

- `npm run lint` 기준선 ≤24건, `npm run build` 성공.
- koo 화면 QA 항목: 변경 ①~⑤ 동작, 더 보기 가시성(페이드+알약)·잘리지 않은 카드에 미표시, 전체 번역 켠 상태의 클램프, 인용 접힘/펼침 클릭 동작, 덱·generate·표 팝업·브리핑 카드가 기존과 동일.
