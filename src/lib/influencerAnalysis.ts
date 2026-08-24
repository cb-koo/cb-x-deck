// 계정 분석 오케스트레이션(스펙 §3) — 숫자는 analysisStats(코드)가, 해석만 LLM이.
// TweetSource·AnalysisChat 두 경계만 의존(교체 가능, 스펙 §4). DB 접근 없음 — 저장은 라우트가.
import { callLLM } from './llm.ts';
import {
  chunk, computeStats, missingIds, sponsoredCount, topByViews, topicStats, typeDist,
  CONTENT_TYPE_LABEL,
  type AnalysisTweet, type ClassifiedTweet, type ContentType,
} from './analysisStats.ts';
import type { TweetSource } from './tweetSource.ts';
import type { InfluencerAnalysis } from './influencerStore.ts';

export const ANALYSIS_MONTHS = 3;
export const ANALYSIS_MAX_TWEETS = 100;
const CHUNK_SIZE = 25;
const TOP_SAMPLE = 10;

export const CLASSIFY_MODEL = () => process.env.ANALYSIS_CLASSIFY_MODEL ?? 'claude-haiku-4-5';
export const SYNTH_MODEL = () => process.env.ANALYSIS_SYNTH_MODEL ?? 'claude-sonnet-5';

export interface AnalysisChat {
  complete(req: {
    operation: string; model: string; system: string; user: string;
    maxTokens: number; schema?: object;
  }): Promise<string>;
}

// 구현 1호 — callLLM 경유(usage 기록·lone surrogate 제거·거절 승격이 그 안에 있다).
// sampling 파라미터는 보내지 않는다(최신 모델 400) — 결정성은 스키마·프롬프트로.
export function makeAnthropicChat(): AnalysisChat {
  return {
    async complete({ operation, model, system, user, maxTokens, schema }) {
      const res = await callLLM(operation, {
        model, max_tokens: maxTokens, system,
        messages: [{ role: 'user', content: user }],
        ...(schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
      });
      return res.content.find((b) => b.type === 'text')?.text ?? '';
    },
  };
}

export class AnalysisFormatError extends Error {
  constructor() { super('분석 응답 형식이 맞지 않아요'); this.name = 'AnalysisFormatError'; }
}

// ---- 분류 (Haiku, 25건 청크) ----

const CLASSIFY_SYSTEM = [
  '너는 X(트위터) 게시물 분류기다. 게시물 목록(JSON 배열)을 받아 각 항목을 분류해 JSON으로만 답한다.',
  '- contentType: info(정보·팁) | review(후기·체험) | daily(일상·잡담) | promo(홍보·협찬 고지) | other',
  '- sponsored: 협찬·광고 표기(#PR·#AD·広告·提供 등)나 명백한 유상 홍보면 true. 확실할 때만 true.',
  '- evidence: sponsored=true일 때 근거가 된 원문 조각(해시태그·문구)을 그대로 인용. false면 null.',
  '- topics: 게시물의 주제 1~3개, 짧은 한국어 명사구(예: "미용의료", "다이어트"). 게시물이 일본어라도 태그는 한국어로.',
  '- 입력의 모든 id를 빠짐없이 items에 포함할 것.',
].join('\n');

const classifySchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          contentType: { type: 'string', enum: ['info', 'review', 'daily', 'promo', 'other'] },
          sponsored: { type: 'boolean' },
          evidence: { type: ['string', 'null'] },
          topics: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'contentType', 'sponsored', 'evidence', 'topics'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function parseClassified(text: string): ClassifiedTweet[] {
  try {
    const j = JSON.parse(text) as { items?: unknown };
    if (!Array.isArray(j.items)) return [];
    return j.items.filter((it): it is ClassifiedTweet =>
      typeof it === 'object' && it !== null &&
      typeof (it as ClassifiedTweet).id === 'string' &&
      ['info', 'review', 'daily', 'promo', 'other'].includes((it as ClassifiedTweet).contentType) &&
      typeof (it as ClassifiedTweet).sponsored === 'boolean' &&
      Array.isArray((it as ClassifiedTweet).topics),
    ).map((it) => ({ ...it, evidence: typeof it.evidence === 'string' ? it.evidence : null }));
  } catch { return []; }
}

function classifyInput(tweets: AnalysisTweet[]): string {
  return '게시물 목록:\n' + JSON.stringify(tweets.map((t) => ({
    id: t.id, text: t.text, quote: t.kind === 'quote', hasMedia: t.hasMedia,
  })));
}

async function classifyAll(chat: AnalysisChat, targets: AnalysisTweet[]): Promise<ClassifiedTweet[]> {
  const out: ClassifiedTweet[] = [];
  for (const c of chunk(targets, CHUNK_SIZE)) {
    let got = parseClassified(await chat.complete({
      operation: 'anthropic.influencerClassify', model: CLASSIFY_MODEL(),
      system: CLASSIFY_SYSTEM, user: classifyInput(c), maxTokens: 8000, schema: classifySchema,
    }));
    // id 대조 → 누락분만 1회 재호출(배치 분류의 알려진 실패 모드, 스펙 §3-3)
    const missing = missingIds(c, got);
    if (missing.length > 0) {
      const retryTargets = c.filter((t) => missing.includes(t.id));
      got = [...got, ...parseClassified(await chat.complete({
        operation: 'anthropic.influencerClassify', model: CLASSIFY_MODEL(),
        system: CLASSIFY_SYSTEM, user: classifyInput(retryTargets), maxTokens: 8000, schema: classifySchema,
      }))];
    }
    const ids = new Set(c.map((t) => t.id));
    out.push(...got.filter((g) => ids.has(g.id)));   // 지어낸 id 방어
  }
  // 같은 id가 두 번 오면 첫 번째만
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

// ---- 태그 정규화 (1콜) — 자유 태그를 그대로 두면 동의어가 흩어진다(스펙 §3-4) ----

const NORMALIZE_SYSTEM = [
  '너는 태그 정리기다. 태그 목록(등장 횟수 포함)을 받아 동의어·표기 변형을 병합해',
  '이 계정을 대표하는 태그 3~5개로 정리해 JSON으로만 답한다.',
  '- topics: [{ tag: 대표 태그(한국어), absorbs: [병합된 원태그 전부 — 대표 태그 자신도 포함] }]',
  '- 등장 횟수가 많은 주제 우선. 1~2회뿐인 잡다한 태그는 버려도 된다.',
].join('\n');

const normalizeSchema = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: { tag: { type: 'string' }, absorbs: { type: 'array', items: { type: 'string' } } },
        required: ['tag', 'absorbs'],
        additionalProperties: false,
      },
    },
  },
  required: ['topics'],
  additionalProperties: false,
};

