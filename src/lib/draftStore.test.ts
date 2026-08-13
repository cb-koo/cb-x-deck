import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import {
  insertDraft, listDrafts, getDraft, updateDraft, removeDraft, listInfluencerHandles,
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

test('listInfluencerHandles — 소문자 중복 제거·대표 표기는 최신·미배정 제외·소문자 정렬', async () => {
  const H = 'zzt' + process.pid; // 실제 DB를 공유하므로 남의 행과 섞이지 않을 접두사
  const mk = async (dir: string) => insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + dir, format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });

  const oldId = await mk('배정-옛표기');
  const newId = await mk('배정-새표기');
  const alphaId = await mk('배정-알파');
  const noneId = await mk('미배정');

  await updateDraft(sql, oldId, { influencerHandle: H + 'Bravo' });
  await updateDraft(sql, newId, { influencerHandle: H + 'bravo' }); // 같은 사람, 대소문자만 다름
  await updateDraft(sql, alphaId, { influencerHandle: H + 'alpha' });
  // 대표 표기 판정이 삽입 순서가 아니라 created_at에 달려 있음을 명시 (같은 트랜잭션이면 now()가 동률)
  await sql`update draft set created_at = '2020-01-01' where id = ${oldId}`;
  await sql`update draft set created_at = '2021-01-01' where id = ${newId}`;

  const opts = await listInfluencerHandles(sql);
  const mine = opts.filter((o) => o.handle.toLowerCase().startsWith(H));
  // 둘로 합쳐지고(중복 제거), bravo의 대표 표기는 최신인 소문자, 정렬은 lower 기준 alpha < bravo,
  // 미배정 행은 애초에 후보에 없다(길이 2가 증명)
  assert.deepEqual(mine.map((o) => o.handle), [H + 'alpha', H + 'bravo']);
  assert.equal(mine[0].name, undefined); // 이름은 인플루언서 DB가 생기면 채워질 자리

  for (const id of [oldId, newId, alphaId, noneId]) await removeDraft(sql, id);
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
