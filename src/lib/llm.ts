import Anthropic from '@anthropic-ai/sdk';
import { recordUsageSafe } from './usageStore.ts';

export interface LLMResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

export interface AnthropicLike {
  messages: { create(p: object): Promise<LLMResponse> };
}

// Opus 계열 안전 분류기는 거절을 HTTP 200 + stop_reason: 'refusal' + 빈 content로 반환한다.
// 빈 응답을 정상 취급하지 않도록 명시적 에러로 승격 — 호출부가 평문 안내로 매핑한다.
export class LLMRefusalError extends Error {
  constructor() { super('안전 분류기가 이 요청을 거절했어요'); this.name = 'LLMRefusalError'; }
}

// 짝 없는 UTF-16 서로게이트 제거 — 이모지를 slice로 반토막 내면 상위/하위 한쪽만 남고,
// SDK가 이를 직렬화하면 유효하지 않은 JSON이 되어 Anthropic이 400(invalid JSON)으로 거부한다.
// 온전한 서로게이트 쌍은 건드리지 않는다.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function stripLoneSurrogates(s: string): string {
  return s.replace(LONE_SURROGATE, '');
}
function sanitizeContent(content: unknown): unknown {
  if (typeof content === 'string') return stripLoneSurrogates(content);
  if (Array.isArray(content)) {
    return content.map((block) =>
      block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
        ? { ...block, text: stripLoneSurrogates((block as { text: string }).text) }
        : block);
  }
  return content;
}

// 모든 Anthropic 호출의 단일 통로. 응답 usage(토큰)를 fire-and-forget으로 기록.
export async function callLLM(
  operation: string,
  params: { model: string; max_tokens: number; messages: object[] } & Record<string, unknown>,
  client?: AnthropicLike,
): Promise<LLMResponse> {
  const c = client ?? (new Anthropic() as unknown as AnthropicLike);
  // Haiku 5.5는 사고(adaptive thinking)가 기본으로 켜지고 그 토큰이 max_tokens에 포함된다. 이 앱의 Haiku 호출은 전부 4.5에서 사고 없이 돌던
  // 짧은 JSON 추출·번역이라, 호출부가 따로 정하지 않으면 effort를 'low'로 둔다(마이그레이션 가이드: 사고 없이 돌던 요청은 낮은 effort).
  // thinking 파라미터는 보내지 않는다(기본 adaptive). 응답은 모든 호출부가 type==='text' 블록을 골라 읽으므로 사고 블록이 앞에 와도 안전하다.
  const effortDefault = /^claude-haiku-5/.test(params.model) && params.output_config === undefined
    ? { output_config: { effort: 'low' } } : {};
  const safe = {
    ...effortDefault,
    ...params,
    messages: params.messages.map((m) =>
      m && typeof m === 'object' && 'content' in m
        ? { ...m, content: sanitizeContent((m as { content: unknown }).content) }
        : m),
  };
  const res = await c.messages.create(safe);
  recordUsageSafe({
    api: 'anthropic',
    operation,
    model: params.model,
    inputTokens: res.usage?.input_tokens ?? null,
    outputTokens: res.usage?.output_tokens ?? null,
    units: 1,
  });
  if (res.stop_reason === 'refusal') throw new LLMRefusalError();
  return res;
}
