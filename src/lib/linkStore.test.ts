import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { insertDraft, updateDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import {
  listLinks, findLinkById, insertLink, appendClickSnapshot,
  markLinkUnavailable, deleteLink, listClickSnapshots,
} from './linkStore.ts';

const sql = getSql();
const P = 'tlnk' + process.pid.toString(36) + Date.now().toString(36);
const base = (code: string) => ({
  code, landingUrl: 'https://c.example.com/', longUrl: `https://c.example.com/?utm_content=h-${code}`,
  shortUrl: `https://cb.link/${code}`, shortioLinkId: 'lnk_' + code, utmCampaign: P + '캠',
  influencerHandle: 'hana_kim', draftId: null as string | null, clientId: null, clientName: null, createdBy: null,
});

after(async () => {
  await sql`delete from tracking_link where utm_campaign like ${P + '%'}`; // 스냅샷은 cascade
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql.end();
});

test('1) 생성 → 목록 — 클릭 측정 전에는 clicks가 null', async () => {
  const row = await insertLink(sql, base(P + '1'));
  assert.equal(row.clicks, null);
  assert.equal(row.capturedAt, null);
  assert.equal(row.unavailableAt, null);
  const listed = (await listLinks(sql)).find((r) => r.id === row.id);
  assert.ok(listed);
  assert.equal(listed!.shortUrl, row.shortUrl);
});

test('2) code unique — 같은 코드 재삽입은 던진다(호출부 재생성의 근거)', async () => {
  await insertLink(sql, base(P + '2'));
  await assert.rejects(() => insertLink(sql, base(P + '2')));
});

test('3) 클릭 스냅샷 append — 최신값이 목록에 붙고 이력이 쌓인다·복귀 수용', async () => {
  const row = await insertLink(sql, base(P + '3'));
  await appendClickSnapshot(sql, row.id, { totalClicks: 10, humanClicks: 9 }, { totalClicks: 10 });
  await markLinkUnavailable(sql, row.id);
  const dead = await findLinkById(sql, row.id);
  assert.ok(dead!.unavailableAt);
  await markLinkUnavailable(sql, row.id); // 두 번째 호출이 시각을 덮어쓰지 않는다
  assert.equal((await findLinkById(sql, row.id))!.unavailableAt, dead!.unavailableAt);
  await appendClickSnapshot(sql, row.id, { totalClicks: 25, humanClicks: null }, null); // 복귀
  const back = await findLinkById(sql, row.id);
  assert.equal(back!.clicks!.totalClicks, 25);
  assert.equal(back!.clicks!.humanClicks, null);
  assert.equal(back!.unavailableAt, null);
  const history = await listClickSnapshots(sql, row.id);
  assert.equal(history.length, 2);
  assert.equal(history[0].totalClicks, 25); // 최신이 먼저
});

test('4) draft 연결 — draftLabel(title 우선), draft 삭제 시 링크는 남고 연결만 풀린다', async () => {
  const content: DraftContent = { posts: [{ text: '링크 연결 테스트', media: [] }] };
  const draftId = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  await updateDraft(sql, draftId, { title: P + '제목' });
  const row = await insertLink(sql, { ...base(P + '4'), draftId });
  assert.equal((await findLinkById(sql, row.id))!.draftLabel, P + '제목');
  const byDraft = await listLinks(sql, { draftId });
  assert.equal(byDraft.length, 1);
  await sql`delete from draft where id = ${draftId}`;
  const after1 = await findLinkById(sql, row.id);
  assert.ok(after1); // on delete set null — 링크·클릭 기록은 남는다(스펙)
  assert.equal(after1!.draftId, null);
});

test('5) 삭제 — 행과 스냅샷만 지워진다(shortio_link_id 관련 동작 없음은 라우트 몫)', async () => {
  const row = await insertLink(sql, base(P + '5'));
  await appendClickSnapshot(sql, row.id, { totalClicks: 1, humanClicks: 1 }, null);
  assert.equal(await deleteLink(sql, row.id), true);
  assert.equal(await findLinkById(sql, row.id), null);
  const snaps = await sql`select id from link_click_snapshot where tracking_link_id = ${row.id}`;
  assert.equal(snaps.length, 0);
  assert.equal(await deleteLink(sql, row.id), false);
});
