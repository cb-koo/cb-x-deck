# 표 시간대(KST) + 컬럼 용어 통일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 표의 날짜·시각을 한국 시간으로 보여주고 필터 경계도 한국 시간 자정에 맞춘다. 그리고 표 보기만 쓰던 `열`을 제품 나머지가 쓰는 `컬럼`으로 통일하고, 애매했던 `기준` 칸 이름을 `최종 수집 시간`으로 바꾼다.

**Architecture:** 시간대는 **Asia/Seoul로 고정**한다 — 표시는 순수 함수(`ymd`/`ymdHm`)에서, 필터 경계는 SQL 조각에서. 둘이 같은 고정 시간대를 써야 "보이는 날짜"와 "걸러지는 경계"가 일치한다(브라우저 로컬 시간대를 쓰면 출장 중인 사람에게 화면과 쿼리가 갈라진다). 한국은 1988년 이후 서머타임이 없어 표시는 고정 +9시간으로 정확하다. 용어 교정은 문구만 바꾸는 작업이지만 확정 문구 10건이 테스트로 고정돼 있어 테스트도 함께 바꾼다.

**Tech Stack:** TypeScript, `postgres`(직접 SQL), `node:test` + `tsx`. **새 의존성·새 마이그레이션·새 API 없음.**

**발단:** 사용자 질문 "기준이라는 컬럼 이름이 애매해, 정확히 어떤 날짜야?" → 답하는 과정에서 UTC 표시 문제와 필터 경계 문제를 함께 발견. 실측 근거는 Global Constraints에 있다.

## Global Constraints

- **시간대는 `Asia/Seoul` 고정.** 브라우저 로컬 시간대를 쓰지 않는다 — SQL 경계가 서버에서 고정 시간대로 계산되므로, 표시가 로컬을 따르면 둘이 갈라진다.
- **실측 근거(2026-07-31, 프로덕션 DB):**
  - Postgres `timezone` = `UTC`. 그래서 `'2026-07-31'::date` = `2026-07-31T00:00:00Z` = 한국 오전 9시.
  - `('2026-07-31'::date::timestamp at time zone 'Asia/Seoul')` = `2026-07-30T15:00:00Z` = 한국 7/31 0시. **이 표현식을 쓴다.**
  - 한국시간 7/31 00:30 글: 현재 경계로는 `after 2026-07-31`에 **안 잡히고**, KST 경계로는 **잡힌다**.
  - KST는 1·7월 모두 GMT+9 — 서머타임 없음.
- **바뀌는 확정 문구**(사용자 확정, 2026-07-31):
  - 칸 이름 `기준` → **`최종 수집 시간`**
  - 칸 이름 `열` → **`컬럼명`**
  - 모든 사용자 대면 문구에서 `열` → **`컬럼`** (덱 쪽이 이미 `컬럼`을 쓴다 — `Column.tsx`에 17회)
