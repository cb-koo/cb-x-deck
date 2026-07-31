import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_SPECS, FILTER_FIELDS, OP_LABEL, isComplete, describeCondition, parseFilters,
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
