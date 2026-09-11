// 슬랙 `9월2주차` 스레드 답글 → 작업 한 건. 형식을 아는 단 한 곳이다(적재·대조가 같은 규칙을 쓰게).
//
// 형식(2026-09-07~11 관찰):
//   01.@handle            ← 번호 + 핸들. 번호만 있고 핸들이 없으면 자리만 잡아둔 플레이스홀더
//   인용: 5만원            ← 유형 + 금액. '인용'·'RT'·'댓글'. 금액은 만원 단위, '1,5만원'=1.5만원
//   https://x.com/...     ← 게시물 링크(없을 수 있음)
//   ->다른 치과 계약상 안됨   ← 메모. 섭외 불성립 사유가 여기 온다
//
// 주의: 이 스레드는 **기존 답글이 수정된다**. 답글 수가 그대로여도 내용이 바뀐다
// (2026-09-10 미모드림 07~09 플레이스홀더가 채워짐 · 2026-09-11 더스퀘어 01·08·10·13에 링크가 붙음).

export interface ParsedReply {
  no: number | null;          // 번호. 없으면 작업 답글이 아니다(대화·구분선)
  handle: string | null;      // 핸들. null = 플레이스홀더(번호만 있음)
  type: 'quoteRt' | 'rt' | 'comment' | null;
  amountKrw: number | null;   // 원. '00만원'은 0이 아니라 null(미정)로 본다
  postUrl: string | null;     // tweetPermalink 정규형으로 정리
  memo: string;               // '->' 뒤
  raw: string;
}

const TYPE_MAP: Record<string, ParsedReply['type']> = { '인용': 'quoteRt', 'RT': 'rt', '댓글': 'comment' };

// x.com 링크에서 정규형만 남긴다(?s=46&t=… 같은 추적 파라미터 제거)
export function normalizePostUrl(text: string): string | null {
  const m = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/\s|>]+)\/status\/(\d+)/.exec(text);
  return m ? `https://x.com/${m[1]}/status/${m[2]}` : null;
}

// '5만원' → 50000 · '1,5만원' → 15000 · '00만원' → null(미정)
export function parseAmount(s: string): number | null {
  const m = /([0-9][0-9,\\.]*)\s*만원/.exec(s);
  if (!m) return null;
  const digits = m[1].replace(/[^0-9,.]/g, '');
  if (/^0+$/.test(digits.replace(/[,.]/g, ''))) return null;   // 00만원 = 아직 정해지지 않음
  const n = Number(digits.replace(',', '.').replace(/\.(?=.*\.)/g, ''));
  return Number.isFinite(n) ? Math.round(n * 10000) : null;
}

export function parseReply(raw: string): ParsedReply {
  const text = raw.replace(/\r/g, '');
  const out: ParsedReply = { no: null, handle: null, type: null, amountKrw: null, postUrl: null, memo: '', raw: text };

  const noM = /^\s*(\d{1,2})\s*\./.exec(text);
  if (!noM) return out;                       // 번호가 없으면 작업 답글이 아니다
  out.no = Number(noM[1]);

  // 핸들 — 같은 줄의 @xxx. '@a/@b'(개명 병기)면 뒤엣것을 쓴다(슬랙이 옛 핸들을 앞에 두는 관례)
  const line0 = text.split('\n')[0];
  const handles = [...line0.matchAll(/@([A-Za-z0-9_]{1,15})/g)].map((m) => m[1]);
  out.handle = handles.length ? handles[handles.length - 1] : null;

  for (const [k, v] of Object.entries(TYPE_MAP)) {
    if (new RegExp(`(^|\\n)\\s*${k}\\s*:`).test(text)) { out.type = v; break; }
  }
  out.amountKrw = parseAmount(text);
  out.postUrl = normalizePostUrl(text);
  const memoM = /->\s*(.+)/.exec(text);
  if (memoM) out.memo = memoM[1].trim();
  return out;
}

// 부모 메시지의 `• 비용: 45만원 /44만원/ 250만원` → [금주, 이전주 누적, 월예산]
// 숫자가 2개면 이전 주가 없는 것(신규 클라이언트) — 금주·월예산으로 읽는다.
export function parseParentCost(text: string): { thisWeek: number | null; carried: number | null; monthly: number | null } {
  const line = text.split('\n').find((l) => l.includes('비용'));
  if (!line) return { thisWeek: null, carried: null, monthly: null };
  const parts = line.split(':').slice(1).join(':').split('/').map((p) => parseAmount(p));
  if (parts.length >= 3) return { thisWeek: parts[0], carried: parts[1], monthly: parts[2] };
  if (parts.length === 2) return { thisWeek: parts[0], carried: null, monthly: parts[1] };
  return { thisWeek: parts[0] ?? null, carried: null, monthly: null };
}
