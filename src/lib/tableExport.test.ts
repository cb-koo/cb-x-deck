import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTsv, toCsv, CSV_BOM } from './tableExport.ts';
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

test('TSV 첫 줄은 머리글, 칸은 탭으로 갈라진다', () => {
  const cols = visibleColumns(false);
  const out = toTsv([row()], cols);
  const [head, first] = out.split('\n');
  assert.deepEqual(head.split('\t'), ['열', '계정', '날짜', '본문', '조회수', '좋아요', 'RT', '링크']);
  assert.equal(first.split('\t').length, 8);
});

test('TSV는 셀 안 줄바꿈·탭을 공백으로 바꾼다 (탭 구분이 깨지면 셀이 어긋난다)', () => {
  const out = toTsv([row({ text: '첫 줄\n둘째\t줄' })], visibleColumns(false));
  const body = out.split('\n')[1];
  assert.equal(out.split('\n').length, 2, '본문 줄바꿈이 행을 쪼개면 안 된다');
  assert.ok(body.includes('첫 줄 둘째 줄'), body);
});

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

test('행이 없어도 머리글은 나온다 (빈 표를 붙여도 칸 이름은 남아야 한다)', () => {
  const out = toTsv([], visibleColumns(false));
  assert.equal(out.split('\n').length, 1);
  assert.ok(out.startsWith('열\t계정'));
});

test('내보내기 칸을 쓰면 기준 칸이 마지막에 붙는다', () => {
  const out = toTsv([row()], exportColumns(false));
  const head = out.split('\n')[0].split('\t');
  assert.equal(head[head.length - 1], '기준');
  const body = out.split('\n')[1].split('\t');
  assert.equal(body[body.length - 1], '2026-07-30');
});
