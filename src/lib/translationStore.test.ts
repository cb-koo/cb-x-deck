import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { hashSource, getTranslations, upsertTranslations } from './translationStore.ts';

const sql = getSql();
const P = 'test-tr-' + process.pid + '-';

after(async () => {
  await sql`delete from tweet where tweet_id like ${P + '%'}`; // translation은 cascade 삭제
  await sql.end();
});

test('hashSource: 결정적이고 입력이 바뀌면 달라진다', () => {
  assert.equal(hashSource('毛穴', null), hashSource('毛穴', null));
  assert.notEqual(hashSource('毛穴', null), hashSource('毛穴ケア', null));
  assert.notEqual(hashSource('毛穴', null), hashSource('毛穴', '引用'));
});

test('upsert→get 왕복: 해시·버전 일치할 때만 히트', async () => {
  await sql`insert into tweet (tweet_id, author_handle, text) values (${P + '1'}, 'a', '毛穴ケア') on conflict (tweet_id) do nothing`;
  const h = hashSource('毛穴ケア', null);
  await upsertTranslations(sql, [{
    tweetId: P + '1', sourceHash: h, promptVersion: 1,
    content: '모공 케어', quotedContent: null, model: 'test-model',
  }]);

  const hit = await getTranslations(sql, [{ tweetId: P + '1', sourceHash: h }], 1);
  assert.equal(hit.get(P + '1')?.content, '모공 케어');
  assert.equal(hit.get(P + '1')?.quotedContent, null);

  // 해시 불일치(트윗 수정) → miss
  const missHash = await getTranslations(sql, [{ tweetId: P + '1', sourceHash: 'other' }], 1);
  assert.equal(missHash.size, 0);

  // 버전 불일치(용어집 개정) → miss
  const missVer = await getTranslations(sql, [{ tweetId: P + '1', sourceHash: h }], 2);
  assert.equal(missVer.size, 0);
});

test('upsert 갱신: 같은 tweet_id 재번역이면 덮어쓴다', async () => {
  await sql`insert into tweet (tweet_id, author_handle, text) values (${P + '2'}, 'a', 'x') on conflict (tweet_id) do nothing`;
  await upsertTranslations(sql, [{ tweetId: P + '2', sourceHash: 'h1', promptVersion: 1, content: '첫번역', quotedContent: null, model: null }]);
  await upsertTranslations(sql, [{ tweetId: P + '2', sourceHash: 'h2', promptVersion: 1, content: '재번역', quotedContent: '인용', model: null }]);
  const hit = await getTranslations(sql, [{ tweetId: P + '2', sourceHash: 'h2' }], 1);
  assert.equal(hit.get(P + '2')?.content, '재번역');
  assert.equal(hit.get(P + '2')?.quotedContent, '인용');
});
