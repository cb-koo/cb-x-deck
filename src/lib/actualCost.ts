const GETXAPI_BASE = 'https://api.getxapi.com';
const EXA_ADMIN_BASE = 'https://admin-api.exa.ai';
const TIMEOUT_MS = 5000;
const TTL_MS = 5 * 60 * 1000;

export interface GetxapiActual { creditsRemaining: number; creditsUsed: number; totalRequests: number }
export interface ExaActual { totalCostUsd: number; periodStart: string; periodEnd: string; budgetUsd: number | null; overBudget: boolean }
export interface ProviderActual {
  api: 'getxapi' | 'exa' | 'anthropic';
  kind: 'cumulative' | 'period' | 'estimate-only';
  actualUsd: number | null;
  balanceUsd?: number | null;
  budgetUsd?: number | null;
  overBudget?: boolean;
  note?: string;
}

type Fetch = typeof fetch;

// 실패·타임아웃은 null. 절대 throw 전파 안 함(페이지를 깨지 않는다).
async function getJson(url: string, headers: Record<string, string>, fetchImpl: Fetch): Promise<Record<string, unknown> | unknown[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers, signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown> | unknown[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getxapiActual(fetchImpl: Fetch = fetch): Promise<GetxapiActual | null> {
  const key = process.env.GETXAPI_KEY;
  if (!key) return null;
  const me = await getJson(`${GETXAPI_BASE}/account/me`, { Authorization: `Bearer ${key}` }, fetchImpl) as Record<string, unknown> | null;
  if (!me || typeof me.credits_remaining !== 'number') return null;
  return {
    creditsRemaining: me.credits_remaining,
    creditsUsed: typeof me.credits_used === 'number' ? me.credits_used : 0,
    totalRequests: typeof me.total_requests === 'number' ? me.total_requests : 0,
  };
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

export async function exaActual(from: Date, to: Date, fetchImpl: Fetch = fetch): Promise<ExaActual | null> {
  const key = process.env.EXA_SERVICE_KEY;
  if (!key) return null;
  const h = { 'x-api-key': key };
  const list = await getJson(`${EXA_ADMIN_BASE}/team-management/api-keys`, h, fetchImpl) as Record<string, unknown> | null;
  const keys = list && Array.isArray(list.apiKeys) ? (list.apiKeys as Array<Record<string, unknown>>) : [];
  const k = keys[0];
  if (!k || typeof k.id !== 'string') return null;
  const usage = await getJson(
    `${EXA_ADMIN_BASE}/team-management/api-keys/${encodeURIComponent(k.id)}/usage?start_date=${ymd(from)}&end_date=${ymd(to)}`,
    h, fetchImpl,
  ) as Record<string, unknown> | null;
  if (!usage || typeof usage.total_cost_usd !== 'number') return null;
  return {
    totalCostUsd: usage.total_cost_usd,
    periodStart: ymd(from),
    periodEnd: ymd(to),
    budgetUsd: typeof k.budgetCents === 'number' ? k.budgetCents / 100 : null,
    overBudget: k.isOverBudget === true,
  };
}

const cache = new Map<string, { at: number; data: ProviderActual[] }>();

export async function getProviderActuals(
  from: Date, to: Date,
  opts?: { fetchImpl?: Fetch; now?: () => number },
): Promise<ProviderActual[]> {
  const now = opts?.now ?? Date.now;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const cacheKey = `${ymd(from)}_${ymd(to)}`;
  const hit = cache.get(cacheKey);
  if (hit && now() - hit.at < TTL_MS) return hit.data;

  const [gx, exa] = await Promise.all([getxapiActual(fetchImpl), exaActual(from, to, fetchImpl)]);
  const data: ProviderActual[] = [
    gx
      ? { api: 'getxapi', kind: 'cumulative', actualUsd: gx.creditsUsed, balanceUsd: gx.creditsRemaining }
      : { api: 'getxapi', kind: 'cumulative', actualUsd: null, note: '불러오기 실패' },
    exa
      ? { api: 'exa', kind: 'period', actualUsd: exa.totalCostUsd, budgetUsd: exa.budgetUsd, overBudget: exa.overBudget }
      : { api: 'exa', kind: 'period', actualUsd: null, note: '불러오기 실패(또는 키 없음)' },
    { api: 'anthropic', kind: 'estimate-only', actualUsd: null, note: '실청구 API 미연동 — 콘솔에서 확인' },
  ];
  cache.set(cacheKey, { at: now(), data });
  return data;
}
