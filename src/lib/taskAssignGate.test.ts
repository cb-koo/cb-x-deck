import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createInfluencer } from './influencerStore.ts';
import { rosterHandleOf } from './taskAssignGate.ts';

const sql = getSql();
const P = 'tgate' + process.pid;

after(async () => {
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql.end();
});

test('1) 명부 판정 — 대소문자 무관, 명부 표기를 돌려준다, 없으면 null', async () => {
  await createInfluencer(sql, { handle: P + '_Sakura', createdBy: null });
  assert.equal(await rosterHandleOf(sql, P + '_sakura'), P + '_Sakura');
  assert.equal(await rosterHandleOf(sql, P + '_SAKURA'), P + '_Sakura');
  assert.equal(await rosterHandleOf(sql, P + '_nobody'), null);
});
