# X.com UI Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 덱 전체를 X.com 라이트모드 룩앤필로 통일하고, 트윗 카드에 X Display Requirements 링크(작성자·타임스탬프·본문 엔티티)를 추가하며, 칼럼 설정 모달을 600px로 재설계한다.

**Architecture:** Tailwind v4 `@theme` 디자인 토큰(`x-*` 색상) + 순수 함수 토크나이저(`tokenizeTweetText`) + 프레젠테이션 전용 컴포넌트 수정. 데이터 모델·API 변경 없음.

**Tech Stack:** Next.js(App Router) + Tailwind v4 + node:test(tsx 로더). 테스트 명령: `npm test`(전체), 빌드: `npm run build`.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-14-x-ui-parity-design.md`
- **라이트 고정**: `dark:` 클래스 및 `prefers-color-scheme` 분기 전부 제거.
- **토큰만 사용**: 컴포넌트에 hex 하드코딩 금지 — `x-text` `x-secondary` `x-muted` `x-border` `x-border-strong` `x-blue` `x-blue-hover` `x-green` `x-pink` `x-hover` 토큰 클래스 사용. 단 멤버 색상(`member.color`)은 데이터 값이므로 inline style 유지.
- **gray→토큰 매핑**: `gray-100/200→x-border`, `gray-300→x-border-strong`, `gray-400→x-muted`, `gray-500/600→x-secondary`, `gray-900(텍스트/버튼)→x-text`.
- **건드리지 않는 파일**: `src/app/w/[wsId]/research/page.tsx`, `src/lib/suggest.ts`, `package.json` (미커밋 리서치 작업분).
- 외부 링크는 전부 `target="_blank" rel="noopener"`.
- 커밋은 이번 작업 파일만 명시적으로 `git add` (워킹 트리에 리서치 작업 미커밋분 존재).
- 기존 로직(번역·IME 가드·검증·fetch 흐름)은 변경 금지 — 스타일/레이아웃/링크만.

---

### Task 1: 디자인 토큰 + 라이트 고정

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: Tailwind 클래스 `text-x-text`, `bg-x-hover`, `border-x-border` 등 (이후 모든 태스크가 사용)

- [ ] **Step 1: globals.css 전체 교체**

```css
@import "tailwindcss";

/* X.com 라이트모드 팔레트 — 덱 전체가 이 토큰만 사용한다 (다크모드 없음, 라이트 고정) */
@theme {
  --color-x-text: #0f1419;
  --color-x-secondary: #536471;
  --color-x-muted: #8b98a5;
  --color-x-border: #eff3f4;
  --color-x-border-strong: #cfd9de;
  --color-x-blue: #1d9bf0;
  --color-x-blue-hover: #1a8cd8;
  --color-x-green: #00ba7c;
  --color-x-pink: #f91880;
  --color-x-hover: #f7f9f9;
}

