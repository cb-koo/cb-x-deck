// 정산 저장소(스펙 2026-08-28 §2·§5) — 후보는 계산, 요청은 스냅샷, 설정은 버전 행. 계산은 전부 settlementCalc에 위임.
import postgres from 'postgres';
import { kstToday } from './datetime.ts';
import { isUuidLike } from './uuid.ts';
import { parseTaskCost, type TaskCost } from './campaignCost.ts';
import type { Currency } from './influencerPricing.ts';
import type { PaymentFee } from './influencerPayment.ts';
import type { TaskType, CampaignKind } from './campaignJudgment.ts';
import { isDateOnlyString } from './campaignJudgment.ts';   // 'YYYY-MM-DD' + 실제 달력일 검증(캠페인 라우트 가드)
import { getDefaultPaymentMethod, type PaymentMethod } from './influencerPayment.ts';
import { insertAutoLog, type PaymentLogPayload } from './influencerStore.ts';
import { SETTLEMENT_DEFAULTS, sanitizeSettlementSettings, categoryBySendAs, type SettlementSettings } from './settlementSettings.ts';
import { computeCandidate, toMethodSnapshot, type SettlementCandidate, type PaymentMethodSnapshot } from './settlementCalc.ts';

const asJson = (v: object): postgres.JSONValue => v as unknown as postgres.JSONValue;

// ── 설정(§2-2) ──
export async function getSettlementSettings(sql: postgres.Sql): Promise<SettlementSettings> {
  const rows = await sql<Array<{ settings: unknown }>>`
    select settings from settlement_setting_version order by created_at desc, id desc limit 1`;
  if (!rows.length) return SETTLEMENT_DEFAULTS;
  const s = sanitizeSettlementSettings(rows[0].settings);
  return typeof s === 'string' ? SETTLEMENT_DEFAULTS : s;   // 깨진 행이면 기본값으로 — 화면이 멈추지 않게
}
export async function saveSettlementSettings(sql: postgres.Sql, s: SettlementSettings, memberId: string | null): Promise<void> {
  await sql`insert into settlement_setting_version (settings, member_id) values (${sql.json(asJson(s))}, ${memberId})`;
}
export interface SettlementVersionRow { id: string; memberName: string | null; createdAt: string }
export async function listSettlementVersions(sql: postgres.Sql, limit = 5): Promise<SettlementVersionRow[]> {
  const rows = await sql<Array<{ id: string; created_at: Date; member_name: string | null }>>`
    select v.id, v.created_at, m.name as member_name
      from settlement_setting_version v left join member m on m.id = v.member_id
     order by v.created_at desc, v.id desc limit ${limit}`;
  return rows.map((r) => ({ id: r.id, memberName: r.member_name, createdAt: new Date(r.created_at).toISOString() }));
}

// ── 후보(§2-4) ──
// 요청자가 마지막에 고른 인용RT 분류 — 취소된 것도 "고른 값"이므로 status 무관
export async function lastQuoteRtCategory(sql: postgres.Sql, requesterMemberId: string | null): Promise<string | null> {
  if (!requesterMemberId || !isUuidLike(requesterMemberId)) return null;
  const rows = await sql<Array<{ category: string }>>`
    select category from payment_request
     where requester_member_id = ${requesterMemberId} and task_type = 'quoteRt'
     order by created_at desc, id desc limit 1`;
  return rows.length ? rows[0].category : null;
}

