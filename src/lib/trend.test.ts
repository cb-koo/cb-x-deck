import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weekStartJst, addWeeks, median,
  computeWeeklyTrend, computeTopicTrend, weeklyJudgment, type TrendTweet,
} from './trend.ts';

// 고정 현재 시각: 2026-07-16T00:00:00Z = JST 7/16(목) 09:00 → 현재 주 = 2026-07-13(월)
const NOW = '2026-07-16T00:00:00.000Z';

// weekStart('YYYY-MM-DD')의 주에 속하는 트윗 생성(그 주 수요일 정오 JST)
function tw(week: string, likes: number, topicId: string | null = null): TrendTweet {
  const created = new Date(Date.parse(week + 'T00:00:00Z') + 2 * 86_400_000 + 3 * 3_600_000).toISOString(); // JST 수 12:00
  return { tweetId: week + '-' + likes + '-' + Math.random(), likes, createdAt: created, topicId };
}

test('weekStartJst: JST 달력 기준 월요일, 경계·연말', () => {
  assert.equal(weekStartJst('2026-07-15T20:00:00Z'), '2026-07-13');       // JST 7/16(목)
  assert.equal(weekStartJst('2026-07-12T15:00:00Z'), '2026-07-13');       // JST 7/13(월) 00:00 정각
  assert.equal(weekStartJst('2026-07-12T14:59:59Z'), '2026-07-06');       // JST 7/12(일) 23:59
  assert.equal(weekStartJst('2025-12-31T00:00:00Z'), '2025-12-29');       // 연말 걸침(수→그 주 월요일)
  assert.equal(addWeeks('2026-07-13', -2), '2026-06-29');
});

test('median: 홀수·짝수·단건·빈 배열', () => {
  assert.equal(median([]), 0);
  assert.equal(median([7]), 7);
  assert.equal(median([1, 9, 5]), 5);
  assert.equal(median([1, 3, 5, 100]), 4); // (3+5)/2
});

test('computeWeeklyTrend: 8슬롯 달력 고정·0건 주 채움·집계 중 분리', () => {
  const tweets = [
    ...[100, 200, 300].map((l) => tw('2026-07-06', l)),
    ...[50, 60].map((l) => tw('2026-06-29', l)),
    // 6/22 주는 0건(공백 주)
    ...[10, 20, 30, 40].map((l) => tw('2026-06-15', l)),
    tw('2026-07-13', 999), // 현재(집계 중) 주
  ];
  const r = computeWeeklyTrend(tweets, NOW);
  assert.equal(r.weekly.length, 8);
  assert.equal(r.weekly[0].weekStart, '2026-05-18');                       // 현재 주 -8
  assert.equal(r.weekly[7].weekStart, '2026-07-06');                       // 현재 주 -1
  const w622 = r.weekly.find((b) => b.weekStart === '2026-06-22')!;
  assert.deepEqual([w622.count, w622.medianLikes], [0, 0]);                // 공백 주 0 채움
  assert.equal(r.weekly[7].count, 3);
  assert.equal(r.weekly[7].medianLikes, 200);
  assert.deepEqual(r.partialWeek, { weekStart: '2026-07-13', count: 1, medianLikes: 999 });
});

test('computeWeeklyTrend: 판정 — 기준 명시 + up/down/flat 경계값(+50%/−33%)', () => {
  // 직전 3주(기준): 매주 6건·좋아요 100 / 최근 완성 주를 바꿔가며 판정 확인
  const base = ['2026-06-15', '2026-06-22', '2026-06-29']
    .flatMap((w) => [100, 100, 100, 100, 100, 100].map((l) => tw(w, l)));
  const up = computeWeeklyTrend([...base, ...Array.from({ length: 9 }, (_, i) => tw('2026-07-06', 150 + i))], NOW);
  assert.equal(up.judgment, '직전 3주 평균과 비교해 게시량은 늘어나는 중 · 반응은 뜨거워지는 중이에요'); // 9/6=1.5
  assert.equal(up.judgmentBasis, '직전 3주 평균 글 6건·좋아요 중앙값 100 → 최근 완성 주 글 9건·중앙값 154');
  const down = computeWeeklyTrend([...base, tw('2026-07-06', 60), tw('2026-07-06', 60), tw('2026-07-06', 60), tw('2026-07-06', 60)], NOW);
  assert.equal(down.judgment, '직전 3주 평균과 비교해 게시량은 줄어드는 중 · 반응은 줄어드는 중이에요');
  const flat = computeWeeklyTrend([...base, ...[100, 100, 100, 100, 100, 100].map((l) => tw('2026-07-06', l))], NOW);
  assert.equal(flat.judgment, '직전 3주 평균과 비교해 게시량은 유지 · 반응은 비슷해요');
});

