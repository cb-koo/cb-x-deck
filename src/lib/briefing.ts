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
export const FORBIDDEN_PHRASES = ['라고 할 수 있습니다', '주목할 만한', '인게이지먼트', '괄목할', '눈여겨볼 만', '양상을 보인다', '양상을 보이며', '시사한다'];

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

// 증감을 코드가 계산해 완성 문구로 — LLM은 이 문구만 인용, 직접 계산 금지(숫자 환각 차단)
function deltaText(cur: number, prev: number, vs = '전주'): string {
  if (prev === 0) return cur > 0 ? `(${vs} 0에서 증가)` : '';
  const p = Math.round(((cur - prev) / prev) * 100);
  return `(${vs} 대비 ${p >= 0 ? '+' : ''}${p}%)`;
}

// 기간 전체를 직전 동일 길이 기간과 비교 — "812"가 아니라 "직전보다 1.3배"가 정보가 되도록(비교 기준선).
// 직전 기간 표본이 없으면 null(비교 불가를 억지로 만들지 않는다).
export function periodComparison(tweets: BriefingTweet[], nowIso: string, weeks: number): string | null {
  const { from, toExclusive } = briefingPeriod(nowIso, weeks);
  const prevFrom = addWeeks(from, -weeks);
  const cur = filterPeriod(tweets, from, toExclusive);
  const prev = filterPeriod(tweets, prevFrom, from);
  if (prev.length === 0) return null;
  const med = (arr: BriefingTweet[]) => median(arr.map((t) => t.likes ?? 0));
  const vs = `직전 ${weeks}주`;
  return `기간 전체: 글 ${cur.length}건${deltaText(cur.length, prev.length, vs)}, 좋아요 중앙값 ${med(cur)}${deltaText(med(cur), med(prev), vs)}`;
}

export function statsNarrative(stats: BriefingStats): string[] {
  return stats.weekly.map((w, i) => {
    const d = new Date(w.weekStart + 'T00:00:00Z');
    const label = `${i + 1}주차(${d.getUTCMonth() + 1}/${d.getUTCDate()}~)`;
    if (i === 0) return `${label}: 글 ${w.count}건, 좋아요 중앙값 ${w.medianLikes} (기준 주)`;
    const prev = stats.weekly[i - 1];
    return `${label}: 글 ${w.count}건${deltaText(w.count, prev.count)}, 좋아요 중앙값 ${w.medianLikes}${deltaText(w.medianLikes, prev.medianLikes)}`;
  });
}

const SECTIONS = [
  ['topics', '핵심 화두'], ['hits', '반응이 좋았던 것'], ['changes', '변화'], ['implications', '기획 시사점'],
] as const;

const PROMPT = (columnTitle: string, stats: BriefingStats, tweetLines: string[], comparison: string | null) =>
  `당신은 일본 뷰티/미용의료 X(트위터)를 관찰해 한국 콘텐츠 기획팀에 보고하는 리서처입니다.
독자에는 이 분야를 잘 모르는 팀원도 있습니다. 이 보고서의 목적은 분석을 보여주는 것이 아니라,
읽는 사람이 ①지금 무슨 상황인지 파악하고 ②왜 중요한지 납득하고 ③다음에 뭘 해볼지 아이디어를 얻는 것입니다.

관찰 대상 컬럼: "${columnTitle}" · 기간: ${stats.periodFrom} ~ ${stats.periodTo} · 표본 ${stats.totalCount}건

[수치 — 코드가 계산한 확정값입니다. 숫자와 증감률(%)은 반드시 아래 문구의 값만 그대로 인용하고, 직접 세거나 계산하지 마세요]
${comparison ? comparison + '\n' : ''}${statsNarrative(stats).join('\n')}

[트윗 목록 — 트윗을 인용할 땐 반드시 [T번호] 표기만 사용하세요. 본문을 옮겨 적지 마세요]
${tweetLines.join('\n')}

다음 구조의 보고서를 한국어 JSON으로 작성하세요:
- headline: 이번 기간을 한 문장으로. 독자가 이것 하나만 기억해도 되는 큰 메시지
- tldr: 3줄 요약 (배열 3개, 각각 완결된 한 문장)
- topics: 핵심 화두 — 이 기간에 무슨 이야기가 돌았나
- hits: 반응이 좋았던 것 — 어떤 글이 통했고, 왜 통한 것으로 보이는지. 근거 트윗 [T번호] 인용 필수
- changes: 변화 — 흐름이 어디로 가고 있나. 위 수치 문구를 근거로
- implications: 기획 시사점 — 우리 계정의 콘텐츠 기획에 참고할 점. '- '로 시작하는 한 줄 항목 3~5개(줄바꿈으로 구분)

서술 원칙 (모든 섹션 공통):
1. 결론 먼저, 숫자는 근거로 뒤에. "글이 44건으로 줄었다"가 아니라 "관심이 식은 게 아니라 글만 줄었어요 — 글은 줄었는데(44건) 반응은 올랐거든요" 순서로.
2. 문단마다 '무슨 일이 → 왜 중요한지 → 그래서'를 완성하세요. 관찰만 하고 끝나는 문장을 남기지 마세요.
3. 근거 수준을 지키세요:
   - 패턴 주장("이런 글이 통했다")은 반드시 [T번호] 인용과 함께
   - 수치·인용으로 근거가 닿지 않는 해석은 "~일 수 있어요"처럼 추측임을 표시
   - 근거를 댈 수 없는 인과 단정(예: 사람들의 심리가 변했다)은 쓰지 마세요
4. 용어는 생활어로. 성분·시술·전문어는 첫 등장에 괄호로 한 줄 설명 (예: "아제라인산(여드름 피부용 성분)"). "인게이지먼트" 같은 업계어 금지
5. "~양상을 보인다", "~시사한다", "~라고 할 수 있습니다" 같은 보고서 말투 금지 — 옆자리 동료에게 말하듯 쓰세요
6. 짧은 완결 문장. 한 문단에는 하나의 이야기만. 컬럼 주제와 무관한 잡담성 트윗은 무시합니다
JSON만 출력: {"headline": "...", "tldr": ["...","...","..."], "topics": "...", "hits": "...", "changes": "...", "implications": "..."}`;

