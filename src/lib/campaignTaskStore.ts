import postgres from 'postgres';
import type { DraftStatus } from './draftStatus.ts';
import { parseTaskCost, type TaskCost } from './campaignCost.ts';
import { TARGETABLE_TYPES, type TaskType } from './campaignJudgment.ts';
import { tweetPermalink } from './tweetLink.ts';
import { isUuidLike } from './uuid.ts';
import { taskProofOf, type TaskProof } from './taskProofGuard.ts';
import type { CancelReason } from './campaignTaskInput.ts';

// 작업(campaign_task) 저장소 — 스펙 2026-08-28 §2-1. 판정(단계·밀림·요약)은 campaignJudgment가, 여기는 행의 읽기·쓰기만.
// 핸들은 표기 보존·비교는 lower(). 날짜는 date 컬럼 + to_char 왕복(시간대 시프트 방지, DateOnly 관례).
export interface TaskRow {
  id: string; campaignId: string; influencerHandle: string | null; type: TaskType;
  draftId: string | null; targetTaskId: string | null; targetTweetUrl: string | null;
  postUrl: string | null; postedAt: string | null; postedSource: 'auto' | 'manual' | null;
  removedAt: string | null; removedReason: string;
  scheduledOn: string | null; visitOn: string | null; cost: TaskCost | null; note: string;
  proof: TaskProof | null;   // RT 증빙 스크린샷 1장(스펙 2026-08-31 §4-2). RT 아닌 유형은 늘 null
  // 취소(055, ADR 0002) — 삭제가 아니라 상태. cancelledDraft*는 되돌리기용 스냅샷(떼어낸 원고 id·제목)
  cancelledAt: string | null; cancelReason: CancelReason | null; cancelNote: string;
  cancelledDraftId: string | null; cancelledDraftTitle: string | null;
  createdAt: string; updatedAt: string;
  draftStatus: DraftStatus | null; draftLabel: string | null;   // 붙은 원고 요약 — 표의 '원고' 열
  // 대상 작업 요약(§4-1 'RT/인용RT 대상' 열) — 다른 캠페인이면 campaignName으로 구분해 보인다
  // cancelledAt은 대상 작업 자체의 취소 여부(R19) — 이 작업(RT/인용RT)이 취소된 게 아니라 가리키는 대상이 취소됐음을 안다.
  target: { taskId: string; type: TaskType; influencerHandle: string | null; campaignId: string; campaignName: string; postUrl: string | null; cancelledAt: string | null } | null;
}
export interface TaskCreateInput {
  type: TaskType; targetTaskId: string | null; targetTweetUrl: string | null; draftId: string | null;
  scheduledOn: string | null; visitOn: string | null; note: string; createdBy: string | null;
  // 비면 미배정 1행. 줄의 날짜(scheduledOn·visitOn)가 있으면 그게 이기고, 없으면 위의 입력값을 쓴다 — 인플마다 게시일이 다르다.
  items: Array<{ handle: string | null; cost: TaskCost | null; scheduledOn?: string | null; visitOn?: string | null }>;
}
export interface TaskPatch {
  influencerHandle?: string | null; targetTaskId?: string | null; targetTweetUrl?: string | null;
  postUrl?: string | null; postedAt?: string; postedSource?: 'auto' | 'manual';
  removedAt?: string | null; removedReason?: string;
  scheduledOn?: string | null; visitOn?: string | null; cost?: TaskCost | null; note?: string;
  proof?: TaskProof | null;   // 3값: undefined 유지 · null 떼기 · 값 설정
}
export interface TargetCandidate {
  taskId: string; type: TaskType; influencerHandle: string | null; campaignId: string; campaignName: string;
  clientId: string | null; postUrl: string | null; postedAt: string | null; draftLabel: string | null; createdAt: string;
}
export class TaskAttachError extends Error {
  constructor(public code: 'no-task' | 'task-has-draft' | 'draft-attached') {
    super(code);
    this.name = 'TaskAttachError';
  }
}

