import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { insertDraft, updateDraft } from './draftStore.ts';
import { insertLink, appendClickSnapshot } from './linkStore.ts';
import { addTrackedPost, setDraftLink } from './trackingStore.ts';
import { insertLandingEvents } from './landingEventStore.ts';
import type { LandingEventInput } from './landingEvent.ts';
import { listCampaigns, listContentRows, loadPerformance } from './performanceStore.ts';

const sql = getSql();
const P = 'tperf' + process.pid.toString(36) + Date.now().toString(36);
const CAMP = `${P}-camp`;
const M = { views: 100, likes: 1, retweets: 0, replies: 0, bookmarks: 0, quotes: 0 };
let n = 0;
const ev = (visit: string, kind: 'arrival' | 'view' | 'tap', utmContent: string | null, over: Partial<LandingEventInput> = {}): LandingEventInput => ({
  eventId: `${P}-e${++n}`, visitId: `${P}-${visit}`, kind, clinic: 'mind', hostname: 'b', path: '/mind',
  utmSource: 'x', utmMedium: null, utmCampaign: CAMP, utmContent, utmTerm: null, refererHost: null,
  ua: 'ua', isBotUa: false, secFetchOk: false, ipHash: null, country: null, occurredAt: '2026-08-25T03:00:00.000Z', ...over,
});

after(async () => {
  await sql`delete from landing_event where event_id like ${P + '%'}`;
  await sql`delete from tracking_link where utm_campaign like ${P + '%'}`;
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql.end();
});

test('콘텐츠 행 — 링크+원고+게시물(main·link)+클릭 스냅샷+이벤트가 한 행으로 모인다', async () => {
  const d = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [], direction: P + 'd1', format: 'thread', referenceMode: 'off', refs: [],
    content: { posts: [{ text: '1/', media: [] }, { text: '2/', media: [] }, { text: '3/', media: [] }] }, model: null, memberId: null,
  });
  await updateDraft(sql, d, { title: '리프팅 다운타임 후기' }); // insertDraft는 id(string)를 돌려준다
  const link = await insertLink(sql, {
    code: P + 'a', landingUrl: 'https://c.example.com/', longUrl: 'https://c.example.com/?utm_content=x', shortUrl: `https://cb.link/${P}a`,
    shortioLinkId: 'l' + P, utmCampaign: CAMP, influencerHandle: 'hana_kim', utmContent: `hana_kim-${P}`, draftId: d,
    clientId: null, clientName: null, createdBy: null,
  });
  await appendClickSnapshot(sql, link.id, { totalClicks: 720, humanClicks: 700 }, null);
  const main = await addTrackedPost(sql, { tweetId: P + 'm', authorHandle: 'hana_kim', text: '1/', postedAt: '2026-08-24T01:00:00.000Z',
    createdBy: null, metrics: { ...M, views: 12400 }, raw: { isReply: false, entities: { urls: [] } } });
  const lnk = await addTrackedPost(sql, { tweetId: P + 'l', authorHandle: 'hana_kim', text: '링크', postedAt: '2026-08-24T01:10:00.000Z',
    createdBy: null, metrics: { ...M, views: 3100 }, raw: { isReply: true, entities: { urls: [{ expanded_url: link.shortUrl }] } } });
  await setDraftLink(sql, main.row.id, d); await setDraftLink(sql, lnk.row.id, d);
  await insertLandingEvents(sql, [
    ev('v1', 'arrival', `hana_kim-${P}`), ev('v1', 'view', `hana_kim-${P}`), ev('v1', 'tap', `hana_kim-${P}`),
    ev('v2', 'view', `hana_kim-${P}`), ev('v3', 'arrival', `hana_kim-${P}`),
  ]);

  const rows = await listContentRows(sql, CAMP, null);
  const r = rows.find((x) => x.linkId === link.id)!;
  assert.equal(r.title, '리프팅 다운타임 후기');
  assert.equal(r.format, 'thread'); assert.equal(r.threadTotal, 3);
  assert.equal(r.views, 12400); assert.equal(r.clicks, 720);
  assert.deepEqual([r.arrivals, r.taps, r.visits], [2, 1, 3]);
  assert.deepEqual(r.posts.map((p) => [p.role, p.views]), [['main', 12400], ['link', 3100]]);
  assert.equal(r.postedAt, '2026-08-24T01:00:00.000Z');
  assert.equal(r.sharedUtmContent, false);
});

test('원고 없는 링크 — 제목은 utm_content, 조회 null, 게시물 없음 · 옛 링크는 code로 매칭', async () => {
  const bare = await insertLink(sql, {
    code: P + 'b', landingUrl: 'https://c.example.com/', longUrl: 'https://c.example.com/', shortUrl: `https://cb.link/${P}b`,
    shortioLinkId: 'l2' + P, utmCampaign: CAMP, influencerHandle: 'yuki_jp', utmContent: `yuki_jp-${P}`, draftId: null,
    clientId: null, clientName: null, createdBy: null,
  });
  await sql`update tracking_link set utm_content = null where id = ${bare.id}`; // 031 이전 링크 흉내
  await insertLandingEvents(sql, [ev('v9', 'view', P + 'b')]);                    // utm_content = code
  const r = (await listContentRows(sql, CAMP, null)).find((x) => x.linkId === bare.id)!;
  assert.equal(r.title, P + 'b'); assert.equal(r.utmContent, P + 'b');
  assert.equal(r.views, null); assert.equal(r.clicks, null); assert.deepEqual(r.posts, []);
  assert.equal(r.arrivals, 1);
});

test('loadPerformance — 캠페인 목록·기본 선택·제외 방문·미연결·없는 캠페인은 최근으로 대체', async () => {
  await insertLandingEvents(sql, [ev('u1', 'view', null)]);
  const camps = await listCampaigns(sql);
  assert.ok(camps.some((c) => c.code === CAMP));
  const data = await loadPerformance(sql, CAMP, 'all');
  assert.equal(data.selected, CAMP);
  assert.equal(data.excluded, 1);        // v3(arrival만) 1건
  assert.equal(data.unlinked.total, 1);  // u1(utm_content null)
  const fallback = await loadPerformance(sql, `${P}-nope`, 'all');
  assert.equal(fallback.selected, camps[0].code);
});
