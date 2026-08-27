import postgres from 'postgres';
import type { DraftStatus } from './draftStatus.ts';
import { parseTaskCost, type TaskCost } from './campaignCost.ts';
import { TARGETABLE_TYPES, type TaskType } from './campaignJudgment.ts';
import { tweetPermalink } from './tweetLink.ts';
import { isUuidLike } from './uuid.ts';

// 작업(campaign_task) 저장소 — 스펙 2026-08-28 §2-1. 판정(단계·밀림·요약)은 campaignJudgment가, 여기는 행의 읽기·쓰기만.
// 핸들은 표기 보존·비교는 lower(). 날짜는 date 컬럼 + to_char 왕복(시간대 시프트 방지, DateOnly 관례).
export interface TaskRow {
  id: string; campaignId: string; influencerHandle: string | null; type: TaskType;
  draftId: string | null; targetTaskId: string | null; targetTweetUrl: string | null;
  postUrl: string | null; postedAt: string | null; postedSource: 'auto' | 'manual' | null;
  removedAt: string | null; removedReason: string;
  scheduledOn: string | null; visitOn: string | null; cost: TaskCost | null; note: string;
  createdAt: string; updatedAt: string;
  draftStatus: DraftStatus | null; draftLabel: string | null;   // 붙은 원고 요약 — 표의 '원고' 열
  // 대상 작업 요약(§4-1 'RT/인용RT 대상' 열) — 다른 캠페인이면 campaignName으로 구분해 보인다
  target: { taskId: string; type: TaskType; influencerHandle: string | null; campaignId: string; campaignName: string; postUrl: string | null } | null;
}
export interface TaskCreateInput {
  type: TaskType; targetTaskId: string | null; targetTweetUrl: string | null; draftId: string | null;
  scheduledOn: string | null; visitOn: string | null; note: string; createdBy: string | null;
  items: Array<{ handle: string | null; cost: TaskCost | null }>;   // 비면 미배정 1행
}
export interface TaskPatch {
  influencerHandle?: string | null; targetTaskId?: string | null; targetTweetUrl?: string | null;
  postUrl?: string | null; postedAt?: string; postedSource?: 'auto' | 'manual';
  removedAt?: string | null; removedReason?: string;
  scheduledOn?: string | null; visitOn?: string | null; cost?: TaskCost | null; note?: string;
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
  scheduled_on: string | null; visit_on: string | null; cost: unknown; note: string;
  created_at: Date; updated_at: Date;
  draft_status: DraftStatus | null; draft_title: string | null; draft_ko_title: string | null; draft_first_line: string | null;
  tg_id: string | null; tg_type: TaskType | null; tg_handle: string | null; tg_campaign_id: string | null; tg_campaign_name: string | null; tg_post_url: string | null;
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
  createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
  draftStatus: r.draft_id ? r.draft_status : null, draftLabel: r.draft_id ? labelOf(r) : null,
  target: r.tg_id ? {
    taskId: r.tg_id, type: r.tg_type as TaskType, influencerHandle: r.tg_handle,
    campaignId: r.tg_campaign_id as string, campaignName: r.tg_campaign_name as string, postUrl: r.tg_post_url,
  } : null,
});

// 목록·단건이 같은 정의(드리프트 방지). 원고 요약과 대상 요약을 left join 두 번으로 한 번에 받는다.
const SELECT = (sql: postgres.Sql) => sql`
  select t.id, t.campaign_id, t.influencer_handle, t.type, t.draft_id, t.target_task_id, t.target_tweet_url,
         t.post_url, to_char(t.posted_at, 'YYYY-MM-DD') as posted_at, t.posted_source,
         to_char(t.removed_at, 'YYYY-MM-DD') as removed_at, t.removed_reason,
         to_char(t.scheduled_on, 'YYYY-MM-DD') as scheduled_on, to_char(t.visit_on, 'YYYY-MM-DD') as visit_on,
         t.cost, t.note, t.created_at, t.updated_at,
         d.status as draft_status, d.title as draft_title, d.ko_title as draft_ko_title,
         coalesce(d.edited, d.content)->'posts'->0->>'text' as draft_first_line,
         tg.id as tg_id, tg.type as tg_type, tg.influencer_handle as tg_handle, tg.campaign_id as tg_campaign_id,
         tgc.name as tg_campaign_name, tg.post_url as tg_post_url
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
                ${input.scheduledOn}::date, ${input.visitOn}::date,
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
     where t.type = any(${[...TARGETABLE_TYPES]}::text[]) ${byClient} ${byQ}
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
    ? await sql<Array<{ h: string }>>`select influencer_handle as h from campaign_task where target_task_id = ${target.taskId} and influencer_handle is not null order by created_at`
    : await sql<Array<{ h: string }>>`select influencer_handle as h from campaign_task where target_tweet_url = ${target.tweetUrl} and influencer_handle is not null order by created_at`;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) { const k = r.h.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(r.h); } }
  return out;
}

// 게시 확인 채우기 — posted_at이 비어 있는 행만(이미 확인된 건 덮지 않는다). 갱신 수를 돌려준다.
export async function markPosted(sql: postgres.Sql, taskIds: string[], postedAt: string, source: 'auto' | 'manual'): Promise<number> {
  if (taskIds.length === 0) return 0;
  const rows = await sql`update campaign_task set posted_at = ${postedAt}::date, posted_source = ${source}, updated_at = now()
    where id = any(${taskIds}::uuid[]) and posted_at is null returning id`;
  return rows.length;
}

// 캠페인 삭제 확인 문구(§4-4)의 숫자 — 함께 지워질 작업 수, 다른 캠페인에서 이 캠페인 작업을 대상으로 참조하는 작업 수
export async function countTasksForCampaignDelete(sql: postgres.Sql, campaignId: string): Promise<{ taskCount: number; detachedTargets: number }> {
  const [r] = await sql<Array<{ task_count: string | number; detached: string | number }>>`
    select (select count(*) from campaign_task where campaign_id = ${campaignId}) as task_count,
           (select count(*) from campaign_task x join campaign_task y on y.id = x.target_task_id
             where y.campaign_id = ${campaignId} and x.campaign_id <> ${campaignId}) as detached`;
  return { taskCount: Number(r.task_count), detachedTargets: Number(r.detached) };
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
