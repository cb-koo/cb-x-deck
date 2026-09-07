// 호출 기록 화면 문구 — DB를 만지지 않는 순수 모듈. 화면(클라이언트 컴포넌트)은 반드시 이 파일에서 import한다.
// externalApiLog.ts(기록·조회)는 postgres를 top-level import하므로, 그 경로로 문구 함수를 가져가면
// 브라우저 번들에 pg가 딸려 들어와 빌드가 깨진다 — 그래서 그 파일은 여기의 것을 재수출하지 않는다.
import { kstDateTime, kstMonthDay } from './datetime.ts';
import { TASK_TYPE_LABEL, type TaskType } from './campaignJudgment.ts';
import { objectParticle } from './koreanParticle.ts';
export type ExternalOutcome = 'ok' | 'applied' | 'stale' | 'unauthorized' | 'bad-request' | 'not-found' | 'conflict' | 'error';

export interface ExternalLogTarget { handle: string; clientName: string; amountGross: number; payoutCurrency: string; taskType: TaskType }

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
  body: string | null;                // 그쪽이 보낸 본문 원문(파싱 전). 401은 저장하지 않는다 — null일 수 있다.
  target: ExternalLogTarget | null;   // request_id로 찾은 결제 요청 요약. request_id가 없거나 그 요청이 우리에게 없으면 null
}

// --- 순수 문구 함수 — 화면이 쓰는 사람 말 (UX 원칙 1·3: 내부어 금지, 판단까지 서술) ---

const SENT_STATUS_LABEL: Record<string, string> = {
  received: '접수', scheduled: '지급 예정', paid: '지급 완료', on_hold: '보류', cancelled: '취소',
};

function statusLabel(sentStatus: string | null): string {
  if (!sentStatus) return '';
  return SENT_STATUS_LABEL[sentStatus] ?? sentStatus;
}

// 그쪽 폴링 커서를 사람 말로 — 목록 조회 기록에는 요청 번호가 없어서(건수만 남는다)
// "어디부터 가져갔나"가 안 보인다. 커서에 그 정보가 이미 들어 있으므로 풀어서 보여준다.
// 브라우저·서버 양쪽에서 동작해야 한다(이 파일은 클라이언트 컴포넌트가 import한다).
function b64urlToString(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    if (typeof atob === 'function') return atob(b64);
    return Buffer.from(b64, 'base64').toString('binary');
  } catch { return null; }
}

export function describeCursor(query: string | null): string | null {
  const m = (query ?? '').match(/cursor=([^&]+)/);
  if (!m) return null;
  const raw = b64urlToString(decodeURIComponent(m[1]));
  if (!raw) return null;
  const i = raw.indexOf(':');
  if (i < 0) return null;
  const us = raw.slice(0, i);
  if (!/^\d{1,16}$/.test(us)) return null;
  const iso = new Date(Number(us) / 1000).toISOString();
  // "8/31 23:19"처럼 짧게 — kstDateTime의 'YYYY-MM-DD HH:MM'은 표에는 맞지만 이 문장 안에서는 너무 길다.
  return `${kstMonthDay(iso)} ${kstDateTime(iso).slice(11)} 이후 바뀐 것`;
}

