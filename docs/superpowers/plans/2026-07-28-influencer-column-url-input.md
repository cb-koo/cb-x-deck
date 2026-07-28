# 인플루언서 컬럼 프로필 링크 입력 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인플루언서 컬럼을 만들 때 `@핸들` 대신 X 프로필/트윗 링크를 그대로 붙여넣어도 계정을 추적할 수 있게 한다.

**Architecture:** 핸들 정규화를 순수 함수 `parseXHandle`(신규 `src/lib/xHandle.ts`) 한 곳에 모은다. 서버 라우트 두 곳(`POST /api/columns`, `PATCH /api/columns/[id]`)에 흩어진 `String(...).replace(/^@/, '')`를 이 함수로 교체해 저장값의 근거를 단일화하고, 형식이 틀린 입력은 비용 유발 호출(`getUserInfo`) 전에 400으로 끊는다. 클라이언트(`ColumnSettings.tsx`)는 같은 함수로 입력칸 아래 성공 피드백을 파생 표시한다 — 표시값과 저장값이 구조적으로 어긋날 수 없다.

**Tech Stack:** Next.js(App Router, 이 저장소 버전은 `node_modules/next/dist/docs/` 참조), TypeScript, React 클라이언트 컴포넌트, 테스트는 `node:test` + `node:assert/strict`(러너: `npm test`), Tailwind 유틸 클래스.

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-07-28-influencer-column-url-input-design.md`. 판정표·문구는 여기서 **그대로** 가져온다.
- **UX 원칙(`AGENTS.md`)**: 라벨은 내부 개념어(parse·normalize·handle 정규화 등)를 노출하지 않는다. 사용자 문구는 한국어이고 결과 서술까지 포함한다. 값은 항상 파생값으로 만들어 라벨/값 불일치를 구조적으로 막는다.
- **테스트 파일 규약**: `src/**/*.test.ts`, 상대 import에 **`.ts` 확장자를 붙인다**(예: `import { parseXHandle } from './xHandle.ts';`). 기존 `src/lib/tweetText.test.ts` 형식을 따른다. 테스트 이름은 한국어.
- **테스트 실행 시간**: `npm test`는 전체 211개를 돌려 **약 4분** 걸린다(멈춘 게 아니다). 개발 루프에서는 단일 파일로 돌린다:
  `node --import tsx --test src/lib/xHandle.test.ts` (수 초). 커밋 직전에만 `npm test` 전체를 돌린다.
- **검증 기준선**(작업 시작 시점, 2026-07-28 확인): `npx tsc --noEmit` 오류 0, `npm test` → `# pass 211 / # fail 0`. 이 숫자가 줄어들면 회귀다.
- **핸들 규칙**: `^[A-Za-z0-9_]{1,15}$`.
- **허용 호스트**: `x.com`, `twitter.com` + `www.` / `mobile.` / `m.` 서브도메인만.
- **예약 경로**(계정으로 해석하지 않음): `i`, `home`, `explore`, `search`, `notifications`, `messages`, `settings`, `compose`, `intent`, `share`, `hashtag`, `login`, `logout`, `signup`, `account`, `tos`, `privacy`, `about`, `download`.
- **사용자 문구**(문자 그대로, 임의로 다듬지 않는다):
  - `empty` → `계정 핸들이나 프로필 링크를 넣어주세요`
  - `notProfile` → `계정을 알 수 없는 주소예요 — x.com/계정명 형태의 링크나 @핸들을 넣어주세요`
  - `invalid` → `X 계정 주소나 @핸들이 아니에요 — 예: x.com/hadakan__ 또는 @hadakan__`
- **범위 밖**: 숫자 ID(`/i/user/<id>`) 역조회, `x.com/i/status/…`의 작성자 API 조회, 키워드 컬럼 입력 변경, 링크 다중 붙여넣기. 새 DB 마이그레이션 없음.
- 커밋은 태스크마다. 커밋 메시지는 한국어 본문 + Conventional Commits 접두어(저장소 관행).

