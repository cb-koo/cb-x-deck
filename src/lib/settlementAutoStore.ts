// 정산 요청 자동 전송 저장소(스펙 2026-10-12 §5) — 정산 요청 대기 목록·한 건 보내기·주간 스윕·멈춤·보낸 뒤 내려감 확인.
// 판정은 settlementAuto(순수), 후보 계산·insert는 settlementStore를 그대로 쓴다(사람이 보내던 길과 같은 검증·같은 스냅샷).
import postgres from 'postgres';
import { kstToday } from './datetime.ts';
import { isUuidLike } from './uuid.ts';
import { parseTaskCost } from './campaignCost.ts';
import { categoryBySendAs, autoSendEnabled, type AutoSendSwitch } from './settlementSettings.ts';
import type { SettlementCandidate, ReadinessIssue } from './settlementCalc.ts';
import type { TaskType } from './campaignJudgment.ts';
import type { UnsendableReason, UnsendableRow } from './settlementAuto.ts';
import { CANDIDATE_SQL, rowToCandidate, insertRequestInTx, getSettlementSettings, saveSettlementSettings, type CandRow, type PaymentRequestRow } from './settlementStore.ts';
import { pendingGroup, blockingIssues, confirmedInstant, isDue, sendAtFor, nextSendSlot, togetherFor, type PendingGroup, type PendingState, type Together, type WeekSibling } from './settlementAuto.ts';
import { exportIncludesTestFixtures, TEST_FIXTURE_HANDLE_PG } from './settlementTestFixture.ts';

import { AUTO_REQUESTER_FALLBACK, HOLD_REASON_MAX } from './settlementAuto.ts';
export { AUTO_REQUESTER_FALLBACK, HOLD_REASON_MAX };
export type { UnsendableReason, UnsendableRow };

