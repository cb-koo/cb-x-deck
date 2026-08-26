// src/lib/performanceJudgment.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sampleState, wilsonLower, rate, formatPct, groupByInfluencer, topShare, sortRows, SAMPLE_EARLY, SAMPLE_REF,
} from './performanceJudgment.ts';

const row = (key: string, taps: number, arrivals: number, over: Partial<{ views: number | null; clicks: number | null; influencerHandle: string; postedAt: string | null }> = {}) => ({
  key, title: key, influencerHandle: 'h', contentCount: 1, views: 1000, clicks: 100, arrivals, taps, postedAt: '2026-08-24T00:00:00Z', ...over,
});

test('표본 상태: 19 early · 20 ref · 49 ref · 50 ok', () => {
  assert.equal(sampleState(SAMPLE_EARLY - 1), 'early');
  assert.equal(sampleState(SAMPLE_EARLY), 'ref');
  assert.equal(sampleState(SAMPLE_REF - 1), 'ref');
  assert.equal(sampleState(SAMPLE_REF), 'ok');
});

test('Wilson 하한: 1/1이 100/101보다 아래(Miller 예), 표본이 클수록 관측치에 가깝다, n=0은 -1', () => {
  assert.ok(wilsonLower(1, 1) < wilsonLower(100, 101));
  assert.ok(wilsonLower(61, 412) > wilsonLower(8, 80));
  assert.ok(wilsonLower(2, 2) > wilsonLower(8, 80)); // 통계적으로는 2/2가 위 — 그래서 정렬은 표본 배지로 한 번 더 걸러야 한다(아래 정렬 테스트)
  assert.equal(wilsonLower(0, 0), -1);
  assert.ok(wilsonLower(0, 10) >= 0);
});

test('rate·formatPct: 분모 0/null은 null → "—", 정수%·소수 1자리', () => {
  assert.equal(rate(61, 412)!.toFixed(4), '0.1481');
  assert.equal(rate(5, 0), null); assert.equal(rate(null, 10), null);
  assert.equal(formatPct(0.1481), '15%');
  assert.equal(formatPct(0.058, 1), '5.8%');
  assert.equal(formatPct(null), '—');
});

test('정렬: 기본 탭 desc · 탭률은 표본 부족(도착<20) 행을 방향 무관하게 뒤로, 그 안에서 Wilson 하한 · 값 없는 행은 맨 뒤', () => {
  const rows = [row('a', 2, 2), row('b', 8, 80), row('c', 0, 0), row('d', 61, 412, { views: null, clicks: null }), row('e', 3, 10)];
  assert.deepEqual(sortRows(rows, 'taps', 'desc').map((r) => r.key), ['d', 'b', 'e', 'a', 'c']);
  // desc: 충분한 표본(d,b) 하한 순 → 부족한 표본(a,e) 하한 순 → 도착 0(c)
  assert.deepEqual(sortRows(rows, 'tapRate', 'desc').map((r) => r.key), ['d', 'b', 'a', 'e', 'c']);
  // asc: 방향이 바뀌어도 부족한 표본은 여전히 뒤
  assert.deepEqual(sortRows(rows, 'tapRate', 'asc').map((r) => r.key), ['b', 'd', 'e', 'a', 'c']);
  assert.equal(sortRows(rows, 'clickRate', 'desc').map((r) => r.key).at(-1), 'd');  // 조회 없음은 맨 뒤
  assert.equal(sortRows(rows, 'clickRate', 'asc').map((r) => r.key).at(-1), 'd');
});

test('결정 문장: 상위 3개 기여 합, 탭 0이면 share null', () => {
  const rows = [row('a', 61, 400), row('b', 22, 200), row('c', 19, 200), row('d', 17, 100), row('e', 24, 100)];
  const t = topShare(rows);
  assert.deepEqual(t.titles, ['a', 'e', 'b']);
  assert.equal(Math.round(t.share! * 100), 75); // (61+24+22)/143
  assert.deepEqual(topShare([row('z', 0, 10)]), { share: null, titles: [] });
});

test('인플루언서 묶기: 합산·콘텐츠 수, 조회는 null 섞이면 있는 것만 합', () => {
  const rows = [
    row('a', 61, 412, { influencerHandle: 'hana_kim', views: 12400, clicks: 720 }),
    row('b', 19, 280, { influencerHandle: 'Hana_Kim', views: 38000, clicks: 510 }),
    row('c', 17, 96, { influencerHandle: 'yuki_jp', views: null, clicks: 190 }),
  ];
  const g = groupByInfluencer(rows);
  const hana = g.find((r) => r.influencerHandle === 'hana_kim')!;
  assert.deepEqual([hana.contentCount, hana.views, hana.clicks, hana.arrivals, hana.taps], [2, 50400, 1230, 692, 80]);
  assert.equal(g.find((r) => r.influencerHandle === 'yuki_jp')!.views, null);
});
