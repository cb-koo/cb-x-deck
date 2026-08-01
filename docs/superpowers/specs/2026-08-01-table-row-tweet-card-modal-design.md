# 표 보기 — 행 클릭으로 트윗 카드 띄우기 (설계)

2026-08-01.

**배경.** 표 보기(`2026-07-30-deck-table-view-design.md`)에서 글 하나를 제대로 읽으려면 '원문 ↗'를 눌러 X로 나가야 한다. 본문 칸은 2줄 말줄임이고 미디어·인용RT는 표에 아예 없다. 훑다가 눈에 걸린 글을 확인하려면 매번 새 탭이 열리고, 돌아오면 표의 스크롤 위치는 그대로여도 맥락은 한 번 끊긴다.

**요청.** 행을 클릭하면 그 자리에서 트윗 카드를 팝업으로 보여달라(사용자, 2026-08-01).

## 사용자가 확정한 것

| 질문 | 결정 |
|---|---|
| 팝업에서 어디까지 되나 | **읽기 + 저장(+저장 직후 메모) + 번역.** '✕ 버림'은 뺀다 |
| 행의 어느 영역을 누르면 열리나 | **행 전체.** '원문 ↗' 링크와 텍스트 드래그 선택은 예외 |
| 위·아래 행으로 연속해서 넘기기 | **안 넣는다.** 한 번에 하나만, Esc로 닫는다 |
| 하단 툴바(답글·스레드·리포스터) | **그대로 둔다.** 누를 때만 과금되고 버튼에 금액이 적혀 있다 |
| 카드 디자인 | **실제 X의 콘텐츠 카드와 동일.** 팝업 전용 레이아웃을 새로 만들지 않는다 |

## 원칙

- **표 API는 건드리지 않는다.** `/api/tweet-table`은 CSV 저장에서 최대 5,000행을 한 번에 받는 경로다. 카드에 필요한 미디어·인용RT를 여기에 얹으면 그 페이로드가 그대로 무거워진다 — `TableRow`가 `StoredTweet`을 쓰지 않는 이유 그 자체다(`types.ts:96` 주석). 필요한 데이터는 **행을 누른 순간 그 한 건만** 받는다.
- **카드는 새로 그리지 않는다.** X 미러링은 이 제품의 가치이고 `TweetCard`가 이미 그 결과물이다. 팝업은 껍데기만 제공하고 안쪽은 기존 카드를 그대로 렌더한다.
- **마우스 전용 기능을 만들지 않는다.** 행 클릭만 붙이면 키보드 사용자에게는 없는 기능이 된다(§B-2).
- **거짓 어포던스를 만들지 않는다.** 누를 수 있으면 눌러 보이게 하고, 눌러 보이는데 아무 일도 없는 자리를 남기지 않는다.

---

## A. 데이터 — 한 건만 더 받아온다

표 행(`TableRow`)에 없어서 카드를 그릴 수 없는 것: `authorAvatarUrl`, `media`, `quoted`, `tweetUrl`, `firstSeenAt`.

**A-1. `getWorkspaceTweet(sql, workspaceId, tweetId): Promise<StoredTweet | null>`** — `tweetStore.ts`에 추가.

기존 `getColumnTweets`(`tweetStore.ts:105`)의 쿼리에서 컬럼 조인만 빼고 나머지는 그대로 재사용한다:

- 인용RT 캐시 조인 `left join quoted_tweet qt on qt.id = t.quoted->>'id' and qt.status = 'ok'` — 인용RT 카드가 완전하게 렌더되려면 필요하다.
- `savedBy` 서브쿼리(`candidate` × `member`) — 카드의 ☆저장/★저장됨 상태와 다른 멤버 배지가 이 값으로 결정된다. 워크스페이스 단위라 `workspaceId`가 필요하다.
- 행 → `StoredTweet` 변환은 기존 `toStored`(`tweetStore.ts:62`)를 쓴다.
- `isNew`는 "직전 새로고침 이후 이 **컬럼**에 새로 들어옴"이라 컬럼이 없는 표에서는 의미가 없다 — 항상 `false`. 그래서 팝업 카드에는 NEW 배지가 뜨지 않는다.
- 조회 범위는 **이 워크스페이스의 컬럼에 걸린 트윗**으로 한정한다(`column_tweet` × `deck_column`). 표가 보여준 것과 같은 집합이면 충분하고, 무관한 트윗을 id만으로 꺼내주는 통로를 새로 만들지 않는다.
- `workspaceId`가 uuid 형식이 아니면 조회 없이 `null` — 같은 파일의 다른 함수들과 같은 방어(형식이 안 맞으면 postgres가 "없음"이 아니라 22P02 캐스팅 오류를 던진다).

