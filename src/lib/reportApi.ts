// 외부 "클리닉 마케팅 리포트 API" 클라이언트. 이 파일만 외부 API를 안다.
// 필드 의미의 원천은 openapi.yaml — 특히 null("모름")과 0("정말 0")의 구분,
// upcoming_confirmed(기간 무관·호출 시점 이후), funnel(항상 접수일 기준)을 오독하지 말 것.

export type ReportUnit = 'day' | 'week' | 'month';
export interface Reservers { by_line_id: number; by_name: number }
export interface Revenue { total: number; first_visit: number; repeat_visit: number }
export interface StatusCounts { reviewing: number; confirmed: number; visited: number; cancelled: number; lost: number; noshow: number }
export interface ReservationMetrics {
  reservation_count: number; revenue: Revenue;
  visit_type_counts: { first_visit: number; repeat_visit: number };
  reservers: Reservers; visitors: Reservers; status_counts: StatusCounts;
}
export interface BranchBreakdown extends ReservationMetrics {
  branch_name: string | null; branch_id: string | null; in_master: boolean; source_values: (string | null)[];
}
export interface ReservationsBlock extends ReservationMetrics { by_branch?: BranchBreakdown[] }
export interface FollowersBundle {
  total_at_end: number; snapshot_date: string; total_at_baseline: number | null;
  baseline_date: string; change: number | null; blocked: number; reachable: number;
}
export interface FunnelBundle {
  active_customers: number; new_customers: number; consulted_customers: number;
  reservers: Reservers; visitors: Reservers;
}
export interface CostsBundle {
  marketing_cost: { total: number; by_media: Array<{ media: string; amount: number }> };
  x_views: { cumulative_at_end: number; change: number } | null;
  roas: number | null; cpa: { by_line_id: number | null; by_name: number | null };
}
export interface ReservationsBundle {
  created_at: ReservationsBlock | null; reservation_date: ReservationsBlock | null; upcoming_confirmed: number;
}
export interface ClinicBundle {
  name_ko: string; branches: Array<{ id: string; name: string; is_active: boolean }>;
  business_days_in_period: number;
}
export interface ReportBundles {
  clinic?: ClinicBundle | null; followers?: FollowersBundle | null; funnel?: FunnelBundle | null;
  reservations?: ReservationsBundle | null; costs?: CostsBundle | null;
}
export interface ReportResponse {
  meta: { clinic: { name: string }; period: { start: string; end: string; days: number }; generated_at: string };
  current: ReportBundles;
  previous?: ReportBundles & { period?: { start: string; end: string; days: number } };
  unavailable?: Record<string, { code: string; message: string }>;
}
export type ReportFetch =
  | { kind: 'ok'; report: ReportResponse }
  | { kind: 'rate_limited' }
  | { kind: 'error'; status: number; message: string };
export interface ReportParams {
  clinic: string; start: string; end: string;
  dateBasis?: 'created_at' | 'reservation_date' | 'both';
  compare?: 'calendar' | 'period' | 'none';
  groupBy?: 'branch';
}

const BASE = process.env.REPORT_API_BASE ?? 'https://linemessagedashboard.vercel.app/api/reports/v1/metrics';

export async function fetchReportMetrics(
  params: ReportParams, deps?: { fetchFn?: typeof fetch; apiKey?: string },
): Promise<ReportFetch> {
  const apiKey = deps?.apiKey ?? process.env.REPORT_API_KEY;
  if (!apiKey) return { kind: 'error', status: 0, message: 'REPORT_API_KEY가 설정되지 않았어요' };
  const u = new URL(BASE);
  u.searchParams.set('clinic', params.clinic);
  u.searchParams.set('start', params.start);
  u.searchParams.set('end', params.end);
  if (params.dateBasis) u.searchParams.set('date_basis', params.dateBasis);
  if (params.compare) u.searchParams.set('compare', params.compare);
  if (params.groupBy) u.searchParams.set('group_by', params.groupBy);
  try {
    const res = await (deps?.fetchFn ?? fetch)(u, { headers: { 'x-api-key': apiKey } });
    if (res.status === 429) return { kind: 'rate_limited' };
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (body as { error?: string } | null)?.error ?? `리포트 API 오류 (HTTP ${res.status})`;
      return { kind: 'error', status: res.status, message };
    }
    if (!body || typeof body !== 'object' || !('current' in body))
      return { kind: 'error', status: res.status, message: '리포트 API 응답 형식이 예상과 달라요' };
    return { kind: 'ok', report: body as ReportResponse };
  } catch {
    return { kind: 'error', status: 0, message: '리포트 API에 연결하지 못했어요' };
  }
}