---

### Task 1: `parseXHandle` 순수 함수

핸들/URL을 핸들로 정규화하는 함수와 사용자 문구 함수. 이후 두 태스크가 전부 여기에 의존한다.

**Files:**
- Create: `src/lib/xHandle.ts`
- Test: `src/lib/xHandle.test.ts`

**Interfaces:**
- Consumes: 없음 (의존성 없는 순수 모듈 — `@/lib/*` import 금지)
- Produces:
  ```ts
  export type HandleParseReason = 'empty' | 'notProfile' | 'invalid';
  export type HandleParse =
    | { ok: true; handle: string }
    | { ok: false; reason: HandleParseReason };
  export function parseXHandle(input: string): HandleParse;
  export function handleParseMessage(reason: HandleParseReason): string;
  ```
  Task 2(서버 라우트)와 Task 3(UI)이 이 두 함수와 타입을 그대로 import한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/xHandle.test.ts`를 새로 만든다. 설계 문서의 판정표 전체 + 핸들 길이 경계.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleParseMessage, parseXHandle } from './xHandle.ts';

test('핸들 그대로: @ 접두어와 앞뒤 공백은 떼어낸다', () => {
  assert.deepEqual(parseXHandle('hadakan__'), { ok: true, handle: 'hadakan__' });
  assert.deepEqual(parseXHandle('@hadakan__'), { ok: true, handle: 'hadakan__' });
  assert.deepEqual(parseXHandle('  @hadakan__  '), { ok: true, handle: 'hadakan__' });
});

test('프로필 링크: 스킴 없음·후행 슬래시·쿼리스트링·서브도메인 모두 핸들로', () => {
  assert.deepEqual(parseXHandle('https://x.com/hadakan__'), { ok: true, handle: 'hadakan__' });
  assert.deepEqual(parseXHandle('x.com/hadakan__/'), { ok: true, handle: 'hadakan__' });
  assert.deepEqual(parseXHandle('http://www.twitter.com/hadakan__?s=21'), { ok: true, handle: 'hadakan__' });
  assert.deepEqual(parseXHandle('mobile.twitter.com/hadakan__/with_replies'), { ok: true, handle: 'hadakan__' });
  assert.deepEqual(parseXHandle('m.x.com/hadakan__#top'), { ok: true, handle: 'hadakan__' });
});

// 경로 뒤 조각은 무엇이든 무시 — 트윗 링크도 첫 조각이 작성자다(추가 API 콜 없음)
test('트윗 링크: 경로에 핸들이 있으면 작성자로 해석', () => {
  assert.deepEqual(parseXHandle('https://x.com/hadakan__/status/1790123456789?s=20&t=abc'),
    { ok: true, handle: 'hadakan__' });
});

test('대소문자는 보존 — 정본 표기는 서버 getUserInfo가 확정', () => {
  assert.deepEqual(parseXHandle('https://x.com/HadaKan__'), { ok: true, handle: 'HadaKan__' });
});

test('빈 입력은 empty', () => {
  assert.deepEqual(parseXHandle(''), { ok: false, reason: 'empty' });
  assert.deepEqual(parseXHandle('   '), { ok: false, reason: 'empty' });
});

test('X 링크지만 계정을 알 수 없으면 notProfile', () => {
  assert.deepEqual(parseXHandle('https://x.com/'), { ok: false, reason: 'notProfile' });
  assert.deepEqual(parseXHandle('https://x.com/i/status/1790123456789'), { ok: false, reason: 'notProfile' });
  assert.deepEqual(parseXHandle('https://x.com/i/user/44196397'), { ok: false, reason: 'notProfile' });
  assert.deepEqual(parseXHandle('https://x.com/home'), { ok: false, reason: 'notProfile' });
  assert.deepEqual(parseXHandle('https://x.com/search?q=%E7%BE%8E%E5%AE%B9'), { ok: false, reason: 'notProfile' });
});

test('X가 아닌 주소·핸들 형식이 아닌 문자열은 invalid', () => {
  assert.deepEqual(parseXHandle('https://instagram.com/hadakan__'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseXHandle('hadakan hoge'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseXHandle('hada-kan'), { ok: false, reason: 'invalid' });
});

test('핸들 길이 경계: 1자·15자는 통과, 16자는 invalid', () => {
  assert.deepEqual(parseXHandle('a'), { ok: true, handle: 'a' });
  assert.deepEqual(parseXHandle('abcdefghijklmno'), { ok: true, handle: 'abcdefghijklmno' });
  assert.deepEqual(parseXHandle('abcdefghijklmnop'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseXHandle('x.com/abcdefghijklmnop'), { ok: false, reason: 'invalid' });
});

test('문구는 사용자 언어로, reason마다 다르다', () => {
  assert.equal(handleParseMessage('empty'), '계정 핸들이나 프로필 링크를 넣어주세요');
  assert.match(handleParseMessage('notProfile'), /계정을 알 수 없는 주소/);
  assert.match(handleParseMessage('invalid'), /X 계정 주소나 @핸들이 아니에요/);
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `node --import tsx --test src/lib/xHandle.test.ts`
Expected: FAIL — `Cannot find module '...src/lib/xHandle.ts'`(아직 구현 파일이 없다). 테스트가 "통과"하면 파일 경로나 import를 잘못 쓴 것이다.

- [ ] **Step 3: 최소 구현**

`src/lib/xHandle.ts`:

```ts
// 인플루언서 컬럼 입력 정규화 — 사용자가 손에 쥔 것(프로필/트윗 링크)을 그대로 받아 핸들로 만든다.
// 클라이언트 피드백과 서버 저장값이 어긋나지 않도록 규칙을 이 파일 한 곳에만 둔다.
export type HandleParseReason = 'empty' | 'notProfile' | 'invalid';
export type HandleParse =
  | { ok: true; handle: string }
  | { ok: false; reason: HandleParseReason };

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const HOSTS = new Set(['x.com', 'twitter.com']);
const SUBDOMAINS = ['www.', 'mobile.', 'm.'];

