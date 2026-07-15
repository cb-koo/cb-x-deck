import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePillarStats, type PillarStatsInput } from './pillarStats.ts';

function t(id: string, likes: number | null, topicId: string | null, isQuote = false): PillarStatsInput {
  return { tweetId: id, likes, isQuote, topicId };
}

test('⭐기회 판정: 비중 낮음 + 중앙값 1.5배 + 3건 이상 → 맨 앞 정렬', () => {
  const tweets = [
    // t1: 3건, 좋아요 높음 (기회 후보)
    t('a', 1000, 't1'), t('b', 1200, 't1'), t('c', 1400, 't1'),
    // t2: 7건, 좋아요 낮음 (주력이지만 반응 낮음)
    t('d', 10, 't2'), t('e', 10, 't2'), t('f', 20, 't2'), t('g', 20, 't2'),
    t('h', 30, 't2'), t('i', 30, 't2'), t('j', 40, 't2'),
  ];
  const s = computePillarStats(tweets, [{ id: 't1', label: '성분' }, { id: 't2', label: '시술' }]);
  // accountMedian: 10건 → 중앙 두 값(30,30)? 정렬: 10,10,20,20,30,30,40,1000,1200,1400 → (30+30)/2=30
  assert.equal(s.accountMedian, 30);
  const t1 = s.rows.find((r) => r.topicId === 't1')!;
  assert.equal(t1.verdict, 'opportunity');
  assert.equal(t1.medianLikes, 1200);
  assert.equal(t1.sharePct, 30);                 // 3/10
  assert.equal(t1.judgment, '적게 올리는데 반응 최상 — 기회 주제');
  assert.equal(s.rows[0].topicId, 't1');         // ⭐ 먼저
});

test('3건 미만이면 기회 아님(표본 신뢰) → normal', () => {
  const tweets = [
    t('a', 1000, 't1'), t('b', 1200, 't1'),      // 2건뿐
    t('c', 10, 't2'), t('d', 10, 't2'), t('e', 20, 't2'), t('f', 20, 't2'), t('g', 30, 't2'),
  ];
  const s = computePillarStats(tweets, [{ id: 't1', label: 'ㄱ' }, { id: 't2', label: 'ㄴ' }]);
  assert.equal(s.rows.find((r) => r.topicId === 't1')!.verdict, 'normal');
});

test('core: 비중·중앙값 모두 평균 이상 / low: 중앙값이 절반 미만(비중 높으면 카피 다름)', () => {
  const tweets = [
    t('a', 100, 't1'), t('b', 100, 't1'), t('c', 100, 't1'), t('d', 100, 't1'),
    t('e', 10, 't2'), t('f', 10, 't2'), t('g', 10, 't2'), t('h', 10, 't2'),
  ];
  const s = computePillarStats(tweets, [{ id: 't1', label: 'ㄱ' }, { id: 't2', label: 'ㄴ' }]);
  // accountMedian = (10+100)/2 = 55, 균등비중 = 50%
  const t1 = s.rows.find((r) => r.topicId === 't1')!;
  const t2 = s.rows.find((r) => r.topicId === 't2')!;
  assert.equal(t1.verdict, 'core');
  assert.equal(t1.judgment, '이 계정의 주력 주제');
  assert.equal(t2.verdict, 'low');               // 10 < 55*0.5
  assert.equal(t2.judgment, '많이 올리지만 반응 낮음'); // 비중 50% ≥ 균등비중
});

test('중앙값: 홀수=가운데, 짝수=두 값 평균 반올림, null 좋아요=0', () => {
  const odd = computePillarStats([t('a', 1, 't1'), t('b', 5, 't1'), t('c', 9, 't1')], [{ id: 't1', label: 'ㄱ' }]);
  assert.equal(odd.rows[0].medianLikes, 5);
  const even = computePillarStats([t('a', 1, 't1'), t('b', 4, 't1')], [{ id: 't1', label: 'ㄱ' }]);
  assert.equal(even.rows[0].medianLikes, 3);     // (1+4)/2=2.5 → 3
  const withNull = computePillarStats([t('a', null, 't1'), t('b', 10, 't1'), t('c', 20, 't1')], [{ id: 't1', label: 'ㄱ' }]);
  assert.equal(withNull.rows[0].medianLikes, 10); // null→0: [0,10,20]
});

test('미분류 집계 + 0건 주제 행 제거 + 투고/인용 카운트', () => {
  const tweets = [t('a', 10, 't1'), t('b', 10, 't1', true), t('c', 5, null)];
  const s = computePillarStats(tweets, [{ id: 't1', label: 'ㄱ' }, { id: 'empty', label: 'ㄴ' }]);
  assert.equal(s.classifiedCount, 2);
  assert.equal(s.unclassifiedCount, 1);
  assert.deepEqual(s.rows.map((r) => r.topicId), ['t1']);  // empty 행 없음
  assert.equal(s.rows[0].postCount, 1);
  assert.equal(s.rows[0].quoteCount, 1);
  assert.equal(s.postCount, 1);
  assert.equal(s.quoteCount, 1);
});

test('빈 입력·전체 좋아요 0이면 기회 판정 없음(0분모 가드)', () => {
  const empty = computePillarStats([], [{ id: 't1', label: 'ㄱ' }]);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.accountMedian, 0);
  const zeros = computePillarStats(
    [t('a', 0, 't1'), t('b', 0, 't1'), t('c', 0, 't1'), t('d', 0, 't2'), t('e', 0, 't2'), t('f', 0, 't2'), t('g', 0, 't2')],
    [{ id: 't1', label: 'ㄱ' }, { id: 't2', label: 'ㄴ' }]);
  assert.ok(zeros.rows.every((r) => r.verdict !== 'opportunity'));
});