export interface PendingRow {
  cand: SettlementCandidate;
  group: PendingGroup;
  confirmedAt: string;          // 게시 확인 시각(071 이전 행은 게시일 서울 00:00)
  sendAt: string | null;        // waiting: 보내는 때. null = 이번 회차 대상(곧 나감)
  blocking: ReadinessIssue[];   // 사람이 [보내기]를 눌러도 막히는 이유(내림·안 보임 제외)
  state: PendingState;
  together: Together | null;    // 같은 인플·같은 주 작업 묶음(ISSUE-010) — 남은 작업이 있으면 group 'together'
}
export interface PendingSummary {
  needsAction: number;          // 확인이 필요해요 + 고쳐야 보내져요(정산에서 빠진 작업 포함)
  waiting: number;
  together: number;             // 같은 주 작업 대기 — 예정일이 지난 남은 작업이 있는 건은 needsAction에도 센다(koo: 알려주는 것으로)
  stopped: number;
  nextSendAt: string;           // 다음 전송 회차(월요일 07·12·15시)
  lastRunAt: string | null;     // 자동 전송이 마지막으로 확인한 시각(예약 실행이 없으면 null)
  lastRunAgeMin: number | null; // 그게 몇 분 전인지 — 서버 시계로 계산(화면이 렌더 중에 시계를 읽지 않게)
  sentAutoToday: number;        // 오늘(서울) 자동으로 보낸 요청 수
  autoSendEnabled: boolean;     // 정산 설정의 자동 전송 스위치(없으면 켜짐)
  autoSendSwitch: AutoSendSwitch | null;   // 마지막으로 바꾼 사람·시각(한 번도 안 바꿨으면 null)
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
function stateOf(r: CandRow): PendingState {
  return {
    hold: r.settle_hold_at ? { at: iso(r.settle_hold_at)!, byName: r.settle_hold_by_name, reason: r.settle_hold_reason ?? '' } : null,
    cancelled: r.last_cancel_at || r.last_cancel_by_name ? { at: iso(r.last_cancel_at), byName: r.last_cancel_by_name, reason: r.last_cancel_reason } : null,
  };
}
// 같은 주 함께 보내기(ISSUE-010)의 재료 — 후보 인플들의 작업 전부(취소·다른 곳에서 정산함 제외, 마감한 캠페인의 미게시 작업 제외).
// 주 판정은 순수 함수(togetherFor)가 한다. 비용 없음 작업도 센다 — 업로드를 작업으로 나눠 금액을 한쪽에만 둘 수 있게.
type SibRow = { id: string; handle: string; type: TaskType; campaign_name: string; posted_at: string | null; scheduled_on: string | null; visit_on: string | null; starts_on: string; posted_confirmed_at: Date | null; same_visit_of: string | null };
async function loadWeekSiblings(sql: postgres.Sql, handles: string[]): Promise<WeekSibling[]> {
  const hs = [...new Set(handles.map((h) => h.toLowerCase()))];
  if (!hs.length) return [];
  const rows = await sql<SibRow[]>`
    select t.id, t.influencer_handle as handle, t.type, c.name as campaign_name,
           to_char(t.posted_at, 'YYYY-MM-DD') as posted_at, to_char(t.scheduled_on, 'YYYY-MM-DD') as scheduled_on,
           to_char(t.visit_on, 'YYYY-MM-DD') as visit_on, to_char(c.starts_on, 'YYYY-MM-DD') as starts_on, t.posted_confirmed_at, t.same_visit_of
      from campaign_task t join campaign c on c.id = t.campaign_id
     where lower(t.influencer_handle) in ${sql(hs)}
       and t.cancelled_at is null and t.settled_elsewhere_at is null
       and not (c.closed_at is not null and t.posted_at is null)`;
  return rows.map((r) => ({ taskId: r.id, handle: r.handle, taskType: r.type, campaignName: r.campaign_name,
    postedAt: r.posted_at, scheduledOn: r.scheduled_on, visitOn: r.visit_on, campaignStartsOn: r.starts_on, sameVisitOf: r.same_visit_of,
    confirmedAt: r.posted_at ? confirmedInstant(iso(r.posted_confirmed_at), r.posted_at).toISOString() : null }));
}

// 분류는 설정 기본값만 — "요청자의 마지막 인용RT 분류"를 넘기지 않는다(요청자마다 결과가 달라지지 않게, 스펙 §2-5)
function toRow(r: CandRow, settings: Awaited<ReturnType<typeof getSettlementSettings>>, now: Date, siblings: WeekSibling[]): PendingRow | null {
  const cost = parseTaskCost(r.cost ?? null);
  if (!cost.ok || cost.value === null) return null;
  const today = kstToday(() => now.getTime());
  const cand = rowToCandidate(r, cost.value, settings, null, today);
  const state = stateOf(r);
  const confirmed = confirmedInstant(iso(r.posted_confirmed_at), r.posted_at);
  const together = togetherFor({ taskId: r.id, handle: r.influencer_handle, postedAt: r.posted_at }, siblings, today);
  const group = pendingGroup(cand, state, together);
  // 같은 주 묶음은 가장 늦게 확인된 작업에 맞춰 함께 나간다 — 마지막 작업이 월요일 07:00 직후에 확인돼도 먼저 끝난 작업만
  // 그날 따로 나가지 않게(koo 11-05: 그 인플의 작업을 동일한 시점에). confirmedAt은 이 '보내는 기준 시각'이다.
  const last = together?.lastConfirmedAt ? new Date(together.lastConfirmedAt) : null;
  const due = last && last.getTime() > confirmed.getTime() ? last : confirmed;
  const sendAt = group === 'waiting' ? sendAtFor(due, now) : null;
  return { cand, group, confirmedAt: due.toISOString(), sendAt: sendAt ? sendAt.toISOString() : null, blocking: blockingIssues(cand), state, together };
}

// 후보 조건(CANDIDATE_BASE)에서 비용·인플루언서만 뒤집은 것 — 나머지(취소·다른 곳 정산·비용 없음·활성 요청 없음)는 같다.
// 비용 칸이 있지만 읽을 수 없는 값이면 toRow가 후보에서 떨어뜨린다 — 그것도 '작업 비용 없음'으로 여기 보인다(listPending).
type UnsendableDbRow = { id: string; type: TaskType; influencer_handle: string | null; posted_at: string; campaign_id: string; campaign_name: string; client_name: string | null; no_cost: boolean };
function unsendableOf(r: UnsendableDbRow): UnsendableRow {
  const reasons: UnsendableReason[] = [];
  if (r.no_cost) reasons.push('no-cost');
  if (!r.influencer_handle) reasons.push('no-influencer');
  return { taskId: r.id, campaignId: r.campaign_id, campaignName: r.campaign_name, clientName: r.client_name ?? '',
           influencerHandle: r.influencer_handle, taskType: r.type, postedAt: r.posted_at, reasons };
}

export async function listPending(sql: postgres.Sql, now: Date = new Date(), campaignId?: string): Promise<{ rows: PendingRow[]; unsendable: UnsendableRow[]; summary: PendingSummary }> {
  const settings = await getSettlementSettings(sql);
  const camp = campaignId && isUuidLike(campaignId) ? sql`and t.campaign_id = ${campaignId}` : sql``;
  const [rows, missing, run, sent] = await Promise.all([
    sql<CandRow[]>`${CANDIDATE_SQL(sql)} ${camp} order by t.posted_at asc, t.created_at asc, t.id asc`,
    sql<UnsendableDbRow[]>`
      select t.id, t.type, t.influencer_handle, to_char(t.posted_at, 'YYYY-MM-DD') as posted_at,
             c.id as campaign_id, c.name as campaign_name, c.client_name, (t.cost is null) as no_cost
        from campaign_task t join campaign c on c.id = t.campaign_id
       where t.cancelled_at is null and t.settled_elsewhere_at is null and t.posted_at is not null
         and (t.cost is null or t.influencer_handle is null)
         and not coalesce((to_jsonb(t)->>'no_cost')::boolean, false)
         and not exists (select 1 from payment_request r where r.task_id = t.id and r.status = 'requested')
         ${camp}
       order by t.posted_at asc, t.created_at asc, t.id asc`,
    sql<Array<{ at: Date | null }>>`select max(finished_at) as at from settlement_auto_run`,
    sql<Array<{ n: string }>>`select count(*)::text as n from payment_request
      where created_via = 'auto' and (created_at at time zone 'Asia/Seoul')::date = ${kstToday(() => now.getTime())}::date`,
  ]);
  const out: PendingRow[] = [];
  const unsendable = missing.map(unsendableOf);
  const siblings = await loadWeekSiblings(sql, rows.map((r) => r.influencer_handle));
  for (const r of rows) {
    const row = toRow(r, settings, now, siblings);
    if (row) out.push(row);
    else unsendable.push(unsendableOf({ id: r.id, type: r.type, influencer_handle: r.influencer_handle, posted_at: r.posted_at,
      campaign_id: r.campaign_id, campaign_name: r.campaign_name, client_name: r.client_name, no_cost: true }));
  }
  return {
    rows: out,
    unsendable,
    summary: {
      needsAction: out.filter((x) => x.group === 'attention' || x.group === 'blocked'
        || (x.group === 'together' && x.together!.pending.some((p) => p.overdue))).length + unsendable.length,
      waiting: out.filter((x) => x.group === 'waiting').length,
      together: out.filter((x) => x.group === 'together').length,
      stopped: out.filter((x) => x.group === 'stopped').length,
      nextSendAt: nextSendSlot(now).toISOString(),
      lastRunAt: iso(run[0]?.at ?? null),
      lastRunAgeMin: run[0]?.at ? Math.floor((now.getTime() - new Date(run[0].at).getTime()) / 60_000) : null,
      sentAutoToday: Number(sent[0]?.n ?? 0),
      autoSendEnabled: autoSendEnabled(settings),
      autoSendSwitch: settings.autoSend ?? null,
    },
  };
}

export type SendFailure = 'not-candidate' | 'already' | 'blocked' | 'not-due' | 'stopped' | 'attention' | 'together' | 'no-category';
export type SendResult = { ok: true; request: PaymentRequestRow } | { ok: false; code: SendFailure; reason: string };

// 한 건 = 한 트랜잭션(스펙 §5) — 작업 행을 잠그고 후보를 다시 계산해서 보낸다. 자동 스윕과 [지금 보내기]가 동시에 와도
// 잠금 뒤 두 번째는 "이미 나감"을 본다(마지막 벽은 활성 요청 유니크 인덱스, 23505).
// via 'auto': 기다림 묶음 + 이번 회차 대상만, 요청자 = 작업 만든 사람. via 'manual': 확인 필요·멈춤도 보낼 수 있고 요청자 = 누른 사람.
export async function sendTask(sql: postgres.Sql, taskId: string, opts: { via: 'auto' | 'manual'; member?: { id: string; name: string }; now?: Date }): Promise<SendResult> {
  if (!isUuidLike(taskId)) return { ok: false, code: 'not-candidate', reason: '작업을 찾을 수 없어요' };
  const now = opts.now ?? new Date();
  const settings = await getSettlementSettings(sql);
  try {
    return await sql.begin(async (tx0) => {
      const tx = tx0 as unknown as postgres.Sql;
      await tx`select id from campaign_task where id = ${taskId} for update`;
      const rows = await tx<CandRow[]>`${CANDIDATE_SQL(tx)} and t.id = ${taskId}`;
      if (!rows.length) {
        const active = await tx`select 1 from payment_request where task_id = ${taskId} and status = 'requested'`;
        return active.length
          ? { ok: false as const, code: 'already' as const, reason: '이미 정산팀으로 보냈어요' }
          : { ok: false as const, code: 'not-candidate' as const, reason: '지금은 보낼 수 없는 작업이에요 — 목록을 다시 확인해 주세요' };
      }
      const r = rows[0];
      const row = toRow(r, settings, now, await loadWeekSiblings(tx, [r.influencer_handle]));
      if (!row) return { ok: false as const, code: 'blocked' as const, reason: '비용 형식이 올바르지 않아요' };
      if (opts.via === 'auto') {
        if (row.group !== 'waiting') return { ok: false as const, code: (row.group === 'stopped' ? 'stopped' : row.group === 'attention' ? 'attention' : row.group === 'together' ? 'together' : 'blocked') as SendFailure, reason: row.group };
        if (!isDue(new Date(row.confirmedAt), now)) return { ok: false as const, code: 'not-due' as const, reason: '아직 보낼 때가 아니에요' };
      }
      if (row.blocking.length) return { ok: false as const, code: 'blocked' as const, reason: row.blocking.map((i) => i.text).join(' · ') };
      const cat = categoryBySendAs(settings, row.cand.categoryDefault);
      if (!cat || cat.hidden || !row.cand.money || !row.cand.method) return { ok: false as const, code: 'no-category' as const, reason: '이 유형의 기본 분류가 없어요 — 정산 설정에서 정해 주세요' };
      const requester = opts.via === 'manual' && opts.member
        ? { id: opts.member.id, name: opts.member.name }
        : { id: r.auto_requester_id, name: r.auto_requester_name ?? AUTO_REQUESTER_FALLBACK };
      const request = await insertRequestInTx(tx, {
        cand: row.cand, r, catId: cat.id, category: cat.sendAs, deadlineOn: row.cand.deadlineDefault, referenceUrl: row.cand.referenceDefault,
        requester, via: opts.via,
      });
      // 멈춤은 보내는 순간 풀린다 — 다시 취소되면 '취소 이력'이 멈춘 작업으로 되돌린다
      if (r.settle_hold_at) await tx`update campaign_task set settle_hold_at = null, settle_hold_by = null, settle_hold_by_name = null, settle_hold_reason = null where id = ${taskId}`;
      return { ok: true as const, request };
    });
  } catch (e) {
    if (e instanceof postgres.PostgresError && e.code === '23505') return { ok: false, code: 'already', reason: '이미 정산팀으로 보냈어요' };
    throw e;
  }
}

// 주간 스윕(스펙 §2-2) — 예약 실행이 5분마다 부른다. 이번 주 월요일 07:00 전에 확인됐고 멈춤·취소 이력이 없는 후보를 한 건씩 보낸다.
// 막힌 건은 실패가 아니다(고치면 다음 실행이 보낸다). 예상 못 한 오류만 failed로 세고 다음 건으로 간다.
export async function runAutoSend(sql: postgres.Sql, now: Date = new Date(), opts: { limit?: number; deadlineMs?: number; campaignIds?: string[] } = {}): Promise<{ runId: string; sent: number; skipped: number; failed: number }> {
  const limit = opts.limit ?? 200;
  const started = Date.now();
  const [run] = await sql<Array<{ id: string }>>`insert into settlement_auto_run (started_at) values (${now}) returning id`;
  // 스위치가 꺼져 있으면 아무것도 보내지 않는다 — 실행 기록은 남긴다(화면의 '마지막 확인'이 살아 있어야 멈춤과 꺼짐을 가른다)
  const switchSettings = await getSettlementSettings(sql);
  if (!autoSendEnabled(switchSettings)) {
    await sql`update settlement_auto_run set finished_at = now(), detail = ${sql.json({ disabled: true })} where id = ${run.id}`;
    await sql`delete from settlement_auto_run where started_at < now() - interval '7 days'`;
    return { runId: run.id, sent: 0, skipped: 0, failed: 0 };
  }
  const fixtures = exportIncludesTestFixtures() ? sql`` : sql`and t.influencer_handle !~ ${TEST_FIXTURE_HANDLE_PG}`;
  // campaignIds는 테스트 전용 좁힘 — 연습용 DB의 다른 데이터(스테이징 QA)를 건드리지 않게
  const only = opts.campaignIds ? sql`and t.campaign_id in ${sql(opts.campaignIds.length ? opts.campaignIds : ['00000000-0000-0000-0000-000000000000'])}` : sql``;
  // 후보 전체를 한 번에 분류한 뒤 '기다림 + 이번 회차'만 보낸다 — 막힌·확인 필요 작업이 앞자리를 차지해
  // 뒤의 작업이 영영 안 나가는 일이 없게(리뷰 10-12). 취소 이력·멈춤은 분류가 '멈춘 작업'으로 뺀다.
  const settings = switchSettings;
  const rows = await sql<CandRow[]>`${CANDIDATE_SQL(sql)} ${fixtures} ${only} order by t.posted_at asc, t.created_at asc, t.id asc`;
  const siblings = await loadWeekSiblings(sql, rows.map((r) => r.influencer_handle));
  const due = rows.map((r) => toRow(r, settings, now, siblings))
    .filter((x): x is PendingRow => x !== null && x.group === 'waiting' && isDue(new Date(x.confirmedAt), now))
    .slice(0, limit)
    .map((x) => ({ id: x.cand.taskId }));
  let sent = 0, skipped = 0, failed = 0;
  const errors: Array<{ taskId: string; error: string }> = [];
  for (const d of due) {
    if (opts.deadlineMs !== undefined && Date.now() - started > opts.deadlineMs) break;
    try {
      const r = await sendTask(sql, d.id, { via: 'auto', now });
      if (r.ok) sent++; else skipped++;
    } catch (e) {
      failed++;
      errors.push({ taskId: d.id, error: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    }
  }
  await sql`update settlement_auto_run set finished_at = now(), sent = ${sent}, failed = ${failed},
    detail = ${errors.length ? sql.json(errors as unknown as postgres.JSONValue) : null} where id = ${run.id}`;
  await sql`delete from settlement_auto_run where started_at < now() - interval '7 days'`;
  return { runId: run.id, sent, skipped, failed };
}

// [보내지 않기] — 게시 확인된 작업에만. 이미 보낸 작업은 요청 내역에서 취소한다.
export async function holdTask(sql: postgres.Sql, taskId: string, member: { id: string; name: string }, reason: string): Promise<boolean> {
  if (!isUuidLike(taskId)) return false;
  // sendTask와 같은 작업 행 잠금 — 동시에 보내지면 보낸 뒤에 멈춤이 남지 않게(리뷰 10-12)
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    await tx`select id from campaign_task where id = ${taskId} for update`;
    const rows = await tx`update campaign_task set settle_hold_at = now(), settle_hold_by = ${member.id}, settle_hold_by_name = ${member.name},
        settle_hold_reason = ${reason.trim().slice(0, HOLD_REASON_MAX)}
      where id = ${taskId} and posted_at is not null and cancelled_at is null
        and not exists (select 1 from payment_request r where r.task_id = campaign_task.id and r.status = 'requested')
      returning id`;
    return rows.length > 0;
  });
}

// 보낸 뒤 내려감 [그대로 두기] — updated_at을 건드리지 않는다(정산팀 폴링에 흐르지 않게, 스펙 §3)
export async function ackRemoval(sql: postgres.Sql, requestId: string, member: { name: string }): Promise<boolean> {
  if (!isUuidLike(requestId)) return false;
  const rows = await sql`update payment_request set removal_ack_at = now(), removal_ack_by_name = ${member.name}
    where id = ${requestId} and status = 'requested' and removal_ack_at is null returning id`;
  return rows.length > 0;
}

// 자동 전송 스위치(2026-10-13) — 지금 설정을 읽어 스위치만 바꿔 새 버전으로 저장한다(분류 편집 중인 화면 값과 섞이지 않게 서버에서 합친다)
export async function setAutoSend(sql: postgres.Sql, enabled: boolean, member: { id: string; name: string }): Promise<AutoSendSwitch> {
  const cur = await getSettlementSettings(sql);
  const sw: AutoSendSwitch = { enabled, changedAt: new Date().toISOString(), changedByName: member.name };
  await saveSettlementSettings(sql, { ...cur, autoSend: sw }, member.id);
  return sw;
}
