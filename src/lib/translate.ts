import { callLLM, type AnthropicLike } from './llm.ts';
import { extractJson, MODEL } from './suggest.ts';
import type { TweetTranslation } from './types.ts';

// 프롬프트/용어집을 바꿀 때마다 +1 — 캐시(prompt_version)가 자동으로 무효화된다.
export const PROMPT_VERSION = 1;

// 한 번의 LLM 호출에 묶는 트윗 수. 200건 컬럼도 이 단위로 쪼개 병렬 호출(동시성 상한 CONCURRENCY).
const CHUNK = 20;
const CONCURRENCY = 5;

export interface TranslateInput {
  tweetId: string;
  text: string;
  quotedText?: string | null;
}

// 미용/미용의료 핵심 용어집(소량). 늘리면 PROMPT_VERSION을 올릴 것.
const GLOSSARY = [
  '毛穴→모공', 'キメ→피부결', '薬機法→약기법(일본 의약품·의료기기 광고 규제법)',
  'スキンケア→스킨케어', '美容医療→미용의료', '施術→시술', '成分→성분',
  'ニキビ→여드름', 'シミ→기미', 'シワ→주름', 'たるみ→처짐',
  'ヒアルロン酸→히알루론산', 'レチノール→레티놀', 'ビタミンC→비타민C',
  '美白→미백', '保湿→보습', '角質→각질', '皮脂→피지', '毛穴の開き→모공 확장',
];

function buildPrompt(chunk: TranslateInput[]): string {
  const lines = chunk.map((t, i) => {
    const body = `[${i + 1}] (본문) ${t.text.replace(/\s+/g, ' ')}`;
    return t.quotedText ? `${body}\n    (인용) ${t.quotedText.replace(/\s+/g, ' ')}` : body;
  });
  return `당신은 일본 뷰티/미용의료 X(트위터)를 한국 콘텐츠 기획팀에 전달하는 번역가입니다.
아래 일본어 트윗들을 자연스러운 한국어로 번역하세요.

규칙:
- @멘션, #해시태그, URL, 숫자, 이모지는 원문 그대로 보존(번역·삭제 금지)
- 직역 금지 — 한국 뷰티 업계에서 통용되는 표현으로. 트윗 특유의 구어 톤 유지
- 아래 용어집을 우선 적용:
${GLOSSARY.map((g) => `  ${g}`).join('\n')}

[트윗 목록]
${lines.join('\n')}

각 트윗을 번호(위 [n])를 키로 하는 JSON으로 출력하세요. 인용(본문 아래 '(인용)')이 있으면 quoted도
번역하고, 없으면 quoted는 null. 본문 번역은 body에 넣습니다.
JSON만 출력: {"1":{"body":"...","quoted":null},"2":{"body":"...","quoted":"..."}}`;
}

async function translateChunk(chunk: TranslateInput[], client?: AnthropicLike): Promise<Array<[string, TweetTranslation]>> {
  let res;
  try {
    // max_tokens 8000: 청크(최대 CHUNK건) 한국어 번역 JSON이 잘리지 않게 넉넉히 —
    // 잘리면 extractJson 실패로 이 청크 전체가 유실되므로 헤드룸을 크게 둔다.
    res = await callLLM('anthropic.translate',
      { model: MODEL(), max_tokens: 8000, messages: [{ role: 'user', content: buildPrompt(chunk) }] }, client);
  } catch (e) {
    // 청크 단위 실패(레이트리밋·네트워크·5xx)가 배치 전체를 죽이지 않게 —
    // 이 청크만 비우고 나머지 청크의 성공분은 살린다(부분 성공 유지).
    console.error('[translate] 청크 호출 실패', { size: chunk.length, err: e instanceof Error ? e.message : String(e) });
    return [];
  }
  const j = extractJson(res) as Record<string, unknown> | null;
  if (!j) return [];
  const entries: Array<[string, TweetTranslation]> = [];
  chunk.forEach((t, i) => {
    const item = j[String(i + 1)];
    if (!item || typeof item !== 'object') return;
    const { body, quoted } = item as { body?: unknown; quoted?: unknown };
    if (typeof body !== 'string' || !body.trim()) return; // body 없으면 건너뜀(부분 성공)
    const q = typeof quoted === 'string' ? quoted.trim() : '';
    entries.push([t.tweetId, { content: body.trim(), quotedContent: q ? q : null }]);
  });
  return entries;
}

// 동시성 상한을 지키며 청크를 병렬 처리(rate limit 보호).
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function translateTweets(
  tweets: TranslateInput[],
  client?: AnthropicLike,
  chunkSize: number = CHUNK,
): Promise<Map<string, TweetTranslation>> {
  const out = new Map<string, TweetTranslation>();
  if (tweets.length === 0) return out;
  const chunks: TranslateInput[][] = [];
  for (let i = 0; i < tweets.length; i += chunkSize) chunks.push(tweets.slice(i, i + chunkSize));
  const perChunk = await mapLimit(chunks, CONCURRENCY, (c) => translateChunk(c, client));
  for (const entries of perChunk) for (const [id, tr] of entries) out.set(id, tr);
  return out;
}
