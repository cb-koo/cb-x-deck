import type postgres from 'postgres';
import type { DraftRow } from './draftStore.ts';
import { listDraftsByCampaign } from './draftStore.ts';
import { kstToday } from './datetime.ts';
import { isUuidLike } from './uuid.ts';
import {
  parseExtraCosts, sumMoney, mergeMoney, isCurrency, type ExtraCost, type MoneyByCurrency,
} from './campaignCost.ts';
import {
  summarizeStages, deriveInfluencers, type CampaignKind, type CampaignSummary, type InfluencerLine,
} from './campaignJudgment.ts';

export { CAMPAIGN_KINDS, CAMPAIGN_KIND_LABEL, type CampaignKind } from './campaignJudgment.ts';

// 캠페인 = 클라이언트 1 × 기간 1 동안 나가는 원고 묶음(스펙 §0). 상태·인플 목록·합계는 저장하지 않는다 —
// 목록엔 SQL 집계(draft_count·통화별 합계)만 붙이고, 상세의 판정은 campaignJudgment 순수 함수가 한다(서버·클라 동일).
export interface CampaignRow {
  id: string; clientId: string | null; clientName: string | null;
  name: string; nameEn: string;
  startsOn: string; endsOn: string;    // 'YYYY-MM-DD'(서울) — to_char로 읽는다
  kind: CampaignKind | null; note: string;
  createdAt: string; updatedAt: string; // ISO
  draftCount: number;                   // 파생: 미사용 제외 원고 수(요약 N과 같은 모집단)
  total: MoneyByCurrency;               // 파생: 콘텐츠 비용(미사용 제외) + 추가 비용, 통화별
}

export interface CampaignPerf { postCount: number; views: number | null; likes: number | null }
// 상세 표의 한 행 — DraftRow + 게시됨 판정 + 성과. 게시됨 = tracked_post.draft_id 존재(§2-4).
export interface CampaignDraftItem extends DraftRow {
  published: boolean;
  perf: CampaignPerf | null;       // 게시됨일 때만. 최신 스냅샷(lateral) 게시물별 SUM. 스냅샷 없으면 views/likes null
  linkClicks: number | null;       // tracking_link 최신 스냅샷 합 — 게시 여부와 무관(요약 카드 합계용, §5)
}

export interface InfluencerCostRow {
  id: string; campaignId: string; influencerHandle: string;
  extraCosts: ExtraCost[]; note: string; updatedAt: string;
}

export interface CampaignDetail {
  campaign: CampaignRow;
  drafts: CampaignDraftItem[];
  costRows: InfluencerCostRow[];
  summary: CampaignSummary;        // summarizeStages(drafts, today) — 클라도 같은 함수로 재계산한다
  influencers: InfluencerLine[];   // deriveInfluencers(drafts, costRows)
  today: string;                   // 판정에 쓴 '오늘'(서울) — 클라가 같은 기준으로 다시 그릴 수 있게 함께 내려준다
}

export interface InfluencerCampaignItem {
  id: string; name: string; startsOn: string; endsOn: string;
  contentCount: number; subtotal: MoneyByCurrency;
}

type CRow = {
  id: string; client_id: string | null; client_name: string | null; name: string; name_en: string;
  starts_on: string; ends_on: string; kind: CampaignKind | null; note: string;
  created_at: Date; updated_at: Date; draft_count: string | number;
};
type TotalRow = { campaign_id: string; currency: string; amount: string | number };
type CicRow = { id: string; campaign_id: string; influencer_handle: string; extra_costs: unknown; note: string; updated_at: Date };

// jsonb 모양은 보증되지 않는다 — 검증 통과분만(draftStore.costOf와 같은 태도)
function extraCostsOf(v: unknown): ExtraCost[] {
  const p = parseExtraCosts(v ?? []);
  return p.ok ? p.value : [];
}

const toCic = (r: CicRow): InfluencerCostRow => ({
  id: r.id, campaignId: r.campaign_id, influencerHandle: r.influencer_handle,
  extraCosts: extraCostsOf(r.extra_costs), note: r.note, updatedAt: new Date(r.updated_at).toISOString(),
});

