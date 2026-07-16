import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { saveBriefing, listBriefings, getBriefing, removeBriefing } from './briefingStore.ts';
import { createColumn, deleteColumn } from './columnStore.ts';
import { createWorkspace, deleteWorkspace } from './workspaceStore.ts';
import type { BriefingContent } from './briefingTypes.ts';

const sql = getSql();
const P = 'test-bf-' + process.pid + '-';

const content: BriefingContent = {
  tldr: ['한 줄', '두 줄', '세 줄'],
  body: '## 핵심 화두\n니키비 얘기 [T1]',
  citations: [{ n: 1, tweetId: 'x1', text: '본문', likes: 10, url: null, flags: [] }],
  stats: { periodFrom: '2026-06-15', periodTo: '2026-07-12', totalCount: 42,
           weekly: [{ weekStart: '2026-06-15', count: 42, medianLikes: 100 }] },
};

after(async () => {
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql.end();
});

test('saveBriefing→listBriefings→getBriefing→removeBriefing 왕복', async () => {
  const ws = await createWorkspace(sql, P + 'ws');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'search', title: P + 'col', config: { keywords: ['毛穴'] },
  });
  try {
    const id = await saveBriefing(sql, {
      workspaceId: ws.id, columnId: col.id,
      periodFrom: '2026-06-15', periodTo: '2026-07-12',
      sampleSize: 42, content, model: 'test-model', memberId: null,
    });
    assert.ok(id);

    const list = await listBriefings(sql, ws.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id);
    assert.equal(list[0].columnTitle, P + 'col');
    assert.equal(list[0].periodFrom, '2026-06-15');
    assert.equal(list[0].sampleSize, 42);
    assert.equal(list[0].member, null);

    const full = await getBriefing(sql, id);
    assert.deepEqual(full!.content, content);
    assert.equal(full!.model, 'test-model');

    await removeBriefing(sql, id);
    assert.equal(await getBriefing(sql, id), null);
    assert.equal((await listBriefings(sql, ws.id)).length, 0);
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('컬럼 삭제 시 브리핑도 연쇄 삭제(cascade)', async () => {
  const ws = await createWorkspace(sql, P + 'ws2');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'search', title: P + 'col2', config: { keywords: ['a'] },
  });
  try {
    await saveBriefing(sql, {
      workspaceId: ws.id, columnId: col.id, periodFrom: '2026-06-15', periodTo: '2026-07-12',
      sampleSize: 1, content, model: null, memberId: null,
    });
    await deleteColumn(sql, col.id);
    assert.equal((await listBriefings(sql, ws.id)).length, 0);
  } finally {
    await deleteWorkspace(sql, ws.id);
  }
});
