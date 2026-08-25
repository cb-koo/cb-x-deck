// short.io REST 클라이언트 — 링크 생성·클릭 통계 2개 엔드포인트만 쓴다.
// 공식 SDK(@short.io/client-node) 대신 직접 호출: 의존성 +763KB·zod 동반을 피하고
// getxapi.ts의 검증된 수제 클라이언트 패턴(fetchImpl 주입·백오프 재시도)을 따른다(스펙 §short.io 연동).
// 결과는 postMetrics 3분기 규격 — 라우트는 예외 없이 kind 분기만 한다.

const CREATE_BASE = 'https://api.short.io';
const STATS_BASE = 'https://api-v2.short.io';

export type CreateLinkResult =
  | { kind: 'ok'; linkId: string; shortUrl: string }
  | { kind: 'conflict' } // 409 — 같은 도메인에 같은 경로가 이미 있다. 호출부가 코드를 다시 뽑는다
  | { kind: 'error' };   // 통신 실패·5xx 소진·기형 응답 — 아무것도 저장하지 말 것

export type LinkStatsResult =
  | { kind: 'ok'; totalClicks: number | null; humanClicks: number | null; raw: unknown }
  | { kind: 'unavailable' } // 404 — short.io 쪽에서 링크가 지워짐(대시보드 수동 삭제 등)
  | { kind: 'error' };

export type LinkSeriesResult =
  | { kind: 'ok'; points: Array<{ date: string; clicks: number }> } // date = YYYY-MM-DD
  | { kind: 'unavailable' }
  | { kind: 'error' };

export interface ShortioClientOptions {
  apiKey: string;
  domain: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export class ShortioClient {
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private maxRetries: number;

  constructor(private opts: ShortioClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? 2; // 대화형 액션 뒤에 있어 getxapi(5회)보다 짧게 끊는다
  }

  async createLink(args: { originalUrl: string; path: string; title?: string }): Promise<CreateLinkResult> {
    const res = await this.request(`${CREATE_BASE}/links`, {
      method: 'POST',
      headers: { authorization: this.opts.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        domain: this.opts.domain, originalURL: args.originalUrl, path: args.path,
        ...(args.title ? { title: args.title } : {}),
      }),
    });
    if (!res) return { kind: 'error' };
    if (res.status === 409) return { kind: 'conflict' };
    if (!res.ok) {
      console.error(`shortio createLink ${res.status}:`, await res.text().catch(() => ''));
      return { kind: 'error' };
    }
    const d = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    // 링크 ID는 idString(문자열) 우선, 숫자 id 폴백 — 실계약 확정은 scripts/smoke-shortio.ts(스모크)가 담당
    const linkId = typeof d?.idString === 'string' && d.idString ? d.idString
      : d?.id != null ? String(d.id) : null;
    const shortUrl = typeof d?.shortURL === 'string' && d.shortURL ? d.shortURL : null;
    if (!linkId || !shortUrl) return { kind: 'error' }; // 200인데 기형 — 성공으로 위장하지 않는다
    return { kind: 'ok', linkId, shortUrl };
  }

  async getLinkStats(linkId: string): Promise<LinkStatsResult> {
    // 실계약(2026-08-25): 이 플랜에서 period=total은 빈 구간(0)을 돌려준다 — 파라미터 없음은 최근 30일로
    // 잘린다. 명시적 startDate/endDate만 전체 기간을 정확히 집계하므로, 서비스 개시 이전(2020)부터
    // 모레(시간대 경계 여유)까지를 항상 명시한다.
    const end = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const got = await this.statsBody(linkId, `startDate=2020-01-01&endDate=${end}`);
    if (got.kind !== 'ok') return got;
    const d = got.body;
    return { kind: 'ok', totalClicks: num(d.totalClicks), humanClicks: num(d.humanClicks), raw: d };
  }

  // 일별 클릭 시계열 — 요청 구간이 한 달 안팎이면 short.io가 일 단위 점을 준다(실계약 확인 08-25).
  async getLinkSeries(linkId: string, startDate: string, endDate: string): Promise<LinkSeriesResult> {
    const got = await this.statsBody(linkId, `startDate=${startDate}&endDate=${endDate}`);
    if (got.kind !== 'ok') return got;
    const stats = got.body.clickStatistics as { datasets?: Array<{ data?: unknown }> } | undefined;
    const data = stats?.datasets?.[0]?.data;
    if (!Array.isArray(data)) return { kind: 'error' }; // 200인데 시계열 없음 — 성공으로 위장하지 않는다
    const points = (data as Array<Record<string, unknown>>)
      .map((pt) => ({ date: String(pt?.x ?? '').slice(0, 10), clicks: Number(pt?.y) || 0 }))
      .filter((pt) => /^\d{4}-\d{2}-\d{2}$/.test(pt.date));
    return { kind: 'ok', points };
  }

  // 통계 API 공통 — 404와 "500 + not found 본문"(실계약)을 unavailable로 묶어 판정한다.
  private async statsBody(linkId: string, query: string):
    Promise<{ kind: 'ok'; body: Record<string, unknown> } | { kind: 'unavailable' } | { kind: 'error' }> {
    const res = await this.request(
      `${STATS_BASE}/statistics/link/${encodeURIComponent(linkId)}?${query}`,
      { method: 'GET', headers: { authorization: this.opts.apiKey } },
    );
    if (!res) return { kind: 'error' };
    if (res.status === 404) return { kind: 'unavailable' };
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      if (/not found/i.test(txt)) return { kind: 'unavailable' };
      console.error(`shortio stats ${res.status}:`, txt);
      return { kind: 'error' };
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return { kind: 'error' };
    return { kind: 'ok', body };
  }

  // 공통 전송 — 네트워크 예외·429·5xx만 재시도, 그 외 상태 판정은 호출부 몫. 소진되면 null.
  private async request(url: string, init: RequestInit): Promise<Response | null> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, init);
      } catch (e) {
        if (attempt++ >= this.maxRetries) { console.error(`shortio ${url} 통신 실패:`, e); return null; }
        await this.sleep(Math.min(500 * 2 ** (attempt - 1), 4000));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt++ >= this.maxRetries) return res; // 마지막 응답을 그대로 — 상태 로그는 호출부가 남긴다
        await this.sleep(Math.min(500 * 2 ** (attempt - 1), 4000));
        continue;
      }
      return res;
    }
  }
}

export function isShortioConfigured(): boolean {
  return Boolean(process.env.SHORTIO_API_KEY && process.env.SHORTIO_DOMAIN);
}

export function makeShortioClient(): ShortioClient {
  const apiKey = process.env.SHORTIO_API_KEY;
  const domain = process.env.SHORTIO_DOMAIN;
  if (!apiKey || !domain) throw new Error('SHORTIO_API_KEY / SHORTIO_DOMAIN not set');
  return new ShortioClient({ apiKey, domain });
}