type Row = {
  id: string; campaign_id: string; influencer_handle: string | null; type: TaskType;
  draft_id: string | null; target_task_id: string | null; target_tweet_url: string | null;
  post_url: string | null; posted_at: string | null; posted_source: 'auto' | 'manual' | null;
  removed_at: string | null; removed_reason: string;
  scheduled_on: string | null; visit_on: string | null; cost: unknown; note: string; proof: unknown;
  cancelled_at: string | null; cancel_reason: CancelReason | null; cancel_note: string;
  cancelled_draft_id: string | null; cancelled_draft_title: string | null;
  created_at: Date; updated_at: Date;
  draft_status: DraftStatus | null; draft_title: string | null; draft_ko_title: string | null; draft_first_line: string | null;
  tg_id: string | null; tg_type: TaskType | null; tg_handle: string | null; tg_campaign_id: string | null; tg_campaign_name: string | null; tg_post_url: string | null;
  tg_cancelled_at: string | null;
};

function costOf(v: unknown): TaskCost | null {
  const p = parseTaskCost(v ?? null);
  return p.ok ? p.value : null;   // jsonb 모양은 보증되지 않는다 — 검증 통과분만(draftStore.costOf 태도)
}
// 원고 표시 라벨 — draftViews.draftLabel의 SQL판(title → ko_title → 첫 줄). 한 줄로 자른다.
function labelOf(r: Row): string | null {
  const first = (r.draft_first_line ?? '').split('\n')[0].trim();
  return r.draft_title?.trim() || r.draft_ko_title || (first ? (first.length > 60 ? first.slice(0, 60) + '…' : first) : null);
}
const toRow = (r: Row): TaskRow => ({
  id: r.id, campaignId: r.campaign_id, influencerHandle: r.influencer_handle, type: r.type,
  draftId: r.draft_id, targetTaskId: r.target_task_id, targetTweetUrl: r.target_tweet_url,
  postUrl: r.post_url, postedAt: r.posted_at, postedSource: r.posted_source,
  removedAt: r.removed_at, removedReason: r.removed_reason,
  scheduledOn: r.scheduled_on, visitOn: r.visit_on, cost: costOf(r.cost), note: r.note,
  proof: taskProofOf(r.proof),
  cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason, cancelNote: r.cancel_note,
  cancelledDraftId: r.cancelled_draft_id, cancelledDraftTitle: r.cancelled_draft_title,
  createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
  draftStatus: r.draft_id ? r.draft_status : null, draftLabel: r.draft_id ? labelOf(r) : null,
  target: r.tg_id ? {
    taskId: r.tg_id, type: r.tg_type as TaskType, influencerHandle: r.tg_handle,
    campaignId: r.tg_campaign_id as string, campaignName: r.tg_campaign_name as string, postUrl: r.tg_post_url,
    cancelledAt: r.tg_cancelled_at,
  } : null,
});

// 목록·단건이 같은 정의(드리프트 방지). 원고 요약과 대상 요약을 left join 두 번으로 한 번에 받는다.
const SELECT = (sql: postgres.Sql) => sql`
  select t.id, t.campaign_id, t.influencer_handle, t.type, t.draft_id, t.target_task_id, t.target_tweet_url,
         t.post_url, to_char(t.posted_at, 'YYYY-MM-DD') as posted_at, t.posted_source,
         to_char(t.removed_at, 'YYYY-MM-DD') as removed_at, t.removed_reason,
         to_char(t.scheduled_on, 'YYYY-MM-DD') as scheduled_on, to_char(t.visit_on, 'YYYY-MM-DD') as visit_on,
         t.cost, t.note, t.proof, t.created_at, t.updated_at,
         to_char(t.cancelled_at, 'YYYY-MM-DD') as cancelled_at, t.cancel_reason, t.cancel_note,
         t.cancelled_draft_id, t.cancelled_draft_title,
         d.status as draft_status, d.title as draft_title, d.ko_title as draft_ko_title,
         coalesce(d.edited, d.content)->'posts'->0->>'text' as draft_first_line,
         tg.id as tg_id, tg.type as tg_type, tg.influencer_handle as tg_handle, tg.campaign_id as tg_campaign_id,
         tgc.name as tg_campaign_name, tg.post_url as tg_post_url, to_char(tg.cancelled_at, 'YYYY-MM-DD') as tg_cancelled_at
    from campaign_task t
    left join draft d on d.id = t.draft_id
    left join campaign_task tg on tg.id = t.target_task_id
    left join campaign tgc on tgc.id = tg.campaign_id`;

