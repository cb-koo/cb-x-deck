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

test('updated_at: 시술 추가·수정·삭제가 클라이언트 수정 시각을 끌어올린다', async () => {
  const c = await createClient(sql, P + 'U클리닉');
  assert.ok(c.updatedAt); // 생성 시 기본값

  // 벽시계 경합(같은 ms) 회피 — 1시간 전으로 되돌린 뒤 "방금으로 갱신됐는가"를 본다
  const backdate = () => sql`update client set updated_at = now() - interval '1 hour' where id = ${c.id}`;
  const freshness = async () => {
    const got = await getClientWithProcedures(sql, c.id);
    return Date.now() - new Date(got!.client.updatedAt).getTime();
  };

  await backdate();
  await updateClient(sql, c.id, { info: '수정' });
  assert.ok((await freshness()) < 60_000, 'updateClient가 갱신');

  await backdate();
  const p = await createProcedure(sql, c.id, { name: '필러' });
  assert.ok((await freshness()) < 60_000, 'createProcedure가 부모 갱신');

  await backdate();
  await updateProcedure(sql, p.id, { description: '볼륨' });
  assert.ok((await freshness()) < 60_000, 'updateProcedure가 부모 갱신');

  await backdate();
  await deleteProcedure(sql, p.id);
  assert.ok((await freshness()) < 60_000, 'deleteProcedure가 부모 갱신');

  await deleteClient(sql, c.id);
});

test('clinic_code 왕복 — 설정·해제·목록 노출', async () => {
  const c = await createClient(sql, P + 'C클리닉');
  assert.equal(c.clinicCode, null);
  await updateClient(sql, c.id, { clinicCode: P + 'code' });
  const got = await getClientWithProcedures(sql, c.id);
  assert.equal(got!.client.clinicCode, P + 'code');
  assert.ok((await listClients(sql)).some((x) => x.id === c.id && x.clinicCode === P + 'code'));
  await updateClient(sql, c.id, { clinicCode: null });
  assert.equal((await getClientWithProcedures(sql, c.id))!.client.clinicCode, null);
  await deleteClient(sql, c.id);
});
