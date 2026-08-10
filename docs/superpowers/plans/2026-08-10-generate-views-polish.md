# /generate 뷰 다듬기 구현 계획 (워크벤치 3차)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 뷰 토글을 세그먼티드 컨트롤로 바꾸고, 테이블/칸반의 항목 클릭을 "카드 뷰 점프" 대신 "피크 오버레이"로 교체. 스펙: `docs/superpowers/specs/2026-08-10-generate-views-polish-design.md`

**Architecture:** page.tsx 단일 파일 수정(+ 신규 파일 없음). DraftCard를 z-40 오버레이에 그대로 담고 기존 핸들러를 재배선. openCard의 점프·하이라이트 로직은 제거.

## Global Constraints

- 서버·API·DB 변경 금지. DraftCard·DraftTable·DraftKanban·DraftFilterBar·DraftComposer·모달들 파일 변경 금지 — **수정 파일은 `src/app/generate/page.tsx` 하나뿐**.
- 검증: `npx tsc --noEmit` 0건, `npm run lint` 기준선(24) 유지.
- 주석 한국어, 제약·이유만. 아이콘 버튼 aria-label+title.
- 작업자는 git 커밋 금지 — 조율자가 커밋.

---

### Task 1: 세그먼티드 토글 + 피크 오버레이 — 권장 모델: sonnet

**Files:**
- Modify: `src/app/generate/page.tsx`

- [ ] **Step 1: 상태 교체 — highlightId → peekId**

`const [highlightId, setHighlightId] = useState<string | null>(null);` 를 다음으로 교체:

```tsx
  // 피크 오버레이 — 항목 열람은 뷰 전환이 아니라 현재 뷰 위의 레이어로 (3차 스펙 §2)
  const [peekId, setPeekId] = useState<string | null>(null);
```

`openCard` 함수 전체(주석 포함)를 삭제하고, 파생값·Esc 처리를 추가 (clientNameOf 선언 근처):

```tsx
  // drafts에서 파생 — 원본이 사라지면(삭제 확정 등) 오버레이도 자연 소멸
  const peeked = peekId ? drafts.find((d) => d.id === peekId) ?? null : null;
  // Esc로 피크 닫기 — DraftEditModal 선례. 편집 모달이 위에 열려 있으면 그쪽 Esc가 우선이라 여기선 무시.
  useEffect(() => {
    if (!peekId || editing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) setPeekId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [peekId, editing]);
```

- [ ] **Step 2: 뷰 토글을 세그먼티드 컨트롤로**

헤더 행의 `role="group"` 버튼 그룹을 다음으로 교체(라벨·title은 기존 값 그대로 유지):

```tsx
            {/* 세그먼티드 컨트롤 — 배타적 모드 전환기라 필터 알약과 다른 시각 문법(채움형) (3차 스펙 §1) */}
            <div role="group" aria-label="보기 방식" className="flex shrink-0 overflow-hidden rounded-lg border border-x-border-strong">
              {(['cards', 'table', 'kanban'] as const).map((v, i) => (
                <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                        title={v === 'cards' ? '원고를 한 건씩 정독·편집해요' : v === 'table' ? '목록으로 훑고 정렬해요' : '단계별로 끌어서 상태를 옮겨요'}
                        className={`px-2.5 py-1 text-[13px] ${i > 0 ? 'border-l border-x-border-strong' : ''} ${view === v ? 'bg-x-blue font-bold text-white' : 'bg-white text-x-secondary hover:bg-x-hover'}`}>
                  {v === 'cards' ? '카드' : v === 'table' ? '테이블' : '칸반'}
                </button>
              ))}
            </div>
            <span aria-hidden className="h-4 w-px shrink-0 bg-x-border-strong" />
```

(구분선 span은 토글과 DraftFilterBar 래퍼 사이에 배치.)

- [ ] **Step 3: 카드 map 원복 + onOpenCard 재배선**

카드 뷰 map에서 하이라이트 래퍼 div를 제거하고 원래 형태로 복원 — `key`를 DraftCard로 되돌리고 `data-draft-id`·ring 클래스 삭제:

```tsx
            {view === 'cards' && visibleDrafts.map((d) => (
              <DraftCard key={d.id} draft={d} banned={bannedFor(d)} /* ← 이하 기존 props 전부 그대로 */ />
            ))}
```

`DraftTable`·`DraftKanban`의 `onOpenCard={openCard}`를 `onOpenCard={setPeekId}`로 교체.

- [ ] **Step 4: 피크 오버레이 렌더**

`{editing && (` 블록 **바로 앞**에 삽입(z-40 < 편집 모달 z-50 — DOM 순서도 앞이어야 함):

```tsx
      {peeked && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-x-text/40 p-6"
             onClick={() => setPeekId(null)}>
          <div role="dialog" aria-modal="true" aria-label="원고 상세" className="w-full max-w-[600px]"
               onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button onClick={() => setPeekId(null)} aria-label="상세 닫기" title="닫기 (Esc)"
                      className="rounded-full bg-white/90 px-2.5 py-1 text-[13px] font-bold text-x-secondary hover:bg-white">✕ 닫기</button>
            </div>
            <DraftCard draft={peeked} banned={bannedFor(peeked)}
                       onEdit={() => setEditing(peeked)}
                       onRewrite={(feedback, baseIndex) => rewrite(peeked.id, feedback, baseIndex)}
                       rewriteBusy={rewritingId === peeked.id}
                       onDelete={() => { setPeekId(null); requestRemove(peeked); }}
                       onRegenPost={(i) => regenPost(peeked, i)}
                       regenBusyIndex={regenBusy?.draftId === peeked.id ? regenBusy.index : null}
                       onDismissFlag={(key, dismiss) => toggleDismiss(peeked, key, dismiss)}
                       onRestoreAllFlags={() => restoreAllFlags(peeked)}
                       onChangeStatus={(s) => changeStatus(peeked, s)}
                       siblingTotal={peeked.batchId ? siblingCount(drafts, peeked.batchId) : null} />
          </div>
        </div>
      )}
```

(카드 map의 props와 대상만 다르고 형태 동일 — 실제 코드의 카드 map props를 대조해 그대로 맞출 것.)

- [ ] **Step 5: 정적 검증** — Run: `npx tsc --noEmit && npm run lint` / Expected: tsc 0건(제거된 openCard·highlightId 참조 잔재 없어야), lint 24 기준선.
- [ ] **Step 6: 스모크** — 포트 3000 dev 서버에 `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/generate` → 307/200, 로그에 컴파일 에러 없음.