export async function getTask(sql: postgres.Sql, id: string): Promise<TaskRow | null> {
  if (!isUuidLike(id)) return null;   // 22P02 방지 — 라우트가 404로
  const rows = await sql<Row[]>`${SELECT(sql)} where t.id = ${id}`;
  return rows.length ? toRow(rows[0]) : null;
}
export async function listTasksByCampaign(sql: postgres.Sql, campaignId: string): Promise<TaskRow[]> {
  const rows = await sql<Row[]>`${SELECT(sql)} where t.campaign_id = ${campaignId} order by t.created_at asc, t.id asc`;
  return rows.map(toRow);
}
export async function findTaskByDraft(sql: postgres.Sql, draftId: string): Promise<TaskRow | null> {
  if (!isUuidLike(draftId)) return null;
  const rows = await sql<Row[]>`${SELECT(sql)} where t.draft_id = ${draftId}`;
  return rows.length ? toRow(rows[0]) : null;
}

// 여러 명 한 번에 = 한 트랜잭션에 N행(§6). 비면 미배정 1행. draftId는 items ≤ 1일 때만 온다(라우트가 검증) — 첫 행에 붙인다.
export async function createTasks(sql: postgres.Sql, campaignId: string, input: TaskCreateInput): Promise<TaskRow[]> {
  const items = input.items.length ? input.items : [{ handle: null, cost: null }];
  const ids: string[] = [];
  await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    for (const it of items) {
      // created_at은 column default now()가 아니라 clock_timestamp()를 명시로 쓴다 — 같은 트랜잭션 안에서
      // now()는 트랜잭션 시작 시각으로 고정돼(N행이 전부 같은 타임스탬프) listTasksByCampaign의
      // created_at asc 정렬이 삽입 순서를 보장하지 못한다(§1 테스트로 발견). clock_timestamp()는 문장마다 진행한다.
      const rows = await tx<Array<{ id: string }>>`
        insert into campaign_task (campaign_id, influencer_handle, type, target_task_id, target_tweet_url,
                                   scheduled_on, visit_on, cost, note, created_by, created_at)
        values (${campaignId}, ${it.handle}, ${input.type}, ${input.targetTaskId}, ${input.targetTweetUrl},
                ${it.scheduledOn ?? input.scheduledOn}::date, ${it.visitOn ?? input.visitOn}::date,
                ${it.cost ? tx.json(it.cost as never) : null}, ${input.note}, ${input.createdBy}, clock_timestamp())
        returning id`;
      ids.push(rows[0].id);
    }
    if (input.draftId) await attachDraft(tx, ids[0], input.draftId);
  });
  const rows = await sql<Row[]>`${SELECT(sql)} where t.id = any(${ids}::uuid[]) order by t.created_at asc, t.id asc`;
  // insert 순서 = ids 순서 — created_at이 같은 트랜잭션 안에서 동일할 수 있어 ids 순으로 다시 맞춘다
  const byId = new Map(rows.map((r) => [r.id, toRow(r)]));
  return ids.map((id) => byId.get(id) as TaskRow);
}

