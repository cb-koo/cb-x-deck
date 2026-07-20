import { callLLM, type AnthropicLike } from './llm.ts';
export type { AnthropicLike };

export interface KwPair { ja: string; ko: string }

export const MODEL = () => process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';

const PROMPT = (keyword: string) => `당신은 일본 뷰티/미용의료 X(트위터) 검색 전문가입니다.
검색 키워드: "${keyword}" (한국어일 수도, 일본어일 수도 있음)

이 키워드로 일본어 X 검색을 확장하기 위한 연관 키워드를 제안하세요:
- variants: 같은 대상의 일본어 표기 변형(ひらがな/カタカナ/한자/영어 표기, 통칭·속어). 3~6개
- adjacent: 인접 개념(관련 성분→피부 고민→시술명→제품 카테고리 방향). 3~6개

규칙:
- ja는 전부 일본 X에서 실제로 검색될 법한 짧은 단어. 문장 금지. 입력 키워드 자체는 제외
- 각 항목에 한국어 번역 ko를 함께 제공 (한국 뷰티 업계에서 통용되는 표현)
JSON만 출력: {"variants": [{"ja": "...", "ko": "..."}], "adjacent": [{"ja": "...", "ko": "..."}]}`;

const TRANSLATE_PROMPT = (keyword: string) => `당신은 일본 뷰티/미용의료 X(트위터) 검색 전문가입니다.
한국어 검색 키워드: "${keyword}"

이 키워드를 일본어 X 검색용으로 번역하세요.
규칙: 직역 금지 — 일본 뷰티/미용의료 X에서 실제로 검색·통용되는 용어를 선택. 후보가 여럿이면 가장 통용되는 1개만.
(예: "모공" → "毛穴", "피부결" → "肌のキメ"가 아니라 실제 검색어인 "キメ")
JSON만 출력: {"ja": "일본어 검색어", "ko": "${keyword}"}`;

export function extractJson(res: { content: Array<{ type: string; text?: string }> }): unknown | null {
  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export function pairs(v: unknown): KwPair[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is { ja: string; ko?: unknown } =>
      typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).ja === 'string')
    .map((x) => ({ ja: x.ja, ko: typeof x.ko === 'string' ? x.ko : '' }))
    .slice(0, 8);
}

export async function suggestKeywords(
  keyword: string,
  client?: AnthropicLike,
): Promise<{ variants: KwPair[]; adjacent: KwPair[] }> {
  const res = await callLLM('anthropic.suggest',
    { model: MODEL(), max_tokens: 800, messages: [{ role: 'user', content: PROMPT(keyword) }] }, client);
  const j = extractJson(res) as { variants?: unknown; adjacent?: unknown } | null;
  if (!j) return { variants: [], adjacent: [] };
  return { variants: pairs(j.variants), adjacent: pairs(j.adjacent) };
}

export async function translateKeyword(
  keyword: string,
  client?: AnthropicLike,
): Promise<KwPair | null> {
  const res = await callLLM('anthropic.translateKeyword',
    { model: MODEL(), max_tokens: 200, messages: [{ role: 'user', content: TRANSLATE_PROMPT(keyword) }] }, client);
  const j = extractJson(res) as { ja?: unknown; ko?: unknown } | null;
  if (!j || typeof j.ja !== 'string' || j.ja.length === 0) return null;
  return { ja: j.ja, ko: typeof j.ko === 'string' && j.ko ? j.ko : keyword };
}

const TAGS_PROMPT = (tags: string[]) => `일본 뷰티/미용의료 X 해시태그들을 한국어로 번역하세요. 한국 뷰티 업계 통용 표현으로, 짧게.
태그: ${JSON.stringify(tags)}
JSON만 출력 (태그를 키로, 한국어 번역을 값으로): {"태그": "번역", ...}`;

export async function translateTags(
  tags: string[],
  client?: AnthropicLike,
): Promise<Record<string, string>> {
  if (tags.length === 0) return {};
  const res = await callLLM('anthropic.translateTags',
    { model: MODEL(), max_tokens: 600, messages: [{ role: 'user', content: TAGS_PROMPT(tags) }] }, client);
  const j = extractJson(res);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}
