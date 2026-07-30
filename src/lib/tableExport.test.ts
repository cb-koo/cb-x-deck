import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, CSV_BOM } from './tableExport.ts';
import { visibleColumns, exportColumns } from './tableColumns.ts';
import type { TableRow } from './types.ts';

function row(over: Partial<TableRow> = {}): TableRow {
  return {
    tweetId: '111', columnTitles: ['A'], authorHandle: 'h', authorName: null, authorFollowers: 10,
    text: 'plain', tweetCreatedAt: '2026-07-11T00:00:00Z',
    metrics: { views: 5, likes: 4, retweets: 3, replies: 2, quotes: 1, bookmarks: 0 },
    savedBy: [], lastFetchedAt: '2026-07-30T00:00:00Z', ...over,
  };
}

test('CSV는 줄바꿈·쉼표·따옴표를 따옴표로 감싸 보존한다', () => {
  const out = toCsv([row({ text: 'a,b "q"\n다음 줄' })], visibleColumns(false));
  assert.ok(out.includes('"a,b ""q""\n다음 줄"'), out);
});

test('CSV는 BOM으로 시작한다 (없으면 엑셀이 일본어를 깬다)', () => {
  const out = toCsv([row()], visibleColumns(false));
  assert.ok(out.startsWith(CSV_BOM), 'BOM 없음');
  assert.equal(CSV_BOM, '﻿');
});

test('CSV 줄 구분은 CRLF (엑셀 호환)', () => {
  const out = toCsv([row(), row()], visibleColumns(false));
  assert.ok(out.includes('\r\n'), out.slice(0, 80));
});

test('행이 없어도 머리글은 나온다 (빈 표를 받아도 칸 이름은 남아야 한다)', () => {
  const out = toCsv([], visibleColumns(false));
  const body = out.slice(CSV_BOM.length);
  assert.equal(body.split('\r\n').length, 1);
  assert.ok(body.startsWith('열,계정'));
});

test('CSV는 =로 시작하는 본문을 홑따옴표로 고정한다 (엑셀 수식 주입 방지)', () => {
  const out = toCsv([row({ text: '=SUM(A1:A2)' })], visibleColumns(false));
  const body = out.split('\r\n')[1];
  assert.ok(body.includes(`'=SUM(A1:A2)`), body);
});

test('CSV는 @로 시작하는 계정 칸도 홑따옴표로 고정한다', () => {
  const out = toCsv([row({ authorHandle: 'danger' })], visibleColumns(false));
  const body = out.split('\r\n')[1];
  assert.ok(body.includes(`'@danger`), body);
});

test('내보내기 칸을 쓰면 기준 칸이 마지막에 붙는다', () => {
  const out = toCsv([row()], exportColumns(false));
  const head = out.split('\r\n')[0].split(',');
  assert.equal(head[head.length - 1], '기준');
  const body = out.split('\r\n')[1].split(',');
  // 기준은 날짜만이 아니라 시:분까지 나온다(설계 §E) — row()의 lastFetchedAt은 '2026-07-30T00:00:00Z'
  assert.equal(body[body.length - 1], '2026-07-30 00:00');
});