async function normalizeTags(chat: AnalysisChat, classified: ClassifiedTweet[]): Promise<Record<string, string>> {
  const counts = new Map<string, number>();
  for (const c of classified) for (const t of c.topics) {
    const k = t.trim();
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size === 0) return {};
  const text = await chat.complete({
    operation: 'anthropic.influencerNormalize', model: CLASSIFY_MODEL(),
    system: NORMALIZE_SYSTEM,
    user: '태그 목록:\n' + JSON.stringify([...counts.entries()].map(([tag, count]) => ({ tag, count }))),
    maxTokens: 2000, schema: normalizeSchema,
  });
  const canonicalOf: Record<string, string> = {};
  try {
    const j = JSON.parse(text) as { topics?: Array<{ tag?: unknown; absorbs?: unknown }> };
    for (const t of j.topics ?? []) {
      if (typeof t.tag !== 'string' || !Array.isArray(t.absorbs)) continue;
      canonicalOf[t.tag.trim().toLowerCase()] = t.tag;   // 대표 태그 자신
      for (const a of t.absorbs) if (typeof a === 'string') canonicalOf[a.trim().toLowerCase()] = t.tag;
    }
  } catch { /* 정규화 실패는 태그 없음으로 강등 — 분석 전체를 죽이지 않는다 */ }
  return canonicalOf;
}

// ---- 종합 서술 (Sonnet 1콜) — 통계 + 원문 샘플 동시 투입(map 압축으로 잃는 뉘앙스 보전) ----

