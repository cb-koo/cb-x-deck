import type postgres from 'postgres';
import { kstToday } from './datetime.ts';
import { isUuidLike } from './uuid.ts';
import {
  parseExtraCosts, parseTaskCost, sumMoney, mergeMoney, isCurrency, type ExtraCost, type MoneyByCurrency,
} from './campaignCost.ts';
import {
  listTasksByCampaign, countTasksForCampaignDelete, settlementByTaskIds, type TaskRow, type SettlementBadge,
} from './campaignTaskStore.ts';
import {
  summarizeTasks, deriveTaskInfluencers, subtotalsByType,
  type CampaignKind, type TaskSummary, type TaskInfluencerLine, type TypeSubtotal, type TaskType,
} from './campaignJudgment.ts';
import { listBudgetPeriods } from './budgetPeriodStore.ts';
import {
  campaignPeriodBudget, periodFor, toKrw, JPY_TO_KRW, type PeriodSpend, type SpanningCampaign, type CampaignPeriodBudget,
} from './clientBudget.ts';
import { getDefaultPaymentMethod, type PaymentMethod } from './influencerPayment.ts';
import { computeMoney } from './settlementCalc.ts';

export { CAMPAIGN_KINDS, CAMPAIGN_KIND_LABEL, type CampaignKind } from './campaignJudgment.ts';

// 캠페인 = 클라이언트 1 × 기간 1 동안 나가는 작업 묶음(스펙 2026-08-28 §0). 상태·인플 목록·합계는 저장하지 않는다 —
// 목록엔 SQL 집계(task_count·통화별 합계)만 붙이고, 상세의 판정은 campaignJudgment 순수 함수가 한다(서버·클라 동일).
export interface CampaignRow {
  id: string; clientId: string | null; clientName: string | null;
  name: string; nameEn: string;
  startsOn: string; endsOn: string;    // 'YYYY-MM-DD'(서울) — to_char로 읽는다
  kind: CampaignKind | null; note: string;
  createdAt: string; updatedAt: string; // ISO
  taskCount: number;                    // 파생: 취소 제외 작업 수(요약 N과 같은 모집단, R17)
  total: MoneyByCurrency;               // 파생: 작업 비용(취소 제외) + 추가 비용, 통화별
}

export interface CampaignPerf { postCount: number; views: number | null; likes: number | null; bookmarks: number | null }
// 상세 표의 한 행 — TaskRow + 게시 확인 + 성과.
export interface CampaignTaskItem extends TaskRow {
  published: boolean;              // = postedAt !== null (게시 확인이 판정한다, tracked_post 유무가 아니다 — §2-5)
  perf: CampaignPerf | null;       // tracked_post.task_id 최신 스냅샷(lateral) 합. 스냅샷 없으면 views/likes null
  linkClicks: number | null;       // 붙은 원고의 tracking_link 최신 스냅샷 합 — 게시 여부와 무관(요약 카드 합계용, §5)
  settlement: SettlementBadge | null;   // 표의 정산 배지(정산 스펙 §4-4) — settlementByTaskIds
}
export interface InfluencerCostRow {
  id: string; campaignId: string; influencerHandle: string;
  extraCosts: ExtraCost[]; note: string; updatedAt: string;
}

export interface CampaignDetail {
  campaign: CampaignRow;
  tasks: CampaignTaskItem[];
  costRows: InfluencerCostRow[];
  summary: TaskSummary;                // summarizeTasks(tasks, today) — 클라도 같은 함수로 재계산한다
  influencers: TaskInfluencerLine[];   // deriveTaskInfluencers(tasks, costRows)
  byType: TypeSubtotal[];              // subtotalsByType(tasks) — 표 하단 유형별 줄
  deleteInfo: { taskCount: number; detachedTargets: number; activeRequests: number };   // 삭제 확인 문구의 숫자(§4-4) — 미사용 포함 전수
  today: string;                       // 판정에 쓴 '오늘'(서울) — 클라가 같은 기준으로 다시 그릴 수 있게 함께 내려준다
  budget: CampaignPeriodBudget | null;  // 이 캠페인이 속한 기간의 클라이언트 예산(스펙 2026-09-22 §5-2). 클라 없으면 null
}

export interface InfluencerCampaignItem {
  id: string; name: string; startsOn: string; endsOn: string;
  taskCount: number; countsByType: Partial<Record<TaskType, number>>; subtotal: MoneyByCurrency;
}