type CandRow = {
  id: string; type: TaskType; influencer_handle: string; cost: unknown; post_url: string | null; target_tweet_url: string | null;
  target_post_url: string | null; posted_at: string; removed_at: string | null; removed_reason: string; draft_label: string | null;
  campaign_id: string; campaign_name: string; kind: CampaignKind | null; client_id: string | null; client_name: string | null;
  influencer_id: string | null; payment_methods: unknown;
};
// 후보 조건은 campaignJudgment.isSettlementCandidate와 같은 정의 — 스토어 테스트가 대조한다
const CANDIDATE_SQL = (sql: postgres.Sql) => sql`
  select t.id, t.type, t.influencer_handle, t.cost, t.post_url, t.target_tweet_url, tg.post_url as target_post_url,
         to_char(t.posted_at, 'YYYY-MM-DD') as posted_at, to_char(t.removed_at, 'YYYY-MM-DD') as removed_at, t.removed_reason,
         coalesce(d.title, d.ko_title) as draft_label,
         c.id as campaign_id, c.name as campaign_name, c.kind, c.client_id, c.client_name,
         i.id as influencer_id, i.payment_methods
    from campaign_task t
    join campaign c on c.id = t.campaign_id
    left join campaign_task tg on tg.id = t.target_task_id
    left join draft d on d.id = t.draft_id
    left join influencer i on lower(i.handle) = lower(t.influencer_handle)
   where t.posted_at is not null and t.cost is not null and t.influencer_handle is not null
     and not exists (select 1 from payment_request r where r.task_id = t.id and r.status = 'requested')`;

export async function listCandidates(
  sql: postgres.Sql, settings: SettlementSettings, requesterMemberId: string | null, today: string = kstToday(),
): Promise<SettlementCandidate[]> {
  const [rows, lastQ] = await Promise.all([
    sql<CandRow[]>`${CANDIDATE_SQL(sql)} order by t.posted_at asc, t.created_at asc, t.id asc`,
    lastQuoteRtCategory(sql, requesterMemberId),
  ]);
  const out: SettlementCandidate[] = [];
  for (const r of rows) {
    const cost = parseTaskCost(r.cost ?? null);
    if (!cost.ok || cost.value === null) continue;   // jsonb 모양 보증 없음 — 검증 통과분만(campaignTaskStore.costOf 태도). null은 CANDIDATE_SQL이 이미 걸러내지만 타입상 좁혀 둔다
    out.push(rowToCandidate(r, cost.value, settings, lastQ, today));
  }
  return out;
}
function rowToCandidate(r: CandRow, cost: TaskCost, settings: SettlementSettings, lastQ: string | null, today: string): SettlementCandidate {
  const methods = Array.isArray(r.payment_methods) ? (r.payment_methods as PaymentMethod[]) : [];
  return computeCandidate({
    task: { id: r.id, type: r.type, influencerHandle: r.influencer_handle, cost, postUrl: r.post_url, targetTweetUrl: r.target_tweet_url, targetPostUrl: r.target_post_url, postedAt: r.posted_at, removedAt: r.removed_at, removedReason: r.removed_reason, draftLabel: r.draft_label },
    campaign: { id: r.campaign_id, name: r.campaign_name, kind: r.kind, clientId: r.client_id, clientName: r.client_name ?? '기타' },
    influencer: { inRoster: r.influencer_id !== null, method: r.influencer_id ? getDefaultPaymentMethod(methods) : null },
    settings, lastQuoteRtCategory: lastQ, today,
  });
}

// ── 요청(§2-1·§5) ──
export type RequestStatus = 'requested' | 'cancelled';
export interface PaymentRequestRow {
  id: string; taskId: string | null; campaignId: string | null; campaignName: string; clientId: string | null; clientName: string;
  influencerHandle: string; taskType: TaskType; category: string; categoryDefault: string | null; itemText: string; purposeText: string;
  amountKrw: number; costCurrency: Currency; payoutCurrency: Currency; rateKrwPerJpy: number; amountNet: number;
  fee: PaymentFee | null; feeAmount: number; amountGross: number; deadlineOn: string; referenceUrl: string | null;
  paymentMethod: PaymentMethodSnapshot; requesterMemberId: string | null; requesterName: string;
  status: RequestStatus; cancelledAt: string | null; cancelledByName: string | null; cancelReason: string | null;
  sentAt: string | null; externalId: string | null; note: string; createdAt: string; updatedAt: string;
}
export interface CreateItemInput {
  taskId: string; category: string; deadlineOn: string; referenceUrl: string | null;
  expected: { amountGross: number; payoutCurrency: Currency; paymentMethodId: string };
}
export class SettlementCreateError extends Error {
  constructor(public failures: Array<{ taskId: string; reason: string }>) { super('settlement-create-failed'); this.name = 'SettlementCreateError'; }
}