// 3값 규칙: undefined = 건드리지 않음 · null = 지움 · 값 = 설정(draftStore.updateDraft와 같은 case when 패턴).
// postedAt은 null을 받지 않는다(게시 확인은 되돌리지 않는다, §3-4) — 타입이 막는다.
export async function updateTask(sql: postgres.Sql, id: string, patch: TaskPatch): Promise<boolean> {
  if (!isUuidLike(id)) return false;
  const rows = await sql`update campaign_task set
      influencer_handle = case when ${patch.influencerHandle !== undefined} then ${patch.influencerHandle ?? null}::text else influencer_handle end,
      target_task_id    = case when ${patch.targetTaskId !== undefined} then ${patch.targetTaskId ?? null}::uuid else target_task_id end,
      target_tweet_url  = case when ${patch.targetTweetUrl !== undefined} then ${patch.targetTweetUrl ?? null}::text else target_tweet_url end,
      post_url          = case when ${patch.postUrl !== undefined} then ${patch.postUrl ?? null}::text else post_url end,
      posted_at         = coalesce(${patch.postedAt ?? null}::date, posted_at),
      posted_source     = coalesce(${patch.postedSource ?? null}::text, posted_source),
      removed_at        = case when ${patch.removedAt !== undefined} then ${patch.removedAt ?? null}::date else removed_at end,
      removed_reason    = coalesce(${patch.removedReason ?? null}::text, removed_reason),
      scheduled_on      = case when ${patch.scheduledOn !== undefined} then ${patch.scheduledOn ?? null}::date else scheduled_on end,
      visit_on          = case when ${patch.visitOn !== undefined} then ${patch.visitOn ?? null}::date else visit_on end,
      cost              = case when ${patch.cost !== undefined} then ${patch.cost ? sql.json(patch.cost as never) : null}::jsonb else cost end,
      note              = coalesce(${patch.note ?? null}::text, note),
      proof             = case when ${patch.proof !== undefined} then ${patch.proof ? sql.json(patch.proof as never) : null}::jsonb else proof end,
      updated_at = now()
    where id = ${id} returning id`;
  return rows.length > 0;
}

// 삭제 — 원고 set null·참조 작업 target set null·tracked_post.task_id set null은 전부 FK가 한다
export async function deleteTask(sql: postgres.Sql, id: string): Promise<boolean> {
  if (!isUuidLike(id)) return false;
  const rows = await sql`delete from campaign_task where id = ${id} returning id`;
  return rows.length > 0;
}

// 원고 붙이기 — 원고 1개 = 작업 1개(unique partial index가 최후 방어, 여기서는 문구 있는 오류로 먼저 끊는다).
// 인플 동기화(값은 하나, §4-3): 작업에 인플이 있으면 원고에 채우고, 작업이 비어 있고 원고에 있으면 작업에 채운다.
export async function attachDraft(sql: postgres.Sql, taskId: string, draftId: string): Promise<void> {
  if (!isUuidLike(taskId) || !isUuidLike(draftId)) throw new TaskAttachError('no-task');
  const t = await sql<Array<{ id: string; draft_id: string | null; influencer_handle: string | null }>>`
    select id, draft_id, influencer_handle from campaign_task where id = ${taskId} for update`;
  if (t.length === 0) throw new TaskAttachError('no-task');
  if (t[0].draft_id && t[0].draft_id !== draftId) throw new TaskAttachError('task-has-draft');
  const taken = await sql<Array<{ id: string }>>`select id from campaign_task where draft_id = ${draftId} and id <> ${taskId}`;
  if (taken.length) throw new TaskAttachError('draft-attached');
  const d = await sql<Array<{ influencer_handle: string | null }>>`select influencer_handle from draft where id = ${draftId}`;
  if (d.length === 0) throw new TaskAttachError('no-task');
  const taskHandle = t[0].influencer_handle;
  const draftHandle = d[0].influencer_handle;
  try {
    await sql`update campaign_task set draft_id = ${draftId},
        influencer_handle = coalesce(influencer_handle, ${draftHandle}), updated_at = now() where id = ${taskId}`;
  } catch (e) {
    // 위 taken 체크는 동시 요청 사이에서 경합을 완전히 막지 못한다(같은 원고를 두 작업이 동시에 붙이면
    // 둘 다 통과할 수 있다) — unique partial index가 최후 방어선. 진 쪽은 23505를 문구 있는 오류로 바꿔 던진다.
    if (e instanceof postgres.PostgresError && e.code === '23505') throw new TaskAttachError('draft-attached');
    throw e;
  }
  if (taskHandle && (draftHandle ?? '').toLowerCase() !== taskHandle.toLowerCase()) {
    await sql`update draft set influencer_handle = ${taskHandle} where id = ${draftId}`;
  }
}
export async function detachDraft(sql: postgres.Sql, draftId: string): Promise<boolean> {
  if (!isUuidLike(draftId)) return false;
  const rows = await sql`update campaign_task set draft_id = null, updated_at = now() where draft_id = ${draftId} returning id`;
  return rows.length > 0;
}

