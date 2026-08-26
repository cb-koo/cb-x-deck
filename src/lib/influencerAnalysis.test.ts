import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAccount, makeAnthropicChat, AnalysisFormatError, type AnalysisChat } from './influencerAnalysis.ts';
import type { TweetSource } from './tweetSource.ts';
import type { AnalysisTweet } from './analysisStats.ts';
import type { AnthropicLike, LLMResponse } from './llm.ts';

const NOW = new Date('2026-08-24T00:00:00.000Z');
const tw = (over: Partial<AnalysisTweet>): AnalysisTweet => ({
  id: 't1', text: '本文', createdAt: '2026-08-20T00:00:00.000Z', kind: 'original',
  views: 100, likes: 10, hasMedia: false, ...over,
});
const sourceOf = (tweets: AnalysisTweet[], truncated = false): TweetSource => ({
  fetchRecent: async () => ({ tweets, truncatedByCount: truncated }),
});

// 페이크 chat: operation으로 단계를 구분해 답한다
function chatOf(handlers: Record<string, (user: string) => string>): AnalysisChat & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async complete({ operation, user }) {
      calls.push(operation);
      return handlers[operation](user);
    },
  };
}

test('전체 흐름: 분류→정규화→통계→종합', async () => {
  const tweets = [
    tw({ id: 'a', views: 100 }), tw({ id: 'b', views: 300, kind: 'quote' }),
    tw({ id: 'r', views: 900, kind: 'retweet' }),
  ];
  let synthUser = '';
  const chat = chatOf({
    'anthropic.influencerClassify': (user) => JSON.stringify({
      items: (JSON.parse(user.slice(user.indexOf('['))) as Array<{ id: string }>).map(({ id }) => (
        { id, contentType: 'review', sponsored: id === 'b', evidence: id === 'b' ? '#PR' : null, topics: ['미용 의료'] }
      )),
    }),
    'anthropic.influencerNormalize': () => JSON.stringify({
      topics: [{ tag: '미용의료', absorbs: ['미용 의료'] }],
    }),
    'anthropic.influencerSynth': (user) => (synthUser = user, JSON.stringify({
      headline: '시술 후기를 꾸준히 올리는 계정이에요.',
      tone: '친근한 후기 톤', patterns: '후기 글 반응 좋음', sponsorship: '#PR 1건 관찰',
    })),
  });
  const a = await analyzeAccount({ source: sourceOf(tweets), chat }, 'u1', { now: NOW });

  assert.equal(a.sample.count, 3);
  assert.equal(a.sample.classified, 2);              // RT 제외 2건 분류
  assert.equal(a.sample.months, 3);
  assert.deepEqual(a.stats.mix, { original: 1, retweet: 1, quote: 1 });
  assert.equal(a.stats.medianViews, 200);            // RT 900 제외
  assert.equal(a.stats.sponsoredCount, 1);
  assert.deepEqual(a.stats.typeDist, { review: 2 });
  assert.deepEqual(a.topics, [{ tag: '미용의료', count: 2, medianViews: 200 }]);
  assert.deepEqual(a.daily, { '2026-08-20': 3 });     // 히트맵 재료 — RT 포함 3건이 같은 한국 날짜
  assert.equal(a.summary!.tone, '친근한 후기 톤');
  assert.equal(a.summary!.headline, '시술 후기를 꾸준히 올리는 계정이에요.');
  assert.deepEqual(chat.calls, ['anthropic.influencerClassify', 'anthropic.influencerNormalize', 'anthropic.influencerSynth']);
  // 배율은 코드가 계산해 넘긴다 — LLM이 나눗셈하지 않게(스펙 §2). 200 ÷ 200 = 1
  assert.match(synthUser, /"계정_조회_중앙값":200/);
  assert.match(synthUser, /"배율":1[,}]/);
});

test('표본 0건: LLM 안 부르고 summary null', async () => {
  const chat = chatOf({});
  const a = await analyzeAccount({ source: sourceOf([]), chat }, 'u1', { now: NOW });
  assert.equal(a.sample.count, 0);
  assert.equal(a.summary, null);
  assert.deepEqual(a.topics, []);
  assert.deepEqual(chat.calls, []);
});