type CRow = {
  id: string; client_id: string | null; client_name: string | null; name: string; name_en: string;
  starts_on: string; ends_on: string; kind: CampaignKind | null; note: string;
  created_at: Date; updated_at: Date; task_count: string | number;
};
type TotalRow = { campaign_id: string; currency: string; amount: string | number };
type FeeRow = { campaign_id: string; cost: unknown; payment_methods: unknown };
type CicRow = { id: string; campaign_id: string; influencer_handle: string; extra_costs: unknown; note: string; updated_at: Date };

// totalsFor의 캠페인별 결과 — money(통화별 합계)에 수수료 합계(원화, §3-2 예상치)를 더한 것.
// feeUnknown은 결제 수단이 없어 수수료를 구하지 못한 작업 수(화면이 "수수료 미확인 N건" 문구로 밝힌다).
interface CampaignTotals { money: MoneyByCurrency; feeKrw: number; feeUnknown: number }

// jsonb 모양은 보증되지 않는다 — 검증 통과분만(draftStore.costOf와 같은 태도)
function extraCostsOf(v: unknown): ExtraCost[] {
  const p = parseExtraCosts(v ?? []);
  return p.ok ? p.value : [];
}

const toCic = (r: CicRow): InfluencerCostRow => ({
  id: r.id, campaignId: r.campaign_id, influencerHandle: r.influencer_handle,
  extraCosts: extraCostsOf(r.extra_costs), note: r.note, updatedAt: new Date(r.updated_at).toISOString(),
});

// 목록·단건이 같은 정의를 쓴다(드리프트 방지). task_count는 취소 제외 — 요약 카드 N(summarizeTasks)과
// 같은 모집단(R17)이라 목록 보조줄과 상세 카드가 같은 수를 말한다(§4-1). 옛 "미사용 원고 붙고 미게시" 제외는 폐지.
const SELECT = (sql: postgres.Sql) => sql`
  select c.id, c.client_id, c.client_name, c.name, c.name_en,
         to_char(c.starts_on, 'YYYY-MM-DD') as starts_on, to_char(c.ends_on, 'YYYY-MM-DD') as ends_on,
         c.kind, c.note, c.created_at, c.updated_at,
         (select count(*) from campaign_task t
           where t.campaign_id = c.id and t.cancelled_at is null) as task_count
    from campaign c`;

// 통화별 합계 — 작업 비용(취소 제외) + 추가 비용을 SQL에서 통화별로 묶는다. 통화 간 합산은 하지 않는다.
// 캠페인 수는 소수라 목록 1회 + 합계 1회(+ 수수료 1회)의 세 쿼리로 충분하다.
// 수수료(§3-2, 예상치)는 작업 쪽에서만 나온다 — 추가 비용(extra_costs)은 인플에게 송금하는 돈이 아니라서 얹지 않는다.
async function totalsFor(sql: postgres.Sql, ids: string[]): Promise<Map<string, CampaignTotals>> {
  const out = new Map<string, CampaignTotals>();
  if (ids.length === 0) return out;
  const rows = await sql<TotalRow[]>`
    select campaign_id, currency, sum(amount) as amount from (
      select t.campaign_id, t.cost->>'currency' as currency, (t.cost->>'amount')::bigint as amount
        from campaign_task t
       where t.campaign_id = any(${ids}::uuid[]) and t.cost is not null and t.cancelled_at is null
      union all
      select cic.campaign_id, e->>'currency', (e->>'amount')::bigint
        from campaign_influencer_cost cic, jsonb_array_elements(cic.extra_costs) e
       where cic.campaign_id = any(${ids}::uuid[])
    ) t group by campaign_id, currency`;
  for (const r of rows) {
    if (!isCurrency(r.currency)) continue; // 알 수 없는 통화는 합계에 섣불리 넣지 않는다
    const t = out.get(r.campaign_id) ?? { money: {}, feeKrw: 0, feeUnknown: 0 };
    t.money[r.currency] = (t.money[r.currency] ?? 0) + Number(r.amount); // sum(bigint)는 문자열로 온다
    out.set(r.campaign_id, t);
  }

  // 작업마다 그 인플의 기본 결제 수단을 조인해 온다 — SQL은 조회만, 수수료 계산은 순수 함수 computeMoney를 그대로 쓴다
  // (정산 화면과 같은 계산, 스펙 §3-2). 결제 수단이 없으면(인플 미등록 포함) 수수료 0 + feeUnknown 1.
  const feeRows = await sql<FeeRow[]>`
    select t.campaign_id, t.cost, i.payment_methods
      from campaign_task t
      left join influencer i on lower(i.handle) = lower(t.influencer_handle)
     where t.campaign_id = any(${ids}::uuid[]) and t.cost is not null and t.cancelled_at is null`;
  for (const r of feeRows) {
    const t = out.get(r.campaign_id) ?? { money: {}, feeKrw: 0, feeUnknown: 0 };
    const parsed = parseTaskCost(r.cost ?? null);
    // 비용 모양이 깨진 건도 '수수료 미확인'으로 센다 — 단가에는 SQL 캐스팅으로 잡히는데 여기서 조용히 빠지면
    // 화면의 "미확인 N건은 단가만 넣었어요"가 실제와 어긋난다.
    if (!parsed.ok || !parsed.value) { t.feeUnknown += 1; out.set(r.campaign_id, t); continue; }
    const methods = Array.isArray(r.payment_methods) ? (r.payment_methods as PaymentMethod[]) : [];
    const method = getDefaultPaymentMethod(methods);
    if (!method) { t.feeUnknown += 1; out.set(r.campaign_id, t); continue; }
    const money = computeMoney(parsed.value, method.currency, method.fee, JPY_TO_KRW);
    t.feeKrw += method.currency === 'JPY' ? money.feeAmount * JPY_TO_KRW : money.feeAmount;
    out.set(r.campaign_id, t);
  }
  return out;
}

