import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import {
  createClient, listClients, getClientWithProcedures, updateClient, deleteClient,
  createProcedure, updateProcedure, deleteProcedure, setBudgetOverride, getClientBudget,
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

test('landing_url — 저장·조회 왕복, 기본값은 빈 문자열', async () => {
  const c = await createClient(sql, P + '랜딩');
  assert.equal(c.landingUrl, '');
  await updateClient(sql, c.id, { landingUrl: 'https://clinic.example.com/event' });
  const got = await getClientWithProcedures(sql, c.id);
  assert.equal(got!.client.landingUrl, 'https://clinic.example.com/event');
  // 다른 필드 patch가 landing_url을 지우지 않는다(coalesce)
  await updateClient(sql, c.id, { info: '정보' });
  assert.equal((await getClientWithProcedures(sql, c.id))!.client.landingUrl, 'https://clinic.example.com/event');
});

test('name_en — 저장·조회 왕복, 기본값은 빈 문자열, 다른 patch가 지우지 않는다', async () => {
  const c = await createClient(sql, P + '영문');
  assert.equal(c.nameEn, '');
  await updateClient(sql, c.id, { nameEn: 'yonsei-clinic' });
  assert.equal((await getClientWithProcedures(sql, c.id))!.client.nameEn, 'yonsei-clinic');
  await updateClient(sql, c.id, { info: '정보' }); // coalesce 보존
  assert.equal((await getClientWithProcedures(sql, c.id))!.client.nameEn, 'yonsei-clinic');
});

test('월 예산: 기본값 설정·null=지움·예외 달 설정/삭제·updated_at 갱신', async () => {
  const c = await createClient(sql, P + '예산클리닉');
  assert.equal(c.monthlyBudget, null);          // 생성 직후 미설정
  assert.deepEqual(c.budgetOverrides, {});

  await updateClient(sql, c.id, { monthlyBudget: 3_000_000 });
  let got = (await getClientWithProcedures(sql, c.id))!.client;
  assert.equal(got.monthlyBudget, 3_000_000);

  // 다른 필드만 패치하면 예산은 그대로(undefined = 건드리지 않음)
  await updateClient(sql, c.id, { info: '변경' });
  got = (await getClientWithProcedures(sql, c.id))!.client;
  assert.equal(got.monthlyBudget, 3_000_000);

  // 예외 달 두 개 — 서로 덮지 않는다
  await setBudgetOverride(sql, c.id, '2026-08', 2_500_000);
  await setBudgetOverride(sql, c.id, '2026-09', 4_000_000);
  got = (await getClientWithProcedures(sql, c.id))!.client;
  assert.deepEqual(got.budgetOverrides, { '2026-08': 2_500_000, '2026-09': 4_000_000 });

  // 예외 삭제(null) → 키가 사라진다. 없는 달을 지워도 오류 없음
  await setBudgetOverride(sql, c.id, '2026-08', null);
  await setBudgetOverride(sql, c.id, '2027-01', null);
  got = (await getClientWithProcedures(sql, c.id))!.client;
  assert.deepEqual(got.budgetOverrides, { '2026-09': 4_000_000 });

  // 기본값 지움(null) — 예외는 남는다
  await updateClient(sql, c.id, { monthlyBudget: null });
  got = (await getClientWithProcedures(sql, c.id))!.client;
  assert.equal(got.monthlyBudget, null);
  assert.deepEqual(got.budgetOverrides, { '2026-09': 4_000_000 });

  // getClientBudget — 캠페인 상세가 쓰는 가벼운 조회. 없는 id는 null
  assert.deepEqual(await getClientBudget(sql, c.id), { monthlyBudget: null, budgetOverrides: { '2026-09': 4_000_000 } });
  assert.equal(await getClientBudget(sql, '00000000-0000-0000-0000-000000000000'), null);

  // 예외 저장이 updated_at을 끌어올린다(시술 변경과 같은 격)
  await sql`update client set updated_at = now() - interval '1 hour' where id = ${c.id}`;
  await setBudgetOverride(sql, c.id, '2026-10', 1);
  const after = (await getClientWithProcedures(sql, c.id))!.client;
  assert.ok(Date.now() - new Date(after.updatedAt).getTime() < 60_000);

  // jsonb에 이상한 값이 섞여 있어도 읽기가 죽지 않고 검증 통과분만 남는다
  await sql`update client set budget_overrides = '{"2026-11": 5, "bad": 1, "2026-12": -3, "2026-13": 7}'::jsonb where id = ${c.id}`;
  got = (await getClientWithProcedures(sql, c.id))!.client;
  assert.deepEqual(got.budgetOverrides, { '2026-11': 5 });
});
