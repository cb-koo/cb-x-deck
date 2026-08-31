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
import { computeCandidate, toMethodSnapshot, NO_CLIENT_TEXT, NO_INFLUENCER_TEXT, type SettlementCandidate, type PaymentMethodSnapshot } from './settlementCalc.ts';
import { taskProofOf, type TaskProof } from './taskProofGuard.ts';
import type { SettlementBadgeStatus, ExternalStatus } from './campaignTaskStore.ts';
import type { Cursor, ExportRow, StatusUpdate } from './settlementExternal.ts';   // 타입만이라 순환 무해

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
  influencer_id: string | null; payment_methods: unknown; proof: unknown;
};
// 후보 조건은 campaignJudgment.isSettlementCandidate와 같은 정의 — 스토어 테스트가 대조한다
const CANDIDATE_SQL = (sql: postgres.Sql) => sql`
  select t.id, t.type, t.influencer_handle, t.cost, t.post_url, t.target_tweet_url, tg.post_url as target_post_url,
         to_char(t.posted_at, 'YYYY-MM-DD') as posted_at, to_char(t.removed_at, 'YYYY-MM-DD') as removed_at, t.removed_reason,
         coalesce(d.title, d.ko_title) as draft_label, t.proof,
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
    task: { id: r.id, type: r.type, influencerHandle: r.influencer_handle, cost, postUrl: r.post_url, targetTweetUrl: r.target_tweet_url, targetPostUrl: r.target_post_url, postedAt: r.posted_at, removedAt: r.removed_at, removedReason: r.removed_reason, draftLabel: r.draft_label, proof: taskProofOf(r.proof) },
    campaign: { id: r.campaign_id, name: r.campaign_name, kind: r.kind, clientId: r.client_id, clientName: r.client_name ?? '기타' },
    influencer: { inRoster: r.influencer_id !== null, method: r.influencer_id ? getDefaultPaymentMethod(methods) : null },
    settings, lastQuoteRtCategory: lastQ, today,
  });
}

// ── 요청(§2-1·§5) ──
export type RequestStatus = SettlementBadgeStatus;
export interface PaymentRequestRow {
  id: string; taskId: string | null; campaignId: string | null; campaignName: string; clientId: string; clientName: string;
  influencerHandle: string; taskType: TaskType; category: string; categoryDefault: string | null; itemText: string; purposeText: string;
  amountKrw: number; costCurrency: Currency; payoutCurrency: Currency; rateKrwPerJpy: number; amountNet: number;
  fee: PaymentFee | null; feeAmount: number; amountGross: number; deadlineOn: string; referenceUrl: string | null; proof: TaskProof | null;
  paymentMethod: PaymentMethodSnapshot; requesterMemberId: string | null; requesterName: string;
  status: RequestStatus; cancelledAt: string | null; cancelledByName: string | null; cancelReason: string | null;
  sentAt: string | null; externalId: string | null; note: string; createdAt: string; updatedAt: string;
  externalStatus: ExternalStatus | null; paidAmountKrw: number | null; paidAt: string | null; externalNote: string | null;
  externalUpdatedAt: string | null; influencerId: string; categoryOptionId: string;
}
export interface CreateItemInput {
  taskId: string; category: string; deadlineOn: string; referenceUrl: string | null;
  expected: { amountGross: number; payoutCurrency: Currency; paymentMethodId: string };
}
export class SettlementCreateError extends Error {
  constructor(public failures: Array<{ taskId: string; reason: string }>) { super('settlement-create-failed'); this.name = 'SettlementCreateError'; }
}

type RRow = {
  id: string; task_id: string | null; campaign_id: string | null; campaign_name: string; client_id: string; client_name: string;
  influencer_handle: string; task_type: TaskType; category: string; category_default: string | null; item_text: string; purpose_text: string;
  amount_krw: number; cost_currency: Currency; payout_currency: Currency; rate_krw_per_jpy: number; amount_net: number;
  fee: PaymentFee | null; fee_amount: number; amount_gross: number; deadline_on: string; reference_url: string | null; proof: unknown;
  payment_method: PaymentMethodSnapshot; requester_member_id: string | null; requester_name: string;
  status: RequestStatus; cancelled_at: Date | null; cancelled_by_name: string | null; cancel_reason: string | null;
  sent_at: Date | null; external_id: string | null; note: string; created_at: Date; updated_at: Date;
  external_status: ExternalStatus | null; paid_amount_krw: number | null; paid_at: Date | null; external_note: string | null;
  external_updated_at: Date | null; influencer_id: string; category_option_id: string;
};
const R_SELECT = (sql: postgres.Sql) => sql`
  select id, task_id, campaign_id, campaign_name, client_id, client_name, influencer_handle, task_type, category, category_default,
         item_text, purpose_text, amount_krw, cost_currency, payout_currency, rate_krw_per_jpy, amount_net, fee, fee_amount, amount_gross,
         to_char(deadline_on, 'YYYY-MM-DD') as deadline_on, reference_url, proof, payment_method, requester_member_id, requester_name,
         status, cancelled_at, cancelled_by_name, cancel_reason, sent_at, external_id, note, created_at, updated_at,
         external_status, paid_amount_krw, paid_at, external_note, external_updated_at, influencer_id, category_option_id
    from payment_request`;
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const toRequest = (r: RRow): PaymentRequestRow => ({
  id: r.id, taskId: r.task_id, campaignId: r.campaign_id, campaignName: r.campaign_name, clientId: r.client_id, clientName: r.client_name,
  influencerHandle: r.influencer_handle, taskType: r.task_type, category: r.category, categoryDefault: r.category_default, itemText: r.item_text, purposeText: r.purpose_text,
  amountKrw: r.amount_krw, costCurrency: r.cost_currency, payoutCurrency: r.payout_currency, rateKrwPerJpy: r.rate_krw_per_jpy, amountNet: r.amount_net,
  fee: r.fee, feeAmount: r.fee_amount, amountGross: r.amount_gross, deadlineOn: r.deadline_on, referenceUrl: r.reference_url, proof: taskProofOf(r.proof),
  paymentMethod: r.payment_method, requesterMemberId: r.requester_member_id, requesterName: r.requester_name,
  status: r.status, cancelledAt: iso(r.cancelled_at), cancelledByName: r.cancelled_by_name, cancelReason: r.cancel_reason,
  sentAt: iso(r.sent_at), externalId: r.external_id, note: r.note, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
  externalStatus: r.external_status, paidAmountKrw: r.paid_amount_krw, paidAt: iso(r.paid_at), externalNote: r.external_note,
  externalUpdatedAt: iso(r.external_updated_at), influencerId: r.influencer_id, categoryOptionId: r.category_option_id,
});

const isHttpUrl = (u: string) => /^https?:\/\/\S+$/.test(u);

// §5-2 전부 검증 → 전부 저장. 하나라도 실패면 0건(koo 08-28 "튕겨서 다시 보게").
export async function createRequests(
  sql: postgres.Sql, items: CreateItemInput[], member: { id: string; name: string }, today: string = kstToday(),
): Promise<PaymentRequestRow[]> {
  if (items.length === 0) throw new SettlementCreateError([{ taskId: '', reason: '요청할 작업을 골라 주세요' }]);
  const settings = await getSettlementSettings(sql);
  const lastQ = await lastQuoteRtCategory(sql, member.id);
  const ids = items.map((i) => i.taskId).filter(isUuidLike);
  const rows = await sql<CandRow[]>`${CANDIDATE_SQL(sql)} and t.id in ${sql(ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])}`;
  const byTask = new Map(rows.map((r) => [r.id, r]));
  const failures: Array<{ taskId: string; reason: string }> = [];
  const prepared: Array<{ item: CreateItemInput; cand: SettlementCandidate; r: CandRow; cat: { id: string } }> = [];
  const seenTaskIds = new Set<string>();
  for (const item of items) {
    if (seenTaskIds.has(item.taskId)) {   // 같은 작업이 두 번 들어오면 부분 유니크 인덱스가 트랜잭션 전체를 굴린다 — 검증 단계에서 미리 거절
      failures.push({ taskId: item.taskId, reason: '같은 작업이 두 번 골라졌어요 — 한 번만 선택해 주세요' });
      continue;
    }
    seenTaskIds.add(item.taskId);
    const r = byTask.get(item.taskId);
    if (!r) {   // 후보가 아니거나(게시 취소·비용 삭제) 이미 활성 요청이 있다
      const active = isUuidLike(item.taskId) ? await sql<Array<{ requester_name: string }>>`select requester_name from payment_request where task_id = ${item.taskId} and status = 'requested'` : [];
      failures.push({ taskId: item.taskId, reason: active.length ? `이미 요청됐어요 (${active[0].requester_name})` : '지금은 정산 후보가 아니에요 — 목록을 다시 확인해 주세요' });
      continue;
    }
    // 계약 보증(042 §4-8): 저장되는 순간 클라이언트·인플 ID는 non-null이어야 한다 — 화면 신호등(no-client)이 먼저 막지만, 여기서 다시 막는다
    if (r.client_id === null) { failures.push({ taskId: item.taskId, reason: NO_CLIENT_TEXT }); continue; }
    if (r.influencer_id === null) { failures.push({ taskId: item.taskId, reason: NO_INFLUENCER_TEXT }); continue; }
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
    prepared.push({ item, cand, r, cat });
  }
  if (failures.length) throw new SettlementCreateError(failures);

  try {
    return await sql.begin(async (tx0) => {
      const tx = tx0 as unknown as postgres.Sql;
      const out: PaymentRequestRow[] = [];
      for (const { item, cand, r, cat } of prepared) {
        const m = cand.money!; const pm = cand.method!;
        const ins = await tx<Array<{ id: string }>>`
          insert into payment_request (task_id, campaign_id, campaign_name, client_id, client_name, influencer_handle, task_type,
            category, category_default, item_text, purpose_text, amount_krw, cost_currency, payout_currency, rate_krw_per_jpy,
            amount_net, fee, fee_amount, amount_gross, deadline_on, reference_url, proof, payment_method, requester_member_id, requester_name,
            influencer_id, category_option_id)
          values (${cand.taskId}, ${cand.campaignId}, ${cand.campaignName}, ${cand.clientId}, ${cand.clientName}, ${cand.influencerHandle}, ${cand.taskType},
            ${item.category}, ${cand.categoryDefault}, ${cand.itemText}, ${cand.purposeText}, ${m.amountKrw}, ${m.costCurrency}, ${m.payoutCurrency}, ${m.rateKrwPerJpy},
            ${m.amountNet}, ${m.fee ? tx.json(asJson(m.fee)) : null}, ${m.feeAmount}, ${m.amountGross}, ${item.deadlineOn}, ${item.referenceUrl || null}, ${cand.proof ? tx.json(asJson(cand.proof)) : null},
            ${tx.json(asJson(toMethodSnapshot(pm)))}, ${member.id}, ${member.name},
            ${r.influencer_id}, ${cat.id})
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
    if (e instanceof postgres.PostgresError && e.code === '23505') {
      const dup = await sql<Array<{ task_id: string; requester_name: string }>>`
        select task_id, requester_name from payment_request where status = 'requested' and task_id in ${sql(prepared.map((p) => p.cand.taskId))}`;
      if (!dup.length) {   // 활성 행을 못 찾음(경합이 이미 지나감 등) — 이유 없는 빈 배열 대신 건별 오류로
        throw new SettlementCreateError(prepared.map((p) => ({ taskId: p.cand.taskId, reason: '저장 중 충돌이 났어요 — 다시 확인해 주세요' })));
      }
      throw new SettlementCreateError(dup.map((d) => ({ taskId: d.task_id, reason: `이미 요청됐어요 (${d.requester_name})` })));
    }
    throw e;
  }
}

