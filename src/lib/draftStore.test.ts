import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import {
  insertDraft, listDrafts, getDraft, updateDraft, removeDraft,
  updateDraftsBulk, removeDraftsBulk,
} from './draftStore.ts';
import { createClient, deleteClient } from './clientStore.ts';
import type { DraftContent } from './draftTypes.ts';

const sql = getSql();
const P = 'test-dr-' + process.pid + '-';
const content: DraftContent = { posts: [{ text: '正直迷ってた。\n\nでも良かった。', media: [] }] };

after(async () => {
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

test('insert→list→get→update(edited·dismissed)→remove 왕복 + 스냅샷', async () => {
  const c = await createClient(sql, P + 'A클리닉');
  const id = await insertDraft(sql, {
    clientId: c.id, clientName: c.name, procedureNames: ['보톡스'],
    direction: P + '다운타임 강조', format: 'single', referenceMode: 'both',
    refs: [{ tweetId: 't1', handle: 'mika', name: 'みか', excerpt: '正直迷ってた',
             memos: [{ member: '박구건', text: '앵글이 신선' }] }],
    content, model: 'claude-opus-5', memberId: null,
  });

  const list = await listDrafts(sql, { clientId: c.id });
  assert.equal(list.length, 1);
  assert.equal(list[0].clientName, c.name);
  assert.deepEqual(list[0].procedureNames, ['보톡스']);
  assert.equal(list[0].refs[0].memos[0].text, '앵글이 신선');
  assert.equal(list[0].edited, null);
  assert.equal(list[0].model, 'claude-opus-5');

  // 클라이언트 삭제 후에도 스냅샷으로 재현 (client_id는 set null)
  await deleteClient(sql, c.id);
  const afterDel = await getDraft(sql, id);
  assert.equal(afterDel!.clientId, null);
  assert.equal(afterDel!.clientName, c.name);

  const edited: DraftContent = { posts: [{ text: '修正版', media: [] }] };
  await updateDraft(sql, id, { edited, dismissedFlags: ['yakkiho:効果がある'] });
  const got = await getDraft(sql, id);
  assert.deepEqual(got!.edited, edited);
  assert.deepEqual(got!.content, content);          // 원본 불변
  assert.deepEqual(got!.dismissedFlags, ['yakkiho:効果がある']);
  assert.deepEqual(got!.history, []);               // 기본값
  assert.equal(got!.translation, null);

  // 버전 이력 + 번역 캐시(버전별 맵) 왕복 (부분 패치 — 서로를 덮지 않음)
  await updateDraft(sql, id, { history: [content] });
  await updateDraft(sql, id, { translation: { h1: ['수정판'], h2: ['원본판'] } });
  const got2 = await getDraft(sql, id);
  assert.deepEqual(got2!.history, [content]);
  assert.deepEqual(got2!.translation, { h1: ['수정판'], h2: ['원본판'] });
  assert.deepEqual(got2!.edited, edited);           // edited는 그대로

  await removeDraft(sql, id);
  assert.equal(await getDraft(sql, id), null);
});

test('status — 기본값·패치·필터·부분 패치 독립', async () => {
  const id = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '상태 왕복', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });

  assert.equal((await getDraft(sql, id))!.status, 'draft');       // DB 기본값

  await updateDraft(sql, id, { status: 'review' });
  assert.equal((await getDraft(sql, id))!.status, 'review');

  const listed = await listDrafts(sql, { status: 'review' });
  assert.ok(listed.some((d) => d.id === id));
  const excluded = await listDrafts(sql, { status: 'delivered' });
  assert.ok(!excluded.some((d) => d.id === id));

  // 다른 필드 패치가 status를 덮지 않는다 (coalesce 부분 패치)
  await updateDraft(sql, id, { dismissedFlags: ['yakkiho:効果がある'] });
  assert.equal((await getDraft(sql, id))!.status, 'review');

  // DB CHECK — 유효하지 않은 상태는 거부
  await assert.rejects(sql`update draft set status = 'bogus' where id = ${id}`);

  await removeDraft(sql, id);
});

test('batch — 기본 null·삽입 왕복', async () => {
  const soloId = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '단일', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  const solo = await getDraft(sql, soloId);
  assert.equal(solo!.batchId, null);          // 단일 생성은 batch 없음 (기존 행과 동일)
  assert.equal(solo!.variantIndex, null);

  const batchId = crypto.randomUUID();
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    ids.push(await insertDraft(sql, {
      clientId: null, clientName: null, procedureNames: [],
      direction: P + '배치', format: 'single', referenceMode: 'off', refs: [],
      content, model: null, memberId: null, batchId, variantIndex: i,
    }));
  }
  const a = await getDraft(sql, ids[0]);
  const b = await getDraft(sql, ids[1]);
  assert.equal(a!.batchId, batchId);
  assert.equal(a!.variantIndex, 0);
  assert.equal(b!.batchId, batchId);
  assert.equal(b!.variantIndex, 1);

  for (const id of [soloId, ...ids]) await removeDraft(sql, id);
});

