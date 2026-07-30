# 덱 카드 링크 복사 (X 공유 버튼 미러링) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 덱·보관함 트윗 카드의 지표 줄 끝에 X와 동일한 공유 아이콘 버튼을 두고, 누르면 트윗 링크를 클립보드에 복사하고 하단 토스트로 알린다.

**Architecture:** 링크 조립은 순수 함수(`src/lib/tweetLink.ts`)로 분리해 유닛 테스트한다. 토스트는 지금 각 페이지가 직접 렌더하는데, 카드에서 띄우려면 통로가 필요하고 호스트가 둘이면 화면에서 겹친다 — 그래서 `ToastProvider`를 워크스페이스 레이아웃에 하나 마운트하고, 표시 우선순위 규칙(지속 토스트가 일시 토스트에 덮이지 않게)은 순수 리듀서(`src/lib/toastState.ts`)로 뽑아 테스트한다. 카드는 `useToast()`로 토스트를 띄운다.

**Tech Stack:** Next.js 16.2.10 (App Router, `'use client'`), React 19.2.4, Tailwind CSS v4, TypeScript. 테스트는 `node:test` + `tsx`.

**설계 문서:** `docs/superpowers/specs/2026-07-30-deck-copy-link-design.md` — 판단 근거는 전부 여기 있다. 구현 중 판단이 필요하면 계획이 아니라 스펙을 본다.

## Global Constraints

- **UI 문구는 한국어, 내부 개념어 금지** (`AGENTS.md` UX 원칙 1). 확정 문구는 정확히 이것들이다:
  - 복사 성공: `링크를 복사했어요`
  - 복사 실패: `링크를 복사하지 못했어요 — 브라우저 권한을 확인해 주세요`
  - 버튼 `aria-label`: `링크 복사` / `title`: `이 트윗 링크를 복사합니다`
  - 보관함 실행취소(기존 문구 유지): `팀 보관함에서 뺐어요` / 액션 `실행취소`
- **테스트 러너는 `node:test`.** `npm test` = `node --import tsx --test "src/**/*.test.ts"`. 글로브가 `.ts`만 잡으므로 **테스트 대상은 `.tsx`가 아니어야 한다** — 이것이 리듀서를 별도 `.ts` 파일로 뽑는 이유다.
- **컴포넌트·라우트 테스트 하네스가 이 저장소에 없다.** React 컴포넌트에는 유닛 테스트를 새로 만들지 않는다(테스트 인프라 도입은 이 작업 범위가 아니다). 컴포넌트는 `tsc --noEmit` + `/debug/card` 육안 확인으로 검증한다.
- **`react-hooks/set-state-in-effect`가 에러로 강제된다.** effect 본문에서 `show()`/`hide()`를 호출하면 린트 문제가 늘어난다. 토스트 호출은 **이벤트 핸들러·타이머 콜백에서만** 한다.
- **린트 기준선은 22개(에러 11 + 경고 11).** `npm run lint`는 원래 비정상 종료한다. 판정 기준은 **총 22개에서 증가하지 않음**이다. 0개를 목표로 기존 코드를 고치지 않는다.
- **`tsc --noEmit`은 현재 클린이다.** 작업 후에도 클린이어야 한다.
- **커밋 메시지**는 저장소 관례를 따른다: `<type>(x-research): <한국어 요약>`, 본문도 한국어, 마지막 줄에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **파랑(`x-blue`)은 상시 의미 색으로 3용도만** (링크/주요 액션, NEW, 활성 탭). 공유 버튼의 파랑은 **호버 상태에만** 쓴다.

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `src/lib/tweetLink.ts` | 트윗 링크 문자열 조립 (순수) | 생성 |
| `src/lib/tweetLink.test.ts` | 위 함수 테스트 | 생성 |
| `src/lib/toastState.ts` | 토스트 슬롯 상태·전이 규칙 (순수, React 무관) | 생성 |
| `src/lib/toastState.test.ts` | 슬롯 우선순위 회귀 테스트 | 생성 |
| `src/lib/toastContext.tsx` | `ToastProvider`/`useToast` — 리듀서 + 타이머 + `<Toast>` 렌더 | 생성 |
| `src/components/XIcons.tsx` | X 아이콘 모음 | `ShareIcon` 추가 |
| `src/app/w/[wsId]/layout.tsx` | 워크스페이스 셸 | `ToastProvider` 마운트 |
| `src/app/w/[wsId]/page.tsx` | 덱 | 지역 토스트 상태 → `useToast` 이관 |
| `src/app/w/[wsId]/library/page.tsx` | 보관함 | 실행취소 토스트 → `useToast` 이관 |
| `src/components/TweetCard.tsx` | 트윗 카드 | 공유 버튼 추가 |
| `src/app/debug/card/page.tsx` | 카드 육안 확인 페이지 | `ToastProvider`로 감싸기 |

**의존 순서와 병렬 가능 구간:**

