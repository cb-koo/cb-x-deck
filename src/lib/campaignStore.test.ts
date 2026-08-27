import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient, deleteClient } from './clientStore.ts';
import { insertDraft, getDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import {
  createCampaign, listCampaigns, getCampaign, updateCampaign, deleteCampaign,
  getCampaignDetail, upsertInfluencerCost,
} from './campaignStore.ts';
import { createTasks } from './campaignTaskStore.ts';

const sql = getSql();
const P = 'tcmp' + process.pid;
const content: DraftContent = { posts: [{ text: '캠페인 스토어', media: [] }] };
const T = '2026-08-27';

after(async () => {
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`;            // 스냅샷 cascade
  await sql`delete from tracking_link where utm_campaign like ${P + '%'}`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;                    // 비용 행 cascade
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

// 원고는 더 이상 캠페인에 직접 속하지 않는다(스펙 2026-08-28 §5) — 캠페인에 넣으려면 작업을 만들어 붙인다.
const mkDraft = async (clientId: string | null, clientName: string | null, campaignId: string | null) => {
  const id = await insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  if (campaignId) {
    await createTasks(sql, campaignId, {
      type: 'post', targetTaskId: null, targetTweetUrl: null, draftId: id,
      scheduledOn: null, visitOn: null, note: '', createdBy: null, items: [],
    });
  }
  return id;
};
const base = (clientId: string, clientName: string, suffix: string) => ({
  clientId, clientName, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`,
  startsOn: '2026-08-24', endsOn: '2026-08-30', kind: null, note: '', createdBy: null,
});

// 목록 파생 합계(4)·상세 성과/요약(5)·인플 참여 캠페인(8) 테스트는 draft.campaign_id 기반 집계를 검증하던 것이라
// 여기서 뺐다 — campaignStore가 작업(campaign_task) 기준으로 바뀌는 Task 5에서 그 기준으로 다시 쓴다.
test('1) 생성 → 조회 — 날짜 문자열 왕복·기본값·목록 포함·파생 수 0·합계 {}', async () => {
  const c = await createClient(sql, P + '클라1');
  const row = await createCampaign(sql, { ...base(c.id, c.name, 'a'), kind: 'content', note: '메모' });
  assert.equal(row.startsOn, '2026-08-24');
  assert.equal(row.endsOn, '2026-08-30');
  assert.equal(row.kind, 'content');
  assert.equal(row.note, '메모');
  assert.equal(row.clientName, c.name);
  assert.equal(row.draftCount, 0);
  assert.deepEqual(row.total, {});
  assert.ok((await listCampaigns(sql)).some((x) => x.id === row.id));
  assert.equal((await getCampaign(sql, row.id))!.name, P + 'a');
  assert.equal(await getCampaign(sql, '00000000-0000-0000-0000-000000000000'), null);
});

test('1b) 비uuid id는 던지지 않고 조회는 null·삭제는 false(라우트가 404로 처리)', async () => {
  assert.equal(await getCampaign(sql, 'not-a-uuid'), null);
  assert.equal(await deleteCampaign(sql, 'nope'), false);
});

test('2) 기간 역순은 DB check가 막는다(라우트 검증의 최후 방어)', async () => {
  const c = await createClient(sql, P + '클라2');
  // 매처로 제약 이름까지 확인 — 오타로 다른 컬럼 체크가 걸려도 통과해버리는 걸 막는다
  await assert.rejects(
    () => createCampaign(sql, { ...base(c.id, c.name, 'b'), startsOn: '2026-08-30', endsOn: '2026-08-24' }),
    /campaign_period_check/,
  );
});

test('3) 수정 — 부분 패치, kind null=지움, updated_at 갱신', async () => {
  const c = await createClient(sql, P + '클라3');
  const row = await createCampaign(sql, { ...base(c.id, c.name, 'c'), kind: 'visit' });
  await updateCampaign(sql, row.id, { name: P + 'c2', endsOn: '2026-09-06' });
  const got = await getCampaign(sql, row.id);
  assert.equal(got!.name, P + 'c2');
  assert.equal(got!.endsOn, '2026-09-06');
  assert.equal(got!.startsOn, '2026-08-24');
  assert.equal(got!.kind, 'visit');                          // undefined = 유지
  assert.ok(got!.updatedAt > row.updatedAt);
  await updateCampaign(sql, row.id, { kind: null });
  assert.equal((await getCampaign(sql, row.id))!.kind, null); // null = 지움
});



test('6) 추가 비용 upsert — 처음엔 insert, 다음엔 부분 갱신(대소문자 무관 같은 행), 원고 0이어도 인플 목록에 나온다', async () => {
  const c = await createClient(sql, P + '클라6');
  const row = await createCampaign(sql, base(c.id, c.name, 'f'));
  const first = await upsertInfluencerCost(sql, row.id, 'Ghost', { note: '아직 원고 없음' });
  assert.deepEqual(first.extraCosts, []);
  assert.equal(first.note, '아직 원고 없음');
  const second = await upsertInfluencerCost(sql, row.id, 'ghost', { extraCosts: [{ label: '선물', amount: 5000, currency: 'JPY' }] });
  assert.equal(second.id, first.id);                      // 같은 행
  assert.equal(second.influencerHandle, 'Ghost');         // 표기는 처음 것 보존
  assert.equal(second.note, '아직 원고 없음');            // undefined = 유지
  assert.deepEqual(second.extraCosts, [{ label: '선물', amount: 5000, currency: 'JPY' }]);
  const third = await upsertInfluencerCost(sql, row.id, 'ghost', { note: '수정' });
  assert.deepEqual(third.extraCosts, [{ label: '선물', amount: 5000, currency: 'JPY' }]); // note-only 패치는 extraCosts를 보존
  assert.equal(third.note, '수정');
  const detail = await getCampaignDetail(sql, row.id, T);
  const line = detail!.influencers.find((l) => l.handle === 'Ghost')!;
  assert.equal(line.contentCount, 0);
  assert.equal(line.hasCostRow, true);
  assert.deepEqual(line.subtotal, { JPY: 5000 });
});

test('7) 클라 삭제 → client_id null·client_name 스냅샷 유지 / 캠페인 삭제 → 원고 보존·비용 행 cascade', async () => {
  const c = await createClient(sql, P + '클라7');
  const row = await createCampaign(sql, base(c.id, c.name, 'g'));
  const d = await mkDraft(c.id, c.name, row.id);
  await upsertInfluencerCost(sql, row.id, 'hana', { note: 'x' });
  await deleteClient(sql, c.id);
  const after1 = await getCampaign(sql, row.id);
  assert.equal(after1!.clientId, null);
  assert.equal(after1!.clientName, c.name);
  assert.equal(await deleteCampaign(sql, row.id), true);
  assert.equal(await deleteCampaign(sql, row.id), false);
  assert.ok(await getDraft(sql, d), '원고는 남는다');
  assert.equal((await getDraft(sql, d))!.campaignId, null);
  const cic = await sql`select id from campaign_influencer_cost where campaign_id = ${row.id}`;
  assert.equal(cic.length, 0);
});

