import type postgres from 'postgres';

export interface LinkClicks { totalClicks: number | null; humanClicks: number | null }

export interface TrackingLinkRow {
  id: string; code: string;
  landingUrl: string; longUrl: string; shortUrl: string; shortioLinkId: string;
  utmCampaign: string; influencerHandle: string;
  draftId: string | null;
  draftLabel: string | null;      // coalesce(draft.title, draft.ko_title) — 목록 표시용(trackingStore 관례)
  clientId: string | null; clientName: string | null;
  unavailableAt: string | null;   // short.io 쪽 링크 소실 확인 시각(ISO). null = 정상
  createdAt: string;              // ISO
  clicks: LinkClicks | null;      // 최신 스냅샷 (없으면 null — 링크는 클릭 0에서 시작하므로 '측정 전'이 실재한다)
  capturedAt: string | null;      // 최신 스냅샷 시각(ISO)
}

type Row = {
  id: string; code: string; landing_url: string; long_url: string; short_url: string;
  shortio_link_id: string; utm_campaign: string; influencer_handle: string;
  draft_id: string | null; draft_title: string | null; draft_ko_title: string | null;
  client_id: string | null; client_name: string | null;
  unavailable_at: Date | null; created_at: Date;
  total_clicks: number | null; human_clicks: number | null; captured_at: Date | null;
};

// 목록·단건이 같은 정의를 쓴다(드리프트 방지) — lateral join으로 최신 스냅샷 1건만 붙인다(trackingStore 관례).
const SELECT = (sql: postgres.Sql) => sql`
  select l.id, l.code, l.landing_url, l.long_url, l.short_url, l.shortio_link_id,
         l.utm_campaign, l.influencer_handle, l.draft_id,
         d.title as draft_title, d.ko_title as draft_ko_title,
         l.client_id, l.client_name, l.unavailable_at, l.created_at,
         s.total_clicks, s.human_clicks, s.captured_at
    from tracking_link l
    left join draft d on d.id = l.draft_id
    left join lateral (
      select * from link_click_snapshot where tracking_link_id = l.id
      order by captured_at desc limit 1
    ) s on true`;

function toRow(r: Row): TrackingLinkRow {
  return {
    id: r.id, code: r.code,
    landingUrl: r.landing_url, longUrl: r.long_url, shortUrl: r.short_url,
    shortioLinkId: r.shortio_link_id, utmCampaign: r.utm_campaign,
    influencerHandle: r.influencer_handle,
    draftId: r.draft_id, draftLabel: r.draft_title ?? r.draft_ko_title ?? null,
    clientId: r.client_id, clientName: r.client_name,
    unavailableAt: r.unavailable_at ? new Date(r.unavailable_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    clicks: r.captured_at !== null ? { totalClicks: r.total_clicks, humanClicks: r.human_clicks } : null,
    capturedAt: r.captured_at ? new Date(r.captured_at).toISOString() : null,
  };
}

export async function listLinks(sql: postgres.Sql, opts?: { draftId?: string }): Promise<TrackingLinkRow[]> {
  const rows = opts?.draftId
    ? await sql<Row[]>`${SELECT(sql)} where l.draft_id = ${opts.draftId} order by l.created_at desc`
    : await sql<Row[]>`${SELECT(sql)} order by l.created_at desc`;
  return rows.map(toRow);
}

export async function findLinkById(sql: postgres.Sql, id: string): Promise<TrackingLinkRow | null> {
  const rows = await sql<Row[]>`${SELECT(sql)} where l.id = ${id}`;
  return rows.length ? toRow(rows[0]) : null;
}

// 스냅샷 없이 명부만 만든다 — 링크 생성은 측정이 아니다(클릭은 0에서 시작, 스펙 §데이터 모델).
// code unique 충돌은 그대로 던진다: short.io 409를 먼저 통과했다면 사실상 도달 불가(스펙 §생성 흐름).
export async function insertLink(sql: postgres.Sql, args: {
  code: string; landingUrl: string; longUrl: string; shortUrl: string; shortioLinkId: string;
  utmCampaign: string; influencerHandle: string;
  draftId: string | null; clientId: string | null; clientName: string | null; createdBy: string | null;
}): Promise<TrackingLinkRow> {
  const ins = await sql<Array<{ id: string }>>`
    insert into tracking_link (code, landing_url, long_url, short_url, shortio_link_id,
                               utm_campaign, influencer_handle, draft_id, client_id, client_name, created_by)
    values (${args.code}, ${args.landingUrl}, ${args.longUrl}, ${args.shortUrl}, ${args.shortioLinkId},
            ${args.utmCampaign}, ${args.influencerHandle}, ${args.draftId}, ${args.clientId},
            ${args.clientName}, ${args.createdBy})
    returning id`;
  return (await findLinkById(sql, ins[0].id)) as TrackingLinkRow;
}

// 스냅샷 추가 + unavailable_at 복귀 수용(appendSnapshot 관례) — 다시 측정됐다는 것 자체가 복귀 증거다.
export async function appendClickSnapshot(
  sql: postgres.Sql, trackingLinkId: string, clicks: LinkClicks, raw: unknown,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`insert into link_click_snapshot (tracking_link_id, total_clicks, human_clicks, raw)
      values (${trackingLinkId}, ${clicks.totalClicks}, ${clicks.humanClicks},
              ${raw ? tx.json(raw as never) : null})`;
    await tx`update tracking_link set unavailable_at = null where id = ${trackingLinkId}`;
  });
}

// 이미 기록돼 있으면 시각 유지(최초 확인 시각 보존) — markUnavailable 관례.
export async function markLinkUnavailable(sql: postgres.Sql, trackingLinkId: string): Promise<void> {
  await sql`update tracking_link set unavailable_at = coalesce(unavailable_at, now()) where id = ${trackingLinkId}`;
}

export async function deleteLink(sql: postgres.Sql, trackingLinkId: string): Promise<boolean> {
  const rows = await sql`delete from tracking_link where id = ${trackingLinkId} returning id`; // 스냅샷은 cascade
  return rows.length > 0;
}

export interface LinkClickSnapshotRow {
  capturedAt: string; totalClicks: number | null; humanClicks: number | null;
}

// limit: 이력이 길어져도 한 번에 다 그리지 않는다(listSnapshots 관례 — 인덱스가 정렬을 그대로 탄다).
export async function listClickSnapshots(
  sql: postgres.Sql, trackingLinkId: string, limit = 50,
): Promise<LinkClickSnapshotRow[]> {
  const rows = await sql<Array<{ captured_at: Date; total_clicks: number | null; human_clicks: number | null }>>`
    select captured_at, total_clicks, human_clicks
    from link_click_snapshot
    where tracking_link_id = ${trackingLinkId}
    order by captured_at desc
    limit ${limit}`;
  return rows.map((r) => ({
    capturedAt: new Date(r.captured_at).toISOString(),
    totalClicks: r.total_clicks, humanClicks: r.human_clicks,
  }));
}
