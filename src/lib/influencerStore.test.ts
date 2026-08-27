import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { insertDraft, updateDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import type { UserInfo } from './getxapi.ts';
import {
  createInfluencer, listInfluencers, findInfluencerById, findByHandle, findDuplicateByXUserId,
  getInfluencerDetail, updateInfluencer, deleteInfluencer, applyProfileSnapshot, ensureInfluencer,
  renameInfluencer, addManualLog, deleteManualLog, insertAutoLog, listOptions,
  updatePricing, saveAnalysis, updatePaymentMethods, type InfluencerAnalysis,
} from './influencerStore.ts';
import { PAYMENT_NOT_FOUND, type PaymentMethodInput } from './influencerPayment.ts';
import { createClient } from './clientStore.ts';
import { createCampaign, upsertInfluencerCost } from './campaignStore.ts';
import { createTasks, getTask } from './campaignTaskStore.ts';
import type postgres from 'postgres';

const sql = getSql();
// 핸들 접두어 — 병렬 실행/실 DB 오염 방지. 소문자로 시작해야 lower 정리 쿼리가 맞아떨어진다.
const P = 'tinf' + process.pid;
const content: DraftContent = { posts: [{ text: '正直迷ってた。\n\nでも良かった。', media: [] }] };

after(async () => {
  await sql`delete from draft where lower(influencer_handle) like ${P.toLowerCase() + '%'}`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;                   // 비용 행(campaign_influencer_cost)은 cascade
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer where lower(handle) like ${P.toLowerCase() + '%'}`; // 로그는 cascade
  await sql.end();
});

test('1) CRUD 왕복: 생성 기본값 → 수정 반영 → 목록 포함 → 삭제', async () => {
  const { row, created } = await createInfluencer(sql, { handle: P + 'crud', createdBy: null });
  assert.equal(created, true);
  assert.equal(row.handle, P + 'crud');
  assert.deepEqual(row.tags, []);
  assert.equal(row.note, '');
  assert.equal(row.xUserId, null);
  assert.equal(row.displayName, null);
  assert.equal(row.profileRefreshedAt, null);
  assert.equal(row.lastLogAt, null);
  assert.equal(row.draftCount, 0);
  assert.equal(row.analyzedAt, null);
  assert.equal(row.analysisV2, false);
  assert.ok(row.createdAt);

  await updateInfluencer(sql, row.id, { note: '단가 30만', tags: ['뷰티', '도쿄'] });
  const got = await findInfluencerById(sql, row.id);
  assert.equal(got!.note, '단가 30만');
  assert.deepEqual(got!.tags, ['뷰티', '도쿄']);

  assert.ok((await listInfluencers(sql)).some((x) => x.id === row.id), '목록에 포함');

  await deleteInfluencer(sql, row.id);
  assert.equal(await findInfluencerById(sql, row.id), null);
});

test('2) lower 중복: 대소문자만 다른 핸들은 새로 만들지 않고 기존 행(표기 보존)을 돌려준다', async () => {
  const first = await createInfluencer(sql, { handle: P + 'Abc', createdBy: null });
  assert.equal(first.created, true);

  const again = await createInfluencer(sql, { handle: P + 'ABC', createdBy: null });
  assert.equal(again.created, false);
  assert.equal(again.row.id, first.row.id);
  assert.equal(again.row.handle, P + 'Abc'); // 최초 표기 유지

  const found = await findByHandle(sql, P + 'aBC');
  assert.equal(found!.id, first.row.id);
  assert.equal(await findByHandle(sql, P + 'nosuch'), null);
});

test('3) ensureInfluencer: 없으면 만들고, 대소문자 변형 재호출은 같은 id (on conflict 경로)', async () => {
  const id = await ensureInfluencer(sql, P + 'Ensure', null);
  assert.ok(id);
  const again = await ensureInfluencer(sql, P + 'ENSURE', null);
  assert.equal(again, id);

  const row = await findInfluencerById(sql, id);
  assert.equal(row!.handle, P + 'Ensure'); // 재호출이 표기를 덮지 않는다
});

test('4) applyProfileSnapshot: x_user_id·스냅샷 4종·조회 시각', async () => {
  const { row } = await createInfluencer(sql, { handle: P + 'snap', createdBy: null });
  const info: UserInfo = {
    id: '999' + process.pid,
    userName: P + 'snap',
    name: 'みか',
    followers: 12345,
    profilePicture: 'https://example.com/a.jpg',
    description: '美容好き',
  };
  await applyProfileSnapshot(sql, row.id, info);

  const got = await findInfluencerById(sql, row.id);
  assert.equal(got!.xUserId, '999' + process.pid);
  assert.equal(got!.displayName, 'みか');
  assert.equal(got!.avatarUrl, 'https://example.com/a.jpg');
  assert.equal(got!.bio, '美容好き');
  assert.equal(got!.followersCount, 12345);
  assert.ok(got!.profileRefreshedAt, 'profileRefreshedAt not null');
  assert.ok(Date.now() - new Date(got!.profileRefreshedAt!).getTime() < 60_000);

  // 생성과 동시에 스냅샷을 넣는 경로(프로필 조회 후 등록) — 같은 컬럼이 채워진다
  const born = await createInfluencer(sql, {
    handle: P + 'snap2', createdBy: null, snapshot: { ...info, userName: P + 'snap2' },
  });
  assert.equal(born.created, true);
  assert.equal(born.row.xUserId, '999' + process.pid);
  assert.equal(born.row.displayName, 'みか');
  assert.equal(born.row.bio, '美容好き');
  assert.equal(born.row.followersCount, 12345);
  assert.equal(born.row.avatarUrl, 'https://example.com/a.jpg');
  assert.ok(born.row.profileRefreshedAt, '스냅샷과 함께 만들면 조회 시각도 찍힌다');
});

test('5) 로그: 수동 기록·자동 이벤트가 한 시계열, 자동 로그는 지워지지 않는다', async () => {
  const { row } = await createInfluencer(sql, { handle: P + 'log', createdBy: null });
  const [m] = await sql<Array<{ id: string; name: string; color: string }>>`
    select id, name, color from member limit 1`;

  const manual = await addManualLog(sql, row.id, { body: 'DM 답장 옴', channel: 'dm', authorId: m?.id ?? null });
  assert.equal(manual.kind, 'manual');
  assert.equal(manual.body, 'DM 답장 옴');
  assert.equal(manual.channel, 'dm');
  assert.equal(manual.eventType, null);
  assert.ok(manual.createdAt);
  if (m) assert.deepEqual(manual.member, { id: m.id, name: m.name, color: m.color });
  else assert.equal(manual.member, null);

  await insertAutoLog(sql, {
    influencerId: row.id, eventType: 'draft_assigned', draftId: null, draftTitle: 'T', authorId: null,
  });

  const detail = await getInfluencerDetail(sql, row.id);
  assert.equal(detail!.influencer.id, row.id);
  assert.equal(detail!.logs.length, 2);
  assert.equal(detail!.logs[0].kind, 'auto', '최신순 — 자동 로그가 앞');
  assert.equal(detail!.logs[0].eventType, 'draft_assigned');
  assert.equal(detail!.logs[0].draftTitle, 'T');
  assert.equal(detail!.logs[0].body, null);
  assert.equal(detail!.logs[1].id, manual.id);

  const autoId = detail!.logs[0].id;
  assert.equal(await deleteManualLog(sql, row.id, autoId), false, 'auto는 삭제 불가');
  assert.equal((await getInfluencerDetail(sql, row.id))!.logs.length, 2);

  assert.equal(await deleteManualLog(sql, row.id, manual.id), true);
  const rest = await getInfluencerDetail(sql, row.id);
  assert.equal(rest!.logs.length, 1);
  assert.equal(rest!.logs[0].id, autoId);
});

test('6) 파생값: lastLogAt·draftCount(lower 조인)·원고 롤업', async () => {
  const { row } = await createInfluencer(sql, { handle: P + 'Derive', createdBy: null });
  await addManualLog(sql, row.id, { body: '첫 접촉', channel: null, authorId: null });

  const draftId = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  // 배정 표기는 사용자가 친 대로 — 조인은 lower 기준이어야 센다
  await updateDraft(sql, draftId, { influencerHandle: P + 'DERIVE' });

  const listed = (await listInfluencers(sql)).find((x) => x.id === row.id);
  assert.ok(listed, '목록에 있음');
  assert.ok(listed!.lastLogAt, 'lastLogAt not null');
  assert.equal(listed!.draftCount, 1);

  const detail = await getInfluencerDetail(sql, row.id);
  assert.equal(detail!.drafts.length, 1);
  assert.equal(detail!.drafts[0].id, draftId);
  assert.equal(detail!.drafts[0].status, 'draft');
  assert.equal(detail!.drafts[0].title, '正直迷ってた。'); // 제목 없으면 최신 본문 첫 줄
  assert.ok(detail!.drafts[0].createdAt);
});

test('7) findDuplicateByXUserId: 같은 X 계정을 가리키는 다른 행의 핸들', async () => {
  const xid = '7' + process.pid + '7';
  const a = await createInfluencer(sql, { handle: P + 'dupA', createdBy: null });
  const b = await createInfluencer(sql, { handle: P + 'dupB', createdBy: null });
  const info = (userName: string): UserInfo =>
    ({ id: xid, userName, name: null, followers: null, profilePicture: null, description: null });
  await applyProfileSnapshot(sql, a.row.id, info(P + 'dupA'));

  assert.equal(await findDuplicateByXUserId(sql, xid, a.row.id), null, '자기 자신은 제외');

  await applyProfileSnapshot(sql, b.row.id, info(P + 'dupB'));
  assert.equal(await findDuplicateByXUserId(sql, xid, b.row.id), P + 'dupA');
  assert.equal(await findDuplicateByXUserId(sql, xid, a.row.id), P + 'dupB');
  assert.equal(await findDuplicateByXUserId(sql, xid + 'zzz', a.row.id), null);
});

test('8) renameInfluencer: 핸들 교체 + 배정 원고 일괄 이관 + handle_changed 로그', async () => {
  const from = P + 'Old';
  const to = P + 'New';
  const { row } = await createInfluencer(sql, { handle: from, createdBy: null });
  const draftId = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '개명', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  await updateDraft(sql, draftId, { influencerHandle: P + 'OLD' }); // 표기가 달라도 이관돼야 한다

  await renameInfluencer(sql, { influencerId: row.id, from, to, actorId: null });

  const got = await findInfluencerById(sql, row.id);
  assert.equal(got!.handle, to);
  assert.equal(got!.draftCount, 1, '배정 사실은 불변');

  const [d] = await sql<Array<{ influencer_handle: string }>>`
    select influencer_handle from draft where id = ${draftId}`;
  assert.equal(d.influencer_handle, to);

  const detail = await getInfluencerDetail(sql, row.id);
  const log = detail!.logs.find((l) => l.eventType === 'handle_changed');
  assert.ok(log, 'handle_changed 로그 있음');
  assert.equal(log!.kind, 'auto');
  assert.deepEqual(log!.payload, { from, to });
  assert.equal(await findByHandle(sql, from), null);
  assert.equal((await findByHandle(sql, to))!.id, row.id);
});

test('10) lastContactAt: manual 로그만 반영 — auto만 있으면 null, manual이 생기면 그 시각', async () => {
  const { row } = await createInfluencer(sql, { handle: P + 'Contact', createdBy: null });
  assert.equal(row.lastContactAt, null);

  await insertAutoLog(sql, {
    influencerId: row.id, eventType: 'draft_assigned', draftId: null, draftTitle: 'T', authorId: null,
  });
  const afterAuto = await findInfluencerById(sql, row.id);
  assert.equal(afterAuto!.lastContactAt, null, 'auto 로그만으로는 연락 기록이 아니다');

  const manual = await addManualLog(sql, row.id, { body: '연락함', channel: 'dm', authorId: null });
  const afterManual = await findInfluencerById(sql, row.id);
  assert.equal(afterManual!.lastContactAt, manual.createdAt);

  const listed = (await listInfluencers(sql)).find((x) => x.id === row.id);
  assert.equal(listed!.lastContactAt, manual.createdAt, '목록도 같은 정의를 쓴다');
});

test('11) draftStatusCounts: 상태별 카운트 — lower 조인, 존재하는 상태만', async () => {
  const { row } = await createInfluencer(sql, { handle: P + 'Counts', createdBy: null });

  const d1 = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + 'counts1', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  await updateDraft(sql, d1, { influencerHandle: P + 'COUNTS' }); // 표기 달라도 lower로 잡힌다

  const d2 = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + 'counts2', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  await updateDraft(sql, d2, { influencerHandle: P + 'Counts', status: 'delivered' });

  const detail = await getInfluencerDetail(sql, row.id);
  assert.deepEqual(detail!.draftStatusCounts, { draft: 1, delivered: 1 });
});

test('9) listOptions: 표시 이름은 있으면 name, 없으면 undefined', async () => {
  const withName = await createInfluencer(sql, { handle: P + 'optA', createdBy: null });
  const noName = await createInfluencer(sql, { handle: P + 'optB', createdBy: null });
  await applyProfileSnapshot(sql, withName.row.id, {
    id: '888' + process.pid, userName: P + 'optA', name: 'ゆい',
    followers: 10, profilePicture: null, description: null,
  });

  const opts = await listOptions(sql);
  const a = opts.find((o) => o.handle === P + 'optA');
  const b = opts.find((o) => o.handle === P + 'optB');
  assert.equal(a!.name, 'ゆい');
  assert.equal(b!.name, undefined);

  const ours = opts.filter((o) => o.handle.toLowerCase().startsWith(P.toLowerCase()));
  const sorted = [...ours].sort((x, y) => x.handle.toLowerCase().localeCompare(y.handle.toLowerCase()));
  assert.deepEqual(ours.map((o) => o.handle), sorted.map((o) => o.handle), 'lower(handle) 사전순');

  await deleteInfluencer(sql, noName.row.id);
});

test('9) updatePricing: 병합 저장 + 변경분만 auto 로그', async () => {
  const { row } = await createInfluencer(sql, { handle: P + 'price', createdBy: null });

  const r1 = await updatePricing(sql, row.id, { rt: 100000, post: 300000 }, null);
  assert.deepEqual(r1.pricing, { rt: 100000, post: 300000 });
  assert.equal(r1.logs.length, 2);
  assert.ok(r1.logs.every((l) => l.kind === 'auto' && l.eventType === 'pricing_changed'));

  // 부분 패치: post만 변경 — rt는 보존, 로그는 1건만
  const r2 = await updatePricing(sql, row.id, { post: 350000 }, null);
  assert.deepEqual(r2.pricing, { rt: 100000, post: 350000 });
  assert.equal(r2.logs.length, 1);
  assert.deepEqual(r2.logs[0].payload, { priceType: 'post', from: 300000, to: 350000, currency: 'KRW' });

  // 같은 값 재전송 = 로그 없음
  const r3 = await updatePricing(sql, row.id, { post: 350000 }, null);
  assert.equal(r3.logs.length, 0);

  // 상세에 pricing이 실려 온다
  const detail = await getInfluencerDetail(sql, row.id);
  assert.deepEqual(detail!.pricing, { rt: 100000, post: 350000 });
  assert.equal(detail!.logs.filter((l) => l.eventType === 'pricing_changed').length, 3);
});

test('10) saveAnalysis: 저장·조회 왕복', async () => {
  const { row } = await createInfluencer(sql, { handle: P + 'anal', createdBy: null });
  const analysis = {
    sample: { count: 2, classified: 2, since: '2026-05-24T00:00:00.000Z', until: '2026-08-24T00:00:00.000Z', months: 3 },
    stats: { perWeek: 0.2, medianViews: 200, medianLikes: 20,
             mix: { original: 1, retweet: 0, quote: 1 }, typeDist: { info: 2 }, sponsoredCount: 0 },
    topics: [{ tag: '미용의료', count: 2, medianViews: 200 }],
    summary: { tone: '톤', patterns: '패턴', sponsorship: '관찰되지 않음' },
    models: { classify: 'claude-haiku-4-5', synth: 'claude-sonnet-5' },
  };
  await saveAnalysis(sql, row.id, analysis);
  const detail = await getInfluencerDetail(sql, row.id);
  assert.deepEqual(detail!.analysis, analysis);
  assert.ok(detail!.analyzedAt);

  // 명부 행(InfluencerRow)에서도 같은 analyzedAt이 보인다 — activity 없는 분석(v1 모양)은 analysisV2 false
  const listedRow = await findInfluencerById(sql, row.id);
  assert.ok(listedRow!.analyzedAt);
  assert.equal(listedRow!.analysisV2, false, 'activity 없는 분석은 v2 아님');

  // activity가 있는 분석(v2)을 저장하면 analysisV2가 true로 바뀐다 — jsonb `?` 키 존재 검사, 값은 명부에 싣지 않는다
  const { row: row2 } = await createInfluencer(sql, { handle: P + 'analv2', createdBy: null });
  const analysisV2 = { ...analysis, activity: { hourly: [], weekday: [] } } as unknown as InfluencerAnalysis;
  await saveAnalysis(sql, row2.id, analysisV2);
  const row2After = await findInfluencerById(sql, row2.id);
  assert.ok(row2After!.analyzedAt);
  assert.equal(row2After!.analysisV2, true);
});

// ── 캠페인 연결(캠페인 스펙 §2-5·§5) ──
const mkCampaign = (clientId: string, clientName: string, suffix: string) => createCampaign(sql, {
  clientId, clientName, name: P + '캠페인' + suffix, nameEn: `${P.toLowerCase()}-${suffix}`,
  startsOn: '2026-08-24', endsOn: '2026-08-30', kind: null, note: '', createdBy: null,
});
type CicRow = { influencer_handle: string; extra_costs: unknown; note: string };
const cicOf = (campaignId: string) => sql<CicRow[]>`
  select influencer_handle, extra_costs, note from campaign_influencer_cost where campaign_id = ${campaignId}`;

test('12) renameInfluencer: 캠페인 추가 비용 행도 새 핸들로 이관(단순 이동) + 참여 캠페인 조회가 새 핸들로 이어진다', async () => {
  const from = P + 'CostOld';
  const to = P + 'CostNew';
  const { row } = await createInfluencer(sql, { handle: from, createdBy: null });
  assert.deepEqual((await getInfluencerDetail(sql, row.id))!.campaigns, []);   // 참여 전엔 빈 배열(null 아님)

  const c = await createClient(sql, P + '클라a');
  const camp = await mkCampaign(c.id, c.name, 'a');
  // 표기가 달라도(대문자) lower 기준으로 같은 사람의 행이다
  await upsertInfluencerCost(sql, camp.id, from.toUpperCase(), {
    extraCosts: [{ label: '교통비', amount: 20000, currency: 'KRW' }], note: '옛 메모',
  });

  await renameInfluencer(sql, { influencerId: row.id, from, to, actorId: null });

  const rows = await cicOf(camp.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].influencer_handle, to);                                   // 표기는 새 핸들 그대로
  assert.deepEqual(rows[0].extra_costs, [{ label: '교통비', amount: 20000, currency: 'KRW' }]);
  assert.equal(rows[0].note, '옛 메모');
  assert.equal((await sql`select id from campaign_influencer_cost where lower(influencer_handle) = ${from.toLowerCase()}`).length, 0);

  const detail = await getInfluencerDetail(sql, row.id);
  assert.deepEqual(detail!.campaigns.map((x) => x.id), [camp.id]);
  assert.equal(detail!.campaigns[0].taskCount, 0);                               // 작업 없이 비용만 — "배정 작업 없음"
  assert.deepEqual(detail!.campaigns[0].subtotal, { KRW: 20000 });

  // 캠페인 작업의 핸들도 같은 트랜잭션에서 따라간다(작업 스펙 §2-3) — 빠지면 인플 목록에 옛 핸들 유령 줄
  const [tk] = await createTasks(sql, camp.id, { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null, type: 'rt', items: [{ handle: from, cost: null }] });
  await sql.begin(async (tx0) => renameInfluencer(tx0 as unknown as postgres.Sql, { influencerId: row.id, from, to: to + '2', actorId: null }));
  assert.equal((await getTask(sql, tk.id))!.influencerHandle, to + '2');
});

test('13) renameInfluencer: 같은 캠페인에 옛·새 핸들 행이 둘 다 있으면 병합 — extra_costs는 새 뒤에 옛, note는 새가 비었을 때만 옛, 옛 행 삭제', async () => {
  const from = P + 'MergeOld';
  const to = P + 'MergeNew';
  const { row } = await createInfluencer(sql, { handle: from, createdBy: null });
  const c = await createClient(sql, P + '클라b');
  const campA = await mkCampaign(c.id, c.name, 'b');
  const campB = await mkCampaign(c.id, c.name, 'c');
  const campC = await mkCampaign(c.id, c.name, 'd');
  // A: 둘 다 있음 · 새 행 note 비어 있음 → 옛 note 승계
  await upsertInfluencerCost(sql, campA.id, from, { extraCosts: [{ label: '옛항목', amount: 1000, currency: 'KRW' }], note: '옛 메모' });
  await upsertInfluencerCost(sql, campA.id, to, { extraCosts: [{ label: '새항목', amount: 2000, currency: 'JPY' }] });
  // B: 둘 다 있음 · 새 행 note 있음 → 새 note 유지
  await upsertInfluencerCost(sql, campB.id, from, { note: '옛 메모', extraCosts: [{ label: '선물', amount: 300, currency: 'KRW' }] });
  await upsertInfluencerCost(sql, campB.id, to, { note: '새 메모' });
  // C: 옛 행만 → 단순 이관(병합 로직이 이걸 건드리면 안 된다)
  await upsertInfluencerCost(sql, campC.id, from, { note: 'C만' });
  // D: 둘 다 있음 · 새 행이 to와 다른 대소문자로 저장돼 있어도 병합 UPDATE가 살아남는 행의 표기를
  //    canonical to로 맞춘다(리뷰 Minor 2 — 병합 경로도 단순 이동 경로와 표기 규칙이 같아야 한다)
  const campD = await mkCampaign(c.id, c.name, 'f');
  await upsertInfluencerCost(sql, campD.id, from, { note: 'D옛' });
  await upsertInfluencerCost(sql, campD.id, to.toUpperCase(), { note: 'D새' });

  await renameInfluencer(sql, { influencerId: row.id, from, to, actorId: null });   // unique 위반 없이 끝나야 한다

  const a = await cicOf(campA.id);
  assert.equal(a.length, 1);
  assert.equal(a[0].influencer_handle, to);
  assert.deepEqual(a[0].extra_costs, [
    { label: '새항목', amount: 2000, currency: 'JPY' }, { label: '옛항목', amount: 1000, currency: 'KRW' },
  ]);
  assert.equal(a[0].note, '옛 메모');

  const b = await cicOf(campB.id);
  assert.equal(b.length, 1);
  assert.equal(b[0].influencer_handle, to);
  assert.deepEqual(b[0].extra_costs, [{ label: '선물', amount: 300, currency: 'KRW' }]);   // 새 행 [] 뒤에 옛 것
  assert.equal(b[0].note, '새 메모');

  const cc = await cicOf(campC.id);
  assert.equal(cc.length, 1);
  assert.equal(cc[0].influencer_handle, to);
  assert.equal(cc[0].note, 'C만');

  const d = await cicOf(campD.id);
  assert.equal(d.length, 1);
  assert.equal(d[0].influencer_handle, to, '병합 경로도 살아남는 행의 표기를 canonical to로 맞춘다');
  assert.equal(d[0].note, 'D새');

  assert.equal((await sql`select id from campaign_influencer_cost where lower(influencer_handle) = ${from.toLowerCase()}`).length, 0);
  // 참여 캠페인은 4개, 소계는 병합 후 값
  const detail = await getInfluencerDetail(sql, row.id);
  assert.equal(detail!.campaigns.length, 4);
  assert.deepEqual(detail!.campaigns.find((x) => x.id === campA.id)!.subtotal, { KRW: 1000, JPY: 2000 });
});

test('14) renameInfluencer: 표기만 바뀌면(소문자 기준 같음) 병합 없이 표기만 — extra_costs가 두 배가 되지 않는다', async () => {
  const from = P + 'casehandle';
  const to = P + 'CaseHandle';
  const { row } = await createInfluencer(sql, { handle: from, createdBy: null });
  const c = await createClient(sql, P + '클라c');
  const camp = await mkCampaign(c.id, c.name, 'e');
  await upsertInfluencerCost(sql, camp.id, from, { extraCosts: [{ label: '교통비', amount: 1, currency: 'KRW' }] });
  await renameInfluencer(sql, { influencerId: row.id, from, to, actorId: null });
  const rows = await cicOf(camp.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].influencer_handle, to);
  assert.deepEqual(rows[0].extra_costs, [{ label: '교통비', amount: 1, currency: 'KRW' }]);
});

// ── 결제 수단 (payment-method 스펙) ──
const paypalInput = (holder: string): PaymentMethodInput =>
  ({ type: 'paypal', holder, currency: 'JPY', email: 'a@b.c' });
const bankInput = (holder: string): PaymentMethodInput =>
  ({ type: 'bank', holder, currency: 'KRW', bank: '신한', account: '110543468512' });

test('15) updatePaymentMethods: add — 첫 수단은 무조건 기본, 로그 1건(added)', async () => {
  const { row } = await createInfluencer(sql, { handle: P + 'pay1', createdBy: null });
  const r = await updatePaymentMethods(sql, row.id, { kind: 'add', input: paypalInput('ゆい') }, null);
  assert.equal(r.paymentMethods.length, 1);
  assert.equal(r.paymentMethods[0].isDefault, true, '첫 수단은 기본');
  assert.equal(r.paymentMethods[0].type, 'paypal');
  assert.equal(r.logs.length, 1);
  assert.equal(r.logs[0].kind, 'auto');
  assert.equal(r.logs[0].eventType, 'payment_method_changed');
  assert.equal((r.logs[0].payload as { action: string }).action, 'added');
});

test('16) updatePaymentMethods: add(makeDefault) — 기본 이동, 로그 2건(added+default_changed)', async () => {
  const { row } = await createInfluencer(sql, { handle: P + 'pay2', createdBy: null });
  const r1 = await updatePaymentMethods(sql, row.id, { kind: 'add', input: paypalInput('ゆい') }, null);
  const firstId = r1.paymentMethods[0].id;

  const r2 = await updatePaymentMethods(
    sql, row.id, { kind: 'add', input: bankInput('오오쿠보'), makeDefault: true }, null,
  );
  assert.equal(r2.paymentMethods.length, 2);
  const first = r2.paymentMethods.find((m) => m.id === firstId)!;
  const second = r2.paymentMethods.find((m) => m.id !== firstId)!;
  assert.equal(first.isDefault, false, '옛 기본은 해제');
  assert.equal(second.isDefault, true, '새로 추가한 게 기본');
  assert.equal(r2.logs.length, 2);
  assert.deepEqual(r2.logs.map((l) => (l.payload as { action: string }).action).sort(), ['added', 'default_changed']);
});

test('17) updatePaymentMethods: update — 같은 값 재전송은 로그 0건, 필드 변경은 fields 포함', async () => {
  const { row } = await createInfluencer(sql, { handle: P + 'pay3', createdBy: null });
  const added = await updatePaymentMethods(sql, row.id, { kind: 'add', input: paypalInput('ゆい') }, null);
  const id = added.paymentMethods[0].id;

  const same = await updatePaymentMethods(sql, row.id, { kind: 'update', id, input: paypalInput('ゆい') }, null);
  assert.equal(same.logs.length, 0, '변경 없음 = 로그 없음');

  const changed = await updatePaymentMethods(
    sql, row.id, { kind: 'update', id, input: paypalInput('みか') }, null,
  );
  assert.equal(changed.logs.length, 1);
  assert.equal(changed.paymentMethods.find((m) => m.id === id)!.holder, 'みか');
  const payload = changed.logs[0].payload as { action: string; fields?: Array<{ field: string; from: string | null; to: string | null }> };
  assert.equal(payload.action, 'updated');
  assert.ok(payload.fields?.some((f) => f.field === 'holder' && f.from === 'ゆい' && f.to === 'みか'));
});

test('18) updatePaymentMethods: remove 기본 — 남은 첫 번째가 승계, 로그 2건(removed+default_changed)', async () => {
  const { row } = await createInfluencer(sql, { handle: P + 'pay4', createdBy: null });
  const r1 = await updatePaymentMethods(sql, row.id, { kind: 'add', input: paypalInput('ゆい') }, null);
  const firstId = r1.paymentMethods[0].id;
  const r2 = await updatePaymentMethods(sql, row.id, { kind: 'add', input: bankInput('오오쿠보') }, null);
  const secondId = r2.paymentMethods.find((m) => m.id !== firstId)!.id;

  const r3 = await updatePaymentMethods(sql, row.id, { kind: 'remove', id: firstId }, null);
  assert.equal(r3.paymentMethods.length, 1);
  assert.equal(r3.paymentMethods[0].id, secondId);
  assert.equal(r3.paymentMethods[0].isDefault, true, '남은 것이 기본을 승계');
  assert.equal(r3.logs.length, 2);
  assert.deepEqual(r3.logs.map((l) => (l.payload as { action: string }).action).sort(), ['default_changed', 'removed']);
});

test('19) getInfluencerDetail().paymentMethods 반영 + 없는 id는 PAYMENT_NOT_FOUND', async () => {
  const { row } = await createInfluencer(sql, { handle: P + 'pay5', createdBy: null });
  assert.deepEqual((await getInfluencerDetail(sql, row.id))!.paymentMethods, [], '빈 인플은 빈 배열');

  await updatePaymentMethods(sql, row.id, { kind: 'add', input: paypalInput('ゆい') }, null);
  const detail = await getInfluencerDetail(sql, row.id);
  assert.equal(detail!.paymentMethods.length, 1);
  assert.equal(detail!.paymentMethods[0].holder, 'ゆい');

  await assert.rejects(
    updatePaymentMethods(sql, row.id, { kind: 'update', id: 'no-such-id', input: paypalInput('x') }, null),
    (err: Error) => err.message === PAYMENT_NOT_FOUND,
  );
});
