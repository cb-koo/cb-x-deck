// 연동 기록 화면 문구 — DB를 만지지 않는 순수 모듈. 화면(클라이언트 컴포넌트)은 반드시 이 파일에서 import한다.
// externalApiLog.ts(기록·조회)는 postgres를 top-level import하므로, 그 경로로 문구 함수를 가져가면
// 브라우저 번들에 pg가 딸려 들어와 빌드가 깨진다 — 그래서 그 파일은 여기의 것을 재수출하지 않는다.
export type ExternalOutcome = 'ok' | 'applied' | 'stale' | 'unauthorized' | 'bad-request' | 'not-found' | 'conflict' | 'error';

export interface ExternalLogTarget { handle: string; clientName: string; amountGross: number; payoutCurrency: string }

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

export function describeExternalCall(row: ExternalLogRow): { line: string; tone: 'ok' | 'warn' | 'bad' } {
  switch (row.outcome) {
    case 'applied':
      return { line: `'${statusLabel(row.sentStatus)}'을 보냈어요 — 반영했어요`, tone: 'ok' };
    case 'stale':
      return { line: `'${statusLabel(row.sentStatus)}'을 다시 보냈어요 — 이미 반영된 내용이라 넘겼어요`, tone: 'ok' };
    case 'ok':
      if (!row.path.endsWith('/status') && row.path.endsWith('/requests')) {
        return { line: '요청 목록을 가져갔어요', tone: 'ok' };
      }
      return { line: '요청 1건을 조회했어요', tone: 'ok' };
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
    return `@${row.target.handle} · ${row.target.clientName} · ${amount}`;
  }
  if (row.requestId) return '찾을 수 없는 요청';
  return '—';
}
