// 클리닉 지도 — 수집·저장·읽기. 스펙 docs/superpowers/specs/2026-10-17-clinic-map-design.md §3·§4
// 수집: clinic-sales API(진료과 × 달) → 행정동 찾기 → market_clinic·market_clinic_month 저장 → 파생 지표 → 진료과별 완성본(market_map_view).
// 영업 상태는 완성본에 넣지 않고 요청 때 monthly-report(report.*)에서 읽기만 한다 — 연결은 사람이 바꾸므로.
import type postgres from 'postgres';
import {
  DEPARTMENTS, deriveDepartment, buildViewDoc, crmStatusOf,
  type MarketClinicBase, type MarketMonth, type ViewDoc, type CrmInfo,
} from './marketClinic';

// ── clinic-sales API ──
export interface ClinicSalesRow {
  id: string; name: string; address: string;
  region: { sido: string; gu: string };
  location?: { lat: number | null; lng: number | null } | null;
  areaM2: number | null; openedAt: string | null;
  doctors: { total: number; specialist: number };
  departments: string | null;
  network: { brand: string; branchCount: number; isChain: boolean };
  attraction: { registered: boolean; targetCountries: string | null };
  latestMonth?: {
    sales: number | null; salesDomestic: number | null; salesForeign: number | null; foreignSharePct: number | null;
    visits: number | null; visitsForeign: number | null; foreignArpu: number | null;
    salesPerDoctor: number | null; salesPerArea: number | null; estimateType: string | null;
  } | null;
}
export interface ClinicSalesPage { data: ClinicSalesRow[]; months: string[]; pagination: { totalPages: number } }
export type ClinicSalesFetch = (department: string, month: string | undefined, page: number) => Promise<ClinicSalesPage>;

const BASE = 'https://clinic-sales.vercel.app/api/v1';
export function clinicSalesFromEnv(): ClinicSalesFetch {
  const key = process.env.CLINIC_SALES_API_KEY;
  if (!key) throw new Error('CLINIC_SALES_API_KEY가 없어요');
  return async (department, month, page) => {
    const url = new URL(BASE + '/clinics');
    url.searchParams.set('department', department);
    if (month) url.searchParams.set('month', month);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', '1000');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
    if (!res.ok) throw new Error(`clinic-sales ${res.status} ${department} ${month ?? ''} p${page}`);
    return res.json() as Promise<ClinicSalesPage>;
  };
}

async function fetchAll(api: ClinicSalesFetch, department: string, month?: string) {
  const rows: ClinicSalesRow[] = [];
  for (let page = 1; ; page++) {
    const r = await api(department, month, page);
    rows.push(...r.data);
    if (page >= r.pagination.totalPages) return { rows, months: r.months };
  }
}

// ── 행정동 찾기(점 → 다각형). 경계는 화면이 쓰는 public/market-map/dong.geojson과 같은 파일 ──
type Ring = number[][];
interface DongFeature { properties: { adm_cd2: string; adm_nm: string; sgg: string }; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } }
export interface DongLocator { locate(lng: number, lat: number): { sgg: string; dongCode: string; dong: string } | null }

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// 첫 고리 = 바깥, 나머지 = 구멍
const inPolygon = (x: number, y: number, poly: Ring[]) => inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h));

export function makeDongLocator(geo: { features: DongFeature[] }): DongLocator {
  const index = geo.features.map((f) => {
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of polys) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { f, polys, bbox: [x0, y0, x1, y1] as const };
  });
  return {
    locate(lng, lat) {
      for (const { f, polys, bbox } of index) {
        if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
        if (polys.some((p) => inPolygon(lng, lat, p))) {
          return { sgg: f.properties.sgg, dongCode: f.properties.adm_cd2, dong: f.properties.adm_nm.split(' ').at(-1)! };
        }
      }
      return null;
    },
  };
}

