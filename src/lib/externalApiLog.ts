import type postgres from 'postgres';
import { getUsageSql } from './db.ts';
import { isUuidLike } from './uuid.ts';
import { type ExternalOutcome, type ExternalLogRow, describeExternalCall } from './externalLogCopy.ts';

// 화면(클라이언트 컴포넌트)은 이 파일이 아니라 './externalLogCopy.ts'에서 바로 import한다 —
// 이 파일은 postgres를 top-level import해 브라우저 번들에 들어가면 빌드가 깨진다. 서버 쪽 소비자를 위해 그대로 재수출.
export { type ExternalOutcome, type ExternalLogRow, describeExternalCall };

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
    }>
  >`
    select id, at, method, path, request_id, status_code, outcome, detail, sent_status, query, ip, user_agent
      from external_api_log
     order by at desc
     limit ${limit}`;
  return rows.map((r) => ({
    id: r.id, at: new Date(r.at).toISOString(), method: r.method, path: r.path, requestId: r.request_id, statusCode: r.status_code,
    outcome: r.outcome, detail: r.detail, sentStatus: r.sent_status, query: r.query, ip: r.ip, userAgent: r.user_agent,
  }));
}
