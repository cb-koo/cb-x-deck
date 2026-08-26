import type postgres from 'postgres';
import type { PostMetrics } from './postMetrics.ts';
import { assignRoles, type PostRole } from './postRole.ts';

export interface TrackedPostRow {
  id: string; tweetId: string; authorHandle: string | null; text: string;
  postedAt: string | null;            // ISO or null
  draftId: string | null;
  draftLabel: string | null;          // coalesce(draft.title, draft.ko_title) — 목록 표시용
  source: string;
  unavailableAt: string | null;       // ISO or null
  createdAt: string;                  // ISO
  metrics: PostMetrics | null;        // 최신 스냅샷 (없으면 null — 이론상 등록=첫 측정이라 항상 있음)
  capturedAt: string | null;          // 최신 스냅샷 시각 (ISO)
  role: PostRole | null;              // 사람이 고친 역할. null = 자동
  derivedRole: PostRole | null;       // 화면이 보여줄 역할(role ?? 판정). 원고 미연결이면 null — 판정 근거가 없다
}

type Row = {
  id: string; tweet_id: string; author_handle: string | null; text: string;
  posted_at: Date | null; draft_id: string | null;
  draft_title: string | null; draft_ko_title: string | null;
  source: string; unavailable_at: Date | null; created_at: Date;
  views: string | number | null; likes: number | null; retweets: number | null;
  replies: number | null; bookmarks: number | null; quotes: number | null;
  captured_at: Date | null;
  role: PostRole | null; is_reply: boolean | null; raw_urls: unknown;
};

// 목록·단건이 같은 정의를 쓴다(드리프트 방지) — lateral join으로 최신 스냅샷 1건만 붙인다.
const SELECT = (sql: postgres.Sql) => sql`
  select tp.id, tp.tweet_id, tp.author_handle, tp.text, tp.posted_at, tp.draft_id,
         d.title as draft_title, d.ko_title as draft_ko_title,
         tp.source, tp.unavailable_at, tp.created_at,
         s.views, s.likes, s.retweets, s.replies, s.bookmarks, s.quotes, s.captured_at,
         tp.role, (s.raw->>'isReply')::boolean as is_reply, s.raw #> '{entities,urls}' as raw_urls
    from tracked_post tp
    left join draft d on d.id = tp.draft_id
    left join lateral (
      select * from post_metric_snapshot where tracked_post_id = tp.id
      order by captured_at desc limit 1
    ) s on true`;

