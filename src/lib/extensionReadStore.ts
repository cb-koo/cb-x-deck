// 확장 API 조회 — 인물 확인·작업 목록·배지. 판정은 extensionTasks(순수), 여기는 사실 읽기만.
// 064(no_cost·version·visit_completed_at·visit_reservation·reservation_end·reservation_change)에 의존한다.
// 064가 없는 DB에서는 postgres가 42P01/42703을 던지고 extHandle이 SERVER_NOT_READY(503)로 바꾼다.
import postgres from 'postgres';
import { findByHandle, type InfluencerRow } from './influencerStore.ts';
import { settlementByTaskIds } from './campaignTaskStore.ts';
import { parseTaskCost } from './campaignCost.ts';
import { readClientSheet } from './reservationSheet.ts';
import type { TaskType } from './campaignJudgment.ts';
import type { DraftStatus } from './draftStatus.ts';
import type { DeadlineMode, StoredEndKind } from './reservationPolicy.ts';
import type { TaskFacts } from './extensionTasks.ts';

export interface PersonSummary {
  id: string; handle: string; name: string; xUserId: string | null;
  // 메모·단가의 독립 버전. 065 적용 전 스토어는 조회 호환용 1을 읽으며 새 저장 기능은 비활성이다.
  noteVersion: number | null; pricingVersion: number | null;
}
export type ResolveResult =
  | { status: 'matched'; person: PersonSummary }
  | { status: 'unregistered'; handle: string }
  | { status: 'identity_mismatch'; handle: string };

export const toPersonSummary = (i: InfluencerRow): PersonSummary => ({
  id: i.id, handle: i.handle, name: i.displayName ?? i.handle, xUserId: i.xUserId,
  noteVersion: i.noteVersion ?? null, pricingVersion: i.pricingVersion ?? null,
});

// 정규화한 핸들 정확 매칭(계획 §2). 관찰 숫자 ID는 비교 힌트일 뿐 — 저장된 ID와 둘 다 있고 다를 때만 불일치로 본다.
// 자동 보강(빈 x_user_id 채우기)은 하지 않는다(web0 findings '숫자 ID 보강' 미결정 → 보수안).
export function judgeIdentity(row: InfluencerRow | null, handle: string, observedXUserId?: string): ResolveResult {
  if (!row) return { status: 'unregistered', handle };
  if (observedXUserId && row.xUserId && row.xUserId !== observedXUserId) return { status: 'identity_mismatch', handle };
  return { status: 'matched', person: toPersonSummary(row) };
}

export async function resolvePerson(sql: postgres.Sql, handle: string, observedXUserId?: string): Promise<ResolveResult> {
  return judgeIdentity(await findByHandle(sql, handle), handle, observedXUserId);
}

export async function findPeopleByHandles(sql: postgres.Sql, handles: string[]): Promise<Map<string, { id: string; handle: string; xUserId: string | null }>> {
  if (!handles.length) return new Map();
  const rows = await sql<Array<{ id: string; handle: string; x_user_id: string | null }>>`
    select id, handle, x_user_id from influencer where lower(handle) in ${sql(handles.map((h) => h.toLowerCase()))}`;
  return new Map(rows.map((r) => [r.handle.toLowerCase(), { id: r.id, handle: r.handle, xUserId: r.x_user_id }]));
}

export async function findPeopleByXUserIds(sql: postgres.Sql, ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; handle: string; xUserId: string }>();
  const rows = await sql<Array<{ id: string; handle: string; x_user_id: string }>>`
    select id, handle, x_user_id from influencer where x_user_id in ${sql(ids)}`;
  // Ambiguous stored IDs must not attach one person's work to another conversation.
  return new Map(rows.filter((r) => rows.filter((other) => other.x_user_id === r.x_user_id).length === 1)
    .map((r) => [r.x_user_id, { id: r.id, handle: r.handle, xUserId: r.x_user_id }]));
}

type FactRow = {
  id: string; campaign_id: string; campaign_name: string; type: TaskType; influencer_handle: string | null;
  draft_status: DraftStatus | null; posted_at: string | null; post_url: string | null; removed_at: string | null; cancelled_at: string | null;
  scheduled_on: string | null; visit_on: string | null; cost: unknown; no_cost: boolean; version: number;
  has_consent: boolean;
  created_at: string;
  target_task_id: string | null; target_tweet_url: string | null; target_handle: string | null; target_post_url: string | null; target_campaign_name: string | null;
  visit_completed_at: string | null; settled_elsewhere_at: string | null;
  r_id: string | null; r_confirmed: boolean | null; r_sheet: string | null; r_deadline_mode: DeadlineMode | null;
  end_kind: StoredEndKind | null; request_count: number;
};

