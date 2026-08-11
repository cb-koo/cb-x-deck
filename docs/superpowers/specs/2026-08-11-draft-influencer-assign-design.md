# 원고에 인플루언서 배정 — 핸들 한 칸 (설계)

2026-08-11.

**배경.** 초안의 상태 축에는 이미 `delivered = '인플루언서 전달됨'`이 있다(`migrations/016_draft_status.sql`). "어디까지 진행됐나"는 기록되는데 **"누구에게"가 없다.** 담당자는 원고를 만들어 인플루언서에게 보내지만, 그 배정은 도구 밖(메신저·스프레드시트)에 남는다. 카드·테이블·칸반 어디를 봐도 이 원고가 누구 몫인지 알 수 없다.

한편 앞으로 **인플루언서 관리 기능**이 별도로 들어온다 — 협업 중인 인플루언서 목록과, 그들과 협업한 콘텐츠를 관리하는 기능이다(아직 기획 단계). 그때 이 필드는 자유 입력이 아니라 **등록된 인플루언서를 검색해 고르는** 입력이 된다.

**해결.** 초안에 **X 핸들 한 칸**을 붙인다. 핸들은 전역 유일한 자연키라, 나중에 인플루언서 테이블이 생겼을 때 사람 판단 없이 기계적으로 연결된다. 오늘 담당자가 입력하는 값이 그대로 미래 인플루언서 DB의 시드가 된다.

## 원칙

- **식별자는 X 핸들.** 이 제품의 인플루언서는 정의상 X 계정을 가진다(편집창이 이미 "인플루언서가 자기 계정으로 게시합니다"라고 안내한다). 이름으로 저장하면 담당자마다 "하다칸"·"하다칸(본계정)"으로 갈라져 나중에 사람이 눈으로 짝지어야 한다 — 그 작업을 원천적으로 없앤다.
- **사용자가 가진 것을 받는다.** 핸들이든 프로필 링크든 트윗 링크든 같은 칸에 넣는다. `parseXHandle`(`src/lib/xHandle.ts`)을 그대로 재사용한다 — 규칙이 이미 한 곳에 있고, 오류 문구도 그 파일이 소유한다.
- **비용 유발 호출은 하지 않는다.** 계정 실재 확인(`getUserInfo`)은 유료다. 배정할 때마다 낼 비용이 아니라, 나중에 인플루언서를 **등록**하는 시점에 한 번 낼 비용이다. 이번엔 형식 검증만 한다.
- **없는 데이터는 자리도 안 만든다.** 미배정 초안의 카드·칸반에는 아무것도 그리지 않는다(DraftCard의 기존 원칙). 표에서만 열 정합을 위해 `—`를 쓴다.
- **어포던스는 실제 동작과 일치시킨다.** 지금 자동완성은 "등록된 목록"이 아니라 "이미 배정한 적 있는 계정"이다. 도움말이 그렇게 말한다 — 목록에서 고르는 것처럼 보이게 하지 않는다.
- **교체 지점을 최소한으로 가둔다.** 인플루언서 목록 DB가 생겼을 때 바뀌는 건 딱 둘이다 — 옵션을 어디서 읽는가(`/api/drafts/influencers` 라우트 내부)와 어떤 위젯으로 고르는가(`InfluencerField.tsx` 내부). 마이그레이션·저장 형식·API 응답 형태·호출부는 그대로 간다.

---

## 확정 판단

**배정 단위는 시안 하나(draft 행)다.** 다중 시안 A·B·C가 같은 `batch_id`를 공유해도 배정은 행별로 한다. 셋 다 배정하면 "이 사람에게 원고 3개를 줬다"가 되어 사실과 어긋난다 — 실제로는 그중 하나를 골라 전달한다. 상태(`status`)도 이미 행 단위이므로 같은 층위다.

**한 원고에 인플루언서는 한 명이다.** 같은 원고를 여러 계정이 올리는 것은 X에서 중복 게시로 취급된다. 정말 필요해지면 연결 테이블로 확장하고 이 컬럼은 "주 배정"으로 남긴다 — 지금 다대다를 깔면 쓰지 않을 복잡도만 진다.

---

## A. `migrations/023_draft_influencer.sql`

```sql
-- 023: 원고에 인플루언서 배정 — X 핸들이 식별자(전역 유일한 자연키).
-- null = 미배정. 향후 influencer 테이블이 생기면 이 값이 조인 키이자 스냅샷으로 남는다
-- (client_id + client_name 선례 — 엔티티가 지워져도 지난 원고의 배정 이력이 재현된다).
alter table draft add column if not exists influencer_handle text;
create index if not exists idx_draft_influencer on draft (influencer_handle);
```