// 목록·단건이 같은 정의를 쓴다(드리프트 방지). draft_count는 미사용 제외 — 요약 카드 N과 같은 모집단(§2-4).
const SELECT = (sql: postgres.Sql) => sql`
  select c.id, c.client_id, c.client_name, c.name, c.name_en,
         to_char(c.starts_on, 'YYYY-MM-DD') as starts_on, to_char(c.ends_on, 'YYYY-MM-DD') as ends_on,
         c.kind, c.note, c.created_at, c.updated_at,
         (select count(*) from draft d where d.campaign_id = c.id and d.status <> 'unused') as draft_count
    from campaign c`;

// 통화별 합계 — 콘텐츠 비용(미사용 제외) + 추가 비용을 SQL에서 통화별로 묶는다. 통화 간 합산은 하지 않는다.
// 캠페인 수는 소수라 목록 1회 + 합계 1회의 두 쿼리로 충분하다.
async function totalsFor(sql: postgres.Sql, ids: string[]): Promise<Map<string, MoneyByCurrency>> {
  const out = new Map<string, MoneyByCurrency>();
  if (ids.length === 0) return out;
  const rows = await sql<TotalRow[]>`
    select campaign_id, currency, sum(amount) as amount from (
      select d.campaign_id, d.cost->>'currency' as currency, (d.cost->>'amount')::bigint as amount
        from draft d
       where d.campaign_id = any(${ids}::uuid[]) and d.cost is not null and d.status <> 'unused'
      union all
      select cic.campaign_id, e->>'currency', (e->>'amount')::bigint
        from campaign_influencer_cost cic, jsonb_array_elements(cic.extra_costs) e
       where cic.campaign_id = any(${ids}::uuid[])
    ) t group by campaign_id, currency`;
  for (const r of rows) {
    if (!isCurrency(r.currency)) continue; // 알 수 없는 통화는 합계에 섣불리 넣지 않는다
    const m = out.get(r.campaign_id) ?? {};
    m[r.currency] = (m[r.currency] ?? 0) + Number(r.amount); // sum(bigint)는 문자열로 온다
    out.set(r.campaign_id, m);
  }
  return out;
}

async function toRows(sql: postgres.Sql, rows: CRow[]): Promise<CampaignRow[]> {
  const totals = await totalsFor(sql, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, clientId: r.client_id, clientName: r.client_name, name: r.name, nameEn: r.name_en,
    startsOn: r.starts_on, endsOn: r.ends_on, kind: r.kind, note: r.note,
    createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
    draftCount: Number(r.draft_count),
    total: totals.get(r.id) ?? {},
  }));
}

export async function createCampaign(sql: postgres.Sql, input: {
  clientId: string; clientName: string; name: string; nameEn: string;
  startsOn: string; endsOn: string; kind: CampaignKind | null; note: string; createdBy: string | null;
}): Promise<CampaignRow> {
  const ins = await sql<Array<{ id: string }>>`
    insert into campaign (client_id, client_name, name, name_en, starts_on, ends_on, kind, note, created_by)
    values (${input.clientId}, ${input.clientName}, ${input.name}, ${input.nameEn},
            ${input.startsOn}::date, ${input.endsOn}::date, ${input.kind}, ${input.note}, ${input.createdBy})
    returning id`;
  const row = await getCampaign(sql, ins[0].id);
  if (!row) throw new Error('campaign insert 직후 재조회 실패'); // 단언은 경합 시 null을 통과시킨다
  return row;
}

export async function listCampaigns(sql: postgres.Sql): Promise<CampaignRow[]> {
  // 최근 기간이 위 — 그룹(진행 중/예정/종료)은 클라가 campaignStatus로 나눈다
  const rows = await sql<CRow[]>`${SELECT(sql)} order by c.starts_on desc, c.created_at desc`;
  return toRows(sql, rows);
}

