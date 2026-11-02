// 지점 목록·대표 지점 — 합성 클라이언트(접두어 P)로 만들고 after에서 지운다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { listClinics, listClientLocations, representativeLocation, locationLabel, createLocation, updateLocation, deleteLocation } from './clinicStore.ts';

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
