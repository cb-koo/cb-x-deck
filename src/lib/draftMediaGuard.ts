// PATCH /api/drafts/[id]의 media 검증. 클라이언트가 무엇을 보내든(형식 오류·과다 첨부)
// jsonb에 그대로 박히기 전에 여기서 걸러진다 — 이 값이 나중에 <img src>와
// createSignedUrls로 흘러간다(설계 §F).
import type { DeckMedia } from './types';

export const MAX_MEDIA_PER_POST = 4;

// 초안 첨부가 가질 수 있는 url 형태 — uploadDraftImage가 만드는 스토리지 경로(draft/<초안uuid>/<파일uuid>.<확장자>)
// 또는 uploadPendingDraftImage가 만드는 경로(draft/pending/<파일uuid>.<확장자>, 캠페인 v2 직접 쓰기 §5-2 —
// 원고가 생기기 전에 고른 이미지를 올려 두는 자리, draftMedia.ts 참고). 뒤의 것을 받아 주지 않으면 직접 쓰기로
// 만든 원고는 저장된 순간부터 이 PATCH 경로(다시 쓰기·이미지 편집)로 다시는 이미지를 못 건드리게 된다.
//
// "문자열이기만 하면 통과"로 냈다가 리뷰에서 잡혔다: 임의 URL이 jsonb에 저장되면 워크스페이스
// 전원의 브라우저가 그 주소로 <img src> 요청을 보낸다(추적 픽셀·IP 유출). 버킷의 MIME·용량
// 제한은 업로드 경로에만 있고 이 PATCH 경로는 통과하지 않으므로, 여기가 유일한 방어선이다.
// 정상 UI가 만들 수 없는 값은 전부 거절한다 — X CDN 절대 URL(http…)도 초안 첨부에는
// 존재할 일이 없으므로 허용하지 않는다(트윗 미디어는 draft가 아니라 tweet 테이블 소관).
const STORAGE_PATH_RE = /^draft\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|pending)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$/;

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

// POST /api/drafts/manual의 posts 파싱 — 두 입구가 같은 검증을 통과해야 한다(캠페인 v2 직접 쓰기 §5-2):
//  - 기존 입구(DraftWriteModal): posts: string[] — 이미지 없음, media는 항상 []
//  - 새 입구(캠페인 v2 XComposer): posts: { text, media }[] — media는 이미 업로드된 스토리지 경로
// media 검증은 PATCH /api/drafts/[id]와 같은 함수(normalizeDraftMedia)를 그대로 쓴다 — 다른 검증을
// 새로 만들면 두 경로의 신뢰 수준이 실제로는 달라지고, 그중 하나가 '문자열이기만 하면 통과'로 새는
// 취약점이 재발한다(위 STORAGE_PATH_RE 주석과 같은 사고).
export type ManualPostsParseResult =
  | { ok: true; posts: Array<{ text: string; media: DeckMedia[] }> }
  | { ok: false; error: 'empty' | 'media' };

export function parseManualPosts(raw: unknown): ManualPostsParseResult {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'empty' };
  const posts: Array<{ text: string; media: DeckMedia[] }> = [];
  for (const p of raw) {
    if (typeof p === 'string') {
      if (!p.trim()) return { ok: false, error: 'empty' };
      posts.push({ text: p, media: [] });
      continue;
    }
    if (typeof p !== 'object' || p === null || Array.isArray(p)) return { ok: false, error: 'empty' };
    const obj = p as { text?: unknown; media?: unknown };
    const text = typeof obj.text === 'string' ? obj.text : '';
    if (!text.trim()) return { ok: false, error: 'empty' };
    const media = normalizeDraftMedia(obj.media);
    if (media === null) return { ok: false, error: 'media' };
    posts.push({ text, media });
  }
  return { ok: true, posts };
}
