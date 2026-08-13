// PATCH /api/drafts/[id]의 media 검증. 클라이언트가 무엇을 보내든(형식 오류·과다 첨부)
// jsonb에 그대로 박히기 전에 여기서 걸러진다 — 이 값이 나중에 <img src>와
// createSignedUrls로 흘러간다(설계 §F).
import type { DeckMedia } from './types';

export const MAX_MEDIA_PER_POST = 4;

// 초안 첨부가 가질 수 있는 유일한 url 형태 — uploadDraftImage가 만드는 스토리지 경로 그대로.
// draft/<초안uuid>/<파일uuid>.<이미지 확장자>
//
// "문자열이기만 하면 통과"로 냈다가 리뷰에서 잡혔다: 임의 URL이 jsonb에 저장되면 워크스페이스
// 전원의 브라우저가 그 주소로 <img src> 요청을 보낸다(추적 픽셀·IP 유출). 버킷의 MIME·용량
// 제한은 업로드 경로에만 있고 이 PATCH 경로는 통과하지 않으므로, 여기가 유일한 방어선이다.
// 정상 UI가 만들 수 없는 값은 전부 거절한다 — X CDN 절대 URL(http…)도 초안 첨부에는
// 존재할 일이 없으므로 허용하지 않는다(트윗 미디어는 draft가 아니라 tweet 테이블 소관).
const STORAGE_PATH_RE = /^draft\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$/;

function isDeckMedia(item: unknown): item is DeckMedia {
  if (typeof item !== 'object' || item === null) return false;
  const m = item as { type?: unknown; url?: unknown; videoUrl?: unknown };
  return m.type === 'photo' &&
    typeof m.url === 'string' && STORAGE_PATH_RE.test(m.url) &&
    m.videoUrl === null;
}

// undefined(필드 없음) → 빈 배열. 배열이 아니거나 항목 형태가 틀리면 null(호출부가 400 처리).
// 개수 초과는 오류가 아니라 앞에서부터 4장만 남기고 자른다(§C에 이미 사후 통지 UX가 있다).
export function normalizeDraftMedia(input: unknown): DeckMedia[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;
  if (!input.every(isDeckMedia)) return null;
  return input.slice(0, MAX_MEDIA_PER_POST);
}