**이름 컬럼은 두지 않는다.** 핸들이 곧 표시명이고, 이름을 따로 받으면 실제 계정명과 어긋난다. 표시명은 나중에 인플루언서 엔티티가 소유할 값이다.

**저장 형태.** `parseXHandle`이 돌려준 핸들을 `@` 없이, 사용자가 친 **대소문자 그대로** 저장한다. 비교·중복 제거는 소문자 기준이다 — X 핸들은 대소문자를 구분하지 않으므로 `Hadakan__`과 `hadakan__`이 두 사람으로 갈라지면 안 된다.

## B. `src/lib/draftStore.ts` — 저장 계층

`DraftRow`에 `influencerHandle: string | null`, `Row`에 `influencer_handle`, `SELECT`에 컬럼, `toRow`에 매핑을 더한다.

`updateDraft`의 patch에 `influencerHandle?: string | null`을 더한다. **기존 `coalesce` 패턴을 쓸 수 없다** — `coalesce`는 "null이면 기존값 유지"라서 배정 해제(null 저장)를 표현할 방법이 없다. 이 컬럼만 `case when`을 쓴다:

```sql
influencer_handle = case when ${patch.influencerHandle !== undefined}
                      then ${patch.influencerHandle ?? null}::text
                      else influencer_handle end
```

`undefined` = 건드리지 않음, `null` = 배정 해제, 문자열 = 배정. `::text` 캐스트는 파라미터 타입 추론을 명시하기 위한 것이다.

`insertDraft`는 손대지 않는다 — 생성 시점에는 배정하지 않는다(원고를 만든 다음 누구에게 줄지 정하는 순서).

## C. 옵션 목록 — 서버가 소유한다

```ts
// src/lib/draftTypes.ts — 클라이언트·서버 공용 타입
export interface InfluencerOption { handle: string; name?: string }
```

옵션 타입을 문자열이 아니라 객체로 두는 이유는 하나다. 나중에 목록이 `하다칸 (@hadakan__)`처럼 이름을 병기하게 될 때 **타입도 호출부도 바뀌지 않게** 하기 위해서다. `name`은 지금 항상 비어 있고, 인플루언서 목록 DB가 생기면 그쪽이 채운다.

```ts
// src/lib/draftStore.ts — 배정된 적 있는 핸들 전체. 소문자 기준 중복 제거, 대표 표기는 최신 것.
export async function listInfluencerHandles(sql: postgres.Sql): Promise<InfluencerOption[]>;
```

```sql
select distinct on (lower(influencer_handle)) influencer_handle
  from draft
 where influencer_handle is not null
 order by lower(influencer_handle), created_at desc
```

**화면에 로드된 초안에서 파생하지 않는다.** `/api/drafts`는 최근 50건만 돌려주므로(`listDrafts`의 기본 limit), 51번째 이전에 배정된 인플루언서는 후보에서 사라진다. 담당자는 기억으로 다시 타이핑하게 되고, 그게 정확히 이 기능이 막으려던 표기 분화다 — 자동완성이 불완전하면 자동완성이 없느니만 못하다.

**대표 표기는 최신 것을 쓴다.** 같은 사람을 `Hadakan__`으로 적었다가 나중에 `hadakan__`으로 적었다면 최근 표기가 현재 습관에 가깝다.

이 쿼리가 **미래 인플루언서 목록의 씨앗**이다. 파생값이라 자정 능력이 있다 — 오타로 들어간 핸들도 그 초안이 지워지면 후보에서 함께 사라진다. 별도 레지스트리 테이블을 지금 만들면 이 성질을 잃고 정리 UI가 필요해진다.

## C-2. `src/app/api/drafts/influencers/route.ts` (신규)

`GET` → `InfluencerOption[]`. `requireAllowedUser` 게이트(읽기 전용이므로 `/api/drafts` GET과 동일 등급), 얇은 라우트 — 로직은 저장 계층에 있다.

**이 라우트가 미래의 교체 지점이다.** 인플루언서 목록 DB가 생기면 이 파일 안에서 조회 대상이 `draft`에서 `influencer` 테이블로 바뀐다. URL도, 응답 형태도, 호출부도 그대로다.

## D. `src/components/InfluencerField.tsx` — 입력 필드 (신규)

