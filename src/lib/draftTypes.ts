import type { DeckMedia } from './types.ts';
import type { Pricing } from './influencerPricing.ts';

// 초안 본문 — 단문은 posts 1개, 스레드는 N개. 미디어는 반드시 포스트 단위(스레드는 트윗마다 이미지가 따로 붙음).
// v1은 media를 항상 빈 배열로 저장하고 렌더는 MediaGrid에 위임(0건 → null) — 이미지 확장 지점(스펙 '향후 확장').
export interface DraftPost { text: string; media: DeckMedia[] }
export interface DraftContent { posts: DraftPost[] }
export type DraftFormat = 'single' | 'thread';
export type ReferenceMode = 'off' | 'form' | 'angle' | 'both';

// 배정 후보 한 건. 문자열이 아니라 객체인 이유는 하나 — 나중에 목록이 `하다칸 (@hadakan__)`처럼
// 이름을 병기할 때 타입도 호출부도 바뀌지 않게 하기 위해서다. name은 지금 항상 비어 있고,
// 인플루언서 목록 DB가 생기면 그쪽이 채운다.
// pricing: 인플 단가(influencer.pricing, 032) — 캠페인 작업 비용 제안 소스(campaignCost.suggestTaskCost).
// 자동완성 후보를 받는 화면이 배정 직후 그대로 제안에 쓴다. 없으면(명부에 없는 핸들) 제안 없음.
// avatarUrl: 프로필 사진(§6, 작업 패널 인플 칸용) — 결제 수단 정보는 여기 싣지 않는다.
export interface InfluencerOption { id?: string; handle: string; name?: string; avatarUrl?: string; pricing?: Pricing }

// 생성 시점 레퍼런스 스냅샷 — 메모는 이후 수정될 수 있으므로 생성에 쓴 것을 박제(근거 풋터 재현)
export interface RefSnapshot {
  tweetId: string; handle: string; name: string | null;
  excerpt: string;
  memos: Array<{ member: string; text: string }>;
  // 인용RT의 대상은 일반 레퍼런스와 역할이 다르다. 기존 JSON에는 이 키가 없으므로 없으면 일반 레퍼런스다.
  role?: 'quoteTarget';
}