type RRow = {
  id: string; task_id: string | null; campaign_id: string | null; campaign_name: string; client_id: string | null; client_name: string;
  influencer_handle: string; task_type: TaskType; category: string; category_default: string | null; item_text: string; purpose_text: string;
  amount_krw: number; cost_currency: Currency; payout_currency: Currency; rate_krw_per_jpy: number; amount_net: number;
  fee: PaymentFee | null; fee_amount: number; amount_gross: number; deadline_on: string; reference_url: string | null;
  payment_method: PaymentMethodSnapshot; requester_member_id: string | null; requester_name: string;
  status: RequestStatus; cancelled_at: Date | null; cancelled_by_name: string | null; cancel_reason: string | null;
  sent_at: Date | null; external_id: string | null; note: string; created_at: Date; updated_at: Date;
};
const R_SELECT = (sql: postgres.Sql) => sql`
  select id, task_id, campaign_id, campaign_name, client_id, client_name, influencer_handle, task_type, category, category_default,
         item_text, purpose_text, amount_krw, cost_currency, payout_currency, rate_krw_per_jpy, amount_net, fee, fee_amount, amount_gross,
         to_char(deadline_on, 'YYYY-MM-DD') as deadline_on, reference_url, payment_method, requester_member_id, requester_name,
         status, cancelled_at, cancelled_by_name, cancel_reason, sent_at, external_id, note, created_at, updated_at
    from payment_request`;
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const toRequest = (r: RRow): PaymentRequestRow => ({
  id: r.id, taskId: r.task_id, campaignId: r.campaign_id, campaignName: r.campaign_name, clientId: r.client_id, clientName: r.client_name,
  influencerHandle: r.influencer_handle, taskType: r.task_type, category: r.category, categoryDefault: r.category_default, itemText: r.item_text, purposeText: r.purpose_text,
  amountKrw: r.amount_krw, costCurrency: r.cost_currency, payoutCurrency: r.payout_currency, rateKrwPerJpy: r.rate_krw_per_jpy, amountNet: r.amount_net,
  fee: r.fee, feeAmount: r.fee_amount, amountGross: r.amount_gross, deadlineOn: r.deadline_on, referenceUrl: r.reference_url,
  paymentMethod: r.payment_method, requesterMemberId: r.requester_member_id, requesterName: r.requester_name,
  status: r.status, cancelledAt: iso(r.cancelled_at), cancelledByName: r.cancelled_by_name, cancelReason: r.cancel_reason,
  sentAt: iso(r.sent_at), externalId: r.external_id, note: r.note, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
});

const isHttpUrl = (u: string) => /^https?:\/\/\S+$/.test(u);