// 클라이언트 × 예산 기간 집행(스펙 2026-09-22 §5-2) — 캠페인 starts_on이 그 기간 안에 있으면 전액 귀속.
// 합산은 totalsFor를 그대로 써서 캠페인 카드 합계와 예산 표가 항상 같은 숫자를 말한다.
// spanning: 그 기간에 귀속됐지만 ends_on이 기간 종료일 뒤까지 이어지는 캠페인(초과 원인 배지용, §4).
export async function spendByPeriods(
  sql: postgres.Sql, clientId: string, periods: Array<{ id: string; startsOn: string; endsOn: string }>,
): Promise<Map<string, PeriodSpend & { spanning: SpanningCampaign[] }>> {
  const camps = await sql<Array<{ id: string; starts_on: string; ends_on: string }>>`
    select id, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on
      from campaign where client_id = ${clientId}`;
  const totals = await totalsFor(sql, camps.map((c) => c.id));
  const out = new Map<string, PeriodSpend & { spanning: SpanningCampaign[] }>();
  for (const period of periods) {
    let cur: PeriodSpend = { total: {}, campaignCount: 0, feeKrw: 0, feeUnknown: 0 };
    const spanning: SpanningCampaign[] = [];
    for (const c of camps) {
      if (c.starts_on < period.startsOn || c.starts_on > period.endsOn) continue;
      const t = totals.get(c.id);
      cur = {
        total: mergeMoney(cur.total, t?.money ?? {}),
        campaignCount: cur.campaignCount + 1,
        feeKrw: cur.feeKrw + (t?.feeKrw ?? 0),
        feeUnknown: cur.feeUnknown + (t?.feeUnknown ?? 0),
      };
      if (c.ends_on > period.endsOn) spanning.push({ id: c.id, endsOn: c.ends_on });
    }
    out.set(period.id, { ...cur, spanning });
  }
  return out;
}

async function toRows(sql: postgres.Sql, rows: CRow[]): Promise<CampaignRow[]> {
  const totals = await totalsFor(sql, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, clientId: r.client_id, clientName: r.client_name, name: r.name, nameEn: r.name_en,
    startsOn: r.starts_on, endsOn: r.ends_on, kind: r.kind, note: r.note,
    createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
    taskCount: Number(r.task_count),
    total: totals.get(r.id)?.money ?? {},
  }));
}

