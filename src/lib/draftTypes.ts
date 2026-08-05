import type { DeckMedia } from './types.ts';

// 초안 본문 — 단문은 posts 1개, 스레드는 N개. 미디어는 반드시 포스트 단위(스레드는 트윗마다 이미지가 따로 붙음).
// v1은 media를 항상 빈 배열로 저장하고 렌더는 MediaGrid에 위임(0건 → null) — 이미지 확장 지점(스펙 '향후 확장').
export interface DraftPost { text: string; media: DeckMedia[] }
export interface DraftContent { posts: DraftPost[] }
export type DraftFormat = 'single' | 'thread';
export type ReferenceMode = 'off' | 'form' | 'angle' | 'both';

// 생성 시점 레퍼런스 스냅샷 — 메모는 이후 수정될 수 있으므로 생성에 쓴 것을 박제(근거 풋터 재현)
export interface RefSnapshot {
  tweetId: string; handle: string; name: string | null;
  excerpt: string;
  memos: Array<{ member: string; text: string }>;
}
