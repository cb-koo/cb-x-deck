import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { insertDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import { createTasks, getTask } from './campaignTaskStore.ts';
import { CANCEL_REASONS } from './campaignTaskInput.ts';

const sql = getSql();
const P = 'tcv2' + process.pid;
const content: DraftContent = { posts: [{ text: '취소 테스트', media: [] }] };

after(async () => {
  await sql`delete from influencer_log where influencer_id in (select id from influencer where handle like ${P + '%'})`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

export const mkCampaign = async (suffix: string) => {
  const c = await createClient(sql, P + '클라' + suffix);
  const camp = await createCampaign(sql, {
    clientId: c.id, clientName: c.name, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`,
    startsOn: '2026-09-14', endsOn: '2026-09-20', kind: null, note: '', createdBy: null,
  });
  return { c, camp };
};
export const mkDraft = (clientId: string, clientName: string, title: string | null = null) =>
  insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null, title,
  });
export const baseInput = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };

test('1) 취소 5필드 왕복 — 기본 null/빈 문자열, SQL로 찍은 값이 그대로 읽힌다', async () => {
  const { camp } = await mkCampaign('a');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'rt', items: [{ handle: P + '_a', cost: null }] });
  assert.equal(t.cancelledAt, null);
  assert.equal(t.cancelReason, null);
  assert.equal(t.cancelNote, '');
  assert.equal(t.cancelledDraftId, null);
  assert.equal(t.cancelledDraftTitle, null);
  await sql`update campaign_task set cancelled_at = '2026-09-16', cancel_reason = 'declined', cancel_note = '일정', cancelled_draft_title = '제목' where id = ${t.id}`;
  const r = await getTask(sql, t.id);
  assert.equal(r?.cancelledAt, '2026-09-16');
  assert.equal(r?.cancelReason, 'declined');
  assert.equal(r?.cancelNote, '일정');
  assert.equal(r?.cancelledDraftTitle, '제목');
  assert.deepEqual([...CANCEL_REASONS], ['declined', 'no_response', 'other']);
});

test('2) 상호 배제 check — 게시된 작업에 cancelled_at을 찍으면 23514', async () => {
  const { camp } = await mkCampaign('b');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: P + '_b', cost: null }] });
  await sql`update campaign_task set posted_at = '2026-09-15' where id = ${t.id}`;
  await assert.rejects(
    sql`update campaign_task set cancelled_at = '2026-09-16' where id = ${t.id}`,
    (e: unknown) => (e as { code?: string }).code === '23514',
  );
});
