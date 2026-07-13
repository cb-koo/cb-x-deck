import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { enrichQuoted } from './quotedEnrich.ts';
import { getQuotedMap, upsertQuoted } from './quotedStore.ts';
import type { RawTweet } from './getxapi.ts';

const sql = getSql();
const P = 'test-qe-' + process.pid + '-';

function rawDetail(id: string): RawTweet {
  return {
    id, text: 'detail body ' + id, createdAt: 'Sun Jul 05 01:00:00 +0000 2026',
    author: { userName: 'qh_' + id.slice(-4), name: '작성자', profilePicture: 'https://a/p.jpg', followers: 3 },
    media: [{ type: 'photo', url: 'https://m/x.jpg' }],
    url: `https://x.com/u/status/${id}`,
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
  await sql`delete from quoted_tweet where id like ${P + '%'}`;
  await sql.end();
});

test('신규 ID만 페치·캐시, 이미 캐시된 ID는 호출 0회', async () => {
  await upsertQuoted(sql, P + 'cached', null);
  const c = fakeClient({ [P + 'n1']: rawDetail(P + 'n1') });
  const r = await enrichQuoted(sql, c, [P + 'cached', P + 'n1', P + 'n1']);
  assert.deepEqual(c.calls, [P + 'n1']); // dedupe + 캐시 제외
  assert.equal(r.fetched, 1);
  const map = await getQuotedMap(sql, [P + 'n1']);
  assert.equal(map[P + 'n1'].authorName, '작성자');
  assert.equal(map[P + 'n1'].tweetCreatedAt, '2026-07-05T01:00:00.000Z');
});

test('404(null)는 tombstone으로 기록 → 다음 호출에서 재조회 안 함', async () => {
  const c = fakeClient({ [P + 'gone']: null });
  const r1 = await enrichQuoted(sql, c, [P + 'gone']);
  assert.equal(r1.missing, 1);
  const c2 = fakeClient({});
  await enrichQuoted(sql, c2, [P + 'gone']);
  assert.deepEqual(c2.calls, []);
});

test('개별 실패(네트워크 오류)는 삼키고 나머지 계속, 캐시 미기록(다음에 재시도)', async () => {
  const c = fakeClient({ [P + 'err']: new Error('boom'), [P + 'ok']: rawDetail(P + 'ok') });
  const r = await enrichQuoted(sql, c, [P + 'err', P + 'ok']);
  assert.equal(r.fetched, 1);
  const again = await enrichQuoted(sql, fakeClient({ [P + 'err']: rawDetail(P + 'err') }), [P + 'err']);
  assert.equal(again.fetched, 1); // err은 캐시 안 됐으므로 재시도됨
});

test('cap 초과분은 이번 라운드에서 건너뜀', async () => {
  const ids = ['a', 'b', 'c'].map((s) => P + 'cap' + s);
  const c = fakeClient(Object.fromEntries(ids.map((i) => [i, rawDetail(i)])));
  const r = await enrichQuoted(sql, c, ids, { cap: 2 });
  assert.equal(c.calls.length, 2);
  assert.equal(r.fetched, 2);
});
