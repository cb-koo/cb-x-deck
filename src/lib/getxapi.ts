const DEFAULT_BASE = 'https://api.getxapi.com';

export type RawTweet = Record<string, unknown>;

export interface SearchPage {
  has_more: boolean;
  next_cursor: string | null;
  tweets: RawTweet[];
}

export interface UserInfo {
  id: string;
  userName: string;
  name: string | null;
  followers: number | null;
  profilePicture: string | null;
}

export interface UsersPage {
  has_more: boolean;
  next_cursor: string | null;
  users: Record<string, unknown>[];
}

export class GetxapiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GetxapiAuthError';
  }
}

export interface GetxapiClientOptions {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class GetxapiClient {
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private baseUrl: string;
  private maxRetries: number;

  constructor(private opts: GetxapiClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.maxRetries = opts.maxRetries ?? 5;
  }

  searchTweets(q: string, cursor?: string): Promise<SearchPage> {
    const qs = new URLSearchParams({ q, type: 'Top', ...(cursor ? { cursor } : {}) });
    return this.get<SearchPage>(`/twitter/tweet/advanced_search?${qs}`);
  }

  getUserTweets(userId: string, cursor?: string): Promise<SearchPage> {
    const qs = new URLSearchParams({ userId, ...(cursor ? { cursor } : {}) });
    return this.get<SearchPage>(`/twitter/user/tweets?${qs}`);
  }

  async getUserInfo(userName: string): Promise<UserInfo> {
    const qs = new URLSearchParams({ userName });
    const raw = await this.get<{ data?: Record<string, unknown> }>(`/twitter/user/info?${qs}`);
    const d = raw.data ?? {};
    return {
      id: String(d.id ?? ''),
      userName: String(d.userName ?? userName),
      name: typeof d.name === 'string' ? d.name : null,
      followers: typeof d.followers === 'number' ? d.followers : null,
      profilePicture: typeof d.profilePicture === 'string' ? d.profilePicture : null,
    };
  }

  // 인용 트윗 보강용 상세 조회 — 404/400(삭제·비공개)은 재시도 없이 null
  async getTweetDetail(tweetId: string): Promise<RawTweet | null> {
    const qs = new URLSearchParams({ id: tweetId });
    try {
      const raw = await this.get<{ data?: RawTweet }>(`/twitter/tweet/detail?${qs}`);
      return raw.data ?? null;
    } catch (e) {
      if (e instanceof GetxapiAuthError) throw e;
      if (/^(400|404) from /.test((e as Error).message)) return null;
      throw e;
    }
  }

  // 확장 탐색 — 응답 배열 키가 엔드포인트마다 다를 수 있어 관대하게 정규화(실계약은 smoke-expansion.ts로 확인)
  private static pageMeta(raw: Record<string, unknown>): { has_more: boolean; next_cursor: string | null } {
    return {
      has_more: raw.has_more === true,
      next_cursor: typeof raw.next_cursor === 'string' && raw.next_cursor ? raw.next_cursor : null,
    };
  }

  // 실계약 확인(smoke-expansion.ts): 쿼리 파라미터는 tweetId가 아니라 id (getTweetDetail과 동일 관례)
  async getTweetReplies(tweetId: string, cursor?: string): Promise<SearchPage> {
    const qs = new URLSearchParams({ id: tweetId, ...(cursor ? { cursor } : {}) });
    const raw = await this.get<Record<string, unknown>>(`/twitter/tweet/replies?${qs}`);
    const arr = [raw.tweets, raw.replies, raw.data].find(Array.isArray) as RawTweet[] | undefined;
    return { tweets: arr ?? [], ...GetxapiClient.pageMeta(raw) };
  }

  async getTweetThread(tweetId: string, cursor?: string): Promise<SearchPage> {
    const qs = new URLSearchParams({ id: tweetId, ...(cursor ? { cursor } : {}) });
    const raw = await this.get<Record<string, unknown>>(`/twitter/tweet/thread?${qs}`);
    const arr = [raw.tweets, raw.replies, raw.data].find(Array.isArray) as RawTweet[] | undefined;
    return { tweets: arr ?? [], ...GetxapiClient.pageMeta(raw) };
  }

  async getTweetRetweeters(tweetId: string, cursor?: string): Promise<UsersPage> {
    const qs = new URLSearchParams({ id: tweetId, ...(cursor ? { cursor } : {}) });
    const raw = await this.get<Record<string, unknown>>(`/twitter/tweet/retweeters?${qs}`);
    const arr = [raw.users, raw.retweeters, raw.data].find(Array.isArray) as Record<string, unknown>[] | undefined;
    return { users: arr ?? [], ...GetxapiClient.pageMeta(raw) };
  }

  private backoffMs(attempt: number): number {
    return Math.min(1000 * 2 ** (attempt - 1), 60000);
  }

  private async get<T>(path: string): Promise<T> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.fetchImpl(this.baseUrl + path, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.opts.apiKey}` },
        });
      } catch (e) {
        if (attempt++ >= this.maxRetries) throw e;
        await this.sleep(this.backoffMs(attempt));
        continue;
      }
      if (res.status === 401) {
        const txt = await res.text().catch(() => '');
        throw new GetxapiAuthError(`401 from ${path}: ${txt}`);
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt++ >= this.maxRetries) throw new Error(`${res.status} from ${path} after ${this.maxRetries} retries`);
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.backoffMs(attempt);
        await this.sleep(wait);
        continue;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`${res.status} from ${path}: ${txt}`);
      }
      return (await res.json()) as T;
    }
  }
}

export function makeClient(): GetxapiClient {
  const apiKey = process.env.GETXAPI_KEY;
  if (!apiKey) throw new Error('GETXAPI_KEY not set');
  return new GetxapiClient({ apiKey });
}