function toRow(r: Row): TrackedPostRow & { _isReply: boolean | null; _rawUrls: unknown } {
  const hasSnapshot = r.captured_at !== null;
  return {
    id: r.id, tweetId: r.tweet_id, authorHandle: r.author_handle, text: r.text,
    postedAt: r.posted_at ? new Date(r.posted_at).toISOString() : null,
    draftId: r.draft_id,
    draftLabel: r.draft_title ?? r.draft_ko_title ?? null,
    source: r.source,
    unavailableAt: r.unavailable_at ? new Date(r.unavailable_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    metrics: hasSnapshot ? {
      views: r.views === null ? null : Number(r.views), // bigint는 postgres.js가 문자열로 준다
      likes: r.likes, retweets: r.retweets, replies: r.replies,
      bookmarks: r.bookmarks, quotes: r.quotes,
    } : null,
    capturedAt: r.captured_at ? new Date(r.captured_at).toISOString() : null,
    role: r.role, derivedRole: null,   // derivedRole은 attachDerivedRoles가 채운다(원고 단위 판정이라 행 하나로는 못 정한다)
    _isReply: r.is_reply, _rawUrls: r.raw_urls,
  };
}

// _isReply/_rawUrls는 판정 재료일 뿐 공개 타입엔 없다 — 여기서 걷어낸다(destructuring rest는
// eslint no-unused-vars가 버려지는 키까지 "정의됐지만 안 쓰임"으로 잡아서 명시적으로 뺀다).
function stripInternal(
  r: TrackedPostRow & { _isReply: boolean | null; _rawUrls: unknown }, derivedRole: PostRole | null,
): TrackedPostRow {
  const {
    id, tweetId, authorHandle, text, postedAt, draftId, draftLabel, source,
    unavailableAt, createdAt, metrics, capturedAt, role,
  } = r;
  return {
    id, tweetId, authorHandle, text, postedAt, draftId, draftLabel, source,
    unavailableAt, createdAt, metrics, capturedAt, role, derivedRole,
  };
}

// 원고 단위 역할 판정 — 같은 원고의 게시물 전부와 그 원고 링크들의 short_url이 필요하다.
// 주어진 행만이 아니라 그 원고의 모든 게시물을 다시 읽는다(단건 조회여도 형제가 판정을 바꾼다).
async function attachDerivedRoles(sql: postgres.Sql, rows: Array<TrackedPostRow & { _isReply: boolean | null; _rawUrls: unknown }>): Promise<TrackedPostRow[]> {
  const draftIds = [...new Set(rows.map((r) => r.draftId).filter((v): v is string => v !== null))];
  if (draftIds.length === 0) return rows.map((r) => stripInternal(r, null));
  const siblings = await sql<Array<{ id: string; tweet_id: string; draft_id: string; posted_at: Date | null; role: PostRole | null; is_reply: boolean | null; raw_urls: unknown }>>`
    select tp.id, tp.tweet_id, tp.draft_id, tp.posted_at, tp.role,
           (s.raw->>'isReply')::boolean as is_reply, s.raw #> '{entities,urls}' as raw_urls
      from tracked_post tp
      left join lateral (select raw from post_metric_snapshot where tracked_post_id = tp.id order by captured_at desc limit 1) s on true
     where tp.draft_id = any(${draftIds}::uuid[])`;
  const links = await sql<Array<{ draft_id: string; short_url: string }>>`
    select draft_id, short_url from tracking_link where draft_id = any(${draftIds}::uuid[])`;
  const derived = new Map<string, PostRole>();
  for (const draftId of draftIds) {
    const posts = siblings.filter((s) => s.draft_id === draftId).map((s) => ({
      id: s.id, tweetId: s.tweet_id, postedAt: s.posted_at ? new Date(s.posted_at).toISOString() : null,
      role: s.role, rawUrls: s.raw_urls, isReply: s.is_reply,
    }));
    const shortUrls = links.filter((l) => l.draft_id === draftId).map((l) => l.short_url);
    for (const p of assignRoles(posts, shortUrls)) derived.set(p.id, p.role);
  }
  return rows.map((r) => stripInternal(r, r.draftId ? derived.get(r.id) ?? null : null));
}

// 한 게시물의 측정 이력 — 표에서 행을 펼치면 보이는 값들(최신이 위).
// raw(원본 응답)는 내보내지 않는다: 목록 SELECT와 같은 이유로 서버 밖으로 나갈 값이 아니다.
export interface MetricSnapshotRow {
  capturedAt: string;      // ISO
  metrics: PostMetrics;
}

type SnapRow = {
  captured_at: Date;
  views: string | number | null; likes: number | null; retweets: number | null;
  replies: number | null; bookmarks: number | null; quotes: number | null;
};

// limit: 이력이 길어져도 한 번에 다 그리지 않는다(자동 수집이 붙으면 게시물당 수백 건이 된다).
// 인덱스 (tracked_post_id, captured_at desc)를 그대로 타므로 얼마나 쌓이든 조회 비용은 일정하다.
export async function listSnapshots(
  sql: postgres.Sql, trackedPostId: string, limit = 50,
): Promise<MetricSnapshotRow[]> {
  const rows = await sql<SnapRow[]>`
    select captured_at, views, likes, retweets, replies, bookmarks, quotes
    from post_metric_snapshot
    where tracked_post_id = ${trackedPostId}
    order by captured_at desc
    limit ${limit}`;
  return rows.map((r) => ({
    capturedAt: new Date(r.captured_at).toISOString(),
    metrics: {
      views: r.views === null ? null : Number(r.views), // bigint는 postgres.js가 문자열로 준다
      likes: r.likes, retweets: r.retweets, replies: r.replies,
      bookmarks: r.bookmarks, quotes: r.quotes,
    },
  }));
}

export async function listTrackedPosts(sql: postgres.Sql): Promise<TrackedPostRow[]> {
  const rows = await sql<Row[]>`${SELECT(sql)} order by tp.created_at desc`;
  return attachDerivedRoles(sql, rows.map(toRow));
}

export async function findByTweetId(sql: postgres.Sql, tweetId: string): Promise<TrackedPostRow | null> {
  const rows = await sql<Row[]>`${SELECT(sql)} where tp.tweet_id = ${tweetId}`;
  return rows.length ? (await attachDerivedRoles(sql, [toRow(rows[0])]))[0] : null;
}

export async function findTrackedPostById(sql: postgres.Sql, id: string): Promise<TrackedPostRow | null> {
  const rows = await sql<Row[]>`${SELECT(sql)} where tp.id = ${id}`;
  return rows.length ? (await attachDerivedRoles(sql, [toRow(rows[0])]))[0] : null;
}

// 역할 수동 지정. null = 자동 판정으로 되돌리기.
export async function setRole(sql: postgres.Sql, trackedPostId: string, role: PostRole | null): Promise<boolean> {
  const rows = await sql`update tracked_post set role = ${role} where id = ${trackedPostId} returning id`;
  return rows.length > 0;
}

// 명부+첫 스냅샷을 한 트랜잭션으로 — 등록은 항상 측정과 함께다(등록만 하고 지표 없는 상태는 없다).
// tweet_id 충돌 시(동시 등록 경합의 최후 방어) 스냅샷을 만들지 않고 기존 행을 그대로 돌려준다.
export async function addTrackedPost(sql: postgres.Sql, args: {
  tweetId: string; authorHandle: string | null; text: string; postedAt: string | null;
  createdBy: string | null; metrics: PostMetrics; raw: unknown;
}): Promise<{ created: boolean; row: TrackedPostRow }> {
  return sql.begin(async (tx) => {
    const ins = await tx<Array<{ id: string }>>`
      insert into tracked_post (tweet_id, author_handle, text, posted_at, created_by)
      values (${args.tweetId}, ${args.authorHandle}, ${args.text}, ${args.postedAt}, ${args.createdBy})
      on conflict (tweet_id) do nothing
      returning id`;

    // sql.begin의 tx는 TransactionSql — postgres.Sql과 호환되지만 타입이 별도라 캐스트한다(생성기 선례).
    const txSql = tx as unknown as postgres.Sql;

    if (ins.length === 0) {
      const existing = await findByTweetId(txSql, args.tweetId);
      return { created: false, row: existing as TrackedPostRow };
    }

    const id = ins[0].id;
    const m = args.metrics;
    await tx`insert into post_metric_snapshot (tracked_post_id, views, likes, retweets, replies, bookmarks, quotes, raw)
      values (${id}, ${m.views}, ${m.likes}, ${m.retweets}, ${m.replies}, ${m.bookmarks}, ${m.quotes},
              ${args.raw ? tx.json(args.raw as never) : null})`;

    const row = await findTrackedPostById(txSql, id);
    return { created: true, row: row as TrackedPostRow };
  });
}

// 스냅샷 추가 + unavailable_at을 null로(복귀 수용 — 스펙): 다시 측정이 됐다는 것 자체가 복귀 증거다.
export async function appendSnapshot(
  sql: postgres.Sql, trackedPostId: string, metrics: PostMetrics, raw: unknown,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`insert into post_metric_snapshot (tracked_post_id, views, likes, retweets, replies, bookmarks, quotes, raw)
      values (${trackedPostId}, ${metrics.views}, ${metrics.likes}, ${metrics.retweets}, ${metrics.replies},
              ${metrics.bookmarks}, ${metrics.quotes}, ${raw ? tx.json(raw as never) : null})`;
    await tx`update tracked_post set unavailable_at = null where id = ${trackedPostId}`;
  });
}

// 이미 기록돼 있으면 시각 유지(최초 확인 시각 보존) — coalesce가 두 번째 호출을 no-op으로 만든다.
export async function markUnavailable(sql: postgres.Sql, trackedPostId: string): Promise<void> {
  await sql`update tracked_post set unavailable_at = coalesce(unavailable_at, now()) where id = ${trackedPostId}`;
}

export async function setDraftLink(
  sql: postgres.Sql, trackedPostId: string, draftId: string | null,
): Promise<boolean> {
  const rows = await sql`update tracked_post set draft_id = ${draftId} where id = ${trackedPostId} returning id`;
  return rows.length > 0;
}

export async function deleteTrackedPost(sql: postgres.Sql, trackedPostId: string): Promise<boolean> {
  const rows = await sql`delete from tracked_post where id = ${trackedPostId} returning id`; // 스냅샷은 cascade
  return rows.length > 0;
}
