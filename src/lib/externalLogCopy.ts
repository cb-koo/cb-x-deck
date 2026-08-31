// 연동 기록 화면 문구 — externalApiLog.ts에서 분리(그쪽은 postgres를 top-level import해 클라이언트 컴포넌트에서
// 그 값을 바로 import하면 postgres가 브라우저 번들에 딸려 들어와 빌드가 깨진다). DB를 만지는 함수(recordExternalCallSafe 등)는
// externalApiLog.ts에 남아 있고, 그 파일이 여기서 타입·순수 함수를 재수출한다 — 서버 쪽 소비자는 지금처럼 '@/lib/externalApiLog'만 쓰면 된다.
export type ExternalOutcome = 'ok' | 'applied' | 'stale' | 'unauthorized' | 'bad-request' | 'not-found' | 'conflict' | 'error';

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
