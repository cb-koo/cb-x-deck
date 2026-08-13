import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type postgres from 'postgres';
import { getSql } from './db.ts';
import { insertDraft, updateDraft, getDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import type { DraftStatus } from './draftStatus.ts';
import { ensureInfluencer, findByHandle, getInfluencerDetail } from './influencerStore.ts';
import type { InfluencerLogRow } from './influencerStore.ts';
import { syncInfluencerOnDraftUpdate, draftLogTitle } from './influencerSync.ts';

const sql = getSql();
// 핸들·direction 접두어 — 병렬 실행/실 DB 오염 방지. 소문자로 시작해야 lower 정리 쿼리가 맞아떨어진다.
const P = 'tsyn' + process.pid;
const content: DraftContent = { posts: [{ text: '正直迷ってた。\n\nでも良かった。', media: [] }] };

after(async () => {
  // FK 순서: 원고 먼저(배정 해제로 handle이 null이 된 것은 direction으로), 그 다음 인플루언서(로그는 cascade)
  await sql`delete from draft where lower(influencer_handle) like ${P.toLowerCase() + '%'}`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from influencer where lower(handle) like ${P.toLowerCase() + '%'}`;
  await sql.end();
});

async function newDraft(tag: string, handle?: string): Promise<string> {
  const id = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + tag, format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  if (handle !== undefined) await updateDraft(sql, id, { influencerHandle: handle });
  return id;
}

// 라우트와 같은 순서·같은 트랜잭션: updateDraft → syncInfluencerOnDraftUpdate
async function patchDraft(
  id: string, patch: { influencerHandle?: string | null; status?: DraftStatus },
): Promise<void> {
  const before = await getDraft(sql, id);
  assert.ok(before, 'before 원고가 있어야 한다');
  await sql.begin(async (tx) => {
    const tsql = tx as unknown as postgres.Sql;
    await updateDraft(tsql, id, patch);
    await syncInfluencerOnDraftUpdate(tsql, {
      before, influencerHandle: patch.influencerHandle, status: patch.status, actorId: null,
    });
  });
}

async function logsOf(handle: string): Promise<InfluencerLogRow[]> {
  const row = await findByHandle(sql, handle);
  if (!row) return [];
  return (await getInfluencerDetail(sql, row.id))!.logs;
}

const events = (ls: InfluencerLogRow[]) => ls.map((l) => l.eventType).sort();

test('a) 미배정 → 배정: 명부에 없던 핸들이 자동 등록되고 draft_assigned 1건', async () => {
  const h = P + 'Aone';
  const draftId = await newDraft('a');
  assert.equal(await findByHandle(sql, h), null, '시작 시점엔 명부에 없다');

  await patchDraft(draftId, { influencerHandle: h });

  const row = await findByHandle(sql, h);
  assert.ok(row, '배정이 인플루언서 행을 자동 생성한다');
  const ls = await logsOf(h);
  assert.equal(ls.length, 1);
  assert.equal(ls[0].kind, 'auto');
  assert.equal(ls[0].eventType, 'draft_assigned');
  assert.equal(ls[0].draftId, draftId);
  assert.equal(ls[0].draftTitle, '正直迷ってた。', '로그에 제목 스냅샷이 박힌다');
  assert.equal((await getDraft(sql, draftId))!.influencerHandle, h);
});

test('b) 배정 → 해제(null): draft_unassigned 1건, 인플루언서 행은 남는다', async () => {
  const h = P + 'Btwo';
  await ensureInfluencer(sql, h, null);
  const draftId = await newDraft('b', h);

  await patchDraft(draftId, { influencerHandle: null });

  const ls = await logsOf(h);
  assert.equal(ls.length, 1);
  assert.equal(ls[0].eventType, 'draft_unassigned');
  assert.equal(ls[0].draftId, draftId);
  assert.ok(await findByHandle(sql, h), '해제는 명부에서 사람을 지우지 않는다');
  assert.equal((await getDraft(sql, draftId))!.influencerHandle, null);
});

test('c) A → B 교체: A에 unassigned, B에 assigned (B는 자동 등록)', async () => {
  const a = P + 'Cfrom';
  const b = P + 'Cto';
  await ensureInfluencer(sql, a, null);
  const draftId = await newDraft('c', a);
  assert.equal(await findByHandle(sql, b), null);

  await patchDraft(draftId, { influencerHandle: b });

  const la = await logsOf(a);
  assert.equal(la.length, 1);
  assert.equal(la[0].eventType, 'draft_unassigned');
  assert.equal(la[0].draftId, draftId);

  assert.ok(await findByHandle(sql, b), 'B가 자동 등록된다');
  const lb = await logsOf(b);
  assert.equal(lb.length, 1);
  assert.equal(lb[0].eventType, 'draft_assigned');
  assert.equal(lb[0].draftId, draftId);
});

test('d) 대소문자만 다른 재배정(abc → ABC)은 같은 사람 — 로그 0건', async () => {
  const h = P + 'dcase';
  await ensureInfluencer(sql, h, null);
  const draftId = await newDraft('d', h);

  await patchDraft(draftId, { influencerHandle: h.toUpperCase() });

  assert.deepEqual(await logsOf(h), [], '표기만 바뀐 재배정은 기록하지 않는다');
});

test('e) status delivered 전이는 draft_delivered 1건, 이미 delivered면 추가 로그 없음', async () => {
  const h = P + 'Edel';
  await ensureInfluencer(sql, h, null);
  const draftId = await newDraft('e', h);

  await patchDraft(draftId, { status: 'delivered' });
  const first = await logsOf(h);
  assert.equal(first.length, 1);
  assert.equal(first[0].eventType, 'draft_delivered');
  assert.equal(first[0].draftId, draftId);
  assert.equal(first[0].draftTitle, '正直迷ってた。');

  // 이미 delivered인 원고를 다시 저장 — 전이가 아니므로 기록할 사실이 없다
  await patchDraft(draftId, { status: 'delivered' });
  assert.equal((await logsOf(h)).length, 1, '재저장은 로그를 늘리지 않는다');
});

test('f) 명부에 없는 핸들의 해제: 로그도 행 생성도 없다 (등록은 배정에서만)', async () => {
  const ghost = P + 'Fghost';
  const draftId = await newDraft('f', ghost); // 명부 등록 없이 배정 컬럼만 채운 과거 데이터
  assert.equal(await findByHandle(sql, ghost), null);

  await patchDraft(draftId, { influencerHandle: null });

  assert.equal(await findByHandle(sql, ghost), null, '해제는 행을 만들면서까지 기록하지 않는다');
  assert.equal((await getDraft(sql, draftId))!.influencerHandle, null);
});

test('g) 배정 + delivered 동시 PATCH: assigned와 delivered 둘 다 기록', async () => {
  const h = P + 'Gboth';
  const draftId = await newDraft('g');

  await patchDraft(draftId, { influencerHandle: h, status: 'delivered' });

  const ls = await logsOf(h);
  assert.equal(ls.length, 2);
  assert.deepEqual(events(ls), ['draft_assigned', 'draft_delivered']);
  assert.ok(ls.every((l) => l.draftId === draftId && l.kind === 'auto'));
});

test('h) draftLogTitle: ko_title 우선 · 없으면 최신 본문 첫 줄 60자', () => {
  const posts = (text: string) => ({ posts: [{ text, media: [] }] }) as DraftContent;
  assert.equal(
    draftLogTitle({ koTitle: '한국어 제목', edited: null, content: posts('本文') }), '한국어 제목',
  );
  assert.equal(
    draftLogTitle({ koTitle: null, edited: posts('편집본 첫 줄\n둘째 줄'), content: posts('원본') }),
    '편집본 첫 줄', '최신 버전(edited)이 기준',
  );
  const long = 'あ'.repeat(80);
  assert.equal(draftLogTitle({ koTitle: null, edited: null, content: posts(long) }), 'あ'.repeat(60) + '…');
  assert.equal(draftLogTitle({ koTitle: null, edited: null, content: { posts: [] } as DraftContent }), '');
});
