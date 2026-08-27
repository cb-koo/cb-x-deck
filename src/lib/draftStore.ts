import type postgres from 'postgres';
import type { Member } from './types.ts';
import type { DraftContent, DraftFormat, ReferenceMode, RefSnapshot } from './draftTypes.ts';
import type { DraftStatus } from './draftStatus.ts';
import { hashSource } from './translationStore.ts';
import { parseTaskCost, type TaskCost } from './campaignCost.ts';
import { attachDraft } from './campaignTaskStore.ts';
import type { TaskType } from './campaignJudgment.ts';

// 버전별 한국어 번역 캐시 — sourceHash(원문 지문) → 번역 posts. 어떤 버전이든 한 번 번역하면 재사용.
export type DraftTranslation = Record<string, string[]>;

// 버전 텍스트의 캐시 키 — 생성·다시쓰기·라우트·toRow가 전부 이 식을 써야 한다(드리프트=조용한 캐시 미스=이중 과금)
export function draftVersionHash(posts: Array<{ text: string }>): string {
  return hashSource(JSON.stringify(posts.map((p) => p.text)), null);
}

// 초기 단일 슬롯 형태({sourceHash, posts})의 잔존 데이터를 맵으로 정규화
function normalizeTranslation(v: unknown): DraftTranslation | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { sourceHash?: unknown; posts?: unknown };
  if (typeof o.sourceHash === 'string' && Array.isArray(o.posts)) {
    return { [o.sourceHash]: o.posts as string[] };
  }
  return v as DraftTranslation;
}

export interface DraftRow {
  id: string; clientId: string | null; clientName: string | null; procedureNames: string[];
  direction: string; format: DraftFormat; referenceMode: ReferenceMode; refs: RefSnapshot[];
  content: DraftContent; edited: DraftContent | null;
  history: DraftContent[]; // 재생성 직전 표시본 스냅샷들 — [ ...history, edited ?? content ]가 버전 타임라인
  translation: DraftTranslation | null;
  koLatest: string[] | null; // 최신 버전(edited ?? content)의 캐시 번역 파생값 — 클라이언트는 이 필드만 읽는다 (4차 스펙)
  // 사람이 붙인 제목 — ko_title과 달리 해시 검사를 타지 않는다(본문을 고쳐도 남는다, 설계 §A)
  title: string | null;
  koTitle: string | null; // 최신 버전과 해시가 일치할 때만 값 — 아니면 null(스테일 방지, koLatest와 동일 패턴)
  dismissedFlags: string[];
  status: DraftStatus; // 결정 진행도 라벨 — 전이 제약 없음 (스펙 §2)
  // 게시할 인플루언서의 X 핸들('@' 없음, 사용자가 친 대소문자 그대로) — null = 미배정.
  // 배정 단위는 시안 하나(행)다: 형제 시안 셋 다 배정하면 "원고 3개를 줬다"가 되어 사실과 어긋난다.
  influencerHandle: string | null;
  // 캠페인 소속은 붙은 작업(campaign_task.draft_id)에서 파생한다(스펙 2026-08-28 §5) — 원고는 캠페인에 직접 속하지 않는다.
  // 이름은 옛 그대로 두어(campaignId·campaignName·campaignCode·scheduledOn·cost) 표·필터·트래킹 링크 prefill이 그대로 읽는다.
  taskId: string | null;
  taskType: TaskType | null;
  campaignId: string | null;
  campaignName: string | null;
  campaignCode: string | null;   // campaign.name_en
  scheduledOn: string | null;    // 작업의 게시 예정일 'YYYY-MM-DD'
  cost: TaskCost | null;         // 작업 비용 {amount, currency} — 유형은 taskType
  batchId: string | null;      // 다중 시안 묶음 — 단일 생성은 null
  variantIndex: number | null; // 묶음 내 순번(0부터, 표시 라벨 A/B/C…)
  model: string | null; createdAt: string; member: Member | null;
}

