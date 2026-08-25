// 계정 분석의 결정적 계산 전부 — LLM에 계산을 시키지 않는다(스펙 §3: 숫자는 코드가).
// DB·네트워크 없음. 저장되는 수치는 전부 "건수"고 비율·판단문은 UI가 파생한다.
export type TweetKind = 'original' | 'retweet' | 'quote';

export interface AnalysisTweet {
  id: string; text: string; createdAt: string; kind: TweetKind;
  views: number | null; likes: number | null; hasMedia: boolean;
}

export type ContentType = 'info' | 'review' | 'daily' | 'promo' | 'other';
export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  info: '정보', review: '후기·체험', daily: '일상·잡담', promo: '홍보·협찬', other: '기타',
};

export interface ClassifiedTweet {
  id: string; contentType: ContentType; sponsored: boolean;
  evidence: string | null; topics: string[];
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface SampleStats {
  perWeek: number;
  medianViews: number | null; medianLikes: number | null;
  mix: { original: number; retweet: number; quote: number };
}

// 반응 집계는 원글+인용만 — 순수 RT의 지표는 원작자 것이다(스펙 §3-2).
// 빈도의 분모: 3개월을 다 왔으면 since~until, 100건 상한에 걸렸으면 실제 받은 구간(최고령~until).
export function computeStats(
  tweets: AnalysisTweet[],
  opts: { since: string; until: string; truncatedByCount: boolean },
): SampleStats {
  const mix = { original: 0, retweet: 0, quote: 0 };
  for (const t of tweets) mix[t.kind] += 1;

  const engage = tweets.filter((t) => t.kind !== 'retweet');
  const medianViews = median(engage.map((t) => t.views).filter((v): v is number => v !== null));
  const medianLikes = median(engage.map((t) => t.likes).filter((v): v is number => v !== null));

  const oldest = tweets.length
    ? tweets.reduce((m, t) => (t.createdAt < m ? t.createdAt : m), tweets[0].createdAt)
    : opts.since;
  const spanStart = opts.truncatedByCount ? oldest : opts.since;
  const weeks = Math.max((Date.parse(opts.until) - Date.parse(spanStart)) / WEEK_MS, 1);
  const perWeek = Math.round((tweets.length / weeks) * 10) / 10;

  return { perWeek, medianViews, medianLikes, mix };
}

// 발행 히트맵의 재료 — 한국 날짜별 게시 건수('YYYY-MM-DD' → 건수). 게시가 없는 날은 키가 없다.
// 모든 kind를 센다: RT도 계정의 활동이고, perWeek(빈도 타일)와 분모가 같아야 두 수치가 어긋나 보이지 않는다.
// 고정 +9 — 한국은 1988년 이후 서머타임이 없다(datetime.ts와 같은 관례). Intl에 맡기면 런타임 시간대
// 데이터에 의존해 테스트가 환경에 흔들린다. 파싱 불가한 createdAt은 건너뛴다 — 'NaN' 키를 만들지 않는다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function dailyCounts(tweets: AnalysisTweet[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tweets) {
    const ms = Date.parse(t.createdAt);
    if (Number.isNaN(ms)) continue;
    const day = new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
    out[day] = (out[day] ?? 0) + 1;
  }
  return out;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 배치 분류의 알려진 실패 모드(항목 누락) 검출 — 누락분만 재호출한다(스펙 §3-3).
export function missingIds(
  sent: ReadonlyArray<{ id: string }>, got: ReadonlyArray<{ id: string }>,
): string[] {
  const have = new Set(got.map((g) => g.id));
  return sent.filter((s) => !have.has(s.id)).map((s) => s.id);
}

export interface TopicStat { tag: string; count: number; medianViews: number | null }

// canonicalOf: 원태그(소문자 trim 키) → 대표태그. "어떤 주제가 반응 좋은가"를 실제 수치로(스펙 §3-5).
export function topicStats(
  classified: ClassifiedTweet[], tweets: AnalysisTweet[], canonicalOf: Record<string, string>,
): TopicStat[] {
  const viewsOf = new Map(tweets.map((t) => [t.id, t.views]));
  const buckets = new Map<string, { count: number; views: number[] }>();
  for (const c of classified) {
    const canon = new Set(
      c.topics.map((t) => canonicalOf[t.trim().toLowerCase()] ?? canonicalOf[t]).filter(Boolean),
    );
    for (const tag of canon) {
      const b = buckets.get(tag as string) ?? { count: 0, views: [] };
      b.count += 1;
      const v = viewsOf.get(c.id);
      if (typeof v === 'number') b.views.push(v);
      buckets.set(tag as string, b);
    }
  }
  return [...buckets.entries()]
    .map(([tag, b]) => ({ tag, count: b.count, medianViews: median(b.views) }))
    .sort((a, b) => b.count - a.count);
}

export function typeDist(classified: ClassifiedTweet[]): Partial<Record<ContentType, number>> {
  const out: Partial<Record<ContentType, number>> = {};
  for (const c of classified) out[c.contentType] = (out[c.contentType] ?? 0) + 1;
  return out;
}

export function sponsoredCount(classified: ClassifiedTweet[]): number {
  return classified.filter((c) => c.sponsored).length;
}

// 종합 서술에 원문 샘플로 넣을 반응 상위 글 — RT·조회 미상 제외(스펙 §3-6).
export function topByViews(tweets: AnalysisTweet[], n: number): AnalysisTweet[] {
  return tweets
    .filter((t) => t.kind !== 'retweet' && t.views !== null)
    .sort((a, b) => (b.views as number) - (a.views as number))
    .slice(0, n);
}