**A-2. `GET /api/tweets/[id]?workspaceId=…`** — 신설(`src/app/api/tweets/[id]/route.ts`).

- `requireAllowedUser()` 게이트는 같은 폴더의 `[kind]/route.ts`와 동일.
- `workspaceId` 없으면 400, 못 찾으면 404, 찾으면 `{ tweet: StoredTweet }`.
- `[id]/route.ts`와 `[id]/[kind]/route.ts`는 서로 다른 세그먼트 깊이라 함께 존재해도 충돌하지 않는다.

## B. 여는 동작

### B-1. 마우스

`TweetTable.tsx`의 `<tr>`에 `onClick`과 `cursor-pointer`를 준다. hover 배경(`hover:bg-x-hover`)은 이미 있어 그대로 신호가 된다.

열지 **않는** 경우 두 가지:

1. `e.target.closest('a, button')`이 잡히면 무시 — '원문 ↗'는 지금처럼 X로 이동한다. 링크를 눌렀는데 팝업이 같이 뜨면 두 가지가 동시에 일어난 것처럼 보인다.
2. `window.getSelection()`에 선택된 글자가 있으면 무시 — 셀 값을 드래그해 복사하려던 동작이 팝업으로 끝나면 안 된다. (판정은 `mouseup` 이후인 `click` 시점이라 드래그가 끝난 상태의 선택을 본다.)

### B-2. 키보드

`<tr>`에 `tabIndex={0}`을 주고 Enter/Space로 연다. `role="button"`으로 덮어쓰지 않는다 — 행을 버튼이라고 말하면 보조기술에서 표의 행·칸 구조가 사라진다. 행은 행으로 두고 조작만 얹는다.

Space는 `preventDefault`로 페이지 스크롤을 막는다(헤더 폭 조절 손잡이가 이미 같은 처리를 한다, `TweetTable.tsx:207`).

200행이 전부 탭 정지점이 되는 건 감수한다 — 표의 행은 원래 목록의 항목이고, 건너뛰려면 표 컨테이너 밖으로 나가는 기존 흐름이 있다.

### B-3. 발견성

표 위의 안내 줄(`TweetTableView.tsx:214`, "지표는 각 글을 마지막으로 가져온 시점 기준이에요 …")에 한 문장을 더한다:

> 행을 클릭하면 글 전체를 카드로 볼 수 있어요

hover 신호만으로는 "여기 누르면 뭐가 나온다"를 미리 알 수 없다 — 행동 전에 기대를 설정한다(`AGENTS.md` 원칙 2).

## C. 팝업 카드

**`TweetCardModal.tsx`** 신설.

**껍데기.** `ColumnSettings.tsx:135`와 같은 패턴 — `fixed inset-0 z-50` + `bg-black/40` 배경, 배경 클릭으로 닫기, 안쪽은 `stopPropagation`, `role="dialog" aria-modal="true"`, Esc 닫기(IME 조합 중 Esc는 무시), 우상단 ✕.

**안쪽은 `TweetCard`를 그대로 렌더한다.** 팝업 전용 레이아웃·간격·테두리를 새로 얹지 않는다 — 카드(`<article>`)가 이미 자기 배경·여백·구분선을 들고 있고 그게 X 미러링의 결과물이다. 껍데기는 위치 잡기와 모서리 둥글리기(`overflow-hidden rounded-2xl`), 세로 넘침 처리(`max-h-[90vh] overflow-y-auto`)만 한다. 폭은 X 타임라인 카드와 같은 감각으로 `w-[560px] max-w-[92vw]`.

**넘기는 핸들러** — `TweetCard`는 핸들러를 안 주면 그 액션 버튼을 아예 그리지 않는 구조라 여기서 범위가 정해진다:

| prop | 넘기나 | 결과 |
|---|---|---|
| `onSave` / `onUnsave` / `onSaveMemo` | ○ | ☆저장 / ★저장됨, 저장 직후 인라인 메모 |
| `onTranslate` / `translation` | ○ | 🌐 번역 |
| `libraryHref` | ○ | 메모 후 "보관함에서 이어보기" |
| `meId` | ○ | 내가 저장했는지 판정 |
| `onDismiss` / `onUndismiss` | ✕ | '✕ 버림' 버튼이 렌더되지 않음 |
| `tourAnchor` | ✕ | 튜토리얼 앵커는 덱 카드 것 |

