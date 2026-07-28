# 인플루언서 컬럼 — 프로필 링크 붙여넣기로 추적 (설계)

2026-07-28.

**배경.** 인플루언서 컬럼(`kind: 'watchlist'`)은 계정 하나의 새 트윗을 모아 보여준다. 생성 입력은 **계정 핸들** 한 칸이고 placeholder는 `@hadakan__`이다(`src/components/ColumnSettings.tsx:225`). 이 값은 앞의 `@`만 떼인 채 서버로 가고, 서버가 `getUserInfo(handle)`로 실제 계정을 해석해 `userId`까지 저장한다(`src/app/api/columns/route.ts:30`, `src/app/api/columns/[id]/route.ts:24`).

문제는 **사용자가 계정을 발견하는 경로가 링크**라는 것이다. X에서 인플루언서를 찾으면 손에 남는 건 주소창의 `https://x.com/hadakan__`이거나 공유 버튼이 준 `https://x.com/hadakan__/status/1790…?s=20`이다. 핸들만 골라 적으려면 사용자가 URL을 눈으로 파싱해야 한다. 그대로 붙여넣으면 `getUserInfo('https://x.com/hadakan__')`가 호출돼 **404 「계정을 찾을 수 없음」**이 뜬다 — 계정은 존재하는데 없다고 말하는 거짓 오류다. 컬럼 이름을 비웠으면 자동 이름도 `@https://x.com/hadakan__`이 된다.

**해결.** 입력칸을 늘리지 않고, **핸들이든 링크든 같은 칸에 받아** 핸들로 정규화한다. 정규화는 순수 함수 하나에 모으고 클라이언트·서버가 공유한다.

## 원칙

- **사용자가 가진 것을 받는다.** 링크를 손으로 분해하게 만들지 않는다.
- **추측할 근거가 있으면 묻지 않고 처리한다.** `x.com/hadakan__/status/123`은 경로에 핸들이 이미 있다 → 추가 API 콜 없이 해석해서 그냥 만든다. "링크를 핸들로 바꿔드릴까요?" 같은 중간 단계를 두지 않는다.
- **정규화는 한 곳에서.** 클라이언트가 보여준 값과 서버가 저장한 값이 어긋날 수 없어야 한다.
- **API 콜 전에 형식을 검증한다.** `getUserInfo`는 비용 유발 호출이다. 핸들 형식이 아닌 게 확실하면 부르지 않는다.
- **오류 문구는 사용자 언어로.** "파싱 실패"가 아니라 "계정을 알 수 없는 주소예요".
- **신뢰 경계는 서버.** 클라이언트 정규화는 편의·피드백용이고, 저장되는 값의 근거는 서버 정규화 + `getUserInfo` 응답이다.

---

## A. `src/lib/xHandle.ts` — 공유 정규화 함수

```ts
export type HandleParse =
  | { ok: true; handle: string }
  | { ok: false; reason: 'empty' | 'notProfile' | 'invalid' };

export function parseXHandle(input: string): HandleParse;
export function handleParseMessage(reason: 'empty' | 'notProfile' | 'invalid'): string;
```

의존성 없는 순수 함수. `handleParseMessage`가 사용자 문구를 소유하므로 클라이언트와 서버가 같은 말을 한다.

### 판정 순서

1. **공백 제거.** 빈 문자열이면 `empty`.
2. **핸들 먼저.** 앞의 `@`를 떼고 `^[A-Za-z0-9_]{1,15}$`에 맞으면 → `ok`. (X 핸들 규칙. `.`이나 `/`가 없으니 URL과 절대 헷갈리지 않는다.)
3. **URL로 시도.** 스킴이 없으면 `https://`를 붙여 `new URL()`. 파싱 실패 → `invalid`.
4. **호스트 확인.** `x.com` / `twitter.com`, 그리고 `www.` `mobile.` `m.` 서브도메인만 허용. 그 외(`instagram.com` 등) → `invalid`.
5. **경로 첫 조각을 핸들 후보로.** 조각이 없으면(`x.com/`) → `notProfile`.
6. **예약 경로 배제.** 아래 목록에 걸리면 → `notProfile`.
7. **후보를 2단계 규칙으로 검사.** 통과하면 → `ok`, 아니면 → `invalid`.

