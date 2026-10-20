// X 업로드 현황 — 저장소와 수집(가짜 X 응답). 연습용 DB에서만 돈다(testGuard).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { GetxapiAuthError, type UserInfo, type SearchPage, type RawTweet } from './getxapi.ts';
import { saveChannel, getChannel, removeChannel, listChannelInputs, getChannelInput, countUncheckedChannels } from './ownedChannelStore.ts';
import { collectChannel, collectAll, lookupAccount, type XReader } from './ownedChannelCollect.ts';
import { buildChannelsView } from './ownedChannels.ts';

const sql = getSql();
const P = `test-oc-${process.pid}-`;

after(async () => {
  await sql`delete from client where name like ${P + '%'}`;   // owned_* 는 cascade
  await sql.end();
});

// 기준: 2026-10-21(화) 10:00 한국. 이번 주 10/19~, 지난주 10/12~
const NOW = Date.parse('2026-10-21T01:00:00Z');
const kst = (s: string) => new Date(Date.parse(s.replace(' ', 'T') + ':00Z') - 9 * 3_600_000).toISOString();
const tw = (id: string, at: string, o: Record<string, unknown> = {}): RawTweet => ({ id, createdAt: kst(at), text: `글${id}`, ...o });

function fakeReader(o: {
  info?: Partial<UserInfo> | Error; pages?: SearchPage[]; details?: Record<string, RawTweet | null>;
}) {
  const calls = { info: 0, tweets: [] as Array<string | undefined>, detail: [] as string[] };
  const pages = [...(o.pages ?? [])];
  const reader: XReader = {
    async getUserInfo() {
      calls.info++;
      if (o.info instanceof Error) throw o.info;
      return { id: '111', userName: 'clinic', name: '클리닉', followers: 500, profilePicture: null, description: null, ...o.info };
    },
    async getUserTweets(_id, cursor) {
      calls.tweets.push(cursor);
      return pages.shift() ?? { has_more: false, next_cursor: null, tweets: [] };
    },
    async getTweetDetail(id) {
      calls.detail.push(id);
      return o.details && id in o.details ? o.details[id] : { id };
    },
  };
  return { reader, calls };
}

async function newClient(name: string) {
  return createClient(sql, P + name);
}

test('저장 — 약속 바꾸면 이번 주 줄만 바뀌고, 다른 계정으로 바꾸면 기록을 새로 시작', async () => {
  const c = await newClient('save');
  const a = await saveChannel(sql, c.id, { handle: 'Clinic', accountId: '111', accountCreatedAt: null, weeklyTarget: 1 }, NOW);
  assert.equal(a.isNew, true);
  // 지난주 줄을 손으로 하나 둔다(지난 주 약속은 바뀌면 안 된다)
  await sql`insert into owned_channel_week (channel_id, week_start, target) values (${a.channel.id}, '2026-10-12', 1)`;
  const b = await saveChannel(sql, c.id, { handle: 'clinic', accountId: '111', accountCreatedAt: null, weeklyTarget: 2 }, NOW);
  assert.equal(b.isNew, false);
  assert.equal(b.channel.id, a.channel.id);
  const weeks = await sql`select week_start::text as w, target from owned_channel_week where channel_id = ${a.channel.id} order by week_start`;
  assert.deepEqual(weeks.map((r) => [r.w, r.target]), [['2026-10-12', 1], ['2026-10-19', 2]]);

  await sql`insert into owned_post (channel_id, post_id, kind, posted_at) values (${a.channel.id}, 'p1', 'original', now())`;
  const r = await saveChannel(sql, c.id, { handle: 'other', accountId: '222', accountCreatedAt: null, weeklyTarget: 1 }, NOW);
  assert.equal(r.replaced, true);
  const [{ n }] = await sql`select count(*)::int as n from owned_post where channel_id = ${a.channel.id}`;
  assert.equal(n, 0);
  assert.equal((await getChannel(sql, c.id))?.accountId, '222');

  // 약속 없음 → 이번 주 줄 삭제, 점검 대상에서 빠짐
  await saveChannel(sql, c.id, { handle: 'other', accountId: '222', accountCreatedAt: null, weeklyTarget: null }, NOW);
  assert.ok(await countUncheckedChannels(sql) >= 1);
  assert.equal((await listChannelInputs(sql, NOW)).some((i) => i.clientId === c.id), false);
  await removeChannel(sql, c.id);
  assert.equal(await getChannel(sql, c.id), null);
});

