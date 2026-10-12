import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createInfluencer } from './influencerStore.ts';
import { createTasks } from './campaignTaskStore.ts';
import { listInfluencerPerformance } from './influencerPerformanceStore.ts';

const sql = getSql();
const P = 'tipf' + process.pid;

after(async () => {
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql.end();
});

const base = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };
const snap = (tpId: string, v: Record<string, number | null>, at: string) =>
  sql`insert into post_metric_snapshot (tracked_post_id, views, likes, retweets, replies, bookmarks, quotes, captured_at)
      values (${tpId}, ${v.views}, ${v.likes}, ${v.retweets}, ${v.replies}, ${v.bookmarks}, ${v.quotes}, ${at})`;

test('취소 제외·게시물 여러 개면 본 게시물 하나의 최신 스냅샷(합산 안 함)·명부 조인·명부 밖 핸들', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await createCampaign(sql, {
    clientId: c.id, clientName: c.name, name: P + '캠', nameEn: `${P}-a`,
    startsOn: '2026-09-01', endsOn: '2026-09-06', kind: null, note: '', createdBy: null,
  });
  const { row: roster } = await createInfluencer(sql, { handle: P + 'Rio', createdBy: null });

  const [q1] = await createTasks(sql, camp.id, { ...base, type: 'quoteRt', items: [{ handle: (P + 'rio').toUpperCase(), cost: { amount: 1000, currency: 'JPY' } }] });
  const [cancelled] = await createTasks(sql, camp.id, { ...base, type: 'quoteRt', items: [{ handle: P + 'rio', cost: null }] });
  await createTasks(sql, camp.id, { ...base, type: 'rt', items: [{ handle: P + 'ghost', cost: null }] });
  await sql`update campaign_task set cancelled_at = now() where id = ${cancelled.id}`;
  await sql`update campaign_task set posted_at = '2026-09-03', post_url = 'https://x.com/r/status/1' where id = ${q1.id}`;
  // 게시 내림 — 날짜·사유를 그대로 넘긴다(표본 제외는 계산 쪽 몫, 스펙 §12-4)
  await sql`update campaign_task set removed_at = '2026-09-07', removed_reason = '광고 표기 누락' where id = ${q1.id}`;

  // 작업 q1에 게시물 2개 — post_url(status/1)이 트래킹에 없으니 가장 이른 본 게시물(x1)의 최신 스냅샷만(self-replies 스펙 §5)
  const [tp1] = await sql<Array<{ id: string }>>`insert into tracked_post (tweet_id, author_handle, text, task_id) values (${P + 'x1'}, 'rio', '', ${q1.id}) returning id`;
  const [tp2] = await sql<Array<{ id: string }>>`insert into tracked_post (tweet_id, author_handle, text, task_id) values (${P + 'x2'}, 'rio', '', ${q1.id}) returning id`;
  await snap(tp1.id, { views: 50, likes: 1, retweets: 0, replies: 0, bookmarks: 0, quotes: 0 }, '2026-09-04T00:00:00Z');
  await snap(tp1.id, { views: 100, likes: 5, retweets: 1, replies: 1, bookmarks: 2, quotes: 0 }, '2026-09-05T00:00:00Z');
  await snap(tp2.id, { views: 20, likes: 1, retweets: 0, replies: 0, bookmarks: 0, quotes: 1 }, '2026-09-05T00:00:00Z');

  const all = await listInfluencerPerformance(sql);
  const mine = all.filter((r) => r.handle.toLowerCase().startsWith(P));
  assert.equal(mine.length, 2);

  const rio = mine.find((r) => r.influencerId === roster.id)!;
  assert.equal(rio.handle, roster.handle);          // 명부 표기를 쓴다
  assert.equal(rio.tasks.length, 1);                 // 취소 작업은 없다
  const t = rio.tasks[0];
  assert.equal(t.campaignName, P + '캠');
  assert.equal(t.clientId, c.id);                   // 클라이언트 필터용 스냅샷(스펙 §15-3)
  assert.equal(t.clientName, c.name);
  assert.equal(t.postedAt, '2026-09-03');
  assert.deepEqual(t.cost, { amount: 1000, currency: 'JPY' });
  assert.equal(t.removedAt, '2026-09-07');
  assert.equal(t.removedReason, '광고 표기 누락');
  assert.deepEqual(t.metrics, { postCount: 2, views: 100, likes: 5, replies: 1, bookmarks: 2, retweets: 1, quotes: 0 });   // x2(20)는 더하지 않는다

  const ghost = mine.find((r) => r.handle === P + 'ghost')!;
  assert.equal(ghost.influencerId, null);
  assert.equal(ghost.tasks[0].type, 'rt');
  assert.equal(ghost.tasks[0].metrics, null);        // 게시물 없음
  assert.equal(ghost.tasks[0].removedAt, null);
  assert.equal(ghost.tasks[0].removedReason, '');   // 기본값 ''
});