```
[Task 1 링크함수]  [Task 2 ShareIcon]  [Task 3 토스트 리듀서]   ← 서로 독립, 병렬 가능
                                              │
                                      [Task 4 ToastProvider + 레이아웃 마운트]
                                              │
        ┌─────────────────────┬───────────────┴────────────┐
   [Task 5 덱 이관]     [Task 6 보관함 이관]        [Task 7 카드 공유 버튼]  ← 서로 다른 파일, 병렬 가능
        └─────────────────────┴────────────────────────────┘
                                              │
                                    [Task 8 육안 확인 + 최종 검증]
```

**병렬 실행 시 커밋 규칙.** 각 태스크의 마지막 커밋 단계는 **병렬로 실행하면 안 된다.** 같은 저장소에서 여러 에이전트가 동시에 `git add`/`git commit`을 하면 `index.lock` 경합이 나고, 더 나쁘게는 A가 스테이징해둔 파일이 B의 커밋에 섞여 들어간다. 병렬로 태스크를 돌릴 때는 **작업 에이전트가 파일 편집·테스트·타입체크까지만 하고 git 명령은 실행하지 않는다.** 커밋은 오케스트레이터가 배치가 끝난 뒤 계획에 적힌 메시지로 **태스크당 하나씩 순차 실행**한다.

---

### Task 1: 트윗 링크 조립 함수

**Files:**
- Create: `src/lib/tweetLink.ts`
- Test: `src/lib/tweetLink.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `tweetPermalink(authorHandle: string, tweetId: string): string` — Task 7이 쓴다.

**배경(왜 기존 `tweet.tweetUrl`을 안 쓰는가):** 그 필드는 타입상 `string | null`이고(`src/lib/types.ts:66`), 상위 API 원본이 `twitter.com/...` 형태를 줄 수 있다(`src/lib/mappers.ts:54`). 핸들+ID 조립은 항상 유효한 `x.com` 정규형이 된다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/tweetLink.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tweetPermalink } from './tweetLink.ts';

test('tweetPermalink — 핸들과 ID로 x.com 정규 링크를 만든다', () => {
  assert.equal(tweetPermalink('nintendo', '1234567890'), 'https://x.com/nintendo/status/1234567890');
});

test('tweetPermalink — 표시용 @ 접두사가 붙어 들어와도 링크가 깨지지 않는다', () => {
  assert.equal(tweetPermalink('@nintendo', '1234567890'), 'https://x.com/nintendo/status/1234567890');
});

test('tweetPermalink — 도메인은 항상 x.com (twitter.com 아님)', () => {
  const url = tweetPermalink('nintendo', '1');
  assert.ok(url.startsWith('https://x.com/'), url);
  assert.ok(!url.includes('twitter.com'), url);
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `npx tsx --test src/lib/tweetLink.test.ts`
Expected: FAIL — `Cannot find module './tweetLink.ts'`

- [ ] **Step 3: 최소 구현**

`src/lib/tweetLink.ts`:

```ts
// 카드에서 복사·전달하는 트윗 링크.
// 상위 API가 주는 tweetUrl을 쓰지 않는다 — null 가능(types.ts)이고 twitter.com 형태가 섞여 들어온다(mappers.ts).
// 핸들+ID는 항상 있으므로 조립형이 언제나 유효한 x.com 정규형이 된다. (설계 2026-07-30 §B)
export function tweetPermalink(authorHandle: string, tweetId: string): string {
  const handle = authorHandle.replace(/^@+/, '');   // 표시용 '@handle'이 그대로 들어와도 안전하게
  return `https://x.com/${handle}/status/${tweetId}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test src/lib/tweetLink.test.ts`
Expected: PASS — `# pass 3`, `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/tweetLink.ts src/lib/tweetLink.test.ts
git commit -m "$(cat <<'EOF'
feat(x-research): 트윗 링크 조립 순수 함수 추가

카드 링크 복사가 쓸 정규형 링크. tweetUrl은 null 가능이고
twitter.com이 섞여 들어와 쓰지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: X 공유 아이콘 추가

**Files:**
- Modify: `src/components/XIcons.tsx` (파일 끝에 추가)

**Interfaces:**
- Consumes: 같은 파일의 내부 `Icon` 래퍼(`XIcons.tsx:1-8`) — 24×24 viewBox, `currentColor`, 기본 `h-[18px] w-[18px] fill-current`
- Produces: `ShareIcon: ({ className }: { className?: string }) => JSX.Element` — Task 7이 쓴다.

이 파일에는 테스트가 없다(컴포넌트 하네스 없음). 검증은 `tsc --noEmit`과 Task 8의 육안 확인이다.

- [ ] **Step 1: `ShareIcon` 추가**

`src/components/XIcons.tsx` 맨 끝(`GripIcon` 다음)에 추가:

```tsx
// 공유 — 트레이에서 위로 나가는 화살표. 실제 X 공유 버튼과 같은 도형 (설계 2026-07-30 §C)
export const ShareIcon = ({ className }: { className?: string }) => (
  <Icon className={className} d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" />
);
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음, 종료 코드 0

- [ ] **Step 3: 커밋**

```bash
git add src/components/XIcons.tsx
git commit -m "$(cat <<'EOF'
feat(x-research): X 공유 아이콘(ShareIcon) 추가

기존 XIcons 규격(24x24, currentColor) 그대로.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 토스트 슬롯 상태 리듀서 (순수)

**Files:**
- Create: `src/lib/toastState.ts`
- Test: `src/lib/toastState.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: Task 4가 쓰는 것들 —
  - `interface ToastSpec { message: string; actionLabel?: string; onAction?: () => void; dismissible: boolean }`
  - `interface ToastState { transient: ToastSpec | null; persistent: ToastSpec | null; seq: number }`
  - `const initialToastState: ToastState`
  - `type ToastAction = { type: 'showTransient'; toast: ToastSpec } | { type: 'showPersistent'; toast: ToastSpec } | { type: 'expireTransient' } | { type: 'hidePersistent' } | { type: 'dismissVisible' }`
  - `toastReducer(state: ToastState, action: ToastAction): ToastState`
  - `visibleToast(state: ToastState): ToastSpec | null`

**왜 슬롯이 두 개인가(설계 §D):** 호스트를 하나로 합치면 겹침은 없어지지만 **덮어쓰기**가 생긴다. 보관함에서 실행취소 토스트(5초)가 떠 있는 동안 링크를 복사하면 복사 토스트가 그것을 밀어내고, 2.5초 뒤 사라지며 실행취소 기회가 조용히 없어진다. 5초 타이머는 계속 돌아 삭제는 커밋된다. `transient`가 만료되면 아직 살아있는 `persistent`가 **다시 드러나야** 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/toastState.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialToastState, toastReducer, visibleToast, type ToastSpec } from './toastState.ts';

