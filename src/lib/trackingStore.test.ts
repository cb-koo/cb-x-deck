import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { insertDraft, updateDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import { insertLink } from './linkStore.ts';
import {
  addTrackedPost, listTrackedPosts, findByTweetId, findTrackedPostById,
  appendSnapshot, markUnavailable, setDraftLink, deleteTrackedPost, listSnapshots, setRole,
} from './trackingStore.ts';

const sql = getSql();
const P = 'ttrk' + process.pid;
const M = { views: 100, likes: 5, retweets: 2, replies: 1, bookmarks: 3, quotes: 0 };

after(async () => {
  await sql`delete from tracking_link where utm_campaign like ${P + '%'}`;
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`; // 스냅샷은 cascade
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql.end();
});

test('1) 등록 = 명부+첫 스냅샷, 목록에 최신 지표가 붙는다', async () => {
  const { created, row } = await addTrackedPost(sql, {
    tweetId: P + '1', authorHandle: 'someone', text: '본문', postedAt: new Date().toISOString(),
    createdBy: null, metrics: M, raw: { viewCount: 100 },
  });
  assert.equal(created, true);
  assert.equal(row.metrics!.views, 100);
  const listed = (await listTrackedPosts(sql)).find((r) => r.tweetId === P + '1');
  assert.ok(listed);
  assert.equal(listed!.metrics!.likes, 5);
  assert.equal(listed!.unavailableAt, null);
});

test('2) 같은 tweet_id 재등록은 created:false + 기존 행', async () => {
  await addTrackedPost(sql, { tweetId: P + '2', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  const again = await addTrackedPost(sql, { tweetId: P + '2', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  assert.equal(again.created, false);
  const snaps = await sql`select id from post_metric_snapshot
    where tracked_post_id = ${again.row.id}`;
  assert.equal(snaps.length, 1); // 중복 등록이 스냅샷을 또 만들지 않는다
});

test('3) 스냅샷 추가 → 최신값 갱신, 볼 수 없음 기록·복귀', async () => {
  const { row } = await addTrackedPost(sql, { tweetId: P + '3', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  await markUnavailable(sql, row.id);
  const dead = await findTrackedPostById(sql, row.id);
  assert.ok(dead!.unavailableAt);
  await markUnavailable(sql, row.id); // 두 번째 호출이 시각을 덮어쓰지 않는다
  assert.equal((await findTrackedPostById(sql, row.id))!.unavailableAt, dead!.unavailableAt);
  await appendSnapshot(sql, row.id, { ...M, views: 999 }, null); // 복귀
  const back = await findTrackedPostById(sql, row.id);
  assert.equal(back!.metrics!.views, 999);
  assert.equal(back!.unavailableAt, null);
});

test('4) 원고 연결·해제, findByTweetId, 삭제 cascade', async () => {
  const { row } = await addTrackedPost(sql, { tweetId: P + '4', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  assert.ok(await findByTweetId(sql, P + '4'));
  assert.equal(await setDraftLink(sql, row.id, null), true);
  assert.equal(await deleteTrackedPost(sql, row.id), true);
  assert.equal(await findByTweetId(sql, P + '4'), null);
  const snaps = await sql`select id from post_metric_snapshot where tracked_post_id = ${row.id}`;
  assert.equal(snaps.length, 0);
  assert.equal(await deleteTrackedPost(sql, row.id), false);
});

test('5) 원고 연결 후 목록에서 draftLabel(title 우선)이 보인다', async () => {
  const content: DraftContent = { posts: [{ text: '트래킹 연결 테스트 본문', media: [] }] };
  const draftId = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  await updateDraft(sql, draftId, { title: P + '제목' });

  const { row } = await addTrackedPost(sql, {
    tweetId: P + '5', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null,
  });
  assert.equal(await setDraftLink(sql, row.id, draftId), true);

  const listed = (await listTrackedPosts(sql)).find((r) => r.tweetId === P + '5');
  assert.ok(listed);
  assert.equal(listed!.draftId, draftId);
  assert.equal(listed!.draftLabel, P + '제목');

  const found = await findTrackedPostById(sql, row.id);
  assert.equal(found!.draftLabel, P + '제목');

  assert.equal(await setDraftLink(sql, row.id, null), true);
  const unlinked = await findTrackedPostById(sql, row.id);
  assert.equal(unlinked!.draftId, null);
  assert.equal(unlinked!.draftLabel, null);
});

test('6) 측정 이력: 최신순 반환 · limit 적용 · 삭제 시 함께 사라진다', async () => {
  const { row } = await addTrackedPost(sql, {
    tweetId: P + '6', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null,
  });
  // 등록이 첫 측정이므로 이미 1건. 두 건 더 쌓아 순서를 확인한다.
  await appendSnapshot(sql, row.id, { ...M, views: 200 }, null);
  await appendSnapshot(sql, row.id, { ...M, views: 300 }, null);

  const hist = await listSnapshots(sql, row.id);
  assert.equal(hist.length, 3);
  assert.equal(hist[0].metrics.views, 300);          // 최신이 위
  assert.equal(hist[2].metrics.views, M.views);      // 등록 시 첫 측정이 맨 아래
  assert.ok(hist[0].capturedAt >= hist[1].capturedAt); // ISO 문자열은 사전순 = 시간순

  assert.equal((await listSnapshots(sql, row.id, 2)).length, 2);

  await deleteTrackedPost(sql, row.id);
  assert.deepEqual(await listSnapshots(sql, row.id), []); // cascade
});

test('7) 역할 — 원고의 링크 URL이 든 게시물은 link, 가장 이른 것 main, 저장값이 우선', async () => {
  const d = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [], direction: P + 'role', format: 'thread',
    referenceMode: 'off', refs: [], content: { posts: [{ text: '1/', media: [] }, { text: '2/', media: [] }] },
    model: null, memberId: null,
  });
  const link = await insertLink(sql, {
    code: P + 'rl', landingUrl: 'https://c.example.com/', longUrl: 'https://c.example.com/?utm_content=x',
    shortUrl: `https://cb.link/${P}rl`, shortioLinkId: 'lnk_' + P, utmCampaign: P + 'camp',
    influencerHandle: 'hana_kim', utmContent: `hana_kim-${P}`, draftId: d, clientId: null, clientName: null, createdBy: null,
  });
  const main = await addTrackedPost(sql, {
    tweetId: P + '71', authorHandle: 'hana_kim', text: '1/', postedAt: '2026-08-24T01:00:00.000Z',
    createdBy: null, metrics: M, raw: { isReply: false, entities: { urls: [] } },
  });
  const reply = await addTrackedPost(sql, {
    tweetId: P + '72', authorHandle: 'hana_kim', text: '링크', postedAt: '2026-08-24T01:10:00.000Z',
    createdBy: null, metrics: M, raw: { isReply: true, entities: { urls: [{ expanded_url: link.shortUrl }] } },
  });
  await setDraftLink(sql, main.row.id, d);
  await setDraftLink(sql, reply.row.id, d);

  const list = await listTrackedPosts(sql);
  assert.equal(list.find((r) => r.id === main.row.id)!.derivedRole, 'main');
  assert.equal(list.find((r) => r.id === reply.row.id)!.derivedRole, 'link');
  assert.equal(list.find((r) => r.id === reply.row.id)!.role, null);

  assert.equal(await setRole(sql, reply.row.id, 'thread'), true);
  const one = await findTrackedPostById(sql, reply.row.id);
  assert.equal(one!.role, 'thread');
  assert.equal(one!.derivedRole, 'thread'); // 저장값이 판정을 덮는다
  await setRole(sql, reply.row.id, null);
  assert.equal((await findTrackedPostById(sql, reply.row.id))!.derivedRole, 'link');

  await sql`delete from tracking_link where id = ${link.id}`;
});
