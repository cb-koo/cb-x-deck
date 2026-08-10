# /generate 필터 확장 + 검색 구현 계획 (워크벤치 6차)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결과 영역에 검색(제목·대역·원문·방향성) + 시술·기간 필터를 추가하고, 칸반·테이블·카드 세 뷰와 T11(생성 결과 가시성)에 일관 적용. 스펙: `docs/superpowers/specs/2026-08-10-generate-filters-search-design.md`

**Architecture:** 순수 프론트엔드. 필터링은 draftViews의 순수 함수 4개(테스트 대상), page.tsx가 파생 체인(clientScoped → scoped → visibleDrafts)과 헤더 컨트롤을 배선. 서버·컴포넌트(DraftFilterBar·DraftTable·DraftKanban·DraftCard) 무변경.

## Global Constraints

- 신규 3축(검색·시술·기간)은 세션 렌즈 — 저장 금지(기존 필터 정책).
- 라벨-값 일치: 상태 탭 건수는 scoped 기준으로 변경 / 시술 옵션은 실제 존재하는 시술만 / 선택 시술이 옵션에서 사라지면 자동 리셋.
- 검증: tsc 0 / lint 24 기준선 / 신규 테스트는 T1 순수 함수만. 작업자 커밋 금지. 주석 한국어.
- 순차: T1 → T2.

---

### Task 1: 순수 함수 4개 + 테스트 — 권장 모델: haiku

**Files:**
- Modify: `src/lib/draftViews.ts`, `src/lib/draftViews.test.ts`

**Interfaces:**
- Produces: `searchDrafts(list, query)`, `filterByProcedure(list, name)`, `filterByPeriod(list, period, now)`, `procedureOptions(list)`, `type Period`.

- [ ] **Step 1: 실패하는 테스트 작성** — draftViews.test.ts에 추가