경로 뒤 조각은 **무엇이든 무시한다.** `/status/123`(트윗), `/with_replies`·`/media`·`/likes`(프로필 탭), 앞으로 X가 추가할 탭까지 전부 "이 계정의 하위 페이지"라서 핸들은 첫 조각으로 결정된다. 쿼리스트링(`?s=21`)·프래그먼트·후행 슬래시도 `URL` 파싱이 알아서 떼어낸다.

### 예약 경로

`i`, `home`, `explore`, `search`, `notifications`, `messages`, `settings`, `compose`, `intent`, `share`, `hashtag`, `login`, `logout`, `signup`, `account`, `tos`, `privacy`, `about`, `download`, `statuses`, `communities`.

`i`가 여기 있다는 게 중요하다. `x.com/i/status/1790…`(작성자를 감춘 트윗 링크)과 `x.com/i/user/44196397`(숫자 ID 링크)은 **경로만으로 계정을 알 수 없다** → `notProfile`. 숫자 ID 역조회는 이번 범위 밖이다.

`statuses`·`communities`도 같은 이유다. `x.com/statuses/1790…`(옛 트윗 영구링크, 지금도 돌아다닌다)과 `x.com/communities/1234`는 첫 조각이 핸들 형식(영숫자·밑줄)과 겹쳐, 배제하지 않으면 유료 `getUserInfo`를 한 번 낭비하고 `계정을 찾을 수 없음: @statuses`라는 혼란스러운 답만 돌려준다.

이 목록은 원리적으로 **경로 조각에만** 적용된다. 사용자가 URL 없이 `home`이라고만 치면 핸들로 통과하고, 서버 조회에서 "계정을 찾을 수 없음"으로 걸린다 — 거짓이 아닌 정직한 오류이고, `@about`처럼 실재하는 계정을 막지 않으려면 이 비대칭이 필요하다.

### 문구

| reason | 문구 |
|---|---|
| `empty` | `계정 핸들이나 프로필 링크를 넣어주세요` |
| `notProfile` | `계정을 알 수 없는 주소예요 — x.com/계정명 형태의 링크나 @핸들을 넣어주세요` |
| `invalid` | `X 계정 주소나 @핸들이 아니에요 — 예: x.com/hadakan__ 또는 @hadakan__` |

### 판정표 (테스트가 그대로 검증)

| 입력 | 결과 |
|---|---|
| `hadakan__` / `@hadakan__` / ` @hadakan__ ` | `hadakan__` |
| `https://x.com/hadakan__` | `hadakan__` |
| `x.com/hadakan__/` | `hadakan__` |
| `http://www.twitter.com/hadakan__?s=21` | `hadakan__` |
| `mobile.twitter.com/hadakan__/with_replies` | `hadakan__` |
| `https://x.com/hadakan__/status/1790123456789?s=20&t=abc` | `hadakan__` |
| `https://x.com/HadaKan__` | `HadaKan__` (표기 그대로 통과 — 정본 표기는 서버가 `getUserInfo`로 확정) |
| `` / `   ` | `empty` |
| `https://x.com/` | `notProfile` |
| `https://x.com/i/status/1790123456789` | `notProfile` |
| `https://x.com/i/user/44196397` | `notProfile` |
| `https://x.com/home` | `notProfile` |
| `https://x.com/statuses/1790123456789` | `notProfile` |
| `https://x.com/communities/1234` | `notProfile` |
| `https://x.com.evil.com/hadakan__` | `invalid` (접미어만 같은 호스트) |
| `https://x.com@evil.com/hadakan__` | `invalid` (진짜 호스트는 `evil.com`) |
| `https://m.evil.com/hadakan__` | `invalid` (허용 접두어 + 비허용 호스트) |
| `https://evil.com@x.com/hadakan__` | `hadakan__` (진짜 호스트는 `x.com`) |
| `https://x.com/search?q=%E7%BE%8E%E5%AE%B9` | `notProfile` |
| `https://instagram.com/hadakan__` | `invalid` |
| `hadakan hoge` (공백) | `invalid` |
| `abcdefghijklmnop` (16자) | `invalid` |
| `x.com/abcdefghijklmnop` (16자) | `invalid` |
| `hada-kan` (하이픈) | `invalid` |