```tsx
export function InfluencerField({ value, options, onChange, error, autoFocus, onEnter }: {
  value: string;                    // 핸들('@' 없음), '' = 미배정
  options: InfluencerOption[];
  onChange: (v: string) => void;
  error: string | null;
  autoFocus?: boolean;              // 이 칸 하나만 있는 자리(팝오버)에서
  onEnter?: (current: string) => void;  // 저장 버튼이 손에서 먼 자리에서. IME 조합 중 Enter는 무시
}): JSX.Element;
```

`onEnter`는 state가 아니라 **입력칸의 현재 값**을 넘긴다 — `datalist` 제안을 Enter로 고른 직후에는 React state가 아직 그 값이 아니라서, state를 쓰면 타이핑하던 중간 문자열이 저장된다.

**출처를 모른다.** 옵션을 prop으로만 받으므로, 나중에 `/api/influencers`에서 오든 초안에서 파생되든 이 컴포넌트는 그대로다. 어느 자리(팝오버·모달·페이지)에 놓일지도 모른다 — 자체 패딩·구분선을 갖지 않고 감싸는 쪽이 컨테이너를 담당한다.

| 요소 | 내용 |
|---|---|
| 라벨 | `게시할 인플루언서` |
| placeholder | `@핸들 또는 프로필 링크 붙여넣기` |
| 도움말 | `X 프로필 주소를 그대로 붙여넣어도 돼요 — 이미 배정한 적 있는 계정이 아래에 제안됩니다` |
| 자동완성 | `<datalist>` — 입력하면 후보가 좁혀진다. 목록에 없는 값도 자유 입력 허용 |
| 오류 | `handleParseMessage(reason)` 문구를 그대로 표시 |

**지금 `datalist`인 이유.** 옵션이 핸들 문자열뿐이라 커스텀 선택창이 보여줄 추가 정보(이름·등록 여부·프로필 이미지)가 하나도 없다. 그 값어치가 전부 미래에 있으므로 지금 만들면 절반이 빈 코드가 된다. `datalist`로도 "타이핑해서 후보 좁혀 고르기"는 이미 동작한다.

## E. `src/components/InfluencerChip.tsx` — 입력 지점 (신규)

> **1차 구현 후 방향 수정.** 처음에는 편집 모달 안에 입력 칸을 뒀는데, 실사용 확인에서 "편집 버튼 누르고 들어가면 단계가 너무 많다"는 피드백이 나왔다. 배정은 원고를 정독하는 일이 아니라 훑다가 찍는 일이라 모달이 과했다. **입력 지점을 초안 카드로 옮기고 모달에서는 제거한다** — 값을 고치는 곳이 하나여야 저장 경로도 하나다. AGENTS.md 원칙 6("반복 마찰이 실사용 피드백으로 확인되면 자동화/승격을 검토")의 적용 사례다.

카드 상단 도구층 스트립에서 상태 칩 옆에 놓이는 칩이다. 클릭하면 `InfluencerField`를 담은 작은 팝오버가 열린다.

```tsx
export function InfluencerChip({ handle, options, onChange }: {
  handle: string | null;                     // null = 미배정
  options: InfluencerOption[];
  onChange: (next: string | null) => void;   // 정규화된 핸들, 또는 null(배정 해제)
}): JSX.Element;
```

**검증은 칩이 진다.** `onChange`는 `parseXHandle`을 통과한 값으로 저장을 눌렀을 때만 불린다. 부모는 상태 칩과 똑같이 "받은 값을 낙관적으로 반영"만 하면 된다.

| 상태 | 표시 |
|---|---|
| 배정됨 | `@hadakan__ ⌄` — 중립 채움(`bg-x-text/5`). 의미색은 상태 칩이 독점한다 |
| 미배정 | `+ 인플루언서` — 채움 없는 낮은 대비. 배정된 카드가 먼저 눈에 들어와야 한다 |

미배정 표시는 "없는 데이터"가 아니라 **행동 손잡이**라서 자리를 만든다 — 상태 칩이 늘 그 자리에 있는 것과 같다. 다만 조용해야 한다.

**팝오버 동작.** 열 때 현재 값으로 시작하고 입력칸에 포커스한다. Esc·바깥 클릭으로 닫고, 입력칸 Enter로도 저장한다. **IME 조합 중 Esc/Enter는 무시한다** — 한국어·일본어 조합 확정이 저장이나 닫기로 새면 안 된다.

