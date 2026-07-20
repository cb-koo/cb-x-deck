import { recordUsageSafe } from './usageStore.ts';

const DEFAULT_BASE = 'https://api.exa.ai';

// exa는 x.com을 색인하지 않음(403 명시 거부) — 웹 기사 발굴 전용, 트윗 검색은 getxapi 담당
export interface ExaResult {
  title: string | null;
  url: string;
  publishedDate: string | null;
  text: string;
}

export class ExaAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExaAuthError';
  }
}

export interface ExaClientOptions {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onUsage?: (ev: { operation: string; ok: boolean; status: number }) => void;
}

export interface ExaSearchOptions {
  numResults?: number;
  maxCharacters?: number;
}

export class ExaClient {
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private baseUrl: string;
  private maxRetries: number;

  constructor(private opts: ExaClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.maxRetries = opts.maxRetries ?? 4;
  }

  async search(query: string, opts?: ExaSearchOptions): Promise<ExaResult[]> {
    const body = {
      query,
      type: 'auto',
      numResults: opts?.numResults ?? 8,
      contents: { text: { maxCharacters: opts?.maxCharacters ?? 2000 } },
    };
    const raw = await this.post<{ results?: Array<Record<string, unknown>> }>('/search', body);
    return (raw.results ?? []).map((r) => ({
      title: typeof r.title === 'string' ? r.title : null,
      url: String(r.url ?? ''),
      publishedDate: typeof r.publishedDate === 'string' ? r.publishedDate : null,
      text: typeof r.text === 'string' ? r.text : '',
    }));
  }

  private backoffMs(attempt: number): number {
    return Math.min(1000 * 2 ** (attempt - 1), 30000);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.fetchImpl(this.baseUrl + path, {
          method: 'POST',
          headers: { 'x-api-key': this.opts.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        if (attempt++ >= this.maxRetries) throw e;
        await this.sleep(this.backoffMs(attempt));
        continue;
      }
      if (res.status === 401) {
        const txt = await res.text().catch(() => '');
        throw new ExaAuthError(`401 from ${path}: ${txt}`);
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt++ >= this.maxRetries) throw new Error(`${res.status} from ${path} after ${this.maxRetries} retries`);
        await this.sleep(this.backoffMs(attempt));
        continue;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`${res.status} from ${path}: ${txt}`);
      }
      this.opts.onUsage?.({ operation: 'exa.search', ok: true, status: res.status });
      return (await res.json()) as T;
    }
  }
}

export function makeExaClient(): ExaClient {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new Error('EXA_API_KEY not set');
  return new ExaClient({
    apiKey,
    onUsage: (ev) => recordUsageSafe({ api: 'exa', operation: ev.operation, ok: ev.ok, httpStatus: ev.status, units: 1 }),
  });
}
