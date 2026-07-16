import Anthropic from '@anthropic-ai/sdk';
import { extractJson, MODEL, type AnthropicLike } from './suggest.ts';
import { weekStartJst, addWeeks, median } from './trend.ts';
import { flagYakkiho } from './complianceFlags.ts';
import type { BriefingContent, BriefingCitation, BriefingStats } from './briefingTypes.ts';

export interface BriefingTweet {
  tweetId: string; text: string; likes: number | null;
  createdAt: string | null; tweetUrl: string | null;
}

export const BRIEFING_WEEKS = [2, 4, 8] as const;
export const BRIEFING_TWEET_CAP = 300;
// AI 상투 표현·업계 압축어 — 출력에 있으면 검증 실패(회귀 테스트로 고정)
export const FORBIDDEN_PHRASES = ['라고 할 수 있습니다', '주목할 만한', '인게이지먼트', '괄목할', '눈여겨볼 만'];

const DAY_MS = 86_400_000;

// 기간 = 마지막 완성 주 기준 소급 N주(집계 중인 현재 주 제외 — 후반부가 식어 보이는 왜곡 방지)
export function briefingPeriod(nowIso: string, weeks: number): { from: string; toExclusive: string; toDisplay: string } {
  const toExclusive = weekStartJst(nowIso);
  return {
    from: addWeeks(toExclusive, -weeks),
    toExclusive,
    toDisplay: new Date(Date.parse(toExclusive + 'T00:00:00Z') - DAY_MS).toISOString().slice(0, 10),
  };
}

export function filterPeriod(tweets: BriefingTweet[], from: string, toExclusive: string): BriefingTweet[] {
  return tweets.filter((t) => {
    if (!t.createdAt) return false;
    const w = weekStartJst(t.createdAt);
    return w >= from && w < toExclusive;
  });
}

export function computeBriefingStats(tweets: BriefingTweet[], nowIso: string, weeks: number): BriefingStats {
  const { from, toExclusive, toDisplay } = briefingPeriod(nowIso, weeks);
  const inPeriod = filterPeriod(tweets, from, toExclusive);
  const byWeek = new Map<string, BriefingTweet[]>();
  for (const t of inPeriod) {
    const w = weekStartJst(t.createdAt!);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w)!.push(t);
  }
  const weekly = [];
  for (let i = 0; i < weeks; i++) {
    const w = addWeeks(from, i);
    const arr = byWeek.get(w) ?? [];
    weekly.push({ weekStart: w, count: arr.length, medianLikes: median(arr.map((t) => t.likes ?? 0)) });
  }
  return { periodFrom: from, periodTo: toDisplay, totalCount: inPeriod.length, weekly };
}

// 상한 선별: 주별로 좋아요 내림차순 정렬 후 라운드로빈 — 상위 반응 우선 + 시간 편중 방지
export function selectBriefingTweets(tweets: BriefingTweet[], cap = BRIEFING_TWEET_CAP): BriefingTweet[] {
  const byWeek = new Map<string, BriefingTweet[]>();
  for (const t of tweets) {
    if (!t.createdAt) continue;
    const w = weekStartJst(t.createdAt);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w)!.push(t);
  }
  for (const arr of byWeek.values()) arr.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
  const weeks = [...byWeek.keys()].sort();
  const out: BriefingTweet[] = [];
  for (let i = 0; out.length < cap; i++) {
    let added = false;
    for (const w of weeks) {
      const t = byWeek.get(w)![i];
      if (t && out.length < cap) { out.push(t); added = true; }
    }
    if (!added) break;
  }
  return out;
}

const SECTIONS = [
  ['topics', '핵심 화두'], ['hits', '반응이 좋았던 것'], ['changes', '변화'], ['implications', '기획 시사점'],
] as const;

