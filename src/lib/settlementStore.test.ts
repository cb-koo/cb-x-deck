import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks, updateTask, getTask } from './campaignTaskStore.ts';
import { createInfluencer, updatePaymentMethods } from './influencerStore.ts';
import { SETTLEMENT_DEFAULTS, type SettlementSettings } from './settlementSettings.ts';
import { isSettlementCandidate } from './campaignJudgment.ts';
import {
  getSettlementSettings, saveSettlementSettings, listSettlementVersions, lastQuoteRtCategory, listCandidates,
  createRequests, cancelRequest, listRequests, settlementByTaskIds, SettlementCreateError,
} from './settlementStore.ts';
import type { CreateItemInput } from './settlementStore.ts';

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

test('생성 — 전체 검증: 하나라도 실패면 0건 저장, 건별 이유', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라C');
  const camp = await createCampaign(sql, base(c.id, c.name, 'c'));
  await influencerWithPaypal(H('v1')); await influencerWithPaypal(H('v2'));
  const [t1, t2] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: H('v1'), cost: { amount: 30000, currency: 'KRW' } }, { handle: H('v2'), cost: { amount: 30000, currency: 'KRW' } }] });
  for (const t of [t1, t2]) await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual' });
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
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual' });
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
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual' });
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
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual' });
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

// 마지막에 둔다 — 이 테스트가 "현재 설정"을 잠시 바꿔 두고 after()에서만 되돌리기 때문에(인터럽트 안전을 위한 설계, 아래
// 참고), 앞선 테스트들이 실행되는 동안엔 DB 현재 설정이 원래값이어야 createRequests()의 실시간 rate와 어긋나지 않는다.
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
});