---

## B. 서버 — 정규화 지점 교체

두 라우트에 흩어진 `String(...).replace(/^@/, '')`를 `parseXHandle`로 바꾼다. 실패하면 **`getUserInfo`를 호출하지 않고** 400 + `handleParseMessage(reason)`.

`POST /api/columns` (`route.ts:28`~`37`):

```
parseXHandle(config.handle)
  실패 → 400 { error: handleParseMessage(reason) }
  성공 → getUserInfo(handle) → 기존대로 config.handle/userId 확정
```

`PATCH /api/columns/[id]` (`[id]/route.ts:21`~`36`): 기존 "핸들이 바뀌었을 때만 재해석" 규칙을 유지하되 **정규화된 값끼리 비교**한다. 지금은 `hadakan__`↔`HadaKan__` 같은 대소문자 차이나 링크 표기가 "변경"으로 잡혀 불필요한 API 콜이 난다. (앞의 `@`는 기존 코드도 비교 전에 떼어내므로 원래 문제가 아니었다.)

- `patch.config`에 handle 키가 없거나 빈 값이면 지금처럼 통과(폭·정렬만 바꾸는 PATCH를 막지 않는다).
- 값이 있는데 파싱 실패면 400.
- 정규화 결과가 기존 핸들과 **대소문자 무시 동일**이면 재해석을 건너뛰고 `patch.config.handle`과 `patch.config.userId`를 **둘 다 기존 값으로 되돌린다** — 건너뛴 경로에서 사용자가 친 임의 표기가 저장되면 안 된다.
  - `userId`까지 되돌리는 게 중요하다. `updateColumn`은 `config`를 통째로 교체하고(`columnStore.ts`), 트윗 조회는 `handle`이 아니라 **`userId`로 키를 잡는다**(`refreshColumn.ts`). 이걸 빼면 클라이언트가 실어 보낸 엉뚱한 `userId`가 그대로 저장돼, 컬럼 제목은 `@hadakan__`인데 다른 계정의 타임라인이 실리는 상태가 만들어진다. 대소문자 무시 비교로 건너뛰기 경로가 넓어졌기 때문에 이 브랜치에서 새로 생긴 구멍이다.
- 다르면 기존대로 `getUserInfo` 재해석.

`kind !== 'watchlist'`인 컬럼의 PATCH 경로는 건드리지 않는다.

---

## C. UI — 칸은 하나, 라벨·피드백만 바꾼다

`ColumnSettings.tsx`의 watchlist 분기(`:222`~`:228`)와 `submit()`의 watchlist 가지(`:116`~`:118`).

```
계정 (핸들 또는 프로필 링크)
┌────────────────────────────────────────────────┐
│ https://x.com/hadakan__/status/1790123456789   │
└────────────────────────────────────────────────┘
✓ @hadakan__ 계정을 추적할게요
X 프로필 주소를 그대로 붙여넣어도 되고, @핸들만 적어도 돼요.
```

