import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callLLM, LLMRefusalError, type AnthropicLike, type LLMResponse } from './llm.ts';

// 짝 없는 서로게이트(lone surrogate): 상위 서로게이트 뒤에 하위가 없거나 그 반대
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function capturingClient(): { client: AnthropicLike; seen: () => object | null } {
  let captured: object | null = null;
  const client: AnthropicLike = {
    messages: {
      async create(p: object): Promise<LLMResponse> {
        captured = p;
        return { content: [{ type: 'text', text: '{}' }] };
      },
    },
  };
  return { client, seen: () => captured };
}

test('callLLM: 짝 없는 서로게이트를 제거해 유효한 JSON 본문을 보낸다', async () => {
  // 이모지(🧴 = 🧴)를 한가운데서 자른 상태 — 상위 서로게이트만 남음
  const brokenTail = '手放せないアイテム\uD83E';
  const { client, seen } = capturingClient();

  await callLLM('test.op', {
    model: 'm', max_tokens: 10,
    messages: [{ role: 'user', content: `[T1] ${brokenTail}` }],
  }, client);

  const sent = seen() as { messages: Array<{ content: unknown }> };
  const content = sent.messages[0].content as string;
  assert.equal(LONE.test(content), false, '전송 본문에 짝 없는 서로게이트가 남아있으면 안 된다');
  // 직렬화 가능해야 한다(Anthropic이 하듯 JSON.stringify가 유효 UTF를 만들어야 함)
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(sent)));
});

test('callLLM: 정상 이모지 쌍은 보존한다', async () => {
  const { client, seen } = capturingClient();
  const intact = '完璧なアイテム🧴です';
  await callLLM('test.op', {
    model: 'm', max_tokens: 10,
    messages: [{ role: 'user', content: intact }],
  }, client);
  const sent = seen() as { messages: Array<{ content: string }> };
  assert.equal(sent.messages[0].content, intact, '온전한 서로게이트 쌍은 그대로 유지되어야 한다');
});

test('refusal 응답이면 LLMRefusalError를 던진다', async () => {
  const fake: AnthropicLike = {
    messages: { create: async () => ({ content: [], stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 0 } }) },
  };
  await assert.rejects(
    callLLM('test-refusal', { model: 'test', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] }, fake),
    LLMRefusalError,
  );
});

test('추가 파라미터(system·output_config)가 SDK 호출에 그대로 전달된다', async () => {
  let received: Record<string, unknown> = {};
  const fake: AnthropicLike = {
    messages: { create: async (p: object) => { received = p as Record<string, unknown>; return { content: [{ type: 'text', text: 'ok' }] }; } },
  };
  await callLLM('test-passthrough', {
    model: 'test', max_tokens: 10, messages: [{ role: 'user', content: 'x' }],
    system: 'SYS', output_config: { format: { type: 'json_schema' } },
  }, fake);
  assert.equal(received.system, 'SYS');
  assert.ok(received.output_config);
});
