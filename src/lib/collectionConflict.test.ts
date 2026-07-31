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
  // 두 열 다 걸리므로(A2) 요약형이어야 한다 — 이 테스트 이름이 이미 "요약한다"였던 것과 달리
  // 이 문구는 이제껏 걸린 열이 하나뿐일 때 쓰는 단수형이었다(날짜 축엔 요약형 자체가 없던 결함).
  assert.equal(out[0].message, '선택한 열 중 2개는 2026-03-01 이후만 모아요');
});

// A2 — 열 하나의 사정을 선택 전체의 결론처럼 말하지 않는다: 여러 열이 선택 범위에 있으면
// 걸린 열이 단 하나뿐이어도 "이 열은 …"이 아니라 요약형을 써야 한다(그래야 나머지 열까지
// 그 결론에 묶이지 않는다). 새 alwaysEmpty 요약 문구는 제품 담당자가 확정한 것 그대로다.

test('A2: 숫자 — 선택 범위에 여러 열이 있어도 걸린 열이 하나뿐이면 그 하나만 세어 요약한다 (noEffect)', () => {
  const cols = [A, col('b', 'B', { keywords: ['y'], minFaves: 50 })];
  const out = findConflicts([c({ value: '100' })], cols, []);   // 빈 배열 = 전체(2개), 걸리는 건 A 하나
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'noEffect');
  assert.equal(out[0].message, '선택한 열 중 1개는 좋아요 300 이상만 모아요');
});

test('A2: 숫자 — 새 alwaysEmpty 요약 문구 (제품 확정)', () => {
  const cols = [A, col('b', 'B', { keywords: ['y'], minFaves: 300 })];
  const out = findConflicts([c({ op: 'lte', value: '200' })], cols, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'alwaysEmpty');
  assert.equal(out[0].message, '선택한 열 중 2개는 좋아요 300 이상만 모아서 그 열에서는 한 건도 나오지 않아요');
});

test('A2: 숫자 — 선택 범위에 여러 열이 있어도 걸린 열이 하나뿐이면 alwaysEmpty도 요약한다', () => {
  const cols = [
    col('a', 'A', { keywords: ['x'], minViews: 100000 }),
    col('b', 'B', { keywords: ['y'], minViews: 50 }),
  ];
  const out = findConflicts([c({ field: 'views', op: 'lte', value: '1000' })], cols, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'alwaysEmpty');
  assert.equal(out[0].message, '선택한 열 중 1개는 조회수 100,000 이상만 모아서 그 열에서는 한 건도 나오지 않아요');
});

test('A2: 날짜(since) — 선택 범위에 여러 열이 있어도 걸린 열이 하나뿐이면 요약한다 (noEffect)', () => {
  const cols = [
    col('s', 'S', { keywords: ['x'], sinceDate: '2026-06-01' }),
    col('n', 'N', { keywords: ['y'] }),   // sinceDate 없음 — 대응 설정이 없어 걸리지 않는다
  ];
  const out = findConflicts([c({ field: 'date', op: 'after', value: '2026-01-01' })], cols, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'noEffect');
  assert.equal(out[0].message, '선택한 열 중 1개는 2026-06-01 이후만 모아요');
});

test('A2: 날짜(since) — 선택 범위에 여러 열이 있어도 걸린 열이 하나뿐이면 요약한다 (alwaysEmpty)', () => {
  const cols = [
    col('s', 'S', { keywords: ['x'], sinceDate: '2026-06-01' }),
    col('n', 'N', { keywords: ['y'] }),
  ];
  const out = findConflicts([c({ field: 'date', op: 'before', value: '2026-01-01' })], cols, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'alwaysEmpty');
  assert.equal(out[0].message, '선택한 열 중 1개는 2026-06-01 이후만 모아서 그 열에서는 한 건도 나오지 않아요');
});

test('A2: 날짜(until) — 선택 범위에 여러 열이 있어도 걸린 열이 하나뿐이면 요약한다 (noEffect/alwaysEmpty)', () => {
  const cols = [
    col('u', 'U', { keywords: ['x'], untilDate: '2026-07-31' }),
    col('n', 'N', { keywords: ['y'] }),
  ];
  const noEffect = findConflicts([c({ field: 'date', op: 'before', value: '2026-12-31' })], cols, []);
  assert.equal(noEffect.length, 1);
  assert.equal(noEffect[0].kind, 'noEffect');
  assert.equal(noEffect[0].message, '선택한 열 중 1개는 2026-07-31 이전만 모아요');

  const alwaysEmpty = findConflicts([c({ field: 'date', op: 'after', value: '2026-07-31' })], cols, []);
  assert.equal(alwaysEmpty.length, 1);
  assert.equal(alwaysEmpty[0].kind, 'alwaysEmpty');
  assert.equal(alwaysEmpty[0].message, '선택한 열 중 1개는 2026-07-31 이전만 모아서 그 열에서는 한 건도 나오지 않아요');
});

// 단수/요약 판정은 '검색 열 수'가 아니라 '선택 범위 안 열 수(검색+인플루언서)'로 해야 한다.
// 검색 열 하나 + 인플루언서 열 하나를 선택하면 검색 열은 하나뿐이지만 범위 안 열은 둘이라
// 단수형("이 열은 …")이 아니라 요약형을 써야 그 열들이 함께 보이는 표에서 대명사가 맞다.

test('혼합 선택(검색+인플루언서) — 숫자 noEffect: 검색 열은 하나뿐이어도 범위 열이 둘이면 요약형', () => {
  const w = watch('w', 'W');
  const out = findConflicts([c({})], [A, w], ['a', 'w']);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'noEffect');
  assert.equal(out[0].message, '선택한 열 중 1개는 좋아요 300 이상만 모아요');
});

test('혼합 선택(검색+인플루언서) — 숫자 alwaysEmpty: 요약형', () => {
  const w = watch('w', 'W');
  const out = findConflicts([c({ op: 'lte', value: '200' })], [A, w], ['a', 'w']);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'alwaysEmpty');
  assert.equal(out[0].message, '선택한 열 중 1개는 좋아요 300 이상만 모아서 그 열에서는 한 건도 나오지 않아요');
});

test('혼합 선택(검색+인플루언서) — 날짜 noEffect: 요약형', () => {
  const since = col('s', 'S', { keywords: ['x'], sinceDate: '2026-06-01' });
  const w = watch('w', 'W');
  const out = findConflicts([c({ field: 'date', op: 'after', value: '2026-01-01' })], [since, w], ['s', 'w']);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'noEffect');
  assert.equal(out[0].message, '선택한 열 중 1개는 2026-06-01 이후만 모아요');
});

test('혼합 선택(검색+인플루언서) — 날짜 alwaysEmpty: 요약형', () => {
  const since = col('s', 'S', { keywords: ['x'], sinceDate: '2026-06-01' });
  const w = watch('w', 'W');
  const out = findConflicts([c({ field: 'date', op: 'before', value: '2026-06-01' })], [since, w], ['s', 'w']);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'alwaysEmpty');
  assert.equal(out[0].message, '선택한 열 중 1개는 2026-06-01 이후만 모아서 그 열에서는 한 건도 나오지 않아요');
});