// 취소 한 경로 — 사람(요청 내역)과 그쪽(정산 프로덕트 '취소' 수신)이 같은 함수를 쓴다. 호출자가 for update 잠금·상태 판정을 끝낸 뒤 부른다.
async function cancelInTx(tx: postgres.Sql, id: string, by: { id: string | null; name: string }, reason: string): Promise<PaymentRequestRow> {
  await tx`
    update payment_request set status = 'cancelled', cancelled_at = now(), cancelled_by = ${by.id}, cancelled_by_name = ${by.name},
           cancel_reason = ${reason}, updated_at = now()
     where id = ${id}`;
  const [saved] = await tx<RRow[]>`${R_SELECT(tx)} where id = ${id}`;
  const row = toRequest(saved);
  const infId = row.influencerId ?? (await tx<Array<{ id: string }>>`select id from influencer where lower(handle) = lower(${row.influencerHandle})`)[0]?.id ?? null;
  if (infId) {
    const payload: PaymentLogPayload = { requestId: row.id, amountGross: row.amountGross, currency: row.payoutCurrency, taskType: row.taskType, reason };
    await insertAutoLog(tx, { influencerId: infId, eventType: 'payment_cancelled', draftId: null, draftTitle: null, payload, authorId: by.id });
  }
  return row;
}