body {
  background: #ffffff;
  color: var(--color-x-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    Helvetica, Arial, sans-serif;
}

/* 컬럼 새로고침 진행 바 */
@keyframes deck-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
```

(기존 `--background/--foreground` 변수, `@theme inline`, 다크 `@media` 블록은 사용처가 body뿐이므로 함께 제거. `layout.tsx`의 Geist 폰트 변수는 더 이상 참조되지 않지만 무해하므로 layout은 건드리지 않는다.)

- [ ] **Step 2: 빌드 확인** — Run: `npm run build` / Expected: 성공
- [ ] **Step 3: Commit** — `git add src/app/globals.css && git commit -m "feat(ui): X 라이트모드 디자인 토큰 + 라이트 고정"`

---

### Task 2: tweetText 토크나이저 (TDD)

**Files:**
- Create: `src/lib/tweetText.ts`
- Test: `src/lib/tweetText.test.ts`

**Interfaces:**
- Produces: `tokenizeTweetText(text: string): TweetTextToken[]`,
  `type TweetTextToken = { type: 'text'; value: string } | { type: 'mention'; value: string; handle: string } | { type: 'hashtag'; value: string; tag: string } | { type: 'url'; value: string; href: string }`

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/tweetText.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeTweetText } from './tweetText.ts';

test('평문은 text 토큰 하나', () => {
  assert.deepEqual(tokenizeTweetText('こんにちは'), [{ type: 'text', value: 'こんにちは' }]);
});

test('멘션: @핸들 → handle 추출, 이메일은 제외', () => {
  assert.deepEqual(tokenizeTweetText('cc @hadakan__ さん'), [
    { type: 'text', value: 'cc ' },
    { type: 'mention', value: '@hadakan__', handle: 'hadakan__' },
    { type: 'text', value: ' さん' },
  ]);
  assert.deepEqual(tokenizeTweetText('mail: a@b.com'), [{ type: 'text', value: 'mail: a@b.com' }]);
});

test('해시태그: 일본어·한국어·영숫자, 전각＃ 포함', () => {
  assert.deepEqual(tokenizeTweetText('#スキンケア 最高'), [
    { type: 'hashtag', value: '#スキンケア', tag: 'スキンケア' },
    { type: 'text', value: ' 最高' },
  ]);
  assert.deepEqual(tokenizeTweetText('＃레티놀'), [{ type: 'hashtag', value: '＃레티놀', tag: '레티놀' }]);
});

test('URL: 링크화 + 일본어 문장부호·괄호 꼬리 제거', () => {
  assert.deepEqual(tokenizeTweetText('詳細→https://t.co/abc123。'), [
    { type: 'text', value: '詳細→' },
    { type: 'url', value: 'https://t.co/abc123', href: 'https://t.co/abc123' },
    { type: 'text', value: '。' },
  ]);
  assert.deepEqual(tokenizeTweetText('(https://x.com/a)'), [
    { type: 'text', value: '(' },
    { type: 'url', value: 'https://x.com/a', href: 'https://x.com/a' },
    { type: 'text', value: ')' },
  ]);
});

test('혼합: 줄바꿈 유지, 토큰 순서 보존', () => {
  assert.deepEqual(tokenizeTweetText('#新作\n@shiro_cosme https://example.com'), [
    { type: 'hashtag', value: '#新作', tag: '新作' },
    { type: 'text', value: '\n' },
    { type: 'mention', value: '@shiro_cosme', handle: 'shiro_cosme' },
    { type: 'text', value: ' ' },
    { type: 'url', value: 'https://example.com', href: 'https://example.com' },
  ]);
});

test('빈 문자열 → 빈 배열', () => {
  assert.deepEqual(tokenizeTweetText(''), []);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --test src/lib/tweetText.test.ts` / Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현** (`src/lib/tweetText.ts`)

```ts
// 트윗 본문을 링크 가능한 토큰으로 분해 — X Display Requirements의 엔티티 링크화용.
// 엔티티 메타데이터(t.co→표시 URL)는 저장하지 않으므로 정규식 기반. 스펙 §2 참조.
export type TweetTextToken =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string; handle: string }
  | { type: 'hashtag'; value: string; tag: string }
  | { type: 'url'; value: string; href: string };

// URL | @멘션(직전이 단어문자/@면 이메일 등으로 보고 제외) | #해시태그(글자·숫자·_ 연속, 일한영 지원)
const TOKEN_RE =
  /(https?:\/\/[^\s]+)|((?<![\w@＠])[@＠][A-Za-z0-9_]{1,15})|((?<![\p{L}\p{N}_])[#＃][\p{L}\p{N}_]+)/gu;

// URL 꼬리에 붙은 문장부호(일본어 구두점·닫는 괄호 포함)는 본문으로 돌려보낸다
const TRAILING_PUNCT_RE = /[)\]}>.,、。」』】！？!?;:]+$/;

export function tokenizeTweetText(text: string): TweetTextToken[] {
  const out: TweetTextToken[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const idx = m.index;
    if (idx > last) out.push({ type: 'text', value: text.slice(last, idx) });
    const [, url, mention, hashtag] = m;
    if (url) {
      const trail = url.match(TRAILING_PUNCT_RE)?.[0] ?? '';
      const clean = trail ? url.slice(0, -trail.length) : url;
      out.push({ type: 'url', value: clean, href: clean });
      if (trail) out.push({ type: 'text', value: trail });
    } else if (mention) {
      out.push({ type: 'mention', value: mention, handle: mention.slice(1) });
    } else if (hashtag) {
      out.push({ type: 'hashtag', value: hashtag, tag: hashtag.slice(1) });
    }
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}
```

- [ ] **Step 4: 통과 확인** — Run: `node --import tsx --test src/lib/tweetText.test.ts` / Expected: 전부 PASS. 연속된 text 조각이 생기면 하나로 합치도록 구현 조정(테스트가 기준).
- [ ] **Step 5: Commit** — `git add src/lib/tweetText.ts src/lib/tweetText.test.ts && git commit -m "feat: 트윗 본문 토크나이저 — 멘션/해시태그/URL 링크화용"`

---

### Task 3: TweetText 컴포넌트 + TweetCard anatomy 보강

**Files:**
- Create: `src/components/TweetText.tsx`
- Modify: `src/components/TweetCard.tsx`

**Interfaces:**
- Consumes: `tokenizeTweetText` (Task 2), 토큰 클래스 (Task 1)
- Produces: `<TweetText text={string} className?={string} />`

- [ ] **Step 1: TweetText 작성** (`src/components/TweetText.tsx`)

```tsx
import { tokenizeTweetText } from '@/lib/tweetText';

// 본문 엔티티 링크: 멘션→프로필, 해시태그→X 검색, URL→원본 (Display Requirements)
export function TweetText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <p className={`whitespace-pre-wrap break-words ${className}`}>
      {tokenizeTweetText(text).map((tok, i) => {
        if (tok.type === 'text') return tok.value;
        const href =
          tok.type === 'url' ? tok.href
          : tok.type === 'mention' ? `https://x.com/${tok.handle}`
          : `https://x.com/search?q=${encodeURIComponent(`#${tok.tag}`)}`;
        return (
          <a key={i} href={href} target="_blank" rel="noopener" className="text-x-blue hover:underline">
            {tok.value}
          </a>
        );
      })}
    </p>
  );
}
```

- [ ] **Step 2: TweetCard 수정** — 변경점만 정리 (기존 구조·저장 버튼·savedBy·NEW 배지 로직 유지):
  1. 인라인 `[font-family:...]` 제거 (body가 이미 X 스택), hex → 토큰 교체 (`#0f1419→x-text`, `#536471→x-secondary`, `#eff3f4→x-border`, `#cfd9de→x-border-strong`, `#8b98a5→x-muted`, `#1d9bf0→x-blue`, `#00ba7c→x-green`, `#f91880→x-pink`). `metricBase`의 hover 색도 동일 매핑.
  2. 아바타를 `<a href={profileUrl} target="_blank" rel="noopener">`로 감싼다. `const profileUrl = \`https://x.com/${t.authorHandle}\`;`
  3. 이름+@핸들을 하나의 `<a href={profileUrl} ...>`로 묶고 이름에 `hover:underline`.
  4. 타임스탬프: `t.tweetUrl`이 있으면 `<a href={t.tweetUrl} target="_blank" rel="noopener" className="hover:underline">· {timeAgo(...)}</a>`, 없으면 기존 span.
  5. 본문 `<p ...>{t.text}</p>` → `<TweetText text={t.text} className="mt-0.5" />`.
  6. 인용 트윗 본문 `<span className="whitespace-pre-wrap ...">{t.quoted.text}</span>` → `<TweetText text={t.quoted.text} className="inline text-x-text" />` 형태로 교체하되 사용자명 볼드는 유지.
  7. 하단 "원문↗" 링크 제거 (타임스탬프 링크와 중복).
  8. 카드에 `hover:bg-x-hover transition-colors` 추가 (X 타임라인 행 hover), `bg-white`는 유지.

