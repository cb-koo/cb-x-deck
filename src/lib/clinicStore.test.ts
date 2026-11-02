// 지점 목록·대표 지점 — 합성 클라이언트(접두어 P)로 만들고 after에서 지운다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { listClinics, listClientLocations, representativeLocation, locationLabel, createLocation, updateLocation, deleteLocation, getClinic, saveClinicTemplate } from './clinicStore.ts';

const sql = getSql();
const P = 'tcs' + process.pid;

after(async () => {
  await sql`delete from visit_reservation where location_id in (select l.id from clinic_location l join client c on c.id = l.client_id where c.name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from clinic_location where client_id in (select id from client where name like ${P + '%'})`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

// 명동(본점, 2번) · 신사(지점, 1번, 중지) · 강남(지점, 3번)
async function branched(suffix: string) {
  const client = await createClient(sql, P + suffix);
  await sql`insert into clinic_location (client_id, kind, name, position, active) values
    (${client.id}, 'main', '명동점', 2, true), (${client.id}, 'branch', '신사점', 1, false), (${client.id}, 'branch', '강남점', 3, true)`;
  return client;
}

test('클라이언트 지점은 position 순이고 사용 중지는 기본 제외', async () => {
  const client = await branched('A');
  assert.deepEqual((await listClientLocations(sql, client.id)).map((l) => l.branchName), ['명동점', '강남점']);
  assert.deepEqual((await listClientLocations(sql, client.id, { activeOnly: false })).map((l) => l.branchName), ['신사점', '명동점', '강남점']);
});

test('대표 지점은 사용 중 가운데 순서 맨 앞', async () => {
  const client = await branched('B');
  assert.equal(representativeLocation(await listClientLocations(sql, client.id, { activeOnly: false }))?.branchName, '명동점');
  assert.equal(representativeLocation([]), null);
});

test('listClinics를 두 번 불러도 본점이 추가로 생기지 않는다', async () => {
  const client = await branched('C');
  await listClinics(sql); await listClinics(sql);
  assert.equal((await sql`select id from clinic_location where client_id = ${client.id}`).length, 3);
  assert.equal((await listClinics(sql)).filter((l) => l.clientId === client.id).length, 3);
});

test('지점이 1개면 branchName이 비고 라벨은 본점', async () => {
  const client = await createClient(sql, P + 'D');
  const row = (await listClinics(sql)).find((l) => l.clientId === client.id)!;
  assert.equal(row.branchName, '');
  assert.equal(row.kind, 'main');
  assert.equal(locationLabel(row), `${client.name} · 본점`);
});

const rejectsCode = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: { code?: string }) => e.code === code);

test('같은 이름 지점은 409', async () => {
  const client = await createClient(sql, P + 'E');
  const created = await createLocation(sql, client.id, { name: '명동점' });
  assert.equal(created.kind, 'branch');
  await rejectsCode(createLocation(sql, client.id, { name: ' 명동점 ' }), 'DUPLICATE_NAME');
  await rejectsCode(createLocation(sql, client.id, { name: '   ' }), 'INVALID_INPUT');
  // 이름 바꾸기도 같은 규칙 — 대소문자 무시, 자기 자신과는 충돌하지 않는다
  const other = await createLocation(sql, client.id, { name: 'Gangnam' });
  await rejectsCode(updateLocation(sql, other.id, { name: ' 명동점' }), 'DUPLICATE_NAME');
  assert.equal((await updateLocation(sql, other.id, { name: ' GANGNAM ' })).branchName, 'GANGNAM');
});

test('예약이 연결된 지점은 삭제 대신 409', async () => {
  const client = await branched('F');
  const [branch] = await sql<{ id: string }[]>`select id from clinic_location where client_id = ${client.id} and name = '강남점'`;
  const [camp] = await sql<{ id: string }[]>`insert into campaign (name, name_en, starts_on, ends_on) values (${P + 'F'}, ${P + 'f'}, '2026-11-01', '2026-11-30') returning id`;
  const [task] = await sql<{ id: string }[]>`insert into campaign_task (campaign_id, type) values (${camp.id}, 'visit') returning id`;
  await sql`insert into visit_reservation (task_id, location_id, sheet_text) values (${task.id}, ${branch.id}, 's')`;
  await rejectsCode(deleteLocation(sql, branch.id), 'HAS_RESERVATIONS');
  await updateLocation(sql, branch.id, { active: false });
  assert.deepEqual((await listClientLocations(sql, client.id)).map((l) => l.branchName), ['명동점']);
});

