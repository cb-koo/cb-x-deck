import { callLLM, type AnthropicLike } from './llm.ts';
import { extractJson, MODEL } from './suggest.ts';
import type { TweetTranslation } from './types.ts';

// 프롬프트/용어집을 바꿀 때마다 +1 — 캐시(prompt_version)가 자동으로 무효화된다.
// v2: 줄바꿈 보존(공백 뭉개기 제거·블록 포맷·개행 유지 규칙) — 기존 캐시 재번역 유도.
export const PROMPT_VERSION = 2;

// 트윗당 LLM 호출 1개(CHUNK=1) — 한 트윗 출력은 항상 작아 max_tokens 잘림이 원천 불가능하고,
// 한 건 실패해도 나머지에 영향 없음(과거 묶음 잘림→청크 전체 유실 502를 구조적으로 제거).
// 요청 내 여러 트윗은 CONCURRENCY만큼 병렬 호출해 속도를 유지한다.
const CHUNK = 1;
const CONCURRENCY = 8;

export interface TranslateInput {
  tweetId: string;
  text: string;
  quotedText?: string | null;
}

// 미용/미용의료 핵심 용어집(소량). 늘리면 PROMPT_VERSION을 올릴 것. (translateDraft.ts와 공유)
export const GLOSSARY = [
  '毛穴→모공', 'キメ→피부결', '薬機法→약기법(일본 의약품·의료기기 광고 규제법)',
  'スキンケア→스킨케어', '美容医療→미용의료', '施術→시술', '成分→성분',
  'ニキビ→여드름', 'シミ→기미', 'シワ→주름', 'たるみ→처짐',
  'ヒアルロン酸→히알루론산', 'レチノール→레티놀', 'ビタミンC→비타민C',
  '美白→미백', '保湿→보습', '角質→각질', '皮脂→피지', '毛穴の開き→모공 확장',
];

function buildPrompt(chunk: TranslateInput[]): string {
  // 원문 줄바꿈을 보존해야 하므로 공백을 뭉개지 않는다. 다중 행이어도 파싱이 안전하도록
  // 각 트윗을 "### 트윗 N" 블록으로 구분한다(예전엔 한 줄로 눌러 줄바꿈이 소실됐음).
  const blocks = chunk.map((t, i) => {
    let b = `### 트윗 ${i + 1}\n[본문]\n${t.text}`;
    if (t.quotedText) b += `\n[인용]\n${t.quotedText}`;
    return b;
  });
  return `당신은 일본 뷰티/미용의료 X(트위터)를 한국 콘텐츠 기획팀에 전달하는 번역가입니다.
아래 일본어 트윗들을 자연스러운 한국어로 번역하세요.

규칙:
- @멘션, #해시태그, URL, 숫자, 이모지는 원문 그대로 보존(번역·삭제 금지)
- **원문의 줄바꿈(개행) 구조를 그대로 유지**하세요. 원문이 여러 줄이면 번역도 같은 줄 구성으로.
- 직역 금지 — 한국 뷰티 업계에서 통용되는 표현으로. 트윗 특유의 구어 톤 유지
- 아래 용어집을 우선 적용:
${GLOSSARY.map((g) => `  ${g}`).join('\n')}

[트윗 목록 — 각 트윗은 "### 트윗 N" 블록, 그 안에 [본문]과 (있으면) [인용]]
${blocks.join('\n\n')}

각 트윗을 번호(### 트윗 N의 N)를 키로 하는 JSON으로 출력하세요. [인용]이 있으면 quoted도
번역하고, 없으면 quoted는 null. 본문 번역은 body에 넣습니다.
문자열 안의 줄바꿈은 \\n으로 이스케이프하세요.
JSON만 출력: {"1":{"body":"...","quoted":null},"2":{"body":"...","quoted":"..."}}`;
}

async function translateChunk(chunk: TranslateInput[], client?: AnthropicLike): Promise<Array<[string, TweetTranslation]>> {
  let res;
  try {
    // 트윗당 4000토큰(가장 긴 트윗+인용의 한국어 번역+JSON도 충분히 담김). CHUNK=1이라 1건=4000 —
    // 단일 트윗은 이 상한에 닿을 수 없어 잘림이 발생하지 않는다.
    const maxTokens = Math.min(8000, chunk.length * 4000);
    res = await callLLM('anthropic.translate',
      { model: MODEL(), max_tokens: maxTokens, messages: [{ role: 'user', content: buildPrompt(chunk) }] }, client);
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