// 배정 patch의 세 가지 의미를 각각 고정한다 — 다른 컬럼과 같은 coalesce로 "일관성 있게" 되돌리면
// 해제(null)가 조용히 무시되므로, 그 회귀를 여기서 잡는다.
test('influencer — 배정 저장·미지정(undefined) 보존·해제(null)', async () => {
  const id = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '배정 왕복', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });

  assert.equal((await getDraft(sql, id))!.influencerHandle, null); // 생성 시점에는 미배정

  await updateDraft(sql, id, { influencerHandle: 'Hadakan__' });
  assert.equal((await getDraft(sql, id))!.influencerHandle, 'Hadakan__'); // 사용자가 친 대소문자 그대로

  // undefined = 컬럼을 건드리지 않음 — 다른 필드만 패치해도 배정이 남는다
  await updateDraft(sql, id, { status: 'review' });
  assert.equal((await getDraft(sql, id))!.influencerHandle, 'Hadakan__');

  // null = 배정 해제. coalesce였다면 기존값이 살아남아 이 단언이 깨진다
  await updateDraft(sql, id, { influencerHandle: null });
  const cleared = await getDraft(sql, id);
  assert.equal(cleared!.influencerHandle, null);
  assert.equal(cleared!.status, 'review'); // 해제가 다른 컬럼을 함께 지우지 않았다

  await removeDraft(sql, id);
});

test('title: 설정·유지·지움 — 본문을 편집해도 살아남는다', async () => {
  const id = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + 'title 왕복', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });

  // 처음엔 없다
  assert.equal((await getDraft(sql, id))!.title, null);

  // 설정
  await updateDraft(sql, id, { title: '보톡스 다운타임 훅' });
  assert.equal((await getDraft(sql, id))!.title, '보톡스 다운타임 훅');

  // 본문을 편집해도 제목은 그대로 (ko_title과 다른 지점 — 해시 검사를 타지 않는다)
  await updateDraft(sql, id, { edited: { posts: [{ text: '고친 본문', media: [] }] } });
  assert.equal((await getDraft(sql, id))!.title, '보톡스 다운타임 훅');

  // 건드리지 않으면 유지
  await updateDraft(sql, id, { status: 'review' });
  assert.equal((await getDraft(sql, id))!.title, '보톡스 다운타임 훅');

  // 빈 문자열 = 지움
  await updateDraft(sql, id, { title: '' });
  assert.equal((await getDraft(sql, id))!.title, null);

  await removeDraft(sql, id);
});

// 직접 쓰기(설계 §A-4 각주) — 지금까지 title은 삽입 후 PATCH로만 들어왔다. 작성 모달은
// 저장 한 번에 제목까지 넣어야 하므로 insertDraft 시점부터 받는다.
test('insertDraft: title 옵션 — 삽입 시점부터 저장되고, 생략하면 기존과 동일하게 null', async () => {
  const withTitle = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '삽입시 제목', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null, title: '직접 쓴 제목',
  });
  assert.equal((await getDraft(sql, withTitle))!.title, '직접 쓴 제목');

  // 옵션을 안 넘긴 기존 호출부(generate.ts)는 지금처럼 null이어야 한다 — 무변경 통과가 요구사항
  const withoutTitle = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '삽입시 제목 없음', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  assert.equal((await getDraft(sql, withoutTitle))!.title, null);

  await removeDraft(sql, withTitle);
  await removeDraft(sql, withoutTitle);
});

test('벌크: 여러 건 상태·배정 한 번에, 그리고 한 번에 삭제', async () => {
  const mk = () => insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '벌크', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  const ids = [await mk(), await mk(), await mk()];

  await updateDraftsBulk(sql, ids, { status: 'approved' });
  for (const id of ids) assert.equal((await getDraft(sql, id))!.status, 'approved');

  // 배정: 상태는 건드리지 않는다(undefined = 유지)
  await updateDraftsBulk(sql, ids, { influencerHandle: 'mika_jp' });
  for (const id of ids) {
    const got = (await getDraft(sql, id))!;
    assert.equal(got.influencerHandle, 'mika_jp');
    assert.equal(got.status, 'approved');
  }

  // null = 배정 해제
  await updateDraftsBulk(sql, ids, { influencerHandle: null });
  assert.equal((await getDraft(sql, ids[0]))!.influencerHandle, null);

  // 빈 배열은 아무 것도 하지 않는다 (SQL을 쏘지 않는다)
  await updateDraftsBulk(sql, [], { status: 'unused' });
  assert.equal((await getDraft(sql, ids[0]))!.status, 'approved');

  await removeDraftsBulk(sql, ids);
  for (const id of ids) assert.equal(await getDraft(sql, id), null);
});

test('listDrafts: limit이 실제로 개수를 자른다', async () => {
  const mk = () => insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + 'limit', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  const ids = [await mk(), await mk(), await mk()];

  const two = await listDrafts(sql, { limit: 2 });
  assert.equal(two.length, 2);
  // 최신순이므로 마지막에 만든 것이 먼저 온다
  assert.equal(two[0].id, ids[2]);

  const many = await listDrafts(sql, { limit: 1000 });
  assert.ok(many.length >= 3, '상한을 크게 주면 최소한 방금 만든 3건은 들어온다');

  await removeDraftsBulk(sql, ids);
});