const PROMPT = (columnTitle: string, stats: BriefingStats, tweetLines: string[]) =>
  `당신은 일본 뷰티/미용의료 X(트위터)를 관찰해 한국 콘텐츠 기획팀에 보고하는 리서처입니다.
관찰 대상 컬럼: "${columnTitle}" · 기간: ${stats.periodFrom} ~ ${stats.periodTo} · 표본 ${stats.totalCount}건

[주별 수치 — 코드가 계산한 확정값입니다. 숫자는 반드시 아래 값만 인용하고, 직접 세거나 계산하지 마세요]
${stats.weekly.map((w) => `${w.weekStart} 주: ${w.count}건, 좋아요 중앙값 ${w.medianLikes}`).join('\n')}

[트윗 목록 — 트윗을 인용할 땐 반드시 [T번호] 표기만 사용하세요. 본문을 옮겨 적지 마세요]
${tweetLines.join('\n')}

다음 구조의 보고서를 한국어 JSON으로 작성하세요:
- tldr: 3줄 요약 (배열 3개, 각각 완결된 한 문장)
- topics: 핵심 화두 — 이 기간에 무슨 이야기가 돌았나
- hits: 반응이 좋았던 것 — 어떤 내용·형식이 반응을 얻었나. 근거 트윗을 [T번호]로 인용
- changes: 변화 — 기간 전반부와 후반부 사이에 뜨거나 식은 것. 위 주별 수치를 근거로
- implications: 기획 시사점 — 우리 계정의 콘텐츠 기획에 참고할 점

문체 규칙 (엄수):
- 처음 읽는 팀원이 배경 설명 없이 이해할 수 있게 씁니다
- 전문용어·업계 압축어 금지. 부득이하면 바로 옆에 풀어 씁니다 (예: "인게이지먼트" 대신 "반응(좋아요·리트윗)")
- "~라고 할 수 있습니다", "주목할 만한" 같은 상투 표현과 과장 수식어 금지
- 짧은 완결 문장으로, 한 문단에는 하나의 이야기만
- 컬럼 주제와 무관한 잡담성 트윗은 무시합니다
JSON만 출력: {"tldr": ["...","...","..."], "topics": "...", "hits": "...", "changes": "...", "implications": "..."}`;

export async function generateBriefing(
  input: { columnTitle: string; tweets: BriefingTweet[]; stats: BriefingStats },
  client?: AnthropicLike,
): Promise<BriefingContent | null> {
  const c = client ?? (new Anthropic() as unknown as AnthropicLike);
  const numbered = input.tweets.map((t, i) => ({ n: i + 1, t }));
  const lines = numbered.map(({ n, t }) => `[T${n}] (♥${t.likes ?? 0}) ${t.text.replace(/\s+/g, ' ').slice(0, 200)}`);

  const res = await c.messages.create({
    model: MODEL(),
    max_tokens: 3000,
    messages: [{ role: 'user', content: PROMPT(input.columnTitle, input.stats, lines) }],
  });
  const j = extractJson(res) as Record<string, unknown> | null;
  if (!j) return null;

  const tldr = Array.isArray(j.tldr) ? j.tldr.filter((x): x is string => typeof x === 'string').slice(0, 3) : [];
  if (tldr.length !== 3) return null;
  for (const [key] of SECTIONS) if (typeof j[key] !== 'string' || !(j[key] as string).trim()) return null;

  // 본문 조립은 코드가 — 섹션 제목·순서 고정(회차 간 비교 가능)
  let body = SECTIONS.map(([key, title]) => `## ${title}\n${(j[key] as string).trim()}`).join('\n\n');

  // 인용 검증: 존재하는 번호만 살리고(실트윗 복원), 유령 번호는 본문에서 제거
  const valid = new Set<number>();
  body = body.replace(/\[\s*[Tt]\s*(\d+)\s*\]/g, (_tok, d: string) => {
    const n = Number(d);
    if (n >= 1 && n <= numbered.length) { valid.add(n); return `[T${n}]`; }
    return '';
  });
  const citations: BriefingCitation[] = [...valid].sort((a, b) => a - b).map((n) => {
    const t = numbered[n - 1].t;
    return { n, tweetId: t.tweetId, text: t.text, likes: t.likes, url: t.tweetUrl, flags: flagYakkiho(t.text) };
  });

  // 문체 검증 — 금지 표현이 있으면 통째 실패(반쪽 문서를 저장하지 않는다)
  const all = tldr.join(' ') + ' ' + body;
  if (FORBIDDEN_PHRASES.some((p) => all.includes(p))) return null;

  return { tldr, body, citations, stats: input.stats };
}
