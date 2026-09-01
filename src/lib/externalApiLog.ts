import type postgres from 'postgres';
import { getUsageSql } from './db.ts';
import { isUuidLike } from './uuid.ts';
import type { ExternalOutcome, ExternalLogRow } from './externalLogCopy.ts';

// 문구 함수(describeExternalCall)와 타입은 './externalLogCopy.ts'에 있다 — 여기서 재수출하지 않는다.
// 이 파일은 postgres를 top-level import하므로, 화면이 이 경로로 문구 함수를 가져가면 브라우저 번들에 pg가 들어가 빌드가 깨진다.

export interface ExternalLogEvent {
  method: string;
  path: string;
  requestId?: string | null;
  statusCode: number;
  outcome: ExternalOutcome;
  detail?: string | null;
  sentStatus?: string | null;
  query?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  body?: string | null;      // 그쪽이 보낸 본문 원문(파싱 전). 401은 넘기지 않는다.
}

const LIMITS = { path: 200, query: 200, detail: 300, userAgent: 200, ip: 100 };
const BODY_MAX = 4096;
const BODY_CUT = '…(본문이 길어 여기서 잘렸어요)';

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

function clipBody(s: string): string {
  return s.length <= BODY_MAX ? s : s.slice(0, BODY_MAX - BODY_CUT.length) + BODY_CUT;
}

// 기록의 본체(await 되는 쪽) — 테스트가 직접 쓴다.
export async function insertExternalLog(sql: postgres.Sql, ev: ExternalLogEvent): Promise<void> {
  const rawRequestId = ev.requestId ?? null;
  const requestIdIsUuid = rawRequestId != null && isUuidLike(rawRequestId);
  const requestId = requestIdIsUuid ? rawRequestId : null;

  let detail = ev.detail ?? null;
  if (rawRequestId != null && !requestIdIsUuid) {
    const extra = `보낸 id: ${clip(rawRequestId, 40)}`;
    detail = detail ? `${detail} / ${extra}` : extra;
  }
  if (detail != null) detail = clip(detail, LIMITS.detail);

  const path = clip(ev.path, LIMITS.path);
  const query = ev.query != null ? clip(ev.query, LIMITS.query) : null;
  const userAgent = ev.userAgent != null ? clip(ev.userAgent, LIMITS.userAgent) : null;
  const ip = ev.ip != null ? clip(ev.ip, LIMITS.ip) : null;
  const body = ev.body != null ? clipBody(ev.body) : null;

  await sql`
    insert into external_api_log (method, path, request_id, status_code, outcome, detail, sent_status, query, ip, user_agent, body)
    values (${ev.method}, ${path}, ${requestId}, ${ev.statusCode}, ${ev.outcome}, ${detail}, ${ev.sentStatus ?? null}, ${query}, ${ip}, ${userAgent}, ${body})`;
}

// 기록의 실행부 — 예외를 밖으로 던지지 않는다. 실패해도 그쪽 호출은 성공해야 한다.
// 예약(응답 후 실행)은 externalApiLogAfter.ts가 맡는다. 부하 시 킬스위치: EXTERNAL_API_LOG=off.
export async function recordExternalCall(ev: ExternalLogEvent): Promise<void> {
  if (!process.env.PGHOST) return;
  if (process.env.EXTERNAL_API_LOG === 'off') return;
  const sql = getUsageSql();
  try {
    await insertExternalLog(sql, ev);
    return;
  } catch { /* 아래에서 한 번만 다시 시도한다 — 풀 소진·일시 오류가 대부분이다 */ }
  try {
    await new Promise((r) => setTimeout(r, 200));
    await insertExternalLog(sql, ev);
  } catch (e) {
    // 매번 남긴다 — 조용히 사라지면 "기록에 없다"를 근거로 잘못 판정하게 된다(2026-08-31 사고).
    console.error('[external_api_log] 호출 기록 실패 — 마이그레이션 043·046 적용 여부 확인:', (e as Error).message);
  }
}

export interface ExternalLogQuery { limit?: number; method?: 'GET' | 'POST'; rejectedOnly?: boolean; requestId?: string | null }

export async function listExternalLog(sql: postgres.Sql, q: ExternalLogQuery = {}): Promise<ExternalLogRow[]> {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const requestId = q.requestId && isUuidLike(q.requestId) ? q.requestId : null;
  const rows = await sql<
    Array<{
      id: string; at: Date; method: string; path: string; request_id: string | null; status_code: number;
      outcome: ExternalOutcome; detail: string | null; sent_status: string | null; query: string | null; ip: string | null; user_agent: string | null;
      body: string | null;
      influencer_handle: string | null; client_name: string | null; amount_gross: number | null; payout_currency: string | null;
    }>
  >`
    select l.id, l.at, l.method, l.path, l.request_id, l.status_code, l.outcome, l.detail, l.sent_status, l.query, l.ip, l.user_agent, l.body,
           p.influencer_handle, p.client_name, p.amount_gross, p.payout_currency
      from external_api_log l
      left join payment_request p on p.id = l.request_id
     where ${q.method ? sql`l.method = ${q.method}` : sql`true`}
       and ${q.rejectedOnly ? sql`l.status_code >= 400` : sql`true`}
       and ${requestId ? sql`l.request_id = ${requestId}` : sql`true`}
     order by l.at desc
     limit ${limit}`;
  return rows.map((r) => ({
    id: r.id, at: new Date(r.at).toISOString(), method: r.method, path: r.path, requestId: r.request_id, statusCode: r.status_code,
    outcome: r.outcome, detail: r.detail, sentStatus: r.sent_status, query: r.query, ip: r.ip, userAgent: r.user_agent, body: r.body,
    target: r.influencer_handle != null
      ? { handle: r.influencer_handle, clientName: r.client_name!, amountGross: r.amount_gross!, payoutCurrency: r.payout_currency! }
      : null,
  }));
}
