// src/lib/performanceStore.ts
// 성과 화면의 읽기 모델 — 콘텐츠(=링크) 한 행에 원고·게시물(역할)·클릭·랜딩 도착/탭을 모은다.
// 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md §읽기 모델
import type postgres from 'postgres';
import { assignRoles, type PostRole } from './postRole.ts';
import { rangeStart, statsByUtmContent, unlinkedStats, type Range, type UnlinkedStats } from './landingEventStore.ts';

export interface CampaignOption { code: string; clientName: string | null; latestAt: string }

// 캠페인 = tracking_link.utm_campaign(캠페인 관리의 name_en과 같은 값). 최근 링크가 만들어진 순.
export async function listCampaigns(sql: postgres.Sql): Promise<CampaignOption[]> {
  const rows = await sql<Array<{ utm_campaign: string; client_name: string | null; latest_at: Date }>>`
    select utm_campaign,
           (array_agg(client_name order by created_at desc) filter (where client_name is not null))[1] as client_name,
           max(created_at) as latest_at
      from tracking_link group by utm_campaign order by latest_at desc`;
  return rows.map((r) => ({ code: r.utm_campaign, clientName: r.client_name, latestAt: new Date(r.latest_at).toISOString() }));
}

export interface ContentPost { tweetId: string; authorHandle: string | null; role: PostRole; views: number | null; postedAt: string | null }

export interface ContentRow {
  linkId: string; utmContent: string; utmCampaign: string;
  draftId: string | null; title: string;              // draft.title → ko_title → utm_content
  format: 'single' | 'thread' | null; threadTotal: number | null;
  influencerHandle: string; postedAt: string | null;  // main 게시물의 게시 시각
  views: number | null;                                // main 최신 조회. null = 게시물 연결 전
  clicks: number | null;                               // 최신 link_click_snapshot.total_clicks. null = 측정 전
  arrivals: number; taps: number; visits: number;      // 사람 도착·탭·전체 방문(기간 적용)
  posts: ContentPost[];                                // 스레드 읽기 흐름(main → thread → link)
  capturedAt: string | null;                           // 조회·클릭 스냅샷 중 가장 이른 시각
  sharedUtmContent: boolean;                           // 같은 utm_content를 쓰는 링크가 둘 이상
}

type LinkRow = {
  id: string; utm_key: string; utm_campaign: string; draft_id: string | null; influencer_handle: string; short_url: string;
  title: string | null; ko_title: string | null; format: 'single' | 'thread' | null; posts_total: number | null;
  total_clicks: number | null; click_captured_at: Date | null;
};
type PostRow = {
  id: string; tweet_id: string; author_handle: string | null; draft_id: string; posted_at: Date | null; role: PostRole | null;
  views: string | number | null; captured_at: Date | null; is_reply: boolean | null; raw_urls: unknown;
};