```ts
test('searchDrafts: 빈 질의는 전체, 토큰 AND, 대소문자 무시, 4개 필드 대상', () => {
  const d = (over: object) => ({ koTitle: null, koLatest: null, direction: '', content: { posts: [{ text: '' }] }, edited: null, ...over });
  const list = [
    d({ koTitle: '다운타임 후기형' }),
    d({ koLatest: ['가격 비교 정리'] }),
    d({ content: { posts: [{ text: 'ダウンタイム' }] } }),
    d({ direction: '여름 시즌 Lifting' }),
  ];
  assert.equal(searchDrafts(list, '').length, 4);
  assert.equal(searchDrafts(list, '  ').length, 4);
  assert.deepEqual(searchDrafts(list, '다운타임'), [list[0]]);
  assert.deepEqual(searchDrafts(list, '가격 정리'), [list[1]]);      // 토큰 AND
  assert.deepEqual(searchDrafts(list, 'ダウン'), [list[2]]);
  assert.deepEqual(searchDrafts(list, 'lifting'), [list[3]]);        // 대소문자 무시
  assert.equal(searchDrafts(list, '가격 후기형').length, 0);         // 서로 다른 항목에 분산되면 미매치
});

test('searchDrafts: 편집본이 있으면 편집본 기준', () => {
  const x = { koTitle: null, koLatest: null, direction: '',
    content: { posts: [{ text: '원문에만 있는말' }] }, edited: { posts: [{ text: '편집본' }] } };
  assert.equal(searchDrafts([x], '원문에만').length, 0);
  assert.equal(searchDrafts([x], '편집본').length, 1);
});

test('filterByProcedure: 빈 이름은 전체, 지정 시 포함 항목만', () => {
  const a = { procedureNames: ['리프팅', '보톡스'] }, b = { procedureNames: [] };
  assert.equal(filterByProcedure([a, b], '').length, 2);
  assert.deepEqual(filterByProcedure([a, b], '리프팅'), [a]);
});

test('filterByPeriod: 자정·N일 경계', () => {
  const now = Date.parse('2026-08-10T15:00:00+09:00');
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const mk = (t: number) => ({ createdAt: new Date(t).toISOString() });
  const justBefore = mk(midnight.getTime() - 60_000), justAfter = mk(midnight.getTime() + 60_000);
  assert.deepEqual(filterByPeriod([justBefore, justAfter], 'today', now), [justAfter]);
  const eightDays = mk(now - 8 * 86_400_000), sixDays = mk(now - 6 * 86_400_000);
  assert.deepEqual(filterByPeriod([eightDays, sixDays], '7d', now), [sixDays]);
  assert.equal(filterByPeriod([eightDays, sixDays], 'all', now).length, 2);
});

test('procedureOptions: 유니크·가나다 정렬', () => {
  assert.deepEqual(procedureOptions([
    { procedureNames: ['보톡스', '리프팅'] }, { procedureNames: ['리프팅', '가슴성형'] },
  ]), ['가슴성형', '리프팅', '보톡스']);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --import tsx --test src/lib/draftViews.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — draftViews.ts에 추가

```ts
// 검색 — 공백 분리 토큰 전부(AND)가 제목·대역·원문(최신 버전)·방향성 중 어딘가에 포함(대소문자 무시)
export function searchDrafts<T extends {
  koTitle: string | null; koLatest: string[] | null; direction: string;
  content: PreviewSource; edited: PreviewSource | null;
}>(list: T[], query: string): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return list;
  return list.filter((d) => {
    const hay = [
      d.koTitle ?? '', ...(d.koLatest ?? []),
      ...(d.edited ?? d.content).posts.map((p) => p.text),
      d.direction,
    ].join('\n').toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

export function filterByProcedure<T extends { procedureNames: string[] }>(list: T[], name: string): T[] {
  return name ? list.filter((d) => d.procedureNames.includes(name)) : list;
}

export type Period = 'all' | 'today' | '7d' | '30d';

// now를 인자로 받아 순수 유지. 'today'는 로컬 자정 기준(사용자 시간대 = 서울 운영 전제, relTime 관례)
export function filterByPeriod<T extends { createdAt: string }>(list: T[], period: Period, now: number): T[] {
  if (period === 'all') return list;
  let start: number;
  if (period === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); start = d.getTime(); }
  else start = now - (period === '7d' ? 7 : 30) * 86_400_000;
  return list.filter((x) => Date.parse(x.createdAt) >= start);
}

// 시술 필터 옵션 — 실제 존재하는 시술만(거짓 어포던스 방지), 유니크·가나다
export function procedureOptions(list: Array<{ procedureNames: string[] }>): string[] {
  return [...new Set(list.flatMap((d) => d.procedureNames))].sort((a, b) => a.localeCompare(b, 'ko'));
}
```

- [ ] **Step 4: 통과 확인** — Run: `node --import tsx --test src/lib/draftViews.test.ts` / Expected: PASS (기존 포함 전부)
- [ ] **Step 5: 정적 검증** — `npx tsc --noEmit && npx eslint src/lib/draftViews.ts src/lib/draftViews.test.ts` 0건. (커밋 금지)

---

### Task 2: page.tsx 배선 — 상태·파생 체인·헤더 컨트롤·T11 확장 — 권장 모델: sonnet

**Files:**
- Modify: `src/app/generate/page.tsx`

**Interfaces:**
- Consumes: T1의 4개 함수 + `Period`.

- [ ] **Step 1: 상태·파생**

import에 `searchDrafts, filterByProcedure, filterByPeriod, procedureOptions, type Period` 추가(draftViews). 상태(기존 filter 옆):

```tsx
  // 신규 렌즈 3축 — 기존 필터와 동일하게 세션 한정(저장 안 함) (6차 스펙)
  const [query, setQuery] = useState('');
  const [procFilter, setProcFilter] = useState(''); // 시술명, '' = 전체
  const [period, setPeriod] = useState<Period>('all');
```

파생 체인 교체 — 기존 `visibleDrafts`·`counts` 계산을 다음으로:

```tsx
  // 클라이언트 → (시술·기간·검색) → 상태 탭 순으로 좁힌다. 칸반은 상태만 무시하므로 scoped를 쓴다.
  const scoped = useMemo(
    () => filterByPeriod(filterByProcedure(searchDrafts(clientScoped, query), procFilter), period, Date.now()),
    [clientScoped, query, procFilter, period]);
  const visibleDrafts = useMemo(
    () => filterDrafts(scoped, { status: filter.status, clientId: '' }), [scoped, filter.status]);
  const counts = useMemo(() => statusCounts(scoped), [scoped]); // 탭 건수도 검색·필터 반영(라벨-값 일치)
  const procOptions = useMemo(() => procedureOptions(clientScoped), [clientScoped]);
  // 클라이언트 전환 등으로 선택 시술이 옵션에서 사라지면 리셋 — 유령 필터 방지
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 옵션-선택 정합 유지(파생 리셋), 조건부 1회
    if (procFilter && !procOptions.includes(procFilter)) setProcFilter('');
  }, [procOptions, procFilter]);
