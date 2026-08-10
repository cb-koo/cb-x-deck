# /generate 필터 확장 + 검색 설계 (2026-08-10, 워크벤치 6차)

## 배경·확정 범위

초안이 쌓이면서 상태·클라이언트 외의 렌즈가 필요해짐. 사용자 확정: **① 필터 축 확장 + ② 텍스트 검색** 먼저.
- 추가 축은 **시술·기간** 2개만 — 형식(단문/스레드)·만든 사람은 효용 대비 헤더 밀도 비용이 커서 백로그(헤더 시인성은 3차에서 정리한 자산).
- 검색 대상: **제목(koTitle) · 한국어 대역(koLatest 전 포스트) · 원문(최신 버전 전 포스트) · 방향성(direction)** — 5차 제목이 검색 보조라는 설계 의도의 실현.
- 저장된 뷰(필터 조합 저장)는 다음 단계 백로그.

## 상태 모델 (page.tsx 로컬 — 전부 세션 렌즈, 저장 안 함. 기존 필터와 동일 정책)

```ts
const [query, setQuery] = useState('');
const [procFilter, setProcFilter] = useState('');                    // 시술명, '' = 전체
const [period, setPeriod] = useState<'all'|'today'|'7d'|'30d'>('all');
```

## 적용 순서와 뷰별 정합

```
drafts
 → clientScoped   (클라이언트)                       [기존]
 → scoped         (+ 시술 + 기간 + 검색)              [신규 — 칸반이 쓰는 집합]
 → visibleDrafts  (+ 상태 탭)                        [카드·테이블이 쓰는 집합]
counts = statusCounts(scoped)                        [탭 건수도 검색·필터 반영 — 라벨-값 일치]
```

- 칸반은 상태 탭만 무시(열=상태)하고 시술·기간·검색은 존중 — "칸반에서 검색이 안 먹는" 모순 방지.
- 시술 셀렉트의 옵션은 `clientScoped`의 `procedureNames` 유니크 집합(가나다 정렬) — 존재하지 않는 시술이 옵션에 뜨지 않게(거짓 어포던스 방지). 클라이언트 변경으로 현재 선택 시술이 옵션에서 사라지면 자동으로 ''로 리셋.
- 기간 기준은 `createdAt`, 라벨: 전체 기간 / 오늘 / 최근 7일 / 최근 30일. "오늘"은 로컬(서울) 자정 기준.

## 순수 함수 (draftViews.ts + 테스트)

```ts
// 공백 분리 토큰 전부(AND)가 제목·대역·원문·방향성 중 어딘가에 포함(대소문자 무시)돼야 매치
export function searchDrafts<T extends { koTitle: string|null; koLatest: string[]|null;
  direction: string; content: PreviewSource; edited: PreviewSource|null }>(list: T[], query: string): T[]

export function filterByProcedure<T extends { procedureNames: string[] }>(list: T[], name: string): T[]

export type Period = 'all' | 'today' | '7d' | '30d';
// now를 인자로 받아 순수 유지(relTime 관례). 'today'는 now의 로컬 자정, '7d'/'30d'는 now - N일
export function filterByPeriod<T extends { createdAt: string }>(list: T[], period: Period, now: number): T[]

export function procedureOptions(list: Array<{ procedureNames: string[] }>): string[] // 유니크·가나다
```

## 헤더 UI

기존 헤더 행(뷰 세그먼트 | 구분선 | 상태 탭+클라이언트)에 이어 같은 flex-wrap 행에 추가(좁으면 자연 줄바꿈):

- **검색 인풋**: `type="search"`, placeholder "제목·내용·방향성 검색", aria-label 동일, 도구층 스타일(테두리 셀렉트와 동급). 즉시 반영(버튼 없음). 내용 있을 때 ✕(브라우저 기본 clear) 활용.
- **시술 셀렉트**: 기본 옵션 "모든 시술"(클라이언트 필터와 같은 라벨 화법).
- **기간 셀렉트**: 기본 "전체 기간".
- DraftFilterBar 컴포넌트는 무변경 — 신규 컨트롤은 page가 직접 렌더(필터 축이 늘어난 것이지 상태 탭 책임이 아님).

## 기존 로직과의 상호작용

- **T11(생성 결과 가시성) 확장**: 생성 직후·취소 폴링 완성 시 "새 초안이 현재 렌즈에 가려 있으면 리셋"의 리셋 대상에 신규 3축 포함 — 상태·클라이언트만 리셋하고 검색어가 남아 새 초안이 안 보이는 구멍 방지. 판정은 전체 렌즈 합성 술어로.
- **빈 상태 문구**: "이 조건에 맞는 초안이 없어요 — 탭이나 클라이언트 필터를 바꿔보세요" → "…필터나 검색어를 바꿔보세요"로 갱신(칸반 포함, 판정 집합은 scoped/visibleDrafts 기존 구조 유지).
- 피크 오버레이·카드 점프 없음(3차 구조 그대로) — 검색 결과에서 클릭해도 피크.

## 검증

- 신규 순수 함수 4개 단위 테스트(경계: 빈 질의=전체, 다중 토큰 AND, 대소문자, 자정 경계, 옵션 유니크·정렬).
- tsc 0 / lint 24 기준선 / 전체 회귀. 화면은 사용자 dev 검수.

## 범위 제외 (백로그)

- 형식·만든 사람 필터, 저장된 뷰(필터 조합 이름 저장 — Planable Custom Views류), 서버측 검색(현 규모에선 클라이언트 필터로 충분: 목록 상한 50건)
