import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_COLUMNS, cellDisplay, cellExport } from './tableColumns.ts';
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

// 칸 더보기 토글을 없애면서 8/14 분할을 검사하던 테스트가 사라졌다. 이제 사용자가 보는 것은
// 이 목록 그대로이므로, 개수와 순서를 여기서 고정한다 — 나머지 테스트는 전부 key로 개별 조회만 한다.
test('표는 이 14칸을 이 순서로 보여준다', () => {
  assert.deepEqual(TABLE_COLUMNS.map((c) => c.key), [
    'columns', 'handle', 'date', 'text', 'views', 'likes', 'retweets', 'link',
    'replies', 'quotes', 'bookmarks', 'followers', 'saved', 'fetchedAt',
  ]);
});

test('지표는 화면도 축약하지 않는다 — 표는 자리수를 눈으로 맞추는 화면 (카드뷰만 X식 축약 유지)', () => {
  const views = TABLE_COLUMNS.find((c) => c.key === 'views')!;
  assert.equal(cellDisplay(ROW, views), '128,000');   // 128K 아님
  assert.equal(cellExport(ROW, views), '128000');     // 내보내기는 콤마도 없는 원값(엑셀이 숫자로 인식)
  const followers = TABLE_COLUMNS.find((c) => c.key === 'followers')!;
  assert.equal(cellDisplay(ROW, followers), '128,000');
  assert.equal(cellExport(ROW, followers), '128000');
});

test('값이 없는 지표는 화면은 –, 내보낼 때는 0이 아니라 빈칸 (0은 평균을 왜곡한다)', () => {
  const replies = TABLE_COLUMNS.find((c) => c.key === 'replies')!;
  assert.equal(cellDisplay(ROW, replies), '–');
  assert.equal(cellExport(ROW, replies), '');
  // 0은 0으로 나간다 — 모름과 다르다
  const quotes = TABLE_COLUMNS.find((c) => c.key === 'quotes')!;
  assert.equal(cellExport(ROW, quotes), '0');
});

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

test('파싱할 수 없는 시각은 빈칸 — 셀 하나 때문에 표 전체가 죽으면 안 된다', () => {
  const date = TABLE_COLUMNS.find((c) => c.key === 'date')!;
  const fetchedAt = TABLE_COLUMNS.find((c) => c.key === 'fetchedAt')!;
  const broken = { ...ROW, tweetCreatedAt: '날짜아님', lastFetchedAt: '날짜아님' };
  assert.equal(cellDisplay(broken, date), '');
  assert.equal(cellDisplay(broken, fetchedAt), '');
  assert.equal(cellExport(broken, fetchedAt), '');
});

test('칸 이름은 무엇의 기준인지·무엇의 이름인지 말한다', () => {
  assert.equal(TABLE_COLUMNS.find((c) => c.key === 'fetchedAt')!.label, '최종 수집 시간');
  assert.equal(TABLE_COLUMNS.find((c) => c.key === 'columns')!.label, '컬럼명');
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