// 계정이 아닌 X 내부 경로. 'i'가 핵심 — x.com/i/status/… 와 x.com/i/user/<id>는
// 경로만으로 작성자를 알 수 없다(숫자 ID 역조회는 범위 밖).
const RESERVED = new Set([
  'i', 'home', 'explore', 'search', 'notifications', 'messages', 'settings',
  'compose', 'intent', 'share', 'hashtag', 'login', 'logout', 'signup',
  'account', 'tos', 'privacy', 'about', 'download',
]);

export function parseXHandle(input: string): HandleParse {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' };

  // 핸들 먼저 — 핸들에는 '.'도 '/'도 못 쓰므로 URL과 혼동될 수 없다.
  const bare = raw.replace(/^@/, '');
  if (HANDLE_RE.test(bare)) return { ok: true, handle: bare };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  let host = url.hostname.toLowerCase();  // URL 파서가 이미 소문자화하지만 의도를 명시
  for (const sub of SUBDOMAINS) if (host.startsWith(sub)) { host = host.slice(sub.length); break; }
  if (!HOSTS.has(host)) return { ok: false, reason: 'invalid' };

  // 첫 조각이 계정. 뒤 조각(/status/123, /with_replies, 앞으로 생길 탭)은 모두 하위 페이지다.
  const first = url.pathname.split('/').filter(Boolean)[0];
  if (!first) return { ok: false, reason: 'notProfile' };
  if (RESERVED.has(first.toLowerCase())) return { ok: false, reason: 'notProfile' };
  if (!HANDLE_RE.test(first)) return { ok: false, reason: 'invalid' };
  return { ok: true, handle: first };
}

