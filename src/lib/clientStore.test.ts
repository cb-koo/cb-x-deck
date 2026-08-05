import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import {
  createClient, listClients, getClientWithProcedures, updateClient, deleteClient,
  createProcedure, updateProcedure, deleteProcedure,
} from './clientStore.ts';

const sql = getSql();
const P = 'test-cl-' + process.pid + '-';

after(async () => {
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

test('client CRUD 왕복 + banned_phrases 배열', async () => {
  const c = await createClient(sql, P + 'A클리닉');
  assert.equal(c.name, P + 'A클리닉');
  assert.deepEqual(c.bannedPhrases, []);

  await updateClient(sql, c.id, { info: '개원 10년', bannedPhrases: ['B클리닉'] });
  const got = await getClientWithProcedures(sql, c.id);
  assert.equal(got!.client.info, '개원 10년');
  assert.deepEqual(got!.client.bannedPhrases, ['B클리닉']);
  assert.deepEqual(got!.procedures, []);

  assert.ok((await listClients(sql)).some((x) => x.id === c.id));
  await deleteClient(sql, c.id);
  assert.equal(await getClientWithProcedures(sql, c.id), null);
});

test('procedure CRUD + client 삭제 시 cascade', async () => {
  const c = await createClient(sql, P + 'B클리닉');
  const p = await createProcedure(sql, c.id, { name: '보톡스', description: '주름 완화', effectPhrases: '표정 주름이 부드러워짐' });
  assert.equal(p.clientId, c.id);

  await updateProcedure(sql, p.id, { effectPhrases: '눈가 주름 완화', bannedPhrases: ['半永久'] });
  const got = await getClientWithProcedures(sql, c.id);
  assert.equal(got!.procedures.length, 1);
  assert.equal(got!.procedures[0].effectPhrases, '눈가 주름 완화');
  assert.deepEqual(got!.procedures[0].bannedPhrases, ['半永久']);

  await deleteProcedure(sql, p.id);
  assert.equal((await getClientWithProcedures(sql, c.id))!.procedures.length, 0);

  const p2 = await createProcedure(sql, c.id, { name: '리쥬란' });
  await deleteClient(sql, c.id);
  const orphan = await sql`select id from client_procedure where id = ${p2.id}`;
  assert.equal(orphan.length, 0); // cascade
});
