import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTopics, classifyTweets, MAX_ANALYSIS_TWEETS, type PillarInputTweet } from './pillar.ts';

function fakeClient(text: string) {
  return { messages: { create: async () => ({ content: [{ type: 'text', text }] }) } };
}
const tw = (id: string): PillarInputTweet => ({ tweetId: id, text: '본문' + id });

test('deriveTopics: 주제 + 번호 배정 → tweetId 역매핑', async () => {
  const out = await deriveTopics([tw('A'), tw('B'), tw('C')], fakeClient(
    '{"topics":[{"id":"t1","label":"성분"},{"id":"t2","label":"시술"}],"assignments":{"t1":[1,3],"t2":[2]}}'));
  assert.deepEqual(out!.topics, [{ id: 't1', label: '성분' }, { id: 't2', label: '시술' }]);
  assert.deepEqual(out!.assignments, [
    { tweetId: 'A', topicId: 't1' }, { tweetId: 'C', topicId: 't1' }, { tweetId: 'B', topicId: 't2' },
  ]);
});

test('deriveTopics: 방어 — 없는 주제·범위 밖 번호·중복 배정 제거', async () => {
  const out = await deriveTopics([tw('A'), tw('B')], fakeClient(
    '{"topics":[{"id":"t1","label":"ㄱ"}],"assignments":{"t1":[1,1,99],"ghost":[2]}}'));
  assert.deepEqual(out!.assignments, [{ tweetId: 'A', topicId: 't1' }]);
});

test('deriveTopics: 파싱 불가·topics 없음 → null (기존 스냅샷 보존용 신호)', async () => {
  assert.equal(await deriveTopics([tw('A')], fakeClient('죄송합니다')), null);
  assert.equal(await deriveTopics([tw('A')], fakeClient('{"assignments":{}}')), null);
  assert.equal(await deriveTopics([tw('A')], fakeClient('{"topics":[]}')), null);
});

test('deriveTopics: 500건 상한 — 넘치는 입력은 잘라서 프롬프트에 넣음', async () => {
  let prompt = '';
  const c = { messages: { create: async (p: { messages: Array<{ content: string }> }) => {
    prompt = p.messages[0].content;
    return { content: [{ type: 'text', text: '{"topics":[{"id":"t1","label":"ㄱ"}],"assignments":{}}' }] };
  } } };
  const many = Array.from({ length: MAX_ANALYSIS_TWEETS + 50 }, (_, i) => tw('id' + i));
  await deriveTopics(many, c as never);
  assert.ok(prompt.includes(`${MAX_ANALYSIS_TWEETS}.`));
  assert.ok(!prompt.includes(`${MAX_ANALYSIS_TWEETS + 1}.`));
});

test('classifyTweets: 기존 주제에 배정, 새 주제 무시, 실패 시 빈 배열', async () => {
  const topics = [{ id: 't1', label: '성분' }];
  const ok = await classifyTweets(topics, [tw('X'), tw('Y')], fakeClient('{"assignments":{"t1":[2],"t9":[1]}}'));
  assert.deepEqual(ok, [{ tweetId: 'Y', topicId: 't1' }]);
  assert.deepEqual(await classifyTweets(topics, [tw('X')], fakeClient('모르겠어요')), []);
});
