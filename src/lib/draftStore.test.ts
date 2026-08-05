import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { insertDraft, listDrafts, getDraft, updateDraft, removeDraft } from './draftStore.ts';
import { createClient, deleteClient } from './clientStore.ts';
import type { DraftContent } from './draftTypes.ts';

const sql = getSql();
const P = 'test-dr-' + process.pid + '-';
const content: DraftContent = { posts: [{ text: '正直迷ってた。\n\nでも良かった。', media: [] }] };

after(async () => {
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

test('insert→list→get→update(edited·dismissed)→remove 왕복 + 스냅샷', async () => {
  const c = await createClient(sql, P + 'A클리닉');
  const id = await insertDraft(sql, {
    clientId: c.id, clientName: c.name, procedureNames: ['보톡스'],
    direction: P + '다운타임 강조', format: 'single', referenceMode: 'both',
    refs: [{ tweetId: 't1', handle: 'mika', name: 'みか', excerpt: '正直迷ってた',
             memos: [{ member: '박구건', text: '앵글이 신선' }] }],
    content, model: 'claude-opus-5', memberId: null,
  });

  const list = await listDrafts(sql, { clientId: c.id });
  assert.equal(list.length, 1);
  assert.equal(list[0].clientName, c.name);
  assert.deepEqual(list[0].procedureNames, ['보톡스']);
  assert.equal(list[0].refs[0].memos[0].text, '앵글이 신선');
  assert.equal(list[0].edited, null);
  assert.equal(list[0].model, 'claude-opus-5');

  // 클라이언트 삭제 후에도 스냅샷으로 재현 (client_id는 set null)
  await deleteClient(sql, c.id);
  const afterDel = await getDraft(sql, id);
  assert.equal(afterDel!.clientId, null);
  assert.equal(afterDel!.clientName, c.name);

  const edited: DraftContent = { posts: [{ text: '修正版', media: [] }] };
  await updateDraft(sql, id, { edited, dismissedFlags: ['yakkiho:効果がある'] });
  const got = await getDraft(sql, id);
  assert.deepEqual(got!.edited, edited);
  assert.deepEqual(got!.content, content);          // 원본 불변
  assert.deepEqual(got!.dismissedFlags, ['yakkiho:効果がある']);
  assert.deepEqual(got!.history, []);               // 기본값
  assert.equal(got!.translation, null);

  // 버전 이력 + 번역 캐시(버전별 맵) 왕복 (부분 패치 — 서로를 덮지 않음)
  await updateDraft(sql, id, { history: [content] });
  await updateDraft(sql, id, { translation: { h1: ['수정판'], h2: ['원본판'] } });
  const got2 = await getDraft(sql, id);
  assert.deepEqual(got2!.history, [content]);
  assert.deepEqual(got2!.translation, { h1: ['수정판'], h2: ['원본판'] });
  assert.deepEqual(got2!.edited, edited);           // edited는 그대로

  await removeDraft(sql, id);
  assert.equal(await getDraft(sql, id), null);
});
