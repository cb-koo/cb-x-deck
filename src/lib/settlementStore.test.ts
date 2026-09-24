import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient, deleteClient } from './clientStore.ts';
import { createCampaign, updateCampaign } from './campaignStore.ts';
import { createTasks, updateTask, getTask, deleteTask } from './campaignTaskStore.ts';
import { createInfluencer, updatePaymentMethods, deleteInfluencer } from './influencerStore.ts';
import type { PaymentMethodInput } from './influencerPayment.ts';
import { SETTLEMENT_DEFAULTS, type SettlementSettings } from './settlementSettings.ts';
import { isSettlementCandidate } from './campaignJudgment.ts';
import {
  getSettlementSettings, saveSettlementSettings, listSettlementVersions, lastQuoteRtCategory, listCandidates,
  createRequests, cancelRequest, listRequests, settlementByTaskIds, SettlementCreateError,
  listForExport, getForExport, applyExternalStatus, ackDiff, unackDiff,
  reviseRequest, previewRevision, listRevisions, applyPaymentMethodCorrection, precheckCorrectionForQrUpload,
} from './settlementStore.ts';
import type { CreateItemInput, PaymentRequestRow } from './settlementStore.ts';
import { encodeCursor, decodeCursor, toExternalItem } from './settlementExternal.ts';
import { hasPaidDiff } from './settlementDisplay.ts';

const sql = getSql();
const P = 'tstl' + process.pid;
const H = (s: string) => `${P}_${s}`;   // 핸들도 접두어 — 명부 정리를 위해
// 설정 테스트가 중단(인터럽트)돼도 프로덕션 설정을 테스트 값으로 남기지 않기 위한 원상복구용 — 테스트 시작 시 채운다
let savedBefore: SettlementSettings | null = null;
// 09-11 분류 개편 뒤 프로덕션 현재 설정에서는 SETTLEMENT_DEFAULTS의 분류 3개가 숨김이라, DB 설정을 읽는 createRequests가 '목록에 없는 분류'로
// 전부 튕겼다(09-14 발견). 테스트는 기본 분류를 전제하므로 시작할 때 기본 설정(+마커)을 깔고, after()가 원래 설정으로 되돌린다.
before(async () => {
  // 이전 실행이 인터럽트로 끊겨 이 파일의 마커 행이 "현재값"으로 남아 있을 수 있다 — 먼저 지워야 아래가 진짜 원래값을 읽는다
  await sql`delete from settlement_setting_version where settings->>'marker' = ${P}`;
  savedBefore = await getSettlementSettings(sql);
  await saveSettlementSettings(sql, { ...SETTLEMENT_DEFAULTS, marker: P } as SettlementSettings & { marker: string }, null);
});
after(async () => {
  // 마커 없는 순수 복구 행을 먼저 넣어 "현재 설정"을 테스트 이전 값으로 되돌린다 — 그 다음 이번 실행의 마커 행을 지운다.
  // 순서를 바꾸지 않는 이유: 중간에 프로세스가 죽어도 이 행이 이미 최신이면 현재값은 항상 원래대로다.
  if (savedBefore) await saveSettlementSettings(sql, savedBefore, null);
  await sql`delete from payment_request where influencer_handle like ${P + '%'}`;
  await sql`delete from settlement_setting_version where settings->>'marker' = ${P}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer_log where influencer_id in (select id from influencer where handle like ${P + '%'})`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});
const base = (clientId: string, clientName: string, suffix: string, kind: 'content' | 'visit' | null = 'content') => ({
  clientId, clientName, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind, note: '', createdBy: null,
});
const tin = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };
// 09-02부터 증빙 없는 RT는 🔴로 요청이 막힌다 — 요청 생성이 목적인 RT 픽스처는 이걸로 증빙을 채운다
const fakeProof = (taskId: string) => ({ url: `task/${taskId}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png`, by: null, byName: '박구건', at: '2026-08-31T01:00:00.000Z' });
async function postedRtWithProof(taskId: string) {
  await updateTask(sql, taskId, { postedAt: '2026-08-27', postedSource: 'manual', proof: fakeProof(taskId) });
}
async function influencerWithPaypal(handle: string) {
  const { row } = await createInfluencer(sql, { handle, createdBy: null });
  await updatePaymentMethods(sql, row.id, { kind: 'add', input: { type: 'paypal', holder: 'KEIKO', currency: 'JPY', email: `${handle}@x.com`, fee: { mode: 'grossUp', percent: 5 } }, makeDefault: true }, null);
  return row;
}

test('후보 — 게시됨+비용+인플만, 명부/결제 수단 유무가 신호등, 활성 요청 있으면 제외', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await createCampaign(sql, base(c.id, c.name, 'a'));
  await influencerWithPaypal(H('pay'));
  const { row: noPm } = await createInfluencer(sql, { handle: H('nopm'), createdBy: null });
  assert.ok(noPm);
  const [tPay, tNoPm, tNoRoster, tNoCost, tNotPosted] = await createTasks(sql, camp.id, {
    ...tin, type: 'quoteRt',
    items: [
      { handle: H('pay'), cost: { amount: 30000, currency: 'KRW' } },
      { handle: H('nopm'), cost: { amount: 30000, currency: 'KRW' } },
      { handle: H('ghost'), cost: { amount: 30000, currency: 'KRW' } },
      { handle: H('pay'), cost: null },
      { handle: H('pay'), cost: { amount: 1000, currency: 'KRW' } },
    ],
  });
  for (const t of [tPay, tNoPm, tNoRoster, tNoCost]) await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/a/status/1' });
  const list = (await listCandidates(sql, SETTLEMENT_DEFAULTS, null, '2026-08-28')).filter((x) => x.influencerHandle.startsWith(P));
  const ids = list.map((x) => x.taskId);
  assert.ok(ids.includes(tPay.id) && ids.includes(tNoPm.id) && ids.includes(tNoRoster.id));
  assert.ok(!ids.includes(tNoCost.id) && !ids.includes(tNotPosted.id));
  // 스펙 §2-4: SQL 후보 조건이 campaignJudgment.isSettlementCandidate와 같은 답을 내야 한다 — 둘이 갈리면 안 된다
  for (const t of [tPay, tNoPm, tNoRoster, tNoCost, tNotPosted]) {
    const task = await getTask(sql, t.id);
    assert.ok(task);
    assert.equal(
      isSettlementCandidate({ postedAt: task.postedAt, cost: task.cost, influencerHandle: task.influencerHandle, removedAt: task.removedAt, cancelledAt: task.cancelledAt }),
      ids.includes(task.id),
    );
  }
  // 취소된 작업은 게시·비용·인플이 있어도 후보에서 빠진다(ADR 0002) — check 제약상 posted_at·cancelled_at을 동시에 못 찍으니
  // posted_at을 지우고 cancelled_at을 찍은 뒤, 순수 함수와 SQL 둘 다에서 후보가 아님을 확인한다.
  await sql`update campaign_task set posted_at = null, cancelled_at = '2026-08-27' where id = ${tPay.id}`;
  const taskCancelled = await getTask(sql, tPay.id);
  assert.ok(taskCancelled);
  assert.equal(
    isSettlementCandidate({ postedAt: taskCancelled.postedAt, cost: taskCancelled.cost, influencerHandle: taskCancelled.influencerHandle, removedAt: taskCancelled.removedAt, cancelledAt: taskCancelled.cancelledAt }),
    false,
  );
  const listAfterCancel = (await listCandidates(sql, SETTLEMENT_DEFAULTS, null, '2026-08-28')).filter((x) => x.influencerHandle.startsWith(P));
  assert.ok(!listAfterCancel.map((x) => x.taskId).includes(tPay.id));
  const pay = list.find((x) => x.taskId === tPay.id)!;
  assert.equal(pay.money?.amountGross, 3158); assert.equal(pay.method?.type, 'paypal');
  assert.equal(pay.readiness, 'blocked');   // 인용RT 첫 요청 — 분류 빈칸
  assert.equal(pay.categoryDefault, null);
  assert.equal(list.find((x) => x.taskId === tNoPm.id)!.issues[0].code, 'no-payment-method');
  assert.equal(list.find((x) => x.taskId === tNoRoster.id)!.issues[0].code, 'no-influencer');
  assert.equal(pay.clientName, c.name); assert.equal(pay.campaignName, camp.name); assert.equal(pay.deadlineDefault, '2026-08-31');
});

test('lastQuoteRtCategory — 없으면 null', async () => {
  assert.equal(await lastQuoteRtCategory(sql, '00000000-0000-0000-0000-000000000000'), null);
  assert.equal(await lastQuoteRtCategory(sql, null), null);
});

const MEMBER = { name: P + '멤버' };
// member FK가 있어 실제 멤버가 필요 — 테스트 멤버를 만들고 after에서 지운다
let memberId = '';
async function ensureMember() {
  if (memberId) return { id: memberId, name: MEMBER.name };
  const [m] = await sql<Array<{ id: string }>>`insert into member (name, color) values (${MEMBER.name}, '#000') returning id`;
  memberId = m.id;
  return { id: memberId, name: MEMBER.name };
}
const itemOf = (c: { taskId: string; money: { amountGross: number; payoutCurrency: 'KRW' | 'JPY' } | null; method: { id: string } | null; deadlineDefault: string; referenceDefault: string | null }, category: string): CreateItemInput => ({
  taskId: c.taskId, category, deadlineOn: c.deadlineDefault, referenceUrl: c.referenceDefault,
  expected: { amountGross: c.money!.amountGross, payoutCurrency: c.money!.payoutCurrency, paymentMethodId: c.method!.id },
});

