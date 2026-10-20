// X 업로드 현황 저장소 — owned_channel·owned_post·owned_channel_week·owned_channel_snapshot(081). 스펙 2026-10-20 §3
import type postgres from 'postgres';
import { parseXHandle } from './xHandle.ts';
import { weekStartOf, addWeeks, HISTORY_WEEKS, type ChannelInput, type CollectError, type PostKind, type ParsedPost, type PostMetrics } from './ownedChannels.ts';

export interface OwnedChannel {
  id: string; clientId: string; handle: string; accountId: string; accountCreatedAt: string | null;
  weeklyTarget: number | null; promiseStartedOn: string | null; lastCollectedAt: string | null; lastError: CollectError | null; createdAt: string;
}

type Row = {
  id: string; client_id: string; handle: string; account_id: string; account_created_at: Date | null;
  weekly_target: number | null; promise_started_on: string | null; last_collected_at: Date | null; last_error: string | null; created_at: Date;
};
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const toChannel = (r: Row): OwnedChannel => ({
  id: r.id, clientId: r.client_id, handle: r.handle, accountId: r.account_id, accountCreatedAt: iso(r.account_created_at),
  weeklyTarget: r.weekly_target, promiseStartedOn: r.promise_started_on, lastCollectedAt: iso(r.last_collected_at), lastError: (r.last_error as CollectError | null),
  createdAt: new Date(r.created_at).toISOString(),
});
const COLS = (sql: postgres.Sql | postgres.TransactionSql) => sql`id, client_id, handle, account_id, account_created_at, weekly_target, promise_started_on::text as promise_started_on, last_collected_at, last_error, created_at`;

export async function getChannel(sql: postgres.Sql, clientId: string): Promise<OwnedChannel | null> {
  const rows = await sql<Row[]>`select ${COLS(sql)} from owned_channel where client_id = ${clientId} and channel = 'x'`;
  return rows[0] ? toChannel(rows[0]) : null;
}

export async function getChannelById(sql: postgres.Sql, id: string): Promise<OwnedChannel | null> {
  const rows = await sql<Row[]>`select ${COLS(sql)} from owned_channel where id = ${id}`;
  return rows[0] ? toChannel(rows[0]) : null;
}

/**
 * 계정·약속 저장. 다른 계정(숫자 id가 다름)으로 바꾸면 이전 계정 기록을 지우고 새로 시작한다 — 다른 계정 글이 섞이지 않게(스펙 §2-2).
 * 약속을 바꾸면 이번 주 약속 줄도 바꾼다 — 지난 주 줄은 그대로(스펙 §3).
 */
export async function saveChannel(
  sql: postgres.Sql, clientId: string,
  // promiseStartedOn: undefined = 그대로(새 계정이면 오늘), null = 지움(등록 8주 전부터 판정)
  input: { handle: string; accountId: string; accountCreatedAt: string | null; weeklyTarget: number | null; promiseStartedOn?: string | null },
  now: number = Date.now(),
): Promise<{ channel: OwnedChannel; replaced: boolean; isNew: boolean }> {
  return sql.begin(async (tx) => {
    const cur = await tx<Row[]>`select ${COLS(tx)} from owned_channel where client_id = ${clientId} and channel = 'x' for update`;
    let replaced = false;
    let isNew = cur.length === 0;
    if (cur[0] && cur[0].account_id !== input.accountId) {
      await tx`delete from owned_channel where id = ${cur[0].id}`;
      replaced = true;
      isNew = true;
    }
    // 새 계정의 약속 시작일 기본값은 오늘(한국) — 등록 전 8주는 글 수만 보이고 판정하지 않는다. 이미 하던 곳은 날짜를 당긴다.
    const today = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
    const rows = isNew
      ? await tx<Row[]>`
          insert into owned_channel (client_id, channel, handle, account_id, account_created_at, weekly_target, promise_started_on)
          values (${clientId}, 'x', ${input.handle}, ${input.accountId}, ${input.accountCreatedAt}, ${input.weeklyTarget},
                  ${input.promiseStartedOn === undefined ? today : input.promiseStartedOn})
          returning ${COLS(tx)}`
      : input.promiseStartedOn === undefined
        ? await tx<Row[]>`
            update owned_channel set handle = ${input.handle}, weekly_target = ${input.weeklyTarget},
                   account_created_at = coalesce(${input.accountCreatedAt}, account_created_at), updated_at = now()
            where id = ${cur[0].id} returning ${COLS(tx)}`
        : await tx<Row[]>`
            update owned_channel set handle = ${input.handle}, weekly_target = ${input.weeklyTarget},
                   promise_started_on = ${input.promiseStartedOn},
                   account_created_at = coalesce(${input.accountCreatedAt}, account_created_at), updated_at = now()
            where id = ${cur[0].id} returning ${COLS(tx)}`;
    const ch = toChannel(rows[0]);
    const week = weekStartOf(now);
    // 약속 없음도 줄로 남긴다 — 그 뒤 빈 주들이 '약속 없음'을 이어받아, 쉬는 동안이 못 채움으로 보이지 않는다(리뷰 10-20)
    await tx`
      insert into owned_channel_week (channel_id, week_start, target) values (${ch.id}, ${week}, ${input.weeklyTarget})
      on conflict (channel_id, week_start) do update set target = excluded.target`;
    return { channel: ch, replaced, isNew };
  });
}

