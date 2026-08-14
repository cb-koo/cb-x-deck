# 생성 패널에서 링크로 레퍼런스 추가 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** /generate 생성 패널의 '참고할 레퍼런스' 섹션에서 시트를 거치지 않고 링크로 트윗을 보관함에 저장하며 레퍼런스로 선택한다.

**Architecture:** 기존 `AddByLinkModal`(저장은 `POST /api/library/from-link`에 내장)을 페이지 레벨 세 번째 진입점으로 연결. 저장 후 선택은 `?ref=` 딥링크와 같은 "전량 조회 → tweetId로 찾기 → refRows 추가" 패턴. 신규 서버 코드 0.

**Tech Stack:** Next.js(App Router, 이 repo의 커스텀 버전) + React 클라이언트 컴포넌트 + Tailwind.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-15-ref-add-by-link-design.md`
- 컴포넌트 테스트 하네스 없음 — 검증은 `npm run build` 성공 + `npm run lint` 기준선(경고 24개) 유지.
- 서버·DB·API 변경 금지. `RefPickerSheet`·`AddByLinkModal` 내부 변경 금지.
- UI 문구는 UX 원칙 준수(결과는 판단까지 서술, 내부 개념어 노출 금지).
- Task 1과 Task 2는 서로 다른 파일만 수정 — 병렬 실행 가능. 커밋은 Task 3(통합 검증)에서 한 번.

---

### Task 1: DraftComposer — '링크로 추가' 진입점 버튼

**Files:**
- Modify: `src/components/DraftComposer.tsx`

**Interfaces:**
- Consumes: 없음 (독립)
- Produces: `DraftComposer` prop `onOpenAddLink: () => void` — Task 2가 `onOpenAddLink={() => setAddLinkOpen(true)}`로 넘긴다.

- [ ] **Step 1: prop 추가**

71행 시그니처와 74행 타입을 다음으로 교체:

```tsx
export function DraftComposer({ clients, value, onChange, refRows, onOpenPicker, onOpenAddLink, onRemoveRef, onClearRefs }: {
  clients: Array<{ client: ClientRow; procedures: ProcedureRow[] }>;
  value: ComposerState; onChange: (v: ComposerState) => void;
  refRows: ReferenceRow[]; onOpenPicker: () => void; onOpenAddLink: () => void;
  onRemoveRef: (tweetId: string) => void; onClearRefs: () => void;
}) {
```

- [ ] **Step 2: 두 상태 모두에 버튼 추가 (사용자 확정: 항상 표시)**

(a) `hasRefs` 분기 — `＋ 레퍼런스 더 고르기` 버튼(125-128행) **바로 아래**, 참고 방식 블록(`border-t`) 위에:

```tsx
            {/* 시트 안에만 있던 링크 추가를 패널로도 — X에서 방금 본 트윗을 시트를 거치지 않고 바로 (스펙 §A) */}
            <button onClick={onOpenAddLink}
                    className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-x-border-strong bg-white text-ui text-x-blue-text hover:bg-x-hover">
              🔗 링크로 추가
            </button>
```

(b) 빈 상태 분기 — `보관함에서 고르기` 버튼(148-152행)을 fragment로 감싸고 아래에 보조 톤 버튼:

```tsx
          <>
            <button onClick={onOpenPicker}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-x-blue bg-x-blue/5 text-ui font-bold text-x-blue-text hover:bg-x-blue/10">
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current" aria-hidden><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" /></svg>
              보관함에서 고르기
            </button>
            {/* 보조 진입점 — 주 진입점(보관함)보다 낮은 위계의 흰 배경. 도움말은 모달 안에 이미 있다(스펙 §A) */}
            <button onClick={onOpenAddLink}
                    className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-x-border-strong bg-white text-ui text-x-blue-text hover:bg-x-hover">
              🔗 링크로 추가
            </button>
          </>
```

기존 148-152행의 단일 버튼과 그 위 주석("텍스트 링크였던 것을 실제 버튼으로…")은 유지하되 fragment 안 첫 요소가 되게 한다.

- [ ] **Step 3: 타입 확인**

Run: `npx tsc --noEmit 2>&1 | grep -v "generate/page"` (page.tsx는 Task 2가 병렬 수정 중 — 이 파일의 prop 누락 오류는 예상됨, DraftComposer.tsx 자체 오류만 없으면 통과)
Expected: DraftComposer.tsx 관련 오류 0건

- [ ] **커밋하지 않는다** — Task 3에서 통합 커밋.

---

### Task 2: generate/page.tsx — 모달 배선·선택 반영·Esc 가드

**Files:**
- Modify: `src/app/generate/page.tsx`

**Interfaces:**
- Consumes: `DraftComposer`의 `onOpenAddLink: () => void` prop(Task 1이 추가 — 병렬 진행 중이므로 이 파일에서는 prop을 넘기기만 하면 됨), `AddByLinkModal`/`AddedByLink`(기존), `MAX_REFS_UI`(RefPickerSheet export, 기존).
- Produces: 없음 (최종 소비자)

- [ ] **Step 1: 임포트 확장**

15행을 교체:

```tsx
import { RefPickerSheet, MAX_REFS_UI } from '@/components/RefPickerSheet';
import { AddByLinkModal, type AddedByLink } from '@/components/AddByLinkModal';
```

- [ ] **Step 2: 상태 추가**

55행 `const [pickerOpen, setPickerOpen] = useState(false);` 아래에:

```tsx
  const [addLinkOpen, setAddLinkOpen] = useState(false); // 진입점 C: 패널의 '링크로 추가' (스펙 §B)
```

- [ ] **Step 3: 피크 Esc 가드에 addLinkOpen 추가 (스펙의 충돌 해소)**

146-151행의 이펙트를 교체 — 가드와 의존성 배열 둘 다:

```tsx
  // Esc로 피크 닫기 — DraftEditModal 선례. 편집 모달·링크 추가 모달이 위에 열려 있으면 그쪽 Esc가 우선이라 여기선 무시.
  useEffect(() => {
    if (!peekId || editing || addLinkOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) setPeekId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [peekId, editing, addLinkOpen]);
```

- [ ] **Step 4: 저장 성공 핸들러**

`?ref=` 딥링크 이펙트(186-199행) 아래에 함수 추가:

```tsx
  // 진입점 C의 후처리 — 저장은 모달(/api/library/from-link)이 이미 끝냈고 여기선 '선택'만 한다.
  // 진입점 A(?ref=)와 같은 패턴: 전량 조회에서 방금 트윗의 row를 찾아 refRows에 붙인다(단건 API 없음, 스펙 §B).
  async function handleAddedByLink(r: AddedByLink) {
    const saved = r.alreadyInLibrary ? '이미 보관함에 있어요' : '보관함에 추가했어요';
    if (refRows.some((x) => x.tweetId === r.tweetId)) { setToast(`${saved} — 이미 레퍼런스로 선택돼 있어요`); return; }
    if (refRows.length >= MAX_REFS_UI) { setToast(`${saved} — 레퍼런스가 ${MAX_REFS_UI}건이라 자동 선택은 안 했어요. '보관함에서 고르기'에서 조정해주세요`); return; }
    try {
      const rows: ReferenceRow[] = await apiFetch('/api/references?scope=all').then((res) => res.json());
      const found = rows.find((x) => x.tweetId === r.tweetId);
      if (!found) { setToast(`${saved} — 목록을 갱신하지 못했어요. '보관함에서 고르기'에서 선택해주세요`); return; }
      setRefRows((cur) => (cur.some((x) => x.tweetId === r.tweetId) ? cur : [...cur, found]));
      setToast(`${saved} — 레퍼런스로 선택했어요`);
    } catch {
      setToast(`${saved} — 목록을 갱신하지 못했어요. '보관함에서 고르기'에서 선택해주세요`);
    }
  }
```

- [ ] **Step 5: DraftComposer에 prop 전달**

612-615행의 `<DraftComposer …>`에 `onOpenPicker` 옆으로 추가:

```tsx
          <DraftComposer clients={clients} value={composer} onChange={updateComposer}
                         refRows={refRows} onOpenPicker={() => setPickerOpen(true)}
                         onOpenAddLink={() => setAddLinkOpen(true)}
                         onRemoveRef={(id) => setRefRows((cur) => cur.filter((x) => x.tweetId !== id))}
                         onClearRefs={() => setRefRows([])} />
```

- [ ] **Step 6: 모달 렌더**

831-832행 `<RefPickerSheet …/>` 바로 아래에:

```tsx
      {/* 진입점 C — 시트 내부 인스턴스와 별개(각자 open 상태). 시트가 열리면 패널이 오버레이에 덮여 동시 오픈 불가 */}
      <AddByLinkModal open={addLinkOpen} onClose={() => setAddLinkOpen(false)} defaultWsId={lastWsId}
                      onAdded={(r) => { void handleAddedByLink(r); }} />
```

- [ ] **Step 7: 타입 확인**

Run: `npx tsc --noEmit`
Expected: 오류 0건 (Task 1이 아직 안 끝났으면 `onOpenAddLink` prop 오류 1건만 — Task 3에서 재확인)

- [ ] **커밋하지 않는다** — Task 3에서 통합 커밋.

---

### Task 3: 통합 검증 + 커밋 (Task 1·2 완료 후)

**Files:**
- Test: 빌드·린트 (하네스 없음 — Global Constraints)

- [ ] **Step 1: 타입·빌드**

Run: `npx tsc --noEmit && npm run build`
Expected: 오류 없이 성공

- [ ] **Step 2: 린트 기준선**

Run: `npm run lint 2>&1 | tail -3`
Expected: 경고 24개(기준선) 초과 없음, 오류 0

- [ ] **Step 3: 커밋**

```bash
git add src/components/DraftComposer.tsx src/app/generate/page.tsx
git commit -m "feat(generate): 생성 패널에서 링크로 레퍼런스 추가 — 보관함 저장 경유"
```

- [ ] **Step 4: 로컬 화면 확인(가능하면)**

Run: `npm run build && npx next start -p 3001` 후 `http://127.0.0.1:3001/generate`
확인: ① 빈 상태·선택 후 모두 '🔗 링크로 추가' 노출 ② 클릭 → 모달 ③ 링크 제출 → 토스트 + @handle 칩 추가 ④ 8건 상태에서 저장만 되고 자동 선택 안 됨 (OAuth 게이팅으로 로그인 필요 시 koo QA로 대체)