- **바뀌지 않는 확정 문구**: `이미 모은 N건 중에서만 걸러요 (새로 가져오지 않아서 무료)` · `필터` · `＋ 조건 추가` · `필터 지우기` · `이 조건 지우기` · `이 조건 고치기` · `· 경고 N개 더` · `조건에 맞는 글이 없어요` · 연산자 라벨(`같음` `포함` `제외` `이상` `이하` `이후` `이전`) · `필터 항목` / `조건` / `값`
- **`FIELD_SPECS`는 라벨을 `TABLE_COLUMNS`에서 파생한다**(`getLabelFromTable`). 칸 이름을 바꾸면 필터 축 이름이 **자동으로** 따라온다 — 두 곳을 따로 고치려 하지 말고, 따라왔는지 확인만 한다.
- **린트 기준선 23개(에러 12 + 경고 11).** `npm run lint`는 원래 비정상 종료한다. 23에서 늘지 않는 것이 기준이다.
- **`npx tsc --noEmit`은 클린이어야 한다.**
- **DB 테스트는 실제 프로덕션 DB에 붙는다.** 접두사(`P`)로 격리하고 `finally`/`after`에서 반드시 지운다. **자기가 만들지 않은 행을 지우는 문장을 쓰지 않는다.** 실행: `node --import tsx --env-file-if-exists=.env --test <파일>`
- **DB가 필요 없는 테스트**는 `npx tsx --test <파일>`.
- **알려진 한계 — 이 계획에서 고치지 않는다(기록용).** 모순 경고(`collectionConflict.ts`)는 사용자가 넣은 날짜 문자열을 X 수집 설정의 `sinceDate`/`untilDate`와 **문자열로** 비교한다. 그 두 값은 X 검색 연산자(`since:`/`until:`)에 그대로 넘어가고 X는 UTC로 해석하는데, 이제 사용자 입력은 KST 자정을 뜻한다. 그래서 **경계에 정확히 걸친 날짜 하나에서 경고가 뜨거나 안 뜨는 판정이 하루 어긋날 수 있다.** 영향은 경고 표시뿐이고 실제 필터 결과는 T2가 정확하게 만든다. 고치려면 수집 설정의 시간대 의미를 먼저 정해야 해서(X가 무엇을 기준으로 자르는지 실측 필요) 별도 과제다. 리뷰어가 누락으로 보지 않도록 여기 적어둔다.
- **작업 에이전트는 git 명령을 실행하지 않는다.** 커밋은 오케스트레이터가 태스크당 하나씩 순차 실행한다.
- **커밋 메시지**: `<type>(x-research): <한국어 요약>`, 본문 한국어, 마지막 줄 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. 본문이 여러 줄이면 파일로 써서 `git commit -F <path>`.

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `src/lib/tableColumns.ts` | `ymd`·`ymdHm`를 KST로, 칸 이름 2개 변경 | 수정 |
| `src/lib/tableColumns.test.ts` | 위 테스트 | 수정 |
| `src/lib/tableFilter.ts` | 날짜 필터 경계를 KST 자정으로 | 수정 |
| `src/lib/tableFilter.test.ts` | SQL 조각·라벨 기대값 | 수정 |
| `src/lib/tweetStore.test.ts` | 날짜 필터 DB 테스트의 경계 | 수정 |
| `src/lib/collectionConflict.ts` | 모순 경고 문구의 `열` → `컬럼` | 수정 |
| `src/lib/collectionConflict.test.ts` | 위 기대값 10건 | 수정 |
| `src/components/ColumnPicker.tsx` | 트리거 `열:` → `컬럼:` | 수정 |
| `src/components/FilterChips.tsx` | 칩 문구·aria-label | 수정 |
| `src/components/TweetTableView.tsx` | 빈 상태·토스트·신선도 안내 | 수정 |

**의존 관계:**

```
[T1 KST 표시 + 칸 이름] → [T2 KST 필터 경계]      ─┐
[T3 경고 문구 컬럼]                                ─┼→ [T5 검증]
[T4 컴포넌트 문구 컬럼]                            ─┘
```

T1 → T2는 순차다(T2가 `tableFilter.test.ts`의 라벨 기대값을 T1의 새 이름으로 고친다). T3·T4는 서로도, T1·T2와도 독립이다.

---

### Task 1: KST 표시 + 칸 이름 2개

**Files:**
- Modify: `src/lib/tableColumns.ts`
- Modify: `src/lib/tableColumns.test.ts`

**Interfaces:**
- Produces: `TABLE_COLUMNS`의 `fetchedAt` 라벨이 `최종 수집 시간`, `columns` 라벨이 `컬럼명`. `FIELD_SPECS`(`tableFilter.ts`)가 이 라벨을 파생하므로 필터 축 이름도 함께 바뀐다.

**왜 고정 +9시간인가:** 한국은 1988년 이후 서머타임이 없어 `Asia/Seoul`은 항상 UTC+9다. `Intl.DateTimeFormat`을 쓰면 런타임 시간대 데이터에 의존하고 테스트가 환경에 흔들린다. 고정 오프셋은 순수하고 결정적이다.

**왜 `cellDisplay`와 `cellExport`를 따로 고치지 않는가:** 둘 다 같은 `ymd`/`ymdHm`를 부른다. 두 함수만 고치면 화면과 CSV가 함께 맞는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/tableColumns.test.ts`의 기존 날짜·기준 테스트를 아래로 **교체**한다(테스트 이름도 바꾼다 — 동작이 바뀌었으므로):

```ts
test('날짜는 한국 시간 기준 YYYY-MM-DD — 상대 표기(2시간 전)를 쓰지 않는다', () => {
  const date = TABLE_COLUMNS.find((c) => c.key === 'date')!;
  // 픽스처는 2026-07-11T04:05:06Z = 한국 7/11 13:05 → 같은 날
  assert.equal(cellDisplay(ROW, date), '2026-07-11');
  assert.equal(cellExport(ROW, date), '2026-07-11');
  // UTC로는 7/10인 시각이 한국에서는 7/11이다 — 여기서 두 방식이 갈린다
  const lateNight = { ...ROW, tweetCreatedAt: '2026-07-10T16:30:00Z' };
  assert.equal(cellDisplay(lateNight, date), '2026-07-11');
});

