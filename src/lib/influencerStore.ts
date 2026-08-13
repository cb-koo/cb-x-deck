import type postgres from 'postgres';
import type { Member } from './types.ts';
import type { DraftContent, InfluencerOption } from './draftTypes.ts';
import type { DraftStatus } from './draftStatus.ts';
import type { UserInfo } from './getxapi.ts';
import { draftVersionHash } from './draftStore.ts';

// 기록 채널 — 수동 한 줄 기록이 "어디서 오간 이야기인지" (스펙 §2)
export type InfluencerChannel = 'dm' | 'line' | 'email' | 'other';
// 앱이 스스로 남기는 이벤트 — 표시 문구는 UI가 만든다(로그에는 사실만 저장)
export type InfluencerAutoEvent = 'draft_assigned' | 'draft_unassigned' | 'draft_delivered' | 'handle_changed';

export interface InfluencerRow {
  id: string; handle: string; xUserId: string | null;
  displayName: string | null; avatarUrl: string | null; bio: string | null;
  followersCount: number | null; profileRefreshedAt: string | null;
  tags: string[]; note: string; createdAt: string;
  lastLogAt: string | null;  // 파생: 로그 최신행 — 라벨은 "마지막 기록" (스펙 §2)
  draftCount: number;        // 파생: lower(handle) 조인 count
}

export interface InfluencerLogRow {
  id: string; kind: 'manual' | 'auto'; eventType: InfluencerAutoEvent | null;
  body: string | null; channel: InfluencerChannel | null;
  draftId: string | null; draftTitle: string | null;
  payload: { from?: string; to?: string } | null;
  member: Member | null; createdAt: string;
}

export interface DraftRollupItem { id: string; title: string; status: DraftStatus; createdAt: string }

export interface InfluencerDetail { influencer: InfluencerRow; logs: InfluencerLogRow[]; drafts: DraftRollupItem[] }

type IRow = {
  id: string; handle: string; x_user_id: string | null;
  display_name: string | null; avatar_url: string | null; bio: string | null;
  followers_count: number | null; profile_refreshed_at: Date | null;
  tags: string[]; note: string; created_at: Date;
  last_log_at: Date | null; draft_count: string | number;
};

type LRow = {
  id: string; kind: 'manual' | 'auto'; event_type: InfluencerAutoEvent | null;
  body: string | null; channel: InfluencerChannel | null;
  draft_id: string | null; draft_title: string | null;
  payload: { from?: string; to?: string } | null; created_at: Date;
  member_id: string | null; member_name: string | null; member_color: string | null;
};

type DRow = {
  id: string; ko_title: string | null; ko_title_hash: string | null;
  edited: DraftContent | null; content: DraftContent; status: DraftStatus; created_at: Date;
};

const toRow = (r: IRow): InfluencerRow => ({
  id: r.id, handle: r.handle, xUserId: r.x_user_id,
  displayName: r.display_name, avatarUrl: r.avatar_url, bio: r.bio,
  followersCount: r.followers_count,
  profileRefreshedAt: r.profile_refreshed_at ? new Date(r.profile_refreshed_at).toISOString() : null,
  tags: r.tags, note: r.note, createdAt: new Date(r.created_at).toISOString(),
  lastLogAt: r.last_log_at ? new Date(r.last_log_at).toISOString() : null,
  draftCount: Number(r.draft_count), // count(*)는 bigint → postgres.js가 문자열로 준다
});

const toLog = (r: LRow): InfluencerLogRow => ({
  id: r.id, kind: r.kind, eventType: r.event_type,
  body: r.body, channel: r.channel,
  draftId: r.draft_id, draftTitle: r.draft_title, payload: r.payload,
  member: r.member_id ? { id: r.member_id, name: r.member_name as string, color: r.member_color as string } : null,
  createdAt: new Date(r.created_at).toISOString(),
});

// 파생값 2개는 목록·상세·생성 직후가 모두 같은 정의를 써야 한다(드리프트 = 카드마다 다른 숫자).
// draft_count는 lower 조인 — 배정은 사용자가 친 표기 그대로 저장되기 때문이다.
const SELECT = (sql: postgres.Sql) => sql`
  select i.id, i.handle, i.x_user_id, i.display_name, i.avatar_url, i.bio, i.followers_count,
         i.profile_refreshed_at, i.tags, i.note, i.created_at,
         (select max(l.created_at) from influencer_log l where l.influencer_id = i.id) as last_log_at,
         (select count(*) from draft d where lower(d.influencer_handle) = lower(i.handle)) as draft_count
    from influencer i`;

