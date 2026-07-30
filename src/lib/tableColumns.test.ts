import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_COLUMNS, visibleColumns, exportColumns, cellDisplay, cellExport } from './tableColumns.ts';
import type { TableRow } from './types.ts';

const ROW: TableRow = {
  tweetId: '1234567890',
  columnTitles: ['니키비', 'PDRN'],
  authorHandle: 'tester', authorName: '테스터', authorFollowers: 128000,
  text: '첫 줄\n둘째 줄', tweetCreatedAt: '2026-07-11T04:05:06Z',
  metrics: { views: 128000, likes: 512, retweets: 34, replies: null, quotes: 0, bookmarks: 211 },
  savedBy: [{ id: 'm1', name: '박구건', color: '#111' }, { id: 'm2', name: '모에카', color: '#222' }],
  lastFetchedAt: '2026-07-30T01:02:03Z',
};

test('기본은 8칸, 더보기를 켜면 14칸', () => {
  assert.equal(visibleColumns(false).length, 8);
  assert.equal(visibleColumns(true).length, 14);
  assert.equal(TABLE_COLUMNS.length, 14);
});

test('기본 8칸의 순서와 구성이 설계와 같다', () => {
  assert.deepEqual(visibleColumns(false).map((c) => c.key),
    ['columns', 'handle', 'date', 'text', 'views', 'likes', 'retweets', 'link']);
});

test('내보내기 칸은 접혀 있어도 기준(fetchedAt)을 항상 포함한다', () => {
  const keys = exportColumns(false).map((c) => c.key);
  assert.ok(keys.includes('fetchedAt'), '기준 시각 없는 지표 표는 잘못된 비교가 된다');
  assert.equal(keys.length, 9); // 기본 8 + 기준
  // 더보기를 켜도 중복되지 않는다
  assert.equal(exportColumns(true).length, 14);
});

test('지표는 화면에선 축약, 내보내기는 원숫자 — 엑셀에서 계산되어야 한다', () => {
  const views = TABLE_COLUMNS.find((c) => c.key === 'views')!;
  assert.equal(cellDisplay(ROW, views), '128K');
  assert.equal(cellExport(ROW, views), '128000');
});

test('값이 없는 지표는 내보낼 때 0이 아니라 빈칸 (0은 평균을 왜곡한다)', () => {
  const replies = TABLE_COLUMNS.find((c) => c.key === 'replies')!;
  assert.equal(cellExport(ROW, replies), '');
  // 0은 0으로 나간다 — 모름과 다르다
  const quotes = TABLE_COLUMNS.find((c) => c.key === 'quotes')!;
  assert.equal(cellExport(ROW, quotes), '0');
});

test('날짜는 양쪽 다 YYYY-MM-DD — 상대 표기(2시간 전)를 쓰지 않는다', () => {
  const date = TABLE_COLUMNS.find((c) => c.key === 'date')!;
  assert.equal(cellDisplay(ROW, date), '2026-07-11');
  assert.equal(cellExport(ROW, date), '2026-07-11');
});

test('기준(fetchedAt)은 날짜만이 아니라 시:분까지 — 같은 날 다른 시각에 새로고침한 열이 같은 값으로 보이면 안 된다', () => {
  const fetchedAt = TABLE_COLUMNS.find((c) => c.key === 'fetchedAt')!;
  assert.equal(cellDisplay(ROW, fetchedAt), '2026-07-30 01:02');
  assert.equal(cellExport(ROW, fetchedAt), '2026-07-30 01:02');
});

test('열·저장은 여러 값을 셀 하나에 쉼표로 담는다', () => {
  const cols = TABLE_COLUMNS.find((c) => c.key === 'columns')!;
  const saved = TABLE_COLUMNS.find((c) => c.key === 'saved')!;
  assert.equal(cellExport(ROW, cols), '니키비, PDRN');
  assert.equal(cellExport(ROW, saved), '박구건, 모에카');
});

test('링크는 x.com 정규형 — 링크 복사 기능과 같은 주소가 나와야 한다', () => {
  const link = TABLE_COLUMNS.find((c) => c.key === 'link')!;
  assert.equal(cellExport(ROW, link), 'https://x.com/tester/status/1234567890');
});

test('본문은 화면에선 그대로 넘기고(말줄임은 CSS), 내보낼 때도 원문 그대로', () => {
  const text = TABLE_COLUMNS.find((c) => c.key === 'text')!;
  assert.equal(cellExport(ROW, text), '첫 줄\n둘째 줄');
});

test('정렬 가능한 칸은 7개 — 지표 6종 + 날짜', () => {
  const sortable = TABLE_COLUMNS.filter((c) => c.sort);
  assert.equal(sortable.length, 7);
  assert.deepEqual(sortable.map((c) => c.sort).sort(),
    ['bookmarks', 'date', 'likes', 'quotes', 'replies', 'retweets', 'views']);
});
