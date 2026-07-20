import { extractJson, MODEL, type AnthropicLike } from './suggest.ts';
import { callLLM } from './llm.ts';
import type { Assignment, PillarTopic } from './pillarTypes.ts';

export interface PillarInputTweet { tweetId: string; text: string }

export const MAX_ANALYSIS_TWEETS = 500;

function tweetLines(tweets: PillarInputTweet[]): string {
  return tweets.map((t, i) => `${i + 1}. ${t.text.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n');
}

const DERIVE_PROMPT = (lines: string, n: number) => `당신은 일본 뷰티/미용의료 X(트위터) 계정의 콘텐츠 전략 분석가입니다.
아래는 한 계정의 트윗 ${n}건입니다 (번호. 본문):
${lines}

이 계정의 콘텐츠 주제(콘텐츠 기둥)를 5~10개 도출하고, 각 트윗을 가장 잘 맞는 주제 하나에 배정하세요.
규칙:
- 주제 라벨은 한국어로 짧게(2~10자). 게시 형식(공지·이벤트 등)이 아니라 소재·화두 기준으로 묶는다 (예: "성분·피부 지식", "시술 안내", "원장 일상")
- 트윗 수가 적으면 주제 수도 줄인다(최소 3개). 억지로 늘리지 않는다
- 어느 주제에도 확실히 안 맞는 트윗은 배정을 생략한다
JSON만 출력. assignments의 값은 트윗 번호 배열:
{"topics":[{"id":"t1","label":"성분·피부 지식"}],"assignments":{"t1":[1,5,9],"t2":[2,3]}}`;

const CLASSIFY_PROMPT = (topics: PillarTopic[], lines: string) => `당신은 일본 뷰티/미용의료 X(트위터) 계정의 콘텐츠 전략 분석가입니다.
기존 주제 목록:
${topics.map((t) => `- ${t.id}: ${t.label}`).join('\n')}

아래 새 트윗들을 위 주제 중 가장 잘 맞는 하나에 배정하세요 (번호. 본문):
${lines}

규칙: 새 주제를 만들지 않는다. 어느 주제에도 확실히 안 맞는 트윗은 배정을 생략한다.
JSON만 출력. 값은 트윗 번호 배열: {"assignments":{"t1":[1,3]}}`;

// LLM 응답의 번호 배정({"t1":[1,5]})을 tweetId 배정으로 역매핑 — 방어적(없는 주제·번호·중복 제거)
function parseAssignments(v: unknown, topics: PillarTopic[], tweets: PillarInputTweet[]): Assignment[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  const ids = new Set(topics.map((t) => t.id));
  const seen = new Set<string>();
  const out: Assignment[] = [];
  for (const [topicId, nums] of Object.entries(v as Record<string, unknown>)) {
    if (!ids.has(topicId) || !Array.isArray(nums)) continue;
    for (const n of nums) {
      const t = typeof n === 'number' ? tweets[n - 1] : undefined;
      if (t && !seen.has(t.tweetId)) {
        seen.add(t.tweetId);
        out.push({ tweetId: t.tweetId, topicId });
      }
    }
  }
  return out;
}

function parseTopics(v: unknown): PillarTopic[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: PillarTopic[] = [];
  for (const x of v) {
    if (typeof x !== 'object' || x === null) continue;
    const id = (x as Record<string, unknown>).id;
    const label = (x as Record<string, unknown>).label;
    if (typeof id !== 'string' || typeof label !== 'string') continue;
    if (seen.has(id)) continue; // 중복 id — 첫 번째만 유지
    seen.add(id);
    out.push({ id, label });
    if (out.length >= 10) break;
  }
  return out;
}

// 전체 분석: 주제 도출 + 배정을 한 호출로. 실패 시 null — 호출측은 기존 스냅샷을 덮지 않는다
export async function deriveTopics(
  tweetsIn: PillarInputTweet[],
  client?: AnthropicLike,
): Promise<{ topics: PillarTopic[]; assignments: Assignment[] } | null> {
  const tweets = tweetsIn.slice(0, MAX_ANALYSIS_TWEETS);
  const res = await callLLM('anthropic.pillar',
    { model: MODEL(), max_tokens: 4000, messages: [{ role: 'user', content: DERIVE_PROMPT(tweetLines(tweets), tweets.length) }] }, client);
  const j = extractJson(res) as { topics?: unknown; assignments?: unknown } | null;
  if (!j) return null;
  const topics = parseTopics(j.topics);
  if (topics.length === 0) return null;
  return { topics, assignments: parseAssignments(j.assignments, topics, tweets) };
}

// 증분 분류: 기존 주제에 새 트윗만 배정(주제 안정·비용 최소). 실패 시 [] — 미분류로 남아 무해
export async function classifyTweets(
  topics: PillarTopic[],
  tweetsIn: PillarInputTweet[],
  client?: AnthropicLike,
): Promise<Assignment[]> {
  const tweets = tweetsIn.slice(0, MAX_ANALYSIS_TWEETS);
  if (topics.length === 0 || tweets.length === 0) return [];
  const res = await callLLM('anthropic.pillar',
    { model: MODEL(), max_tokens: 2000, messages: [{ role: 'user', content: CLASSIFY_PROMPT(topics, tweetLines(tweets)) }] }, client);
  const j = extractJson(res) as { assignments?: unknown } | null;
  if (!j) return [];
  return parseAssignments(j.assignments, topics, tweets);
}
