import Anthropic from '@anthropic-ai/sdk';

export interface AnthropicLike {
  messages: { create(p: object): Promise<{ content: Array<{ type: string; text?: string }> }> };
}

const MODEL = () => process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';

const PROMPT = (keyword: string) => `당신은 일본 뷰티/스킨케어 X(트위터) 검색 전문가입니다.
검색 키워드: "${keyword}"

이 키워드로 일본어 X 검색을 확장하기 위한 연관 키워드를 제안하세요:
- variants: 같은 대상의 일본어 표기 변형(ひらがな/カタカナ/한자/영어 표기, 통칭·속어). 3~6개
- adjacent: 인접 개념(관련 성분→피부 고민→시술명→제품 카테고리 방향). 3~6개

규칙: 전부 일본어 X에서 실제로 검색될 법한 짧은 단어. 문장 금지. 입력 키워드 자체는 제외.
JSON만 출력: {"variants": [...], "adjacent": [...]}`;

export async function suggestKeywords(
  keyword: string,
  client?: AnthropicLike,
): Promise<{ variants: string[]; adjacent: string[] }> {
  const c = client ?? (new Anthropic() as unknown as AnthropicLike);
  const res = await c.messages.create({
    model: MODEL(),
    max_tokens: 500,
    messages: [{ role: 'user', content: PROMPT(keyword) }],
  });
  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { variants: [], adjacent: [] };
  try {
    const j = JSON.parse(m[0]);
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 8) : []);
    return { variants: arr(j.variants), adjacent: arr(j.adjacent) };
  } catch {
    return { variants: [], adjacent: [] };
  }
}
