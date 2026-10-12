// 정산 요청 자동 전송 저장소(스펙 2026-10-12 §5) — 정산 요청 대기 목록·한 건 보내기·주간 스윕·멈춤·보낸 뒤 내려감 확인.
// 판정은 settlementAuto(순수), 후보 계산·insert는 settlementStore를 그대로 쓴다(사람이 보내던 길과 같은 검증·같은 스냅샷).
import postgres from 'postgres';
import { kstToday } from './datetime.ts';
import { isUuidLike } from './uuid.ts';
import { parseTaskCost } from './campaignCost.ts';
import { categoryBySendAs } from './settlementSettings.ts';
import type { SettlementCandidate, ReadinessIssue } from './settlementCalc.ts';
import { CANDIDATE_SQL, rowToCandidate, insertRequestInTx, getSettlementSettings, type CandRow, type PaymentRequestRow } from './settlementStore.ts';
import { pendingGroup, blockingIssues, confirmedInstant, isDue, sendAtFor, nextMondaySeven, lastMondaySeven, type PendingGroup, type PendingState } from './settlementAuto.ts';
import { exportIncludesTestFixtures, TEST_FIXTURE_HANDLE_PG } from './settlementTestFixture.ts';

import { AUTO_REQUESTER_FALLBACK, HOLD_REASON_MAX } from './settlementAuto.ts';
export { AUTO_REQUESTER_FALLBACK, HOLD_REASON_MAX };