function toBase(r: ClinicSalesRow, dept: string, loc: DongLocator): MarketClinicBase {
  const lat = r.location?.lat ?? null, lng = r.location?.lng ?? null;
  const at = lat != null && lng != null ? loc.locate(lng, lat) : null;
  return {
    id: r.id, dept, name: r.name, address: r.address ?? '', sido: r.region?.sido ?? '', gu: r.region?.gu ?? '',
    sggCode: at?.sgg ?? null, dongCode: at?.dongCode ?? null, dong: at?.dong ?? null, lat, lng,
    areaM2: r.areaM2 ?? null, openedOn: r.openedAt ?? null,
    doctors: r.doctors?.total ?? 0, specialists: r.doctors?.specialist ?? 0, departments: r.departments ?? null,
    brand: r.network?.brand ?? '', branches: r.network?.branchCount ?? 1, isChain: !!r.network?.isChain,
    registered: !!r.attraction?.registered,
    countries: r.attraction?.targetCountries ? r.attraction.targetCountries.split('/') : [],
  };
}
function toMonth(month: string, m: NonNullable<ClinicSalesRow['latestMonth']>): MarketMonth {
  const int = (v: number | null | undefined) => (v == null ? null : Math.round(v));
  return {
    month, sales: int(m.sales), salesDomestic: int(m.salesDomestic), salesForeign: int(m.salesForeign),
    foreignPct: m.foreignSharePct ?? null, visits: int(m.visits), visitsForeign: int(m.visitsForeign), foreignArpu: int(m.foreignArpu),
    salesPerDoctor: int(m.salesPerDoctor), salesPerArea: int(m.salesPerArea), estimateType: m.estimateType ?? null,
  };
}

export interface CollectResult { months: string[]; departments: Record<string, { clinics: number; months: Record<string, number>; unlocated: number }> }

/** 전체 수집 — 진료과마다 병원 목록 + 달별 매출을 받아 저장하고 완성본을 다시 만든다. */
export async function collectMarket(sql: postgres.Sql, api: ClinicSalesFetch, loc: DongLocator, today = new Date()): Promise<CollectResult> {
  const [run] = await sql<Array<{ id: string }>>`insert into market_run default values returning id`;
  const result: CollectResult = { months: [], departments: {} };
  try {
    for (const dept of DEPARTMENTS) {
      const first = await fetchAll(api, dept);
      const months = first.months;
      result.months = [...new Set([...result.months, ...months])].sort();
      const monthRows: Array<{ clinicId: string; m: MarketMonth }> = [];
      const counts: Record<string, number> = {};
      for (const month of months) {
        const { rows } = await fetchAll(api, dept, month);
        counts[month] = rows.length;
        for (const r of rows) if (r.latestMonth?.sales) monthRows.push({ clinicId: r.id, m: toMonth(month, r.latestMonth) });
      }
      const bases = first.rows.map((r) => toBase(r, dept, loc));
      await sql.begin(async (tx) => {
        for (let i = 0; i < bases.length; i += 500) {
          const chunk = bases.slice(i, i + 500).map((b) => ({
            id: b.id, dept: b.dept, name: b.name, address: b.address, sido: b.sido, gu: b.gu,
            sgg_code: b.sggCode, dong_code: b.dongCode, dong: b.dong, lat: b.lat, lng: b.lng, area_m2: b.areaM2, opened_on: b.openedOn,
            doctors: b.doctors, specialists: b.specialists, departments: b.departments, brand: b.brand, branches: b.branches,
            is_chain: b.isChain, registered: b.registered, countries: b.countries,
          }));
          await tx`
            insert into market_clinic ${tx(chunk)}
            on conflict (dept, id) do update set name = excluded.name, address = excluded.address, sido = excluded.sido,
              gu = excluded.gu, sgg_code = excluded.sgg_code, dong_code = excluded.dong_code, dong = excluded.dong, lat = excluded.lat,
              lng = excluded.lng, area_m2 = excluded.area_m2, opened_on = excluded.opened_on, doctors = excluded.doctors,
              specialists = excluded.specialists, departments = excluded.departments, brand = excluded.brand, branches = excluded.branches,
              is_chain = excluded.is_chain, registered = excluded.registered, countries = excluded.countries,
              seen_at = now(), updated_at = now()`;
        }
        const known = new Set(bases.map((b) => b.id));
        const ms = monthRows.filter((x) => known.has(x.clinicId));
        for (let i = 0; i < ms.length; i += 1000) {
          const chunk = ms.slice(i, i + 1000).map(({ clinicId, m }) => ({
            dept, clinic_id: clinicId, month: m.month, sales: m.sales, sales_domestic: m.salesDomestic, sales_foreign: m.salesForeign,
            foreign_pct: m.foreignPct, visits: m.visits, visits_foreign: m.visitsForeign, foreign_arpu: m.foreignArpu,
            sales_per_doctor: m.salesPerDoctor, sales_per_area: m.salesPerArea, estimate_type: m.estimateType,
          }));
          await tx`
            insert into market_clinic_month ${tx(chunk)}
            on conflict (dept, clinic_id, month) do update set sales = excluded.sales, sales_domestic = excluded.sales_domestic,
              sales_foreign = excluded.sales_foreign, foreign_pct = excluded.foreign_pct, visits = excluded.visits,
              visits_foreign = excluded.visits_foreign, foreign_arpu = excluded.foreign_arpu, sales_per_doctor = excluded.sales_per_doctor,
              sales_per_area = excluded.sales_per_area, estimate_type = excluded.estimate_type`;
        }
      });
      await rebuildView(sql, dept, months, today);
      result.departments[dept] = { clinics: bases.length, months: counts, unlocated: bases.filter((b) => b.lat != null && !b.sggCode).length };
    }
    await sql`update market_run set finished_at = now(), months = ${result.months}, detail = ${sql.json(result as never)} where id = ${run.id}`;
    return result;
  } catch (e) {
    await sql`update market_run set finished_at = now(), error = ${String(e)}, detail = ${sql.json(result as never)} where id = ${run.id}`;
    throw e;
  }
}