const SYNTH_SYSTEM = [
  '너는 인플루언서 계정 분석가다. 집계 통계와 반응 상위 게시물 원문을 받아 한국어로 JSON만 출력한다.',
  '- tone: 이 계정의 성향·톤·문체 요약 2~3문장. 팔로워와의 관계가 보이면 함께.',
  '- patterns: 어떤 글이 반응이 좋은지 1~2문장 — 반드시 준 통계·원문을 근거로, 수치를 지어내지 말 것.',
  '- sponsorship: 협찬 관찰 1~2문장 — 협찬 건수·근거 문구를 언급, 관찰이 없으면 "관찰되지 않음"이라고 쓸 것.',
  '읽는 사람은 비개발 콘텐츠 기획자다 — 내부 용어 없이 평이하게.',
].join('\n');

const synthSchema = {
  type: 'object',
  properties: {
    tone: { type: 'string' }, patterns: { type: 'string' }, sponsorship: { type: 'string' },
  },
  required: ['tone', 'patterns', 'sponsorship'],
  additionalProperties: false,
};

// ---- 오케스트레이터 ----

export async function analyzeAccount(
  deps: { source: TweetSource; chat: AnalysisChat },
  userId: string,
  opts?: { now?: Date },
): Promise<InfluencerAnalysis> {
  const now = opts?.now ?? new Date();
  const until = now.toISOString();
  const sinceDate = new Date(now);
  sinceDate.setMonth(sinceDate.getMonth() - ANALYSIS_MONTHS);
  const since = sinceDate.toISOString();

  const { tweets, truncatedByCount } = await deps.source.fetchRecent(userId, {
    maxCount: ANALYSIS_MAX_TWEETS, since,
  });
  const stats = computeStats(tweets, { since, until, truncatedByCount });
  const targets = tweets.filter((t) => t.kind !== 'retweet');   // RT 본문은 원작자 것 — 분류 제외
  const models = { classify: CLASSIFY_MODEL(), synth: SYNTH_MODEL() };

  const base = {
    sample: {
      count: tweets.length, classified: 0,
      since: truncatedByCount && tweets.length
        ? tweets.reduce((m, t) => (t.createdAt < m ? t.createdAt : m), tweets[0].createdAt)
        : since,
      until, months: ANALYSIS_MONTHS,
    },
    models,
  };

  if (targets.length === 0) {
    return {
      ...base,
      stats: { ...stats, typeDist: {}, sponsoredCount: 0 },
      topics: [], summary: null,
    };
  }

  const classified = await classifyAll(deps.chat, targets);
  const canonicalOf = await normalizeTags(deps.chat, classified);
  const topics = topicStats(classified, tweets, canonicalOf);

  const top = topByViews(tweets, TOP_SAMPLE);
  const synthText = await deps.chat.complete({
    operation: 'anthropic.influencerSynth', model: SYNTH_MODEL(),
    system: SYNTH_SYSTEM,
    user: [
      '집계 통계(코드가 계산한 사실):',
      JSON.stringify({
        표본: `${tweets.length}건 (분류 ${classified.length}건)`,
        주당_게시: stats.perWeek,
        조회_중앙값: stats.medianViews, 좋아요_중앙값: stats.medianLikes,
        구성: stats.mix,
        유형별_건수: Object.fromEntries(Object.entries(typeDist(classified)).map(
          ([k, v]) => [CONTENT_TYPE_LABEL[k as ContentType], v])),
        협찬_표기_건수: sponsoredCount(classified),
        협찬_근거: classified.filter((c) => c.sponsored).map((c) => c.evidence).filter(Boolean).slice(0, 10),
        주제별: topics,
      }),
      '',
      '반응 상위 게시물 원문:',
      JSON.stringify(top.map((t) => ({ text: t.text, views: t.views, likes: t.likes }))),
    ].join('\n'),
    maxTokens: 2000, schema: synthSchema,
  });

  let summary: { tone: string; patterns: string; sponsorship: string };
  try {
    const j = JSON.parse(synthText) as { tone?: unknown; patterns?: unknown; sponsorship?: unknown };
    if (typeof j.tone !== 'string' || typeof j.patterns !== 'string' || typeof j.sponsorship !== 'string') {
      throw new Error('shape');
    }
    summary = { tone: j.tone, patterns: j.patterns, sponsorship: j.sponsorship };
  } catch {
    throw new AnalysisFormatError();   // 반쪽 결과를 저장하지 않는다(스펙 §7)
  }

  return {
    ...base,
    sample: { ...base.sample, classified: classified.length },
    stats: { ...stats, typeDist: typeDist(classified), sponsoredCount: sponsoredCount(classified) },
    topics, summary,
  };
}