- 라벨: `계정 핸들` → **`계정 (핸들 또는 프로필 링크)`**. placeholder: `@hadakan__ 또는 https://x.com/hadakan__`.
- 도움말 첫 줄은 기존 문구(`이 계정이 새로 올리는 트윗을 자동으로 모아 보여줘요.`)를 유지하고, 붙여넣기 가능하다는 안내를 한 줄 더 둔다. 원칙 2(행동 전 기대 설정).
- **성공 피드백**: 렌더마다 `parseXHandle(handle)`로 파생. `ok`면 `✓ @<handle> 계정을 추적할게요`. 숫자·값만 던지지 않고 결과를 서술한다(원칙 3). 파생값이라 **한 렌더 안에서** 라벨/값 불일치가 구조적으로 불가능하다(원칙 4). 문구가 `을/를` 조사를 피하는 이유: 핸들은 임의의 라틴 문자열이라 받침 유무가 정해지지 않아 어떤 조사도 항상 맞을 수 없다.
  - 서버가 `getUserInfo`로 정본 표기를 확정하므로, `x.com/HadaKan__`을 넣으면 화면 피드백·자동 제목은 사용자 표기(`@HadaKan__`)이고 저장되는 `handle`은 정본(`hadakan__`)일 수 있다. 원칙 4는 클라이언트 렌더 내부에서 보장되고, 서버 정본화는 그 뒤에 온다.
- **타이핑 중 오류는 띄우지 않는다.** `ok:false`면 아무것도 표시하지 않는다. `https://x`까지 쳤을 때 빨간 글씨가 뜨는 건 사용자 잘못이 아니다. 진짜 판정은 `만들기` 시점.
- **입력이 바뀌면 지난 오류를 지운다.** 안 지우면 실패 후 올바른 링크를 붙여넣었을 때 초록 `✓`와 빨간 오류가 같은 화면에 동시에 남는다 — 원칙 4가 금지하는 모순이라 표시가 아니라 로직에서 막는다(`onChange`에서 `setErr('')`).
- 성공 문구는 붙여넣기 직후 동적으로 나타나므로 `aria-live="polite"`를 둔다. (모달 전체의 `label`↔`id` 연결 누락은 이 기능 이전부터 있는 별개 과제로 남긴다.)
- **`만들기`/`저장`**: `parseXHandle` 실패면 `setErr(handleParseMessage(reason))`로 기존 오류 영역에 표시하고 요청을 보내지 않는다. 성공이면 정규화된 핸들을 `config.handle`로 보낸다.
- **자동 컬럼 이름**: `@${parsed.handle}`. 링크를 붙여넣어도 `@hadakan__`이 된다(현재는 링크 전체가 이름에 박힌다).
- 편집 모달도 같은 컴포넌트라 자동 적용된다.

`kind === 'search'` 분기와 필터·고급 섹션은 손대지 않는다.

---

## 테스트

- `src/lib/xHandle.test.ts` (신규, `node:test`) — A의 판정표 전체. 예약 경로·서브도메인·쿼리스트링·핸들 길이 경계(1자/15자/16자)를 각각 케이스로 둔다.
- **호스트 허용 목록은 별도 케이스로 못박는다.** 구현은 허용 접두어를 뗀 뒤 `Set`으로 **정확히** 비교한다. 이걸 `endsWith`/`includes`로 바꾸거나 접두어를 늘리면 `x.com.evil.com` 같은 호스트가 조용히 통과한다 — 테스트가 없으면 리팩터링이 보안 성질을 소리 없이 깬다.
- 서버 라우트에는 현재 테스트 파일이 없다. 라우트 로직은 `parseXHandle` 호출 + 기존 분기이므로 순수 함수 테스트로 덮고, 라우트 테스트 하네스는 이번에 만들지 않는다(범위 확장).
- 수동 확인: 프로필 링크·트윗 링크·`@핸들`로 각각 컬럼 생성 → 저장된 제목이 `@핸들`이고 트윗이 수집되는지. `x.com/i/status/…`로 만들기 → 400 문구 확인.

## 하지 않는 것

- 숫자 ID(`/i/user/<id>`) 역조회 — `getUserInfoById` 경로가 추가로 필요하고 실사용 빈도가 낮다.
- 트윗 링크에서 작성자를 **API로** 알아내기(`x.com/i/status/…`) — 콜 1회 추가. 경로에 핸들이 있는 트윗 링크는 이미 무료로 처리된다.
- 키워드 컬럼 입력 변경.
- 링크 여러 개 붙여넣어 계정 여러 개 한꺼번에 추가.
