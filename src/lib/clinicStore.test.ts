// 지점 목록·대표 지점 — 합성 클라이언트(접두어 P)로 만들고 after에서 지운다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { listClinics, listClientLocations, representativeLocation, locationLabel } from './clinicStore.ts';

const sql = getSql();
const P = 'tcs' + process.pid;

after(async () => {
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
