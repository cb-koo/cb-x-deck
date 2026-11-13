import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadPrivateImage, postBlocks, SlackApiError, type FetchLike } from './slackUpload.ts';

const TOKEN = 'xoxb-test-token-123';
type Call = { url: string; init?: RequestInit };
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
function fake(responses: Array<(c: Call) => Response>): { f: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return { calls, f: async (url, init) => { const c = { url, init }; calls.push(c); return responses[calls.length - 1](c); } };
}

test('업로드 세 단계 순서와 채널 없는 완료 호출', async () => {
  const { f, calls } = fake([
    () => json({ ok: true, upload_url: 'https://files.slack.com/upload/v1/abc', file_id: 'F123' }),
    () => new Response('OK'),
    () => json({ ok: true, files: [{ id: 'F123' }] }),
  ]);
  const id = await uploadPrivateImage(TOKEN, new Uint8Array([1, 2, 3]).buffer, 'status.png', '11월 2주차 캠페인 현황', f);
  assert.equal(id, 'F123');
  assert.match(calls[0].url, /files\.getUploadURLExternal\?filename=status\.png&length=3$/);
  assert.equal(calls[1].url, 'https://files.slack.com/upload/v1/abc');
  assert.match(calls[2].url, /files\.completeUploadExternal$/);
  const body = JSON.parse(String(calls[2].init?.body));
  assert.deepEqual(body, { files: [{ id: 'F123', title: '11월 2주차 캠페인 현황' }] });   // channel_id 없음 = 공유하지 않은 앱 파일
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
});

test('invalid_blocks는 다시 시도하고, 성공하면 ts를 준다', async () => {
  const { f, calls } = fake([
    () => json({ ok: false, error: 'invalid_blocks' }),
    () => json({ ok: false, error: 'invalid_blocks' }),
    () => json({ ok: true, ts: '1731.0001' }),
  ]);
  const r = await postBlocks(TOKEN, 'C0CGWSFBDPV', { text: 't', blocks: [] }, f, { retries: 3, delayMs: 0 });
  assert.equal(r.ts, '1731.0001');
  assert.equal(calls.length, 3);
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.channel, 'C0CGWSFBDPV');
  assert.equal(body.unfurl_links, false);
});

test('invalid_blocks가 계속되면 횟수를 넘긴 뒤 SlackApiError', async () => {
  const { f, calls } = fake(Array.from({ length: 4 }, () => () => json({ ok: false, error: 'invalid_blocks' })));
  await assert.rejects(postBlocks(TOKEN, 'C1', { text: 't', blocks: [] }, f, { retries: 3, delayMs: 0 }), SlackApiError);
  assert.equal(calls.length, 4);
});

test('다른 오류는 바로 SlackApiError, 메시지에 토큰 없음', async () => {
  const { f, calls } = fake([() => json({ ok: false, error: 'not_in_channel' })]);
  await assert.rejects(postBlocks(TOKEN, 'C1', { text: 't', blocks: [] }, f, { retries: 3, delayMs: 0 }), (e: unknown) => {
    assert.ok(e instanceof SlackApiError);
    assert.equal(e.code, 'not_in_channel');
    assert.ok(!e.message.includes('xoxb'));
    return true;
  });
  assert.equal(calls.length, 1);
});

test('업로드 중간 실패는 그 단계 이름으로 SlackApiError', async () => {
  const { f } = fake([() => json({ ok: false, error: 'invalid_auth' })]);
  await assert.rejects(uploadPrivateImage(TOKEN, new ArrayBuffer(1), 'a.png', 'a', f), (e: unknown) =>
    e instanceof SlackApiError && e.method === 'files.getUploadURLExternal' && e.code === 'invalid_auth');
});
