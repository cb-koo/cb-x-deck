import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  briefingPeriod, filterPeriod, computeBriefingStats, selectBriefingTweets,
  generateBriefing, FORBIDDEN_PHRASES, type BriefingTweet,
} from './briefing.ts';
import type { AnthropicLike } from './suggest.ts';

const NOW = '2026-07-16T00:00:00.000Z'; // 현재 주 = 2026-07-13(월)

function tw(week: string, likes: number, id = ''): BriefingTweet {
  const created = new Date(Date.parse(week + 'T00:00:00Z') + 2 * 86_400_000).toISOString();
  return { tweetId: id || week + '-' + likes + '-' + Math.random(), text: '본문 ' + likes, likes, createdAt: created, tweetUrl: 'https://x.com/i/status/1' };
}

const fakeLLM = (payload: unknown): AnthropicLike => ({
  messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] }) },
});
const GOOD = {
  tldr: ['니키비 화제가 늘었다', '흉터 케어 반응이 좋다', '홈케어 제품 언급 증가'],
  topics: '이번 기간엔 니키비 흉터 이야기가 많았다.',
  hits: '흉터 회복 후기 [T1] 반응이 가장 좋았다.',
  changes: '후반부에 게시량이 늘었다.',
  implications: '흉터 회복 과정 콘텐츠를 검토하자.',
};

test('briefingPeriod: 완성 주 기준 소급 — 집계 중 주 제외', () => {
  const p = briefingPeriod(NOW, 4);
  assert.equal(p.from, '2026-06-15');
  assert.equal(p.toExclusive, '2026-07-13');
  assert.equal(p.toDisplay, '2026-07-12'); // 마지막 완성 주 일요일
});

test('filterPeriod + computeBriefingStats: 기간 내 주별 수치(0건 주 포함)', () => {
  const tweets = [tw('2026-06-15', 100), tw('2026-06-15', 200), tw('2026-07-06', 50), tw('2026-07-13', 999)];
  const inP = filterPeriod(tweets, '2026-06-15', '2026-07-13');
  assert.equal(inP.length, 3); // 집계 중 주 제외
  const s = computeBriefingStats(tweets, NOW, 4);
  assert.equal(s.totalCount, 3);
  assert.equal(s.periodFrom, '2026-06-15');
  assert.equal(s.periodTo, '2026-07-12');
  assert.deepEqual(s.weekly.map((w) => w.count), [2, 0, 0, 1]);
  assert.equal(s.weekly[0].medianLikes, 150);
});

test('selectBriefingTweets: 상한 + 주별 안배(라운드로빈) + 좋아요 상위 우선', () => {
  const many = [
    ...Array.from({ length: 10 }, (_, i) => tw('2026-06-15', 100 - i, 'w1-' + i)),
    ...Array.from({ length: 10 }, (_, i) => tw('2026-06-22', 200 - i, 'w2-' + i)),
  ];
  const sel = selectBriefingTweets(many, 4);
  assert.equal(sel.length, 4);
  const ids = sel.map((t) => t.tweetId);
  assert.ok(ids.includes('w1-0') && ids.includes('w2-0')); // 각 주 1위 포함(안배)
  assert.ok(ids.includes('w1-1') && ids.includes('w2-1')); // 각 주 2위까지
});

test('generateBriefing: 수치 주입·[T] 복원·본문 조립', async () => {
  const tweets = [tw('2026-06-15', 500, 'tid-1'), tw('2026-06-22', 10, 'tid-2')];
  const stats = computeBriefingStats(tweets, NOW, 4);
  let prompt = '';
  const spy: AnthropicLike = {
    messages: { create: async (p) => { prompt = JSON.stringify(p); return fakeLLM(GOOD).messages.create(p); } },
  };
  const c = await generateBriefing({ columnTitle: '니키비跡', tweets, stats }, spy);
  assert.ok(prompt.includes('좋아요 중앙값'));            // 코드 계산 수치가 프롬프트에 주입됨
  assert.ok(prompt.includes('[T1]'));                     // 번호 매핑 주입
  assert.deepEqual(c!.tldr, GOOD.tldr);
  assert.ok(c!.body.includes('## 핵심 화두'));            // 고정 섹션 제목으로 코드가 조립
  assert.ok(c!.body.includes('## 기획 시사점'));
  assert.deepEqual(c!.citations.map((x) => x.tweetId), ['tid-1']); // [T1]만 인용됨
  assert.ok(Array.isArray(c!.citations[0].flags));
  assert.deepEqual(c!.stats, stats);
});

test('generateBriefing: 없는 번호 인용은 본문에서 제거·인용 목록 제외', async () => {
  const tweets = [tw('2026-06-15', 500, 'tid-1')];
  const stats = computeBriefingStats(tweets, NOW, 4);
  const c = await generateBriefing({ columnTitle: 'c', tweets, stats },
    fakeLLM({ ...GOOD, hits: '유령 트윗 [T99] 이 좋았다 [T1]' }));
  assert.ok(!c!.body.includes('[T99]'));
  assert.deepEqual(c!.citations.map((x) => x.n), [1]);
});

test('generateBriefing: 금지 표현·형식 불량 → null(저장 금지 신호)', async () => {
  const tweets = [tw('2026-06-15', 500)];
  const stats = computeBriefingStats(tweets, NOW, 4);
  assert.equal(await generateBriefing({ columnTitle: 'c', tweets, stats },
    fakeLLM({ ...GOOD, topics: '인게이지먼트가 높다고 할 수 있습니다.' })), null); // 금지 표현
  assert.equal(await generateBriefing({ columnTitle: 'c', tweets, stats },
    fakeLLM({ tldr: '배열 아님', topics: 1 })), null);                            // 형식 불량
  const noJson: AnthropicLike = { messages: { create: async () => ({ content: [{ type: 'text', text: '죄송합니다' }] }) } };
  assert.equal(await generateBriefing({ columnTitle: 'c', tweets, stats }, noJson), null);
});

test('FORBIDDEN_PHRASES에 핵심 금지어 포함(회귀 고정)', () => {
  for (const p of ['라고 할 수 있습니다', '주목할 만한', '인게이지먼트']) {
    assert.ok(FORBIDDEN_PHRASES.includes(p), p);
  }
});
