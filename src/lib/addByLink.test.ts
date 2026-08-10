import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { addTweetByLink } from './addByLink.ts';
import { createWorkspace, createMember } from './workspaceStore.ts';
import type { RawTweet } from './getxapi.ts';

const sql = getSql();
const P = `99${process.pid}`;              // 숫자 트윗 ID 접두 (실존 ID는 1로 시작하는 19자리 — 충돌 없음)
const NP = 'test-abl-' + process.pid + '-'; // 워크스페이스·멤버 이름 접두

function rawDetail(id: string, extra: Record<string, unknown> = {}): RawTweet {
  return {
    id, text: 'detail body ' + id, createdAt: 'Sun Jul 05 01:00:00 +0000 2026',
    author: { userName: 'abl_user', name: '작성자', profilePicture: 'https://a/p.jpg', followers: 3 },
    media: [], likeCount: 5, viewCount: 100,
    url: `https://x.com/abl_user/status/${id}`,
    ...extra,
  };
}

function fakeClient(behavior: Record<string, RawTweet | null | Error>) {
  const calls: string[] = [];
  return {
    calls,
    getTweetDetail: async (id: string) => {
      calls.push(id);
      const b = behavior[id];
      if (b instanceof Error) throw b;
      return b ?? null;
    },
  };
}

after(async () => {
  await sql`delete from candidate where tweet_id like ${P + '%'}`;
  await sql`delete from library_item where tweet_id like ${P + '%'}`;
  await sql`delete from quoted_tweet where id like ${P + '%'}`;
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql`delete from workspace where name like ${NP + '%'}`;
  await sql`delete from member where name like ${NP + '%'}`;
  await sql.end();
});

test('정상 저장: 트윗 upsert + library_item + candidate(★) 생성, 메모 반영', async () => {
  const ws = await createWorkspace(sql, NP + 'w1');
  const m = await createMember(sql, NP + 'A', '#111111');
  const id = P + '01';
  const c = fakeClient({ [id]: rawDetail(id) });

  const r = await addTweetByLink(sql, c, {
    url: `https://x.com/abl_user/status/${id}`, workspaceId: ws.id, memberId: m.id, memo: '톤이 좋다',
  });
  assert.deepEqual(r, { ok: true, tweetId: id, alreadyInLibrary: false });
  assert.deepEqual(c.calls, [id]);

  const [t] = await sql`select text from tweet where tweet_id = ${id}`;
  assert.equal(t.text, 'detail body ' + id);
  const li = await sql`select 1 from library_item where workspace_id = ${ws.id} and tweet_id = ${id}`;
  assert.equal(li.count, 1);
  const [cand] = await sql`select memo from candidate where workspace_id = ${ws.id} and tweet_id = ${id} and member_id = ${m.id}`;
  assert.equal(cand.memo, '톤이 좋다');
});

test('중복 추가: 두 번째 호출은 alreadyInLibrary=true, 행은 늘지 않는다', async () => {
  const ws = await createWorkspace(sql, NP + 'w2');
  const m = await createMember(sql, NP + 'B', '#222222');
  const id = P + '02';
  const c = fakeClient({ [id]: rawDetail(id) });
  const url = `https://x.com/abl_user/status/${id}`;

  const r1 = await addTweetByLink(sql, c, { url, workspaceId: ws.id, memberId: m.id });
  const r2 = await addTweetByLink(sql, c, { url, workspaceId: ws.id, memberId: m.id });
  assert.equal(r1.ok && r1.alreadyInLibrary, false);
  assert.equal(r2.ok && r2.alreadyInLibrary, true);
  const li = await sql`select 1 from library_item where workspace_id = ${ws.id} and tweet_id = ${id}`;
  assert.equal(li.count, 1);
});

test('리포스트 링크: 원본 트윗을 대신 저장한다', async () => {
  const ws = await createWorkspace(sql, NP + 'w3');
  const m = await createMember(sql, NP + 'C', '#333333');
  const rtId = P + '03';       // 사용자가 붙여넣은 RT의 ID
  const origId = P + '04';     // 원본
  const c = fakeClient({ [rtId]: rawDetail(rtId, { retweeted_tweet: rawDetail(origId) }) });

  const r = await addTweetByLink(sql, c, {
    url: `https://x.com/abl_user/status/${rtId}`, workspaceId: ws.id, memberId: m.id,
  });
  assert.deepEqual(r, { ok: true, tweetId: origId, alreadyInLibrary: false });
  const li = await sql`select tweet_id from library_item where workspace_id = ${ws.id}`;
  assert.equal(li[0].tweet_id, origId);
});

test('인용 트윗 포함: 인용 원문을 quoted_tweet 캐시에 보강한다', async () => {
  const ws = await createWorkspace(sql, NP + 'w4');
  const m = await createMember(sql, NP + 'D', '#444444');
  const id = P + '05';
  const qId = P + '06';
  const c = fakeClient({
    [id]: rawDetail(id, { quoted_tweet: { id: qId, text: 'quoted', user: { name: '인용작성자', screen_name: 'qq' } } }),
    [qId]: rawDetail(qId),
  });

  const r = await addTweetByLink(sql, c, {
    url: `https://x.com/abl_user/status/${id}`, workspaceId: ws.id, memberId: m.id,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(c.calls, [id, qId]); // 본체 1콜 + 인용 보강 1콜
  const q = await sql`select 1 from quoted_tweet where id = ${qId} and status = 'ok'`;
  assert.equal(q.count, 1);
});

test('삭제·비공개(detail null)와 파싱 실패는 저장 없이 오류 반환', async () => {
  const ws = await createWorkspace(sql, NP + 'w5');
  const m = await createMember(sql, NP + 'E', '#555555');
  const gone = P + '07';
  const c = fakeClient({}); // 모든 ID에 null

  assert.deepEqual(
    await addTweetByLink(sql, c, { url: `https://x.com/abl_user/status/${gone}`, workspaceId: ws.id, memberId: m.id }),
    { ok: false, error: 'notFound' });
  assert.deepEqual(
    await addTweetByLink(sql, c, { url: 'https://x.com/abl_user', workspaceId: ws.id, memberId: m.id }),
    { ok: false, error: 'parse', reason: 'notTweet' });
  const li = await sql`select 1 from library_item where workspace_id = ${ws.id}`;
  assert.equal(li.count, 0);
});