const UNDO: ToastSpec = { message: '팀 보관함에서 뺐어요', actionLabel: '실행취소', dismissible: false };
const COPIED: ToastSpec = { message: '링크를 복사했어요', dismissible: true };

test('일시 토스트가 지속 토스트를 가린다', () => {
  let s = toastReducer(initialToastState, { type: 'showPersistent', toast: UNDO });
  assert.equal(visibleToast(s), UNDO);
  s = toastReducer(s, { type: 'showTransient', toast: COPIED });
  assert.equal(visibleToast(s), COPIED);
});

test('일시 토스트가 만료되면 지속 토스트가 다시 드러난다', () => {
  let s = toastReducer(initialToastState, { type: 'showPersistent', toast: UNDO });
  s = toastReducer(s, { type: 'showTransient', toast: COPIED });
  s = toastReducer(s, { type: 'expireTransient' });
  assert.equal(visibleToast(s), UNDO, '실행취소 기회가 복사 토스트에 먹혀서는 안 된다');
});

test('일시 토스트 만료 시 지속 토스트가 없으면 아무것도 안 보인다', () => {
  let s = toastReducer(initialToastState, { type: 'showTransient', toast: COPIED });
  s = toastReducer(s, { type: 'expireTransient' });
  assert.equal(visibleToast(s), null);
});

test('hidePersistent는 일시 토스트를 건드리지 않는다', () => {
  let s = toastReducer(initialToastState, { type: 'showPersistent', toast: UNDO });
  s = toastReducer(s, { type: 'showTransient', toast: COPIED });
  s = toastReducer(s, { type: 'hidePersistent' });
  assert.equal(visibleToast(s), COPIED);
  s = toastReducer(s, { type: 'expireTransient' });
  assert.equal(visibleToast(s), null, '지속 토스트가 내려간 뒤엔 되살아나지 않는다');
});

test('dismissVisible은 표시 중인 슬롯만 비운다', () => {
  let s = toastReducer(initialToastState, { type: 'showPersistent', toast: UNDO });
  s = toastReducer(s, { type: 'showTransient', toast: COPIED });
  s = toastReducer(s, { type: 'dismissVisible' });
  assert.equal(visibleToast(s), UNDO, '일시 토스트를 닫아도 지속 토스트는 남는다');
  s = toastReducer(s, { type: 'dismissVisible' });
  assert.equal(visibleToast(s), null);
});

test('일시 토스트끼리는 마지막 것이 이긴다', () => {
  const ERR: ToastSpec = { message: '순서를 저장하지 못했어요', dismissible: true };
  let s = toastReducer(initialToastState, { type: 'showTransient', toast: ERR });
  s = toastReducer(s, { type: 'showTransient', toast: COPIED });
  assert.equal(visibleToast(s), COPIED);
});