export async function listContentRows(sql: postgres.Sql, campaign: string, since: Date | null): Promise<ContentRow[]> {
  const links = await sql<LinkRow[]>`
    select l.id, coalesce(l.utm_content, l.code) as utm_key, l.utm_campaign, l.draft_id, l.influencer_handle, l.short_url,
           d.title, d.ko_title, d.format,
           jsonb_array_length(coalesce(d.edited, d.content)->'posts') as posts_total,
           s.total_clicks, s.captured_at as click_captured_at
      from tracking_link l
      left join draft d on d.id = l.draft_id
      left join lateral (select total_clicks, captured_at from link_click_snapshot where tracking_link_id = l.id order by captured_at desc limit 1) s on true
     where l.utm_campaign = ${campaign}
     order by l.created_at desc`;
  if (links.length === 0) return [];

  const draftIds = [...new Set(links.map((l) => l.draft_id).filter((v): v is string => v !== null))];
  const posts = draftIds.length === 0 ? [] : await sql<PostRow[]>`
    select tp.id, tp.tweet_id, tp.author_handle, tp.draft_id, tp.posted_at, tp.role,
           s.views, s.captured_at, (s.raw->>'isReply')::boolean as is_reply, s.raw #> '{entities,urls}' as raw_urls
      from tracked_post tp
      left join lateral (select views, captured_at, raw from post_metric_snapshot where tracked_post_id = tp.id order by captured_at desc limit 1) s on true
     where tp.draft_id = any(${draftIds}::uuid[])`;
  // 역할 판정에는 그 원고의 링크 전부(다른 캠페인 포함)가 필요하다
  const allLinks = draftIds.length === 0 ? [] : await sql<Array<{ draft_id: string; short_url: string }>>`
    select draft_id, short_url from tracking_link where draft_id = any(${draftIds}::uuid[])`;

  const stats = await statsByUtmContent(sql, links.map((l) => l.utm_key), since);
  const keyCount = new Map<string, number>();
  for (const l of links) keyCount.set(l.utm_key, (keyCount.get(l.utm_key) ?? 0) + 1);

  return links.map((l) => {
    const mine = posts.filter((p) => p.draft_id === l.draft_id).map((p) => ({
      id: p.id, tweetId: p.tweet_id, authorHandle: p.author_handle,
      postedAt: p.posted_at ? new Date(p.posted_at).toISOString() : null,
      role: p.role, rawUrls: p.raw_urls, isReply: p.is_reply,
      views: p.views === null ? null : Number(p.views), // bigint는 문자열로 온다(trackingStore 관례)
      capturedAt: p.captured_at ? new Date(p.captured_at).toISOString() : null,
    }));
    const roled = l.draft_id ? assignRoles(mine, allLinks.filter((x) => x.draft_id === l.draft_id).map((x) => x.short_url)) : [];
    const main = roled.find((p) => p.role === 'main') ?? null;
    const st = stats.get(l.utm_key);
    const captured = [l.click_captured_at ? new Date(l.click_captured_at).toISOString() : null, main?.capturedAt ?? null]
      .filter((v): v is string => v !== null).sort();
    return {
      linkId: l.id, utmContent: l.utm_key, utmCampaign: l.utm_campaign,
      draftId: l.draft_id, title: l.title ?? l.ko_title ?? l.utm_key,
      format: l.format, threadTotal: l.format === 'thread' ? l.posts_total : null,
      influencerHandle: l.influencer_handle, postedAt: main?.postedAt ?? null,
      views: main?.views ?? null, clicks: l.total_clicks,
      arrivals: st?.arrivals ?? 0, taps: st?.taps ?? 0, visits: st?.visits ?? 0,
      posts: roled.map((p) => ({ tweetId: p.tweetId, authorHandle: p.authorHandle, role: p.role, views: p.views, postedAt: p.postedAt })),
      capturedAt: captured[0] ?? null,
      sharedUtmContent: (keyCount.get(l.utm_key) ?? 0) > 1,
    };
  });
}

export interface PerformanceData {
  campaigns: CampaignOption[]; selected: string | null; range: Range;
  rows: ContentRow[]; unlinked: UnlinkedStats;
  excluded: number;            // 프리페치·봇으로 보이는 방문(utm_content 단위 중복 없이)
  snapshotAt: string | null;   // 행들의 capturedAt 중 가장 이른 것 — "마지막 새로고침 기준" 표기
}

// 없는 캠페인을 요청하면 최근 캠페인으로 대체하고 selected로 알려준다(캠페인 관리의 ?id= 관례).
export async function loadPerformance(
  sql: postgres.Sql, campaign: string | null, range: Range, now: () => number = Date.now,
): Promise<PerformanceData> {
  const campaigns = await listCampaigns(sql);
  const selected = campaigns.find((c) => c.code === campaign)?.code ?? campaigns[0]?.code ?? null;
  const since = rangeStart(range, now);
  if (selected === null) {
    return { campaigns, selected: null, range, rows: [], unlinked: { total: 0, byContent: [] }, excluded: 0, snapshotAt: null };
  }
  const rows = await listContentRows(sql, selected, since);
  const keys = [...new Set(rows.map((r) => r.utmContent))];
  const byKey = new Map(rows.map((r) => [r.utmContent, r]));
  const excluded = keys.reduce((s, k) => { const r = byKey.get(k)!; return s + (r.visits - r.arrivals); }, 0);
  const unlinked = await unlinkedStats(sql, keys, selected, since);
  const snapshotAt = rows.map((r) => r.capturedAt).filter((v): v is string => v !== null).sort()[0] ?? null;
  return { campaigns, selected, range, rows, unlinked, excluded, snapshotAt };
}
