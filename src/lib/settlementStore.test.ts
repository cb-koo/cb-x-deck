import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient, deleteClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks, updateTask, getTask, deleteTask } from './campaignTaskStore.ts';
import { createInfluencer, updatePaymentMethods, deleteInfluencer } from './influencerStore.ts';
import { SETTLEMENT_DEFAULTS, type SettlementSettings } from './settlementSettings.ts';
import { isSettlementCandidate } from './campaignJudgment.ts';
import {
  getSettlementSettings, saveSettlementSettings, listSettlementVersions, lastQuoteRtCategory, listCandidates,
  createRequests, cancelRequest, listRequests, settlementByTaskIds, SettlementCreateError,
  listForExport, getForExport, applyExternalStatus, ackDiff, unackDiff,
} from './settlementStore.ts';
import type { CreateItemInput, PaymentRequestRow } from './settlementStore.ts';
import { encodeCursor, decodeCursor } from './settlementExternal.ts';

const sql = getSql();
const P = 'tstl' + process.pid;
const H = (s: string) => `${P}_${s}`;   // 핸들도 접두어 — 명부 정리를 위해
// 설정 테스트가 중단(인터럽트)돼도 프로덕션 설정을 테스트 값으로 남기지 않기 위한 원상복구용 — 테스트 시작 시 채운다
let savedBefore: SettlementSettings | null = null;
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
      isSettlementCandidate({ postedAt: task.postedAt, cost: task.cost, influencerHandle: task.influencerHandle, removedAt: task.removedAt }),
      ids.includes(task.id),
    );
  }
  const pay = list.find((x) => x.taskId === tPay.id)!;
  assert.equal(pay.money?.amountGross, 3158); assert.equal(pay.method?.type, 'paypal');
  assert.equal(pay.readiness, 'blocked');   // 인용RT 첫 요청 — 분류 빈칸
  assert.equal(pay.categoryDefault, null);
  assert.equal(list.find((x) => x.taskId === tNoPm.id)!.issues[0].code, 'no-payment-method');
  assert.equal(list.find((x) => x.taskId === tNoRoster.id)!.issues[0].code, 'no-influencer');
  assert.equal(pay.clientName, c.name); assert.equal(pay.campaignName, camp.name); assert.equal(pay.deadlineDefault, '2026-08-28');
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
  assert.equal(row.paymentMethod.type, 'paypal'); assert.equal(row.requesterName, m.name); assert.equal(row.deadlineOn, '2026-08-28');
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
  // 이전 실행이 인터럽트로 중간에 끊겨 이 테스트의 마커 행이 "현재값"으로 남아 있을 수 있다 — 먼저 지워야
  // 아래 before가 진짜 원래값을 읽는다(그래야 after()의 복구도 올바른 값으로 이뤄진다)
  await sql`delete from settlement_setting_version where settings->>'marker' = ${P}`;
  // 다른 세션이 이미 저장한 행이 있을 수 있어 "기본값과 같다"는 단정 대신 모양만 본다
  const before = await getSettlementSettings(sql);
  assert.ok(before.categories.length >= 1 && before.rateKrwPerJpy >= 1);
  savedBefore = before;   // after()가 인터럽트 여부와 무관하게 이 값으로 되돌린다(테스트 본문에서는 복구하지 않는다)
  const mine = { ...SETTLEMENT_DEFAULTS, rateKrwPerJpy: 11, marker: P } as typeof SETTLEMENT_DEFAULTS & { marker: string };
  await saveSettlementSettings(sql, mine, null);
  const cur = await getSettlementSettings(sql);
  assert.equal(cur.rateKrwPerJpy, 11);
  const versions = await listSettlementVersions(sql, 1);
  assert.equal(versions.length, 1);
  // 본문 끝에서 바로 원래값으로 복구 — after()의 복구는 인터럽트 대비 이중 안전장치일 뿐, 순서에 기대지 않는다
  await saveSettlementSettings(sql, savedBefore!, null);
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

async function requestFor(handle: string, campSuffix: string) {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라' + campSuffix);
  const camp = await createCampaign(sql, base(c.id, c.name, campSuffix, 'visit'));
  await influencerWithPaypal(H(handle));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H(handle), cost: { amount: 30000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/r/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [row] = await createRequests(sql, [itemOf(cand, fee.sendAs)], m, '2026-08-28');
  return { row, task: t, member: m };
}
const at = (s: string) => new Date(s).toISOString();
const upd = (status: 'received' | 'scheduled' | 'paid' | 'on_hold' | 'cancelled', updatedAt: string, extra: Partial<{ note: string; paidAmountKrw: number; paidAt: string; externalId: string }> = {}) => ({
  status, updatedAt: at(updatedAt), note: extra.note ?? null, paidAmountKrw: extra.paidAmountKrw ?? null, paidAt: extra.paidAt ? at(extra.paidAt) : null, externalId: extra.externalId ?? null,
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
    paidAmountKrw: row.grossKrw - 1650, paidAt: '2026-09-01T00:59:00Z', externalId: null });
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
    paidAmountKrw: row.grossKrw, paidAt: '2026-09-01T00:59:00Z', externalId: null });
  assert.equal(await ackDiff(sql, row.id, { name: '박구건' }), 'no-diff');
});

test('차액 확인 — 그쪽이 금액을 정정하면 확인이 풀린다', async () => {
  const { row } = await requestFor('diffack4', 'diffack4');
  const paid = (krw: number, at: string) => applyExternalStatus(sql, row.id, { status: 'paid', updatedAt: at, note: null, paidAmountKrw: krw, paidAt: at, externalId: null });

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