export function handleParseMessage(reason: HandleParseReason): string {
  if (reason === 'empty') return '계정 핸들이나 프로필 링크를 넣어주세요';
  if (reason === 'notProfile') return '계정을 알 수 없는 주소예요 — x.com/계정명 형태의 링크나 @핸들을 넣어주세요';
  return 'X 계정 주소나 @핸들이 아니에요 — 예: x.com/hadakan__ 또는 @hadakan__';
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --test src/lib/xHandle.test.ts`
Expected: PASS — 테스트 9개 전부(`# pass 9 / # fail 0`).

Run: `npm test 2>&1 | tail -8` (약 4분)
Expected: `# pass 220 / # fail 0` — 기존 211개 + 신규 9개. 기존 테스트가 깨지지 않았음을 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/xHandle.ts src/lib/xHandle.test.ts
git commit -m "$(cat <<'EOF'
feat(x-deck): 핸들·프로필 링크를 핸들로 정규화하는 parseXHandle

인플루언서 컬럼 입력 규칙을 순수 함수 한 곳에 모은다. 트윗 링크는
경로 첫 조각이 작성자라 추가 API 콜 없이 해석되고, x.com/i/... 처럼
경로만으로 계정을 알 수 없는 주소는 notProfile로 끊는다.
EOF
)"
```

---

### Task 2: 서버 라우트 — 정규화 지점 교체

`getUserInfo` 호출 **전에** 형식을 검증해 비용을 아끼고, PATCH의 "핸들이 바뀌었나" 비교를 정규화된 값끼리 하게 만든다.

**Files:**
- Modify: `src/app/api/columns/route.ts:28-37` (POST의 watchlist 분기)
- Modify: `src/app/api/columns/[id]/route.ts:19-36` (PATCH의 watchlist 분기)

**Interfaces:**
- Consumes: `parseXHandle`, `handleParseMessage` from `@/lib/xHandle` (Task 1)
- Produces: 없음(라우트는 최종 소비자). 기존 응답 계약 유지 — 성공은 `201`/`200` + 컬럼 객체, 계정 미발견은 `404`, 외부 API 실패는 `502`. **형식 오류만 새로 `400`.**

- [ ] **Step 1: POST 라우트 교체**

`src/app/api/columns/route.ts`의 import에 추가:

```ts
import { handleParseMessage, parseXHandle } from '@/lib/xHandle';
```

`if (body.kind === 'watchlist') { ... }` 블록(현재 28~37행)을 아래로 교체:

```ts
  if (body.kind === 'watchlist') {
    // 형식 검증을 먼저 — getUserInfo는 비용 유발 호출이다.
    const parsed = parseXHandle(String(config.handle ?? ''));
    if (!parsed.ok) return NextResponse.json({ error: handleParseMessage(parsed.reason) }, { status: 400 });
    try {
      const info = await makeClient().getUserInfo(parsed.handle);
      if (!info.id) return NextResponse.json({ error: `계정을 찾을 수 없음: @${parsed.handle}` }, { status: 404 });
      config.handle = info.userName;
      config.userId = info.id;
    } catch (e) {
      return NextResponse.json({ error: `계정 확인 실패: ${(e as Error).message}` }, { status: 502 });
    }
  }