/** 진료과 하나의 파생 지표를 다시 계산해 저장하고, 화면 완성본을 만든다. months = 이번 수집에서 clinic-sales가 준 달(화면 추이 칸). */
export async function rebuildView(sql: postgres.Sql, dept: string, months: string[], today = new Date()): Promise<ViewDoc> {
  const bases = await sql<Array<Record<string, unknown>>>`
    select id, dept, name, address, sido, gu, sgg_code, dong_code, dong, lat, lng, area_m2, opened_on::text as opened_on,
           doctors, specialists, departments, brand, branches, is_chain, registered, countries
    from market_clinic where dept = ${dept} order by id`;
  const ids = bases.map((b) => b.id as string);
  const monthRows = ids.length ? await sql<Array<Record<string, unknown>>>`
    select clinic_id, month, sales, sales_domestic, sales_foreign, foreign_pct, visits, visits_foreign, foreign_arpu,
           sales_per_doctor, sales_per_area, estimate_type
    from market_clinic_month where dept = ${dept} and month = any(${months})` : [];
  const num = (v: unknown) => (v == null ? null : Number(v));
  const byClinic = new Map<string, MarketMonth[]>();
  for (const r of monthRows) {
    const m: MarketMonth = {
      month: r.month as string, sales: num(r.sales), salesDomestic: num(r.sales_domestic), salesForeign: num(r.sales_foreign),
      foreignPct: num(r.foreign_pct), visits: num(r.visits), visitsForeign: num(r.visits_foreign), foreignArpu: num(r.foreign_arpu),
      salesPerDoctor: num(r.sales_per_doctor), salesPerArea: num(r.sales_per_area), estimateType: (r.estimate_type as string) ?? null,
    };
    const k = r.clinic_id as string;
    if (!byClinic.has(k)) byClinic.set(k, []);
    byClinic.get(k)!.push(m);
  }
  const rows = bases.map((b) => {
    const base: MarketClinicBase = {
      id: b.id as string, dept: b.dept as string, name: b.name as string, address: b.address as string, sido: b.sido as string, gu: b.gu as string,
      sggCode: (b.sgg_code as string) ?? null, dongCode: (b.dong_code as string) ?? null, dong: (b.dong as string) ?? null,
      lat: num(b.lat), lng: num(b.lng), areaM2: num(b.area_m2), openedOn: (b.opened_on as string) ?? null,
      doctors: Number(b.doctors), specialists: Number(b.specialists), departments: (b.departments as string) ?? null,
      brand: b.brand as string, branches: Number(b.branches), isChain: !!b.is_chain, registered: !!b.registered, countries: (b.countries as string[]) ?? [],
    };
    const series = (byClinic.get(base.id) ?? []).sort((a, z) => a.month.localeCompare(z.month));
    const have = series.filter((s) => s.sales);
    return { base, series, latest: have.at(-1) ?? null, prev: have.at(-2) ?? null };
  });
  const derived = deriveDepartment(rows, today);
  // 한 번에 덮어쓴다(병원 5천 곳을 한 줄씩 보내면 풀러 왕복만 수십 초)
  const patch = rows.map((r) => ({ id: r.base.id, d: derived.get(r.base.id), lm: r.latest?.month ?? null }));
  for (let i = 0; i < patch.length; i += 2000) {
    await sql`
      update market_clinic m set derived = x.d, latest_month = x.lm
      from jsonb_to_recordset(${sql.json(patch.slice(i, i + 2000) as never)}) as x(id text, d jsonb, lm text)
      where m.dept = ${dept} and m.id = x.id`;
  }
  const doc = buildViewDoc(dept, months, new Date().toISOString(), rows.map((r) => ({ base: r.base, series: r.series, derived: derived.get(r.base.id)! })));
  await sql`
    insert into market_map_view (id, doc) values (${dept}, ${sql.json(doc as never)})
    on conflict (id) do update set doc = excluded.doc, built_at = now()`;
  return doc;
}

