// Composio 프록시 — 연결된 외부 계정(Google Ads 등)의 API를 Composio가 인증을 대신 붙여 호출한다.
// 서버 전용. 키는 프로젝트 API 키(ak_…)이고, 연결 계정은 toolkit별 환경변수로 고른다.
const DEFAULT_BASE = 'https://backend.composio.dev';

export class ComposioError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ComposioError';
  }
}

export interface ComposioProxyRequest {
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  connectedAccountId: string;
}

export interface ComposioClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class ComposioClient {
  private fetchImpl: typeof fetch;
  private baseUrl: string;

  constructor(private opts: ComposioClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
  }

  // 대상 API의 응답 본문(data)을 돌려준다. Composio 오류와 대상 API의 4xx/5xx 모두 ComposioError.
  async proxy<T = unknown>(req: ComposioProxyRequest): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v3/tools/execute/proxy`, {
      method: 'POST',
      headers: { 'x-api-key': this.opts.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: req.endpoint,
        method: req.method ?? 'GET',
        connected_account_id: req.connectedAccountId,
        ...(req.body === undefined ? {} : { body: req.body }),
      }),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => null)) as
      | { data?: T; status?: number; error?: { message?: string } }
      | null;
    if (!res.ok || !json) {
      throw new ComposioError(`Composio ${res.status}: ${json?.error?.message ?? 'no body'}`, res.status);
    }
    const upstream = json.status ?? 200;
    if (upstream >= 400) {
      throw new ComposioError(`upstream ${upstream}: ${JSON.stringify(json.data).slice(0, 300)}`, upstream);
    }
    return json.data as T;
  }
}

export function composioFromEnv(env: Record<string, string | undefined> = process.env): ComposioClient {
  const apiKey = env.COMPOSIO_API_KEY;
  if (!apiKey) throw new ComposioError('COMPOSIO_API_KEY 미설정', 500);
  return new ComposioClient({ apiKey });
}

// Google Ads — 키워드 플래너 조회용 계정(고객 ID)과 Composio 연결 계정.
export interface GoogleAdsTarget {
  customerId: string;
  connectedAccountId: string;
}

export function googleAdsFromEnv(env: Record<string, string | undefined> = process.env): GoogleAdsTarget {
  const customerId = env.GOOGLE_ADS_CUSTOMER_ID;
  const connectedAccountId = env.COMPOSIO_GOOGLEADS_ACCOUNT_ID;
  if (!customerId || !connectedAccountId) {
    throw new ComposioError('GOOGLE_ADS_CUSTOMER_ID / COMPOSIO_GOOGLEADS_ACCOUNT_ID 미설정', 500);
  }
  return { customerId, connectedAccountId };
}