- [ ] **Step 3: 확인** — Run: `npm run build && npm test` / Expected: 빌드 성공, 기존+신규 테스트 전부 PASS
- [ ] **Step 4: 디버그 페이지 육안 확인** — `npm run dev` 후 `/debug/card`에서 링크·hover 동작 확인 (fixture 트윗에 해시태그/URL 포함)
- [ ] **Step 5: Commit** — `git add src/components/TweetText.tsx src/components/TweetCard.tsx && git commit -m "feat(ui): 트윗 카드 anatomy — 작성자/타임스탬프/본문 엔티티 링크 (X Display Requirements)"`

---

### Task 4: 칼럼 설정 모달 600px 재설계

**Files:**
- Modify: `src/components/ColumnSettings.tsx`

**Interfaces:**
- Consumes: 토큰 클래스 (Task 1). props/onSubmit 시그니처·상태 로직은 그대로.

- [ ] **Step 1: 레이아웃/스타일 교체** — state·핸들러(`addKwInput`, `suggest`, `submit`, IME 가드, 번역)는 그대로 두고 JSX만 재구성:

공통 스타일 상수:

```tsx
const input = 'w-full rounded-md border border-x-border-strong bg-transparent px-3 py-2.5 text-[15px] outline-none focus:border-x-blue focus:ring-1 focus:ring-x-blue';
const label = 'mb-1 block text-[13px] font-medium text-x-secondary';
const chip = 'rounded-full border border-x-border-strong px-3 py-1 text-[13px] hover:bg-x-hover';
const section = 'mt-5 border-t border-x-border pt-4';
const sectionTitle = 'mb-3 text-[13px] font-bold text-x-text';
```