export async function readView(sql: postgres.Sql, dept: string): Promise<{ builtAt: string; doc: ViewDoc } | null> {
  const [r] = await sql<Array<{ built_at: Date; doc: ViewDoc }>>`select built_at, doc from market_map_view where id = ${dept}`;
  return r ? { builtAt: r.built_at.toISOString(), doc: r.doc } : null;
}

export async function lastRun(sql: postgres.Sql) {
  const [r] = await sql<Array<{ started_at: Date; finished_at: Date | null; months: string[] | null; error: string | null }>>`
    select started_at, finished_at, months, error from market_run order by started_at desc limit 1`;
  return r ?? null;
}

// ── 영업 상태: monthly-report에서 읽기만 한다. 그 스키마가 없는 환경(연습용 DB)이면 빈 결과 ──
export async function readCrm(sql: postgres.Sql, dept: string): Promise<Record<string, CrmInfo>> {
  const [has] = await sql<Array<{ ok: boolean }>>`select to_regclass('report.clinic') is not null and to_regclass('report.lead') is not null as ok`;
  if (!has?.ok) return {};
  return sql.begin('read only', async (tx) => {
    const clinics = await tx<Array<{ clinic_id: string; branch: string | null; name: string; reports: number; last_month: string | null }>>`
      select l.clinic_id, l.branch, c.display_name as name,
             (select count(*)::int from report.report r where r.clinic_id = c.id) as reports,
             (select max(r.month) from report.report r where r.clinic_id = c.id) as last_month
      from market_clinic_link l join report.clinic c on c.id = l.report_clinic_id
      where l.dept = ${dept}`;
    const leads = await tx<Array<{ clinic_id: string; branch: string | null; name: string; status: string; converted: boolean; proposals: number; views: number }>>`
      select l.clinic_id, l.branch, ld.clinic_name as name, ld.status, ld.converted_clinic_id is not null as converted,
             (select count(*)::int from report.proposal p where p.lead_id = ld.id) as proposals,
             (select coalesce(sum(p.view_count), 0)::int from report.proposal p where p.lead_id = ld.id) as views
      from market_clinic_link l join report.lead ld on ld.id = l.lead_id
      where l.dept = ${dept}`;
    const out: Record<string, CrmInfo> = {};
    // 고객이 리드보다 우선 — 같은 병원에 둘 다 걸려 있으면 고객으로 본다
    for (const l of leads) {
      const status = crmStatusOf({ kind: 'lead', proposals: l.proposals, converted: l.converted || l.status === 'converted' });
      if (status) out[l.clinic_id] = { status, crmName: l.name, branch: l.branch, proposals: l.proposals, views: l.views };
    }
    for (const c of clinics) {
      out[c.clinic_id] = { status: crmStatusOf({ kind: 'clinic', reports: c.reports })!, crmName: c.name, branch: c.branch, reports: c.reports, lastMonth: c.last_month };
    }
    return out;
  });
}
