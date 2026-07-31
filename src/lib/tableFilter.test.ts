import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_SPECS, FILTER_FIELDS, OP_LABEL, isComplete, describeCondition, parseFilters, buildFilterSql,
         type FilterCondition } from './tableFilter.ts';

const c = (over: Partial<FilterCondition> = {}): FilterCondition =>
  ({ id: 'x', field: 'views', op: 'gte', value: '100000', ...over });

test('축 라벨은 표 머리글과 같은 출처를 쓴다 (갈라지면 안 된다)', () => {
  assert.equal(FIELD_SPECS.views.label, '조회수');
  assert.equal(FIELD_SPECS.likes.label, '좋아요');
  assert.equal(FIELD_SPECS.retweets.label, 'RT');
  assert.equal(FIELD_SPECS.handle.label, '계정');
  assert.equal(FIELD_SPECS.text.label, '본문');
  assert.equal(FIELD_SPECS.followers.label, '팔로워');
  assert.equal(FIELD_SPECS.fetchedAt.label, '기준');
});

test('축마다 쓸 수 있는 연산자가 정해져 있다', () => {
  assert.deepEqual(FIELD_SPECS.handle.ops, ['is', 'contains']);
  assert.deepEqual(FIELD_SPECS.text.ops, ['contains', 'notContains']);
  assert.deepEqual(FIELD_SPECS.views.ops, ['gte', 'lte']);
  assert.deepEqual(FIELD_SPECS.date.ops, ['after', 'before']);
  assert.deepEqual(FIELD_SPECS.fetchedAt.ops, ['after', 'before']);
});

test('열은 필터 축이 아니다 — 전용 드롭다운이 유일한 경로', () => {
  assert.ok(!FILTER_FIELDS.includes('columns' as never));
  assert.equal(FILTER_FIELDS.length, 11);
});

test('연산자 라벨은 사용자 말로', () => {
  assert.equal(OP_LABEL.is, '같음');
  assert.equal(OP_LABEL.contains, '포함');
  assert.equal(OP_LABEL.notContains, '제외');
  assert.equal(OP_LABEL.gte, '이상');
  assert.equal(OP_LABEL.lte, '이하');
  assert.equal(OP_LABEL.after, '이후');
  assert.equal(OP_LABEL.before, '이전');
});

test('값이 비면 미완성 — 축만 고른 중간 상태가 결과를 0건으로 만들면 안 된다', () => {
  assert.equal(isComplete(c({ value: '' })), false);
  assert.equal(isComplete(c({ value: '   ' })), false);
  assert.equal(isComplete(c()), true);
  // 숫자 축에 숫자가 아닌 값이 오면 미완성으로 본다 (SQL에 NaN이 흘러가지 않게)
  assert.equal(isComplete(c({ field: 'views', value: 'abc' })), false);
  // 날짜 축은 YYYY-MM-DD 형태만
  assert.equal(isComplete(c({ field: 'date', op: 'after', value: '2026-07' })), false);
  assert.equal(isComplete(c({ field: 'date', op: 'after', value: '2026-07-01' })), true);
});

test('조건을 사용자 말로 서술한다 (칩 라벨용)', () => {
  assert.equal(describeCondition(c()), '조회수 이상 100,000');
  assert.equal(describeCondition(c({ field: 'handle', op: 'contains', value: 'beauty' })), '계정 포함 beauty');
  assert.equal(describeCondition(c({ field: 'date', op: 'before', value: '2026-07-01' })), '날짜 이전 2026-07-01');
});

test('parseFilters: 허용 목록 밖 축·연산자는 조용히 버린다 (클라이언트를 믿지 않는다)', () => {
  const raw = [
    { id: 'a', field: 'views', op: 'gte', value: '100' },
    { id: 'b', field: 'DROP TABLE', op: 'gte', value: '1' },      // 없는 축
    { id: 'c', field: 'text', op: 'gte', value: 'x' },              // 그 축에 없는 연산자
    { id: 'd', field: 'handle', op: 'contains', value: '' },        // 미완성
    { id: 'e', field: 'likes', op: 'lte', value: '5' },
  ];
  const out = parseFilters(raw);
  assert.deepEqual(out.map((x) => x.id), ['a', 'e']);
});

test('parseFilters: 배열이 아니거나 쓰레기가 와도 터지지 않는다', () => {
  assert.deepEqual(parseFilters(null), []);
  assert.deepEqual(parseFilters('nope'), []);
  assert.deepEqual(parseFilters([1, 2, 3]), []);
  assert.deepEqual(parseFilters([{}]), []);
});