test('계정 조회 — 없음·일시 오류 구분, 인증 오류는 던진다', async () => {
  assert.deepEqual(await lookupAccount(fakeReader({ info: { id: '' } }).reader, 'x'), { ok: false, error: 'notFound' });
  assert.deepEqual(await lookupAccount(fakeReader({ info: new Error('404 from /twitter/user/info: nope') }).reader, 'x'), { ok: false, error: 'notFound' });
  assert.deepEqual(await lookupAccount(fakeReader({ info: new Error('500 from /x after 1 retries') }).reader, 'x'), { ok: false, error: 'fetchFailed' });
  await assert.rejects(() => lookupAccount(fakeReader({ info: new GetxapiAuthError('401') }).reader, 'x'));
});

test('첫 수집 — 8주치를 쪽 넘기며 읽고, 고정 글은 경계 신호로 안 쓰고, 팔로워·개설일 저장', async () => {
  const c = await newClient('first');
  const { channel } = await saveChannel(sql, c.id, { handle: 'clinic', accountId: '111', accountCreatedAt: null, weeklyTarget: 1 }, NOW);
  const { reader, calls } = fakeReader({
    info: { followers: 1234, createdAt: kst('2026-09-30 09:00') },
    pages: [
      { has_more: true, next_cursor: 'c2', tweets: [tw('pin', '2025-01-01 10:00', { isPinned: true }), tw('1', '2026-10-20 10:00'), tw('2', '2026-10-13 10:00', { quoted_tweet: {} })] },
      { has_more: true, next_cursor: 'c3', tweets: [tw('3', '2026-09-01 10:00', { retweeted_tweet: {} }), tw('4', '2026-08-24 10:00')] },
      { has_more: true, next_cursor: 'c4', tweets: [tw('5', '2026-08-23 23:00')] },    // 8주 전 월요일(8/24) 이전 → 여기서 멈춤
    ],
  });
  const r = await collectChannel(sql, reader, channel, { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.complete, true);
  assert.deepEqual(calls.tweets, [undefined, 'c2', 'c3']);
  const posts = await sql`select post_id, kind from owned_post where channel_id = ${channel.id} order by post_id`;
  assert.deepEqual(posts.map((p) => `${p.post_id}:${p.kind}`), ['1:original', '2:quote', '3:retweet', '4:original']);
  const [snap] = await sql`select followers from owned_channel_snapshot where channel_id = ${channel.id}`;
  assert.equal(snap.followers, 1234);
  const ch = await getChannel(sql, c.id);
  assert.equal(ch?.accountCreatedAt, kst('2026-09-30 09:00'));
  assert.ok(ch?.lastCollectedAt);
  assert.equal(ch?.lastError, null);
});

test('평소 수집 — 지난주 월요일까지만, 지운 글은 상세로 확인해 표시만(횟수는 그대로), 다시 보이면 풀림', async () => {
  const c = await newClient('daily');
  const { channel } = await saveChannel(sql, c.id, { handle: 'clinic', accountId: '111', accountCreatedAt: null, weeklyTarget: 1 }, NOW);
  await sql`update owned_channel set last_collected_at = now() - interval '1 day' where id = ${channel.id}`;
  const ins = (id: string, at: string, deleted = false) =>
    sql`insert into owned_post (channel_id, post_id, kind, posted_at, deleted_at) values (${channel.id}, ${id}, 'original', ${kst(at)}, ${deleted ? new Date() : null})`;
  await ins('kept', '2026-10-14 10:00');
  await ins('gone', '2026-10-15 10:00');
  await ins('flaky', '2026-10-16 10:00');      // 목록엔 빠졌지만 상세는 있다 → 그대로
  await ins('back', '2026-10-13 10:00', true); // 지워졌다던 글이 다시 보인다
  await ins('old', '2026-10-01 10:00');        // 지난주보다 오래됨 → 확인 안 함
  const fresh = (await getChannel(sql, c.id))!;
  const { reader, calls } = fakeReader({
    pages: [{ has_more: true, next_cursor: 'n', tweets: [tw('kept', '2026-10-14 10:00'), tw('back', '2026-10-13 10:00'), tw('older', '2026-10-11 22:00')] }],
    details: { gone: null },
  });
  const r = await collectChannel(sql, reader, fresh, { now: NOW });
  assert.equal(r.complete, true);
  assert.equal(calls.tweets.length, 1);
  assert.deepEqual(calls.detail.sort(), ['flaky', 'gone']);
  const rows = Object.fromEntries((await sql`select post_id, deleted_at is not null as d from owned_post where channel_id = ${channel.id}`).map((x) => [x.post_id, x.d]));
  assert.deepEqual(rows, { kept: false, gone: true, flaky: false, back: false, old: false });

  // 지운 글도 지난주 횟수에 든다
  const input = (await getChannelInput(sql, channel.id, NOW))!;
  const v = buildChannelsView([input], NOW);
  const last = v.history.rows[0].cells[7];
  assert.equal(last.count, 4);
  assert.equal(last.deleted, 1);
});

test('목록을 끝까지 못 읽으면 지워짐 확인을 건너뛴다', async () => {
  const c = await newClient('partial');
  const { channel } = await saveChannel(sql, c.id, { handle: 'clinic', accountId: '111', accountCreatedAt: null, weeklyTarget: 1 }, NOW);
  await sql`update owned_channel set last_collected_at = now() where id = ${channel.id}`;
  await sql`insert into owned_post (channel_id, post_id, kind, posted_at) values (${channel.id}, 'x', 'original', ${kst('2026-10-14 10:00')})`;
  const fresh = (await getChannel(sql, c.id))!;
  const pages = Array.from({ length: 10 }, (_, i) => ({ has_more: true, next_cursor: `p${i}`, tweets: [tw(`n${i}`, '2026-10-20 10:00')] }));
  const { reader, calls } = fakeReader({ pages });
  const r = await collectChannel(sql, reader, fresh, { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.complete, false);
  assert.equal(calls.tweets.length, 10);
  assert.equal(calls.detail.length, 0);
});

test('핸들 주인이 바뀌었거나 계정이 없으면 아무것도 쓰지 않고 실패만 남긴다', async () => {
  const c = await newClient('changed');
  const { channel } = await saveChannel(sql, c.id, { handle: 'clinic', accountId: '111', accountCreatedAt: null, weeklyTarget: 1 }, NOW);
  const { reader, calls } = fakeReader({ info: { id: '999' } });
  const r = await collectChannel(sql, reader, channel, { now: NOW });
  assert.deepEqual([r.ok, r.error], [false, 'accountChanged']);
  assert.equal(calls.tweets.length, 0);
  assert.equal((await getChannel(sql, c.id))?.lastError, 'accountChanged');
  const [{ n }] = await sql`select count(*)::int as n from owned_channel_snapshot where channel_id = ${channel.id}`;
  assert.equal(n, 0);
});

test('전체 수집 — 방금 받은 계정은 건너뛰고(↻ 연타), 인증 오류는 던진다', async () => {
  const c = await newClient('all');
  const { channel } = await saveChannel(sql, c.id, { handle: 'clinic', accountId: '111', accountCreatedAt: null, weeklyTarget: 1 }, NOW);
  await sql`update owned_channel set last_collected_at = ${new Date(NOW - 10_000)} where id = ${channel.id}`;
  const { reader } = fakeReader({});
  const r = await collectAll(sql, reader, { now: NOW, skipRecentMs: 60_000 });
  assert.ok(r.skipped >= 1);
  await assert.rejects(() => collectAll(sql, fakeReader({ info: new GetxapiAuthError('401') }).reader, { now: NOW }));
});

test('끊긴 기간 다시 채우기 — 마지막 성공이 3주 전이면 그 주 월요일부터 읽는다(리뷰 10-20)', async () => {
  const c = await newClient('gap');
  const { channel } = await saveChannel(sql, c.id, { handle: 'clinic', accountId: '111', accountCreatedAt: null, weeklyTarget: 1 }, NOW);
  await sql`update owned_channel set last_collected_at = ${kst('2026-09-30 07:00')} where id = ${channel.id}`;   // 9/28주
  const fresh = (await getChannel(sql, c.id))!;
  const { reader } = fakeReader({ pages: [{ has_more: true, next_cursor: 'n', tweets: [
    tw('a', '2026-10-13 10:00'), tw('b', '2026-10-06 10:00'), tw('c', '2026-09-29 10:00'), tw('d', '2026-09-27 10:00'),
  ] }] });
  const r = await collectChannel(sql, reader, fresh, { now: NOW });
  assert.equal(r.complete, true);
  const ids = (await sql`select post_id from owned_post where channel_id = ${channel.id} order by post_id`).map((x) => x.post_id);
  assert.deepEqual(ids, ['a', 'b', 'c']);   // 9/28 월요일부터 — 9/27은 그 전 주
});

test('전체 수집 — 한 계정의 저장 오류(수집 중 계정 교체)가 다른 계정을 막지 않는다(리뷰 10-20)', async () => {
  const c1 = await newClient('race1');
  const c2 = await newClient('race2');
  const a = await saveChannel(sql, c1.id, { handle: 'one', accountId: '111', accountCreatedAt: null, weeklyTarget: 1 }, NOW);
  const b = await saveChannel(sql, c2.id, { handle: 'two', accountId: '111', accountCreatedAt: null, weeklyTarget: 1 }, NOW);
  // 다른 테스트가 남긴 채널이 먼저 돌지 않게, 이 둘을 목록 맨 앞으로
  await sql`update owned_channel set last_collected_at = null where id in (${a.channel.id}, ${b.channel.id})`;
  let first = true;
  const reader: XReader = {
    async getUserInfo(h) { return { id: '111', userName: h, name: null, followers: 1, profilePicture: null, description: null }; },
    async getUserTweets() {
      // 첫 계정을 수집하는 도중에 그 계정이 지워진다 → 저장 단계에서 외래키 오류
      if (first) { first = false; await sql`delete from owned_channel where id = ${a.channel.id}`; }
      return { has_more: false, next_cursor: null, tweets: [tw('z', '2026-10-20 10:00')] };
    },
    async getTweetDetail(id) { return { id }; },
  };
  const r = await collectAll(sql, reader, { now: NOW });
  assert.ok(r.failed >= 1);
  assert.ok((await getChannel(sql, c2.id))?.lastCollectedAt, '두 번째 계정은 받혔다');
});

test('약속 시작일 — 새 계정은 오늘이 기본, 바꾸면 그 값, 안 보내면 그대로', async () => {
  const c = await newClient('start');
  const a = await saveChannel(sql, c.id, { handle: 'clinic', accountId: '111', accountCreatedAt: null, weeklyTarget: 1 }, NOW);
  assert.equal(a.channel.promiseStartedOn, '2026-10-21');
  const b = await saveChannel(sql, c.id, { handle: 'clinic', accountId: '111', accountCreatedAt: null, weeklyTarget: 1, promiseStartedOn: '2026-10-01' }, NOW);
  assert.equal(b.channel.promiseStartedOn, '2026-10-01');
  const kept = await saveChannel(sql, c.id, { handle: 'clinic', accountId: '111', accountCreatedAt: null, weeklyTarget: 2 }, NOW);
  assert.equal(kept.channel.promiseStartedOn, '2026-10-01');
  assert.equal((await getChannelInput(sql, a.channel.id, NOW))?.promiseStartedOn, '2026-10-01');
});