test('생성 — 스냅샷·로그·후보에서 제외·배지', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라B');
  const camp = await createCampaign(sql, base(c.id, c.name, 'b', 'visit'));
  await influencerWithPaypal(H('gen'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H('gen'), cost: { amount: 200000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/g/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  assert.equal(cand.readiness, 'ready');
  assert.equal(cand.categoryDefault, SETTLEMENT_DEFAULTS.categories[1].sendAs);   // visit 캠페인 투고 → 원고료
  const [row] = await createRequests(sql, [itemOf(cand, cand.categoryDefault!)], m, '2026-08-28');
  assert.equal(row.status, 'requested'); assert.equal(row.amountKrw, 200000); assert.equal(row.amountNet, 20000); assert.equal(row.amountGross, 21053);
  assert.equal(row.category, cand.categoryDefault); assert.equal(row.categoryDefault, cand.categoryDefault);
  assert.equal(row.itemText, `@${H('gen')} 투고 1건 정산`); assert.equal(row.purposeText, `${c.name} 방문협찬 원고료`);
  assert.equal(row.paymentMethod.type, 'paypal'); assert.equal(row.requesterName, m.name); assert.equal(row.deadlineOn, '2026-08-31');
  assert.equal(row.sentAt, null);
  // 후보에서 빠짐
  assert.ok(!(await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).some((x) => x.taskId === t.id));
  // 로그 1건
  const logs = await sql<Array<{ event_type: string; payload: { requestId: string } }>>`
    select event_type, payload from influencer_log where influencer_id = (select id from influencer where handle = ${H('gen')}) and event_type = 'payment_requested'`;
  assert.equal(logs.length, 1); assert.equal(logs[0].payload.requestId, row.id);
  // 배지
  const badge = await settlementByTaskIds(sql, [t.id]);
  assert.equal(badge.get(t.id)?.status, 'requested');
  // 최근 인용RT 분류는 quoteRt만 본다
  assert.equal(await lastQuoteRtCategory(sql, m.id), null);
});

test('요청 스냅샷 — 만든 시점의 증빙이 요청 행에 복사된다(전송은 안 한다)', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라Proof');
  const camp = await createCampaign(sql, base(c.id, c.name, 'proof', 'visit'));
  await influencerWithPaypal(H('proof'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'rt', targetTweetUrl: 'https://x.com/target/status/1', items: [{ handle: H('proof'), cost: { amount: 30000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual' });
  const proof = {
    url: `task/${t.id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png`,
    by: null, byName: '박구건', at: '2026-08-31T01:00:00.000Z',
  };
  await updateTask(sql, t.id, { proof });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  assert.deepEqual(cand.proof, proof);
  assert.equal(cand.issues.some((i) => i.code === 'no-proof'), false);   // 증빙이 있으니 경고가 없다
  const [row] = await createRequests(sql, [itemOf(cand, cand.categoryDefault!)], m, '2026-08-28');
  assert.deepEqual(row.proof, proof);
  // 다시 읽어도(스토리지 왕복 없이 저장된 스냅샷 그대로) 같은 값 — listRequests 경로도 같은 R_SELECT/toRequest를 탄다
  const [reloaded] = await listRequests(sql, { taskId: t.id });
  assert.deepEqual(reloaded.proof, proof);
});

test('생성 — 전체 검증: 하나라도 실패면 0건 저장, 건별 이유', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라C');
  const camp = await createCampaign(sql, base(c.id, c.name, 'c'));
  await influencerWithPaypal(H('v1')); await influencerWithPaypal(H('v2'));
  const [t1, t2] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: H('v1'), cost: { amount: 30000, currency: 'KRW' } }, { handle: H('v2'), cost: { amount: 30000, currency: 'KRW' } }] });
  for (const t of [t1, t2]) await postedRtWithProof(t.id);
  const cands = await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28');
  const c1 = cands.find((x) => x.taskId === t1.id)!, c2 = cands.find((x) => x.taskId === t2.id)!;
  // t2의 expected 금액을 틀리게(화면이 낡은 값을 들고 있던 상황)
  const stale = { ...itemOf(c2, c2.categoryDefault!), expected: { ...itemOf(c2, c2.categoryDefault!).expected, amountGross: 999 } };
  await assert.rejects(createRequests(sql, [itemOf(c1, c1.categoryDefault!), stale], m, '2026-08-28'), (e: unknown) => {
    assert.ok(e instanceof SettlementCreateError);
    assert.deepEqual(e.failures.map((f) => f.taskId), [t2.id]);
    assert.match(e.failures[0].reason, /금액이 바뀌었어요/);
    return true;
  });
  assert.equal((await listRequests(sql, { campaignId: camp.id })).length, 0);   // 0건 저장
  // 분류 빈칸·숨김/모르는 분류·날짜 형식·URL 형식
  await assert.rejects(createRequests(sql, [{ ...itemOf(c1, '없는 분류') }], m), (e: SettlementCreateError) => /분류/.test(e.failures[0].reason));
  await assert.rejects(createRequests(sql, [{ ...itemOf(c1, c1.categoryDefault!), deadlineOn: '2026-13-40' }], m), (e: SettlementCreateError) => /마감/.test(e.failures[0].reason));
  await assert.rejects(createRequests(sql, [{ ...itemOf(c1, c1.categoryDefault!), referenceUrl: 'ftp://x' }], m), (e: SettlementCreateError) => /링크/.test(e.failures[0].reason));
  // 정상 2건 → 저장, 같은 작업 다시 → 전체 거절(이미 요청됨)
  const rows = await createRequests(sql, [itemOf(c1, c1.categoryDefault!), itemOf(c2, c2.categoryDefault!)], m, '2026-08-28');
  assert.equal(rows.length, 2);
  await assert.rejects(createRequests(sql, [itemOf(c1, c1.categoryDefault!)], m), (e: SettlementCreateError) => /이미 요청됐어요/.test(e.failures[0].reason));
});

test('생성 — 같은 작업 두 번 고르면 거절, 저장 0건', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라E');
  const camp = await createCampaign(sql, base(c.id, c.name, 'e'));
  await influencerWithPaypal(H('dup'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: H('dup'), cost: { amount: 10000, currency: 'KRW' } }] });
  await postedRtWithProof(t.id);
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const item = itemOf(cand, cand.categoryDefault!);
  await assert.rejects(createRequests(sql, [item, item], m, '2026-08-28'), (e: unknown) => {
    assert.ok(e instanceof SettlementCreateError);
    assert.equal(e.failures.length, 1);
    assert.equal(e.failures[0].taskId, t.id);
    assert.match(e.failures[0].reason, /두 번 골라졌어요/);
    return true;
  });
  assert.equal((await listRequests(sql, { campaignId: camp.id })).length, 0);
});

test('목록 — 기간 필터는 서울 자정 기준', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라F');
  const camp = await createCampaign(sql, base(c.id, c.name, 'f'));
  await influencerWithPaypal(H('range'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: H('range'), cost: { amount: 10000, currency: 'KRW' } }] });
  await postedRtWithProof(t.id);
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const [row] = await createRequests(sql, [itemOf(cand, cand.categoryDefault!)], m, '2026-08-28');
  // 8-28 00:30 KST = 8-27 15:30 UTC — 세션 TimeZone이 UTC면 옛 ::timestamptz 캐스트는
  // 이 시각을 8-27로 잘못 분류한다(경계를 넘지 못함). 이 고정 시각이라야 옛 캐스트와 구별된다.
  await sql`update payment_request set created_at = '2026-08-28T00:30:00+09:00' where id = ${row.id}`;
  const onDay = await listRequests(sql, { taskId: t.id, from: '2026-08-28', to: '2026-08-28' });
  assert.equal(onDay.length, 1); assert.equal(onDay[0].taskId, t.id);
  const before = await listRequests(sql, { taskId: t.id, to: '2026-08-27' });
  assert.equal(before.length, 0);
  const after28 = await listRequests(sql, { taskId: t.id, from: '2026-08-29' });
  assert.equal(after28.length, 0);
});

test('취소 — 상태·사유·사람·시각, 후보 복귀, 재요청 허용, 배지는 취소됨', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라D');
  const camp = await createCampaign(sql, base(c.id, c.name, 'd'));
  await influencerWithPaypal(H('cx'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: H('cx'), cost: { amount: 10000, currency: 'KRW' } }] });
  await postedRtWithProof(t.id);
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const [row] = await createRequests(sql, [itemOf(cand, cand.categoryDefault!)], m, '2026-08-28');
  const cancelled = await cancelRequest(sql, row.id, '금액 착오', m);
  assert.ok(typeof cancelled === 'object');
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.cancelReason, '금액 착오'); assert.equal(cancelled.cancelledByName, m.name); assert.ok(cancelled.cancelledAt);
  assert.equal(await cancelRequest(sql, row.id, '다시', m), 'already-cancelled');
  assert.equal(await cancelRequest(sql, '00000000-0000-0000-0000-000000000009', 'x', m), 'not-found');
  assert.ok((await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).some((x) => x.taskId === t.id));   // 복귀
  assert.equal((await settlementByTaskIds(sql, [t.id])).get(t.id)?.status, 'cancelled');
  const again = await createRequests(sql, [itemOf(cand, cand.categoryDefault!)], m, '2026-08-28');
  assert.equal(again.length, 1);
  assert.equal((await settlementByTaskIds(sql, [t.id])).get(t.id)?.status, 'requested');   // 활성 우선
  const logs = await sql<Array<{ event_type: string }>>`select event_type from influencer_log where influencer_id = (select id from influencer where handle = ${H('cx')}) order by created_at`;
  assert.deepEqual(logs.map((l) => l.event_type), ['payment_method_changed', 'payment_requested', 'payment_cancelled', 'payment_requested']);
  // 목록 필터
  const list = await listRequests(sql, { campaignId: camp.id, status: 'cancelled' });
  assert.equal(list.length, 1); assert.equal(list[0].id, row.id);
  assert.equal((await listRequests(sql, { taskId: t.id })).length, 2);
});

// 이 위치에 두는 이유는 이제 순서 문제가 아니다 — 테스트 본문 끝에서 바로 원래값으로 복구하고(인라인),
// after()가 한 번 더 같은 복구를 시도한다(인터럽트로 본문이 끝까지 못 갈 때 대비). 이중 복구라 파일 내 위치가 어디든 무방하다.
test('설정 — 행 없으면 기본값, 저장하면 마지막 행이 현재값, 버전 목록', async () => {
  // 인터럽트 잔여 정리와 원래값 보관은 파일 앞의 before()가 한다(09-14). 여기서는 "이 테스트 직전 값"(= before()가 깐 기본 설정)으로만 되돌린다 —
  // 뒤따르는 생성 테스트들이 기본 분류를 전제하기 때문에, 여기서 프로덕션 원래값으로 되돌리면 그 뒤가 전부 '목록에 없는 분류'로 깨진다.
  const before = await getSettlementSettings(sql);
  assert.ok(before.categories.length >= 1 && before.rateKrwPerJpy >= 1);
  const mine = { ...SETTLEMENT_DEFAULTS, rateKrwPerJpy: 11, marker: P } as typeof SETTLEMENT_DEFAULTS & { marker: string };
  await saveSettlementSettings(sql, mine, null);
  const cur = await getSettlementSettings(sql);
  assert.equal(cur.rateKrwPerJpy, 11);
  const versions = await listSettlementVersions(sql, 1);
  assert.equal(versions.length, 1);
  // 본문 끝에서 직전 값으로 복구(마커를 붙여 after()가 지운다) — 프로덕션 원래값 복구는 after()의 몫
  await saveSettlementSettings(sql, { ...before, marker: P } as SettlementSettings & { marker: string }, null);
  assert.equal((await getSettlementSettings(sql)).rateKrwPerJpy, before.rateKrwPerJpy);
});