type Row = {
  id: string; client_id: string | null; client_name: string | null; procedure_names: string[];
  direction: string; format: DraftFormat; reference_mode: ReferenceMode; refs: RefSnapshot[];
  content: DraftContent; edited: DraftContent | null;
  history: DraftContent[]; translation: DraftTranslation | null;
  title: string | null;
  ko_title: string | null; ko_title_hash: string | null;
  dismissed_flags: string[];
  status: DraftStatus;
  influencer_handle: string | null;
  task_id: string | null; task_type: TaskType | null;
  campaign_id: string | null; campaign_name: string | null; campaign_code: string | null;
  scheduled_on: string | null; cost: unknown;
  batch_id: string | null; variant_index: number | null;
  model: string | null; created_at: Date;
  member_id: string | null; member_name: string | null; member_color: string | null;
};

// jsonb는 모양을 보증하지 않는다 — 검증을 통과한 것만 값으로, 아니면 null(linkStore.toDaily 관례)
function costOf(v: unknown): TaskCost | null {
  const p = parseTaskCost(v ?? null);
  return p.ok ? p.value : null;
}

const toRow = (r: Row): DraftRow => {
  const translation = normalizeTranslation(r.translation);
  const latest = r.edited ?? r.content;
  const latestHash = draftVersionHash(latest.posts); // koLatest·koTitle이 공유 — 행당 SHA 1회
  return {
    id: r.id, clientId: r.client_id, clientName: r.client_name, procedureNames: r.procedure_names,
    direction: r.direction, format: r.format, referenceMode: r.reference_mode, refs: r.refs,
    content: r.content, edited: r.edited, history: r.history,
    translation,
    // 최신 버전의 캐시 번역 — 해시 계산은 서버 소관(node:crypto), 클라이언트는 이 필드만 읽는다 (4차 스펙)
    koLatest: translation?.[latestHash] ?? null,
    title: r.title,
    // 저장된 제목의 hash가 최신 버전과 다르면(=편집·재생성 이후) 낡은 제목이므로 숨긴다
    koTitle: r.ko_title && r.ko_title_hash === latestHash ? r.ko_title : null,
    dismissedFlags: r.dismissed_flags,
    status: r.status,
    influencerHandle: r.influencer_handle,
    taskId: r.task_id, taskType: r.task_type,
    campaignId: r.campaign_id, campaignName: r.campaign_name, campaignCode: r.campaign_code,
    scheduledOn: r.scheduled_on, cost: costOf(r.cost),
    batchId: r.batch_id, variantIndex: r.variant_index,
    model: r.model, createdAt: r.created_at.toISOString(),
    member: r.member_id ? { id: r.member_id, name: r.member_name as string, color: r.member_color as string } : null,
  };
};

const SELECT = (sql: postgres.Sql) => sql`
  select d.id, d.client_id, d.client_name, d.procedure_names, d.direction, d.format,
         d.reference_mode, d.refs, d.content, d.edited, d.history, d.translation,
         d.title, d.ko_title, d.ko_title_hash,
         d.dismissed_flags, d.status, d.influencer_handle, d.batch_id, d.variant_index, d.model, d.created_at,
         t.id as task_id, t.type as task_type, t.campaign_id, c.name as campaign_name, c.name_en as campaign_code,
         to_char(t.scheduled_on, 'YYYY-MM-DD') as scheduled_on, t.cost,
         m.id as member_id, m.name as member_name, m.color as member_color
    from draft d
    left join member m on m.id = d.created_by
    left join campaign_task t on t.draft_id = d.id
    left join campaign c on c.id = t.campaign_id`;
// campaign_task(draft_id) unique partial index(037) 덕에 원고 1행에 작업은 최대 1행 — 이 조인으로 행이 불어나지 않는다.