test('computeWeeklyTrend: 표본 부족 2단계', () => {
  // 데이터 주 2개 → insufficient, 판정 없음
  const thin = computeWeeklyTrend([tw('2026-07-06', 10), tw('2026-06-29', 10)], NOW);
  assert.equal(thin.sufficiency, 'insufficient');
  assert.equal(thin.dataWeeks, 2);
  assert.equal(thin.judgment, null);
  // 데이터 주 4개인데 주당 1~2건 → sparse, 판정 유보
  const sparse = computeWeeklyTrend(
    ['2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06'].flatMap((w) => [tw(w, 10), tw(w, 20)]), NOW);
  assert.equal(sparse.sufficiency, 'sparse');
  assert.equal(sparse.judgment, null);
  // 빈 입력 — 8슬롯 0 채움, 집계 중 없음, 판정 없음
  const empty = computeWeeklyTrend([], NOW);
  assert.equal(empty.sufficiency, 'insufficient');
  assert.equal(empty.weekly.length, 8);
  assert.equal(empty.partialWeek, null);
  assert.equal(empty.judgment, null);
});

test('computeTopicTrend: 격주 비교·빈 주제 생략·정렬', () => {
  const topics = [{ id: 'a', label: '루메카' }, { id: 'b', label: '니키비 케어' }, { id: 'c', label: '빈 주제' }];
  const tweets = [
    // 직전 격주(6/15~6/28): 루메카 고반응
    tw('2026-06-15', 9000, 'a'), tw('2026-06-22', 5000, 'a'),
    // 최근 격주(6/29~7/12): 루메카 급랭
    tw('2026-06-29', 60, 'a'), tw('2026-07-06', 20, 'a'),
    // 니키비 케어: 유지
    tw('2026-06-15', 800, 'b'), tw('2026-06-29', 900, 'b'),
    tw('2026-07-13', 777, 'a'), // 집계 중 주 — 격주 계산에서 제외
  ];
  const rows = computeTopicTrend(tweets, topics, NOW);
  assert.deepEqual(rows.map((r) => r.topicId), ['b', 'a']);               // 최근 중앙값 내림차순
  const a = rows.find((r) => r.topicId === 'a')!;
  assert.equal(a.direction, 'down');
  assert.equal(a.judgment, '식는 중');
  assert.deepEqual(a.recent, { count: 2, medianLikes: 40 });
  assert.deepEqual(a.previous, { count: 2, medianLikes: 7000 });
  const b = rows.find((r) => r.topicId === 'b')!;
  assert.equal(b.judgment, '유지');
  assert.equal(rows.find((r) => r.topicId === 'c'), undefined);           // 표본 0 주제 생략
});

test('비정상 createdAt 문자열은 크래시 없이 조용히 제외', () => {
  assert.equal(weekStartJst('garbage-date'), '');
  const r = computeWeeklyTrend([{ tweetId: 'x', likes: 5, createdAt: 'not-a-date', topicId: null }], NOW);
  assert.equal(r.dataWeeks, 0);
  assert.equal(r.partialWeek, null);
});

test('weeklyJudgment: 판정문 + 근거 분리 — 기준 주 부족 시 null, 기준 주 2개면 "직전 2주"', () => {
  const wk = (weekStart: string, count: number, medianLikes: number) => ({ weekStart, count, medianLikes });
  const j = weeklyJudgment([wk('a', 6, 100), wk('b', 6, 100), wk('c', 6, 100), wk('d', 9, 160)]);
  assert.equal(j!.text, '직전 3주 평균과 비교해 게시량은 늘어나는 중 · 반응은 뜨거워지는 중이에요');
  assert.equal(j!.basis, '직전 3주 평균 글 6건·좋아요 중앙값 100 → 최근 완성 주 글 9건·중앙값 160');
  const j2 = weeklyJudgment([wk('a', 0, 0), wk('b', 6, 100), wk('c', 8, 120), wk('d', 7, 110)]);
  assert.equal(j2!.text.startsWith('직전 2주 평균과 비교해'), true);  // 트윗 있는 주만 기준
  assert.equal(weeklyJudgment([wk('a', 6, 100)]), null);              // 1주뿐
  assert.equal(weeklyJudgment([wk('a', 0, 0), wk('b', 6, 100)]), null); // 기준 주 부족
});
