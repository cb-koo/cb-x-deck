import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks } from './campaignTaskStore.ts';
import { getCampaignOverview } from './campaignOverviewStore.ts';

const sql = getSql();
const P = 'tcov' + process.pid;

// 정산 요청은 만들지 않는다 — 테스트 픽스처가 정산팀 폴링에 노출된 사고(09-09)가 있었다
after(async () => {
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`;   // 스냅샷은 cascade
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  const [left] = await sql<Array<{ n: number }>>`
    select (select count(*) from campaign where name like ${P + '%'})::int
         + (select count(*) from client where name like ${P + '%'})::int
         + (select count(*) from tracked_post where tweet_id like ${P + '%'})::int as n`;
  assert.equal(left.n, 0);   // 남긴 행이 없어야 한다
  await sql.end();
});

const base = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };
const snap = (tpId: string, views: number, bookmarks: number, at: string, isReply: boolean) =>
  sql`insert into post_metric_snapshot (tracked_post_id, views, likes, retweets, replies, bookmarks, quotes, captured_at, raw)
      values (${tpId}, ${views}, 0, 0, 0, ${bookmarks}, 0, ${at}, ${sql.json({ isReply })})`;
const post = async (taskId: string, tweet: string, postedAt: string) => {
  const [r] = await sql<Array<{ id: string }>>`
    insert into tracked_post (tweet_id, author_handle, text, task_id, posted_at) values (${P + tweet}, ${P + 'inf'}, '', ${taskId}, ${postedAt}) returning id`;
  return r.id;
};
async function campaign(client: string, name: string, startsOn: string, endsOn: string) {
  const c = await createClient(sql, P + client);
  return createCampaign(sql, {
    clientId: c.id, clientName: c.name, name: P + name, nameEn: `${P}-${client.length}-${startsOn}`,
    startsOn, endsOn, kind: null, note: '', createdBy: null,
  });
}

test('이번 주 주차 캠페인의 수량과 성과, 날짜별 누적이 캠페인 상세와 같은 값으로 나온다', async () => {
  const camp = await campaign('클라', '캠', '2026-11-09', '2026-11-15');
  const [t1] = await createTasks(sql, camp.id, { ...base, type: 'quoteRt', items: [{ handle: P + 'inf', cost: { amount: 50000, currency: 'KRW' } }] });
  await createTasks(sql, camp.id, { ...base, scheduledOn: '2026-11-10', type: 'quoteRt', items: [{ handle: P + 'inf2', cost: null }] });
  await createTasks(sql, camp.id, { ...base, type: 'quoteRt', items: [{ handle: P + 'inf3', cost: null }] });
  const [t4] = await createTasks(sql, camp.id, { ...base, type: 'quoteRt', items: [{ handle: P + 'inf4', cost: null }] });
  await sql`update campaign_task set posted_at = '2026-11-10' where id = ${t1.id}`;
  await sql`update campaign_task set cancelled_at = now() where id = ${t4.id}`;

  // 본 게시물(먼저 올라감, 댓글 아님) + 같은 작업의 인플 본인 댓글 — 댓글 조회수는 더하지 않는다
  const main = await post(t1.id, 'm1', '2026-11-10T03:00:00Z');
  const reply = await post(t1.id, 'r1', '2026-11-10T04:00:00Z');
  await snap(main, 1000, 10, '2026-11-10T06:00:00Z', false);   // 11/10 15:00 KST
  await snap(main, 4000, 40, '2026-11-12T00:00:00Z', false);   // 11/12 09:00 KST
  await snap(reply, 99999, 999, '2026-11-12T00:00:00Z', true);

  const o = await getCampaignOverview(sql, null, '2026-11-12');
  const card = o.cards.find((c) => c.title === P + '클라')!;
  assert.ok(card, '카드가 있어야 한다');
  assert.deepEqual(card.quantity, { planned: 3, posted: 1, overdue: 1, open: 2, undated: 1, cancelled: 1 });
  assert.equal(card.perf.views.value, 4000);
  assert.equal(card.perf.bookmarks.value, 40);
  assert.deepEqual(card.perf.cpv, { kind: 'value', krw: 12.5 });
  assert.deepEqual(card.chart!.views.slice(0, 4), [0, 1000, 1000, 4000]);
  assert.equal(card.status, 'late');
});

test('지난 주(?week=)를 주면 그 주 캠페인만, 장기 캠페인은 long으로', async () => {
  await campaign('지난클라', '지난', '2026-11-02', '2026-11-08');
  const long = await campaign('장기클라', '장기', '2026-10-01', '2026-12-31');
  await createTasks(sql, long.id, { ...base, type: 'visit', items: [{ handle: P + 'vis', cost: null }] });

  const o = await getCampaignOverview(sql, '2026-11-04', '2026-11-12');
  assert.equal(o.week.weekStart, '2026-11-02');
  assert.ok(o.cards.some((c) => c.title === P + '지난클라'));
  assert.ok(!o.cards.some((c) => c.title === P + '클라'));
  assert.ok(o.long.some((r) => r.title === P + '장기클라'));
});
