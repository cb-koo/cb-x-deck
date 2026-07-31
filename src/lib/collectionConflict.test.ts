import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findConflicts } from './collectionConflict.ts';
import type { ColumnRow } from './types.ts';
import type { FilterCondition } from './tableFilter.ts';

const col = (id: string, title: string, config: Record<string, unknown>): ColumnRow => ({
  id, workspaceId: 'ws', kind: 'search', title, position: 0,
  config: config as never, lastRefreshedAt: null, prevRefreshedAt: null, createdAt: '2026-01-01',
} as unknown as ColumnRow);

const watch = (id: string, title: string): ColumnRow => ({
  id, workspaceId: 'ws', kind: 'watchlist', title, position: 0,
  config: { handle: 'x', userId: '1' } as never, lastRefreshedAt: null, prevRefreshedAt: null, createdAt: '2026-01-01',
} as unknown as ColumnRow);

const c = (over: Partial<FilterCondition>): FilterCondition =>
  ({ id: 'c1', field: 'likes', op: 'gte', value: '100', ...over });

const A = col('a', 'PDRN 크림', { keywords: ['x'], minFaves: 300 });

test('느슨한 조건 — 더 나오지 않는다고 알린다', () => {
  const out = findConflicts([c({})], [A], ['a']);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'noEffect');
  assert.equal(out[0].message, '이 열은 좋아요 300 이상만 모으고 있어서 100으로 낮춰도 더 나오지 않아요');
});

test('반대 방향 — 항상 0건임을 더 강하게 알린다', () => {
  const out = findConflicts([c({ op: 'lte', value: '200' })], [A], ['a']);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'alwaysEmpty');
  assert.equal(out[0].message, '이 열은 좋아요 300 이상만 모으고 있어서 200 이하로는 한 건도 나오지 않아요');
});

test('수집 기준보다 엄격한 조건은 정상 — 경고 없음', () => {
  assert.deepEqual(findConflicts([c({ value: '1000' })], [A], ['a']), []);
});

test('여러 열이면 요약한다', () => {
  const cols = [A, col('b', 'B', { keywords: ['y'], minFaves: 300 }), col('d', 'D', { keywords: ['z'], minFaves: 100 })];
  const out = findConflicts([c({})], cols, []);   // 빈 배열 = 전체
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'noEffect');
  assert.equal(out[0].message, '선택한 열 중 2개는 좋아요 300 이상만 모아요');
});

test('인플루언서 열은 수집 기준이 없어 경고 대상이 아니다', () => {
  assert.deepEqual(findConflicts([c({})], [watch('w', 'W')], ['w']), []);
});

test('축마다 대응하는 수집 설정을 본다', () => {
  const cols = [col('a', 'A', { keywords: ['x'], minRetweets: 50, minReplies: 10, minViews: 100000, sinceDate: '2026-06-01', untilDate: '2026-07-31' })];
  const k = (over: Partial<FilterCondition>) => findConflicts([c(over)], cols, ['a'])[0]?.kind ?? null;
  assert.equal(k({ field: 'retweets', op: 'gte', value: '10' }), 'noEffect');
  assert.equal(k({ field: 'retweets', op: 'lte', value: '10' }), 'alwaysEmpty');
  assert.equal(k({ field: 'replies', op: 'gte', value: '5' }), 'noEffect');
  assert.equal(k({ field: 'views', op: 'gte', value: '1000' }), 'noEffect');
  assert.equal(k({ field: 'date', op: 'after', value: '2026-01-01' }), 'noEffect');
  assert.equal(k({ field: 'date', op: 'before', value: '2026-01-01' }), 'alwaysEmpty');
  assert.equal(k({ field: 'date', op: 'before', value: '2026-12-31' }), 'noEffect');
  assert.equal(k({ field: 'date', op: 'after', value: '2026-12-31' }), 'alwaysEmpty');
});

test('대응 설정이 없는 축은 경고하지 않는다', () => {
  assert.deepEqual(findConflicts([c({ field: 'fetchedAt', op: 'after', value: '2026-01-01' })], [A], ['a']), []);
  assert.deepEqual(findConflicts([c({ field: 'followers', op: 'gte', value: '1' })], [A], ['a']), []);
  assert.deepEqual(findConflicts([c({ field: 'text', op: 'contains', value: 'x' })], [A], ['a']), []);
});

test('날짜 경계 — sinceDate와 정확히 같은 이전(before)은 항상 0건이라 경고한다', () => {
  const since = col('s', 'S', { keywords: ['x'], sinceDate: '2026-06-01' });
  const out = findConflicts([c({ field: 'date', op: 'before', value: '2026-06-01' })], [since], ['s']);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'alwaysEmpty');
  assert.equal(out[0].message, '이 열은 2026-06-01 이후만 모으고 있어서 2026-06-01 이전으로는 한 건도 나오지 않아요');
});

test('날짜 경계 — sinceDate와 정확히 같은 이후(after)는 낮춘 게 아니라서 조용히 넘어간다', () => {
  const since = col('s', 'S', { keywords: ['x'], sinceDate: '2026-06-01' });
  assert.deepEqual(findConflicts([c({ field: 'date', op: 'after', value: '2026-06-01' })], [since], ['s']), []);
});

test('숫자 요약 — 기준이 다른 여러 열은 가장 낮은 기준을 말한다', () => {
  const cols = [
    col('a', 'A', { keywords: ['x'], minFaves: 100 }),
    col('b', 'B', { keywords: ['y'], minFaves: 300 }),
  ];
  const out = findConflicts([c({ value: '50' })], cols, ['a', 'b']);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'noEffect');
  assert.equal(out[0].message, '선택한 열 중 2개는 좋아요 100 이상만 모아요');
});

test('날짜 경계 — untilDate와 정확히 같은 이후(after)는 항상 0건이라 경고한다', () => {
  const until = col('u', 'U', { keywords: ['x'], untilDate: '2026-07-31' });
  const out = findConflicts([c({ field: 'date', op: 'after', value: '2026-07-31' })], [until], ['u']);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'alwaysEmpty');
  assert.equal(out[0].message, '이 열은 2026-07-31 이전만 모으고 있어서 2026-07-31 이후로는 한 건도 나오지 않아요');
});

test('날짜 경계 — untilDate와 정확히 같은 이전(before)은 중복일 뿐이라 조용히 넘어간다', () => {
  const until = col('u', 'U', { keywords: ['x'], untilDate: '2026-07-31' });
  assert.deepEqual(findConflicts([c({ field: 'date', op: 'before', value: '2026-07-31' })], [until], ['u']), []);
});

test('날짜 요약 — 기준이 다른 여러 열은 가장 느슨한(이른) sinceDate를 말한다', () => {
  const cols = [
    col('a', 'A', { keywords: ['x'], sinceDate: '2026-06-01' }),
    col('b', 'B', { keywords: ['y'], sinceDate: '2026-03-01' }),
  ];
  const out = findConflicts([c({ field: 'date', op: 'after', value: '2026-01-01' })], cols, ['a', 'b']);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'noEffect');
  assert.equal(out[0].message, '이 열은 2026-03-01 이후만 모으고 있어서 2026-01-01으로 낮춰도 더 나오지 않아요');
});