// 대상 고르기 목록(§4-2) — post·quoteRt·visit 작업. 기본 같은 클라이언트(clientId 주면), q는 핸들·원고 제목·캠페인명. 최근 만든 순.
export async function listTargetCandidates(
  sql: postgres.Sql, opts: { clientId?: string | null; q?: string; limit?: number },
): Promise<TargetCandidate[]> {
  const byClient = opts.clientId ? sql`and c.client_id = ${opts.clientId}` : sql``;
  const q = (opts.q ?? '').trim().replace(/^@/, '');
  const like = `%${q}%`;
  const byQ = q ? sql`and (t.influencer_handle ilike ${like} or c.name ilike ${like} or d.title ilike ${like} or d.ko_title ilike ${like})` : sql``;
  const rows = await sql<Array<{
    task_id: string; type: TaskType; influencer_handle: string | null; campaign_id: string; campaign_name: string; client_id: string | null;
    post_url: string | null; posted_at: string | null; draft_title: string | null; draft_ko_title: string | null; created_at: Date;
  }>>`
    select t.id as task_id, t.type, t.influencer_handle, t.campaign_id, c.name as campaign_name, c.client_id,
           t.post_url, to_char(t.posted_at, 'YYYY-MM-DD') as posted_at, d.title as draft_title, d.ko_title as draft_ko_title, t.created_at
      from campaign_task t
      join campaign c on c.id = t.campaign_id
      left join draft d on d.id = t.draft_id
     where t.type = any(${[...TARGETABLE_TYPES]}::text[]) and t.cancelled_at is null ${byClient} ${byQ}
     order by t.created_at desc
     limit ${opts.limit ?? 50}`;
  return rows.map((r) => ({
    taskId: r.task_id, type: r.type, influencerHandle: r.influencer_handle, campaignId: r.campaign_id, campaignName: r.campaign_name,
    clientId: r.client_id, postUrl: r.post_url, postedAt: r.posted_at, draftLabel: r.draft_title?.trim() || r.draft_ko_title || null,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
// "이 게시물을 이미 RT하기로 한 사람"(§4-2) — 같은 대상을 가리키는 작업들의 핸들(lower 중복 제거, 첫 표기 보존)
export async function listTargetingHandles(sql: postgres.Sql, target: { taskId: string } | { tweetUrl: string }): Promise<string[]> {
  const rows = 'taskId' in target
    ? await sql<Array<{ h: string }>>`select influencer_handle as h from campaign_task where target_task_id = ${target.taskId} and influencer_handle is not null and cancelled_at is null order by created_at`
    : await sql<Array<{ h: string }>>`select influencer_handle as h from campaign_task where target_tweet_url = ${target.tweetUrl} and influencer_handle is not null and cancelled_at is null order by created_at`;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) { const k = r.h.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(r.h); } }
  return out;
}

// 게시 확인 채우기 — posted_at이 비어 있는 행만(이미 확인된 건 덮지 않는다). 갱신 수를 돌려준다.
export async function markPosted(sql: postgres.Sql, taskIds: string[], postedAt: string, source: 'auto' | 'manual'): Promise<number> {
  if (taskIds.length === 0) return 0;
  // 취소된 작업은 건너뛴다(ADR 0002 상호 배제) — check 제약이 최후 방어지만 자동 조회가 한 건 때문에 통째로 실패하면 안 된다
  const rows = await sql`update campaign_task set posted_at = ${postedAt}::date, posted_source = ${source}, updated_at = now()
    where id = any(${taskIds}::uuid[]) and posted_at is null and cancelled_at is null returning id`;
  return rows.length;
}

// 정산 보호(정산 스펙 §4-4) — 활성 요청이 붙은 작업은 지우지 않는다
export async function hasActiveRequest(sql: postgres.Sql, taskId: string): Promise<boolean> {
  if (!isUuidLike(taskId)) return false;
  const r = await sql<Array<{ n: string | number }>>`select count(*) as n from payment_request where task_id = ${taskId} and status = 'requested'`;
  return Number(r[0].n) > 0;
}

// 캠페인 삭제 확인 문구(§4-4)의 숫자 — 함께 지워질 작업 수, 다른 캠페인에서 이 캠페인 작업을 대상으로 참조하는 작업 수,
// 활성 정산 요청이 붙은 작업 수(1건이라도 있으면 삭제를 막는다 — 정산 스펙 §4-4)
export async function countTasksForCampaignDelete(sql: postgres.Sql, campaignId: string): Promise<{ taskCount: number; detachedTargets: number; activeRequests: number }> {
  const [r] = await sql<Array<{ task_count: string | number; detached: string | number; active: string | number }>>`
    select (select count(*) from campaign_task where campaign_id = ${campaignId}) as task_count,
           (select count(*) from campaign_task x join campaign_task y on y.id = x.target_task_id
             where y.campaign_id = ${campaignId} and x.campaign_id <> ${campaignId}) as detached,
           (select count(*) from payment_request r join campaign_task t on t.id = r.task_id
             where t.campaign_id = ${campaignId} and r.status = 'requested') as active`;
  return { taskCount: Number(r.task_count), detachedTargets: Number(r.detached), activeRequests: Number(r.active) };
}

// 이관(§2-2 ②) — draft.campaign_id가 있는 원고 → 작업 1행(유형 = 비용 유형, 없으면 투고), 연결된 tracked_post는 작업으로.
// 재실행 안전: 이미 작업이 붙은 원고는 건너뛴다. 039(컬럼 drop) 전에만 의미가 있다 — 컬럼이 없으면 0건으로 끝난다.
export async function cutoverDraftsToTasks(sql: postgres.Sql): Promise<{ tasks: number; trackedPosts: number }> {
  const has = await sql<Array<{ n: string | number }>>`
    select count(*) as n from information_schema.columns where table_name = 'draft' and column_name = 'campaign_id'`;
  if (Number(has[0].n) === 0) return { tasks: 0, trackedPosts: 0 };
  const ins = await sql<Array<{ id: string }>>`
    insert into campaign_task (campaign_id, influencer_handle, type, draft_id, scheduled_on, cost, created_by, created_at)
    select d.campaign_id, d.influencer_handle,
           case when d.cost->>'type' in ('post','quoteRt','rt','visit') then d.cost->>'type' else 'post' end,
           d.id, d.scheduled_on,
           case when d.cost is null then null
                else jsonb_build_object('amount', d.cost->'amount', 'currency', d.cost->'currency') end,
           d.created_by, d.created_at
      from draft d
     where d.campaign_id is not null
       and not exists (select 1 from campaign_task t where t.draft_id = d.id)
    returning id`;
  // 게시물 → 작업. posted_at은 서울 날짜로, 없으면 오늘. post_url은 permalink 정규형.
  const tp = await sql<Array<{ id: string }>>`
    update tracked_post tp set task_id = t.id
      from campaign_task t
     where t.draft_id = tp.draft_id and tp.task_id is null
    returning tp.id`;
  await sql`
    update campaign_task t set
      posted_at = coalesce(t.posted_at, coalesce((tp.posted_at at time zone 'Asia/Seoul')::date, (now() at time zone 'Asia/Seoul')::date)),
      posted_source = coalesce(t.posted_source, 'manual'),
      post_url = coalesce(t.post_url, 'https://x.com/' || coalesce(nullif(tp.author_handle, ''), 'i') || '/status/' || tp.tweet_id),
      updated_at = now()
      from tracked_post tp
     where tp.task_id = t.id and t.posted_at is null`;
  return { tasks: ins.length, trackedPosts: tp.length };
}
// tweetPermalink는 위 SQL과 같은 모양을 TS 쪽에서 만들 때 쓴다(라우트·UI) — SQL과 규칙이 갈리지 않도록 여기서 재수출
export { tweetPermalink };

// 캠페인 표 정산 배지(정산 스펙 §4-4) — 활성 요청 우선, 없으면 가장 최근 취소. payment_request는 040.
// settlementStore가 아니라 여기 두는 이유: settlementStore→campaignTaskStore가 아니라 반대로 두면
// settlementStore→influencerStore→campaignStore 경로로 순환 import가 생긴다.
export type SettlementBadgeStatus = 'requested' | 'cancelled';
// 그쪽(정산 프로덕트) 상태 — payment_request.external_status(041). null = 그쪽이 아직 안 봄.
export type ExternalStatus = 'received' | 'scheduled' | 'paid' | 'on_hold' | 'cancelled';
export const EXTERNAL_STATUSES: readonly ExternalStatus[] = ['received', 'scheduled', 'paid', 'on_hold', 'cancelled'];
export interface SettlementBadge {
  status: SettlementBadgeStatus; createdAt: string; cancelledAt: string | null;
  externalStatus: ExternalStatus | null; externalNote: string | null; externalUpdatedAt: string | null;
  paidAmountKrw: number | null; grossKrw: number; diffAckAt: string | null;
}
export async function settlementByTaskIds(sql: postgres.Sql, taskIds: string[]): Promise<Map<string, SettlementBadge>> {
  const ids = taskIds.filter(isUuidLike);
  if (!ids.length) return new Map();
  const rows = await sql<Array<{ task_id: string; status: SettlementBadgeStatus; created_at: Date; cancelled_at: Date | null;
    external_status: ExternalStatus | null; external_note: string | null; external_updated_at: Date | null;
    paid_amount_krw: number | null; gross_krw: string | number; diff_ack_at: Date | null }>>`
    select distinct on (task_id) task_id, status, created_at, cancelled_at, external_status, external_note, external_updated_at,
           paid_amount_krw, gross_krw, diff_ack_at
      from payment_request where task_id in ${sql(ids)}
     order by task_id, (status = 'requested') desc, created_at desc`;
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return new Map(rows.map((r) => [r.task_id, {
    status: r.status, createdAt: new Date(r.created_at).toISOString(), cancelledAt: iso(r.cancelled_at),
    externalStatus: r.external_status, externalNote: r.external_note, externalUpdatedAt: iso(r.external_updated_at),
    paidAmountKrw: r.paid_amount_krw, grossKrw: Number(r.gross_krw), diffAckAt: iso(r.diff_ack_at),
  }]));
}

// ─────────────────────────── 취소·되돌리기 (055, ADR 0002) ───────────────────────────
// 취소 = 상태. 게시 전만. 원고는 떼되 무엇이었는지(id·제목) 기억한다. 컬럼·떼기·스냅샷·로그는 한 트랜잭션.
// 조건부 UPDATE(posted_at is null and cancelled_at is null)가 경합을 막고, check 제약이 최후 방어다.
export async function cancelTask(
  sql: postgres.Sql, id: string,
  input: { reason: CancelReason | null; note: string; actorId: string | null; today: string },
): Promise<'ok' | 'not-found' | 'posted' | 'already'> {
  if (!isUuidLike(id)) return 'not-found';
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    const cur = await tx<Array<{ posted_at: string | null; cancelled_at: string | null; draft_id: string | null; influencer_handle: string | null; type: TaskType; campaign_id: string }>>`
      select posted_at, cancelled_at, draft_id, influencer_handle, type, campaign_id from campaign_task where id = ${id} for update`;
    if (cur.length === 0) return 'not-found';
    if (cur[0].cancelled_at) return 'already';
    if (cur[0].posted_at) return 'posted';
    const draftId = cur[0].draft_id;
    let title: string | null = null;
    if (draftId) {
      const d = await tx<Array<{ title: string | null; ko_title: string | null; first: string | null }>>`
        select title, ko_title, coalesce(edited, content)->'posts'->0->>'text' as first from draft where id = ${draftId}`;
      const first = (d[0]?.first ?? '').split('\n')[0].trim();
      title = d[0]?.title?.trim() || d[0]?.ko_title || (first ? (first.length > 60 ? first.slice(0, 60) + '…' : first) : null);
    }
    const rows = await tx`update campaign_task set
        cancelled_at = ${input.today}::date, cancel_reason = ${input.reason}, cancel_note = ${input.note},
        draft_id = null, cancelled_draft_id = ${draftId}, cancelled_draft_title = ${title}, updated_at = now()
      where id = ${id} and posted_at is null and cancelled_at is null returning id`;
    if (rows.length === 0) return 'posted';   // 그 사이 게시 확인이 들어왔다
    if ((input.reason === 'declined' || input.reason === 'no_response') && cur[0].influencer_handle) {
      await logTaskDeclined(tx, { handle: cur[0].influencer_handle, taskId: id, campaignId: cur[0].campaign_id, taskType: cur[0].type, reason: input.reason, action: 'cancel', actorId: input.actorId });
    }
    return 'ok';
  });
}