test('seq는 전이마다 증가한다 — 같은 문구 반복 시 aria-live 재고지용', () => {
  const s0 = initialToastState;
  const s1 = toastReducer(s0, { type: 'showTransient', toast: COPIED });
  const s2 = toastReducer(s1, { type: 'showTransient', toast: COPIED });
  assert.ok(s1.seq > s0.seq);
  assert.ok(s2.seq > s1.seq, '같은 메시지를 다시 띄우면 key가 바뀌어야 스크린리더가 다시 읽는다');
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `npx tsx --test src/lib/toastState.test.ts`
Expected: FAIL — `Cannot find module './toastState.ts'`

- [ ] **Step 3: 최소 구현**

`src/lib/toastState.ts`:

```ts
// 토스트 표시 규칙 (설계 2026-07-30 §D). React와 무관한 순수 전이 —
// Toast는 fixed bottom-6 left-1/2라 호스트가 둘이면 겹친다. 그래서 호스트는 하나이고,
// 여기서 "무엇을 보여줄지"를 정한다. 컴포넌트 테스트 하네스가 없어 이 규칙만 .ts로 뽑아 테스트한다.
export interface ToastSpec {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  dismissible: boolean;
}

export interface ToastState {
  transient: ToastSpec | null;    // 자동 소멸 — 복사 확인, 오류 안내
  persistent: ToastSpec | null;   // 자동 소멸 없음 — 보관함 실행취소
  seq: number;                    // 전이마다 증가 — <Toast> key로 써서 같은 문구도 다시 고지되게
}

export const initialToastState: ToastState = { transient: null, persistent: null, seq: 0 };

export type ToastAction =
  | { type: 'showTransient'; toast: ToastSpec }
  | { type: 'showPersistent'; toast: ToastSpec }
  | { type: 'expireTransient' }
  | { type: 'hidePersistent' }
  | { type: 'dismissVisible' };

export function toastReducer(state: ToastState, action: ToastAction): ToastState {
  const seq = state.seq + 1;
  switch (action.type) {
    case 'showTransient':   return { ...state, transient: action.toast, seq };
    case 'showPersistent':  return { ...state, persistent: action.toast, seq };
    case 'expireTransient': return { ...state, transient: null, seq };
    case 'hidePersistent':  return { ...state, persistent: null, seq };
    // ✕는 지금 보이는 것만 닫는다. 지속 토스트는 dismissible:false라 실질적으로 일시 토스트만 닫힌다.
    case 'dismissVisible':  return state.transient ? { ...state, transient: null, seq }
                                                  : { ...state, persistent: null, seq };
  }
}

// 일시 토스트가 지속 토스트를 가린다. 일시 토스트가 사라지면 아직 살아있는 지속 토스트가 다시 드러난다 —
// 이것이 실행취소 기회가 복사 토스트에 먹히지 않는 이유다.
export function visibleToast(state: ToastState): ToastSpec | null {
  return state.transient ?? state.persistent;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test src/lib/toastState.test.ts`
Expected: PASS — `# pass 7`, `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/toastState.ts src/lib/toastState.test.ts
git commit -m "$(cat <<'EOF'
feat(x-research): 토스트 슬롯 상태 리듀서 — 지속 토스트가 덮이지 않게

일시(복사·오류)/지속(실행취소) 슬롯을 분리해 일시 토스트가 만료되면
지속 토스트가 다시 드러나게 한다. 실행취소 기회 소실 방지.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: ToastProvider + 레이아웃 마운트

**Files:**
- Create: `src/lib/toastContext.tsx`
- Modify: `src/app/w/[wsId]/layout.tsx` (전체 9줄 — 아래 전문 그대로 교체)

**Interfaces:**
- Consumes: Task 3의 `initialToastState`, `toastReducer`, `visibleToast`, `ToastSpec`; 기존 `Toast` 컴포넌트(`src/components/Toast.tsx` — props `{ message, actionLabel?, onAction?, onDismiss? }`)
- Produces: Task 5·6·7이 쓰는 것들 —
  - `ToastProvider({ children }: { children: React.ReactNode })`
  - `useToast(): { show: (message: string, opts?: ShowToastOptions) => void; hide: () => void }`
  - `interface ShowToastOptions { actionLabel?: string; onAction?: () => void; duration?: number | null; dismissible?: boolean }`
  - `show`/`hide`는 **참조가 고정**된다(`useCallback([])`). 호출부가 deps에 넣어도 재실행되지 않는다.

- [ ] **Step 1: 프로바이더 작성**

`src/lib/toastContext.tsx`:

```tsx
'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { Toast } from '@/components/Toast';
import { initialToastState, toastReducer, visibleToast, type ToastSpec } from './toastState';

export interface ShowToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  duration?: number | null;   // 기본 6000ms. null = 지속(자동 소멸 없음)
  dismissible?: boolean;      // 기본 true (✕ 노출)
}

interface ToastCtx {
  show: (message: string, opts?: ShowToastOptions) => void;
  hide: () => void;           // 지속 토스트를 내린다 (일시 토스트는 스스로 만료)
}

// 기본값 no-op — 프로바이더 밖(예: /debug 페이지)에서 카드가 렌더돼도 터지지 않는다. memberContext와 같은 방식.
const Ctx = createContext<ToastCtx>({ show: () => {}, hide: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(toastReducer, initialToastState);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, opts?: ShowToastOptions) => {
    const toast: ToastSpec = {
      message,
      actionLabel: opts?.actionLabel,
      onAction: opts?.onAction,
      dismissible: opts?.dismissible ?? true,
    };
    if (opts?.duration === null) { dispatch({ type: 'showPersistent', toast }); return; }
    if (timer.current) clearTimeout(timer.current);
    dispatch({ type: 'showTransient', toast });
    timer.current = setTimeout(() => dispatch({ type: 'expireTransient' }), opts?.duration ?? 6000);
  }, []);

  const hide = useCallback(() => dispatch({ type: 'hidePersistent' }), []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const value = useMemo(() => ({ show, hide }), [show, hide]);
  const visible = visibleToast(state);
  return (
    <Ctx.Provider value={value}>
      {children}
      {/* 화면 전체에서 토스트 호스트는 여기 하나뿐이다 — 겹침 방지 (설계 §D) */}
      {visible && (
        <Toast key={state.seq}
               message={visible.message}
               actionLabel={visible.actionLabel}
               onAction={visible.onAction}
               onDismiss={visible.dismissible ? () => dispatch({ type: 'dismissVisible' }) : undefined} />
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
```

- [ ] **Step 2: 레이아웃에 마운트**

`src/app/w/[wsId]/layout.tsx` 전문을 이것으로 교체 (덱·보관함이 이 레이아웃을 공유하므로 호스트가 하나가 된다):

```tsx
'use client';
import { useParams } from 'next/navigation';
import { MemberProvider } from '@/lib/memberContext';
import { ToastProvider } from '@/lib/toastContext';
import { Sidebar } from '@/components/Sidebar';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { wsId } = useParams<{ wsId: string }>();
  return (
    <MemberProvider>
      <ToastProvider>
        <div className="flex h-screen">
          <Sidebar wsId={wsId} />
          <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
        </div>
      </ToastProvider>
    </MemberProvider>
  );
}
```

- [ ] **Step 3: 타입 체크 + 린트 확인**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 총계 `22 problems` 유지(증가 없음).

- [ ] **Step 4: 커밋**

```bash
git add src/lib/toastContext.tsx "src/app/w/[wsId]/layout.tsx"
git commit -m "$(cat <<'EOF'
feat(x-research): ToastProvider 도입 — 워크스페이스 토스트 호스트 단일화

카드에서도 토스트를 띄울 통로가 필요하고, 페이지마다 호스트를 두면
fixed 위치가 같아 겹친다. 레이아웃에 하나만 마운트한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 덱 페이지 토스트 이관

**Files:**
- Modify: `src/app/w/[wsId]/page.tsx` (import 줄 8, state 줄 20, 자동 소멸 effect 줄 55-60, `setToast` 3곳 줄 81·87, 렌더 줄 140)

**Interfaces:**
- Consumes: Task 4의 `useToast()` → `show(message)` (기본 6000ms — 기존 동작과 동일)
- Produces: 없음

기존 동작을 **그대로** 옮긴다. 문구·지속시간·재조회 흐름을 바꾸지 않는다.

- [ ] **Step 1: import 교체**

`src/app/w/[wsId]/page.tsx:8` 의

```tsx
import { Toast } from '@/components/Toast';
```

을 이것으로 바꾼다:

```tsx
import { useToast } from '@/lib/toastContext';
```

- [ ] **Step 2: 지역 상태를 훅으로 교체**

`page.tsx:20` 의 `const [toast, setToast] = useState<string | null>(null);` 를 삭제하고, 그 자리에 넣는다:

```tsx
  const { show } = useToast();
```

- [ ] **Step 3: 자동 소멸 effect 삭제**

`page.tsx:55-60` 의 아래 블록을 통째로 삭제한다 (지속시간 관리는 프로바이더가 한다):

```tsx
  // Toast 자동 소멸
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
```

- [ ] **Step 4: 호출부 3곳 교체**

`commitOrder` 안(줄 81·87 근방)의 `setToast(...)` 를 `show(...)` 로 바꾼다. 문구는 그대로:

```tsx
      if (!r.ok) {
        show(r.status === 409
          ? '다른 팀원이 컬럼을 바꿔서 순서를 저장하지 못했어요. 최신 상태로 새로 불러왔습니다.'
          : '순서를 저장하지 못했어요. 잠시 후 다시 옮겨주세요.');
        await load();
      }
    } catch {
      show('순서를 저장하지 못했어요. 잠시 후 다시 옮겨주세요.');
      await load();
    }
  }, [columns, wsId, load, show]);
```

`useCallback` deps에 `show`를 추가한다(참조 고정이므로 재생성되지 않는다). deps를 빠뜨리면 `react-hooks/exhaustive-deps` 경고가 늘어난다.

- [ ] **Step 5: 렌더 삭제**

`page.tsx:140` 의 이 줄을 삭제한다 (프로바이더가 렌더한다):

```tsx
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
```

- [ ] **Step 6: 타입 체크 + 린트 확인**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 총계 22개 이하(증가 없음). `useState`·`useEffect` import가 여전히 다른 곳에서 쓰이는지 확인 — 안 쓰이면 unused import 오류가 나므로 정리한다.

- [ ] **Step 7: 커밋**

```bash
git add "src/app/w/[wsId]/page.tsx"
git commit -m "$(cat <<'EOF'
refactor(x-research): 덱 토스트를 ToastProvider로 이관

문구·6초 지속시간·재조회 흐름은 그대로. 렌더 위치만 프로바이더로 옮긴다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 보관함 실행취소 토스트 이관

**Files:**
- Modify: `src/app/w/[wsId]/library/page.tsx` (import 줄 12, `requestRemoveTeam` 줄 55-64, `undoRemove` 줄 66-70, 언마운트 effect 줄 76-79, 렌더 줄 149-151)

**Interfaces:**
- Consumes: Task 4의 `useToast()` → `show(message, { actionLabel, onAction, duration: null, dismissible: false })`, `hide()`
- Produces: 없음

**절대 건드리지 말 것:** `removeTimer`의 5초 타이머, `commitRemove`, `pendingRemove`, 언마운트 시 커밋 로직. 이 코드에는 "삭제가 이미 나간 뒤 실행취소를 눌러 데이터가 소실되는 레이스 방지" 주석이 붙어 있다(`library/page.tsx:47-48`). **이관은 토스트를 어디서 그리는지만 바꾼다.**

**왜 effect가 아니라 호출부인가:** 이 저장소는 `react-hooks/set-state-in-effect`를 **에러로** 강제한다. `useEffect` 본문에서 `show()`를 부르면 린트 문제가 늘어난다. 그래서 `undoTweet`이 바뀌는 **모든 지점에서 짝이 되는 토스트 호출**을 함께 한다. 지켜야 하는 불변식: **토스트 노출 ⟺ `undoTweet !== null`.**

- [ ] **Step 1: import 교체**

`library/page.tsx:12` 의

```tsx
import { Toast } from '@/components/Toast';
```

을 이것으로 바꾼다:

```tsx
import { useToast } from '@/lib/toastContext';
```

- [ ] **Step 2: 훅 추가**

`const { members, member } = useMember();` 아래 줄에 추가:

```tsx
  const { show, hide } = useToast();
```

- [ ] **Step 3: `requestRemoveTeam`에서 토스트 띄우기**

`library/page.tsx:55-64` 를 이것으로 교체한다 (타이머 로직은 그대로, `show`/`hide` 호출만 추가):

```tsx
  // 토스트 노출 ⟺ undoTweet !== null 을 유지한다. undoTweet이 바뀌는 지점마다 show/hide를 짝지어 부른다
  // (effect로 배선하면 react-hooks/set-state-in-effect 위반).
  const requestRemoveTeam = useCallback((tweetId: string) => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (undoTweet && undoTweet !== tweetId) void commitRemove(undoTweet); // 대기 중 다른 건 즉시 커밋
    setPendingRemove(tweetId);
    setUndoTweet(tweetId);
    // duration:null = 자동 소멸 없음, dismissible:false = ✕ 없음.
    // 5초 뒤 삭제가 커밋되므로 토스트가 먼저 사라지거나 사용자가 닫아 실행취소 기회를 잃으면 안 된다.
    show('팀 보관함에서 뺐어요', { actionLabel: '실행취소', onAction: undoRemove, duration: null, dismissible: false });
    removeTimer.current = setTimeout(() => {
      setUndoTweet((cur) => (cur === tweetId ? null : cur)); // 실행취소 불가 시점 → 토스트 내림
      hide();
      void commitRemove(tweetId);
    }, 5000);
  }, [commitRemove, undoTweet, show, hide, undoRemove]);
```

**선언 순서 주의:** `requestRemoveTeam`이 `undoRemove`를 참조하므로 `undoRemove`가 **먼저** 선언돼 있어야 한다. 현재 파일은 `requestRemoveTeam`(55) → `undoRemove`(66) 순서다. `undoRemove` 블록(Step 4)을 `requestRemoveTeam` **위로** 옮긴다.

- [ ] **Step 4: `undoRemove`를 위로 옮기고 `hide()` 추가**

`library/page.tsx:66-70` 의 블록을 삭제하고, `requestRemoveTeam` **바로 위**에 이 형태로 넣는다:

```tsx
  const undoRemove = useCallback(() => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    setUndoTweet(null);
    hide();
    setPendingRemove(null); // 카드 복원, 아무것도 삭제 안 함
  }, [hide]);
```

- [ ] **Step 5: 언마운트 시 지속 토스트 내리기**

프로바이더는 레이아웃에 있어 **보관함을 떠나도 살아있다.** 지속 토스트를 내리지 않으면 덱으로 이동한 뒤에도 "팀 보관함에서 뺐어요"가 계속 떠 있다. `library/page.tsx:76-79` 의 언마운트 effect를 이것으로 교체한다:

```tsx
  // 대기 중 tweetId를 ref로 추적(언마운트 시 최신값 참조용) — pendingRemove를 deps로 쓰면
  // undo/타임아웃마다 cleanup이 돌아 삭제가 잘못 커밋되므로, deps는 wsId와 참조 고정된 hide만 둔다.
  const pendingRef = useRef<string | null>(null);
  useEffect(() => { pendingRef.current = pendingRemove; }, [pendingRemove]);
  useEffect(() => () => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    hide();   // 프로바이더는 레이아웃에 있어 페이지를 떠나도 살아있다 — 지속 토스트를 남기지 않는다
    if (pendingRef.current) void apiFetch(`/api/library?workspaceId=${wsId}&tweetId=${pendingRef.current}`, { method: 'DELETE' });
  }, [wsId, hide]);
```

- [ ] **Step 6: 렌더 삭제**

`library/page.tsx:149-151` 의 이 블록을 삭제한다:

```tsx
      {undoTweet && (
        <Toast message="팀 보관함에서 뺐어요" actionLabel="실행취소" onAction={undoRemove} />
      )}
```

- [ ] **Step 7: 타입 체크 + 린트 확인**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 총계 22개에서 증가 없음. `undoTweet` state는 `requestRemoveTeam` 안에서 계속 쓰이므로 그대로 남는다(unused 아님).

- [ ] **Step 8: 커밋**

```bash
git add "src/app/w/[wsId]/library/page.tsx"
git commit -m "$(cat <<'EOF'
refactor(x-research): 보관함 실행취소 토스트를 ToastProvider로 이관

지속 토스트(duration:null, ✕ 없음)로 띄워 5초 커밋 전까지 실행취소를
보장한다. 타이머·커밋·레이스 방지 로직은 그대로. 페이지 이탈 시 내린다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 카드 공유 버튼

**Files:**
- Modify: `src/components/TweetCard.tsx` (import 줄 1-10 근방, 컴포넌트 본문 줄 45 근방, 엔게이지먼트 바 줄 134-150)

**Interfaces:**
- Consumes: Task 1의 `tweetPermalink(authorHandle, tweetId)`, Task 2의 `ShareIcon`, Task 4의 `useToast()` → `show`
- Produces: 없음 (최종 사용자 대면 기능)

이 컴포넌트는 덱(`Column.tsx:401`)과 보관함(`CandidateCard.tsx:32`)이 함께 쓴다 — 두 화면에 동시에 반영되는 것이 의도다.

- [ ] **Step 1: import 추가**

`TweetCard.tsx` 상단의 XIcons import에 `ShareIcon`을 추가하고(알파벳 순 유지: `ReplyIcon, RepostIcon, ShareIcon, ViewIcon` 형태로 기존 나열 규칙에 맞춘다), 두 import를 새로 넣는다:

```tsx
import { tweetPermalink } from '@/lib/tweetLink';
import { useToast } from '@/lib/toastContext';
```

- [ ] **Step 2: 복사 핸들러 추가**

컴포넌트 본문 맨 위(`const [showOverride, setShowOverride] = useState<boolean | null>(null);` 근방, 다른 훅들과 같은 자리)에 추가:

```tsx
  const { show } = useToast();
```

그리고 `const profileUrl = ...` (줄 72) 바로 위에 핸들러를 넣는다:

```tsx
  // 링크 복사 — X와 같은 자리·아이콘의 공유 버튼. 실패해도 버튼을 숨기지 않고 이유를 말한다 (설계 §E)
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(tweetPermalink(t.authorHandle, t.tweetId));
      show('링크를 복사했어요', { duration: 2500 });
    } catch {
      show('링크를 복사하지 못했어요 — 브라우저 권한을 확인해 주세요');
    }
  }
```

`navigator.clipboard`가 아예 없는 환경(비보안 컨텍스트)에서는 속성 접근이 `try` 안에서 던져지므로 같은 경로로 처리된다. `document.execCommand` 폴백은 쓰지 않는다(deprecated, 프로덕션 HTTPS에서 도달하지 않음).

- [ ] **Step 3: 지표 줄 끝에 버튼 추가**

`TweetCard.tsx:147-149` 의 북마크 `<span>` **다음**, 같은 `<div className="mt-3 flex max-w-[425px] items-center justify-between">` 안에 넣는다:

```tsx
            {/* 공유 — 이 줄에서 유일하게 누를 수 있는 요소. 지표는 글자색만 변하고 이것만 원형 배경이 생겨
                "누를 수 있음"을 구분한다. 파랑은 호버 상태에만 쓴다(상시 의미색 3용도 제한과 무관).
                액션은 풋터 존 규칙(2026-07-19 §7)의 의도된 예외 — X 손버릇 자리이기 때문 (설계 2026-07-30 §C).
                음수 마진은 34px 히트 영역을 확보하면서 줄 높이·정렬을 그대로 두기 위한 것. */}
            <button type="button" onClick={copyLink}
                    aria-label="링크 복사" title="이 트윗 링크를 복사합니다"
                    className="-my-2 -mr-2 flex items-center rounded-full p-2 text-x-secondary transition-colors hover:bg-x-blue/10 hover:text-x-blue-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-x-blue">
              <ShareIcon />
            </button>
```

- [ ] **Step 4: 타입 체크 + 린트 확인**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 총계 22개에서 증가 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/components/TweetCard.tsx
git commit -m "$(cat <<'EOF'
feat(x-research): 카드 지표 줄에 X 공유 버튼 — 원클릭 링크 복사

X와 같은 자리·같은 아이콘. 메뉴는 열지 않는다(의미 있는 항목이 하나뿐).
읽기 전용 지표와 구분되게 호버 시 원형 배경이 생긴다. 덱·보관함 공통.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 육안 확인 환경 + 최종 검증

**Files:**
- Modify: `src/app/debug/card/page.tsx`

**Interfaces:**
- Consumes: Task 4의 `ToastProvider`
- Produces: 없음

`/debug/card`는 `w/[wsId]` 레이아웃 밖이라 프로바이더가 없다. 감싸지 않으면 복사는 되지만 토스트가 안 뜬다(컨텍스트 기본값이 no-op). 이 페이지는 서버 컴포넌트지만 클라이언트 프로바이더를 자식과 함께 렌더할 수 있다.

- [ ] **Step 1: `/debug/card`를 프로바이더로 감싸기**

`src/app/debug/card/page.tsx` 에 import를 추가하고

```tsx
import { ToastProvider } from '@/lib/toastContext';
```

`return` 문을 이것으로 교체한다:

```tsx
  return (
    <ToastProvider>
      <main className="mx-auto max-w-[420px] border-x border-x-border">
        {tweets.map((t) => <TweetCard key={t.tweetId} tweet={t} />)}
      </main>
    </ToastProvider>
  );
```

- [ ] **Step 2: 전체 테스트**

Run: `npm test`
Expected: 전부 통과, `# fail 0`. (4분 정도 걸린다.)

- [ ] **Step 3: 타입 체크 + 린트 총계 확인**

Run: `npx tsc --noEmit; echo "tsc=$?"; npm run lint 2>&1 | tail -3`
Expected: `tsc=0`, 린트 `22 problems` (증가 없음).

- [ ] **Step 4: 육안 확인**

Run: `npm run dev` 후 `http://localhost:3000/debug/card` 접속.

확인 항목:
1. 지표 줄 끝에 공유 아이콘이 있고, 도형이 X의 공유 아이콘(트레이에서 위로 나가는 화살표)으로 보인다 — 뒤집혀 있거나 찌그러져 있지 않다.
2. 호버 시 원형 파란 배경이 생기고, 옆 지표들은 글자색만 변한다.
3. 호버해도 **줄 높이나 다른 지표 위치가 흔들리지 않는다**(음수 마진 확인).
4. 탭 키로 포커스가 가고 포커스 링이 보이며, 엔터로 복사된다.
5. 클릭하면 하단 중앙에 `링크를 복사했어요`가 뜨고 약 2.5초 뒤 사라진다.
6. 붙여넣어 보면 `https://x.com/<핸들>/status/<숫자ID>` 형태다.
7. 연속으로 두 번 클릭해도 매번 토스트가 다시 뜬다.

도형이 이상하면 Task 2의 `d` 경로를 고치고 여기로 다시 온다. 나머지 항목이 어긋나면 Task 7의 클래스를 고친다.

- [ ] **Step 5: 커밋**

```bash
git add src/app/debug/card/page.tsx
git commit -m "$(cat <<'EOF'
chore(x-research): /debug/card에 ToastProvider — 복사 토스트까지 눌러 확인

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: 실사용 확인 요청 정리**

로그인 게이팅(Supabase Google OAuth) 때문에 실제 덱·보관함 화면은 사용자만 볼 수 있다. 아래 두 가지를 사용자에게 확인 요청한다:

1. **덱** — 카드의 공유 버튼 클릭 → 토스트 → 붙여넣기 확인. 컬럼을 드래그해 순서 저장 실패 안내가 아직 정상인지도(토스트 이관 회귀) 확인.
2. **보관함 슬롯 우선순위 회귀** — 트윗 하나를 `팀 보관함에서 빼기` → `실행취소` 토스트가 뜬 상태에서 **다른 카드의 링크를 복사** → 복사 토스트가 보이고, 2.5초 뒤 **실행취소 토스트가 다시 드러나며** 실행취소가 여전히 동작한다. 그리고 5초를 그냥 두면 실제로 빠진다.