export async function removeChannel(sql: postgres.Sql, clientId: string): Promise<void> {
  await sql`delete from owned_channel where client_id = ${clientId} and channel = 'x'`;
}

/** 수집 대상 = 약속이 있는 계정. 오래 안 받은 계정부터(남은 계정은 다음 실행이 잇는다). */
export async function listChannelsToCollect(sql: postgres.Sql): Promise<OwnedChannel[]> {
  const rows = await sql<Row[]>`
    select ${COLS(sql)} from owned_channel where weekly_target is not null
    order by last_collected_at asc nulls first, created_at`;
  return rows.map(toChannel);
}

/** 이번 수집에서 '지워졌나' 확인할 후보 — since 이후 기록된 글 id와 지워짐 여부. */
export async function postsSince(sql: postgres.Sql, channelId: string, since: Date): Promise<Array<{ postId: string; deleted: boolean }>> {
  const rows = await sql<Array<{ post_id: string; deleted: boolean }>>`
    select post_id, deleted_at is not null as deleted from owned_post where channel_id = ${channelId} and posted_at >= ${since}`;
  return rows.map((r) => ({ postId: r.post_id, deleted: r.deleted }));
}

/** 한 번 수집한 결과를 쓴다. 글은 쌓기만(이미 있으면 그대로), 팔로워는 그날 줄을 덮고, 이번 주 약속 줄이 없으면 지금 약속으로 만든다. */
export async function recordCollected(
  sql: postgres.Sql, ch: OwnedChannel,
  r: { posts: ParsedPost[]; followers: number | null; accountCreatedAt: string | null; deleted: string[]; restored: string[] },
  now: number = Date.now(),
): Promise<void> {
  await sql.begin(async (tx) => {
    if (r.posts.length > 0) {
      const values = r.posts.map((p) => ({ channel_id: ch.id, post_id: p.postId, kind: p.kind, text: p.text, posted_at: p.postedAt,
        views: p.views, likes: p.likes, replies: p.replies, retweets: p.retweets, quotes: p.quotes, bookmarks: p.bookmarks }));
      // 글은 쌓기만 — 이미 있으면 조회·좋아요만 새 값으로(받지 못한 값은 옛 값 유지)
      await tx`insert into owned_post ${tx(values, 'channel_id', 'post_id', 'kind', 'text', 'posted_at', 'views', 'likes', 'replies', 'retweets', 'quotes', 'bookmarks')}
        on conflict (channel_id, post_id) do update set
          views = coalesce(excluded.views, owned_post.views), likes = coalesce(excluded.likes, owned_post.likes),
          replies = coalesce(excluded.replies, owned_post.replies), retweets = coalesce(excluded.retweets, owned_post.retweets),
          quotes = coalesce(excluded.quotes, owned_post.quotes), bookmarks = coalesce(excluded.bookmarks, owned_post.bookmarks)`;
    }
    if (r.deleted.length > 0)
      await tx`update owned_post set deleted_at = now() where channel_id = ${ch.id} and post_id in ${tx(r.deleted)} and deleted_at is null`;
    if (r.restored.length > 0)
      await tx`update owned_post set deleted_at = null where channel_id = ${ch.id} and post_id in ${tx(r.restored)}`;
    if (r.followers !== null) {
      const day = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
      await tx`
        insert into owned_channel_snapshot (channel_id, captured_on, followers) values (${ch.id}, ${day}, ${r.followers})
        on conflict (channel_id, captured_on) do update set followers = excluded.followers, captured_at = now()`;
    }
    if (ch.weeklyTarget !== null)
      await tx`
        insert into owned_channel_week (channel_id, week_start, target) values (${ch.id}, ${weekStartOf(now)}, ${ch.weeklyTarget})
        on conflict (channel_id, week_start) do nothing`;
    await tx`update owned_channel set last_collected_at = now(), last_error = null,
               account_created_at = coalesce(${r.accountCreatedAt}, account_created_at) where id = ${ch.id}`;
  });
}

export async function recordCollectError(sql: postgres.Sql, channelId: string, error: CollectError): Promise<void> {
  await sql`update owned_channel set last_error = ${error} where id = ${channelId}`;
}

// ─────────────────────────── 화면용 읽기 ───────────────────────────

type InputRow = Row & { client_name: string };

