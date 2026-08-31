import type postgres from 'postgres';
import { getUsageSql } from './db.ts';
import { isUuidLike } from './uuid.ts';

export type ExternalOutcome = 'ok' | 'applied' | 'stale' | 'unauthorized' | 'bad-request' | 'not-found' | 'conflict' | 'error';

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

export interface ExternalLogRow {
  id: string;
  at: string;
  method: string;
  path: string;
  requestId: string | null;
  statusCode: number;
  outcome: ExternalOutcome;
  detail: string | null;
  sentStatus: string | null;
  query: string | null;
  ip: string | null;
  userAgent: string | null;
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

// --- 순수 문구 함수 — 화면이 쓰는 사람 말 (UX 원칙 1·3: 내부어 금지, 판단까지 서술) ---

const SENT_STATUS_LABEL: Record<string, string> = {
  received: '접수', scheduled: '지급 예정', paid: '지급 완료', on_hold: '보류', cancelled: '취소',
};

function statusLabel(sentStatus: string | null): string {
  if (!sentStatus) return '';
  return SENT_STATUS_LABEL[sentStatus] ?? sentStatus;
}

export function describeExternalCall(row: ExternalLogRow): { line: string; tone: 'ok' | 'warn' | 'bad' } {
  switch (row.outcome) {
    case 'applied':
      return { line: `정산 프로덕트가 '${statusLabel(row.sentStatus)}'을 보냈어요 — 반영했어요`, tone: 'ok' };
    case 'stale':
      return { line: `정산 프로덕트가 '${statusLabel(row.sentStatus)}'을 다시 보냈어요 — 이미 반영된 내용이라 넘겼어요`, tone: 'ok' };
    case 'ok':
      if (!row.path.endsWith('/status') && row.path.endsWith('/requests')) {
        return { line: '정산 프로덕트가 요청 목록을 가져갔어요', tone: 'ok' };
      }
      return { line: '정산 프로덕트가 요청 1건을 조회했어요', tone: 'ok' };
    case 'unauthorized':
      return { line: 'API 키가 맞지 않아 거부했어요 — 정산 프로덕트에 운영 키를 다시 확인해 달라고 알려 주세요', tone: 'bad' };
    case 'bad-request':
      if (row.detail) return { line: `보낸 내용의 '${row.detail}' 값이 잘못돼 거부했어요`, tone: 'warn' };
      return { line: '보낸 내용의 형식이 잘못돼 거부했어요', tone: 'warn' };
    case 'not-found':
      return { line: '찾을 수 없는 요청이라 거부했어요 — 연습용(스테이징) 요청 번호를 보냈을 수 있어요', tone: 'warn' };
    case 'conflict':
      if (row.detail === 'paid-locked') return { line: '이미 지급 완료된 요청이라 거부했어요', tone: 'warn' };
      if (row.detail === 'request-cancelled') return { line: '우리 쪽에서 취소한 요청이라 거부했어요', tone: 'warn' };
      return { line: '처리 중 충돌이 있어 거부했어요', tone: 'warn' };
    case 'error':
    default:
      return { line: '처리 중 오류가 나 거부했어요', tone: 'bad' };
  }
}