- **빈 값은 오류가 아니라 배정 해제다.** `parseXHandle('')`은 `empty` 오류를 돌려주므로 빈 값은 파서를 부르기 전에 `null`로 확정한다.
- 별도 '배정 해제' 버튼을 두지 않는다. 칸이 비면 저장 버튼 캡션이 `배정 해제`로 바뀌고, 칸이 차 있을 땐 "칸을 비우고 저장하면 배정이 해제돼요" 한 줄이 뜬다 — 둘이 동시에 나오지 않게 해서 시끄러워지지 않는다.
- 파싱 실패면 닫지 않고 `handleParseMessage(reason)`를 표시한다(거짓 성공 방지). 값을 고치기 시작하면 지운다.
- 바뀐 게 없으면 `onChange`를 부르지 않는다 — 같은 값으로 PATCH를 한 번 더 보낼 이유가 없다.

**팝오버는 `document.body`로 포털한다.** 카드 루트가 `overflow-hidden`이라 짧은 카드에서 잘리고, 이 카드는 테이블·칸반에서 클릭했을 때 peek 오버레이(`z-40`, 자체 스택 컨텍스트) 안에서도 뜬다. 포털 + `position: fixed` + 칩 좌표 추적이 두 문제를 한 번에 없앤다. 파생되는 세 가지를 함께 막는다 — 팝오버 안 클릭이 오버레이 배경 클릭으로 새지 않게 `stopPropagation`, Esc 한 번에 팝오버와 상세가 같이 닫히지 않게 **capture 단계**에서 가로채기, 오버레이 스크롤 시 앵커가 어긋나지 않게 `scroll`(capture)·`resize` 재계산.

## E-2. `src/components/DraftEditModal.tsx`

**인플루언서 칸을 두지 않는다.** 배정하는 곳은 카드 하나다. 두 곳에 두면 같은 값을 고치는 저장 경로가 둘이 되고, 모달 쪽은 본문 dirty 판정과 얽혀 복잡해진다.

## F. 표시 3곳

배정 **입력**은 카드에서만 하고, 테이블·칸반은 **표시**만 한다. 다만 두 뷰 모두 항목을 클릭하면 peek 오버레이로 카드가 뜨므로, **세 뷰 전부 한 번의 클릭으로 배정에 닿는다.**

세 뷰 모두 `@핸들`로 표기하되 각 뷰가 이미 쓰는 시각 문법을 따른다.

**`DraftCard`** — 상단 도구층 스트립에서 **상태 칩과 시안 라벨 사이**에 `InfluencerChip`. 미배정이면 조용한 `+ 인플루언서` 손잡이가 보인다(E 참조).

**`DraftKanban`** — 카드 하단 속성 칩 줄, 클라이언트 칩 다음. 그 줄에 이미 파랑 채움(클라이언트)과 테두리 알약(시술·형식)이 있으므로 **중립 회색 채움 칩**(`bg-x-text/5`)을 써서 둘 다와 구분한다. 미배정이면 칩 없음.

**`DraftTable`** — `클라이언트` 다음에 `인플루언서` 열을 넣는다. 둘 다 "누구" 축이라 붙여두면 훑기 좋다. 시술·형식과 같은 비정렬 열이고, 미배정은 `—`.

## G. `src/app/generate/page.tsx` — 배선

마운트 시 `/api/drafts/influencers`를 기존 `Promise.all`에 얹어 받아 `influencerOptions` 상태에 담고, **`DraftCard`를 렌더하는 두 곳(목록과 peek 오버레이) 모두**에 넘긴다.

저장은 `changeStatus`와 같은 **낙관적 갱신 + 실패 롤백**이다. 롤백 조건도 동일하게 "이 요청이 세팅한 값이 아직 표시 중일 때만" — 연속 변경 시 뒤 갱신을 덮지 않기 위해서다.

**실패해도 필드는 계속 쓸 수 있어야 한다.** 목록 조회가 실패하면 옵션을 빈 배열로 두고 토스트도 띄우지 않는다 — 자동완성은 편의이고, 자유 입력이라는 본 기능은 그대로 동작한다. 쓸 수 있는 걸 못 쓰는 것처럼 보이게 만들지 않는다.

배정을 저장한 뒤에는 옵션 목록을 다시 부르지 않는다. 방금 입력한 핸들은 이미 그 사람 머릿속에 있고, 다음 마운트에서 목록에 합류한다 — 한 번의 저장마다 조회를 한 번 더 하는 값이 그만하지 않다.

`patchDraft`는 이미 임의 본문을 받으므로 그대로 쓴다.

## H. `src/app/api/drafts/[id]/route.ts` — 검증