```

404 문구가 원본 입력(`config.handle`) 대신 `@${parsed.handle}`을 쓰는 것에 주의 — 링크를 붙여넣었을 때 오류 메시지에 URL 전체가 박히지 않게 한다.

- [ ] **Step 2: PATCH 라우트 교체**

`src/app/api/columns/[id]/route.ts`의 import에 추가:

```ts
import { handleParseMessage, parseXHandle } from '@/lib/xHandle';
```

`if (patch?.config) { ... }` 블록(현재 21~36행)을 아래로 교체:

```ts
  // plan gap: PATCH must not blindly persist a new watchlist handle without
  // re-resolving userId (same rule POST enforces on create).
  if (patch?.config && existing.kind === 'watchlist') {
    const oldHandle = (existing.config as WatchlistConfig).handle;
    const rawHandle = String((patch.config as WatchlistConfig).handle ?? '').trim();
    // 폭·정렬만 바꾸는 PATCH는 handle을 안 보낸다 — 그 경로를 막지 않는다.
    if (rawHandle) {
      const parsed = parseXHandle(rawHandle);
      if (!parsed.ok) return NextResponse.json({ error: handleParseMessage(parsed.reason) }, { status: 400 });
      if (parsed.handle.toLowerCase() === (oldHandle ?? '').toLowerCase()) {
        // 같은 계정을 가리키는 표기 차이(@handle ↔ handle ↔ 링크)로 API를 다시 부르지 않는다.
        // 재해석을 건너뛰는 경로이므로 사용자가 친 임의 표기가 저장되지 않게 정본으로 되돌린다.
        patch.config.handle = oldHandle;
      } else {
        try {
          const info = await makeClient().getUserInfo(parsed.handle);
          if (!info.id) return NextResponse.json({ error: `계정을 찾을 수 없음: @${parsed.handle}` }, { status: 404 });
          patch.config.handle = info.userName;
          patch.config.userId = info.id;
        } catch (e) {
          return NextResponse.json({ error: `계정 확인 실패: ${(e as Error).message}` }, { status: 502 });
        }
      }
    }
  }
```

중첩 `if`를 하나로 합쳤다(`patch?.config && existing.kind === 'watchlist'`) — 안쪽 `if`가 하나뿐이라 중첩이 의미가 없다. `kind !== 'watchlist'`인 컬럼의 PATCH는 그대로 통과한다.

- [ ] **Step 3: 타입·린트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: 둘 다 출력 없이 종료(exit 0). 오류가 나오면 그 파일만 고친다 — 이 태스크 범위 밖 파일의 기존 경고는 손대지 않는다.

Run: `npm test 2>&1 | tail -8` (약 4분)
Expected: `# pass 220 / # fail 0` — 라우트 변경이 기존 테스트를 깨지 않았음을 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/columns/route.ts "src/app/api/columns/[id]/route.ts"
git commit -m "$(cat <<'EOF'
fix(x-deck): 인플루언서 컬럼 API가 프로필 링크를 받아들이도록

라우트 두 곳에 흩어진 replace(/^@/,'')를 parseXHandle로 교체한다.
형식이 틀린 입력은 getUserInfo 호출 전에 400으로 끊어 비용을 아끼고,
PATCH는 정규화된 핸들끼리 비교해 표기 차이만으로 재조회하지 않는다.
EOF
)"
```

---

### Task 3: UI — 한 칸에서 핸들·링크 모두 받기

**Files:**
- Modify: `src/components/ColumnSettings.tsx` — import 추가(1~5행), `submit()`의 watchlist 가지(현재 115~119행), watchlist 입력 UI(현재 222~228행)

**Interfaces:**
- Consumes: `parseXHandle`, `handleParseMessage` from `@/lib/xHandle` (Task 1); 기존 `onSubmit({ kind, title, config })` 계약(`ColumnSettingsProps`)
- Produces: 없음(최상위 UI). `config.handle`에는 **정규화된 핸들**만 담아 보낸다.

- [ ] **Step 1: import와 파생 상태 추가**

파일 상단 import 블록에 추가:

```ts
import { handleParseMessage, parseXHandle } from '@/lib/xHandle';
```

`const [probing, setProbing] = useState(false);` 다음(현재 41행 뒤)에 파생값 한 줄을 둔다. state가 아니라 **파생값**이라야 표시와 저장값이 어긋날 수 없다:

```ts
  // 렌더마다 파생 — 입력칸 아래 피드백과 submit이 같은 판정을 쓴다.
  const parsedHandle = parseXHandle(handle);
