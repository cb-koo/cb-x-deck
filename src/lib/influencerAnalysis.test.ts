import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAccount, makeAnthropicChat, AnalysisFormatError, DIRECT_TARGET, RT_CLASSIFY_MAX,
  type AnalysisChat,
} from './influencerAnalysis.ts';
import type { TweetSource, FetchResult } from './tweetSource.ts';
import type { AnalysisTweet } from './analysisStats.ts';
import type { AnthropicLike, LLMResponse } from './llm.ts';

const NOW = new Date('2026-08-24T00:00:00.000Z');   // 창(56일) = 2026-06-29 ~ 08-24
const tw = (over: Partial<AnalysisTweet>): AnalysisTweet => ({
  id: 't1', text: '本文', createdAt: '2026-08-20T00:00:00.000Z', kind: 'original',
  views: 100, likes: 10, hasMedia: false, ...over,
});
// 페이크 수집기 — FetchResult 형태 그대로 돌려준다(v2 계약, 스펙 §1).
const sourceOf = (tweets: AnalysisTweet[], over: Partial<FetchResult> = {}): TweetSource => ({
  fetchRecent: async () => ({
    tweets,
    truncated: false,
    reachedActivitySince: true,
    directCount: tweets.filter((t) => t.kind !== 'retweet').length,
    pagesUsed: 1,
    ...over,
  }),
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

// '…:\n{JSON}' 형태의 사용자 메시지에서 JSON 본문만 떼어낸다
const jsonOf = (user: string): unknown => JSON.parse(user.slice(user.indexOf('{')));

test('일반 계정: 활동은 56일 창, 내용은 직접 글 표본 — 두 축이 따로 계산된다', async () => {
  const tweets = [
    tw({ id: 'a', views: 100 }),                                   // 창 안 직접
    tw({ id: 'b', views: 300, kind: 'quote' }),                    // 창 안 직접(인용)
    tw({ id: 'r1', kind: 'retweet', views: 900, rtText: '여행 원문1' }),
    tw({ id: 'r2', kind: 'retweet', views: 800, rtText: '여행 원문2' }),
    tw({ id: 'old', views: 200, createdAt: '2026-06-01T00:00:00.000Z' }),  // 창 밖 직접
  ];
  let normUser = '';
  let synthUser = '';
  const chat = chatOf({
    'anthropic.influencerClassify': (user) => JSON.stringify({
      items: (JSON.parse(user.slice(user.indexOf('['))) as Array<{ id: string }>).map(({ id }) => (
        { id, contentType: 'review', sponsored: id === 'b', evidence: id === 'b' ? '#PR' : null, topics: ['미용 의료'] }
      )),
    }),
    'anthropic.influencerClassifyRt': (user) => JSON.stringify({
      items: (JSON.parse(user.slice(user.indexOf('['))) as Array<{ id: string }>)
        .map(({ id }) => ({ id, topics: ['여행'] })),
    }),
    'anthropic.influencerNormalize': (user) => (normUser = user, JSON.stringify({
      direct: [{ tag: '미용의료', absorbs: ['미용 의료'] }],
      rt: [{ tag: '여행', absorbs: ['여행'] }],
    })),
    'anthropic.influencerSynth': (user) => (synthUser = user, JSON.stringify({
      headline: '시술 후기를 꾸준히 올리는 계정이에요.',
      tone: '친근한 후기 톤', patterns: '후기 글 반응 좋음', sponsorship: '#PR 1건 관찰',
    })),
  });
  const a = await analyzeAccount({ source: sourceOf(tweets), chat }, 'u1', { now: NOW });

  // 활동 = 창 안 4건(직접 2·RT 2)
  assert.equal(a.activity!.rtShare, 0.5);
  assert.equal(a.activity!.days, 56);
  // 내용 = 직접 글 표본 3건(창 밖 것도 포함 — 60건까지 거슬러 간다)
  assert.equal(a.sample.direct, 3);
  assert.equal(a.sample.collected, 5);
  assert.equal(a.sample.directClassified, 3);
  assert.equal(a.sample.rtClassified, 2);
  assert.equal(a.sample.directSince, '2026-06-01T00:00:00.000Z');
  assert.equal(a.sample.rtSince, '2026-08-20T00:00:00.000Z');
  assert.equal(a.sample.directComplete, false);      // directCount 3 < 60
  assert.equal(a.sample.pagesUsed, 1);
  assert.equal(a.stats.medianViews, 200);            // 직접 100·300·200 → 200 (RT 900/800 제외)
  assert.equal(a.stats.sponsoredCount, 1);
  assert.deepEqual(a.stats.typeDist, { review: 3 });
  assert.deepEqual(a.topics, [{ tag: '미용의료', count: 3, medianViews: 200 }]);
  assert.deepEqual(a.rtTopics, [{ tag: '여행', count: 2 }]);
  assert.equal(a.summary!.headline, '시술 후기를 꾸준히 올리는 계정이에요.');
  // 직접/RT 분류는 병렬이라 호출 순서에 의존하지 않는다 — 어떤 단계가 돌았는지만 본다
  assert.deepEqual(new Set(chat.calls), new Set([
    'anthropic.influencerClassify', 'anthropic.influencerClassifyRt',
    'anthropic.influencerNormalize', 'anthropic.influencerSynth',
  ]));
  assert.equal(chat.calls.length, 4);

  // 정규화는 두 축을 한 콜에 보낸다 — 어휘는 공유하되 각 축이 자기 슬롯을 갖는다(스펙 §3-5)
  const norm = jsonOf(normUser) as { direct: unknown[]; rt: unknown[] };
  assert.equal('rt' in norm, true);
  assert.deepEqual(norm.direct, [{ tag: '미용 의료', count: 3 }]);
  assert.deepEqual(norm.rt, [{ tag: '여행', count: 2 }]);

  // 종합 입력: v1의 주당_게시·구성은 빠지고 활동·퍼나르는_주제가 들어간다(스펙 §3-6)
  assert.equal(synthUser.includes('주당_게시'), false);
  assert.equal(synthUser.includes('구성'), false);
  assert.match(synthUser, /"활동":/);
  assert.match(synthUser, /"퍼나르는_주제":/);
  assert.match(synthUser, /"RT_비중":0\.5/);
  assert.match(synthUser, /"계정_조회_중앙값":200/);
  assert.match(synthUser, /"배율":1[,}]/);
});

test('RT-only 계정: 직접 글이 없어도 퍼나르는 주제로 종합을 돈다', async () => {
  const tweets = [
    tw({ id: 'r1', kind: 'retweet', rtText: '여행 원문1' }),
    tw({ id: 'r2', kind: 'retweet', rtText: '여행 원문2' }),
    tw({ id: 'r3', kind: 'retweet', rtText: '맛집 원문' }),
  ];
  const chat = chatOf({
    'anthropic.influencerClassifyRt': (user) => JSON.stringify({
      items: (JSON.parse(user.slice(user.indexOf('['))) as Array<{ id: string }>)
        .map(({ id }) => ({ id, topics: [id === 'r3' ? '맛집' : '여행'] })),
    }),
    'anthropic.influencerNormalize': () => JSON.stringify({
      direct: [], rt: [{ tag: '여행', absorbs: ['여행'] }, { tag: '맛집', absorbs: ['맛집'] }],
    }),
    'anthropic.influencerSynth': () => JSON.stringify({
      headline: '여행 소식을 퍼나르는 확산형 계정이에요.',
      tone: '담백한 확산 톤', patterns: '직접 쓴 글이 없어 반응 패턴은 볼 수 없어요',
      sponsorship: '협찬 표기는 관찰되지 않았어요',
    }),
  });
  const a = await analyzeAccount({ source: sourceOf(tweets), chat }, 'u1', { now: NOW });

  // 직접 글 분류 콜은 아예 없다 — RT용 1회만 (분류는 병렬이라 순서 대신 집합으로 본다)
  assert.deepEqual(new Set(chat.calls), new Set([
    'anthropic.influencerClassifyRt', 'anthropic.influencerNormalize', 'anthropic.influencerSynth',
  ]));
  assert.equal(chat.calls.length, 3);
  assert.equal(a.summary!.headline, '여행 소식을 퍼나르는 확산형 계정이에요.');
  assert.deepEqual(a.topics, []);
  assert.deepEqual(a.rtTopics, [{ tag: '여행', count: 2 }, { tag: '맛집', count: 1 }]);
  assert.equal(a.sample.direct, 0);
  assert.equal(a.sample.directSince, null);
  assert.equal(a.activity!.rtShare, 1);
  assert.equal(a.activity!.directPerDay, 0);
});

test('완전 0건: LLM 안 부르고 summary null', async () => {
  const chat = chatOf({});
  const a = await analyzeAccount({ source: sourceOf([]), chat }, 'u1', { now: NOW });
  assert.deepEqual(chat.calls, []);
  assert.equal(a.summary, null);
  assert.deepEqual(a.topics, []);
  assert.deepEqual(a.rtTopics, []);
  assert.equal(a.sample.collected, 0);
  assert.equal(a.activity!.directPerDay, 0);
  assert.equal(a.activity!.coveredDays, 56);   // "8주 내내 0건"이 사실이다
});

test('종합 JSON 불량이면 AnalysisFormatError (반쪽 저장 방지 — 라우트가 실패 처리)', async () => {
  const chat = chatOf({
    'anthropic.influencerClassify': () => JSON.stringify({ items: [{ id: 'a', contentType: 'info', sponsored: false, evidence: null, topics: [] }] }),
    'anthropic.influencerNormalize': () => JSON.stringify({ direct: [], rt: [] }),
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
    'anthropic.influencerNormalize': () => JSON.stringify({ direct: [], rt: [] }),
    'anthropic.influencerSynth': () => JSON.stringify({ tone: 't', patterns: 'p', sponsorship: 's' }),
  });
  await assert.rejects(
    analyzeAccount({ source: sourceOf([tw({ id: 'a' })]), chat }, 'u1', { now: NOW }),
    AnalysisFormatError,
  );
});

test('분류 누락: 1회 재시도, 그래도 빠지면 directClassified에 반영', async () => {
  const tweets = [tw({ id: 'a' }), tw({ id: 'b' })];
  let classifyCalls = 0;
  const chat = chatOf({
    'anthropic.influencerClassify': () => {
      classifyCalls++;
      // 항상 a만 답한다 → b는 재시도에도 누락
      return JSON.stringify({ items: [{ id: 'a', contentType: 'info', sponsored: false, evidence: null, topics: [] }] });
    },
    'anthropic.influencerNormalize': () => JSON.stringify({ direct: [], rt: [] }),
    'anthropic.influencerSynth': () => JSON.stringify({ headline: 'h', tone: 't', patterns: 'p', sponsorship: 's' }),
  });
  const a = await analyzeAccount({ source: sourceOf(tweets), chat }, 'u1', { now: NOW });
  assert.equal(classifyCalls, 2);          // 본 호출 + 누락 재시도 1회
  assert.equal(a.sample.directClassified, 1);
});

test('직접 글 표본은 최신 DIRECT_TARGET건까지만 — 창 밖이라도 60건을 채운다', async () => {
  const many = Array.from({ length: DIRECT_TARGET + 5 }, (_, i) => tw({ id: `d${i}` }));
  const chat = chatOf({
    'anthropic.influencerClassify': (user) => JSON.stringify({
      items: (JSON.parse(user.slice(user.indexOf('['))) as Array<{ id: string }>)
        .map(({ id }) => ({ id, contentType: 'daily', sponsored: false, evidence: null, topics: [] })),
    }),
    'anthropic.influencerNormalize': () => JSON.stringify({ direct: [], rt: [] }),
    'anthropic.influencerSynth': () => JSON.stringify({ headline: 'h', tone: 't', patterns: 'p', sponsorship: 's' }),
  });
  const a = await analyzeAccount(
    { source: sourceOf(many, { directCount: DIRECT_TARGET + 5 }), chat }, 'u1', { now: NOW });
  assert.equal(a.sample.direct, DIRECT_TARGET);
  assert.equal(a.sample.directComplete, true);
});

// 분류·종합은 그대로 통과시키고 정규화 응답만 갈아 끼우는 기본 페이크
const idsIn = (user: string) => JSON.parse(user.slice(user.indexOf('['))) as Array<{ id: string }>;
const baseHandlers = (normalize: (user: string) => string) => ({
  'anthropic.influencerClassify': (user: string) => JSON.stringify({
    items: idsIn(user).map(({ id }) => (
      { id, contentType: 'daily', sponsored: false, evidence: null, topics: ['일상'] })),
  }),
  'anthropic.influencerClassifyRt': (user: string) => JSON.stringify({
    items: idsIn(user).map(({ id }) => ({ id, topics: ['여행'] })),
  }),
  'anthropic.influencerNormalize': normalize,
  'anthropic.influencerSynth': () => JSON.stringify(
    { headline: 'h', tone: 't', patterns: 'p', sponsorship: 's' }),
});
const normalizeBoth = () => JSON.stringify({
  direct: [{ tag: '일상', absorbs: ['일상'] }], rt: [{ tag: '여행', absorbs: ['여행'] }],
});

test('고정글: 수집 순서가 아니라 createdAt 내림차순으로 표본을 뽑는다(…Since = 진짜 최고령)', async () => {
  const tweets = [
    tw({ id: 'pinned', createdAt: '2026-01-05T00:00:00.000Z' }),          // 고정글 — 1페이지 맨 앞
    tw({ id: 'a', createdAt: '2026-08-20T00:00:00.000Z' }),
    tw({ id: 'b', createdAt: '2026-08-18T00:00:00.000Z' }),
    tw({ id: 'r1', kind: 'retweet', createdAt: '2026-07-28T00:00:00.000Z', rtText: '여행 원문1' }),
    tw({ id: 'r2', kind: 'retweet', createdAt: '2026-08-19T00:00:00.000Z', rtText: '여행 원문2' }),
  ];
  const chat = chatOf(baseHandlers(normalizeBoth));
  const a = await analyzeAccount({ source: sourceOf(tweets), chat }, 'u1', { now: NOW });

  assert.equal(a.sample.direct, 3);
  assert.equal(a.sample.directSince, '2026-01-05T00:00:00.000Z');   // 배열 끝(b)이 아니라 고정글이 최고령
  assert.equal(a.sample.rtSince, '2026-07-28T00:00:00.000Z');       // RT도 정렬 후 최고령
});

test('고정글이 최신 DIRECT_TARGET 슬롯을 밀어내지 않는다', async () => {
  const recent = Array.from({ length: DIRECT_TARGET }, (_, i) => tw({
    id: `d${i}`, createdAt: new Date(NOW.getTime() - (i + 1) * 3_600_000).toISOString(),
  }));
  const tweets = [tw({ id: 'pinned', createdAt: '2026-01-05T00:00:00.000Z' }), ...recent];
  const seen = new Set<string>();
  const chat = chatOf({
    ...baseHandlers(normalizeBoth),
    'anthropic.influencerClassify': (user: string) => {
      for (const { id } of idsIn(user)) seen.add(id);
      return JSON.stringify({
        items: idsIn(user).map(({ id }) => (
          { id, contentType: 'daily', sponsored: false, evidence: null, topics: ['일상'] })),
      });
    },
  });
  const a = await analyzeAccount(
    { source: sourceOf(tweets, { directCount: DIRECT_TARGET + 1 }), chat }, 'u1', { now: NOW });

  assert.equal(a.sample.direct, DIRECT_TARGET);
  assert.equal(seen.has('pinned'), false);                      // 고정글이 아니라 가장 오래된 최신글이 밀린다
  assert.equal(a.sample.directSince, recent.at(-1)!.createdAt);
});

test('창 밖 RT는 rtSample에 들어가지 않는다(RT는 56일 창 안에서만)', async () => {
  const tweets = [
    tw({ id: 'rIn', kind: 'retweet', createdAt: '2026-08-20T00:00:00.000Z', rtText: '여행 원문' }),
    tw({ id: 'rOut', kind: 'retweet', createdAt: '2026-06-01T00:00:00.000Z', rtText: '옛 원문' }),
  ];
  const chat = chatOf(baseHandlers(normalizeBoth));
  const a = await analyzeAccount({ source: sourceOf(tweets), chat }, 'u1', { now: NOW });

  assert.equal(a.sample.collected, 2);
  assert.equal(a.sample.rtClassified, 1);
  assert.equal(a.sample.rtSince, '2026-08-20T00:00:00.000Z');
  assert.deepEqual(a.rtTopics, [{ tag: '여행', count: 1 }]);
});

test('RT 분류는 RT_CLASSIFY_MAX 상한 — 창 안 101건이어도 100건만 분류한다', async () => {
  const tweets = Array.from({ length: RT_CLASSIFY_MAX + 1 }, (_, i) => tw({
    id: `r${i}`, kind: 'retweet',
    createdAt: new Date(NOW.getTime() - (i + 1) * 3_600_000).toISOString(),
    rtText: '여행 원문',
  }));
  let synthUser = '';
  const chat = chatOf({
    ...baseHandlers(normalizeBoth),
    'anthropic.influencerSynth': (user: string) => (synthUser = user, JSON.stringify(
      { headline: 'h', tone: 't', patterns: 'p', sponsorship: 's' })),
  });
  const a = await analyzeAccount({ source: sourceOf(tweets), chat }, 'u1', { now: NOW });

  assert.equal(a.sample.collected, RT_CLASSIFY_MAX + 1);
  assert.equal(a.sample.rtClassified, RT_CLASSIFY_MAX);
  // 종합 입력은 분류 표본과 창 안 전체를 함께 알린다 — 100이 전부인 것처럼 읽히지 않게
  assert.match(synthUser, /RT 100건 분류\(창 안 전체 101건\)/);
});

test('RT-only: 정규화가 rt 축을 빈 배열로 답해도 rtTopics가 비지 않는다(원태그 폴백)', async () => {
  const tweets = [
    tw({ id: 'r1', kind: 'retweet', rtText: '여행 원문1' }),
    tw({ id: 'r2', kind: 'retweet', rtText: '여행 원문2' }),
  ];
  const chat = chatOf(baseHandlers(() => JSON.stringify({ direct: [], rt: [] })));
  const a = await analyzeAccount({ source: sourceOf(tweets), chat }, 'u1', { now: NOW });

  assert.deepEqual(a.rtTopics, [{ tag: '여행', count: 2 }]);
  assert.equal(a.summary!.headline, 'h');
});

test('정규화 콜이 예외를 던져도 분석은 산다 — 태그 없음으로 강등, rtTopics는 원태그 폴백', async () => {
  const tweets = [
    tw({ id: 'a' }),
    tw({ id: 'r1', kind: 'retweet', rtText: '여행 원문' }),
  ];
  const chat = chatOf(baseHandlers(() => { throw new Error('network'); }));
  const a = await analyzeAccount({ source: sourceOf(tweets), chat }, 'u1', { now: NOW });

  assert.deepEqual(a.topics, []);                              // direct 축은 폴백하지 않는다(스펙 규칙 유지)
  assert.deepEqual(a.rtTopics, [{ tag: '여행', count: 1 }]);
  assert.equal(a.summary!.headline, 'h');
  assert.equal(a.sample.directClassified, 1);
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
