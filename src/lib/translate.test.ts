import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateTweets } from './translate.ts';

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

test('번호 키 JSON을 tweetId로 매핑', async () => {
  const { client } = fakeClient('{"1":{"body":"모공 케어","quoted":null},"2":{"body":"레티놀","quoted":"인용 번역"}}');
  const out = await translateTweets(
    [{ tweetId: 'a', text: '毛穴ケア' }, { tweetId: 'b', text: 'レチノール', quotedText: '引用' }],
    client,
  );
  assert.equal(out.get('a')?.content, '모공 케어');
  assert.equal(out.get('a')?.quotedContent, null);
  assert.equal(out.get('b')?.content, '레티놀');
  assert.equal(out.get('b')?.quotedContent, '인용 번역');
});

test('body 없는/문자열 아닌 항목은 건너뜀(부분 성공)', async () => {
  const { client } = fakeClient('{"1":{"body":"정상","quoted":null},"2":{"quoted":"본문없음"},"3":"문자열"}');
  const out = await translateTweets(
    [{ tweetId: 'a', text: 'x' }, { tweetId: 'b', text: 'y' }, { tweetId: 'c', text: 'z' }],
    client,
  );
  assert.equal(out.get('a')?.content, '정상');
  assert.equal(out.has('b'), false);
  assert.equal(out.has('c'), false);
});

test('파싱 불가면 빈 Map(throw 금지)', async () => {
  const { client } = fakeClient('죄송합니다 번역 못했어요');
  const out = await translateTweets([{ tweetId: 'a', text: 'x' }], client);
  assert.equal(out.size, 0);
});

test('청크 분할 후 병합 — chunkSize보다 많으면 여러 호출을 합친다', async () => {
  const { client, calls } = fakeClient('{"1":{"body":"번역","quoted":null},"2":{"body":"번역2","quoted":null}}');
  const out = await translateTweets(
    [{ tweetId: 'a', text: '1' }, { tweetId: 'b', text: '2' }, { tweetId: 'c', text: '3' }],
    client, 2, // 청크 2 → [a,b],[c] 두 호출
  );
  assert.equal(calls.length, 2);
  assert.equal(out.size, 3); // a,b는 첫 청크, c는 둘째 청크의 "1"
  assert.equal(out.get('c')?.content, '번역');
});

test('프롬프트에 보존 규칙과 용어집이 들어있다(회귀 방지)', async () => {
  const { client, calls } = fakeClient('{"1":{"body":"x","quoted":null}}');
  await translateTweets([{ tweetId: 'a', text: '毛穴' }], client);
  const prompt = calls[0];
  assert.match(prompt, /멘션/);      // @멘션 보존 규칙
  assert.match(prompt, /해시태그/);   // #해시태그 보존 규칙
  assert.match(prompt, /毛穴/);       // 용어집 항목
});
