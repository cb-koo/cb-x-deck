import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient, deleteClient } from './clientStore.ts';
import { createBudgetPeriod, listBudgetPeriods } from './budgetPeriodStore.ts';
import { insertDraft, updateDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import {
  createCampaign, listCampaigns, getCampaign, updateCampaign, deleteCampaign,
  getCampaignDetail, upsertInfluencerCost, listInfluencerCampaigns, spendByPeriods,
} from './campaignStore.ts';
import { createTasks, updateTask, hasActiveRequest } from './campaignTaskStore.ts';
import { taskCampaignTotal } from './campaignJudgment.ts';
import { createInfluencer, updatePaymentMethods } from './influencerStore.ts';
import { createRequests, listCandidates, getSettlementSettings, saveSettlementSettings } from './settlementStore.ts';
import { SETTLEMENT_DEFAULTS, type SettlementSettings } from './settlementSettings.ts';

const sql = getSql();
const P = 'tcmp' + process.pid;
const content: DraftContent = { posts: [{ text: '캠페인 스토어', media: [] }] };
const T = '2026-09-02';
// 09-11 분류 개편 뒤 운영 현재 설정에서는 SETTLEMENT_DEFAULTS의 분류가 숨김이라, DB 설정을 읽는 createRequests가 '목록에 없는 분류'로
// 튕긴다(09-14 settlementStore.test에서 발견, 이 파일은 09-19에 같은 패턴 적용). 시작 때 기본 설정(+마커)을 깔고 after()가 원래 설정으로 되돌린다.
let savedBefore: SettlementSettings | null = null;
before(async () => {
  // 이전 실행이 인터럽트로 끊겨 이 파일의 마커 행이 "현재값"으로 남아 있을 수 있다 — 먼저 지워야 아래가 진짜 원래값을 읽는다
  await sql`delete from settlement_setting_version where settings->>'marker' = ${P}`;
  savedBefore = await getSettlementSettings(sql);
  await saveSettlementSettings(sql, { ...SETTLEMENT_DEFAULTS, marker: P } as SettlementSettings & { marker: string }, null);
});
after(async () => {
  // 마커 없는 순수 복구 행을 먼저 넣어 "현재 설정"을 테스트 이전 값으로 되돌린 뒤, 이번 실행의 마커 행을 지운다(중간에 죽어도 현재값은 원래대로).
  if (savedBefore) await saveSettlementSettings(sql, savedBefore, null);
  await sql`delete from settlement_setting_version where settings->>'marker' = ${P}`;
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`;
  await sql`delete from tracking_link where utm_campaign like ${P + '%'}`;
  await sql`delete from payment_request where influencer_handle like ${P + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer_log where influencer_id in (select id from influencer where handle like ${P + '%'})`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});
const mkDraft = (clientId: string | null, clientName: string | null, taskId: string | null = null) =>
  insertDraft(sql, { clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [], content, model: null, memberId: null, taskId });
const base = (clientId: string, clientName: string, suffix: string) => ({
  clientId, clientName, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null,
});
const tin = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };

test('1) 생성 → 조회 — 기본값·목록 포함·taskCount 0·합계 {}', async () => {
  const c = await createClient(sql, P + '클라1');
  const row = await createCampaign(sql, { ...base(c.id, c.name, 'a'), note: '메모' });
  assert.equal(row.startsOn, '2026-08-31'); assert.equal(row.note, '메모'); assert.equal(row.taskCount, 0); assert.deepEqual(row.total, {});
  assert.ok((await listCampaigns(sql)).some((x) => x.id === row.id));
  assert.equal(await getCampaign(sql, 'not-a-uuid'), null);
  await updateCampaign(sql, row.id, { name: P + 'a2' });
  assert.equal((await getCampaign(sql, row.id))!.name, P + 'a2');
});

test('1b) 수정 — clientId·clientName은 함께 바뀐다(잘못 고른 클라이언트 바로잡기, 09-22)', async () => {
  const c1 = await createClient(sql, P + '클라1b-old');
  const c2 = await createClient(sql, P + '클라1b-new');
  const row = await createCampaign(sql, base(c1.id, c1.name, 'a1b'));
  await updateCampaign(sql, row.id, { clientId: c2.id, clientName: c2.name });
  const updated = await getCampaign(sql, row.id);
  assert.equal(updated!.clientId, c2.id);
  assert.equal(updated!.clientName, c2.name);
});

test('2) 상세 — 작업 목록·게시됨(posted_at)·성과(task_id)·링크 클릭(draft)·요약·인플 목록·유형별 소계·삭제 정보', async () => {
  const c = await createClient(sql, P + '클라2');
  const camp = await createCampaign(sql, base(c.id, c.name, 'b'));
  const other = await createCampaign(sql, base(c.id, c.name, 'b2'));
  const [post] = await createTasks(sql, camp.id, { ...tin, type: 'post', scheduledOn: '2026-09-01', items: [{ handle: 'mika', cost: { amount: 20000, currency: 'JPY' } }] });
  const draftId = await mkDraft(c.id, c.name, post.id);
  await updateDraft(sql, draftId, { status: 'delivered' });
  const [rt1, rt2] = await createTasks(sql, camp.id, { ...tin, type: 'rt', targetTaskId: post.id, scheduledOn: '2026-09-01', items: [{ handle: 'rio', cost: { amount: 3000, currency: 'JPY' } }, { handle: 'sora', cost: { amount: 3000, currency: 'JPY' } }] });
  const [unusedTask] = await createTasks(sql, camp.id, { ...tin, type: 'quoteRt', items: [{ handle: 'kei', cost: { amount: 8000, currency: 'JPY' } }] });
  await updateDraft(sql, await mkDraft(c.id, c.name, unusedTask.id), { status: 'unused' });
  const [cancTask] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: 'mio', cost: { amount: 5000, currency: 'JPY' } }] });
  await sql`update campaign_task set cancelled_at = '2026-08-30', cancel_reason = 'declined' where id = ${cancTask.id}`;
  await createTasks(sql, other.id, { ...tin, type: 'rt', targetTaskId: post.id, items: [{ handle: 'ten', cost: null }] });   // 다른 캠페인의 참조
  await upsertInfluencerCost(sql, camp.id, 'hana', { extraCosts: [{ label: '교통비', amount: 5000, currency: 'KRW' }] });
  // 게시물 → 작업(rt1 게시 확인 + 성과), 링크 클릭 → 원고
  await updateTask(sql, rt1.id, { postedAt: '2026-09-01', postedSource: 'auto' });
  const tp = await sql<Array<{ id: string }>>`insert into tracked_post (tweet_id, author_handle, text, task_id) values (${P + 'x1'}, 'rio', '', ${rt1.id}) returning id`;
  // 스냅샷 두 줄은 captured_at을 명시로 벌린다 — 한 문장(또는 같은 트랜잭션)에 default now()로 넣으면 두 줄의 captured_at이
  // 같아져 'order by captured_at desc limit 1'이 어느 줄을 고를지 정해지지 않는다(최신=1200/12 검증이 흔들린다).
  await sql`insert into post_metric_snapshot (tracked_post_id, views, likes, captured_at) values (${tp[0].id}, 1000, 10, now() - interval '1 hour')`;
  await sql`insert into post_metric_snapshot (tracked_post_id, views, likes, captured_at) values (${tp[0].id}, 1200, 12, now())`;
  const link = await sql<Array<{ id: string }>>`insert into tracking_link (code, landing_url, long_url, short_url, shortio_link_id, utm_campaign, influencer_handle, draft_id)
    values (${P.toLowerCase().slice(-6)}, 'https://example.com', 'https://example.com/?x', 'https://s.io/x', ${P + 'sid'}, ${P + 'utm'}, 'mika', ${draftId}) returning id`;
  await sql`insert into link_click_snapshot (tracking_link_id, total_clicks) values (${link[0].id}, 96)`;

  const d = (await getCampaignDetail(sql, camp.id, T))!;
  assert.equal(d.tasks.length, 5);   // 취소 작업도 목록엔 남는다(취소 표시는 화면 몫) — 집계에서만 빠진다
  const p = d.tasks.find((t) => t.id === post.id)!;
  assert.equal(p.draftStatus, 'delivered'); assert.equal(p.published, false); assert.equal(p.linkClicks, 96);
  const r = d.tasks.find((t) => t.id === rt1.id)!;
  assert.equal(r.published, true); assert.deepEqual(r.perf, { postCount: 1, views: 1200, likes: 12, bookmarks: null });   // 최신 스냅샷만
  assert.equal(r.target!.taskId, post.id);
  assert.equal(d.tasks.find((t) => t.id === rt2.id)!.published, false);
  // 미사용 원고(kei)는 이제 포함, 취소(mio)만 제외(R17) — post·rt2 밀림(9/1 < 9/2), rt1은 게시됨
  assert.deepEqual(d.summary, { total: 4, published: 1, delivered: 1, preparing: 1, overdue: 2, removed: 0, cancelled: 1 });
  assert.deepEqual(d.byType.map((x) => [x.type, x.count]), [['rt', 2], ['quoteRt', 1], ['post', 1]]);
  assert.deepEqual(d.influencers.map((l) => l.handle), ['kei', 'mika', 'rio', 'sora', 'hana']);   // taskCount(1) 동률은 알파벳순, kei가 새로 1건 생겨 k < m로 앞에 온다
  assert.deepEqual(d.influencers.find((l) => l.handle === 'hana')!.extraCost, { KRW: 5000 });
  assert.deepEqual(taskCampaignTotal(d.influencers), { JPY: 34000, KRW: 5000 });   // 20000+3000+3000+8000(미사용 포함), 취소(mio 5000)는 빠짐
  assert.deepEqual(d.deleteInfo, { taskCount: 5, detachedTargets: 1, activeRequests: 0 });   // 삭제 대상 수는 취소도 그대로 센다(삭제는 전부 지운다)
  assert.equal(d.today, T);
  const listed = (await listCampaigns(sql)).find((x) => x.id === camp.id)!;
  assert.equal(listed.taskCount, 4);   // 미사용 +1, 취소 제외 — 요약 카드 total(4)과 같은 모집단
  assert.deepEqual(listed.total, { JPY: 34000, KRW: 5000 });
});

test('3) 인플 프로필 참여 캠페인 — 작업 기준(lower), 유형별 건수, 비용 행만 있는 캠페인도', async () => {
  const c = await createClient(sql, P + '클라3');
  const camp = await createCampaign(sql, base(c.id, c.name, 'c'));
  await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: 'Yuna', cost: { amount: 3000, currency: 'JPY' } }, { handle: 'yuna', cost: { amount: 3000, currency: 'JPY' } }] });
  await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: 'YUNA', cost: { amount: 20000, currency: 'JPY' } }] });
  const [cancTask] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: 'yuna', cost: { amount: 5000, currency: 'JPY' } }] });
  await sql`update campaign_task set cancelled_at = '2026-08-30', cancel_reason = 'declined' where id = ${cancTask.id}`;
  // 취소된 작업은 참여 건수·비용에서 빠진다(R17) — 위 기대값이 그대로여야 한다
  const camp2 = await createCampaign(sql, base(c.id, c.name, 'c2'));
  await upsertInfluencerCost(sql, camp2.id, 'yuna', { extraCosts: [{ label: '선물', amount: 10000, currency: 'KRW' }] });
  const items = await listInfluencerCampaigns(sql, 'yuna');
  const a = items.find((x) => x.id === camp.id)!;
  assert.equal(a.taskCount, 3); assert.deepEqual(a.countsByType, { rt: 2, post: 1 }); assert.deepEqual(a.subtotal, { JPY: 26000 });
  const b = items.find((x) => x.id === camp2.id)!;
  assert.equal(b.taskCount, 0); assert.deepEqual(b.subtotal, { KRW: 10000 });
});

test('4) 삭제 — 작업은 cascade, 원고는 남고, 다른 캠페인의 참조는 대상 미정으로, 응답에 숫자', async () => {
  const c = await createClient(sql, P + '클라4');
  const camp = await createCampaign(sql, base(c.id, c.name, 'd'));
  const other = await createCampaign(sql, base(c.id, c.name, 'd2'));
  const [post] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: 'mika', cost: null }] });
  const draftId = await mkDraft(c.id, c.name, post.id);
  const [rt] = await createTasks(sql, other.id, { ...tin, type: 'rt', targetTaskId: post.id, items: [{ handle: 'rio', cost: null }] });
  assert.deepEqual(await deleteCampaign(sql, 'not-a-uuid'), { deleted: false, taskCount: 0, detachedTargets: 0, activeRequests: 0 });   // 22P02 방지 경로
  await upsertInfluencerCost(sql, camp.id, 'gone', { note: 'x' });   // 삭제 캠페인의 비용 행도 cascade로 사라져야 한다
  assert.deepEqual(await deleteCampaign(sql, camp.id), { deleted: true, taskCount: 1, detachedTargets: 1, activeRequests: 0 });
  assert.equal((await sql`select id from draft where id = ${draftId}`).length, 1);
  assert.equal((await sql`select target_task_id from campaign_task where id = ${rt.id}`)[0].target_task_id, null);
  assert.equal((await sql`select id from campaign_influencer_cost where campaign_id = ${camp.id}`).length, 0);
  assert.deepEqual(await deleteCampaign(sql, camp.id), { deleted: false, taskCount: 0, detachedTargets: 0, activeRequests: 0 });
  await deleteClient(sql, c.id);
  assert.equal((await getCampaign(sql, other.id))!.clientName, c.name);   // 스냅샷 유지
});

// 5~7)은 작업 전환과 무관한 기존 검증(DB check·부분 패치·upsert) — 옛 파일에서 그대로 옮겨 왔다.
// 작업 기준으로 다시 쓸 것이 없는 규칙이라 여기서 사라지면 아무도 지키지 않는다.
test('5) 기간 역순은 DB check가 막는다(라우트 검증의 최후 방어)', async () => {
  const c = await createClient(sql, P + '클라5');
  // 매처로 제약 이름까지 확인 — 오타로 다른 컬럼 체크가 걸려도 통과해버리는 걸 막는다
  await assert.rejects(
    () => createCampaign(sql, { ...base(c.id, c.name, 'e'), startsOn: '2026-09-06', endsOn: '2026-08-31' }),
    /campaign_period_check/,
  );
});

test('6) 수정 — 부분 패치, kind null=지움, updated_at 갱신', async () => {
  const c = await createClient(sql, P + '클라6');
  const row = await createCampaign(sql, { ...base(c.id, c.name, 'f'), kind: 'visit' });
  await updateCampaign(sql, row.id, { name: P + 'f2', endsOn: '2026-09-13' });
  const got = await getCampaign(sql, row.id);
  assert.equal(got!.name, P + 'f2');
  assert.equal(got!.endsOn, '2026-09-13');
  assert.equal(got!.startsOn, '2026-08-31');
  assert.equal(got!.kind, 'visit');                          // undefined = 유지
  assert.ok(got!.updatedAt > row.updatedAt);
  await updateCampaign(sql, row.id, { kind: null });
  assert.equal((await getCampaign(sql, row.id))!.kind, null); // null = 지움
});

test('7) 추가 비용 upsert — 처음엔 insert, 다음엔 부분 갱신(대소문자 무관 같은 행), 작업 0이어도 인플 목록에 나온다', async () => {
  const c = await createClient(sql, P + '클라7');
  const row = await createCampaign(sql, base(c.id, c.name, 'g'));
  const first = await upsertInfluencerCost(sql, row.id, 'Ghost', { note: '아직 작업 없음' });
  assert.deepEqual(first.extraCosts, []);
  assert.equal(first.note, '아직 작업 없음');
  const second = await upsertInfluencerCost(sql, row.id, 'ghost', { extraCosts: [{ label: '선물', amount: 5000, currency: 'JPY' }] });
  assert.equal(second.id, first.id);                      // 같은 행
  assert.equal(second.influencerHandle, 'Ghost');         // 표기는 처음 것 보존
  assert.equal(second.note, '아직 작업 없음');            // undefined = 유지
  assert.deepEqual(second.extraCosts, [{ label: '선물', amount: 5000, currency: 'JPY' }]);
  const third = await upsertInfluencerCost(sql, row.id, 'ghost', { note: '수정' });
  assert.deepEqual(third.extraCosts, [{ label: '선물', amount: 5000, currency: 'JPY' }]); // note-only 패치는 extraCosts를 보존
  assert.equal(third.note, '수정');
  const detail = await getCampaignDetail(sql, row.id, T);
  const line = detail!.influencers.find((l) => l.handle === 'Ghost')!;
  assert.equal(line.taskCount, 0);
  assert.equal(line.hasCostRow, true);
  assert.deepEqual(line.subtotal, { JPY: 5000 });
});

test('12) spendByPeriods — 시작일이 속한 기간으로 묶고 totalsFor와 같은 정의, 기간 종료일 넘는 캠페인은 spanning', async () => {
  const c = await createClient(sql, P + '예산클라');
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 });
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-09-01', endsOn: '2026-09-30', amountKrw: 1 });
  const periods = await listBudgetPeriods(sql, c.id);
  const aug = periods.find((p) => p.startsOn === '2026-08-01')!;
  const sep = periods.find((p) => p.startsOn === '2026-09-01')!;

  const aug1 = await createCampaign(sql, { ...base(c.id, c.name, 'm1'), startsOn: '2026-08-03', endsOn: '2026-08-09' });
  const aug2 = await createCampaign(sql, { ...base(c.id, c.name, 'm2'), startsOn: '2026-08-31', endsOn: '2026-09-06' }); // 8월 기간을 넘어 9월까지
  await createCampaign(sql, { ...base(c.id, c.name, 'm3'), startsOn: '2026-09-01', endsOn: '2026-09-07' });
  await createTasks(sql, aug1.id, { ...tin, type: 'post', items: [{ handle: 'hana', cost: { amount: 300_000, currency: 'KRW' } }] });
  const [skip] = await createTasks(sql, aug1.id, { ...tin, type: 'post', items: [{ handle: 'hana', cost: { amount: 777_777, currency: 'KRW' } }] });
  await updateDraft(sql, await mkDraft(c.id, c.name, skip.id), { status: 'unused' });
  const [cancTask] = await createTasks(sql, aug1.id, { ...tin, type: 'post', items: [{ handle: 'hana', cost: { amount: 999_999, currency: 'KRW' } }] });
  await sql`update campaign_task set cancelled_at = '2026-08-30', cancel_reason = 'declined' where id = ${cancTask.id}`;
  await createTasks(sql, aug2.id, { ...tin, type: 'post', items: [{ handle: 'mika', cost: { amount: 95_000, currency: 'JPY' } }] });
  await upsertInfluencerCost(sql, aug1.id, 'hana', { extraCosts: [{ label: '교통비', amount: 20_000, currency: 'KRW' }] });

  const all = await spendByPeriods(sql, c.id, periods);
  const augSpend = all.get(aug.id)!;
  assert.deepEqual(augSpend.total, { KRW: 1_097_777, JPY: 95_000 });
  assert.equal(augSpend.campaignCount, 2);              // aug1 + aug2(시작일이 8/31이라 8월 기간에 귀속)
  assert.deepEqual(augSpend.spanning, [{ id: aug2.id, endsOn: '2026-09-06' }]);   // aug2는 9월까지 이어짐
  const sepSpend = all.get(sep.id)!;
  assert.deepEqual(sepSpend.total, {});
  assert.equal(sepSpend.campaignCount, 1);              // m3만(aug2는 8월 기간 몫)
  assert.deepEqual(sepSpend.spanning, []);

  // 다른 클라이언트의 캠페인은 섞이지 않는다
  const other = await createClient(sql, P + '남의클라');
  await createCampaign(sql, { ...base(other.id, other.name, 'm4'), startsOn: '2026-08-10', endsOn: '2026-08-16' });
  assert.equal((await spendByPeriods(sql, c.id, periods)).get(aug.id)!.campaignCount, 2);
});

test('12-1) spendByPeriods — feeKrw·feeUnknown(인플 부담 0 · CB 비율 5% · CB 고정 ¥165 · 결제 수단 없음)', async () => {
  const c = await createClient(sql, P + '수수료클라');
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 });
  const period = (await listBudgetPeriods(sql, c.id))[0];
  const camp = await createCampaign(sql, { ...base(c.id, c.name, 'fee'), startsOn: '2026-08-12', endsOn: '2026-08-18' });

  const bank = (fee?: { mode: 'grossUp'; percent: number } | { mode: 'fixed'; amount: number }) =>
    ({ kind: 'add' as const, input: { type: 'bank' as const, holder: 'K', currency: 'JPY' as const, bank: 'b', account: '1', ...(fee ? { fee } : {}) }, makeDefault: true });

  const { row: selfPay } = await createInfluencer(sql, { handle: P + '_self', createdBy: null });
  await updatePaymentMethods(sql, selfPay.id, bank(), null);
  const { row: grossUp } = await createInfluencer(sql, { handle: P + '_gross', createdBy: null });
  await updatePaymentMethods(sql, grossUp.id, bank({ mode: 'grossUp', percent: 5 }), null);
  const { row: fixed } = await createInfluencer(sql, { handle: P + '_fixed', createdBy: null });
  await updatePaymentMethods(sql, fixed.id, bank({ mode: 'fixed', amount: 165 }), null);
  const { row: noMethod } = await createInfluencer(sql, { handle: P + '_none', createdBy: null });

  await createTasks(sql, camp.id, { ...tin, type: 'post', items: [
    { handle: selfPay.handle, cost: { amount: 10_000, currency: 'JPY' } },
    { handle: grossUp.handle, cost: { amount: 10_000, currency: 'JPY' } },
    { handle: fixed.handle, cost: { amount: 10_000, currency: 'JPY' } },
    { handle: noMethod.handle, cost: { amount: 10_000, currency: 'JPY' } },
  ] });
  await upsertInfluencerCost(sql, camp.id, selfPay.handle, { extraCosts: [{ label: '교통비', amount: 1_000, currency: 'JPY' }] });

  const spend = (await spendByPeriods(sql, c.id, [period])).get(period.id)!;
  assert.deepEqual(spend.total, { JPY: 41_000 });
  assert.equal(spend.feeKrw, 5_260 + 1_650);
  assert.equal(spend.feeUnknown, 1);
});

test('12-2) spendByPeriods — 작업이 고른 결제 수단의 수수료로 합계(060), 고른 수단이 없어지면 기본 수단', async () => {
  const c = await createClient(sql, P + '수수료클라2');
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 });
  const period = (await listBudgetPeriods(sql, c.id))[0];
  const camp = await createCampaign(sql, { ...base(c.id, c.name, 'fee2'), startsOn: '2026-08-12', endsOn: '2026-08-18' });
  const { row: inf } = await createInfluencer(sql, { handle: P + '_pick', createdBy: null });
  await updatePaymentMethods(sql, inf.id, { kind: 'add', input: { type: 'bank', holder: 'K', currency: 'JPY', bank: 'b', account: '1' }, makeDefault: true }, null);   // 기본 = 인플 부담
  const r = await updatePaymentMethods(sql, inf.id, { kind: 'add', input: { type: 'bank', holder: 'K', currency: 'JPY', bank: 'b', account: '2', fee: { mode: 'fixed', amount: 165 } } }, null);
  const cb = r.paymentMethods.find((x) => x.account === '2')!;
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: inf.handle, cost: { amount: 10_000, currency: 'JPY' }, paymentMethodId: cb.id }] });
  assert.equal((await spendByPeriods(sql, c.id, [period])).get(period.id)!.feeKrw, 1_650);   // ¥165 × 10(12-1과 같은 환산)
  await sql`update campaign_task set payment_method_id = 'gone' where id = ${t.id}`;
  assert.equal((await spendByPeriods(sql, c.id, [period])).get(period.id)!.feeKrw, 0);        // 기본(인플 부담)으로
});

test('13) getCampaignDetail.budget — 기간에 귀속·othersKrw는 같은 기간 다른 캠페인 몫·클라 없으면 null·기간 밖이면 source none', async () => {
  const c = await createClient(sql, P + '예산클라2');
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 2_500_000 });
  const a = await createCampaign(sql, { ...base(c.id, c.name, 'b1'), startsOn: '2026-08-03', endsOn: '2026-08-09' });
  const b = await createCampaign(sql, { ...base(c.id, c.name, 'b2'), startsOn: '2026-08-17', endsOn: '2026-08-23' });
  await createTasks(sql, a.id, { ...tin, type: 'post', items: [{ handle: 'hana', cost: { amount: 1_200_000, currency: 'KRW' } }] });
  await createTasks(sql, b.id, { ...tin, type: 'post', items: [{ handle: 'mika', cost: { amount: 65_000, currency: 'JPY' } }] });   // 650,000원

  const detA = (await getCampaignDetail(sql, a.id, T))!;
  assert.equal(detA.budget!.period!.amountKrw, 2_500_000);
  assert.equal(detA.budget!.source, 'period');
  assert.equal(detA.budget!.othersKrw, 650_000);
  assert.equal(detA.budget!.campaignCount, 2);
  const detB = (await getCampaignDetail(sql, b.id, T))!;
  assert.equal(detB.budget!.othersKrw, 1_200_000);

  // 9월은 기간이 없으므로 source none
  const s = await createCampaign(sql, { ...base(c.id, c.name, 'b3'), startsOn: '2026-09-07', endsOn: '2026-09-13' });
  const detS = (await getCampaignDetail(sql, s.id, T))!;
  assert.deepEqual(detS.budget, { period: null, source: 'none', othersKrw: 0, campaignCount: 0, badge: null });

  // 클라이언트를 지우면(client_id set null) budget은 null
  await deleteClient(sql, c.id);
  assert.equal((await getCampaignDetail(sql, a.id, T))!.budget, null);
});

test('정산 배지·삭제 보호 — 활성 요청이 있으면 settlement 채워지고 activeRequests 1', async () => {
  const c = await createClient(sql, P + '클라S');
  const camp = await createCampaign(sql, base(c.id, c.name, 's'));
  const h = P + '_stl';
  const { row: inf } = await createInfluencer(sql, { handle: h, createdBy: null });
  await updatePaymentMethods(sql, inf.id, { kind: 'add', input: { type: 'paypal', holder: 'K', currency: 'JPY', email: 'k@x.com' }, makeDefault: true }, null);
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: h, cost: { amount: 10000, currency: 'KRW' } }] });
  // 증빙 없는 RT는 요청이 막히므로(09-02) 픽스처에 증빙을 채운다
  await updateTask(sql, t.id, { postedAt: '2026-09-01', postedSource: 'manual', proof: { url: `task/${t.id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png`, by: null, byName: '박구건', at: '2026-08-31T01:00:00.000Z' } });
  const [m] = await sql<Array<{ id: string }>>`insert into member (name, color) values (${P + '멤버S'}, '#000') returning id`;
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-09-01')).find((x) => x.taskId === t.id)!;
  await createRequests(sql, [{ taskId: t.id, category: cand.categoryDefault!, deadlineOn: cand.deadlineDefault, referenceUrl: null, expected: { amountGross: cand.money!.amountGross, payoutCurrency: cand.money!.payoutCurrency, paymentMethodId: cand.method!.id } }], { id: m.id, name: P + '멤버S' });
  const d = (await getCampaignDetail(sql, camp.id, '2026-09-01'))!;
  assert.equal(d.tasks.find((x) => x.id === t.id)!.settlement?.status, 'requested');
  assert.equal(d.deleteInfo.activeRequests, 1);
  assert.equal(await hasActiveRequest(sql, t.id), true);
  // 정리는 after()가 P 접두어 기준으로 일괄 처리한다(중간에 assert 실패해도 잔여 행 방지)
});