test('분류 누락: 1회 재시도, 그래도 빠지면 classified에 반영', async () => {
  const tweets = [tw({ id: 'a' }), tw({ id: 'b' })];
  let classifyCalls = 0;
  const chat = chatOf({
    'anthropic.influencerClassify': () => {
      classifyCalls++;
      // 항상 a만 답한다 → b는 재시도에도 누락
      return JSON.stringify({ items: [{ id: 'a', contentType: 'info', sponsored: false, evidence: null, topics: [] }] });
    },
    'anthropic.influencerNormalize': () => JSON.stringify({ topics: [] }),
    'anthropic.influencerSynth': () => JSON.stringify({ headline: 'h', tone: 't', patterns: 'p', sponsorship: 's' }),
  });
  const a = await analyzeAccount({ source: sourceOf(tweets), chat }, 'u1', { now: NOW });
  assert.equal(classifyCalls, 2);          // 본 호출 + 누락 재시도 1회
  assert.equal(a.sample.classified, 1);
});

test('종합 JSON 불량이면 AnalysisFormatError (반쪽 저장 방지 — 라우트가 실패 처리)', async () => {
  const chat = chatOf({
    'anthropic.influencerClassify': () => JSON.stringify({ items: [{ id: 'a', contentType: 'info', sponsored: false, evidence: null, topics: [] }] }),
    'anthropic.influencerNormalize': () => JSON.stringify({ topics: [] }),
    'anthropic.influencerSynth': () => 'JSON 아님',
  });
  await assert.rejects(
    analyzeAccount({ source: sourceOf([tw({ id: 'a' })]), chat }, 'u1', { now: NOW }),
    AnalysisFormatError,
  );
});

test('종합에 headline이 없으면 AnalysisFormatError — 헤드라인은 스키마 required다', async () => {
  const chat = chatOf({
    'anthropic.influencerClassify': () => JSON.stringify({ items: [{ id: 'a', contentType: 'info', sponsored: false, evidence: null, topics: [] }] }),
    'anthropic.influencerNormalize': () => JSON.stringify({ topics: [] }),
    'anthropic.influencerSynth': () => JSON.stringify({ tone: 't', patterns: 'p', sponsorship: 's' }),
  });
  await assert.rejects(
    analyzeAccount({ source: sourceOf([tw({ id: 'a' })]), chat }, 'u1', { now: NOW }),
    AnalysisFormatError,
  );
});

// makeAnthropicChat: 페이크 AnthropicLike로 주입해 전송 params와 반환값을 검증
function capturingClient(): { client: AnthropicLike; seen: () => Record<string, unknown> | null } {
  let captured: Record<string, unknown> | null = null;
  const client: AnthropicLike = {
    messages: {
      async create(p: object): Promise<LLMResponse> {
        captured = p as Record<string, unknown>;
        return { content: [{ type: 'text', text: '{"ok":true}' }] };
      },
    },
  };
  return { client, seen: () => captured };
}

test('makeAnthropicChat: sampling 파라미터를 보내지 않는다', async () => {
  const { client, seen } = capturingClient();
  await makeAnthropicChat(client).complete({
    operation: 'test.op', model: 'm', system: 'S', user: 'U', maxTokens: 10,
  });
  const sent = seen()!;
  assert.equal('temperature' in sent, false);
  assert.equal('top_p' in sent, false);
  assert.equal('top_k' in sent, false);
});

test('makeAnthropicChat: schema를 주면 output_config에 json_schema 형태로 실린다', async () => {
  const { client, seen } = capturingClient();
  const schema = { type: 'object', properties: {} };
  await makeAnthropicChat(client).complete({
    operation: 'test.op', model: 'm', system: 'S', user: 'U', maxTokens: 10, schema,
  });
  assert.deepEqual(seen()!.output_config, { format: { type: 'json_schema', schema } });
});

test('makeAnthropicChat: schema가 없으면 output_config 자체가 없다', async () => {
  const { client, seen } = capturingClient();
  await makeAnthropicChat(client).complete({
    operation: 'test.op', model: 'm', system: 'S', user: 'U', maxTokens: 10,
  });
  assert.equal('output_config' in seen()!, false);
});

test('makeAnthropicChat: 반환값은 content의 text 블록 문자열이다', async () => {
  const { client } = capturingClient();
  const result = await makeAnthropicChat(client).complete({
    operation: 'test.op', model: 'm', system: 'S', user: 'U', maxTokens: 10,
  });
  assert.equal(result, '{"ok":true}');
});