```

- [ ] **Step 2: watchlist 입력 UI 교체**

`kind === 'search' ? (...) : (...)`의 else 가지(현재 222~228행)를 교체:

```tsx
          <div>
            <label className={label}>계정 (핸들 또는 프로필 링크)</label>
            <input className={input} value={handle} placeholder="@hadakan__ 또는 https://x.com/hadakan__"
                   autoFocus onChange={(e) => setHandle(e.target.value)} />
            {/* 타이핑 중 오류는 띄우지 않는다 — 'https://x'까지 친 상태는 사용자 잘못이 아니다.
                진짜 판정은 만들기/저장 시점(submit). */}
            {parsedHandle.ok && (
              <p className="mt-1 text-ui text-x-secondary">✓ <b className="text-x-text">@{parsedHandle.handle}</b> 을 추적할게요</p>
            )}
            <p className="mt-1 text-caption text-x-muted">이 계정이 새로 올리는 트윗을 자동으로 모아 보여줘요.</p>
            <p className="mt-0.5 text-caption text-x-muted">X 프로필 주소를 그대로 붙여넣어도 되고, @핸들만 적어도 돼요.</p>
          </div>
```

- [ ] **Step 3: `submit()`의 watchlist 가지 교체**

현재 115~119행(`} else { ... }`)을 교체:

```tsx
      } else {
        if (!parsedHandle.ok) { setErr(handleParseMessage(parsedHandle.reason)); return; }
        await onSubmit({ kind, title: title || `@${parsedHandle.handle}`,
          config: { handle: parsedHandle.handle, userId: init.userId ?? '', maxPages: maxPages || 3, sort: init.sort ?? 'views', dir: init.dir ?? 'desc', width: init.width ?? null } });
      }
```

자동 컬럼 이름이 `@${parsedHandle.handle}`이 되는 것이 핵심 — 링크를 붙여넣어도 제목이 `@hadakan__`이다(전에는 링크 전체가 제목에 박혔다).

- [ ] **Step 4: 타입·린트·테스트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: 출력 없이 exit 0.

Run: `npm test 2>&1 | tail -8` (약 4분)
Expected: `# pass 220 / # fail 0`.

- [ ] **Step 5: 실제 앱에서 손으로 확인**

Run: `npm run dev` (별도 셸), 브라우저에서 워크스페이스 → `+ 컬럼` → `인플루언서` 탭.

확인 항목:
1. `https://x.com/hadakan__` 붙여넣기 → 입력 아래 `✓ @hadakan__ 을 추적할게요` 표시 → `만들기` → 컬럼 제목이 `@hadakan__`이고 트윗이 수집된다.
2. `https://x.com/hadakan__/status/1790123456789?s=20` 붙여넣기 → 같은 결과(`@hadakan__`).
3. `@hadakan__` → 기존과 동일하게 동작.
4. `https://x.com/i/status/1790123456789` → `만들기` 누르면 `계정을 알 수 없는 주소예요 — …` 표시, 컬럼 생성 안 됨.
5. 타이핑 중(`https://x` 상태)에는 빨간 오류가 뜨지 않는다.
6. 기존 인플루언서 컬럼의 ⚙ 설정 → 아무것도 안 바꾸고 `저장` → 오류 없이 저장되고 핸들이 그대로다.

- [ ] **Step 6: 커밋**

```bash
git add src/components/ColumnSettings.tsx
git commit -m "$(cat <<'EOF'
feat(x-deck): 인플루언서 컬럼 입력칸에 프로필 링크 붙여넣기 지원

칸을 늘리지 않고 라벨을 '계정 (핸들 또는 프로필 링크)'로 바꾸고,
입력 아래에 해석 결과를 서술한다(✓ @핸들 을 추적할게요). 판정은
parseXHandle 파생값이라 표시와 저장값이 어긋날 수 없다. 자동 컬럼
이름도 링크 전체가 아니라 @핸들이 된다.
EOF
)"
```

---

## 완료 후

`PROGRESS.md`에 항목이 필요한지 확인한다(저장소 관행이면 한 줄 추가 후 커밋). 배포는 사용자 확인 후 별도로 진행한다 — 이 계획에 배포 단계는 없다.
