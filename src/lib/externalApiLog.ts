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
}

const LIMITS = { path: 200, query: 200, detail: 300, userAgent: 200, ip: 100 };

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

let warnedRecordFailure = false;

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

  await sql`
    insert into external_api_log (method, path, request_id, status_code, outcome, detail, sent_status, query, ip, user_agent)
    values (${ev.method}, ${path}, ${requestId}, ${ev.statusCode}, ${ev.outcome}, ${detail}, ${ev.sentStatus ?? null}, ${query}, ${ip}, ${userAgent})`;
}

// 라우트가 쓰는 fire-and-forget 래퍼: 실제 API 응답을 막지 않는다. 실패는 삼키고, PGHOST 없으면 no-op.
// 부하 시 즉시(재배포 없이) 끌 수 있는 킬스위치: EXTERNAL_API_LOG=off.
export function recordExternalCallSafe(ev: ExternalLogEvent): void {
  if (!process.env.PGHOST) return;
  if (process.env.EXTERNAL_API_LOG === 'off') return;
  void (async () => {
    try {
      const sql = getUsageSql();
      await insertExternalLog(sql, ev);
    } catch (e) {
      if (!warnedRecordFailure) {
        warnedRecordFailure = true;
        console.warn('[external_api_log] 호출 기록 실패(이후 동일 오류는 생략) — 마이그레이션 043 미적용 여부 확인:', (e as Error).message);
      }
    }
  })();
}

export async function listExternalLog(sql: postgres.Sql, limit = 50): Promise<ExternalLogRow[]> {
  const rows = await sql<
    Array<{
      id: string; at: Date; method: string; path: string; request_id: string | null; status_code: number;
      outcome: ExternalOutcome; detail: string | null; sent_status: string | null; query: string | null; ip: string | null; user_agent: string | null;
      influencer_handle: string | null; client_name: string | null; amount_gross: number | null; payout_currency: string | null;
    }>
  >`
    select l.id, l.at, l.method, l.path, l.request_id, l.status_code, l.outcome, l.detail, l.sent_status, l.query, l.ip, l.user_agent,
           p.influencer_handle, p.client_name, p.amount_gross, p.payout_currency
      from external_api_log l
      left join payment_request p on p.id = l.request_id
     order by l.at desc
     limit ${limit}`;
  return rows.map((r) => ({
    id: r.id, at: new Date(r.at).toISOString(), method: r.method, path: r.path, requestId: r.request_id, statusCode: r.status_code,
    outcome: r.outcome, detail: r.detail, sentStatus: r.sent_status, query: r.query, ip: r.ip, userAgent: r.user_agent,
    target: r.influencer_handle != null
      ? { handle: r.influencer_handle, clientName: r.client_name!, amountGross: r.amount_gross!, payoutCurrency: r.payout_currency! }
      : null,
  }));
}