export function describeExternalCall(row: ExternalLogRow): { line: string; tone: 'ok' | 'warn' | 'bad' } {
  switch (row.outcome) {
    case 'applied': {
      const label = statusLabel(row.sentStatus);
      return { line: `'${label}'${objectParticle(label)} 보냈어요 — 반영했어요`, tone: 'ok' };   // '지급 완료'를 / '지급 예정'을
    }
    case 'stale': {
      const label = statusLabel(row.sentStatus);
      return { line: `'${label}'${objectParticle(label)} 다시 보냈어요 — 이미 반영된 내용이라 넘겼어요`, tone: 'ok' };
    }
    case 'ok':
      // 증빙 이미지 보기(2026-09-01-proof-to-partner-design.md §4) — "요청 1건을 조회했어요"로 뭉뚱그리면
      // 지급 전에 증빙을 열어봤다는 사실(이 기록 자체가 근거가 된다, 스펙 §4 보너스)이 안 보인다.
      if (row.path.endsWith('/proof')) return { line: '증빙 이미지를 확인했어요', tone: 'ok' };
      if (!row.path.endsWith('/status') && row.path.endsWith('/requests')) {
        const from = describeCursor(row.query);
        const empty = row.detail === '0건';
        const what = from ? `${from}을 가져갔어요` : '요청 목록을 처음부터 가져갔어요';
        return { line: empty ? `${what} — 새로 바뀐 게 없었어요` : what, tone: 'ok' };
      }
      return { line: '요청 1건을 조회했어요', tone: 'ok' };
    case 'unauthorized':
      return { line: 'API 키가 맞지 않아 거부했어요 — 정산 프로덕트에 운영 키를 다시 확인해 달라고 알려 주세요', tone: 'bad' };
    case 'bad-request':
      if (row.detail === 'revision') return { line: '어느 판에 대한 상태인지(revision)가 없어 거부했어요 — 그쪽이 최신 아이템 값을 붙여 다시 보내요', tone: 'warn' };
      if (row.detail) return { line: `보낸 내용의 '${row.detail}' 값이 잘못돼 거부했어요`, tone: 'warn' };
      return { line: '보낸 내용의 형식이 잘못돼 거부했어요', tone: 'warn' };
    case 'not-found':
      // 증빙 보기의 404는 두 가지 뜻이 갈린다(라우트가 detail로 구분해 남긴다) — "요청 자체가 없음"과
      // "요청은 있는데 증빙이 없음"을 같은 문구로 뭉치면 후자가 "찾을 수 없는 요청"이라는 거짓말이 된다.
      if (row.path.endsWith('/proof')) {
        if (row.detail === 'no-proof') return { line: '증빙이 없는 요청이라 보여줄 이미지가 없었어요', tone: 'warn' };
        if (row.detail === 'storage-miss') return { line: '증빙 파일을 스토리지에서 찾지 못했어요 — 확인이 필요해요', tone: 'bad' };
      }
      return { line: '찾을 수 없는 요청이라 거부했어요 — 연습용(스테이징) 요청 번호를 보냈을 수 있어요', tone: 'warn' };
    case 'conflict':
      if (row.detail === 'paid-locked') return { line: '이미 지급 완료된 요청이라 거부했어요', tone: 'warn' };
      if (row.detail === 'request-cancelled') return { line: '우리 쪽에서 취소한 요청이라 거부했어요', tone: 'warn' };
      if (row.detail === 'revision-mismatch') return { line: '그 사이 고쳐진 요청이라 거부했어요 — 그쪽이 최신 내용으로 다시 보내요', tone: 'warn' };
      return { line: '처리 중 충돌이 있어 거부했어요', tone: 'warn' };
    case 'error':
    default:
      return { line: '처리 중 오류가 나 거부했어요', tone: 'bad' };
  }
}

// User-Agent로 호출자를 추정한다 — 정확한 값은 아니다(그래서 화면이 "추정"임을 밝힌다, §3의 도움말).
export function describeCaller(row: Pick<ExternalLogRow, 'userAgent' | 'ip'>): { label: string; kind: 'partner' | 'us' | 'unknown' } {
  if (!row.userAgent) return { label: '알 수 없음', kind: 'unknown' };
  const ua = row.userAgent.toLowerCase();
  if (ua.includes('curl')) return { label: '우리 쪽 점검', kind: 'us' };
  if (ua.includes('mozilla')) return { label: '브라우저', kind: 'us' };
  return { label: '정산 프로덕트', kind: 'partner' };
}

export function describeTarget(row: Pick<ExternalLogRow, 'requestId' | 'target'>): string {
  if (row.target) {
    const amount = `${row.target.payoutCurrency === 'JPY' ? '¥' : '₩'}${row.target.amountGross.toLocaleString('ko-KR')}`;
    return `@${row.target.handle} · ${TASK_TYPE_LABEL[row.target.taskType]} · ${row.target.clientName} · ${amount}`;
  }
  if (row.requestId) return '찾을 수 없는 요청';
  return '—';
}