// 거절·무응답을 인플루언서 타임라인에 — 명부에 없는 핸들은 기록하지 않는다(해제·전달과 같은 태도, influencerSync).
export async function logTaskDeclined(tx: postgres.Sql, a: {
  handle: string; taskId: string; campaignId: string; taskType: TaskType; reason: 'declined' | 'no_response'; action: 'cancel' | 'replace'; actorId: string | null;
}): Promise<void> {
  const inf = await tx<Array<{ id: string }>>`select id from influencer where lower(handle) = lower(${a.handle})`;
  if (inf.length === 0) return;
  const camp = await tx<Array<{ name: string }>>`select name from campaign where id = ${a.campaignId}`;
  await tx`insert into influencer_log (influencer_id, kind, event_type, draft_id, draft_title, payload, author_id)
    values (${inf[0].id}, 'auto', 'task_declined', null, null,
            ${tx.json({ taskId: a.taskId, campaignId: a.campaignId, campaignName: camp[0]?.name ?? '', taskType: a.taskType, reason: a.reason, action: a.action } as never)}, ${a.actorId})`;
}

// 되돌리기 — 외부 트랜잭션 하나: ① 작업 복원 UPDATE(취소 컬럼·스냅샷 전부 지움) → ② 세이브포인트 안에서 재부착 → ③ 커밋.
// attachDraft의 unique 충돌(23505 → TaskAttachError)이 트랜잭션을 통째로 깨지 않게 세이브포인트로 격리한다.
// "복원은 항상 성공" = 원고 점유·삭제가 작업 복원을 실패시키지 않는다는 뜻.
export async function restoreTask(sql: postgres.Sql, id: string): Promise<{ result: 'ok' | 'not-found' | 'not-cancelled'; draft: 'reattached' | 'taken' | 'gone' | 'none' }> {
  if (!isUuidLike(id)) return { result: 'not-found', draft: 'none' };
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql & { savepoint<T>(cb: (s: postgres.Sql) => Promise<T>): Promise<T> };
    const cur = await tx<Array<{ cancelled_at: string | null; cancelled_draft_id: string | null; cancelled_draft_title: string | null }>>`
      select cancelled_at, cancelled_draft_id, cancelled_draft_title from campaign_task where id = ${id} for update`;
    if (cur.length === 0) return { result: 'not-found', draft: 'none' };
    if (!cur[0].cancelled_at) return { result: 'not-cancelled', draft: 'none' };
    const draftId = cur[0].cancelled_draft_id;
    // cancelled_draft_id는 on delete set null(055) — 원고가 지워지면 취소 스냅샷이 잡히기도 전에 이미 null이 된다.
    // "원고가 없었다"(none)와 "원고가 있었는데 지워졌다"(gone)를 가르는 건 title 스냅샷(텍스트라 FK 캐스케이드를 안 탄다) 생존 여부다.
    const hadDraft = draftId !== null || cur[0].cancelled_draft_title !== null;
    await tx`update campaign_task set cancelled_at = null, cancel_reason = null, cancel_note = '',
        cancelled_draft_id = null, cancelled_draft_title = null, updated_at = now() where id = ${id}`;
    if (!draftId) return { result: 'ok', draft: hadDraft ? 'gone' : 'none' };
    const exists = await tx<Array<{ id: string }>>`select id from draft where id = ${draftId}`;
    if (exists.length === 0) return { result: 'ok', draft: 'gone' };
    try {
      await tx.savepoint(async (sp) => { await attachDraft(sp as unknown as postgres.Sql, id, draftId); });
      return { result: 'ok', draft: 'reattached' };
    } catch (e) {
      if (e instanceof TaskAttachError) return { result: 'ok', draft: 'taken' };   // 세이브포인트만 롤백됨 — 복원은 유지
      throw e;
    }
  });
}
