// 추출 — 답변 지점을 클라이언트 지점과 맞춘다(QA C5·C6). LLM은 스텁, 클라이언트·인플루언서는 접두어 P로 만들고 after에서 지운다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createInfluencer } from './influencerStore.ts';
import { extractReservation } from './reservationExtraction.ts';
import type { callLLM } from './llm.ts';

const sql = getSql();
const P = 'tre' + process.pid;

after(async () => {
  await sql`delete from clinic_location where client_id in (select id from client where name like ${P + '%'})`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql.end();
});

const SHEET = '[X인플루언서 방문협찬 예약폼]\n지점 안내: {{branch}}\n1. 성함:\n7. 지점:';

// 스텁 — 받은 요청을 남기고 정해 둔 JSON을 돌려준다
function stub(answer: Record<string, string>) {
  const calls: Array<{ system: string; user: Record<string, unknown> }> = [];
  const call = (async (_op: string, params: { messages: object[] } & Record<string, unknown>) => {
    const [m] = params.messages as Array<{ content: string }>;
    calls.push({ system: String(params.system), user: JSON.parse(m.content) });
    return { content: [{ type: 'text', text: JSON.stringify(answer) }] };
  }) as unknown as typeof callLLM;
  return { calls, deps: { call } };
}

async function setup(suffix: string, branches: string[]) {
  const client = await createClient(sql, P + suffix);
  const ids: string[] = [];
  for (const [i, name] of branches.entries()) {
    const [row] = await sql<{ id: string }[]>`insert into clinic_location (client_id, kind, name, position)
      values (${client.id}, ${i === 0 ? 'main' : 'branch'}, ${name}, ${i + 1}) returning id`;
    ids.push(row.id);
  }
  await sql`insert into clinic_template_revision (location_id, kind, body, revision) values (${ids[0]}, 'sheet', ${SHEET}, 2)`;
  const { row: person } = await createInfluencer(sql, { handle: P + suffix, createdBy: null });
  return { ids, body: { sourceText: 'お名前: はな / 店舗: 新沙', personId: person.id, locationId: ids[0] } };
}

test('답변 지점이 후보와 맞으면 locationId와 7. 지점이 채워진다', async () => {
  const { ids, body } = await setup('A', ['명동점', '신사점']);
  const { calls, deps } = stub({ name: '하나', branch: '신사점' });
  const out = await extractReservation(sql, body, deps);
  assert.equal(out.locationId, ids[1]);
  assert.ok(out.sheetText.includes('7. 지점: 신사점'));
  assert.ok(out.sheetText.includes('지점 안내: 신사점'));
  assert.deepEqual(calls[0].user.branchOptions, ['명동점', '신사점']);
  assert.ok(calls[0].system.includes('branchOptions'));
});

test('후보 밖 값은 비운다', async () => {
  const { body } = await setup('B', ['명동점', '신사점']);
  const { deps } = stub({ name: '하나', branch: '明洞店' });
  const out = await extractReservation(sql, body, deps);
  assert.equal(out.locationId, null);
  assert.match(out.sheetText, /7\. 지점:[ \t]*$/m);
  assert.match(out.sheetText, /지점 안내:[ \t]*$/m);
  assert.ok(!out.sheetText.includes('明洞店'));
});

test('지점 1개 클라이언트는 본점', async () => {
  const { ids, body } = await setup('C', ['']);
  const { calls, deps } = stub({ name: '하나', branch: '明洞' });
  const out = await extractReservation(sql, body, deps);
  assert.equal(out.locationId, ids[0]);
  assert.ok(out.sheetText.includes('지점 안내: 본점'));
  assert.ok(out.sheetText.includes('7. 지점: 본점'));
  assert.deepEqual(out.unmappedAnswers, []);
  assert.equal('branchOptions' in calls[0].user, false);
  assert.ok(!calls[0].system.includes('branchOptions'));
});
