import type { PillarTopic } from './pillarTypes.ts';

export interface PillarStatsInput {
  tweetId: string;
  likes: number | null;
  isQuote: boolean;
  topicId: string | null; // null = 미분류
}

export type PillarVerdict = 'opportunity' | 'core' | 'low' | 'normal';

export interface PillarTopicStat {
  topicId: string;
  label: string;
  count: number;
  sharePct: number;      // 분류된 트윗 대비 %
  postCount: number;     // 투고
  quoteCount: number;    // 인용RT
  medianLikes: number;
  verdict: PillarVerdict;
  judgment: string;      // 판정 한 줄(사용자 언어) — verdict에서 파생, 라벨↔값 일치
}

export interface PillarStats {
  rows: PillarTopicStat[];        // ⭐기회 먼저, 이후 medianLikes 내림차순. 0건 주제 제외
  accountMedian: number;
  classifiedCount: number;
  unclassifiedCount: number;
  postCount: number;
  quoteCount: number;
}

// GET /api/columns/[id]/pillar 응답 형태 (서버·클라이언트 공용)
export interface PillarPayload {
  analysis: { topics: PillarTopic[]; sampleSize: number; analyzedAt: string } | null;
  stats: PillarStats | null;
  tweetTopics: Record<string, string>; // tweetId → topicId (컬럼 트윗 필터링용)
  unassignedCount: number;
  samplePeriod: [string, string] | null; // 분류된 트윗의 [최고(古), 최신] ISO
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function computePillarStats(tweets: PillarStatsInput[], topics: PillarTopic[]): PillarStats {
  const classified = tweets.filter((t) => t.topicId !== null);
  const accountMedian = median(classified.map((t) => t.likes ?? 0));
  const equalShare = topics.length > 0 ? 100 / topics.length : 100;

  const rows = topics
    .map((topic) => {
      const mine = classified.filter((t) => t.topicId === topic.id);
      const count = mine.length;
      const sharePct = classified.length ? Math.round((count / classified.length) * 100) : 0;
      const medianLikes = median(mine.map((t) => t.likes ?? 0));
      // 판정은 전부 파생값 — UI는 이 값을 그대로 표시만 한다 (라벨↔값 모순 방지)
      let verdict: PillarVerdict = 'normal';
      if (count >= 3 && sharePct < equalShare && accountMedian > 0 && medianLikes >= 1.5 * accountMedian) {
        verdict = 'opportunity';
      } else if (sharePct >= equalShare && medianLikes >= accountMedian) {
        verdict = 'core';
      } else if (medianLikes < 0.5 * accountMedian) {
        verdict = 'low';
      }
      const judgment =
        verdict === 'opportunity' ? '적게 올리는데 반응 최상 — 기회 주제'
        : verdict === 'core' ? '이 계정의 주력 주제'
        : verdict === 'low' ? (sharePct >= equalShare ? '많이 올리지만 반응 낮음' : '반응 낮음')
        : '반응 보통';
      return {
        topicId: topic.id, label: topic.label, count, sharePct,
        postCount: mine.filter((t) => !t.isQuote).length,
        quoteCount: mine.filter((t) => t.isQuote).length,
        medianLikes, verdict, judgment,
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) =>
      Number(b.verdict === 'opportunity') - Number(a.verdict === 'opportunity')
      || b.medianLikes - a.medianLikes);

  return {
    rows, accountMedian,
    classifiedCount: classified.length,
    unclassifiedCount: tweets.length - classified.length,
    postCount: classified.filter((t) => !t.isQuote).length,
    quoteCount: classified.filter((t) => t.isQuote).length,
  };
}
