// X DM 바로가기(koo 09-28) — 작업 패널 인플루언서 칸의 [DM].
// X는 X-Frame-Options: SAMEORIGIN이라 우리 페이지 안(iframe)에 띄울 수 없다(09-28 헤더 확인) → 화면 오른쪽에 붙는 작은 창으로 연다.
// DM 주소는 핸들이 아니라 X 숫자 ID가 필요하다(messages/compose?recipient_id=) — X 새 채팅(/i/chat/…)으로 이어진다.
// ID가 없는 명부 행(또는 명부 밖 핸들)은 프로필을 연다(프로필의 [메시지]로 한 번 더).

export type XDmTarget = { kind: 'dm' | 'profile'; url: string };

export function xDmTarget(handle: string, xUserId?: string | null): XDmTarget {
  const id = xUserId?.trim();
  if (id && /^\d+$/.test(id)) return { kind: 'dm', url: `https://x.com/messages/compose?recipient_id=${id}` };
  return { kind: 'profile', url: `https://x.com/${encodeURIComponent(handle.replace(/^@/, ''))}` };
}

// 창 이름을 하나로 둔다 — 이미 열린 창이 있으면 새로 쌓지 않고 그 창에서 상대만 바꾼다(크기·위치는 사용자가 맞춘 그대로).
export const X_DM_WINDOW = 'cbx-x-dm';
export const X_DM_SIZE = { width: 420, height: 760 };

// 브라우저 전용 — 오른쪽 끝에 붙여 연다. 팝업이 막히면(null) 새 탭으로라도 연다.
export function openXDmWindow(url: string): void {
  const { width, height } = X_DM_SIZE;
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  const left = (s.availLeft ?? 0) + Math.max(0, s.availWidth - width);
  const top = s.availTop ?? 0;
  const w = window.open(url, X_DM_WINDOW, `popup=yes,width=${width},height=${Math.min(height, s.availHeight)},left=${left},top=${top}`);
  if (w) { w.focus(); return; }
  window.open(url, '_blank', 'noopener');
}
