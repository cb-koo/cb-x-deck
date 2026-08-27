import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient, deleteClient, updateClient, setBudgetOverride } from './clientStore.ts';
import { insertDraft, updateDraft, getDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import {
  createCampaign, listCampaigns, getCampaign, updateCampaign, deleteCampaign,
  getCampaignDetail, upsertInfluencerCost, listInfluencerCampaigns, spendByMonth,
} from './campaignStore.ts';
import { campaignTotal, deriveInfluencers } from './campaignJudgment.ts';

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

const mkDraft = (clientId: string | null, clientName: string | null, campaignId: string | null) =>
  insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null, campaignId,
  });
const base = (clientId: string, clientName: string, suffix: string) => ({
  clientId, clientName, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`,
  startsOn: '2026-08-24', endsOn: '2026-08-30', kind: null, note: '', createdBy: null,
});

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

test('4) 목록 파생 — 콘텐츠 수(미사용 제외)·통화별 합계(콘텐츠 비용 + 추가 비용, 미사용 비용 제외)', async () => {
  const c = await createClient(sql, P + '클라4');
  const row = await createCampaign(sql, base(c.id, c.name, 'd'));
  const d1 = await mkDraft(c.id, c.name, row.id);
  const d2 = await mkDraft(c.id, c.name, row.id);
  const d3 = await mkDraft(c.id, c.name, row.id);
  await updateDraft(sql, d1, { cost: { type: 'post', amount: 300000, currency: 'KRW' }, influencerHandle: 'hana' });
  await updateDraft(sql, d2, { cost: { type: 'post', amount: 95000, currency: 'JPY' }, influencerHandle: 'yuki' });
  await updateDraft(sql, d3, { status: 'unused', cost: { type: 'post', amount: 777777, currency: 'KRW' } });
  await upsertInfluencerCost(sql, row.id, 'hana', { extraCosts: [{ label: '교통비', amount: 20000, currency: 'KRW' }] });
  const got = await getCampaign(sql, row.id);
  assert.equal(got!.draftCount, 2);
  assert.deepEqual(got!.total, { KRW: 320000, JPY: 95000 });
  const listed = (await listCampaigns(sql)).find((x) => x.id === row.id);
  assert.deepEqual(listed!.total, got!.total);              // 목록·단건이 같은 정의
  // 두 합산 경로(SQL·순수 함수)가 갈라지면 목록 카드와 상세 소계가 다른 숫자를 보인다 — 혼합 통화(KRW+JPY) + 추가 비용으로 잠근다
  const detail = await getCampaignDetail(sql, row.id);
  assert.deepEqual(detail!.campaign.total, campaignTotal(deriveInfluencers(detail!.drafts, detail!.costRows)));
});

test('5) 상세 — 게시됨(tracked_post)·성과 lateral 합(게시물 여러 개 SUM)·링크 클릭 합·요약·인플 목록', async () => {
  const c = await createClient(sql, P + '클라5');
  const row = await createCampaign(sql, base(c.id, c.name, 'e'));
  const pub = await mkDraft(c.id, c.name, row.id);
  const plain = await mkDraft(c.id, c.name, row.id);
  await updateDraft(sql, pub, { influencerHandle: 'hana', status: 'delivered', scheduledOn: '2026-08-25' });
  await updateDraft(sql, plain, { influencerHandle: 'yuki', scheduledOn: '2026-08-26' }); // 밀림
  // 게시물 2개가 한 원고에 — 각 최신 스냅샷을 합산해야 한다(tracked_post는 tweet_id만 unique)
  for (const [i, views] of [[1, 1000], [2, 2000]] as Array<[number, number]>) {
    const tp = await sql<Array<{ id: string }>>`
      insert into tracked_post (tweet_id, author_handle, text, source) values (${P + 'tw' + i}, 'hana', 't', 'manual') returning id`;
    await sql`update tracked_post set draft_id = ${pub} where id = ${tp[0].id}`;
    await sql`insert into post_metric_snapshot (tracked_post_id, views, likes, captured_at) values (${tp[0].id}, ${views - 500}, 1, now() - interval '1 hour')`;
    await sql`insert into post_metric_snapshot (tracked_post_id, views, likes, captured_at) values (${tp[0].id}, ${views}, 10, now())`; // 최신
  }
  const link = await sql<Array<{ id: string }>>`
    insert into tracking_link (code, landing_url, long_url, short_url, shortio_link_id, utm_campaign, influencer_handle, draft_id)
    values (${P.slice(-6)}, 'https://c.example.com/', 'https://c.example.com/?x', 'https://cb.link/x', 'lnk', ${P + 'utm'}, 'hana', ${plain}) returning id`;
  await sql`insert into link_click_snapshot (tracking_link_id, total_clicks, human_clicks) values (${link[0].id}, 96, 90)`;

  const detail = await getCampaignDetail(sql, row.id, T);
  assert.ok(detail);
  assert.equal(detail!.today, T);
  const p = detail!.drafts.find((d) => d.id === pub)!;
  assert.equal(p.published, true);
  assert.deepEqual(p.perf, { postCount: 2, views: 3000, likes: 20 });   // 최신 스냅샷만, 게시물 합
  assert.equal(p.linkClicks, null);
  const q = detail!.drafts.find((d) => d.id === plain)!;
  assert.equal(q.published, false);
  assert.equal(q.perf, null);
  assert.equal(q.linkClicks, 96);                                        // 미게시 원고의 링크 클릭도 실린다(요약 합계용)
  assert.deepEqual(detail!.summary, { total: 2, published: 1, delivered: 0, preparing: 1, overdue: 1 });
  assert.deepEqual(detail!.influencers.map((l) => l.handle), ['hana', 'yuki']);
  assert.equal(detail!.costRows.length, 0);
  assert.equal(await getCampaignDetail(sql, '00000000-0000-0000-0000-000000000000', T), null);
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

test('8) 인플 참여 캠페인 — 원고 배정 또는 비용 행이 있는 캠페인, 콘텐츠 n·소계(통화별)', async () => {
  const c = await createClient(sql, P + '클라8');
  const a = await createCampaign(sql, base(c.id, c.name, 'h1'));
  const b = await createCampaign(sql, { ...base(c.id, c.name, 'h2'), startsOn: '2026-09-07', endsOn: '2026-09-13' });
  const none = await createCampaign(sql, base(c.id, c.name, 'h3'));
  const h = P + 'Mina';
  const d1 = await mkDraft(c.id, c.name, a.id);
  await updateDraft(sql, d1, { influencerHandle: h.toUpperCase(), cost: { type: 'post', amount: 100000, currency: 'KRW' } });
  await upsertInfluencerCost(sql, a.id, h, { extraCosts: [{ label: '교통', amount: 10000, currency: 'KRW' }] });
  await upsertInfluencerCost(sql, b.id, h, { note: '예정' });
  const items = await listInfluencerCampaigns(sql, h.toLowerCase());
  assert.deepEqual(items.map((i) => i.id), [b.id, a.id]);   // 시작일 내림차순
  assert.ok(!items.some((i) => i.id === none.id));
  const ia = items.find((i) => i.id === a.id)!;
  assert.equal(ia.contentCount, 1);
  assert.deepEqual(ia.subtotal, { KRW: 110000 });
  assert.deepEqual(items.find((i) => i.id === b.id)!.subtotal, {});
});

test('12) spendByMonth — 시작 달로 묶고 totalsFor와 같은 정의(미사용 제외·추가 비용 포함·통화 분리), 비용 0 캠페인도 센다', async () => {
  const c = await createClient(sql, P + '예산클라');
  const aug1 = await createCampaign(sql, { ...base(c.id, c.name, 'm1'), startsOn: '2026-08-03', endsOn: '2026-08-09' });
  const aug2 = await createCampaign(sql, { ...base(c.id, c.name, 'm2'), startsOn: '2026-08-31', endsOn: '2026-09-06' }); // 월을 걸쳐도 8월
  await createCampaign(sql, { ...base(c.id, c.name, 'm3'), startsOn: '2026-09-01', endsOn: '2026-09-07' });
  const d1 = await mkDraft(c.id, c.name, aug1.id);
  const d2 = await mkDraft(c.id, c.name, aug1.id);
  const d3 = await mkDraft(c.id, c.name, aug2.id);
  await updateDraft(sql, d1, { cost: { type: 'post', amount: 300_000, currency: 'KRW' } });
  await updateDraft(sql, d2, { status: 'unused', cost: { type: 'post', amount: 777_777, currency: 'KRW' } }); // 제외
  await updateDraft(sql, d3, { cost: { type: 'post', amount: 95_000, currency: 'JPY' } });
  await upsertInfluencerCost(sql, aug1.id, 'hana', { extraCosts: [{ label: '교통비', amount: 20_000, currency: 'KRW' }] });

  const all = await spendByMonth(sql, c.id);
  assert.deepEqual(all.get('2026-08'), { total: { KRW: 320_000, JPY: 95_000 }, campaignCount: 2 });
  assert.deepEqual(all.get('2026-09'), { total: {}, campaignCount: 1 });   // 비용 없는 캠페인도 개수에 든다
  assert.equal(all.has('2026-07'), false);

  const only = await spendByMonth(sql, c.id, ['2026-09']);
  assert.deepEqual([...only.keys()], ['2026-09']);
  assert.equal(only.get('2026-09')!.campaignCount, 1);

  // 다른 클라이언트의 캠페인은 섞이지 않는다
  const other = await createClient(sql, P + '남의클라');
  await createCampaign(sql, { ...base(other.id, other.name, 'm4'), startsOn: '2026-08-10', endsOn: '2026-08-16' });
  assert.equal((await spendByMonth(sql, c.id)).get('2026-08')!.campaignCount, 2);
});

test('13) getCampaignDetail.budget — 예외 달 우선·othersKrw는 같은 달 다른 캠페인 몫·클라 없으면 null', async () => {
  const c = await createClient(sql, P + '예산클라2');
  await updateClient(sql, c.id, { monthlyBudget: 3_000_000 });
  await setBudgetOverride(sql, c.id, '2026-08', 2_500_000);
  const a = await createCampaign(sql, { ...base(c.id, c.name, 'b1'), startsOn: '2026-08-03', endsOn: '2026-08-09' });
  const b = await createCampaign(sql, { ...base(c.id, c.name, 'b2'), startsOn: '2026-08-17', endsOn: '2026-08-23' });
  const da = await mkDraft(c.id, c.name, a.id);
  const db = await mkDraft(c.id, c.name, b.id);
  await updateDraft(sql, da, { cost: { type: 'post', amount: 1_200_000, currency: 'KRW' } });
  await updateDraft(sql, db, { cost: { type: 'post', amount: 65_000, currency: 'JPY' } });   // 650,000원

  const detA = (await getCampaignDetail(sql, a.id, T))!;
  assert.deepEqual(detA.budget, { month: '2026-08', amount: 2_500_000, source: 'override', othersKrw: 650_000, campaignCount: 2 });
  const detB = (await getCampaignDetail(sql, b.id, T))!;
  assert.equal(detB.budget!.othersKrw, 1_200_000);

  // 9월 캠페인은 기본값
  const s = await createCampaign(sql, { ...base(c.id, c.name, 'b3'), startsOn: '2026-09-07', endsOn: '2026-09-13' });
  const detS = (await getCampaignDetail(sql, s.id, T))!;
  assert.deepEqual(detS.budget, { month: '2026-09', amount: 3_000_000, source: 'default', othersKrw: 0, campaignCount: 1 });

  // 클라이언트를 지우면(client_id set null) budget은 null
  await deleteClient(sql, c.id);
  assert.equal((await getCampaignDetail(sql, a.id, T))!.budget, null);
});
