import type { DeckTweet } from './types.ts';

export interface BriefingCitation {
  n: number; tweetId: string; text: string;
  likes: number | null; url: string | null;
  flags: string[]; // 薬機法 주의 패턴(complianceFlags) — 경고 배지용, 필터링 없음
  tweet?: DeckTweet; // 저장 직전 라우트가 채우는 실트윗 스냅샷 — 근거 트윗 카드 렌더링용(작성자·아바타·지표·미디어)
}
export interface BriefingStatsWeek { weekStart: string; count: number; medianLikes: number }
export interface BriefingStats { periodFrom: string; periodTo: string; totalCount: number; weekly: BriefingStatsWeek[] }
export interface BriefingContent {
  headline?: string;              // 이번 기간을 한 문장으로(큰 메시지) — 초기 문서엔 없음
  tldr: string[];                 // 3줄 요약
  body: string;                   // 마크다운 본문(트윗 인용은 [T숫자] 토큰)
  citations: BriefingCitation[];  // 토큰 → 실트윗 복원 정보
  stats: BriefingStats;           // 코드 계산 수치(LLM 미경유)
}