export async function createCampaign(sql: postgres.Sql, input: {
  // DB는 client_id를 on delete set null로 허용(스키마상 nullable) — API 라우트(campaignInput.ts)는 항상 채워 보내지만,
  // 저장소 자체는 클라이언트 없는 캠페인도 만들 수 있다(042 §4-8 no-client 시나리오 테스트가 이 경로를 쓴다)
  clientId: string | null; clientName: string | null; name: string; nameEn: string;
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
  patch: {
    clientId?: string; clientName?: string; name?: string; nameEn?: string;
    startsOn?: string; endsOn?: string; kind?: CampaignKind | null; note?: string;
  },
): Promise<void> {
  if (!isUuidLike(id)) return; // 형식이 아니면 DB까지 가기 전에 끊는다(22P02 방지) — 라우트가 404로 처리
  // kind만 case when — null이 '유형 없음'이라는 뜻을 갖는 유일한 필드(draftStore.influencer_handle과 같은 구조)
  // clientId·clientName은 항상 함께 온다(라우트가 조회해서 채운다) — 이름만 갱신되고 id가 안 바뀌는 불일치를 막는다
  await sql`update campaign set
      client_id = coalesce(${patch.clientId ?? null}::uuid, client_id),
      client_name = coalesce(${patch.clientName ?? null}, client_name),
      name = coalesce(${patch.name ?? null}, name),
      name_en = coalesce(${patch.nameEn ?? null}, name_en),
      starts_on = coalesce(${patch.startsOn ?? null}::date, starts_on),
      ends_on = coalesce(${patch.endsOn ?? null}::date, ends_on),
      kind = case when ${patch.kind !== undefined} then ${patch.kind ?? null}::text else kind end,
      note = coalesce(${patch.note ?? null}, note),
      updated_at = now()
    where id = ${id}`;
}

// 작업은 cascade로 함께 지워지고 원고는 남는다(campaign_task.draft_id FK set null). 다른 캠페인에서 이 캠페인 작업을
// 대상으로 삼던 작업은 '대상 미정'이 된다(target_task_id FK set null) — 몇 건인지 응답에 실어 화면이 사실대로 말하게 한다.
// 정산 보호(정산 스펙 §4-4) — 활성 요청이 붙은 작업이 하나라도 있으면 지우지 않는다(deleted:false, activeRequests > 0).
export async function deleteCampaign(
  sql: postgres.Sql, id: string,
): Promise<{ deleted: boolean; taskCount: number; detachedTargets: number; activeRequests: number }> {
  if (!isUuidLike(id)) return { deleted: false, taskCount: 0, detachedTargets: 0, activeRequests: 0 }; // 22P02 방지 — 라우트가 404로 처리
  const info = await countTasksForCampaignDelete(sql, id);   // 삭제 전에 세야 한다(cascade 뒤엔 0)
  if (info.activeRequests > 0) return { deleted: false, ...info };
  const del = await sql`delete from campaign where id = ${id} returning id`;
  return del.length > 0 ? { deleted: true, ...info } : { deleted: false, taskCount: 0, detachedTargets: 0, activeRequests: 0 };
}

type PerfRow = { task_id: string; post_count: number; views: string | number | null; likes: string | number | null; bookmarks: string | number | null };
type ClickRow = { draft_id: string; clicks: string | number | null };

export async function getCampaignDetail(
  sql: postgres.Sql, id: string, today: string = kstToday(),
): Promise<CampaignDetail | null> {
  if (!isUuidLike(id)) return null; // 형식이 아니면 DB까지 가기 전에 끊는다(22P02 방지) — 라우트가 404로 처리
  const campaign = await getCampaign(sql, id);
  if (!campaign) return null;
  const tasks = await listTasksByCampaign(sql, id);

  // 성과: 게시물은 작업에 붙는다(§2-4). 한 작업에 게시물이 여러 개면(tracked_post는 tweet_id만 unique)
  // 각 게시물의 최신 스냅샷을 합산한다. 최신 1건은 lateral(trackingStore 관례) — 스냅샷 없는 게시물은 sum에서 null로 빠진다.
  const perfRows = await sql<PerfRow[]>`
    select tp.task_id, count(tp.id)::int as post_count, sum(s.views) as views, sum(s.likes) as likes, sum(s.bookmarks) as bookmarks
      from tracked_post tp
      left join lateral (
        select views, likes, bookmarks from post_metric_snapshot where tracked_post_id = tp.id
        order by captured_at desc limit 1
      ) s on true
     where tp.task_id in (select t.id from campaign_task t where t.campaign_id = ${id})
     group by tp.task_id`;
  // 링크 클릭은 아직 원고 기준이다(tracking_link.draft_id) — 작업에 붙은 원고를 통해 잇는다(§5)
  const clickRows = await sql<ClickRow[]>`
    select l.draft_id, sum(s.total_clicks) as clicks
      from tracking_link l
      left join lateral (
        select total_clicks from link_click_snapshot where tracking_link_id = l.id
        order by captured_at desc limit 1
      ) s on true
     where l.draft_id in (select t.draft_id from campaign_task t where t.campaign_id = ${id} and t.draft_id is not null)
     group by l.draft_id`;
  const perfMap = new Map(perfRows.map((r) => [r.task_id, r]));
  const clickMap = new Map(clickRows.map((r) => [r.draft_id, r]));
  const num = (v: string | number | null) => (v === null ? null : Number(v)); // sum(bigint)는 문자열
  const badges = await settlementByTaskIds(sql, tasks.map((t) => t.id));   // 표의 정산 배지(정산 스펙 §4-4)

  const items: CampaignTaskItem[] = tasks.map((t) => {
    const p = perfMap.get(t.id);
    const c = t.draftId ? clickMap.get(t.draftId) : undefined;
    return {
      ...t,
      published: t.postedAt !== null,   // 게시 확인이 판정한다 — 게시물이 아직 안 붙었어도 게시됨(§2-5)
      perf: p ? { postCount: p.post_count, views: num(p.views), likes: num(p.likes), bookmarks: num(p.bookmarks) } : null,
      linkClicks: c ? num(c.clicks) : null,
      settlement: badges.get(t.id) ?? null,
    };
  });

  const cic = await sql<CicRow[]>`
    select id, campaign_id, influencer_handle, extra_costs, note, updated_at
      from campaign_influencer_cost where campaign_id = ${id} order by lower(influencer_handle)`;
  const costRows = cic.map(toCic);

  // 이 기간 예산(스펙 §5-2) — 클라이언트 없는 캠페인은 null. othersKrw = 같은 기간 합계 − 이 캠페인 몫(campaign.total은 같은 totalsFor)
  let budget: CampaignPeriodBudget | null = null;
  if (campaign.clientId) {
    const periods = await listBudgetPeriods(sql, campaign.clientId);
    const period = periodFor(periods, campaign.startsOn);
    const spend = period ? (await spendByPeriods(sql, campaign.clientId, [period])).get(period.id) : undefined;
    budget = campaignPeriodBudget(period, spend, spend?.spanning ?? [], toKrw(campaign.total).krw);
  }

  return {
    campaign, tasks: items, costRows,
    summary: summarizeTasks(items, today),
    influencers: deriveTaskInfluencers(items, costRows),
    byType: subtotalsByType(items),
    deleteInfo: await countTasksForCampaignDelete(sql, id),   // 삭제 확인 문구는 미사용까지 전부 센다(실제로 지워지는 수)
    today,
    budget,
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

// 인플루언서 프로필 "참여 캠페인"(§5) — 작업이 배정됐거나 비용 행이 있는 캠페인. 조회만, 로그 없음.
export async function listInfluencerCampaigns(sql: postgres.Sql, handle: string): Promise<InfluencerCampaignItem[]> {
  const lower = handle.toLowerCase();
  const tasks = await sql<Array<{ campaign_id: string; type: TaskType; cost: unknown; cancelled: boolean }>>`
    select t.campaign_id, t.type, t.cost, (t.cancelled_at is not null) as cancelled
      from campaign_task t
     where lower(t.influencer_handle) = ${lower}`;
  const cic = await sql<Array<{ campaign_id: string; extra_costs: unknown }>>`
    select campaign_id, extra_costs from campaign_influencer_cost where lower(influencer_handle) = ${lower}`;
  const ids = [...new Set([...tasks.map((t) => t.campaign_id), ...cic.map((c) => c.campaign_id)])];
  if (ids.length === 0) return [];
  const camps = await sql<Array<{ id: string; name: string; starts_on: string; ends_on: string }>>`
    select id, name, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on
      from campaign where id = any(${ids}::uuid[]) order by starts_on desc, created_at desc`;
  return camps.map((c) => {
    const mine = tasks.filter((t) => t.campaign_id === c.id && !t.cancelled);
    const countsByType: Partial<Record<TaskType, number>> = {};
    for (const t of mine) countsByType[t.type] = (countsByType[t.type] ?? 0) + 1;
    // campaignTaskStore.costOf와 같은 검증(parseTaskCost) — jsonb 모양을 다르게 믿으면 이 롤업 합계와 캠페인 상세 합계가
    // 서로 다른 값을 보여줄 수 있다. amount는 이미 parseAmount(안전 정수)를 통과한 값만 남는다.
    const costs = mine.flatMap((t) => { const p = parseTaskCost(t.cost ?? null); return p.ok && p.value ? [p.value] : []; });
    const extra = cic.filter((x) => x.campaign_id === c.id).flatMap((x) => extraCostsOf(x.extra_costs));
    return {
      id: c.id, name: c.name, startsOn: c.starts_on, endsOn: c.ends_on,
      taskCount: mine.length, countsByType, subtotal: mergeMoney(sumMoney(costs), sumMoney(extra)),
    };
  });
}