export async function getCampaign(sql: postgres.Sql, id: string): Promise<CampaignRow | null> {
  if (!isUuidLike(id)) return null; // 형식이 아니면 DB까지 가기 전에 끊는다(22P02 방지) — 라우트가 404로 처리
  const rows = await sql<CRow[]>`${SELECT(sql)} where c.id = ${id}`;
  return rows.length ? (await toRows(sql, rows))[0] : null;
}

export async function updateCampaign(
  sql: postgres.Sql, id: string,
  patch: { name?: string; nameEn?: string; startsOn?: string; endsOn?: string; kind?: CampaignKind | null; note?: string },
): Promise<void> {
  if (!isUuidLike(id)) return; // 형식이 아니면 DB까지 가기 전에 끊는다(22P02 방지) — 라우트가 404로 처리
  // kind만 case when — null이 '유형 없음'이라는 뜻을 갖는 유일한 필드(draftStore.influencer_handle과 같은 구조)
  await sql`update campaign set
      name = coalesce(${patch.name ?? null}, name),
      name_en = coalesce(${patch.nameEn ?? null}, name_en),
      starts_on = coalesce(${patch.startsOn ?? null}::date, starts_on),
      ends_on = coalesce(${patch.endsOn ?? null}::date, ends_on),
      kind = case when ${patch.kind !== undefined} then ${patch.kind ?? null}::text else kind end,
      note = coalesce(${patch.note ?? null}, note),
      updated_at = now()
    where id = ${id}`;
}

// 원고는 지우지 않는다 — draft.campaign_id는 FK set null, 비용 행은 cascade(스펙 §2-5)
export async function deleteCampaign(sql: postgres.Sql, id: string): Promise<boolean> {
  if (!isUuidLike(id)) return false; // 형식이 아니면 DB까지 가기 전에 끊는다(22P02 방지) — 라우트가 404로 처리
  const del = await sql`delete from campaign where id = ${id} returning id`;
  return del.length > 0;
}

type PerfRow = { draft_id: string; post_count: number; views: string | number | null; likes: string | number | null };
type ClickRow = { draft_id: string; clicks: string | number | null };

export async function getCampaignDetail(
  sql: postgres.Sql, id: string, today: string = kstToday(),
): Promise<CampaignDetail | null> {
  if (!isUuidLike(id)) return null; // 형식이 아니면 DB까지 가기 전에 끊는다(22P02 방지) — 라우트가 404로 처리
  const campaign = await getCampaign(sql, id);
  if (!campaign) return null;
  const drafts = await listDraftsByCampaign(sql, id);

  // 게시됨 + 성과: 원고에 게시물이 여러 개면(tracked_post는 tweet_id만 unique) 각 게시물의 최신 스냅샷을 합산한다(§2-4).
  // 최신 1건은 lateral(trackingStore 관례). 스냅샷이 없는 게시물은 sum에서 null로 빠진다.
  const perfRows = await sql<PerfRow[]>`
    select tp.draft_id, count(tp.id)::int as post_count, sum(s.views) as views, sum(s.likes) as likes
      from tracked_post tp
      left join lateral (
        select views, likes from post_metric_snapshot where tracked_post_id = tp.id
        order by captured_at desc limit 1
      ) s on true
     where tp.draft_id in (select d.id from draft d where d.campaign_id = ${id})
     group by tp.draft_id`;
  // 링크 클릭: 원고에 링크가 여럿이면(tracking_link는 draft_id 인덱스만) 최신 스냅샷 합(§5)
  const clickRows = await sql<ClickRow[]>`
    select l.draft_id, sum(s.total_clicks) as clicks
      from tracking_link l
      left join lateral (
        select total_clicks from link_click_snapshot where tracking_link_id = l.id
        order by captured_at desc limit 1
      ) s on true
     where l.draft_id in (select d.id from draft d where d.campaign_id = ${id})
     group by l.draft_id`;
  const perfMap = new Map(perfRows.map((r) => [r.draft_id, r]));
  const clickMap = new Map(clickRows.map((r) => [r.draft_id, r]));
  const num = (v: string | number | null) => (v === null ? null : Number(v)); // sum(bigint)는 문자열

  const items: CampaignDraftItem[] = drafts.map((d) => {
    const p = perfMap.get(d.id);
    const c = clickMap.get(d.id);
    return {
      ...d,
      published: p !== undefined,
      perf: p ? { postCount: p.post_count, views: num(p.views), likes: num(p.likes) } : null,
      linkClicks: c ? num(c.clicks) : null,
    };
  });

  const cic = await sql<CicRow[]>`
    select id, campaign_id, influencer_handle, extra_costs, note, updated_at
      from campaign_influencer_cost where campaign_id = ${id} order by lower(influencer_handle)`;
  const costRows = cic.map(toCic);

  return {
    campaign, drafts: items, costRows,
    summary: summarizeStages(items, today),
    influencers: deriveInfluencers(items, costRows),
    today,
  };
}