모달 골격:

```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
  <div className="max-h-[90vh] w-[600px] max-w-[90vw] overflow-y-auto rounded-2xl bg-white p-6"
       onClick={(e) => e.stopPropagation()}>
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-[20px] font-bold text-x-text">{initial ? '칼럼 설정' : '새 칼럼'}</h2>
      <button onClick={onClose} className="rounded-full p-2 text-x-secondary hover:bg-x-hover" title="닫기">✕</button>
    </div>
    {/* 유형 세그먼트 (신규일 때만): 선택 = bg-x-text text-white, 비선택 = chip */}
    {/* 검색: 키워드 섹션 → 필터 섹션 → 고급 섹션 / 워치리스트: 계정 섹션 → 고급 섹션 */}
    {/* 푸터: 취소(chip) / 만들기·저장(rounded-full bg-x-text px-5 py-2 font-bold text-white hover:opacity-90) */}
  </div>
</div>
```

섹션 배치:
- **키워드 섹션** (검색): `<label className={label}>키워드 (OR 조합 · 한국어는 자동 번역)</label>` + 큰 입력(`input` 상수) + 옆에 "연관 제안" chip 버튼. 칩 목록은 입력 아래 `flex flex-wrap gap-1.5`. 제안 결과 박스는 `rounded-xl border border-dashed border-x-border-strong p-3`.
- **필터 섹션** (검색): `section` 구분선 + "필터" 제목 아래 `grid grid-cols-2 gap-x-4 gap-y-3` — 최소 좋아요 / 최소 조회수(재필터) / since / until, 각각 `label`+`input`. 그 아래 이미지만 체크박스 (`text-[14px] text-x-secondary`).
- **고급 섹션**: `section` + "고급" 제목 — 2열 그리드: 언어 / 페이지 상한 / 칼럼 이름(비우면 자동, `col-span-2`). 워치리스트일 땐 계정 핸들(큰 입력, 키워드 자리) + 고급(페이지 상한·칼럼 이름).
- 에러 문구: `mt-3 text-[13px] text-x-pink`. 번역 중 문구: `text-[13px] text-x-muted`.
- `dark:` 클래스 전부 제거.

- [ ] **Step 2: 확인** — Run: `npm run build` / Expected: 성공. dev 서버에서 새 칼럼(검색/워치리스트 전환·키워드 추가·제안)·기존 칼럼 설정 편집 동작 확인.
- [ ] **Step 3: Commit** — `git add src/components/ColumnSettings.tsx && git commit -m "feat(ui): 칼럼 설정 모달 600px 재설계 — 섹션 구분 + 넓은 입력필드"`

---

### Task 5: 전체 라이트 통일 스위프 (X 룩앤필)

