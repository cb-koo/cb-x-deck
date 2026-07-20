import Anthropic from '@anthropic-ai/sdk';
import { recordUsageSafe } from './usageStore.ts';

export interface LLMResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface AnthropicLike {
  messages: { create(p: object): Promise<LLMResponse> };
}

// 모든 Anthropic 호출의 단일 통로. 응답 usage(토큰)를 fire-and-forget으로 기록.
export async function callLLM(
  operation: string,
  params: { model: string; max_tokens: number; messages: object[] },
  client?: AnthropicLike,
): Promise<LLMResponse> {
  const c = client ?? (new Anthropic() as unknown as AnthropicLike);
  const res = await c.messages.create(params);
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
