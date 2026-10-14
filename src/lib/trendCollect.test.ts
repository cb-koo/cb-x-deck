import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, parseKpRow, matchRows, toSeries } from './trendCollect.ts';

test('달 더하기 — 해 넘김', () => {
  assert.equal(addMonths('2026-08', -47), '2022-09');
  assert.equal(addMonths('2026-12', 1), '2027-01');
});

test('키워드 플래너 응답 — 달 이름을 YYYY-MM으로, 값 없으면 null', () => {
  const r = parseKpRow({ text: 'エラ ボトックス', closeVariants: ['エラボトックス'], keywordMetrics: { monthlySearchVolumes: [{ year: 2026, month: 'JULY', monthlySearches: '880' }, { year: 2026, month: 'AUGUST', monthlySearches: 720 }] } });
  assert.deepEqual(r.months, [['2026-07', 880], ['2026-08', 720]]);
  assert.equal(parseKpRow({ text: 'ミラドライ' }).months, null);
});

test('요청 ↔ 응답 맞추기 — 응답은 띄어쓰기를 다시 넣어 오고, 유사 표기로도 맞춘다', () => {
  const rows = [
    { text: 'エラ ボトックス', closeVariants: [], months: null },
    { text: 'ほくろ 除去', closeVariants: ['ほくろ除去'], months: null },
  ];
  const m = matchRows(['エラボトックス', 'ほくろ除去', 'ニキビ治療'], rows);
  assert.equal(m.get('エラボトックス')?.text, 'エラ ボトックス');
  assert.equal(m.get('ほくろ除去')?.text, 'ほくろ 除去');
  assert.equal(m.has('ニキビ治療'), false);
});

test('창에 맞춘 검색량 — 한 달이라도 비면 값 없음', () => {
  const r = { text: 'x', closeVariants: [], months: [['2026-06', 1], ['2026-07', 2], ['2026-08', 3]] as Array<[string, number]> };
  assert.deepEqual(toSeries(r, '2026-06', '2026-08'), [1, 2, 3]);
  assert.equal(toSeries(r, '2026-05', '2026-08'), null);
  assert.equal(toSeries(undefined, '2026-06', '2026-08'), null);
});