```

(위 eslint-disable은 실제로 룰이 걸리는 경우에만 남겨라 — 안 걸리면 넣지 않는다. 4차 T4에서 무효 disable이 기준선을 깨뜨린 선례가 있다.)

- [ ] **Step 2: T11 리셋을 전체 렌즈로 확장**

lensRef 미러 + 헬퍼 추가(draftsRef 선례):

```tsx
  // 생성 완료 시점의 최신 렌즈로 판정 — 생성 대기 중 필터를 바꿔도 낡은 클로저를 쓰지 않는다 (draftsRef와 같은 관례)
  const lensRef = useRef({ filter, query, procFilter, period });
  useEffect(() => { lensRef.current = { filter, query, procFilter, period }; });
  // 새 초안이 현재 렌즈(상태·클라이언트·검색·시술·기간)에 가려 있으면 전부 리셋 — T11의 6차 확장
  const revealIfHidden = useCallback((created: DraftRow[]) => {
    const L = lensRef.current;
    const visible = filterByPeriod(
      filterByProcedure(searchDrafts(filterDrafts(created, L.filter), L.query), L.procFilter),
      L.period, Date.now()).length > 0;
    if (!visible) {
      setFilter({ status: 'all', clientId: '' });
      setQuery(''); setProcFilter(''); setPeriod('all');
    }
  }, []);
```

기존 T11 두 곳을 교체:
- `generate()`의 `setFilter((f) => (filterDrafts(created, f).length > 0 ? f : {...}))` → `revealIfHidden(created);`
- `cancelGenerate()` 폴링 성공 분기의 동일 패턴 → `revealIfHidden(fresh);`
(기존 주석은 "렌즈 전체 리셋 — T11의 6차 확장" 취지로 갱신. 그 외 함수 본문은 무변경.)

- [ ] **Step 3: 헤더에 검색·시술·기간 컨트롤**

DraftFilterBar를 감싼 `min-w-0 flex-1` 래퍼 안, DraftFilterBar 아래에 둘째 행 추가:

```tsx
            <div className="min-w-0 flex-1">
              <DraftFilterBar ... 기존 그대로 ... />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-caption">
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                       placeholder="제목·내용·방향성 검색" aria-label="초안 검색"
                       className="w-48 rounded-md border border-x-border-strong bg-white px-2 py-1 outline-none focus:border-x-blue" />
                <select value={procFilter} onChange={(e) => setProcFilter(e.target.value)} aria-label="시술로 거르기"
                        className="rounded-md border border-x-border-strong bg-white px-2 py-1 outline-none focus:border-x-blue">
                  <option value="">모든 시술</option>
                  {procOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="기간으로 거르기"
                        className="rounded-md border border-x-border-strong bg-white px-2 py-1 outline-none focus:border-x-blue">
                  <option value="all">전체 기간</option>
                  <option value="today">오늘</option>
                  <option value="7d">최근 7일</option>
                  <option value="30d">최근 30일</option>
                </select>
              </div>
            </div>
```

- [ ] **Step 4: 뷰 배선·문구**

- 칸반: `drafts={clientScoped}` → `drafts={scoped}`, 빈 상태 판정 `clientScoped.length === 0` → `scoped.length === 0`.
- 필터 빈 상태 문구: "…탭이나 클라이언트 필터를 바꿔보세요" → "…필터나 검색어를 바꿔보세요".

- [ ] **Step 5: 정적 검증** — `npx tsc --noEmit && npm run lint` → 0건 / 24 기준선.
- [ ] **Step 6: 스모크** — 포트 3000에 `curl -s -o /dev/null -w "%{http_code}"` → 307/200. (지금 프로덕션 모드 서버가 떠 있으면 재빌드 없이 응답만 확인하고, 화면 반영은 조율자가 처리한다고 보고에 명시)

---

## 실행 순서

| Wave | Task | 모델 |
|---|---|---|
| 1 | T1 순수 함수+테스트 | haiku |
| 2 | T2 page 배선 | sonnet |

마감: 통합 리뷰 1회(sonnet — 이번 라운드는 순수 프론트 2커밋이라 태스크 리뷰 겸 최종 리뷰) + 전체 `npm test` 회귀 + 조율자 diff 검수.