export async function cancelRequest(
  sql: postgres.Sql, id: string, reason: string, member: { id: string; name: string },
): Promise<PaymentRequestRow | 'not-found' | 'already-cancelled' | 'paid-locked'> {
  if (!isUuidLike(id)) return 'not-found';
  return await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    const cur = await tx<RRow[]>`${R_SELECT(tx)} where id = ${id} for update`;
    if (!cur.length) return 'not-found';
    if (cur[0].status === 'cancelled') return 'already-cancelled';
    if (cur[0].external_status === 'paid') return 'paid-locked';   // §4-2 — 트리거가 마지막 벽, 여기서는 화면 문구용 판정
    return cancelInTx(tx, id, member, reason);
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
      -- 서울 자정 기준(다른 날짜 필터와 동일) — 세션 TimeZone에 따라 9시간 밀리지 않게
      ${f.from && isDateOnlyString(f.from) ? sql`and created_at >= (${f.from}::date)::timestamp at time zone 'Asia/Seoul'` : sql``}
      ${f.to && isDateOnlyString(f.to) ? sql`and created_at < ((${f.to}::date) + 1)::timestamp at time zone 'Asia/Seoul'` : sql``}
    order by created_at desc, id desc`;
  return rows.map(toRequest);
}

// ── 그쪽(정산 프로덕트) 연동(스펙 payment-api §5·§6) ──
// 커서 조회: (updated_at, id) 오름차순. 커서의 µs 정수를 정수 연산으로 timestamptz로 되돌려 인덱스를 그대로 탄다.
async function exportRows(sql: postgres.Sql, ids: string[], usById: Map<string, string>): Promise<ExportRow[]> {
  if (!ids.length) return [];
  const rows = await sql<RRow[]>`${R_SELECT(sql)} where id in ${sql(ids)}`;
  const memberIds = [...new Set(rows.map((r) => r.requester_member_id).filter((x): x is string => !!x))];
  const members = memberIds.length
    ? await sql<Array<{ id: string; email: string | null; slack_id: string | null }>>`select id, email, slack_id from member where id in ${sql(memberIds)}`
    : [];
  const mem = new Map(members.map((m) => [m.id, m]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is RRow => !!r).map((r) => {
    const m = r.requester_member_id ? mem.get(r.requester_member_id) : undefined;
    return { row: toRequest(r), updatedAtUs: usById.get(r.id) ?? '0', requester: { email: m?.email ?? null, slackId: m?.slack_id ?? null } };
  });
}
export async function listForExport(sql: postgres.Sql, cursor: Cursor | null, limit: number): Promise<ExportRow[]> {
  // 안전 지연 30초 — payment_request 쓰기 트랜잭션(createRequests 일괄 포함)이 이보다 오래 열려 있지 않는 한,
  // 커서가 아직 커밋되지 않은 행을 지나칠 수 없다(at-least-once 보장)
  const page = await sql<Array<{ id: string; us: string }>>`
    select id, (extract(epoch from updated_at) * 1000000)::bigint::text as us
      from payment_request
     where ${cursor
       ? sql`(updated_at, id) > (to_timestamp(${cursor.updatedAtUs}::bigint / 1000000) + (${cursor.updatedAtUs}::bigint % 1000000) * interval '1 microsecond', ${cursor.id}::uuid)`
       : sql`true`}
       and updated_at < now() - interval '30 seconds'
     order by updated_at, id
     limit ${limit}`;
  return exportRows(sql, page.map((p) => p.id), new Map(page.map((p) => [p.id, p.us])));
}
export async function getForExport(sql: postgres.Sql, id: string): Promise<ExportRow | null> {
  if (!isUuidLike(id)) return null;
  const page = await sql<Array<{ id: string; us: string }>>`
    select id, (extract(epoch from updated_at) * 1000000)::bigint::text as us from payment_request where id = ${id}`;
  const [row] = await exportRows(sql, page.map((p) => p.id), new Map(page.map((p) => [p.id, p.us])));
  return row ?? null;
}

export type ApplyResult =
  | { kind: 'applied' | 'stale'; row: PaymentRequestRow }
  | { kind: 'conflict'; code: 'request-cancelled' | 'paid-locked'; row: PaymentRequestRow }
  | 'not-found';
// §6-2 규칙표. 한 트랜잭션, for update 잠금. 순서: stale → 우리 취소 충돌 → paid 종점 → 적용.
export async function applyExternalStatus(sql: postgres.Sql, id: string, u: StatusUpdate): Promise<ApplyResult> {
  if (!isUuidLike(id)) return 'not-found';
  return await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    const cur = await tx<RRow[]>`${R_SELECT(tx)} where id = ${id} for update`;
    if (!cur.length) return 'not-found';
    const c = cur[0];
    if (c.external_updated_at && new Date(u.updatedAt).getTime() <= new Date(c.external_updated_at).getTime()) return { kind: 'stale', row: toRequest(c) };
    if (c.status === 'cancelled' && u.status !== 'cancelled') return { kind: 'conflict', code: 'request-cancelled', row: toRequest(c) };
    if (c.external_status === 'paid' && u.status !== 'paid') return { kind: 'conflict', code: 'paid-locked', row: toRequest(c) };
    if (u.status === 'cancelled' && c.status === 'requested') {
      await cancelInTx(tx, id, { id: null, name: '정산 프로덕트' }, u.note ?? '정산에서 취소');
    }
    await tx`
      update payment_request
         set external_status = ${u.status}, paid_amount_krw = ${u.paidAmountKrw}, paid_at = ${u.paidAt}, external_note = ${u.note},
             external_updated_at = ${u.updatedAt}, external_id = coalesce(${u.externalId}, external_id),
             sent_at = coalesce(sent_at, now()), updated_at = now()
       where id = ${id}`;
    const [saved] = await tx<RRow[]>`${R_SELECT(tx)} where id = ${id}`;
    const row = toRequest(saved);
    if (u.status === 'paid' && c.external_status !== 'paid') {
      const infId = row.influencerId ?? (await tx<Array<{ id: string }>>`select id from influencer where lower(handle) = lower(${row.influencerHandle})`)[0]?.id ?? null;
      if (infId) {
        const payload: PaymentLogPayload = { requestId: row.id, amountGross: row.amountGross, currency: row.payoutCurrency, taskType: row.taskType, paidAmountKrw: u.paidAmountKrw ?? undefined };
        await insertAutoLog(tx, { influencerId: infId, eventType: 'payment_paid', draftId: null, draftTitle: null, payload, authorId: null });
      }
    }
    return { kind: 'applied', row };
  });
}

// 배지 조회(settlementByTaskIds)는 campaignTaskStore에 있다(순환 방지: settlementStore→influencerStore→campaignStore) — 여기서는 re-export만
export { settlementByTaskIds, EXTERNAL_STATUSES, type SettlementBadgeStatus, type SettlementBadge, type ExternalStatus } from './campaignTaskStore.ts';