test('최종 수집 시간은 한국 시간으로 시:분까지 — 같은 날 다른 시각에 새로고침한 컬럼이 같은 값으로 보이면 안 된다', () => {
  const fetchedAt = TABLE_COLUMNS.find((c) => c.key === 'fetchedAt')!;
  // 2026-07-30T01:02:03Z = 한국 7/30 10:02. UTC로 찍으면 01:02로 보여 9시간 어긋난다.
  assert.equal(cellDisplay(ROW, fetchedAt), '2026-07-30 10:02');
  assert.equal(cellExport(ROW, fetchedAt), '2026-07-30 10:02');
});

test('칸 이름은 무엇의 기준인지·무엇의 이름인지 말한다', () => {
  assert.equal(TABLE_COLUMNS.find((c) => c.key === 'fetchedAt')!.label, '최종 수집 시간');
  assert.equal(TABLE_COLUMNS.find((c) => c.key === 'columns')!.label, '컬럼명');
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `npx tsx --test src/lib/tableColumns.test.ts`
Expected: FAIL — 기준 칸이 `2026-07-30 01:02`(UTC), 라벨이 `기준`·`열`

- [ ] **Step 3: 구현**

`src/lib/tableColumns.ts`에서 `ymd`·`ymdHm` 위에 헬퍼를 두고 두 함수가 그것을 쓰게 한다:

```ts
// 표의 날짜·시각은 전부 한국 시간으로 보여준다. 서버는 UTC로 저장하고(timestamptz),
// 필터 경계도 SQL에서 Asia/Seoul 자정으로 계산하므로(tableFilter.ts) 표시가 같은 시간대여야
// "보이는 날짜"와 "걸러지는 경계"가 일치한다.
// 고정 +9시간인 이유: 한국은 1988년 이후 서머타임이 없어 Asia/Seoul은 항상 UTC+9다.
// Intl에 맡기면 런타임 시간대 데이터에 의존해 테스트가 환경에 흔들린다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toKstIso(iso: string): string {
  return new Date(new Date(iso).getTime() + KST_OFFSET_MS).toISOString();
}
```

그리고 두 함수를 이렇게 바꾼다:

```ts
function ymd(iso: string | null): string {
  if (!iso) return '';
  return toKstIso(iso).slice(0, 10);   // 표는 정렬 축이라 상대 표기를 쓰지 않는다
}

// '최종 수집 시간'(last_fetched_at) 전용. 날짜만 찍으면 같은 날 09:00에 새로고침한 컬럼과
// 22:00에 새로고침한 컬럼이 같은 값으로 보여 "비교 가능"으로 오인된다(설계 §E) — 시:분까지 찍는다.
function ymdHm(iso: string | null): string {
  if (!iso) return '';
  return toKstIso(iso).slice(0, 16).replace('T', ' ');   // YYYY-MM-DD HH:MM
}
```

라벨 두 개를 바꾼다:

```ts
  { key: 'columns', label: '컬럼명' },
```

```ts
  { key: 'fetchedAt', label: '최종 수집 시간' },
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test src/lib/tableColumns.test.ts`
Expected: PASS, `# fail 0`

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 실패한다 — `tableFilter.test.ts`가 아직 `FIELD_SPECS.fetchedAt.label === '기준'`을 기대한다. **T2에서 고친다.** 오류가 테스트 파일에만 있는지 확인하고 다음으로 간다.

- [ ] **Step 6: 커밋**

메시지 요약: `fix(x-research): 표의 날짜·시각을 한국 시간으로 + 기준/열 칸 이름 정정`

---

### Task 2: 날짜 필터 경계를 KST 자정으로

**Files:**
- Modify: `src/lib/tableFilter.ts`
- Modify: `src/lib/tableFilter.test.ts`
- Modify: `src/lib/tweetStore.test.ts`

**Interfaces:**
- Consumes: T1의 새 라벨
- Produces: `buildFilterSql`의 `after`/`before` 조각이 KST 자정 경계를 쓴다

**문제:** Postgres 서버 시간대가 UTC라 `$1::date`가 UTC 자정 = 한국 오전 9시를 가리킨다. 그래서 `날짜 이후 2026-07-31`이 한국시간 그날 0~9시 글을 버린다. 실측으로 확인했다(Global Constraints).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/tableFilter.test.ts`에서 날짜 SQL을 검사하는 기존 테스트를 아래로 **교체**하고, 라벨 기대값도 함께 고친다:

```ts
test('buildFilterSql: 날짜 경계는 한국 시간 자정 — UTC 자정(한국 오전 9시)이면 그날 새벽 글이 빠진다', () => {
  const after = buildFilterSql([{ id: '1', field: 'date', op: 'after', value: '2026-07-01' }], 1);
  assert.match(after.clauses[0], /t\.tweet_created_at >= \$1::date::timestamp at time zone 'Asia\/Seoul'/);
  const before = buildFilterSql([{ id: '1', field: 'date', op: 'before', value: '2026-07-01' }], 1);
  assert.match(before.clauses[0], /t\.tweet_created_at < \$1::date::timestamp at time zone 'Asia\/Seoul'/);
  const fetched = buildFilterSql([{ id: '1', field: 'fetchedAt', op: 'after', value: '2026-07-01' }], 1);
  assert.match(fetched.clauses[0], /t\.last_fetched_at >= \$1::date::timestamp at time zone 'Asia\/Seoul'/);
  // 값은 여전히 바인딩 파라미터다
  assert.deepEqual(after.params, ['2026-07-01']);
});
```

같은 파일에서 라벨을 기대하는 줄을 찾아 새 이름으로 바꾼다(`FIELD_SPECS.fetchedAt.label`을 `'기준'`으로 기대하는 곳). `grep -n "'기준'" src/lib/tableFilter.test.ts`로 찾는다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `npx tsx --test src/lib/tableFilter.test.ts`
Expected: FAIL — 조각이 아직 `$1::date`

- [ ] **Step 3: 구현**

`src/lib/tableFilter.ts`의 `buildFilterSql`에서 두 날짜 분기를 바꾼다:

```ts
      // 경계는 한국 시간 자정이다. Postgres 서버 시간대가 UTC라 $1::date를 그대로 쓰면
      // UTC 자정(한국 오전 9시)이 되어 '이후'가 그날 새벽 글을 버린다(2026-07-31 실측).
      // 표시(tableColumns.ymd)도 같은 시간대를 쓴다 — 보이는 날짜와 걸러지는 경계가 같아야 한다.
      // '이후'는 그 날짜 포함, '이전'은 그 날짜 미포함 — 두 조건을 겹쳐 범위를 만들 때
      // 경계 하루가 양쪽에 들어가지 않게 한쪽만 포함한다.
      case 'after': clauses.push(`${expr} >= ${bind(v)}::date::timestamp at time zone 'Asia/Seoul'`); break;
      case 'before': clauses.push(`${expr} < ${bind(v)}::date::timestamp at time zone 'Asia/Seoul'`); break;
```

- [ ] **Step 4: 테스트 통과 확인 + 타입 체크**

Run: `npx tsx --test src/lib/tableFilter.test.ts && npx tsc --noEmit`
Expected: 테스트 PASS, `tsc` 출력 없음(T1에서 남았던 오류가 사라진다)

- [ ] **Step 5: DB 테스트의 날짜 경계를 확인하고 필요하면 조정**

`src/lib/tweetStore.test.ts`에는 날짜 필터를 검사하는 단정이 있다(`f('date', 'after', '2026-07-01')`로 3건, `before`로 0건을 기대하는 부분). 픽스처가 만드는 `tweetCreatedAt`이 무엇인지 읽고, **KST 경계로 바뀌면 기대값이 달라지는지 손으로 계산**한다.

- 픽스처가 `2026-07-01T00:00:00Z`(= 한국 7/1 09:00)라면: `after 2026-07-01`의 KST 경계는 `2026-06-30T15:00:00Z`이므로 여전히 3건이 잡히고, `before 2026-07-01`은 여전히 0건이다 → **기대값 변화 없음**.
- 다른 값이라면 계산 결과에 맞춰 기대값을 고치되, **왜 바뀌는지 주석으로 남긴다.**

그리고 KST 경계가 실제로 동작하는지 보는 단정 하나를 추가한다 — 한국시간으로는 다음 날인 늦은 밤 글이 그 다음 날 `after`에 잡히는 것:

```ts
    // 한국시간 7/2 00:30(= UTC 7/1 15:30)에 올라온 글은 'after 2026-07-02'에 잡혀야 한다.
    // UTC 자정 경계였을 때는 빠졌다 — 표에 7/2로 보이는데 7/2 이후 필터에 안 걸리는 상태였다.
    await upsertTweets(sql, [{ ...tw('kst1', 50), tweetCreatedAt: '2026-07-01T15:30:00Z' }]);
    await linkColumnTweets(sql, col.id, [P + 'kst1']);
    const kst = await getWorkspaceTableRows(sql, ws.id, {
      sort: 'views', filters: [f('date', 'after', '2026-07-02')],
    });
    assert.ok(kst.some((r) => r.tweetId === P + 'kst1'), '한국시간 기준 7/2 글이 7/2 이후에 잡힌다');
```

이 단정을 어느 테스트에 넣을지는 기존 파일 구조를 보고 정한다 — 이미 열·트윗을 만들고 `finally`에서 지우는 테스트 안에 넣는 것이 안전하다. **새 픽스처도 반드시 그 `finally`에서 정리된다는 것을 확인한다.**

- [ ] **Step 6: DB 테스트 실행**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/tweetStore.test.ts`
Expected: PASS, `# fail 0`. 수십 초~수 분 걸린다(실 DB).

- [ ] **Step 7: 커밋**

메시지 요약: `fix(x-research): 날짜 필터 경계를 한국 시간 자정으로 — 그날 새벽 글이 빠지고 있었다`

---

### Task 3: 모순 경고 문구의 `열` → `컬럼`

**Files:**
- Modify: `src/lib/collectionConflict.ts`
- Modify: `src/lib/collectionConflict.test.ts`

**Interfaces:** 없음 (문구만)

**이 태스크는 동작을 바꾸지 않는다.** 문구만 바꾸고, 그 문구를 고정한 테스트 기대값도 함께 바꾼다. 테스트를 구현에 맞추는 것이 아니라 **양쪽을 새 확정 문구에 맞추는 것**이다 — 사용자가 `열` → `컬럼`을 확정했다.

- [ ] **Step 1: 구현과 테스트를 함께 바꾼다**

`src/lib/collectionConflict.ts`에서 사용자 대면 문구의 `열`을 `컬럼`으로 바꾼다. 바뀌는 조각:

- `선택한 열 중 ${hitCount}개는` → `선택한 컬럼 중 ${hitCount}개는`
- `그 열에서는 한 건도 나오지 않아요` → `그 컬럼에서는 한 건도 나오지 않아요`
- `이 열은` → `이 컬럼은` (숫자 축 2곳 + 날짜 축 4곳)

**주석 안의 `열`도 함께 바꾼다** — 코드가 `컬럼`이라고 말하는데 주석이 `열`이라고 말하면 다음 사람이 두 개념으로 읽는다.

`src/lib/collectionConflict.test.ts`의 기대 문자열 10건을 같은 규칙으로 바꾼다. `grep -n "열" src/lib/collectionConflict.test.ts`로 전수 확인한다.

**바꾸지 않는 것:** 축 라벨(`좋아요`·`조회수`·`날짜` 등 — `FIELD_SPECS`에서 온다), 연산자 표현(`이상`·`이하`·`이후`·`이전`), 문장 구조, `kind` 판정 로직, `summarizeConflicts`.

- [ ] **Step 2: 테스트 통과 확인**

Run: `npx tsx --test src/lib/collectionConflict.test.ts`
Expected: PASS, `# fail 0`. 개수는 그대로여야 한다(문구만 바뀌었으므로).

- [ ] **Step 3: 잔존 확인**

Run: `grep -n "열" src/lib/collectionConflict.ts src/lib/collectionConflict.test.ts`
Expected: 출력 없음. 하나라도 남으면 그것이 사용자에게 보이는지 판단하고 보고한다.

- [ ] **Step 4: 커밋**

메시지 요약: `fix(x-research): 모순 경고 문구를 '열'에서 '컬럼'으로 — 제품 나머지와 같은 말`

---

### Task 4: 컴포넌트 문구의 `열` → `컬럼`

**Files:**
- Modify: `src/components/ColumnPicker.tsx`
- Modify: `src/components/FilterChips.tsx`
- Modify: `src/components/TweetTableView.tsx`

**Interfaces:** 없음 (문구만)

- [ ] **Step 1: 세 파일의 사용자 대면 `열`을 `컬럼`으로**

바꿀 것(전부 사용자에게 보이는 문구):

- `ColumnPicker.tsx`: 트리거의 `열: ` → `컬럼: `
- `FilterChips.tsx`: 칩 본문 `열 {columnSelectionLabel(columnNames)}` → `컬럼 {…}`, `aria-label="열 선택 지우기"`·`title` → `컬럼 선택 지우기`
- `TweetTableView.tsx`:
  - CSV 잘림 토스트의 `위에서 열을 선택해 범위를 좁혀보세요` → `위에서 컬럼을 선택해 범위를 좁혀보세요`
  - 신선도 안내의 `카드 보기에서 열을 새로고침하면 갱신됩니다` → `카드 보기에서 컬럼을 새로고침하면 갱신됩니다`
  - 빈 상태 `아직 열이 없어요 — 카드 보기에서 열을 만들어보세요` → `아직 컬럼이 없어요 — 카드 보기에서 컬럼을 만들어보세요`
  - 빈 상태 `아직 수집된 글이 없어요 — 카드 보기에서 열을 새로고침하면 여기에 모입니다` → `… 카드 보기에서 컬럼을 새로고침하면 여기에 모입니다`
  - 그 밖에 `열`이 사용자에게 보이는 곳이 있으면 같은 규칙으로 바꾼다

**주석 안의 `열`도 함께 바꾼다** — 같은 이유다.

**바꾸지 않는 것:** 변수·prop·함수 이름(`columnIds`·`activeColumnIds`·`ColumnPicker`·`columnNames` 등 영어 식별자), `필터 지우기`·`조건에 맞는 글이 없어요` 같은 다른 확정 문구, `CSV 저장 (전체 N건)`.

- [ ] **Step 2: 타입 체크 + 린트**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 총계 23 유지.

- [ ] **Step 3: 잔존 확인**

Run: `grep -rn "열" src/components/ColumnPicker.tsx src/components/FilterChips.tsx src/components/TweetTableView.tsx`
Expected: 출력 없음. 남은 것이 있으면 사용자에게 보이는지 판단해 보고한다.

- [ ] **Step 4: 커밋**

메시지 요약: `fix(x-research): 표 보기 문구의 '열'을 '컬럼'으로 통일`

---

### Task 5: 최종 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 테스트**

Run: `npm test`
Expected: 전부 통과, `# fail 0`. 약 4분(실 DB). 기준선 326개 + T1의 새 단정 + T2의 KST DB 단정.

- [ ] **Step 2: 타입 체크 · 린트 · 프로덕션 빌드**

Run: `npx tsc --noEmit; echo "tsc=$?"; npm run lint 2>&1 | tail -3; npm run build 2>&1 | tail -5`
Expected: `tsc=0`, 린트 **23**(늘지 않음), 빌드 성공.

- [ ] **Step 3: `열` 잔존 전수 확인**

Run: `grep -rn "열" src --include=*.ts --include=*.tsx`
(zsh에서 `--include`가 안 먹으면 `grep -rn "열" src/lib src/components src/app`)
Expected: 사용자 대면 문구에는 `열`이 남아 있지 않다. 남은 것이 있으면 하나씩 판단해 보고한다 — 영어 식별자나 `병렬`·`나열` 같은 다른 단어의 일부일 수 있다.

- [ ] **Step 4: 브라우저 확인**

`npm run dev` → `http://localhost:3000/w/d40e4b21-d53f-4dd0-a2b3-bccc5f078f83?view=table`

1. 첫 칸 머리글이 `컬럼명`, 마지막 칸 머리글이 `최종 수집 시간`이다
2. `최종 수집 시간` 값이 **한국 시간**이다 — 지금 컬럼을 새로고침하면 그 값이 현재 한국 시각과 맞아야 한다(전에는 9시간 전으로 보였다)
3. 컬럼 드롭다운 트리거가 `컬럼: 전체`, 칩이 `컬럼 PDRN 크림 +2`
4. 모순 경고가 `이 컬럼은 …` / `선택한 컬럼 중 N개는 …`
5. 필터 축 목록에도 `최종 수집 시간`이 보인다(`TABLE_COLUMNS`에서 파생되므로 자동)
6. `날짜 이후 <오늘>`을 걸면 한국시간 오늘 새벽에 올라온 글이 **빠지지 않는다**
7. CSV를 받아 `최종 수집 시간` 칸이 화면과 같은 값(한국 시간)이다
8. 빈 상태·토스트에 `열`이 없다

- [ ] **Step 5: 사용자 확인 요청**

로그인 게이팅으로 볼 수 없는 것을 전달한다: `최종 수집 시간`이 표 머리글로 길지 않은지(7자), 컬럼 폭 기본값이 그 이름을 담기에 충분한지.