test('마지막 사용 중 지점은 중지 불가', async () => {
  const client = await createClient(sql, P + 'G');
  const [main] = await listClinics(sql).then((l) => l.filter((x) => x.clientId === client.id));
  await rejectsCode(updateLocation(sql, main.id, { active: false }), 'LAST_ACTIVE');
  const added = await createLocation(sql, client.id, { name: '신사점' });
  await updateLocation(sql, main.id, { active: false });
  await rejectsCode(updateLocation(sql, added.id, { active: false }), 'LAST_ACTIVE');
});

test('본점 행은 삭제하지 않는다', async () => {
  const client = await createClient(sql, P + 'H');
  const [main] = await listClinics(sql).then((l) => l.filter((x) => x.clientId === client.id));
  await rejectsCode(deleteLocation(sql, main.id), 'MAIN_LOCATION');
  const added = await createLocation(sql, client.id, { name: '신사점' });
  await deleteLocation(sql, added.id);
  assert.equal((await listClientLocations(sql, client.id, { activeOnly: false })).length, 1);
});

test('동시에 두 지점을 중지해도 사용 중 지점이 하나는 남는다', async () => {
  const client = await createClient(sql, P + 'I');
  const [main] = await listClinics(sql).then((l) => l.filter((x) => x.clientId === client.id));
  const added = await createLocation(sql, client.id, { name: '신사점' });
  const res = await Promise.allSettled([updateLocation(sql, main.id, { active: false }), updateLocation(sql, added.id, { active: false })]);
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await listClientLocations(sql, client.id)).length, 1);
});

// 양식 저장 — '다른 지점에도 적용'
let actorCache: { id: string; name: string; color: string } | null = null;
async function actorMember() {
  if (!actorCache) { const [m] = await sql<Array<{ id: string }>>`select id from member limit 1`; actorCache = { id: m?.id ?? null as never, name: 't', color: '#000' }; }
  return actorCache;
}
async function templateSetup(suffix: string) {
  const client = await createClient(sql, P + suffix);
  const [main] = await sql<Array<{ id: string }>>`insert into clinic_location (client_id, kind, name, position) values (${client.id}, 'main', '명동점', 1) returning id`;
  const [stopped] = await sql<Array<{ id: string }>>`insert into clinic_location (client_id, kind, name, position, active) values (${client.id}, 'branch', '신사점', 2, false) returning id`;
  await sql`insert into clinic_template_revision (location_id, kind, body, revision) values (${stopped.id}, 'form', '옛 양식', 2)`;
  return { main: main.id, stopped: stopped.id };
}
const bodyOf = async (id: string) => (await getClinic(sql, id)).templates.form;

test('다른 지점에도 적용하면 형제 지점에 같은 양식 리비전이 생긴다', async () => {
  const { main, stopped } = await templateSetup('T1');
  const actor = await actorMember();
  await sql.begin((tx) => saveClinicTemplate(tx as never, main, 'form', { body: '새 양식' }, 1, actor, { applyToSiblings: true }));
  assert.equal((await bodyOf(main))?.body, '새 양식');
  const sibling = await bodyOf(stopped);
  assert.equal(sibling?.body, '새 양식');
  assert.equal(sibling?.revision, 3); // 중지된 지점도 포함, 기존 리비전 위에 새 리비전
});

test('적용하지 않으면 형제 지점 양식은 그대로다', async () => {
  const { main, stopped } = await templateSetup('T2');
  const actor = await actorMember();
  await sql.begin((tx) => saveClinicTemplate(tx as never, main, 'form', { body: '새 양식' }, 1, actor));
  const sibling = await bodyOf(stopped);
  assert.equal(sibling?.body, '옛 양식'); assert.equal(sibling?.revision, 2);
});

test('이미 같은 양식인 형제 지점에는 새 리비전이 생기지 않는다', async () => {
  const { main, stopped } = await templateSetup('T3');
  const actor = await actorMember();
  await sql.begin((tx) => saveClinicTemplate(tx as never, main, 'form', { body: '옛 양식' }, 1, actor, { applyToSiblings: true }));
  const sibling = await bodyOf(stopped);
  assert.equal(sibling?.body, '옛 양식'); assert.equal(sibling?.revision, 2);
});

test('지점이 하나뿐인 클라이언트는 applyToSiblings가 있어도 그 지점만 저장한다', async () => {
  const client = await createClient(sql, P + 'T4');
  const [only] = await sql<Array<{ id: string }>>`insert into clinic_location (client_id, kind, name, position) values (${client.id}, 'main', '', 1) returning id`;
  const actor = await actorMember();
  await sql.begin((tx) => saveClinicTemplate(tx as never, only.id, 'form', { body: '양식' }, 1, actor, { applyToSiblings: true }));
  assert.equal((await bodyOf(only.id))?.body, '양식');
  const [{ n }] = await sql<Array<{ n: number }>>`select count(*)::int as n from clinic_template_revision where location_id in (select id from clinic_location where client_id = ${client.id})`;
  assert.equal(n, 1);
});
