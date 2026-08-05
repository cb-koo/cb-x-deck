import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateDraftPosts } from './translateDraft.ts';

// create 호출 시 넘어온 프롬프트를 캡처하고, 지정한 JSON을 반환하는 가짜 클라이언트
function fakeClient(text: string) {
  const calls: string[] = [];
  const client = {
    messages: {
      create: async (p: { messages: Array<{ content: string }> }) => {
        calls.push(p.messages[0].content);
        return { content: [{ type: 'text', text }] };
      },
    },
  };
  return { client, calls };
}

test('번호 키 JSON을 입력 순서 배열로 매핑', async () => {
  const { client } = fakeClient('{"1":"첫 번째 번역","2":"두 번째 번역"}');
  const out = await translateDraftPosts(['毛穴ケア', 'レチノール'], client);
  assert.deepEqual(out, ['첫 번째 번역', '두 번째 번역']);
});

test('일부 포스트 누락이면 null(전부 또는 실패)', async () => {
  const { client } = fakeClient('{"1":"첫 번째만"}');
  const out = await translateDraftPosts(['a', 'b'], client);
  assert.equal(out, null);
});

test('파싱 불가면 null(throw 금지)', async () => {
  const { client } = fakeClient('죄송합니다 번역 못했어요');
  const out = await translateDraftPosts(['x'], client);
  assert.equal(out, null);
});

test('빈 입력은 빈 배열 — LLM 호출 없음', async () => {
  const { client, calls } = fakeClient('{}');
  const out = await translateDraftPosts([], client);
  assert.deepEqual(out, []);
  assert.equal(calls.length, 0);
});

test('프롬프트에 원문·용어집·줄바꿈 규칙 포함', async () => {
  const { client, calls } = fakeClient('{"1":"ㅇ"}');
  await translateDraftPosts(['シワ改善の話'], client);
  assert.ok(calls[0].includes('シワ改善の話'));
  assert.ok(calls[0].includes('毛穴→모공'));
  assert.ok(calls[0].includes('줄바꿈'));
});