PATCH 본문에 `influencerHandle?: string | null`을 받는다.

1. `undefined` → 건드리지 않음.
2. `null` 또는 공백뿐인 문자열 → `null`(배정 해제).
3. 그 외 → `parseXHandle`. 실패하면 `400` + `handleParseMessage(reason)`. 성공하면 반환된 핸들을 저장한다.

**신뢰 경계는 서버다.** 클라이언트 검증은 즉시 피드백용이고, 저장되는 값의 근거는 서버 정규화다 — 두 곳이 같은 함수를 쓰므로 어긋날 수 없다(`2026-07-28-influencer-column-url-input-design.md`와 같은 구조).

---

## 테스트

라우트·컴포넌트 하네스가 없는 저장소이므로 순수 함수와 저장 계층으로 커버한다.

- `draftStore.test.ts` — 배정 저장 → 조회, 배정 해제(`null`) 저장이 실제로 `null`이 되는지(`coalesce`를 안 쓴 이유가 여기서 검증된다), `undefined`가 기존값을 보존하는지.
- `draftStore.test.ts` — `listInfluencerHandles`: 대소문자만 다른 같은 핸들이 하나로 합쳐지는지, 대표 표기가 최신 것인지, 미배정(`null`)이 빠지는지, 소문자 기준 정렬인지.
- `xHandle.test.ts`는 이미 있으므로 파싱은 추가 테스트 없이 재사용한다.

## 향후 확장

**인플루언서 목록 DB가 생기면.** `influencer` 테이블(`handle` unique)을 만들고, 아래 한 줄로 초기 목록을 뽑는다 — 사람 판단이 들어가지 않는다.

```sql
select distinct influencer_handle from draft
 where influencer_handle is not null
   and lower(influencer_handle) not in (select lower(handle) from influencer);
```

그다음 `draft.influencer_id`를 더해 핸들 조인으로 채우고, `influencer_handle`은 `client_name`과 같은 **스냅샷**으로 남긴다(엔티티가 지워져도 지난 원고의 배정 이력이 재현된다).

그다음 `/api/drafts/influencers`가 `draft` 대신 `influencer` 테이블을 읽게 바꾼다 — URL도 응답 형태도 호출부도 그대로다. UI에서는 `InfluencerField` 내부에서 `datalist`가 커스텀 선택창이 되고, 옵션에 이름이 붙고, 목록에 없는 핸들에 "아직 등록되지 않은 계정 — 새로 등록할까요?"가 생긴다. **위젯 교체를 강제하는 건 이 마지막 항목 하나뿐이다** — 이름 병기는 `datalist`도 할 수 있다. 마이그레이션·저장 형식·API 계약은 그대로다.

**인플루언서 컬럼(watchlist)과의 연결.** 덱의 인플루언서 컬럼이 이미 같은 핸들로 계정을 추적한다. "이 사람이 최근 뭘 올렸나"와 "이 사람에게 어떤 원고를 줬나"가 별도 매핑 없이 이어진다.

**게시 결과 연결(이번 범위 아님).** "협업한 콘텐츠 관리"를 끝까지 밀면 "이 원고가 실제로 올라간 트윗"과 그 성과가 필요해진다. 원고에 게시 결과 링크를 붙이는 별도 필드가 될 것이고, 지금 구조가 그것을 막지 않는다.

## 하지 않는 것

- **`influencer` 테이블·관리 페이지.** 관리 기능이 기획 단계라 "인플루언서 레코드에 뭐가 들어갈지"를 지금 정할 수 없다. 잘못 정한 스키마는 나중에 짐이 된다.
- **인플루언서로 거르기 필터.** `influencerOptions`가 있으므로 나중에 두 줄이다. 실사용에서 원고가 쌓인 뒤 필요해지면 넣는다.
- **계정 실재 확인 API 콜.** 위 원칙 참조.
- **테이블·칸반에서 그 자리 배정.** 두 뷰는 표시만 한다 — 항목을 클릭하면 카드가 오버레이로 떠서 거기서 배정하면 되므로, 같은 입력 UI를 세 곳에 복제할 이유가 없다. (카드에서의 직접 배정은 실사용 피드백을 받아 이번에 승격했다 — E 참조.)
- **"전달됨인데 미배정" 경고.** 상태와 배정의 정합을 강제하지 않는다 — 상태 축은 전이 제약 없는 자유 라벨로 설계돼 있고(`016`), 여기에 규칙을 넣으면 그 결정을 뒤집는 것이 된다.
