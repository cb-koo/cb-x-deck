# 링크로 트윗 추가 — 설계

2026-08-10 · 브랜치 `cb-koo/add-post-link`

## 목적

덱 수집 조건(검색 쿼리·인플루언서 컬럼)에 걸리지 않았지만 사용자가 X를 둘러보다 발견한 트윗을,
링크 복사 → 붙여넣기로 팀 보관함에 저장한다. 용도는 두 가지:

1. **발견한 좋은 글 보관** — 보관함에 팀 공유로 저장 (기존 ☆ 저장과 동일 모델)
2. **원고 생성 참고자료 투입** — 레퍼런스 선택창에서 바로 붙여넣어 즉시 선택까지

저장 모델은 기존 보관함 모델을 그대로 따른다: `library_item`(팀 소속) + `candidate`(내 저장 ★).
새 개념·새 테이블 없음.

## 진입점 (2곳, 같은 모달)

| 진입점 | 워크스페이스 결정 | 성공 후 동작 |
|---|---|---|
| 보관함 페이지 헤더 "🔗 링크로 추가" | 현재 페이지로 고정 (선택 UI 없음) | 목록 재조회 + 토스트 |
| 레퍼런스 선택창(RefPickerSheet) "링크로 추가" | 모달 내 드롭다운, 기본값 = 최근 방문 워크스페이스(`lastWsId`) | 레퍼런스 목록 재조회 + 방금 트윗 자동 선택. 이미 8건 상한이면 추가만 하고 "선택 상한이라 직접 조정해주세요" 안내 |

**충돌 회피(중요)**: 머지 대기 중인 `cb-koo/generate-workbench`는 `src/app/generate/page.tsx`를
크게 수정하지만 `RefPickerSheet.tsx`는 건드리지 않는다. 이 기능의 /generate 쪽 변경은
**RefPickerSheet.tsx 내부로 한정**하고 `generate/page.tsx`는 수정하지 않는다.

## 구성 요소

### ① 링크 파서 — `src/lib/tweetLink.ts` (신규)

`xHandle.ts` 관례(순수 함수 + 사유별 사용자 문구 함수 + 단위 테스트)를 따른다.

```ts
export type TweetLinkParse =
  | { ok: true; tweetId: string }
  | { ok: false; reason: 'empty' | 'notTweet' | 'invalid' };
export function parseTweetLink(input: string): TweetLinkParse;
export function tweetLinkParseMessage(reason): string;
```

받아주는 형태:
- `x.com/<계정>/status/<숫자ID>` — twitter.com, www/mobile/m 서브도메인 허용,
  `/photo/1`·`/video/1` 등 뒤 꼬리와 `?s=20` 등 쿼리는 무시
- `x.com/i/web/status/<숫자ID>` — X 앱 "링크 복사"가 주는 형태
- `x.com/statuses/<숫자ID>` — 레거시 영구링크

거부: 프로필 링크(=트윗 아님, `notTweet`), X 외 도메인·형식 오류(`invalid`), 빈 입력(`empty`).
오류 문구는 사용자 언어로: "트윗 주소가 아니에요 — X에서 공유 → 링크 복사한 주소를 붙여넣어주세요" 등.

### ② 서버 로직 — `src/lib/addByLink.ts` (신규) + `POST /api/library/from-link` (신규)

로직은 lib 함수로 분리해 모의 클라이언트로 테스트 가능하게 하고, 라우트는 얇게 둔다
(`resolveWatchlistAccount` 선례).

```ts
export async function addTweetByLink(
  sql, client: Pick<GetxapiClient, 'getTweetDetail'>,
  input: { url: string; workspaceId: string; memberId: string; memo?: string },
): Promise<AddByLinkResult>
```

흐름:
1. `parseTweetLink`로 ID 추출 — 실패 시 `{ error: 'parse', reason }` (라우트에서 400)
2. `getTweetDetail(tweetId)` — null(삭제·비공개·존재하지 않음)이면 `{ error: 'notFound' }` (404)
3. **리포스트 처리**: `raw.retweeted_tweet`가 있으면 원본(`retweeted_tweet`)을 대신 매핑.
   덱 수집이 순수 RT를 원본 기준으로 취급하는 정책과 일관.
4. `mapRawTweet` → null이면 `notFound`와 동일 처리
5. `upsertTweets`로 트윗 저장 (이미 있으면 최신 지표로 스냅샷 갱신 — 부수 이득)
6. 인용 트윗이 있으면 `enrichQuoted` 재사용으로 원문 1건 보강 (베스트 에포트, 실패 무시)
7. 중복 판정: `library_item`에 (workspaceId, tweetId)가 이미 있으면 `alreadyInLibrary: true`
8. `ensureLibraryItem` + `saveCandidate` (기존 POST /api/candidates와 동일 순서,
   `sourceColumnId: null`)
9. `memo`가 있으면 `setMemo` — 레퍼런스 선택창의 "메모 우선" 철학과 연결
   (메모가 원고 품질에 직접 기여)

라우트 `src/app/api/library/from-link/route.ts`:
- `requireMember()`로 인증, memberId는 서버 해석 (클라이언트 body 무시 — 기존 관례)
- body: `{ url, workspaceId, memo? }`
- 응답: 201 `{ tweetId, alreadyInLibrary }` / 400(파싱) / 404(못 찾음) / 502(GetXAPI 장애)