async function inputsFor(sql: postgres.Sql, channels: InputRow[], now: number): Promise<ChannelInput[]> {
  if (channels.length === 0) return [];
  const ids = channels.map((c) => c.id);
  // 이번 주 + 지난 8주 + 경계 여유 1주
  const from = new Date(Date.parse(addWeeks(weekStartOf(now), -(HISTORY_WEEKS + 1)) + 'T00:00:00Z') - 9 * 3_600_000);
  const fromDay = addWeeks(weekStartOf(now), -(HISTORY_WEEKS + 1));
  const [posts, weeks, snaps] = await Promise.all([
    sql<Array<{ channel_id: string; post_id: string; kind: PostKind; text: string; posted_at: Date; deleted_at: Date | null } & PostMetrics>>`
      select channel_id, post_id, kind, text, posted_at, deleted_at, views, likes, replies, retweets, quotes, bookmarks from owned_post
      where channel_id in ${sql(ids)} and posted_at >= ${from}`,
    sql<Array<{ channel_id: string; week_start: string; target: number | null }>>`
      select channel_id, week_start::text as week_start, target from owned_channel_week where channel_id in ${sql(ids)}`,
    sql<Array<{ channel_id: string; captured_on: string; followers: number }>>`
      select channel_id, captured_on::text as captured_on, followers from owned_channel_snapshot
      where channel_id in ${sql(ids)} and captured_on >= ${fromDay}`,
  ]);
  return channels.map((c) => ({
    channelId: c.id, clientId: c.client_id, clientName: c.client_name, handle: c.handle,
    currentTarget: c.weekly_target ?? 0,
    registeredAt: new Date(c.created_at).toISOString(),
    promiseStartedOn: c.promise_started_on,
    accountCreatedAt: iso(c.account_created_at),
    weekTargets: weeks.filter((w) => w.channel_id === c.id).map((w) => ({ weekStart: String(w.week_start), target: w.target })),
    posts: posts.filter((p) => p.channel_id === c.id).map((p) => ({ postId: p.post_id, kind: p.kind, text: p.text,
      postedAt: new Date(p.posted_at).toISOString(), deletedAt: iso(p.deleted_at),
      views: p.views, likes: p.likes, replies: p.replies, retweets: p.retweets, quotes: p.quotes, bookmarks: p.bookmarks })),
    snapshots: snaps.filter((s) => s.channel_id === c.id).map((s) => ({ capturedOn: s.captured_on, followers: s.followers })),
    lastCollectedAt: iso(c.last_collected_at),
    lastError: c.last_error as CollectError | null,
  }));
}

/** 점검 대상(약속이 있는 계정) 전부의 판정 입력. */
export async function listChannelInputs(sql: postgres.Sql, now: number = Date.now()): Promise<ChannelInput[]> {
  const rows = await sql<InputRow[]>`
    select o.id, o.client_id, o.handle, o.account_id, o.account_created_at, o.weekly_target,
           o.promise_started_on::text as promise_started_on, o.last_collected_at, o.last_error, o.created_at, c.name as client_name
    from owned_channel o join client c on c.id = o.client_id
    where o.weekly_target is not null`;
  return inputsFor(sql, rows, now);
}

export async function getChannelInput(sql: postgres.Sql, channelId: string, now: number = Date.now()): Promise<ChannelInput | null> {
  const rows = await sql<InputRow[]>`
    select o.id, o.client_id, o.handle, o.account_id, o.account_created_at, o.weekly_target,
           o.promise_started_on::text as promise_started_on, o.last_collected_at, o.last_error, o.created_at, c.name as client_name
    from owned_channel o join client c on c.id = o.client_id where o.id = ${channelId}`;
  const [one] = await inputsFor(sql, rows, now);
  return one ?? null;
}

/** 계정은 있는데 약속이 없는 곳 — 화면 아래 한 줄("여기 안 보여요")에 쓴다. */
export async function countUncheckedChannels(sql: postgres.Sql): Promise<number> {
  const [{ n }] = await sql<Array<{ n: number }>>`select count(*)::int as n from owned_channel where weekly_target is null`;
  return n;
}

// ─────────────────────────── monthly-report 온보딩(읽기만) ───────────────────────────

/**
 * 온보딩에서 클리닉이 알려 준 X 계정 — 칸이 비었을 때 [채우기] 제안에만 쓴다. 쓰지 않는다(ADR 0008과 같은 방식).
 * 경로: report.clinic.client_id = client.id → report.onboarding.clinic_id → channel_accounts.x(accountId 또는 url).
 * report 스키마가 없는 DB(연습용)면 null.
 */
export async function readOnboardingXHandle(sql: postgres.Sql, clientId: string): Promise<string | null> {
  const [has] = await sql<Array<{ ok: boolean }>>`
    select to_regclass('report.onboarding') is not null and to_regclass('report.clinic') is not null as ok`;
  if (!has?.ok) return null;
  return sql.begin('read only', async (tx) => {
    const rows = await tx<Array<{ account_id: string | null; url: string | null }>>`
      select o.channel_accounts->'x'->>'accountId' as account_id, o.channel_accounts->'x'->>'url' as url
      from report.onboarding o join report.clinic c on c.id = o.clinic_id
      where c.client_id = ${clientId} limit 1`;
    for (const v of [rows[0]?.account_id, rows[0]?.url]) {
      if (!v) continue;
      const p = parseXHandle(v);
      if (p.ok) return p.handle;
    }
    return null;
  });
}
