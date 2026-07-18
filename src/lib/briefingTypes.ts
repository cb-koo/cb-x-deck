import type { DeckTweet } from './types.ts';

export interface BriefingCitation {
  n: number; tweetId: string; text: string;
  likes: number | null; url: string | null;
  flags: string[]; // 薬機法 주의 패턴(complianceFlags) — 경고 배지용, 필터링 없음
  tweet?: DeckTweet; // 저장 직전 라우트가 채우는 실트윗 스냅샷 — 근거 트윗 카드 렌더링용(작성자·아바타·지표·미디어)
}
export interface BriefingStatsWeek { weekStart: string; count: number; medianLikes: number }
export interface BriefingStats { periodFrom: string; periodTo: string; totalCount: number; weekly: BriefingStatsWeek[] }
// 트렌드 모듈 — 리포트의 단위. 이름·단계·정의·서술·대표 트윗·액션이 한 덩어리로 완결(레퍼런스 표준 구조)
export type TrendStage = 'rising' | 'steady' | 'cooling';
export interface TrendModule {
  name: string;        // 캐치한 트렌드 이름
  stage: TrendStage;   // 뜨는 중 / 유지 / 식는 중 — 서술에 수치 근거 필수
  definition: string;  // 한 줄 정의
  body: string;        // 무슨 일·왜 통하나 (2~4문장, [T숫자] 인용 포함 가능)
  action: string;      // 해볼 것 1개(구체적)
  tweets: number[];    // 대표 트윗 인용 번호 1~3개 — 모듈 안에 임베드
}

export interface BriefingContent {
  headline?: string;              // 이번 기간을 한 문장으로(큰 메시지) — 초기 문서엔 없음
  tldr: string[];                 // 3줄 요약
  trends?: TrendModule[];         // v3: 트렌드 모듈들 — 있으면 모듈 렌더러 사용
  watchlist?: string;             // v3: 다음 주 지켜볼 것
  body: string;                   // v2 이하 문서의 마크다운 본문(v3에선 빈 문자열) — 렌더 호환용
  citations: BriefingCitation[];  // 토큰 → 실트윗 복원 정보
  stats: BriefingStats;           // 코드 계산 수치(LLM 미경유)
}