export interface PendingRow {
  cand: SettlementCandidate;
  group: PendingGroup;
  confirmedAt: string;          // 게시 확인 시각(070 이전 행은 게시일 서울 00:00)
  sendAt: string | null;        // waiting: 보내는 때. null = 이번 회차 대상(곧 나감)
  blocking: ReadinessIssue[];   // 사람이 [보내기]를 눌러도 막히는 이유(내림·안 보임 제외)
  state: PendingState;
}
export interface PendingSummary {
  needsAction: number;          // 확인이 필요해요 + 고쳐야 보내져요
  waiting: number;
  stopped: number;
  nextSendAt: string;           // 다음 월요일 07:00
  lastRunAt: string | null;     // 자동 전송이 마지막으로 확인한 시각(예약 실행이 없으면 null)
  lastRunAgeMin: number | null; // 그게 몇 분 전인지 — 서버 시계로 계산(화면이 렌더 중에 시계를 읽지 않게)
  sentAutoToday: number;        // 오늘(서울) 자동으로 보낸 요청 수
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
function stateOf(r: CandRow): PendingState {
  return {
    hold: r.settle_hold_at ? { at: iso(r.settle_hold_at)!, byName: r.settle_hold_by_name, reason: r.settle_hold_reason ?? '' } : null,
    cancelled: r.last_cancel_at || r.last_cancel_by_name ? { at: iso(r.last_cancel_at), byName: r.last_cancel_by_name, reason: r.last_cancel_reason } : null,
  };
}
// 분류는 설정 기본값만 — "요청자의 마지막 인용RT 분류"를 넘기지 않는다(요청자마다 결과가 달라지지 않게, 스펙 §2-5)
function toRow(r: CandRow, settings: Awaited<ReturnType<typeof getSettlementSettings>>, now: Date): PendingRow | null {
  const cost = parseTaskCost(r.cost ?? null);
  if (!cost.ok || cost.value === null) return null;
  const cand = rowToCandidate(r, cost.value, settings, null, kstToday(() => now.getTime()));
  const state = stateOf(r);
  const confirmed = confirmedInstant(iso(r.posted_confirmed_at), r.posted_at);
  const group = pendingGroup(cand, state);
  const sendAt = group === 'waiting' ? sendAtFor(confirmed, now) : null;
  return { cand, group, confirmedAt: confirmed.toISOString(), sendAt: sendAt ? sendAt.toISOString() : null, blocking: blockingIssues(cand), state };
}

export async function listPending(sql: postgres.Sql, now: Date = new Date(), campaignId?: string): Promise<{ rows: PendingRow[]; summary: PendingSummary }> {
  const settings = await getSettlementSettings(sql);
  const camp = campaignId && isUuidLike(campaignId) ? sql`and t.campaign_id = ${campaignId}` : sql``;
  const [rows, run, sent] = await Promise.all([
    sql<CandRow[]>`${CANDIDATE_SQL(sql)} ${camp} order by t.posted_at asc, t.created_at asc, t.id asc`,
    sql<Array<{ at: Date | null }>>`select max(finished_at) as at from settlement_auto_run`,
    sql<Array<{ n: string }>>`select count(*)::text as n from payment_request
      where created_via = 'auto' and (created_at at time zone 'Asia/Seoul')::date = ${kstToday(() => now.getTime())}::date`,
  ]);
  const out = rows.map((r) => toRow(r, settings, now)).filter((x): x is PendingRow => x !== null);
  return {
    rows: out,
    summary: {
      needsAction: out.filter((x) => x.group === 'attention' || x.group === 'blocked').length,
      waiting: out.filter((x) => x.group === 'waiting').length,
      stopped: out.filter((x) => x.group === 'stopped').length,
      nextSendAt: nextMondaySeven(now).toISOString(),
      lastRunAt: iso(run[0]?.at ?? null),
      lastRunAgeMin: run[0]?.at ? Math.floor((now.getTime() - new Date(run[0].at).getTime()) / 60_000) : null,
      sentAutoToday: Number(sent[0]?.n ?? 0),
    },
  };
}

export type SendFailure = 'not-candidate' | 'already' | 'blocked' | 'not-due' | 'stopped' | 'attention' | 'no-category';
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
      const row = toRow(r, settings, now);
      if (!row) return { ok: false as const, code: 'blocked' as const, reason: '비용 형식이 올바르지 않아요' };
      if (opts.via === 'auto') {
        if (row.group !== 'waiting') return { ok: false as const, code: (row.group === 'stopped' ? 'stopped' : row.group === 'attention' ? 'attention' : 'blocked') as SendFailure, reason: row.group };
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
  const fixtures = exportIncludesTestFixtures() ? sql`` : sql`and t.influencer_handle !~ ${TEST_FIXTURE_HANDLE_PG}`;
  // campaignIds는 테스트 전용 좁힘 — 연습용 DB의 다른 데이터(스테이징 QA)를 건드리지 않게
  const only = opts.campaignIds ? sql`and t.campaign_id in ${sql(opts.campaignIds.length ? opts.campaignIds : ['00000000-0000-0000-0000-000000000000'])}` : sql``;
  const due = await sql<Array<{ id: string }>>`
    select t.id from campaign_task t
     where t.cancelled_at is null and t.settled_elsewhere_at is null
       and t.posted_at is not null and t.cost is not null and t.influencer_handle is not null
       and t.settle_hold_at is null
       and coalesce(t.posted_confirmed_at, (t.posted_at::timestamp at time zone 'Asia/Seoul')) < ${lastMondaySeven(now)}
       and not exists (select 1 from payment_request r where r.task_id = t.id)   -- 활성 요청도, 취소 이력도 없는 것만
       ${fixtures} ${only}
     order by t.posted_at, t.created_at, t.id
     limit ${limit}`;
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
  const rows = await sql`update campaign_task set settle_hold_at = now(), settle_hold_by = ${member.id}, settle_hold_by_name = ${member.name},
      settle_hold_reason = ${reason.trim().slice(0, HOLD_REASON_MAX)}
    where id = ${taskId} and posted_at is not null and cancelled_at is null
      and not exists (select 1 from payment_request r where r.task_id = campaign_task.id and r.status = 'requested')
    returning id`;
  return rows.length > 0;
}

// 보낸 뒤 내려감 [그대로 두기] — updated_at을 건드리지 않는다(정산팀 폴링에 흐르지 않게, 스펙 §3)
export async function ackRemoval(sql: postgres.Sql, requestId: string, member: { name: string }): Promise<boolean> {
  if (!isUuidLike(requestId)) return false;
  const rows = await sql`update payment_request set removal_ack_at = now(), removal_ack_by_name = ${member.name}
    where id = ${requestId} and status = 'requested' and removal_ack_at is null returning id`;
  return rows.length > 0;
}