하단 툴바(`TweetExpansion` — 답글·스레드·리포스터)는 `TweetCard` 안에 항상 있고, 저장 버튼이 그 툴바의 `toolbarRight`로 들어간다. 그래서 툴바는 남는다(사용자 확정). 클릭해야만 호출되고 버튼 설명에 `1회 $0.001`이 적혀 있어 `AGENTS.md` 원칙 6을 이미 지키고 있다.

**저장 배선.** `POST /api/candidates`에 `sourceColumnId`를 보내지 않는다 — 표의 글은 특정 컬럼에서 온 게 아니다(여러 컬럼에 동시에 걸릴 수 있다). 서버는 이 값을 optional로 받는다(`api/candidates/route.ts:22`). 저장 취소는 `DELETE /api/candidates?tweetId=…&workspaceId=…`.

**저장 후 표 반영.** 덱은 저장할 때마다 컬럼 목록 전체를 다시 부르지만(`Column.tsx:186`), 표에서 그러면 200행 + 총계를 다시 받고 스크롤이 튄다. 대신 **그 행의 `savedBy`만 로컬에서 갱신**한다:

- 저장 성공 → 그 행 `savedBy`에 내 멤버(`useMember()`의 `{id, name, color}`)를 더한다 → '저장' 칸이 즉시 바뀐다.
- 저장 취소 성공 → 내 멤버를 뺀다.
- 실패 → 원래대로 되돌리고 토스트로 알린다(`useToast`는 `TweetTableView`가 이미 쓰고 있다).

같은 갱신을 모달 안의 카드도 봐야 하므로, 모달에 넘기는 트윗의 `savedBy`도 함께 갱신한다.

**번역 배선.** 덱·보관함과 같은 `useTranslations()` 훅을 `TweetTableView`에 둔다(캐시는 `tweet_id` 단위 전역이라 어느 화면에서 번역했든 재사용된다). 모달이 열릴 때 `loadCached([tweetId])`를 한 번 부른다 — LLM 호출이 없어 과금이 없고, 덱에서 이미 번역해 둔 글이면 팝업을 여는 순간 번역이 함께 보인다. 번역 버튼은 `translateOne`에 연결한다.

## D. 불러오는 중 · 실패

모달을 연 직후 조회가 끝날 때까지는 카드 자리에 "불러오는 중…"만 둔다. (표 행이 이미 들고 있는 본문으로 미리 카드를 그렸다가 나머지를 채우는 방식은 렌더 경로가 둘이 되고, 조회가 한 건이라 이득이 크지 않다 — 하지 않는다.)

| 상황 | 화면 |
|---|---|
| 조회 실패(네트워크·5xx) | 글을 불러오지 못했어요 · [다시 시도] |
| 404(그 사이 삭제·컬럼에서 빠짐) | 이 글을 찾을 수 없어요 — [원문 보기 ↗] (X 링크는 `tweetPermalink`로 만들 수 있다) |

## E. 손대는 파일

| 파일 | 내용 |
|---|---|
| `src/lib/tweetStore.ts` | `getWorkspaceTweet` 추가 |
| `src/lib/tweetStore.test.ts` | 위 함수 테스트(실 DB) — 정상 조회 / 다른 워크스페이스 / 없는 id / uuid 아닌 workspaceId |
| `src/app/api/tweets/[id]/route.ts` | 신설 |
| `src/components/TweetCardModal.tsx` | 신설 |
| `src/components/TweetTable.tsx` | 행 클릭 + 키보드 + `onRowClick` prop |
| `src/components/TweetTableView.tsx` | 모달 상태, 저장·메모·번역 배선, 행 `savedBy` 로컬 갱신, 안내 문구 한 줄 |

**검증.** `npm test`(실 DB, 약 4분)와 린트 기준선 24개 유지. 라우트·컴포넌트 하네스가 없어 자동 검증은 store 계층까지이고, 화면 확인은 OAuth 게이팅 때문에 사용자만 가능하다 — 배포 후 확인이 필요한 부분을 구현 완료 시 명시한다.

## F. 하지 않는 것

- **팝업 안에서 위·아래 행 넘기기** — 사용자가 뺐다. 필요해지면 그때 얹는다.
- **표 API에 카드 데이터 얹기** — §A 원칙.
- **'원문 ↗' 칸 변경** — 지금처럼 X로 나가는 링크로 남긴다. 팝업은 그와 별개의 길이다.
- **'✕ 버림'을 팝업에 넣기** — 표는 훑고 고르는 화면이고, 버리는 판단은 덱에서 한다.
- **`TweetCard` 구조 변경** — 하단 툴바를 숨기는 옵션을 추가하려면 저장 버튼 자리를 새로 잡아야 하고, 그건 덱 카드까지 건드린다.