export async function insertDraft(sql: postgres.Sql, input: {
  clientId: string | null; clientName: string | null; procedureNames: string[];
  direction: string; format: DraftFormat; referenceMode: ReferenceMode; refs: RefSnapshot[];
  content: DraftContent; model: string | null; memberId: string | null;
  batchId?: string | null; variantIndex?: number | null;
  translation?: DraftTranslation | null; // 생성 시점에 함께 마련된 한국어 대역 캐시 — 없으면 null(부가물 실패 허용)
  koTitle?: string | null; koTitleHash?: string | null; // 생성 시점에 함께 마련된 한국어 제목 — 둘은 항상 쌍
  // 사람이 붙인 제목 — 지금까지는 삽입 후 PATCH로만 들어왔다(updateDraft.title). 직접 쓰기는 저장
  // 한 번에 제목까지 함께 넣어야 하므로 여기서 받는다. 생략(undefined)하면 기존 호출부(generate.ts)
  // 그대로 null — DEFAULT null 컬럼이라 무변경으로 통과한다.
  title?: string | null;
  // 작업에 붙여 만들기(/generate?task= · 원고 카드 '새 작업 만들기') — 같은 sql(트랜잭션) 안에서 attachDraft.
  // 실패(TaskAttachError)는 호출자에게 던진다 — 트랜잭션이면 insert도 함께 롤백된다.
  taskId?: string | null;
}): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    insert into draft (client_id, client_name, procedure_names, direction, format,
                       reference_mode, refs, content, model, created_by, batch_id, variant_index, translation,
                       ko_title, ko_title_hash, title)
    values (${input.clientId}, ${input.clientName}, ${sql.json(input.procedureNames)},
            ${input.direction}, ${input.format}, ${input.referenceMode},
            ${sql.json(input.refs as never)}, ${sql.json(input.content as never)},
            ${input.model}, ${input.memberId}, ${input.batchId ?? null}, ${input.variantIndex ?? null},
            ${input.translation ? sql.json(input.translation as never) : null},
            ${input.koTitle ?? null}, ${input.koTitleHash ?? null}, ${input.title ?? null})
    returning id`;
  const id = rows[0].id;
  if (input.taskId) await attachDraft(sql, input.taskId, id);
  return id;
}

export async function listDrafts(
  sql: postgres.Sql, opts: { clientId?: string; status?: DraftStatus; limit?: number; unattached?: boolean } = {},
): Promise<DraftRow[]> {
  const byClient = opts.clientId ? sql`and d.client_id = ${opts.clientId}` : sql``;
  const byStatus = opts.status ? sql`and d.status = ${opts.status}` : sql``;
  // 작업에 안 붙은 원고만(listUnattachedDrafts와 같은 뜻) — '있는 원고 고르기'·미부착 필터가 쓴다
  const byAttach = opts.unattached ? sql`and not exists (select 1 from campaign_task t2 where t2.draft_id = d.id)` : sql``;
  // 배치 형제는 created_at이 동일 — variant_index로 A/B/C 순서 고정 (단일 초안 null은 앞)
  const rows = await sql<Row[]>`
    ${SELECT(sql)} where true ${byClient} ${byStatus} ${byAttach}
    order by d.created_at desc, d.variant_index asc nulls first
    limit ${opts.limit ?? 50}`;
  return rows.map(toRow);
}

export async function getDraft(sql: postgres.Sql, id: string): Promise<DraftRow | null> {
  const rows = await sql<Row[]>`${SELECT(sql)} where d.id = ${id}`;
  return rows.length ? toRow(rows[0]) : null;
}

export async function updateDraft(
  sql: postgres.Sql, id: string,
  patch: { edited?: DraftContent; dismissedFlags?: string[]; history?: DraftContent[];
           translation?: DraftTranslation; status?: DraftStatus;
           title?: string | null; // '' · null = 지움 · 문자열 = 설정 · undefined = 건드리지 않음
           koTitle?: string | null; koTitleHash?: string | null; // 호출부가 둘을 항상 쌍으로 세팅
           influencerHandle?: string | null; // null이 '배정 해제'라는 뜻을 갖는 유일한 필드 — 아래 case when 참조
           // 캠페인·예정일·비용은 이제 작업(campaign_task)의 것이다(스펙 2026-08-28 §5) — 여기서 받지 않는다.
           format?: DraftFormat }, // 칸 수 변경 시 서버가 파생해 넘긴다 — '지움' 개념이 없으므로 coalesce로 충분
): Promise<void> {
  await sql`update draft set
      edited = coalesce(${patch.edited ? sql.json(patch.edited as never) : null}, edited),
      dismissed_flags = coalesce(${patch.dismissedFlags ? sql.json(patch.dismissedFlags) : null}, dismissed_flags),
      history = coalesce(${patch.history ? sql.json(patch.history as never) : null}, history),
      translation = coalesce(${patch.translation ? sql.json(patch.translation as never) : null}, translation),
      status = coalesce(${patch.status ?? null}, status),
      format = coalesce(${patch.format ?? null}, format),
      -- undefined = 건드리지 않음 · '' 또는 null = 지움 · 문자열 = 설정 (influencer_handle과 같은 구조)
      title = case when ${patch.title !== undefined}
                then ${patch.title ? patch.title : null}::text
                else title end,
      ko_title = coalesce(${patch.koTitle ? patch.koTitle : null}, ko_title),
      ko_title_hash = coalesce(${patch.koTitleHash ? patch.koTitleHash : null}, ko_title_hash),
      -- 이 컬럼만 coalesce를 쓰지 않는다: coalesce는 "null이면 기존값 유지"라 배정 해제를 표현할 방법이 없다.
      -- undefined = 건드리지 않음 · null = 배정 해제 · 문자열 = 배정 (::text는 파라미터 타입 추론 명시)
      influencer_handle = case when ${patch.influencerHandle !== undefined}
                            then ${patch.influencerHandle ?? null}::text
                            else influencer_handle end
    where id = ${id}`;
}

// 일괄 변경 — 개별 updateDraft를 N번 부르지 않는다. 50건을 고르면 커넥션 50개가 동시에 붙는데,
// 이 저장소는 이미 커넥션 고갈로 목록이 비는 회귀를 겪었다(설계 §B). 한 문장으로 끝낸다.
// null·undefined 의미는 updateDraft와 같다: undefined = 건드리지 않음, null = 배정 해제.
export async function updateDraftsBulk(
  sql: postgres.Sql, ids: string[],
  patch: { status?: DraftStatus; influencerHandle?: string | null },
): Promise<void> {
  if (ids.length === 0) return; // any(빈 배열)은 0건을 맞히지만, 쿼리를 안 쏘는 편이 정직하다
  await sql`update draft set
      status = coalesce(${patch.status ?? null}, status),
      influencer_handle = case when ${patch.influencerHandle !== undefined}
                            then ${patch.influencerHandle ?? null}::text
                            else influencer_handle end
    where id = any(${ids}::uuid[])`;
}

export async function removeDraftsBulk(sql: postgres.Sql, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`delete from draft where id = any(${ids}::uuid[])`;
}

// 벌크 PATCH가 자동 로그(influencerSync)를 우회하지 않도록, 갱신 전 상태를 잠그고 통째로 읽는다.
// for update of d: member 조인은 잠그지 않는다. 호출자는 같은 트랜잭션에서 갱신+로그까지 끝낸다.
export async function getDraftsByIdsForUpdate(sql: postgres.Sql, ids: string[]): Promise<DraftRow[]> {
  if (ids.length === 0) return [];
  const rows = await sql<Row[]>`${SELECT(sql)} where d.id = any(${ids}::uuid[]) for update of d`;
  return rows.map(toRow);
}

export async function removeDraft(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from draft where id = ${id}`;
}