비용: 트윗 1건 $0.001 + 인용 있으면 $0.001. 새로고침 1회(~$0.05)의 1/50 수준이라
버튼에 비용 표기는 생략하되, 사용량 집계는 기존 `onUsage` 훅으로 자동 기록된다(추가 작업 없음).

### ③ UI — `src/components/AddByLinkModal.tsx` (신규)

기존 모달 관례(ColumnSettings): `fixed inset-0 z-50 bg-black/40` + `role="dialog"`,
배경 클릭·Esc 닫기(IME 조합 중 Esc 무시).

구성:
- 제목: "링크로 트윗 추가"
- 링크 입력창 + 기대 설정 한 줄: "X에서 공유 → 링크 복사한 주소를 붙여넣으면 팀 보관함에 저장돼요"
- 입력 중 인라인 검증 피드백 (`parseTweetLink` 파생값 — ColumnSettings 선례)
- 워크스페이스: `fixedWsId` prop이 있으면 고정 표시(보관함 진입), 없으면 드롭다운
  (RefPicker 진입, 기본값 lastWsId)
- 메모 입력 (선택): 라벨 "메모 남기기 (선택 · 이 트윗의 어떤 점이 좋았는지)" —
  TweetCard 저장 시점 캡처와 같은 위상, placeholder 예시 포함
- 추가 버튼: 진행 중 "가져오는 중…", 실패 시 서버 오류 문구를 입력 보존한 채 인라인 표시
- 성공 시: `alreadyInLibrary`면 "이미 보관함에 있어요 — 내 저장(★)으로 표시했어요" 안내,
  아니면 닫고 진입점별 후속 동작

진입점 배선:
- 보관함(`library/page.tsx`): 헤더 우측(뷰 토글 옆)에 버튼, 성공 시 `load()` + 토스트
  "보관함에 추가했어요"
- RefPickerSheet: 하단 고정 바의 "선택은 다음 생성에도 유지돼요" 자리 쪽(우측)에 버튼 —
  목록이 길어도 항상 보이는 위치. 성공 시 `/api/references`
  재조회 + `cacheRef`/`rows` 갱신 + `sel`에 추가(상한 미만일 때). **RefPickerSheet.tsx 내부에서만
  모달을 마운트**한다.

### UX 원칙 체크 (AGENTS.md)

1. 라벨은 이득 언어: "링크로 추가" (메커니즘 아님) ✓
2. 기대 설정 한 줄: 입력창 아래 도움말 ✓
3. 결과 서술: "이미 보관함에 있어요 — ★로 표시했어요" 등 판단 포함 ✓
4. 라벨·값 일치: 해당 없음
5. 기술 값 노출 최소화: 트윗 ID 노출 없음 ✓
6. 비용 유발 액션 opt-in: 버튼 클릭 자체가 opt-in, 건당 $0.001로 미미해 비용 표기 생략 ✓

## 명시적 비목표 (YAGNI)

- 개인 전용(팀 비공개) 보관함 — 기존 공유 모델 유지 결정
- 스레드 통째 가져오기 — 링크가 가리키는 트윗 1건만
- 덱 컬럼에 넣기 — 링크 추가 트윗은 보관함 소속, 덱에는 나타나지 않음
- 붙여넣기 즉시 자동 조회(입력만으로 API 콜) — 명시적 버튼 클릭으로만 (원칙 6)

## 구조적 확인 사항 (검토 완료)

- 보관함(`listLibraryTweets`)·레퍼런스(`referenceStore`)는 모두 `library_item` 기준 조회 —
  컬럼 무소속 트윗도 정상 표시된다.
- `candidate.source_column_id`는 null 허용 — 링크 추가는 null로 저장.
- 덱 표 보기의 단건 조회(`getWorkspaceTweet`)는 `column_tweet` join이지만, 링크 추가 트윗은
  덱 뷰에 나타나지 않으므로 영향 없음.
- 중복 추가는 전 구간 멱등(`on conflict`)이라 안전.

## 오류 처리

| 상황 | 처리 |
|---|---|
| 링크 형식 오류 | 클라이언트 인라인 검증(즉시) + 서버 400(이중 방어), 사유별 문구 |
| 삭제·비공개 트윗 | 404 + "삭제됐거나 볼 수 없는 트윗이에요" |
| 리포스트 링크 | 원본 트윗을 대신 저장 |
| GetXAPI 장애(재시도 소진) | 502 + "잠시 후 다시 시도해주세요", 입력 보존 |
| 이미 보관함에 있음 | 정상 처리(★ 표시 갱신) + `alreadyInLibrary` 안내 |
| 인용 보강 실패 | 무시(베스트 에포트) — 다음 덱 새로고침에서 자연 재시도 |

## 테스트

- `src/lib/tweetLink.test.ts` — 파서 단위 테스트 (`xHandle.test.ts` 관례):
  정상 3형태·꼬리·쿼리·서브도메인·프로필 링크 거부·타 도메인 거부·빈 입력
- `src/lib/addByLink.test.ts` — 모의 `getTweetDetail` + 실 DB (API 비용 0):
  정상 저장(library_item+candidate 생성)·중복(alreadyInLibrary)·RT 원본 대체·
  삭제 트윗(notFound)·메모 저장·인용 보강 호출
- 라우트/컴포넌트 하네스는 없음(기존 검증 실무) — 화면 확인은 사용자 검수로

## 구현 범위 밖 파일 (건드리지 않음)

`src/app/generate/page.tsx` (워크벤치 브랜치 충돌 회피), 덱 컬럼·수집 파이프라인 전체.