export async function generateBriefing(
  input: { columnTitle: string; tweets: BriefingTweet[]; stats: BriefingStats; comparison?: string | null },
  client?: AnthropicLike,
): Promise<BriefingContent | null> {
  const c = client ?? (new Anthropic() as unknown as AnthropicLike);
  const numbered = input.tweets.map((t, i) => ({ n: i + 1, t }));
  // 주차 표기 — LLM이 "후반부에 떴다" 같은 변화 서술을 특정 트윗으로 근거 댈 수 있게
  const weekIdxOf = (t: BriefingTweet): string => {
    if (!t.createdAt) return '';
    const w = weekStartJst(t.createdAt);
    if (!w) return '';
    const idx = Math.floor((Date.parse(w + 'T00:00:00Z') - Date.parse(input.stats.periodFrom + 'T00:00:00Z')) / (7 * 86_400_000)) + 1;
    return idx >= 1 ? `${idx}주차 · ` : '';
  };
  const lines = numbered.map(({ n, t }) => `[T${n}] (${weekIdxOf(t)}♥${t.likes ?? 0}) ${t.text.replace(/\s+/g, ' ').slice(0, 200)}`);

  const res = await c.messages.create({
    model: MODEL(),
    max_tokens: 3000,
    messages: [{ role: 'user', content: PROMPT(input.columnTitle, input.stats, lines, input.comparison ?? null) }],
  });
  const j = extractJson(res) as Record<string, unknown> | null;
  if (!j) return null;

  const tldr = Array.isArray(j.tldr) ? j.tldr.filter((x): x is string => typeof x === 'string').slice(0, 3) : [];
  if (tldr.length !== 3) return null;
  for (const [key] of SECTIONS) if (typeof j[key] !== 'string' || !(j[key] as string).trim()) return null;

  // 본문 조립은 코드가 — 섹션 제목·순서 고정(회차 간 비교 가능)
  let body = SECTIONS.map(([key, title]) => `## ${title}\n${(j[key] as string).trim()}`).join('\n\n');

  // 인용 검증: [T1, T7] 같은 묶음은 개별 토큰으로 분해 → 존재하는 번호만 표준형 [Tn]으로 살리고 유령 번호는 제거.
  // 본문과 3줄 요약(tldr) 모두 같은 규칙 적용 — 독자가 보는 모든 대괄호가 실트윗으로 복원 가능해야 한다.
  const valid = new Set<number>();
  const validateTokens = (s: string) => s
    .replace(/\[\s*[Tt]\s*\d+(?:\s*,\s*[Tt]?\s*\d+)+\s*\]/g,
      (m) => (m.match(/\d+/g) ?? []).map((d) => `[T${d}]`).join(''))
    .replace(/\[\s*[Tt]\s*(\d+)\s*\]/g, (_tok, d: string) => {
      const n = Number(d);
      if (n >= 1 && n <= numbered.length) { valid.add(n); return `[T${n}]`; }
      return '';
    });
  body = validateTokens(body);
  const tldrOut = tldr.map(validateTokens);
  const headline = typeof j.headline === 'string' && j.headline.trim() ? validateTokens(j.headline.trim()) : '';
  if (!headline) return null; // 헤드라인(한 문장 큰 메시지)은 필수 — 형식 불량은 저장하지 않는다
  const citations: BriefingCitation[] = [...valid].sort((a, b) => a - b).map((n) => {
    const t = numbered[n - 1].t;
    return { n, tweetId: t.tweetId, text: t.text, likes: t.likes, url: t.tweetUrl, flags: flagYakkiho(t.text) };
  });

  // 문체 검증 — 금지 표현이 있으면 통째 실패(반쪽 문서를 저장하지 않는다)
  const all = headline + ' ' + tldrOut.join(' ') + ' ' + body;
  if (FORBIDDEN_PHRASES.some((p) => all.includes(p))) return null;

  return { headline, tldr: tldrOut, body, citations, stats: input.stats };
}