// 캠페인 상세의 원고 목록 — 예정일 오름차순(없음은 뒤), 같은 날은 생성순. 표의 최종 순서(밀림 우선 등)는
// campaignJudgment.sortContent가 정한다 — 여기는 안정적인 기본 순서만 보장한다.
export async function listDraftsByCampaign(sql: postgres.Sql, campaignId: string): Promise<DraftRow[]> {
  const rows = await sql<Row[]>`
    ${SELECT(sql)} where t.campaign_id = ${campaignId}
    order by t.scheduled_on asc nulls last, d.created_at asc`;
  return rows.map(toRow);
}

// '있는 원고 고르기'(스펙 §4-2) — 그 클라이언트의 작업에 안 붙은 원고만. 클라이언트 없는 캠페인은 클라 없는 원고를 후보로.
export async function listUnattachedDrafts(
  sql: postgres.Sql, clientId: string | null, limit = 200,
): Promise<DraftRow[]> {
  const byClient = clientId === null ? sql`and d.client_id is null` : sql`and d.client_id = ${clientId}`;
  const rows = await sql<Row[]>`
    ${SELECT(sql)} where not exists (select 1 from campaign_task t2 where t2.draft_id = d.id) ${byClient}
    order by d.created_at desc, d.variant_index asc nulls first
    limit ${limit}`;
  return rows.map(toRow);
}