test('생성 — influencer_id·category_option_id 스냅샷 저장, 외부 필드는 null로 시작', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라X');
  const camp = await createCampaign(sql, base(c.id, c.name, 'x', 'visit'));
  const inf = await influencerWithPaypal(H('ext'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H('ext'), cost: { amount: 30000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/e/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [row] = await createRequests(sql, [itemOf(cand, fee.sendAs)], m, '2026-08-28');
  assert.equal(row.influencerId, inf.id);
  assert.equal(row.categoryOptionId, 'fee');
  assert.equal(row.externalStatus, null); assert.equal(row.paidAmountKrw, null); assert.equal(row.externalUpdatedAt, null);
  const badge = (await settlementByTaskIds(sql, [t.id])).get(t.id)!;
  assert.equal(badge.externalStatus, null); assert.equal(badge.cancelledAt, null);
});

// 09-14 koo: 캠페인 기간·게시일을 요청 시점 값으로 고정해 그쪽에 싣는다(단가·수단과 같은 스냅샷 규칙).
test('생성 — 캠페인 기간·게시일 스냅샷: 요청 뒤 캠페인 기간을 고쳐도 요청 값은 그대로, 제자리 수정이 새 값을 가져온다', async () => {
  const { row, member } = await requestFor('dates', 'dt');
  assert.equal(row.campaignStartsOn, '2026-08-31'); assert.equal(row.campaignEndsOn, '2026-09-06'); assert.equal(row.postedOn, '2026-08-27');
  // 그쪽 API 항목: 투고라 posted_on, confirmed_on은 null
  const ex = (await getForExport(sql, row.id))!;
  const it = toExternalItem(ex, 'https://x.example');
  assert.deepEqual(it.campaign, { id: row.campaignId, name: row.campaignName, starts_on: '2026-08-31', ends_on: '2026-09-06' });
  assert.equal(it.posted_on, '2026-08-27'); assert.equal(it.confirmed_on, null);
  // 원본 캠페인 기간을 고쳐도 요청 스냅샷은 그대로(그쪽 폴링이 다시 집어갈 신호가 없으므로 조용히 바뀌면 안 된다)
  await updateCampaign(sql, row.campaignId!, { startsOn: '2026-09-01', endsOn: '2026-09-10' });
  const [same] = await listRequests(sql, { taskId: row.taskId! });
  assert.equal(same.campaignStartsOn, '2026-08-31'); assert.equal(same.campaignEndsOn, '2026-09-06');
  // 제자리 수정([고친 값으로 다시 반영])은 현재 캠페인 기간을 새 스냅샷으로 가져온다 — updated_at도 갱신돼 그쪽이 다시 집어간다
  const revised = await revisionOn(() => reviseRequest(sql, row.id, { expectedRevision: 0, reason: '기간 정정', edits: { category: row.category, deadlineOn: row.deadlineOn, referenceUrl: row.referenceUrl }, partnerConfirmed: false }, member));
  assert.ok(typeof revised === 'object' && 'id' in revised, JSON.stringify(revised));
  assert.equal(revised.campaignStartsOn, '2026-09-01'); assert.equal(revised.campaignEndsOn, '2026-09-10'); assert.equal(revised.postedOn, '2026-08-27');
});

test('생성 — RT 요청은 그쪽 항목에서 confirmed_on으로 나가고 posted_on은 null', async () => {
  const { row } = await requestForRt('dtrt', 'dtrt');
  assert.equal(row.postedOn, '2026-08-27');
  const it = toExternalItem((await getForExport(sql, row.id))!, 'https://x.example');
  assert.equal(it.posted_on, null); assert.equal(it.confirmed_on, '2026-08-27');
});

test('취소 — 그쪽이 지급 완료한 요청은 paid-locked, 트리거가 우회 UPDATE도 막는다', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라Y');
  const camp = await createCampaign(sql, base(c.id, c.name, 'y', 'visit'));
  await influencerWithPaypal(H('pd'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H('pd'), cost: { amount: 30000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/p/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [row] = await createRequests(sql, [itemOf(cand, fee.sendAs)], m, '2026-08-28');
  await sql`update payment_request set external_status = 'paid', paid_amount_krw = 29700, paid_at = now(), external_updated_at = now() where id = ${row.id}`;
  assert.equal(await cancelRequest(sql, row.id, '실수', m), 'paid-locked');
  await assert.rejects(sql`update payment_request set status = 'cancelled' where id = ${row.id}`, /paid-locked/);
  const badge = (await settlementByTaskIds(sql, [t.id])).get(t.id)!;
  assert.equal(badge.externalStatus, 'paid');
});

// method를 주면 PayPal 기본 수단 대신 그 수단(예: PayPay + QR)을 명부 기본 수단으로 심는다.
// 기존 호출부는 인자를 안 주면 지금과 같게(influencerWithPaypal) 동작한다.
type MethodSeed = Partial<PaymentMethodInput> & { type: PaymentMethodInput['type'] };
async function requestFor(handle: string, campSuffix: string, method?: MethodSeed) {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라' + campSuffix);
  const camp = await createCampaign(sql, base(c.id, c.name, campSuffix, 'visit'));
  if (method) {
    const { row: inf } = await createInfluencer(sql, { handle: H(handle), createdBy: null });
    // 요청 생성 관문(settlementCalc — paypay-no-receiving-info)은 identifier나 qr 중 하나를 요구한다.
    // 이 픽스처는 identifier를 채워 그 관문을 통과시킨다 — qr만 있는 경우는 settlementCalc.test.ts가 따로 본다.
    const input: PaymentMethodInput = { holder: 'KEIKO', currency: method.type === 'paypay' ? 'JPY' : 'KRW', ...(method.type === 'paypay' ? { identifier: H(handle) } : {}), ...method };
    await updatePaymentMethods(sql, inf.id, { kind: 'add', input, makeDefault: true }, null);
  } else {
    await influencerWithPaypal(H(handle));
  }
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H(handle), cost: { amount: 30000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/r/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [row] = await createRequests(sql, [itemOf(cand, fee.sendAs)], m, '2026-08-28');
  return { row, task: t, member: m };
}
const at = (s: string) => new Date(s).toISOString();
// 제자리 수정 테스트는 스위치를 켜야 한다 — 비동기라 withRevisionV2를 못 쓰고 직접 env를 바꾼 뒤 finally로 복구
async function revisionOn<T>(fn: () => Promise<T>): Promise<T> { const prev = process.env.SETTLEMENT_REVISION_V2; process.env.SETTLEMENT_REVISION_V2 = 'on'; try { return await fn(); } finally { if (prev === undefined) delete process.env.SETTLEMENT_REVISION_V2; else process.env.SETTLEMENT_REVISION_V2 = prev; } }
const upd = (status: 'received' | 'scheduled' | 'paid' | 'on_hold' | 'cancelled', updatedAt: string, extra: Partial<{ note: string; paidAmountKrw: number; paidAt: string; externalId: string; operator: { id: string; name: string }; revision: number; paidAmountUsd: number; paidAmountJpy: number; paidCurrency: 'KRW' | 'JPY' | 'USD' }> = {}) => ({
  status, updatedAt: at(updatedAt), note: extra.note ?? null, paidAmountKrw: extra.paidAmountKrw ?? null, paidAt: extra.paidAt ? at(extra.paidAt) : null, externalId: extra.externalId ?? null,
  operator: extra.operator ?? null, revision: extra.revision ?? null, paidAmountUsd: extra.paidAmountUsd ?? null, paidAmountJpy: extra.paidAmountJpy ?? null, paidCurrency: extra.paidCurrency ?? null,
});

// 09-04 그쪽 요청: 사람이 실행한 전이의 담당자를 요청 행에 남겨 화면에 "누가 처리했는지"를 보인다. 자동 전이(operator 없음)가 오면 비운다.
test('applyExternalStatus — operator가 오면 처리한 사람이 저장되고, 없는 전이가 오면 비워진다', async () => {
  const { row } = await requestFor('op1', 'o1');
  const r1 = await applyExternalStatus(sql, row.id, upd('scheduled', '2026-09-04T07:30:05Z'));
  assert.equal((r1 as { row: PaymentRequestRow }).row.externalOperatorName, null);
  const r2 = await applyExternalStatus(sql, row.id, upd('on_hold', '2026-09-04T08:54:35Z', { note: '수수료를 추가해 주세요!', operator: { id: '8f2c9e10-1b2a-4c3d-9e4f-000000000001', name: '전태정' } }));
  const h = (r2 as { row: PaymentRequestRow }).row;
  assert.equal(h.externalOperatorName, '전태정');
  assert.equal(h.externalOperatorId, '8f2c9e10-1b2a-4c3d-9e4f-000000000001');
  const [listed] = await listRequests(sql, { taskId: row.taskId! });
  assert.equal(listed.externalOperatorName, '전태정');   // 화면 경로도 같은 값
  const r3 = await applyExternalStatus(sql, row.id, upd('scheduled', '2026-09-04T09:00:00Z'));   // 자동 재개 — operator 없음
  assert.equal((r3 as { row: PaymentRequestRow }).row.externalOperatorName, null);
});

test('listForExport — 같은 시각에 갱신된 3건이 limit 2로 두 페이지에 빠짐없이, 커서는 µs 단위', async () => {
  const a = await requestFor('ex1', 'e1'); const b = await requestFor('ex2', 'e2'); const c = await requestFor('ex3', 'e3');
  const ids = new Set([a.row.id, b.row.id, c.row.id]);
  // 과거 시각 — 실제 운영 행(2026년대)보다 앞에 오도록. 안전 지연(30초)에도 걸리지 않아 확실히 노출된다
  await sql`update payment_request set updated_at = '2000-01-01T00:00:00.000001Z' where id in ${sql([...ids])}`;
  const startCursor = decodeCursor(encodeCursor({ updatedAtUs: String(Date.parse('2000-01-01T00:00:00Z') * 1000), id: '00000000-0000-0000-0000-000000000000' }))!;
  const p1 = await listForExport(sql, startCursor, 2);
  assert.equal(p1.length, 2);
  assert.equal(p1.every((e) => ids.has(e.row.id)), true);
  const c1 = { updatedAtUs: p1[1].updatedAtUs, id: p1[1].row.id };
  assert.equal(c1.updatedAtUs.endsWith('000001'), true);
  const p2 = await listForExport(sql, c1, 2);
  assert.ok(p2.length >= 1);
  const remaining = [...ids].find((id) => !p1.some((e) => e.row.id === id))!;
  assert.equal(p2[0].row.id, remaining);
  const got = new Set([...p1.map((e) => e.row.id), p2[0].row.id]);
  assert.deepEqual(got, ids);
  assert.equal(p1[0].requester.email, null);   // 테스트 멤버는 이메일 없음
  const one = await getForExport(sql, a.row.id);
  assert.equal(one?.row.id, a.row.id);
  assert.equal(await getForExport(sql, 'nope'), null);

  // 안전 지연 30초 — 방금 갱신된 행은 아직 목록에 나오지 않고, 31초 지난 것으로 치면 나온다
  const fresh = await requestFor('ex4', 'e4');
  const justNow = await listForExport(sql, startCursor, 500);
  assert.equal(justNow.some((e) => e.row.id === fresh.row.id), false);
  await sql`update payment_request set updated_at = now() - interval '31 seconds' where id = ${fresh.row.id}`;
  const afterLag = await listForExport(sql, startCursor, 500);
  assert.equal(afterLag.some((e) => e.row.id === fresh.row.id), true);
});

// 증빙 2026-09-01-proof-to-partner-design.md §5(koo 결정 B) — 돈은 스냅샷, 증빙만 작업의 현재값
async function requestForRt(handle: string, campSuffix: string) {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라' + campSuffix);
  const camp = await createCampaign(sql, base(c.id, c.name, campSuffix, 'visit'));
  await influencerWithPaypal(H(handle));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'rt', targetTweetUrl: 'https://x.com/target/status/1', items: [{ handle: H(handle), cost: { amount: 30000, currency: 'KRW' } }] });
  // "증빙 없이 만들어진 RT 요청"을 재현한다 — 09-02부터 createRequests가 증빙 없는 RT를 막으므로, 증빙을 채워 만든 뒤
  // 작업·요청 양쪽의 증빙을 SQL로 비운다(증빙 규칙 이전에 만들어진 운영 요청과 같은 상태).
  await postedRtWithProof(t.id);
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [created] = await createRequests(sql, [itemOf(cand, fee.sendAs)], m, '2026-08-28');
  await sql`update campaign_task set proof = null where id = ${t.id}`;
  await sql`update payment_request set proof = null where id = ${created.id}`;
  const [row] = await listRequests(sql, { taskId: t.id });
  return { row, task: t, member: m };
}

test('getForExport — proof는 작업의 현재값을 따른다: 요청 뒤 작업에 증빙을 올리면 반영된다', async () => {
  const { row, task } = await requestForRt('exp1', 'ep1');
  const before = await getForExport(sql, row.id);
  assert.equal(before?.proof, null);   // 요청 시점엔 증빙이 없었다
  const proof = { url: `task/${task.id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png`, by: null, byName: '박구건', at: '2026-08-31T01:00:00.000Z' };
  await updateTask(sql, task.id, { proof });
  const after = await getForExport(sql, row.id);
  assert.deepEqual(after?.proof, proof);   // 요청 스냅샷(payment_request.proof)에는 없던 값이 다음 조회에 반영됨
  // listForExport도 같은 exportRows(같은 조인)를 탄다 — 여기서는 30초 안전 지연을 우회하도록 시각을 뒤로 돌려 확인한다
  await sql`update payment_request set updated_at = now() - interval '31 seconds' where id = ${row.id}`;
  const startCursor = decodeCursor(encodeCursor({ updatedAtUs: String(Date.parse('2000-01-01T00:00:00Z') * 1000), id: '00000000-0000-0000-0000-000000000000' }))!;
  const listed = (await listForExport(sql, startCursor, 500)).find((r) => r.row.id === row.id);
  assert.deepEqual(listed?.proof, proof);
});

// koo가 2026-09-02 스테이징에서 잡은 어긋남: 그쪽 API는 라이브 증빙을 내보내는데 우리 화면(listRequests)은
// 스냅샷을 읽어 '증빙 —'으로 남았다. 그러면 "올리면 정산 프로덕트에도 전달돼요" 안내가 거짓이 된다.
// 두 경로가 같은 판정(liveProofResolver)을 쓰는지 여기서 못 박는다 — 한쪽만 고치면 이 테스트가 깨진다.
test('listRequests — 우리 화면도 작업의 현재 증빙을 본다(그쪽 API와 같은 값)', async () => {
  const { row, task } = await requestForRt('scr1', 'sc1');
  const before = (await listRequests(sql, { taskId: task.id }))[0];
  assert.equal(before.proof, null);
  const proof = { url: `task/${task.id}/11111111-2222-3333-4444-555555555555.png`, by: null, byName: '박구건', at: '2026-09-02T01:00:00.000Z' };
  await updateTask(sql, task.id, { proof });
  const screen = (await listRequests(sql, { taskId: task.id }))[0];
  const partner = await getForExport(sql, row.id);
  assert.deepEqual(screen.proof, proof, '화면이 라이브 증빙을 못 보면 담당자가 올린 것이 나갔는지 알 수 없다');
  assert.deepEqual(screen.proof, partner?.proof, '화면과 그쪽 API가 같은 증빙을 보아야 한다');
});

test('getForExport — task_id가 null(작업 삭제된 오래된 요청)이면 payment_request.proof 스냅샷으로 폴백', async () => {
  const { row, task } = await requestForRt('exp2', 'ep2');
  const proof = { url: `task/${task.id}/bbbbbbbb-cccc-dddd-eeee-ffffffffffff.png`, by: null, byName: '모에카', at: '2026-08-30T00:00:00.000Z' };
  await updateTask(sql, task.id, { proof });
  const live = await getForExport(sql, row.id);
  assert.deepEqual(live?.proof, proof);   // task_id가 살아있는 동안은 라이브값
  assert.deepEqual(live?.row.proof, null);   // 요청 생성 시점엔 증빙이 없었으니 스냅샷은 null(둘이 다르다는 확인)
  await deleteTask(sql, task.id);   // FK on delete set null → payment_request.task_id가 null이 된다
  const afterDelete = await getForExport(sql, row.id);
  assert.equal(afterDelete?.row.taskId, null);
  assert.deepEqual(afterDelete?.proof, null);   // 스냅샷도 null이었으니 폴백값도 null — 라이브였던 값이 새지 않는다
});

test('getForExport — RT가 아닌 유형도 작업에 증빙이 있으면 그대로 싣는다(있는 자료를 숨기지 않는다)', async () => {
  const { row, task } = await requestFor('exp3', 'ep3');   // type: 'post' — reference_url로 이미 충분하지만, 있으면 감추지 않는다
  const before = await getForExport(sql, row.id);
  assert.equal(before?.proof, null);
  const proof = { url: `task/${task.id}/cccccccc-dddd-eeee-ffff-000000000000.png`, by: null, byName: '테스트', at: '2026-08-31T02:00:00.000Z' };
  await updateTask(sql, task.id, { proof });
  const after = await getForExport(sql, row.id);
  assert.deepEqual(after?.proof, proof);
});

test('applyExternalStatus — 규칙표: 첫 수신 sent_at, stale 무시, paid 로그, paid 정정, paid 이후 다른 상태 409', async () => {
  const { row, member } = await requestFor('ap1', 'a1');
  const r1 = await applyExternalStatus(sql, row.id, upd('received', '2026-08-29T00:00:00Z', { externalId: 'X-9' }));
  assert.equal(r1 !== 'not-found' && r1.kind, 'applied');
  const after1 = (r1 as { row: typeof row }).row;
  assert.equal(after1.externalStatus, 'received'); assert.ok(after1.sentAt); assert.equal(after1.externalId, 'X-9');
  const sentAt = after1.sentAt;
  const stale = await applyExternalStatus(sql, row.id, upd('scheduled', '2026-08-28T23:00:00Z'));
  assert.equal(stale !== 'not-found' && stale.kind, 'stale');
  assert.equal((stale as { row: typeof row }).row.externalStatus, 'received');
  const same = await applyExternalStatus(sql, row.id, upd('received', '2026-08-29T00:00:00Z'));   // 같은 본문 재전송
  assert.equal(same !== 'not-found' && same.kind, 'stale');
  const paid = await applyExternalStatus(sql, row.id, upd('paid', '2026-08-30T00:00:00Z', { paidAmountKrw: 29700, paidAt: '2026-08-30T00:00:00Z', note: '환율' }));
  assert.equal(paid !== 'not-found' && paid.kind, 'applied');
  const p = (paid as { row: typeof row }).row;
  assert.equal(p.paidAmountKrw, 29700); assert.equal(p.externalNote, '환율'); assert.equal(p.sentAt, sentAt);   // sent_at은 1회
  const logs = await sql<Array<{ event_type: string; payload: { paidAmountKrw?: number } }>>`
    select event_type, payload from influencer_log where influencer_id = ${row.influencerId!} and event_type = 'payment_paid'`;
  assert.equal(logs.length, 1); assert.equal(logs[0].payload.paidAmountKrw, 29700);
  const fix = await applyExternalStatus(sql, row.id, upd('paid', '2026-08-30T01:00:00Z', { paidAmountKrw: 29800, paidAt: '2026-08-30T00:00:00Z' }));
  assert.equal(fix !== 'not-found' && fix.kind, 'applied');
  assert.equal((fix as { row: typeof row }).row.paidAmountKrw, 29800);
  assert.equal((await sql`select count(*)::int as n from influencer_log where influencer_id = ${row.influencerId!} and event_type = 'payment_paid'`)[0].n, 1);   // 정정은 로그 안 남김
  const back = await applyExternalStatus(sql, row.id, upd('scheduled', '2026-08-30T02:00:00Z'));
  assert.equal(back !== 'not-found' && back.kind, 'conflict'); assert.equal((back as { code: string }).code, 'paid-locked');
  assert.equal(await cancelRequest(sql, row.id, '늦음', member), 'paid-locked');
  assert.equal(await applyExternalStatus(sql, '00000000-0000-0000-0000-000000000000', upd('received', '2026-08-29T00:00:00Z')), 'not-found');
  assert.equal(await applyExternalStatus(sql, 'x', upd('received', '2026-08-29T00:00:00Z')), 'not-found');
});

test('applyExternalStatus — 그쪽 취소는 우리 취소(정산 프로덕트·사유), 우리가 취소한 건에 다른 상태는 409, 취소 ack는 적용', async () => {
  const a = await requestFor('ap2', 'a2');
  const r = await applyExternalStatus(sql, a.row.id, upd('cancelled', '2026-08-29T00:00:00Z', { note: '중복 요청' }));
  assert.equal(r !== 'not-found' && r.kind, 'applied');
  const row = (r as { row: typeof a.row }).row;
  assert.equal(row.status, 'cancelled'); assert.equal(row.cancelledByName, '정산 프로덕트'); assert.equal(row.cancelReason, '중복 요청'); assert.equal(row.externalStatus, 'cancelled');
  const logs = await sql<Array<{ payload: { reason?: string } }>>`select payload from influencer_log where influencer_id = ${row.influencerId!} and event_type = 'payment_cancelled'`;
  assert.equal(logs.length, 1); assert.equal(logs[0].payload.reason, '중복 요청');
  // 취소된 작업은 다시 후보에 나온다
  const cands = await listCandidates(sql, SETTLEMENT_DEFAULTS, a.member.id, '2026-08-28');
  assert.ok(cands.some((x) => x.taskId === a.task.id));

  const b = await requestFor('ap3', 'a3');
  await cancelRequest(sql, b.row.id, '우리 취소', b.member);
  const conflict = await applyExternalStatus(sql, b.row.id, upd('scheduled', '2026-08-29T00:00:00Z'));
  assert.equal(conflict !== 'not-found' && conflict.kind, 'conflict'); assert.equal((conflict as { code: string }).code, 'request-cancelled');
  const ack = await applyExternalStatus(sql, b.row.id, upd('cancelled', '2026-08-29T00:00:00Z'));
  assert.equal(ack !== 'not-found' && ack.kind, 'applied');
  assert.equal((ack as { row: typeof b.row }).row.cancelReason, '우리 취소');   // 우리 취소 기록은 그대로
});

// 042: ID는 스냅샷 — 참조가 지워져도 요청 행의 influencer_id·client_id는 그대로 남아야 한다
test('스냅샷 ID — 인플·클라이언트를 지워도 요청의 influencerId·clientId는 그대로', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라Z');
  const camp = await createCampaign(sql, base(c.id, c.name, 'z', 'visit'));
  const inf = await influencerWithPaypal(H('snap'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H('snap'), cost: { amount: 30000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/s/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [row] = await createRequests(sql, [itemOf(cand, fee.sendAs)], m, '2026-08-28');
  assert.equal(row.influencerId, inf.id); assert.equal(row.clientId, c.id);
  // 참조 삭제 — payment_request의 FK가 없으니(042) 그대로 지워진다(influencer_log는 cascade로 같이 지워진다)
  await deleteInfluencer(sql, inf.id);
  await deleteClient(sql, c.id);
  const [again] = await listRequests(sql, { taskId: t.id });
  assert.equal(again.influencerId, inf.id); assert.equal(again.clientId, c.id);
  const exported = await getForExport(sql, row.id);
  assert.equal(exported?.row.influencerId, inf.id); assert.equal(exported?.row.clientId, c.id);
});

// 042: 클라이언트 없는 캠페인은 화면 신호등에서 no-client로 미리 막히고, 저장 단계에서도 재차 막힌다
test('생성 — 클라이언트 없는 캠페인은 no-client로 막히고 저장도 거절', async () => {
  const m = await ensureMember();
  const camp = await createCampaign(sql, { clientId: null, clientName: null, name: P + 'noclient', nameEn: `${P.toLowerCase()}-noclient`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: 'content', note: '', createdBy: null });
  await influencerWithPaypal(H('ncl'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H('ncl'), cost: { amount: 30000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/n/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  assert.equal(cand.clientId, null);
  assert.equal(cand.readiness, 'blocked');
  assert.ok(cand.issues.some((i) => i.code === 'no-client'));
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  await assert.rejects(createRequests(sql, [itemOf(cand, fee.sendAs)], m, '2026-08-28'), (e: unknown) => {
    assert.ok(e instanceof SettlementCreateError);
    assert.match(e.failures[0].reason, /이 캠페인의 클라이언트가 삭제돼 비어 있어요/);
    return true;
  });
  assert.equal((await listRequests(sql, { taskId: t.id })).length, 0);
});

// 09-02 koo: 정산 쪽이 지급 전 확인 자료 없는 요청은 받지 않는다 → 화면 🔴와 같은 판정으로 서버도 거절(판정은 effectiveIssues 한 곳)
test('생성 — 증빙 없는 RT는 화면 🔴, 서버도 같은 문구로 거절', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라NP');
  const camp = await createCampaign(sql, base(c.id, c.name, 'np'));
  await influencerWithPaypal(H('noproof'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'rt', targetTweetUrl: 'https://x.com/target/status/1', items: [{ handle: H('noproof'), cost: { amount: 10000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  assert.equal(cand.readiness, 'blocked');
  await assert.rejects(createRequests(sql, [itemOf(cand, cand.categoryDefault!)], m, '2026-08-28'), (e: unknown) => {
    assert.ok(e instanceof SettlementCreateError);
    assert.match(e.failures[0].reason, /증빙 스크린샷을 넣어야 요청할 수 있어요/);
    return true;
  });
  assert.equal((await listRequests(sql, { taskId: t.id })).length, 0);
  // 증빙을 채우면 같은 아이템으로 통과
  await updateTask(sql, t.id, { proof: fakeProof(t.id) });
  const [row] = await createRequests(sql, [itemOf(cand, cand.categoryDefault!)], m, '2026-08-28');
  assert.equal(row.status, 'requested');
});

test('생성 — 투고에 참고 링크가 없으면 거절, 아이템에 링크를 넣어 보내면 통과(화면 입력칸과 같은 경로)', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라NR');
  const camp = await createCampaign(sql, base(c.id, c.name, 'nr'));
  await influencerWithPaypal(H('nolink'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H('nolink'), cost: { amount: 10000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual' });   // postUrl 없음
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  assert.equal(cand.referenceDefault, null);
  assert.equal(cand.readiness, 'blocked');
  await assert.rejects(createRequests(sql, [itemOf(cand, cand.categoryDefault!)], m, '2026-08-28'), (e: unknown) => {
    assert.ok(e instanceof SettlementCreateError);
    assert.match(e.failures[0].reason, /참고 링크를 넣어 주세요/);
    return true;
  });
  await assert.rejects(createRequests(sql, [{ ...itemOf(cand, cand.categoryDefault!), referenceUrl: '' }], m, '2026-08-28'), (e: SettlementCreateError) => /참고 링크를 넣어 주세요/.test(e.failures[0].reason));
  const [row] = await createRequests(sql, [{ ...itemOf(cand, cand.categoryDefault!), referenceUrl: 'https://x.com/nolink/status/1' }], m, '2026-08-28');
  assert.equal(row.referenceUrl, 'https://x.com/nolink/status/1');
});

// ── 제자리 수정(스펙 2026-09-07 §4·§5·§7) ──
test('reviseRequest — 스위치 꺼짐이면 not-enabled(외부에는 옛 의미 그대로)', async () => {
  const { row, member } = await requestFor('rv0', 'rv0');
  delete process.env.SETTLEMENT_REVISION_V2;
  assert.equal(await reviseRequest(sql, row.id, { expectedRevision: 0, reason: '테스트', edits: { category: row.category, deadlineOn: row.deadlineOn, referenceUrl: row.referenceUrl }, partnerConfirmed: false }, member), 'not-enabled');
  const p = await previewRevision(sql, row.id);
  assert.ok(!p.ok && p.reason === 'not-enabled');
});

test('reviseRequest — 수수료를 바꾼 뒤 다시 반영: 같은 id·external_id 유지, revision+1, 그쪽 결과 리셋, 이력에 1판 보관', () => revisionOn(async () => {
  const { row, member } = await requestFor('rv1', 'rv1');
  // 그쪽이 접수·보류(담당자 포함)까지 보낸 상태
  await applyExternalStatus(sql, row.id, upd('received', '2026-09-07T03:40:05Z', { externalId: 'CBX-260907-004', revision: 0 }));
  await applyExternalStatus(sql, row.id, upd('on_hold', '2026-09-07T03:44:56Z', { note: '수수료 추가해서 요청해주세요', operator: { id: 'op', name: '전태정' }, revision: 0 }));
  // 프로필에서 수수료를 CB 5% 부담(픽스처 기본) → 인플 부담(수수료 없음)으로
  const inf = (await sql<Array<{ id: string; payment_methods: Array<{ id: string }> }>>`select id, payment_methods from influencer where handle = ${H('rv1')}`)[0];
  await updatePaymentMethods(sql, inf.id, { kind: 'update', id: inf.payment_methods[0].id, input: { type: 'paypal', holder: 'KEIKO', currency: 'JPY', email: `${H('rv1')}@x.com` } }, null);
  const before = (await listRequests(sql, { taskId: row.taskId! }))[0];
  const pv = await previewRevision(sql, row.id);
  assert.ok(pv.ok); assert.equal(pv.after.candidate.money!.amountGross, 3000); assert.equal(pv.after.issues.filter((i) => i.level === 'blocked').length, 0);
  // 그쪽이 처리한 건(보류) — 담당자 확인 체크 없이는 confirm-required(09-07 합의), 체크하면 통과
  assert.equal(await reviseRequest(sql, row.id, { expectedRevision: 0, reason: '수수료 재설정', edits: { category: row.category, deadlineOn: '2026-09-11', referenceUrl: row.referenceUrl }, partnerConfirmed: false }, member), 'confirm-required');
  const r = await reviseRequest(sql, row.id, { expectedRevision: 0, reason: '수수료 재설정', edits: { category: row.category, deadlineOn: '2026-09-11', referenceUrl: row.referenceUrl }, partnerConfirmed: true }, member);
  assert.ok(typeof r === 'object' && !('kind' in r));
  const after = r as PaymentRequestRow;
  assert.equal(after.id, row.id); assert.equal(after.externalId, 'CBX-260907-004'); assert.ok(after.sentAt);          // 유지
  assert.equal(after.revision, 1); assert.ok(after.revisedAt); assert.equal(after.status, 'requested');
  assert.equal(after.amountGross, 3000); assert.equal(after.feeAmount, 0); assert.equal(after.fee, null); assert.equal(after.grossKrw, 30000);
  assert.equal(after.deadlineOn, '2026-09-11');
  assert.equal(after.externalStatus, null); assert.equal(after.externalNote, null); assert.equal(after.externalUpdatedAt, null); assert.equal(after.externalOperatorName, null);   // 리셋
  assert.equal(after.createdAt, before.createdAt); assert.ok(new Date(after.updatedAt) > new Date(before.updatedAt));
  // 이력: 1판(고치기 전) 그대로 — 그쪽 메모·담당자도 함께 남는다
  const hist = await listRevisions(sql, row.id);
  assert.equal(hist.length, 1); assert.equal(hist[0].revision, 0); assert.equal(hist[0].reason, '수수료 재설정'); assert.equal(hist[0].revisedByName, member.name); assert.equal(hist[0].partnerConfirmed, true);
  assert.equal(hist[0].snapshot.amountGross, 3158); assert.equal(hist[0].snapshot.feeAmount, 158);   // 1판 = 수수료 포함이던 값
  assert.equal(hist[0].snapshot.externalNote, '수수료 추가해서 요청해주세요'); assert.equal(hist[0].snapshot.externalOperatorName, '전태정');
  // 활동 기록
  const logs = await sql<Array<{ payload: { revision: number; before: { amountGross: number } } }>>`select payload from influencer_log where influencer_id = ${inf.id} and event_type = 'payment_revised'`;
  assert.equal(logs.length, 1); assert.equal(logs[0].payload.revision, 1); assert.equal(logs[0].payload.before.amountGross, 3158);
  // 외부 아이템: revision 1, revised_at, settlement 전부 null인데 external_id는 남는다
  const exp = await getForExport(sql, row.id);
  assert.equal(exp!.row.revision, 1); assert.equal(exp!.row.externalStatus, null); assert.equal(exp!.row.externalId, 'CBX-260907-004');
  // 그쪽이 옛 판(0)으로 보낸 늦은 상태는 409 revision-mismatch, 새 판(1)으로 보낸 received는 적용
  const late = await applyExternalStatus(sql, row.id, upd('scheduled', '2026-09-07T03:45:00Z', { revision: 0 }));
  assert.ok(late !== 'not-found' && late.kind === 'conflict' && late.code === 'revision-mismatch');
  const fresh = await applyExternalStatus(sql, row.id, upd('received', '2026-09-07T03:55:00Z', { revision: 1 }));
  assert.ok(fresh !== 'not-found' && fresh.kind === 'applied');
  // 같은 값으로 다시 반영도 허용 — 2판, 이력 2건
  const again = await reviseRequest(sql, row.id, { expectedRevision: 1, reason: '재검토 요청', edits: { category: row.category, deadlineOn: '2026-09-11', referenceUrl: row.referenceUrl }, partnerConfirmed: true }, member);
  assert.equal((again as PaymentRequestRow).revision, 2);
  assert.equal((await listRevisions(sql, row.id)).length, 2);
}));

test('reviseRequest — 거절 판정: 취소됨·지급 완료·판 불일치·🔴 관문·작업 삭제', () => revisionOn(async () => {
  const edits = (row: PaymentRequestRow) => ({ category: row.category, deadlineOn: row.deadlineOn, referenceUrl: row.referenceUrl });
  const inp = (row: PaymentRequestRow, over: Partial<{ expectedRevision: number; edits: ReturnType<typeof edits> }> = {}) => ({ expectedRevision: 0, reason: 'x', edits: edits(row), partnerConfirmed: false, ...over });
  // 취소된 요청
  const a = await requestFor('rvA', 'rvA');
  await cancelRequest(sql, a.row.id, '폐기', a.member);
  assert.equal(await reviseRequest(sql, a.row.id, inp(a.row), a.member), 'cancelled');
  // 지급 완료
  const b = await requestFor('rvB', 'rvB');
  await applyExternalStatus(sql, b.row.id, upd('paid', '2026-09-07T05:00:00Z', { paidAmountKrw: 31580, paidAt: '2026-09-07T04:58:00Z', revision: 0 }));
  assert.equal(await reviseRequest(sql, b.row.id, inp(b.row), b.member), 'paid-locked');
  // 판 불일치(화면이 옛 판을 들고 있음)
  const c = await requestFor('rvC', 'rvC');
  assert.equal(await reviseRequest(sql, c.row.id, inp(c.row, { expectedRevision: 3 }), c.member), 'revision-mismatch');
  // 🔴 관문: 투고인데 참고 링크를 비우면 막힘 — 문구는 검토 대기와 같다
  // 그쪽이 아직 손대지 않은 요청(externalStatus null)은 담당자 확인 없이 고칠 수 있다 — 여기선 🔴 관문에 걸린다
  const blocked = await reviseRequest(sql, c.row.id, inp(c.row, { edits: { ...edits(c.row), referenceUrl: null } }), c.member);
  assert.ok(typeof blocked === 'object' && 'kind' in blocked && blocked.kind === 'blocked');
  assert.match((blocked as { issues: Array<{ text: string }> }).issues[0].text, /참고 링크를 넣어 주세요/);
  // 작업 삭제 → task-gone
  const d = await requestFor('rvD', 'rvD');
  await deleteTask(sql, d.task.id);
  assert.equal(await reviseRequest(sql, d.row.id, inp(d.row), d.member), 'task-gone');
  // 스위치 꺼짐이면 revision 불일치도 무시하고 적용한다(그쪽 옛 클라이언트 호환)
  delete process.env.SETTLEMENT_REVISION_V2;
  const ignored = await applyExternalStatus(sql, c.row.id, upd('received', '2026-09-07T06:00:00Z', { revision: 7 }));
  assert.ok(ignored !== 'not-found' && ignored.kind === 'applied');
  process.env.SETTLEMENT_REVISION_V2 = 'on';
}));

// 09-09 그쫉: PayPal 지급 완료에 paid_amount_usd 동봉 → 저장·되비침, 차액 판정은 원화 그대로
test('applyExternalStatus — paid_amount_usd를 저장하고, 다음 전이에서 원화와 함께 유지·정정된다', async () => {
  const { row } = await requestFor('usd1', 'usd1');
  const paid = await applyExternalStatus(sql, row.id, upd('paid', '2026-09-08T11:13:50Z', { paidAmountKrw: 25934, paidAmountUsd: 18.62, paidAt: '2026-09-08T11:12:00Z' }));
  assert.ok(paid !== 'not-found' && paid.kind === 'applied');
  const p = (paid as { row: PaymentRequestRow }).row;
  assert.equal(p.paidAmountKrw, 25934); assert.equal(p.paidAmountUsd, 18.62);
  assert.equal(hasPaidDiff(p), true);   // 차액 판정은 원화(gross_krw 31580 vs 25934)
  // paid → paid 정정: 달러도 함께 바뀐다
  const fix = await applyExternalStatus(sql, row.id, upd('paid', '2026-09-08T12:00:00Z', { paidAmountKrw: 31580, paidAmountUsd: 22.7, paidAt: '2026-09-08T11:12:00Z' }));
  const f = (fix as { row: PaymentRequestRow }).row;
  assert.equal(f.paidAmountUsd, 22.7); assert.equal(hasPaidDiff(f), false);
  const exp = await getForExport(sql, row.id); assert.equal(exp!.row.paidAmountUsd, 22.7);
  const [listed] = await listRequests(sql, { taskId: row.taskId! }); assert.equal(listed.paidAmountUsd, 22.7);
});

// 09-09 사고 재발 방지: 서버(NODE_TEST_CONTEXT 없음)에서는 픽스처 핸들 요청이 그쪽 목록·단건에 나오지 않는다
test('외부 내보내기 — 테스트 픽스처는 서버 모드에서 목록·단건 모두 감춰진다', async () => {
  const { row } = await requestFor('hide1', 'hd1');
  assert.ok(await getForExport(sql, row.id), '테스트 모드에서는 보인다');
  const prev = process.env.NODE_TEST_CONTEXT; delete process.env.NODE_TEST_CONTEXT;
  try {
    assert.equal(await getForExport(sql, row.id), null);
    await sql`update payment_request set updated_at = now() - interval '31 seconds' where id = ${row.id}`;
    const start = decodeCursor(encodeCursor({ updatedAtUs: String(Date.parse('2000-01-01T00:00:00Z') * 1000), id: '00000000-0000-0000-0000-000000000000' }))!;
    const listed = await listForExport(sql, start, 500);
    assert.equal(listed.some((r) => r.row.id === row.id), false);
    assert.equal(listed.some((r) => /^(tstl|tstpf|tcmp)\d+_/.test(r.row.influencerHandle)), false, '어떤 픽스처도 새지 않는다');
  } finally { process.env.NODE_TEST_CONTEXT = prev; }
});

// 09-09 그쪽 요청(22) + 우리 제안: 외화 필드는 "보낸 것만 갱신", 다른 외화는 지움. paid_currency가 오면 그 통화로 확정(KRW면 외화 둘 다 지움). 아무 외화도 안 오면 기존 값 유지.
test('applyExternalStatus — paid_amount_jpy 저장, 외화 교체·유지·KRW 정정 의미', async () => {
  const { row } = await requestFor('jpy1', 'jp1');
  const at = (h: string) => `2026-09-09T${h}:00Z`;
  // 엔화 지급 완료
  let r = await applyExternalStatus(sql, row.id, upd('paid', at('06:00'), { paidAmountKrw: 13685, paidAmountJpy: 1500, paidAt: at('05:59') }));
  let p = (r as { row: PaymentRequestRow }).row; assert.equal(p.paidAmountJpy, 1500); assert.equal(p.paidAmountUsd, null);
  // 엔화 정정 — 새 값으로
  r = await applyExternalStatus(sql, row.id, upd('paid', at('06:10'), { paidAmountKrw: 14597, paidAmountJpy: 1600, paidAt: at('05:59'), note: '실지급 엔화 금액 정정' }));
  p = (r as { row: PaymentRequestRow }).row; assert.equal(p.paidAmountJpy, 1600); assert.equal(p.paidAmountKrw, 14597);
  // 외화 없이 원화만 정정(구버전 전송 모양) → 기존 엔화 유지(부재는 의미 없음)
  r = await applyExternalStatus(sql, row.id, upd('paid', at('06:15'), { paidAmountKrw: 14600, paidAt: at('05:59') }));
  p = (r as { row: PaymentRequestRow }).row; assert.equal(p.paidAmountJpy, 1600); assert.equal(p.paidAmountKrw, 14600);
  // paid_currency KRW 명시 → 외화 둘 다 지움
  r = await applyExternalStatus(sql, row.id, upd('paid', at('06:20'), { paidAmountKrw: 14000, paidAt: at('05:59'), paidCurrency: 'KRW' }));
  p = (r as { row: PaymentRequestRow }).row; assert.equal(p.paidAmountJpy, null); assert.equal(p.paidAmountUsd, null); assert.equal(p.paidAmountKrw, 14000);
  // 달러가 오면 엔화는 지움(상호 배타), 그 반대도
  r = await applyExternalStatus(sql, row.id, upd('paid', at('06:30'), { paidAmountKrw: 14000, paidAmountUsd: 10.5, paidAt: at('05:59') }));
  p = (r as { row: PaymentRequestRow }).row; assert.equal(p.paidAmountUsd, 10.5); assert.equal(p.paidAmountJpy, null);
  r = await applyExternalStatus(sql, row.id, upd('paid', at('06:40'), { paidAmountKrw: 14000, paidAmountJpy: 1550, paidAt: at('05:59') }));
  p = (r as { row: PaymentRequestRow }).row; assert.equal(p.paidAmountJpy, 1550); assert.equal(p.paidAmountUsd, null);
  // stale은 아무것도 안 바꿈
  const stale = await applyExternalStatus(sql, row.id, upd('paid', at('06:35'), { paidAmountKrw: 1, paidAmountUsd: 1, paidAt: at('05:59') }));
  assert.ok(stale !== 'not-found' && stale.kind === 'stale'); assert.equal((stale as { row: PaymentRequestRow }).row.paidAmountJpy, 1550);
  const exp = await getForExport(sql, row.id); assert.equal(exp!.row.paidAmountJpy, 1550);
});

// 042: 마이그레이션의 guarded ALTER가 실제로 이 DB에 적용됐는지 — 재실행돼도 이 단언은 항상 성립해야 한다
test('스키마 — influencer_id·client_id·category_option_id는 NOT NULL(042)', async () => {
  const cols = await sql<Array<{ column_name: string; is_nullable: string }>>`
    select column_name, is_nullable from information_schema.columns
     where table_name = 'payment_request' and column_name in ('influencer_id', 'client_id', 'category_option_id')`;
  const byName = new Map(cols.map((c) => [c.column_name, c.is_nullable]));
  assert.equal(byName.get('influencer_id'), 'NO');
  assert.equal(byName.get('client_id'), 'NO');
  assert.equal(byName.get('category_option_id'), 'NO');
});

// 045 생성 컬럼 — DB가 계산하는 값이라 "코드가 맞다"로는 검증되지 않는다. 실제 행으로 세 성질을 본다:
// ① 엔화 지급이면 송금액×환율 ② 원화 지급이면 환산 없이 그대로 ③ 원본(환율)을 바꾸면 자동 재계산
// ④ 손으로 쓰려 하면 DB가 거부. 이 중 하나라도 깨지면 그쪽에 잘못된 원화 금액이 나간다.
test('045 gross_krw — 엔화는 ×환율, 원본 바꾸면 재계산, 직접 쓰기는 거부', async () => {
  const { row } = await requestFor('gk1', 'gk1');
  assert.equal(row.payoutCurrency, 'JPY');
  assert.equal(row.grossKrw, row.amountGross * row.rateKrwPerJpy);   // 3158 × 10

  // ③ 원본(환율)만 바꾸면 생성 컬럼이 따라온다 — 손으로 gross_krw를 고치지 않았는데도
  await sql`update payment_request set rate_krw_per_jpy = 11 where id = ${row.id}`;
  const [after] = await listRequests(sql, { taskId: row.taskId! });
  assert.equal(after.rateKrwPerJpy, 11);
  assert.equal(after.grossKrw, row.amountGross * 11);
  await sql`update payment_request set rate_krw_per_jpy = 10 where id = ${row.id}`;

  // ④ 직접 쓰기는 Postgres가 막는다(사본이 원본과 갈릴 수 없는 이유)
  await assert.rejects(
    sql`update payment_request set gross_krw = 1 where id = ${row.id}`,
    /can only be updated to DEFAULT|generated column/i,
  );
});

test('045 gross_krw — 원화 지급은 환산 없이 송금액 그대로', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라gk2');
  const camp = await createCampaign(sql, base(c.id, c.name, 'gk2', 'visit'));
  const { row: inf } = await createInfluencer(sql, { handle: H('gk2'), createdBy: null });
  await updatePaymentMethods(sql, inf.id, {
    kind: 'add', input: { type: 'bank', holder: '원화수취인', currency: 'KRW', bank: '테스트은행', account: '000-0000' }, makeDefault: true,
  }, null);
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H('gk2'), cost: { amount: 40000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/k/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [row] = await createRequests(sql, [itemOf(cand, fee.sendAs)], m, '2026-08-28');
  assert.equal(row.payoutCurrency, 'KRW');
  assert.equal(row.amountGross, 40000);
  assert.equal(row.grossKrw, 40000);   // 환율을 곱하지 않는다
});

test('046 — 차액 확인 칸이 요청 행에 실려 나온다(기본값 없음)', async () => {
  const { row } = await requestFor('diffack1', 'diffack1');
  assert.equal(row.diffAckAt, null);
  assert.equal(row.diffAckByName, null);
});

test('차액 확인 — 확인·취소가 되고 updated_at을 건드리지 않는다', async () => {
  const { row } = await requestFor('diffack2', 'diffack2');
  // 그쪽이 송금액보다 적게 지급한 상황을 만든다
  await applyExternalStatus(sql, row.id, { status: 'paid', updatedAt: '2026-09-01T01:00:00Z', note: null,
    paidAmountKrw: row.grossKrw - 1650, paidAt: '2026-09-01T00:59:00Z', externalId: null, operator: null, revision: null, paidAmountUsd: null, paidAmountJpy: null, paidCurrency: null });
  const [before] = await listRequests(sql, { taskId: row.taskId! });

  const acked = await ackDiff(sql, row.id, { name: '박구건' });
  assert.notEqual(acked, 'not-found'); assert.notEqual(acked, 'no-diff');
  const a = acked as PaymentRequestRow;
  assert.ok(a.diffAckAt); assert.equal(a.diffAckByName, '박구건');
  assert.equal(a.updatedAt, before.updatedAt, '확인은 그쪽 폴링에 흘러가면 안 된다');

  const un = await unackDiff(sql, row.id) as PaymentRequestRow;
  assert.equal(un.diffAckAt, null); assert.equal(un.diffAckByName, null);
  assert.equal(un.updatedAt, before.updatedAt);
});

test('차액 확인 — 차액이 없으면 확인할 것이 없다', async () => {
  const { row } = await requestFor('diffack3', 'diffack3');
  await applyExternalStatus(sql, row.id, { status: 'paid', updatedAt: '2026-09-01T01:00:00Z', note: null,
    paidAmountKrw: row.grossKrw, paidAt: '2026-09-01T00:59:00Z', externalId: null, operator: null, revision: null, paidAmountUsd: null, paidAmountJpy: null, paidCurrency: null });
  assert.equal(await ackDiff(sql, row.id, { name: '박구건' }), 'no-diff');
});

test('차액 확인 — 그쪽이 금액을 정정하면 확인이 풀린다', async () => {
  const { row } = await requestFor('diffack4', 'diffack4');
  const paid = (krw: number, at: string) => applyExternalStatus(sql, row.id, { status: 'paid', updatedAt: at, note: null, paidAmountKrw: krw, paidAt: at, externalId: null, operator: null, revision: null, paidAmountUsd: null, paidAmountJpy: null, paidCurrency: null });

  await paid(row.grossKrw - 1650, '2026-09-01T01:00:00Z');
  await ackDiff(sql, row.id, { name: '박구건' });

  // 같은 금액 재전송(더 늦은 시각) → 확인 유지
  await paid(row.grossKrw - 1650, '2026-09-01T02:00:00Z');
  assert.ok(((await listRequests(sql, { taskId: row.taskId! }))[0]).diffAckAt, '같은 금액이면 확인이 유지된다');

  // 다른 금액으로 정정 → 확인 해제
  await paid(row.grossKrw - 3000, '2026-09-01T03:00:00Z');
  const after2 = (await listRequests(sql, { taskId: row.taskId! }))[0];
  assert.equal(after2.diffAckAt, null, '금액이 바뀌면 이전 확인은 다른 금액에 대한 확인이다');
  assert.equal(after2.diffAckByName, null);
});

test('ackDiff — 취소된 요청은 no-diff', async () => {
  const { row, member } = await requestFor('diffack5', 'diffack5');
  const cancelled = await cancelRequest(sql, row.id, '테스트', member);
  assert.notEqual(cancelled, 'not-found'); assert.notEqual(cancelled, 'already-cancelled'); assert.notEqual(cancelled, 'paid-locked');
  assert.equal(await ackDiff(sql, row.id, { name: '박구건' }), 'no-diff');
});

test('ackDiff — 아직 지급 완료가 아니면 no-diff', async () => {
  const { row } = await requestFor('diffack6', 'diffack6');
  assert.equal(row.externalStatus, null);
  assert.equal(await ackDiff(sql, row.id, { name: '박구건' }), 'no-diff');
});

test('unackDiff — 없는 id는 not-found', async () => {
  assert.equal(await unackDiff(sql, '00000000-0000-0000-0000-000000000000'), 'not-found');
});

// ── 정산 쪽 수취 정보 정정 회신(스펙 2026-09-21 §4, 그쪽 09-21 요청) ──
const CID = (n: number) => `22222222-3333-4444-8555-${String(n).padStart(12, '0')}`;
// correction_id는 정정 이력 표의 기본키 = DB 전체에서 한 번만 쓴다. before()의 정리는 실행당 1회뿐이라,
// 저장에 성공하는 테스트끼리 같은 번호를 쓰면 뒤 테스트가 invalid(correction_id)로 막힌다(따로 돌리면 통과, 같이 돌리면 실패).
// 그래서 성공하는 테스트마다 자기 번호를 준다 — 1·2는 아래 첫 테스트, 3은 판정 테스트(전부 거절이라 돌려씀), 4는 reviseRequest 테스트.
const corr = (patch: Record<string, string | null>, extra: Partial<{ correctionId: string; baseRevision: number; idempotencyKey: string | null; reason: string }> = {}) => ({
  correctionId: extra.correctionId ?? CID(1), baseRevision: extra.baseRevision ?? 0, baseUpdatedAt: at('2026-09-21T05:00:00Z'), patch,
  operator: { id: '8f2c9e10-1b2a-4c3d-9e4f-000000000001', name: '정산 담당' }, reason: extra.reason ?? '이메일 오타', idempotencyKey: extra.idempotencyKey ?? null,
});

test('applyPaymentMethodCorrection — 수취 정보만 바뀌고 revision·금액·그쪽 결과는 그대로, 표식·이력·활동 기록, 멱등 재전송은 쓰기 없음', () => revisionOn(async () => {
  const { row } = await requestFor('pc1', 'pc1');
  await applyExternalStatus(sql, row.id, upd('scheduled', '2026-09-21T04:00:00Z', { externalId: 'CBX-260921-001', revision: 0, operator: { id: 'op', name: '전태정' } }));
  const before = (await listRequests(sql, { taskId: row.taskId! }))[0];
  const r = await applyPaymentMethodCorrection(sql, row.id, corr({ email: `${H('pc1')}.fixed@x.com` }, { idempotencyKey: 'idem-1' }));
  assert.ok(r !== 'not-found' && r.kind === 'applied' && r.correctionId === CID(1));
  const after = r.row;
  assert.equal(after.paymentMethod.email, `${H('pc1')}.fixed@x.com`); assert.equal(after.paymentMethod.holder, before.paymentMethod.holder);   // 바뀐 키만
  assert.equal(after.revision, 0); assert.equal(after.revisedAt, null);                                                                  // 판은 그대로
  assert.equal(after.amountGross, before.amountGross); assert.equal(after.externalStatus, 'scheduled'); assert.equal(after.externalId, 'CBX-260921-001');
  assert.equal(after.externalOperatorName, '전태정'); assert.equal(after.status, 'requested');                                          // 그쪽 결과·담당자 유지
  assert.ok(new Date(after.updatedAt) > new Date(before.updatedAt));                                                                     // 폴링에 다시 내려간다
  assert.ok(after.paymentMethodCorrection); assert.equal(after.paymentMethodCorrection!.correctionId, CID(1)); assert.equal(after.paymentMethodCorrection!.byName, '정산 담당'); assert.equal(after.paymentMethodCorrection!.reason, '이메일 오타');
  // 그쪽 아이템에는 표식이, 명부 타임라인에는 바뀐 항목이 남는다
  const exp = await getForExport(sql, row.id);
  const item = toExternalItem(exp!, 'https://x');
  assert.deepEqual(item.payment_method_correction, { correction_id: CID(1), at: after.paymentMethodCorrection!.at, by_name: '정산 담당' });
  assert.equal(item.payment_method.email, `${H('pc1')}.fixed@x.com`);
  const logs = await sql<Array<{ payload: { byName: string; fields: Array<{ field: string; to: string }>; rosterApplied: boolean } }>>`select payload from influencer_log where influencer_id = ${row.influencerId} and event_type = 'payment_corrected'`;
  assert.equal(logs.length, 1); assert.equal(logs[0].payload.byName, '정산 담당'); assert.equal(logs[0].payload.fields[0].field, 'email');
  const hist = await sql<Array<{ base_revision: number; before: { email: string }; after: { email: string }; idempotency_key: string; roster_applied: boolean; roster_skip_reason: string | null }>>`select base_revision, before, after, idempotency_key, roster_applied, roster_skip_reason from payment_request_payment_correction where request_id = ${row.id}`;
  assert.equal(hist.length, 1); assert.equal(hist[0].base_revision, 0); assert.equal(hist[0].before.email, `${H('pc1')}@x.com`); assert.equal(hist[0].idempotency_key, 'idem-1');
  // 057: 명부(원본)에도 고친 항목(email)이 반영됐다. 결과가 이력·반환값·명부에 함께 남는다.
  assert.equal(r.rosterApplied, true); assert.equal(r.rosterSkipReason, null);
  assert.equal(hist[0].roster_applied, true); assert.equal(hist[0].roster_skip_reason, null);
  const rosterMethods = (await sql<Array<{ payment_methods: Array<{ isDefault: boolean; email?: string }> }>>`select payment_methods from influencer where id = ${row.influencerId}`)[0].payment_methods;
  assert.equal(rosterMethods.find((m) => m.isDefault)!.email, `${H('pc1')}.fixed@x.com`, '명부 기본 수단이 정정 값으로 덮였다');
  // 명부 반영은 payment_corrected 한 줄(rosterApplied=true)로만 남긴다 — 별도 payment_method_changed 줄을 만들지 않는다(정정 1건이 두 줄로 보이지 않게).
  const autoLogs = await sql`select 1 from influencer_log where influencer_id = ${row.influencerId} and event_type = 'payment_method_changed'`;
  assert.equal(autoLogs.length, 0, '명부 반영은 정정 줄로 합치고 별도 결제수단 변경 줄을 남기지 않는다');
  assert.equal(logs[0].payload.rosterApplied, true);
  // 같은 correction_id 재전송 → replayed, 쓰기 없음(updated_at 그대로·이력 1건). 같은 idempotency_key에 다른 correction_id도 replayed(최초 id 반환)
  const again = await applyPaymentMethodCorrection(sql, row.id, corr({ email: 'other@x.com' }));
  assert.ok(again !== 'not-found' && again.kind === 'replayed' && again.correctionId === CID(1)); assert.equal(again.row.updatedAt, after.updatedAt);
  const byKey = await applyPaymentMethodCorrection(sql, row.id, corr({ email: 'other@x.com' }, { correctionId: CID(2), idempotencyKey: 'idem-1' }));
  assert.ok(byKey !== 'not-found' && byKey.kind === 'replayed' && byKey.correctionId === CID(1));
  assert.equal((await sql`select 1 from payment_request_payment_correction where request_id = ${row.id}`).length, 1);
  assert.equal((await listRequests(sql, { taskId: row.taskId! }))[0].paymentMethod.email, `${H('pc1')}.fixed@x.com`);
  // 다른 요청에 이미 쓴 correction_id → invalid(correction_id), PK 충돌 500이 아니다
  const { row: other } = await requestFor('pc1b', 'pc1b');
  const reused = await applyPaymentMethodCorrection(sql, other.id, corr({ email: 'z@x.com' }));
  assert.ok(reused !== 'not-found' && reused.kind === 'invalid' && reused.field === 'correction_id');
  // 정정 뒤에도 그쪽 상태 POST는 같은 revision(0)으로 계속 통한다 — 판을 올리지 않은 이유
  const st = await applyExternalStatus(sql, row.id, upd('paid', '2026-09-21T06:00:00Z', { paidAmountKrw: 31580, paidAt: '2026-09-21T05:59:00Z', revision: 0 }));
  assert.ok(st !== 'not-found' && st.kind === 'applied');
}));

test('applyPaymentMethodCorrection — 판정: 취소 → 지급 완료 → 판 불일치 → 수단에 없는 키(400) → 없는 요청', () => revisionOn(async () => {
  const a = await requestFor('pc2a', 'pc2a');
  await cancelRequest(sql, a.row.id, '중복', a.member);
  const c1 = await applyPaymentMethodCorrection(sql, a.row.id, corr({ email: 'a@x.com' }, { baseRevision: 9, correctionId: CID(3) }));
  assert.ok(c1 !== 'not-found' && c1.kind === 'conflict' && c1.code === 'request-cancelled');   // 판이 틀려도 취소가 먼저
  const b = await requestFor('pc2b', 'pc2b');
  await applyExternalStatus(sql, b.row.id, upd('paid', '2026-09-21T05:00:00Z', { paidAmountKrw: 31580, paidAt: '2026-09-21T04:59:00Z', revision: 0 }));
  const c2 = await applyPaymentMethodCorrection(sql, b.row.id, corr({ email: 'b@x.com' }, { correctionId: CID(3) }));
  assert.ok(c2 !== 'not-found' && c2.kind === 'conflict' && c2.code === 'paid-locked');
  const c = await requestFor('pc2c', 'pc2c');
  const c3 = await applyPaymentMethodCorrection(sql, c.row.id, corr({ email: 'c@x.com' }, { baseRevision: 1, correctionId: CID(3) }));
  assert.ok(c3 !== 'not-found' && c3.kind === 'conflict' && c3.code === 'revision-mismatch');
  const c4 = await applyPaymentMethodCorrection(sql, c.row.id, corr({ bank: 'みずほ' }, { correctionId: CID(3) }));   // PayPal 수단에 은행
  assert.ok(c4 !== 'not-found' && c4.kind === 'invalid' && c4.field === 'payment_method.bank');
  assert.equal((await listRequests(sql, { taskId: c.row.taskId! }))[0].paymentMethodCorrection, null);   // 거절은 아무것도 남기지 않는다
  assert.equal(await applyPaymentMethodCorrection(sql, '00000000-0000-0000-0000-000000000000', corr({ email: 'x@x.com' })), 'not-found');
  assert.equal(await applyPaymentMethodCorrection(sql, 'nope', corr({ email: 'x@x.com' })), 'not-found');
}));

test('applyPaymentMethodCorrection → reviseRequest — 명부도 자동 반영됐으므로(057) 다시 반영해도 정정 값이 유지되고 표식만 지워진다', () => revisionOn(async () => {
  const { row, member } = await requestFor('pc3', 'pc3');
  const r = await applyPaymentMethodCorrection(sql, row.id, corr({ email: `${H('pc3')}.fixed@x.com` }, { correctionId: CID(4) }));
  assert.ok(r !== 'not-found' && r.kind === 'applied' && r.rosterApplied === true);
  const rv = await reviseRequest(sql, row.id, { expectedRevision: 0, reason: '재검토', edits: { category: row.category, deadlineOn: row.deadlineOn, referenceUrl: row.referenceUrl }, partnerConfirmed: true }, member);
  const after = rv as PaymentRequestRow;
  // 옛 동작(명부는 그대로 → 되돌아감)과 달리, 명부가 이미 정정 값이라 다시 반영해도 정정 값이 유지된다.
  assert.equal(after.revision, 1); assert.equal(after.paymentMethod.email, `${H('pc3')}.fixed@x.com`); assert.equal(after.paymentMethodCorrection, null);
  // 1판 이력 스냅샷에는 정정된 값과 표식이 그대로 남아 "정정이 있었다"를 나중에도 답할 수 있다
  const hist = await listRevisions(sql, row.id);
  assert.equal(hist[0].snapshot.paymentMethod.email, `${H('pc3')}.fixed@x.com`); assert.ok(hist[0].snapshot.paymentMethodCorrection);
}));

test('applyPaymentMethodCorrection — 명부 반영(057): 고친 항목만 명부에 병합(안 고친 값 보존), 명부에 수단이 없으면 no_method(요청은 반영)', () => revisionOn(async () => {
  // (가) 명부가 그 사이 달라져 있어도, 정정이 고친 항목(email)만 반영하고 안 고친 항목(holder)은 명부 값 그대로 둔다(요청 스냅샷으로 되돌리지 않는다)
  const { row } = await requestFor('pc4', 'pc4');
  const rosterBefore = (await sql<Array<{ payment_methods: Array<{ id: string; isDefault: boolean }> }>>`select payment_methods from influencer where id = ${row.influencerId}`)[0].payment_methods;
  const defId = rosterBefore.find((m) => m.isDefault)!.id;
  await updatePaymentMethods(sql, row.influencerId, { kind: 'update', id: defId, input: { type: 'paypal', holder: '명부에서만 바꾼 이름', currency: 'JPY', email: `${H('pc4')}.divergent@x.com` } }, null);
  const r = await applyPaymentMethodCorrection(sql, row.id, corr({ email: `${H('pc4')}.fixed@x.com` }, { correctionId: CID(6) }));
  assert.ok(r !== 'not-found' && r.kind === 'applied' && r.rosterApplied === true && r.rosterSkipReason === null);
  const def = (await sql<Array<{ payment_methods: Array<{ isDefault: boolean; email?: string; holder: string }> }>>`select payment_methods from influencer where id = ${row.influencerId}`)[0].payment_methods.find((m) => m.isDefault)!;
  assert.equal(def.email, `${H('pc4')}.fixed@x.com`, '고친 항목(email)은 정정 값으로');
  assert.equal(def.holder, '명부에서만 바꾼 이름', '안 고친 항목(holder)은 명부 값 그대로 — 요청 스냅샷으로 되돌리지 않는다');

  // (나) 명부에 결제 수단이 하나도 없으면 덮을 곳이 없다 → no_method. 요청 정정 자체는 반영된다.
  const { row: row2 } = await requestFor('pc5', 'pc5');
  const only = (await sql<Array<{ payment_methods: Array<{ id: string }> }>>`select payment_methods from influencer where id = ${row2.influencerId}`)[0].payment_methods;
  await updatePaymentMethods(sql, row2.influencerId, { kind: 'remove', id: only[0].id }, null);
  const r2 = await applyPaymentMethodCorrection(sql, row2.id, corr({ email: `${H('pc5')}.fixed@x.com` }, { correctionId: CID(5) }));
  assert.ok(r2 !== 'not-found' && r2.kind === 'applied' && r2.rosterApplied === false && r2.rosterSkipReason === 'no_method');
  assert.equal(r2.row.paymentMethod.email, `${H('pc5')}.fixed@x.com`, '명부가 비어도 요청 스냅샷은 정정된다');
  const hist2 = await sql<Array<{ roster_applied: boolean; roster_skip_reason: string | null }>>`select roster_applied, roster_skip_reason from payment_request_payment_correction where request_id = ${row2.id}`;
  assert.equal(hist2[0].roster_applied, false); assert.equal(hist2[0].roster_skip_reason, 'no_method');
}));

// CID(1)·CID(2)는 앞 테스트가 이미 썼다 — correction_id는 DB 전체에서 한 번만 쓸 수 있으므로
// 저장에 성공하는 테스트는 자기 번호를 써야 한다(파일 상단 CID 주석 참고). 여기는 10번대를 쓴다.
test('applyPaymentMethodCorrection — QR 정정이 요청과 명부에 함께 반영된다', () => revisionOn(async () => {
  const { row } = await requestFor('qr1', 'qr1', { type: 'paypay', qr: 'seed/old.png' });
  const r = await applyPaymentMethodCorrection(sql, row.id, corr({ qr: 'seed/new.png' }, { correctionId: CID(10) }));
  assert.ok(r !== 'not-found' && r.kind === 'applied' && r.rosterApplied === true);

  const after = (await listRequests(sql, { taskId: row.taskId! }))[0];
  assert.equal(after.paymentMethod.qr, 'seed/new.png');
  assert.equal(after.revision, 0);                       // 정정은 판을 올리지 않는다

  const inf = await sql<Array<{ payment_methods: Array<Record<string, unknown>> }>>`
    select payment_methods from influencer where id = ${row.influencerId}`;
  const pm = inf[0].payment_methods.find((m) => m.type === 'paypay')!;
  assert.equal(pm.qr, 'seed/new.png');                   // 명부에도 반영
  assert.equal(pm.isDefault, true);                      // 명부에만 있는 값은 보존
}));

test('applyPaymentMethodCorrection — holder만 고쳐도 QR이 남는다 (스펙 §3-1)', () => revisionOn(async () => {
  const { row } = await requestFor('qr2', 'qr2', { type: 'paypay', qr: 'seed/keep.png' });
  const r = await applyPaymentMethodCorrection(sql, row.id, corr({ holder: '새 이름' }, { correctionId: CID(11) }));
  assert.ok(r !== 'not-found' && r.kind === 'applied');

  const after = (await listRequests(sql, { taskId: row.taskId! }))[0];
  assert.equal(after.paymentMethod.holder, '새 이름');
  assert.equal(after.paymentMethod.qr, 'seed/keep.png');  // ← 네 곳 중 하나라도 빠지면 여기서 undefined
}));

test('applyPaymentMethodCorrection — qr을 null로 지운다', () => revisionOn(async () => {
  const { row } = await requestFor('qr3', 'qr3', { type: 'paypay', qr: 'seed/gone.png' });
  const r = await applyPaymentMethodCorrection(sql, row.id, corr({ qr: null }, { correctionId: CID(12) }));
  assert.ok(r !== 'not-found' && r.kind === 'applied');
  assert.equal((await listRequests(sql, { taskId: row.taskId! }))[0].paymentMethod.qr, undefined);
}));

// ── precheckCorrectionForQrUpload 단위 테스트(재리뷰 2026-09-23 Important 1) ──
// 이 함수는 QR 업로드(저장소 쓰기)를 시작하기 전에 "어차피 거절되거나 재적용되지 않을 정정"인지 가볍게 미리 본다
// (취소·지급완료·판 불일치·이미 적용된 correction_id·idempotency_key). route.test.ts의 취소·재전송 테스트는 이
// 최적화 자체를 검증하지 못한다 — precheckCorrectionForQrUpload를 통째로 지워도(=매번 업로드해도) 그 테스트들은
// 그대로 통과한다(취소는 애초에 patch/명부를 안 쓰고, 재전송은 멱등 분기가 patch를 다시 안 쓰기 때문에 결과가
// 업로드 여부와 무관하다). 라우트 레벨에서 "업로드가 실제로 없었다"를 확인하려면 storage 버킷을 조회해야 하는데,
// 그건 이 파일의 다른 DB 테스트들처럼 느려지고 버킷 상태에 기대는 만큼 불안정해진다 — precheck는 DB만 보는 순수
// 판정 함수이므로 여기서 입력 → proceed를 직접 확인하는 편이 더 정확하고 빠르다(권장 경로 (나)).
test('precheckCorrectionForQrUpload — 취소된 요청은 proceed:false', () => revisionOn(async () => {
  const { row, member } = await requestFor('pre1', 'pre1', { type: 'paypay' });
  await cancelRequest(sql, row.id, '중복', member);
  const pre = await precheckCorrectionForQrUpload(sql, row.id, corr({ qr: 'x' }, { correctionId: CID(20) }));
  assert.deepEqual(pre, { influencerId: row.influencerId, proceed: false });
}));

test('precheckCorrectionForQrUpload — 지급 완료된 요청은 proceed:false', () => revisionOn(async () => {
  const { row } = await requestFor('pre2', 'pre2', { type: 'paypay' });
  await applyExternalStatus(sql, row.id, upd('paid', '2026-09-21T05:00:00Z', { paidAmountKrw: row.grossKrw, paidAt: '2026-09-21T04:59:00Z', revision: 0 }));
  const pre = await precheckCorrectionForQrUpload(sql, row.id, corr({ qr: 'x' }, { correctionId: CID(21) }));
  assert.deepEqual(pre, { influencerId: row.influencerId, proceed: false });
}));

test('precheckCorrectionForQrUpload — 정정이 기준한 판(revision)이 지금과 다르면 proceed:false', () => revisionOn(async () => {
  const { row } = await requestFor('pre3', 'pre3', { type: 'paypay' });
  const pre = await precheckCorrectionForQrUpload(sql, row.id, corr({ qr: 'x' }, { baseRevision: 9, correctionId: CID(22) }));
  assert.deepEqual(pre, { influencerId: row.influencerId, proceed: false });
}));

test('precheckCorrectionForQrUpload — 이미 적용된 correction_id(재전송)는 proceed:false', () => revisionOn(async () => {
  const { row } = await requestFor('pre4', 'pre4', { type: 'paypay' });
  const applied = await applyPaymentMethodCorrection(sql, row.id, corr({ holder: '새 이름' }, { correctionId: CID(23) }));
  assert.ok(applied !== 'not-found' && applied.kind === 'applied');
  const pre = await precheckCorrectionForQrUpload(sql, row.id, corr({ qr: 'x' }, { correctionId: CID(23) }));
  assert.deepEqual(pre, { influencerId: row.influencerId, proceed: false }, '같은 correction_id면 재전송으로 보고 업로드를 건너뛴다');
}));

test('precheckCorrectionForQrUpload — 다른 correction_id라도 이미 쓴 idempotency_key면 재전송으로 본다', () => revisionOn(async () => {
  const { row } = await requestFor('pre5', 'pre5', { type: 'paypay' });
  const applied = await applyPaymentMethodCorrection(sql, row.id, corr({ holder: '새 이름' }, { correctionId: CID(24), idempotencyKey: 'pre5-key' }));
  assert.ok(applied !== 'not-found' && applied.kind === 'applied');
  const pre = await precheckCorrectionForQrUpload(sql, row.id, corr({ qr: 'x' }, { correctionId: CID(25), idempotencyKey: 'pre5-key' }));
  assert.deepEqual(pre, { influencerId: row.influencerId, proceed: false });
}));

test('precheckCorrectionForQrUpload — 거절될 이유가 없으면 proceed:true', () => revisionOn(async () => {
  const { row } = await requestFor('pre6', 'pre6', { type: 'paypay' });
  const pre = await precheckCorrectionForQrUpload(sql, row.id, corr({ qr: 'x' }, { correctionId: CID(26) }));
  assert.deepEqual(pre, { influencerId: row.influencerId, proceed: true });
}));

test('precheckCorrectionForQrUpload — 없는 요청·uuid 형식이 아닌 id는 influencerId:null, proceed:false', async () => {
  assert.deepEqual(
    await precheckCorrectionForQrUpload(sql, '00000000-0000-0000-0000-000000000000', corr({ qr: 'x' }, { correctionId: CID(27) })),
    { influencerId: null, proceed: false },
  );
  assert.deepEqual(
    await precheckCorrectionForQrUpload(sql, 'nope', corr({ qr: 'x' }, { correctionId: CID(28) })),
    { influencerId: null, proceed: false },
  );
});

test('작업별 결제 수단(060) — 후보·요청 스냅샷이 작업이 고른 수단을 쓰고, 고른 수단이 지워지면 기본 수단으로', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라PM');
  const camp = await createCampaign(sql, base(c.id, c.name, 'pm', 'visit'));
  const inf = await influencerWithPaypal(H('pm'));   // 기본 = PayPal ¥ CB 5%
  const added = await updatePaymentMethods(sql, inf.id, { kind: 'add', input: { type: 'bank', holder: 'K', currency: 'KRW', bank: '국민', account: '123' } }, null);
  const bank = added.paymentMethods.find((x) => x.type === 'bank')!;
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H('pm'), cost: { amount: 30000, currency: 'KRW' }, paymentMethodId: bank.id }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/pm/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  assert.equal(cand.method?.id, bank.id);
  assert.equal(cand.money?.payoutCurrency, 'KRW');
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [row] = await createRequests(sql, [itemOf(cand, fee.sendAs)], m, '2026-08-28');   // expected.paymentMethodId 대조도 같은 id라 통과
  assert.equal(row.paymentMethod.type, 'bank');
  await cancelRequest(sql, row.id, '테스트', m);
  await updatePaymentMethods(sql, inf.id, { kind: 'remove', id: bank.id }, null);
  const again = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  assert.equal(again.method?.type, 'paypal');   // 고른 수단이 지워지면 기본(PayPal)으로 정산된다
});
