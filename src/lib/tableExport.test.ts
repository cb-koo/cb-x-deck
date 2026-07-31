import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, CSV_BOM } from './tableExport.ts';
import { TABLE_COLUMNS } from './tableColumns.ts';
import type { TableRow } from './types.ts';

// 칸 더보기 제거 전 visibleColumns(false)/exportColumns(false)가 반환하던 것과 같은 집합을
// TABLE_COLUMNS에서 key로 뽑아 고정한다 — CSV 픽스처용일 뿐이라 드리프트만 막으면 된다.
const BASE_KEYS = ['columns', 'handle', 'date', 'text', 'views', 'likes', 'retweets', 'link'];
const BASE_COLUMNS = BASE_KEYS.map((key) => TABLE_COLUMNS.find((c) => c.key === key)!);
const BASE_PLUS_FETCHED_AT = [...BASE_COLUMNS, TABLE_COLUMNS.find((c) => c.key === 'fetchedAt')!];

function row(over: Partial<TableRow> = {}): TableRow {
  return {
    tweetId: '111', columnTitles: ['A'], authorHandle: 'h', authorName: null, authorFollowers: 10,
    text: 'plain', tweetCreatedAt: '2026-07-11T00:00:00Z',
    metrics: { views: 5, likes: 4, retweets: 3, replies: 2, quotes: 1, bookmarks: 0 },
    savedBy: [], lastFetchedAt: '2026-07-30T00:00:00Z', ...over,
  };
}

test('CSV는 줄바꿈·쉼표·따옴표를 따옴표로 감싸 보존한다', () => {
  const out = toCsv([row({ text: 'a,b "q"\n다음 줄' })], BASE_COLUMNS);
  assert.ok(out.includes('"a,b ""q""\n다음 줄"'), out);
});

test('CSV는 BOM으로 시작한다 (없으면 엑셀이 일본어를 깬다)', () => {
  const out = toCsv([row()], BASE_COLUMNS);
  assert.ok(out.startsWith(CSV_BOM), 'BOM 없음');
  assert.equal(CSV_BOM, '﻿');
});

test('CSV 줄 구분은 CRLF (엑셀 호환)', () => {
  const out = toCsv([row(), row()], BASE_COLUMNS);
  assert.ok(out.includes('\r\n'), out.slice(0, 80));
});

test('행이 없어도 머리글은 나온다 (빈 표를 받아도 칸 이름은 남아야 한다)', () => {
  const out = toCsv([], BASE_COLUMNS);
  const body = out.slice(CSV_BOM.length);
  assert.equal(body.split('\r\n').length, 1);
  assert.ok(body.startsWith('컬럼명,계정'));
});

test('CSV는 =로 시작하는 본문을 홑따옴표로 고정한다 (엑셀 수식 주입 방지)', () => {
  const out = toCsv([row({ text: '=SUM(A1:A2)' })], BASE_COLUMNS);
  const body = out.split('\r\n')[1];
  assert.ok(body.includes(`'=SUM(A1:A2)`), body);
});

test('CSV는 @로 시작하는 계정 칸도 홑따옴표로 고정한다', () => {
  const out = toCsv([row({ authorHandle: 'danger' })], BASE_COLUMNS);
  const body = out.split('\r\n')[1];
  assert.ok(body.includes(`'@danger`), body);
});

test('내보내기 칸을 쓰면 최종 수집 시간 칸이 마지막에 붙는다', () => {
  const out = toCsv([row()], BASE_PLUS_FETCHED_AT);
  const head = out.split('\r\n')[0].split(',');
  assert.equal(head[head.length - 1], '최종 수집 시간');
  const body = out.split('\r\n')[1].split(',');
  // 최종 수집 시간은 날짜만이 아니라 시:분까지 나온다(설계 §E). row()의 lastFetchedAt은
  // '2026-07-30T00:00:00Z'이고, 표·CSV는 한국 시간으로 보여주므로 09:00이 된다.
  assert.equal(body[body.length - 1], '2026-07-30 09:00');
});
