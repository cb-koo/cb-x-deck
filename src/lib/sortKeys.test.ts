import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SORT_LABEL, DECK_SORTS, dirText, dirLabel } from './sortKeys.ts';
import type { SortKey } from './types.ts';

test('정렬 키 7종 모두 라벨이 있다 (표 머리글이 빈칸이 되면 안 됨)', () => {
  const keys: SortKey[] = ['views', 'date', 'bookmarks', 'retweets', 'likes', 'replies', 'quotes'];
  for (const k of keys) assert.ok(SORT_LABEL[k]?.trim(), `라벨 없음: ${k}`);
});

test('덱이 노출하는 정렬 탭은 정확히 4개 — 표 때문에 덱 UI가 늘어나면 안 된다', () => {
  assert.deepEqual(DECK_SORTS, ['views', 'date', 'bookmarks', 'retweets']);
});

test('방향 문구는 날짜만 최신/오래된, 나머지는 많은/적은', () => {
  assert.equal(dirText('date', 'desc'), '최신순');
  assert.equal(dirText('date', 'asc'), '오래된순');
  assert.equal(dirText('views', 'desc'), '많은순');
  assert.equal(dirText('likes', 'asc'), '적은순');
});

test('dirLabel은 현재 상태와 다시 누르면 뒤집힌다는 안내를 함께 준다', () => {
  assert.equal(dirLabel('views', 'desc'), '조회수 많은순 — 다시 누르면 정렬 순서가 바뀝니다');
});
