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
  if (res.stop_reason === 'refusal') throw new LLMRefusalError();
  return res;
}
