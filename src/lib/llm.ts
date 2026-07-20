import Anthropic from '@anthropic-ai/sdk';
import { recordUsageSafe } from './usageStore.ts';

export interface LLMResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface AnthropicLike {
  messages: { create(p: object): Promise<LLMResponse> };
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
  params: { model: string; max_tokens: number; messages: object[] },
  client?: AnthropicLike,
): Promise<LLMResponse> {
  const c = client ?? (new Anthropic() as unknown as AnthropicLike);
  const safe = {
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
  return res;
}