const LOG_SELECT = (sql: postgres.Sql) => sql`
  select l.id, l.kind, l.event_type, l.body, l.channel, l.draft_id, l.draft_title, l.payload, l.created_at,
         m.id as member_id, m.name as member_name, m.color as member_color
    from influencer_log l
    left join member m on m.id = l.author_id`;

export async function createInfluencer(
  sql: postgres.Sql,
  input: { handle: string; createdBy: string | null; snapshot?: UserInfo | null },
): Promise<{ row: InfluencerRow; created: boolean }> {
  // 핸들은 대소문자 무관 — 이미 있으면 표기를 덮지 않고 기존 행을 돌려준다(스펙 §2)
  const existing = await findByHandle(sql, input.handle);
  if (existing) return { row: existing, created: false };

  const s = input.snapshot ?? null;
  const rows = await sql<Array<{ id: string }>>`
    insert into influencer (handle, created_by, x_user_id, display_name, avatar_url, bio, followers_count,
                            profile_refreshed_at)
    values (${input.handle}, ${input.createdBy}, ${s?.id ?? null}, ${s?.name ?? null},
            ${s?.profilePicture ?? null}, ${s?.description ?? null}, ${s?.followers ?? null},
            ${s ? sql`now()` : null})
    returning id`;
  const row = await findInfluencerById(sql, rows[0].id);
  return { row: row as InfluencerRow, created: true };
}

export async function listInfluencers(sql: postgres.Sql): Promise<InfluencerRow[]> {
  // 기본 정렬은 "최근에 뭔가 있었던 사람"이 위 — 아직 기록이 없는 사람은 뒤로, 그 안에서는 핸들 사전순
  const rows = await sql<IRow[]>`${SELECT(sql)} order by last_log_at desc nulls last, lower(i.handle)`;
  return rows.map(toRow);
}

export async function findInfluencerById(sql: postgres.Sql, id: string): Promise<InfluencerRow | null> {
  const rows = await sql<IRow[]>`${SELECT(sql)} where i.id = ${id}`;
  return rows.length ? toRow(rows[0]) : null;
}

export async function findByHandle(sql: postgres.Sql, handle: string): Promise<InfluencerRow | null> {
  const rows = await sql<IRow[]>`${SELECT(sql)} where lower(i.handle) = lower(${handle})`;
  return rows.length ? toRow(rows[0]) : null;
}

// 프로필 조회로 밝혀진 X 계정이 이미 다른 행에 붙어 있으면 그 핸들을 돌려준다(개명·중복 등록 감지).
export async function findDuplicateByXUserId(
  sql: postgres.Sql, xUserId: string, excludeId: string,
): Promise<string | null> {
  const rows = await sql<Array<{ handle: string }>>`
    select handle from influencer where x_user_id = ${xUserId} and id <> ${excludeId} limit 1`;
  return rows.length ? rows[0].handle : null;
}

// 원고 카드에 쓸 한 줄 제목 — 저장된 한국어 제목이 최신 버전 것일 때만 쓰고, 아니면 본문 첫 줄.
// (draftStore.toRow의 koTitle 스테일 판정과 같은 규칙 — 두 화면이 다른 제목을 보이면 안 된다)
function rollupTitle(r: DRow): string {
  const latest = r.edited ?? r.content;
  if (r.ko_title && r.ko_title_hash === draftVersionHash(latest.posts)) return r.ko_title;
  const first = latest.posts[0]?.text ?? '';
  const line = first.split('\n').find((l) => l.trim() !== '') ?? '';
  return line.trim().slice(0, 60);
}

export async function getInfluencerDetail(sql: postgres.Sql, id: string): Promise<InfluencerDetail | null> {
  const influencer = await findInfluencerById(sql, id);
  if (!influencer) return null;

  const logs = await sql<LRow[]>`${LOG_SELECT(sql)} where l.influencer_id = ${id} order by l.created_at desc`;
  const drafts = await sql<DRow[]>`
    select id, ko_title, ko_title_hash, edited, content, status, created_at
      from draft where lower(influencer_handle) = lower(${influencer.handle})
     order by created_at desc limit 50`;

  return {
    influencer,
    logs: logs.map(toLog),
    drafts: drafts.map((d) => ({
      id: d.id, title: rollupTitle(d), status: d.status, createdAt: new Date(d.created_at).toISOString(),
    })),
  };
}