test('buildFilterSql: 값은 항상 바인딩 파라미터로 나가고 번호가 이어진다', () => {
  const { clauses, params } = buildFilterSql([
    { id: '1', field: 'views', op: 'gte', value: '100000' },
    { id: '2', field: 'likes', op: 'lte', value: '500' },
  ], 3);
  assert.equal(clauses.length, 2);
  assert.ok(clauses[0].includes('$3'), clauses[0]);
  assert.ok(clauses[1].includes('$4'), clauses[1]);
  assert.deepEqual(params, [100000, 500]);
  // 값이 SQL 텍스트에 직접 박히지 않았다
  assert.ok(!clauses.join(' ').includes('100000'));
});

test('buildFilterSql: 지표는 jsonb에서 뽑아 bigint로 캐스팅한다 (정렬식과 같은 형태)', () => {
  const { clauses } = buildFilterSql([{ id: '1', field: 'views', op: 'gte', value: '5' }], 2);
  assert.match(clauses[0], /\(t\.metrics->>'views'\)::bigint >= \$2/);
});

test('buildFilterSql: 팔로워는 실제 컬럼', () => {
  const { clauses } = buildFilterSql([{ id: '1', field: 'followers', op: 'lte', value: '5' }], 1);
  assert.match(clauses[0], /t\.author_followers <= \$1/);
});

test('buildFilterSql: 계정 같음/포함', () => {
  const a = buildFilterSql([{ id: '1', field: 'handle', op: 'is', value: 'beautyfulence' }], 1);
  assert.match(a.clauses[0], /t\.author_handle = \$1/);
  assert.deepEqual(a.params, ['beautyfulence']);
  const b = buildFilterSql([{ id: '1', field: 'handle', op: 'contains', value: 'beauty' }], 1);
  assert.match(b.clauses[0], /t\.author_handle ilike/);
  assert.deepEqual(b.params, ['%beauty%']);
});

test('buildFilterSql: 본문 포함/제외 + LIKE 메타문자 이스케이프', () => {
  const inc = buildFilterSql([{ id: '1', field: 'text', op: 'contains', value: 'スキン' }], 1);
  assert.match(inc.clauses[0], /t\.text ilike \$1 escape/);
  assert.deepEqual(inc.params, ['%スキン%']);
  // 50%를 찾으면 %가 와일드카드가 되어 50으로 시작하는 전부에 걸린다 → 이스케이프해야 한다
  const pct = buildFilterSql([{ id: '1', field: 'text', op: 'contains', value: '50%' }], 1);
  assert.deepEqual(pct.params, ['%50\\%%']);
  const und = buildFilterSql([{ id: '1', field: 'text', op: 'contains', value: 'a_b' }], 1);
  assert.deepEqual(und.params, ['%a\\_b%']);
  const bs = buildFilterSql([{ id: '1', field: 'text', op: 'contains', value: 'a\\b' }], 1);
  assert.deepEqual(bs.params, ['%a\\\\b%']);
  const exc = buildFilterSql([{ id: '1', field: 'text', op: 'notContains', value: 'PR' }], 1);
  assert.match(exc.clauses[0], /t\.text not ilike \$1 escape/);
});

test('buildFilterSql: 날짜 이후는 그 날 포함, 이전은 그 날 미포함', () => {
  const after = buildFilterSql([{ id: '1', field: 'date', op: 'after', value: '2026-07-01' }], 1);
  assert.match(after.clauses[0], /t\.tweet_created_at >= \$1::date/);
  const before = buildFilterSql([{ id: '1', field: 'date', op: 'before', value: '2026-07-01' }], 1);
  assert.match(before.clauses[0], /t\.tweet_created_at < \$1::date/);
  const fetched = buildFilterSql([{ id: '1', field: 'fetchedAt', op: 'after', value: '2026-07-01' }], 1);
  assert.match(fetched.clauses[0], /t\.last_fetched_at >= \$1::date/);
});

test('buildFilterSql: 조건이 없으면 빈 결과', () => {
  const { clauses, params } = buildFilterSql([], 1);
  assert.deepEqual(clauses, []);
  assert.deepEqual(params, []);
});

test('buildFilterSql: 허용 목록 밖 조합은 조각을 만들지 않는다 (parseFilters를 우회해 들어와도)', () => {
  const { clauses } = buildFilterSql([{ id: '1', field: 'text' as never, op: 'gte', value: '5' }], 1);
  assert.deepEqual(clauses, []);
});
