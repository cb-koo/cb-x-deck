import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient, setClientActive, listClients } from './clientStore.ts';
import { createCampaignsBulk, BulkCampaignError } from './campaignStore.ts';
import { isActiveClient, activeClientsFor } from './clientActive.ts';

// ISSUE-013 클라이언트 비활성화(087)
const sql = getSql();
const P = 'tcla' + process.pid;
after(async () => {
  await sql`delete from campaign where client_name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

test('activeClientsFor — 비활성은 빼되 지금 고른 클라이언트는 남긴다', () => {
  const cs = [{ id: 'a', deactivatedAt: null }, { id: 'b', deactivatedAt: '2026-11-06T00:00:00.000Z' }];
  assert.deepEqual(activeClientsFor(cs).map((c) => c.id), ['a']);
  assert.deepEqual(activeClientsFor(cs, 'b').map((c) => c.id), ['a', 'b']);
  assert.equal(isActiveClient(cs[1]), false);
});

test('setClientActive — 비활성화는 누가·언제를 남기고, 다시 활성화하면 비운다. 비활성 클라이언트엔 한 번에 만들기가 거절된다', async () => {
  const c = await createClient(sql, P + '끝난곳');
  assert.equal(c.deactivatedAt, null);
  const [m] = await sql<Array<{ id: string }>>`select id from member limit 1`;   // 비활성화한 사람(member FK)
  const off = await setClientActive(sql, c.id, false, { id: m.id, name: '박구건' });
  assert.ok(off?.deactivatedAt);
  assert.equal(off?.deactivatedByName, '박구건');
  assert.ok((await listClients(sql)).find((x) => x.id === c.id)?.deactivatedAt);
  await assert.rejects(createCampaignsBulk(sql, { clientIds: [c.id], startsOn: '2026-11-09', endsOn: '2026-11-15', createdBy: null }),
    (e: unknown) => e instanceof BulkCampaignError && e.message.includes('비활성'));
  const on = await setClientActive(sql, c.id, true, { id: m.id, name: '박구건' });
  assert.equal(on?.deactivatedAt, null);
  assert.equal(on?.deactivatedByName, null);
  assert.equal((await createCampaignsBulk(sql, { clientIds: [c.id], startsOn: '2026-11-09', endsOn: '2026-11-15', createdBy: null })).length, 1);
});