// 담당 핸들(대소문자 무시) 기준으로 그 사람의 모든 작업 사실을 한 번에 읽는다. 목록·배지가 같은 함수를 쓴다.
export async function loadTaskFacts(sql: postgres.Sql, handles: string[]): Promise<TaskFacts[]> {
  if (!handles.length) return [];
  const rows = await sql<FactRow[]>`
    select t.target_task_id, t.target_tweet_url, tg.influencer_handle as target_handle, tg.post_url as target_post_url, tc.name as target_campaign_name,
           t.id, t.created_at::text as created_at, t.campaign_id, c.name as campaign_name, t.type, t.influencer_handle,
           case when t.draft_id is null then null else d.status end as draft_status,
           to_char(t.posted_at, 'YYYY-MM-DD') as posted_at, t.post_url, to_char(t.removed_at, 'YYYY-MM-DD') as removed_at,
           to_char(t.cancelled_at, 'YYYY-MM-DD') as cancelled_at,
           to_char(t.scheduled_on, 'YYYY-MM-DD') as scheduled_on, to_char(t.visit_on, 'YYYY-MM-DD') as visit_on,
           t.cost, t.no_cost, t.version, t.visit_completed_at::text as visit_completed_at,
           to_char(t.settled_elsewhere_at, 'YYYY-MM-DD') as settled_elsewhere_at,
           (t.agreement is not null) as has_consent,
           r.id as r_id, (r.confirmed_at is not null) as r_confirmed, r.sheet_text as r_sheet, r.deadline_mode as r_deadline_mode,
           e.kind as end_kind,
           coalesce((select count(*)::int from reservation_change rc
                      where rc.reservation_id = r.id and rc.reason = 'customer_request' and rc.event <> 'stop'), 0) as request_count
      from campaign_task t
      join campaign c on c.id = t.campaign_id
      left join draft d on d.id = t.draft_id
      left join campaign_task tg on tg.id = t.target_task_id
      left join campaign tc on tc.id = tg.campaign_id
      left join visit_reservation r on r.task_id = t.id
      left join reservation_end e on e.task_id = t.id and e.revoked_at is null
     where lower(t.influencer_handle) in ${sql(handles.map((h) => h.toLowerCase()))}`;
  const settlements = await settlementByTaskIds(sql, rows.map((r) => r.id));
  return rows.map((r): TaskFacts => {
    const cost = parseTaskCost(r.cost ?? null);
    const s = settlements.get(r.id);
    return {
      id: r.id, createdAt: r.created_at ?? null, campaignId: r.campaign_id, campaignName: r.campaign_name, type: r.type,
      influencerHandle: r.influencer_handle, draftStatus: r.draft_status,
      postedAt: r.posted_at, postUrl: r.post_url, removedAt: r.removed_at, cancelledAt: r.cancelled_at,
      scheduledOn: r.scheduled_on, visitOn: r.visit_on,
      target: r.target_task_id ? { label: [r.target_handle ? `@${r.target_handle}` : "담당자 미등록", r.target_campaign_name].filter(Boolean).join(" · "), url: r.target_post_url }
        : r.target_tweet_url ? { label: r.target_tweet_url, url: r.target_tweet_url } : null,
      cost: cost.ok ? cost.value : null, noCost: r.no_cost, version: r.version,
      hasConsent: r.has_consent,
      visitCompletedAt: r.visit_completed_at,
      settlement: s ? { status: s.status, externalStatus: s.externalStatus } : null,
      settledElsewhereAt: r.settled_elsewhere_at,
      endKind: r.end_kind,
      reservation: r.r_id ? {
        confirmed: !!r.r_confirmed,
        visitAt: readClientSheet(r.r_sheet ?? '').preferred,
        deadlineMode: r.r_deadline_mode ?? 'default',
      } : null,
      requestCount: r.request_count,
    };
  });
}

export async function findTaskHandle(sql: postgres.Sql, taskId: string): Promise<{ handle: string | null; personId: string | null } | null> {
  const rows = await sql<Array<{ handle: string | null; person_id: string | null }>>`
    select t.influencer_handle as handle, i.id as person_id
      from campaign_task t left join influencer i on lower(i.handle) = lower(t.influencer_handle)
     where t.id = ${taskId}`;
  return rows.length ? { handle: rows[0].handle, personId: rows[0].person_id } : null;
}