// 추가 비용·메모 upsert — 행은 처음 적을 때 생긴다(§2-2). 표현식 유니크(campaign_id, lower(handle))로 충돌을 잡고,
// 부분 패치(undefined=유지)는 coalesce로. 표기는 처음 저장된 것을 보존한다(ensureInfluencer 관례).
export async function upsertInfluencerCost(
  sql: postgres.Sql, campaignId: string, handle: string,
  patch: { extraCosts?: ExtraCost[]; note?: string },
): Promise<InfluencerCostRow> {
  const rows = await sql<CicRow[]>`
    insert into campaign_influencer_cost (campaign_id, influencer_handle, extra_costs, note)
    values (${campaignId}, ${handle}, ${sql.json((patch.extraCosts ?? []) as never)}, ${patch.note ?? ''})
    on conflict (campaign_id, (lower(influencer_handle))) do update set
      extra_costs = coalesce(${patch.extraCosts ? sql.json(patch.extraCosts as never) : null}, campaign_influencer_cost.extra_costs),
      note = coalesce(${patch.note ?? null}, campaign_influencer_cost.note),
      updated_at = now()
    returning id, campaign_id, influencer_handle, extra_costs, note, updated_at`;
  return toCic(rows[0]);
}

// 인플루언서 프로필 "참여 캠페인"(§5) — 원고가 배정됐거나 비용 행이 있는 캠페인. 조회만, 로그 없음.
export async function listInfluencerCampaigns(sql: postgres.Sql, handle: string): Promise<InfluencerCampaignItem[]> {
  const lower = handle.toLowerCase();
  const drafts = await sql<Array<{ campaign_id: string; status: string; cost: unknown }>>`
    select campaign_id, status, cost from draft
     where campaign_id is not null and lower(influencer_handle) = ${lower}`;
  const cic = await sql<Array<{ campaign_id: string; extra_costs: unknown }>>`
    select campaign_id, extra_costs from campaign_influencer_cost where lower(influencer_handle) = ${lower}`;
  const ids = [...new Set([...drafts.map((d) => d.campaign_id), ...cic.map((c) => c.campaign_id)])];
  if (ids.length === 0) return [];
  const camps = await sql<Array<{ id: string; name: string; starts_on: string; ends_on: string }>>`
    select id, name, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on
      from campaign where id = any(${ids}::uuid[]) order by starts_on desc, created_at desc`;
  return camps.map((c) => {
    const mine = drafts.filter((d) => d.campaign_id === c.id && d.status !== 'unused');
    const costs = mine.flatMap((d) => {
      const o = d.cost as { amount?: unknown; currency?: unknown } | null;
      return o && typeof o.amount === 'number' && isCurrency(o.currency) ? [{ amount: o.amount, currency: o.currency }] : [];
    });
    const extra = cic.filter((x) => x.campaign_id === c.id).flatMap((x) => extraCostsOf(x.extra_costs));
    return {
      id: c.id, name: c.name, startsOn: c.starts_on, endsOn: c.ends_on,
      contentCount: mine.length, subtotal: mergeMoney(sumMoney(costs), sumMoney(extra)),
    };
  });
}
