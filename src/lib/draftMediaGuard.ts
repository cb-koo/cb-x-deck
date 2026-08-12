// PATCH /api/drafts/[id]의 media 검증. 클라이언트가 무엇을 보내든(형식 오류·과다 첨부)
// jsonb에 그대로 박히기 전에 여기서 걸러진다 — 이 값이 나중에 <img src>와
// createSignedUrls로 흘러간다(설계 §F).
import type { DeckMedia } from './types';

export const MAX_MEDIA_PER_POST = 4;

function isDeckMedia(item: unknown): item is DeckMedia {
  if (typeof item !== 'object' || item === null) return false;
  const m = item as { type?: unknown; url?: unknown; videoUrl?: unknown };
  return typeof m.type === 'string' && typeof m.url === 'string' &&
    (m.videoUrl === null || typeof m.videoUrl === 'string');
}

// undefined(필드 없음) → 빈 배열. 배열이 아니거나 항목 형태가 틀리면 null(호출부가 400 처리).
// 개수 초과는 오류가 아니라 앞에서부터 4장만 남기고 자른다(§C에 이미 사후 통지 UX가 있다).
export function normalizeDraftMedia(input: unknown): DeckMedia[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;
  if (!input.every(isDeckMedia)) return null;
  return input.slice(0, MAX_MEDIA_PER_POST);
}