**Files:**
- Modify: `src/components/Sidebar.tsx`, `src/components/Column.tsx`, `src/components/CooccurrencePanel.tsx`, `src/components/CandidateCard.tsx`, `src/app/w/[wsId]/page.tsx`, `src/app/w/[wsId]/library/page.tsx`, `src/app/debug/card/page.tsx`

**Interfaces:**
- Consumes: 토큰 클래스 (Task 1)

- [ ] **Step 1: 공통 치환** — 대상 7개 파일에서 Global Constraints의 gray→토큰 매핑 적용 + `dark:*` 클래스 전부 삭제 + 남은 hex(`#1d9bf0` 등)를 토큰으로. `hover:bg-gray-100`/`hover:bg-gray-50` → `hover:bg-x-hover`.

- [ ] **Step 2: 파일별 X 관용구 적용**
  - `Column.tsx`: 정렬 탭을 X 탭 스타일로 —

    ```tsx
    <button key={k} onClick={() => setSort(k)}
            className={`relative rounded px-2 py-1 text-[13px] hover:bg-x-hover ${sort === k ? 'font-bold text-x-text' : 'text-x-secondary'}`}>
      {SORT_LABEL[k]}
      {sort === k && <span className="absolute inset-x-2 bottom-0 h-1 rounded-full bg-x-blue" />}
    </button>
    ```

    헤더 제목 이모지(🔍/👤) 유지, `btn`/`iconBtn`/load-more/에러 문구는 공통 치환만.
  - `Sidebar.tsx`: 네비 항목 `rounded-full` + 활성 = `font-bold`(배경 강조 대신 X 방식) + `hover:bg-x-hover`. select·input은 `rounded-md border-x-border-strong focus:border-x-blue` 계열로. 삭제 확인 박스는 시맨틱 red 유지(`border-red-300 bg-red-50` — 경고색은 X에도 없는 도구 고유 UI).
  - `w/[wsId]/page.tsx`: "+ 컬럼" 버튼 → `rounded-full bg-x-text px-4 py-1.5 text-sm font-bold text-white hover:opacity-90` (X 주 버튼).
  - `CandidateCard.tsx`·`library/page.tsx`·`CooccurrencePanel.tsx`·`debug/card/page.tsx`: 공통 치환만 (구조 변경 없음). library 필터 칩 활성 상태는 `border-x-text font-bold`.

- [ ] **Step 3: 잔여 확인** — Run: `grep -rn "dark:\|gray-[0-9]\|#0f1419\|#536471\|#eff3f4\|#cfd9de\|#8b98a5\|#1d9bf0\|#00ba7c\|#f91880" src/components src/app --include="*.tsx" | grep -v research/page` / Expected: 출력 없음 (MEMBER_COLORS 배열 등 데이터 값 제외)
- [ ] **Step 4: 확인** — Run: `npm run build && npm test` / Expected: 성공 + 전부 PASS
- [ ] **Step 5: Commit** — `git add src/components/Sidebar.tsx src/components/Column.tsx src/components/CooccurrencePanel.tsx src/components/CandidateCard.tsx "src/app/w/[wsId]/page.tsx" "src/app/w/[wsId]/library/page.tsx" src/app/debug/card/page.tsx && git commit -m "feat(ui): 전체 라이트 고정 + X 토큰 통일 (사이드바·칼럼·보관함)"`

---

### Task 6: 실화면 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: dev 서버 기동** — `npm run dev`
- [ ] **Step 2: 브라우저 검증** — 덱(칼럼 헤더·정렬 탭·hover), 트윗 카드(작성자/타임스탬프/본문 링크가 새 탭으로 열리는지), 새 칼럼 모달(600px·섹션·키워드 칩), 보관함(카드·필터 칩), 사이드바. OS가 다크모드여도 전부 라이트인지 확인.
- [ ] **Step 3: 스크린샷 캡처** — 덱·모달 각 1장 (보고용)
- [ ] **Step 4: 최종 테스트** — Run: `npm test` / Expected: 기존 41 + 신규 tweetText 테스트 전부 PASS