export async function updateInfluencer(
  sql: postgres.Sql, id: string, patch: { note?: string; tags?: string[] },
): Promise<void> {
  await sql`update influencer set
      note = coalesce(${patch.note ?? null}, note),
      tags = coalesce(${patch.tags ? sql.json(patch.tags) : null}, tags)
    where id = ${id}`;
}

export async function deleteInfluencer(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from influencer where id = ${id}`; // 로그는 cascade
}

// X 프로필 조회 결과를 박제 — 표시는 항상 "언제 기준"인지와 함께 (profile_refreshed_at)
export async function applyProfileSnapshot(sql: postgres.Sql, id: string, info: UserInfo): Promise<void> {
  await sql`update influencer set
      x_user_id = ${info.id},
      display_name = ${info.name},
      avatar_url = ${info.profilePicture},
      bio = ${info.description},
      followers_count = ${info.followers},
      profile_refreshed_at = now()
    where id = ${id}`;
}

// 원고 배정이 만드는 자동 등록 — 프로필 조회(비용) 없이 행만 확보한다.
// 표현식 유니크 인덱스라 on conflict도 표현식으로 추론시킨다. do update의 no-op 대입은
// do nothing이 기존 행을 returning하지 않기 때문(=id를 못 받는다).
export async function ensureInfluencer(
  sql: postgres.Sql, handle: string, createdBy: string | null,
): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    insert into influencer (handle, created_by) values (${handle}, ${createdBy})
    on conflict ((lower(handle))) do update set handle = influencer.handle
    returning id`;
  return rows[0].id;
}

// 개명 — 같은 사람이므로 이미 준 원고의 배정 사실은 그대로 따라간다 (스펙 §5).
// 트랜잭션으로 묶을지는 호출자가 정한다(라우트는 sql.begin 안에서 부른다).
export async function renameInfluencer(
  sql: postgres.Sql, args: { influencerId: string; from: string; to: string; actorId: string | null },
): Promise<void> {
  const { influencerId, from, to, actorId } = args;
  await sql`update influencer set handle = ${to} where id = ${influencerId}`;
  await sql`update draft set influencer_handle = ${to} where lower(influencer_handle) = ${from.toLowerCase()}`;
  await insertAutoLog(sql, {
    influencerId, eventType: 'handle_changed', draftId: null, draftTitle: null,
    payload: { from, to }, authorId: actorId,
  });
}

export async function addManualLog(
  sql: postgres.Sql, influencerId: string,
  input: { body: string; channel: InfluencerChannel | null; authorId: string | null },
): Promise<InfluencerLogRow> {
  const ins = await sql<Array<{ id: string }>>`
    insert into influencer_log (influencer_id, kind, body, channel, author_id)
    values (${influencerId}, 'manual', ${input.body}, ${input.channel}, ${input.authorId})
    returning id`;
  const rows = await sql<LRow[]>`${LOG_SELECT(sql)} where l.id = ${ins[0].id}`;
  return toLog(rows[0]);
}

// 지울 수 있는 건 사람이 쓴 기록뿐 — kind 조건이 자동 이벤트 삭제를 원천 차단한다(타임라인은 사실 기록).
export async function deleteManualLog(
  sql: postgres.Sql, influencerId: string, logId: string,
): Promise<boolean> {
  const del = await sql`delete from influencer_log
    where id = ${logId} and influencer_id = ${influencerId} and kind = 'manual' returning id`;
  return del.length > 0;
}

export async function insertAutoLog(sql: postgres.Sql, input: {
  influencerId: string; eventType: InfluencerAutoEvent;
  draftId: string | null; draftTitle: string | null;
  payload?: { from: string; to: string }; authorId: string | null;
}): Promise<void> {
  await sql`insert into influencer_log (influencer_id, kind, event_type, draft_id, draft_title, payload, author_id)
    values (${input.influencerId}, 'auto', ${input.eventType}, ${input.draftId}, ${input.draftTitle},
            ${input.payload ? sql.json(input.payload) : null}, ${input.authorId})`;
}

// 배정 자동완성 후보 — 명부가 기준이다(과거 배정 이력에서 긁어모으던 listInfluencerHandles의 후신).
export async function listOptions(sql: postgres.Sql): Promise<InfluencerOption[]> {
  const rows = await sql<Array<{ handle: string; display_name: string | null }>>`
    select handle, display_name from influencer order by lower(handle)`;
  return rows.map((r) => ({ handle: r.handle, name: r.display_name ?? undefined }));
}
