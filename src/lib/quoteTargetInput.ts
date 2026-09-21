import { isUuidLike } from './uuid.ts';
import { parseTweetLink } from './tweetLink.ts';

// 새 작업 폼의 대상. 본문을 받지 않고 서버가 직접 조회한다.
export type QuoteTargetInput = { taskId: string; url?: never } | { url: string; taskId?: never };
export function parseQuoteTargetInput(value: unknown): QuoteTargetInput | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('인용 대상 정보가 올바르지 않아요');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 1) throw new Error('인용 대상은 작업 또는 링크 하나만 골라주세요');
  if (typeof v.taskId === 'string' && isUuidLike(v.taskId)) return { taskId: v.taskId };
  if (typeof v.url === 'string' && parseTweetLink(v.url).ok) return { url: v.url.trim() };
  throw new Error('인용 대상 작업이나 X 게시물 링크를 확인해 주세요');
}