// §5-2 전부 검증 → 전부 저장. 하나라도 실패면 0건(koo 08-28 "튕겨서 다시 보게").
export async function createRequests(
  sql: postgres.Sql, items: CreateItemInput[], member: { id: string; name: string }, today: string = kstToday(),
): Promise<PaymentRequestRow[]> {
  if (items.length === 0) throw new SettlementCreateError([]);
  const settings = await getSettlementSettings(sql);
  const lastQ = await lastQuoteRtCategory(sql, member.id);
  const ids = items.map((i) => i.taskId).filter(isUuidLike);
  const rows = await sql<CandRow[]>`${CANDIDATE_SQL(sql)} and t.id in ${sql(ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])}`;
  const byTask = new Map(rows.map((r) => [r.id, r]));
  const failures: Array<{ taskId: string; reason: string }> = [];
  const prepared: Array<{ item: CreateItemInput; cand: SettlementCandidate; r: CandRow }> = [];
  for (const item of items) {
    const r = byTask.get(item.taskId);
    if (!r) {   // 후보가 아니거나(게시 취소·비용 삭제) 이미 활성 요청이 있다
      const active = isUuidLike(item.taskId) ? await sql<Array<{ requester_name: string }>>`select requester_name from payment_request where task_id = ${item.taskId} and status = 'requested'` : [];
      failures.push({ taskId: item.taskId, reason: active.length ? `이미 요청됐어요 (${active[0].requester_name})` : '지금은 정산 후보가 아니에요 — 목록을 다시 확인해 주세요' });
      continue;
    }
    const cost = parseTaskCost(r.cost ?? null);
    if (!cost.ok || cost.value === null) { failures.push({ taskId: item.taskId, reason: '비용 형식이 올바르지 않아요' }); continue; }
    const cand = rowToCandidate(r, cost.value, settings, lastQ, today);
    if (!cand.method || !cand.money) { failures.push({ taskId: item.taskId, reason: cand.issues.find((x) => x.level === 'blocked')?.text ?? '결제 수단이 없어요' }); continue; }
    const cat = categoryBySendAs(settings, item.category);
    if (!cat || cat.hidden) { failures.push({ taskId: item.taskId, reason: '분류를 다시 골라 주세요 — 목록에 없는 분류예요' }); continue; }
    if (!isDateOnlyString(item.deadlineOn)) { failures.push({ taskId: item.taskId, reason: '마감일 형식을 확인해 주세요' }); continue; }
    if (item.referenceUrl !== null && item.referenceUrl !== '' && !isHttpUrl(item.referenceUrl)) { failures.push({ taskId: item.taskId, reason: '참고 링크는 http(s) 주소여야 해요' }); continue; }
    if (cand.money.amountGross !== item.expected.amountGross || cand.money.payoutCurrency !== item.expected.payoutCurrency) {
      failures.push({ taskId: item.taskId, reason: '금액이 바뀌었어요 — 다시 확인해 주세요' }); continue;
    }
    if (cand.method.id !== item.expected.paymentMethodId) { failures.push({ taskId: item.taskId, reason: '결제 수단이 바뀌었어요 — 다시 확인해 주세요' }); continue; }
    prepared.push({ item, cand, r });
  }
  if (failures.length) throw new SettlementCreateError(failures);

  try {
    return await sql.begin(async (tx0) => {
      const tx = tx0 as unknown as postgres.Sql;
      const out: PaymentRequestRow[] = [];
      for (const { item, cand, r } of prepared) {
        const m = cand.money!; const pm = cand.method!;
        const ins = await tx<Array<{ id: string }>>`
          insert into payment_request (task_id, campaign_id, campaign_name, client_id, client_name, influencer_handle, task_type,
            category, category_default, item_text, purpose_text, amount_krw, cost_currency, payout_currency, rate_krw_per_jpy,
            amount_net, fee, fee_amount, amount_gross, deadline_on, reference_url, payment_method, requester_member_id, requester_name)
          values (${cand.taskId}, ${cand.campaignId}, ${cand.campaignName}, ${cand.clientId}, ${cand.clientName}, ${cand.influencerHandle}, ${cand.taskType},
            ${item.category}, ${cand.categoryDefault}, ${cand.itemText}, ${cand.purposeText}, ${m.amountKrw}, ${m.costCurrency}, ${m.payoutCurrency}, ${m.rateKrwPerJpy},
            ${m.amountNet}, ${m.fee ? tx.json(asJson(m.fee)) : null}, ${m.feeAmount}, ${m.amountGross}, ${item.deadlineOn}, ${item.referenceUrl || null},
            ${tx.json(asJson(toMethodSnapshot(pm)))}, ${member.id}, ${member.name})
          returning id`;
        const [saved] = await tx<RRow[]>`${R_SELECT(tx)} where id = ${ins[0].id}`;
        const row = toRequest(saved);
        const payload: PaymentLogPayload = { requestId: row.id, amountGross: row.amountGross, currency: row.payoutCurrency, taskType: row.taskType };
        if (r.influencer_id) await insertAutoLog(tx, { influencerId: r.influencer_id, eventType: 'payment_requested', draftId: null, draftTitle: null, payload, authorId: member.id });
        out.push(row);
      }
      return out;
    });
  } catch (e) {
    // 동시 클릭으로 unique(활성 요청 1건) 위반 — 어느 작업인지 다시 조회해 건별 이유로
    if ((e as { code?: string }).code === '23505') {
      const dup = await sql<Array<{ task_id: string; requester_name: string }>>`
        select task_id, requester_name from payment_request where status = 'requested' and task_id in ${sql(prepared.map((p) => p.cand.taskId))}`;
      throw new SettlementCreateError(dup.map((d) => ({ taskId: d.task_id, reason: `이미 요청됐어요 (${d.requester_name})` })));
    }
    throw e;
  }
}

export async function cancelRequest(
  sql: postgres.Sql, id: string, reason: string, member: { id: string; name: string },
): Promise<PaymentRequestRow | 'not-found' | 'already-cancelled'> {
  if (!isUuidLike(id)) return 'not-found';
  return await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    const cur = await tx<RRow[]>`${R_SELECT(tx)} where id = ${id} for update`;
    if (!cur.length) return 'not-found';
    if (cur[0].status === 'cancelled') return 'already-cancelled';
    await tx`
      update payment_request set status = 'cancelled', cancelled_at = now(), cancelled_by = ${member.id}, cancelled_by_name = ${member.name},
             cancel_reason = ${reason}, updated_at = now()
       where id = ${id}`;
    const [saved] = await tx<RRow[]>`${R_SELECT(tx)} where id = ${id}`;
    const row = toRequest(saved);
    const inf = await tx<Array<{ id: string }>>`select id from influencer where lower(handle) = lower(${row.influencerHandle})`;
    if (inf.length) {
      const payload: PaymentLogPayload = { requestId: row.id, amountGross: row.amountGross, currency: row.payoutCurrency, taskType: row.taskType, reason };
      await insertAutoLog(tx, { influencerId: inf[0].id, eventType: 'payment_cancelled', draftId: null, draftTitle: null, payload, authorId: member.id });
    }
    return row;
  });
}

export interface RequestFilter { clientId?: string; campaignId?: string; status?: RequestStatus; from?: string; to?: string; taskId?: string }
export async function listRequests(sql: postgres.Sql, f: RequestFilter): Promise<PaymentRequestRow[]> {
  const rows = await sql<RRow[]>`${R_SELECT(sql)}
    where true
      ${f.clientId && isUuidLike(f.clientId) ? sql`and client_id = ${f.clientId}` : sql``}
      ${f.campaignId && isUuidLike(f.campaignId) ? sql`and campaign_id = ${f.campaignId}` : sql``}
      ${f.taskId && isUuidLike(f.taskId) ? sql`and task_id = ${f.taskId}` : sql``}
      ${f.status ? sql`and status = ${f.status}` : sql``}
      ${f.from && isDateOnlyString(f.from) ? sql`and created_at >= (${f.from}::date)::timestamptz` : sql``}
      ${f.to && isDateOnlyString(f.to) ? sql`and created_at < ((${f.to}::date) + 1)::timestamptz` : sql``}
    order by created_at desc, id desc`;
  return rows.map(toRequest);
}

// 배지 조회(settlementByTaskIds)는 campaignTaskStore에 있다(순환 방지: settlementStore→influencerStore→campaignStore) — 여기서는 re-export만
export { settlementByTaskIds } from './campaignTaskStore.ts';
