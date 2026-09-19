import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateLine, searchDraftCandidates, composerCanSave } from './draftPickView.ts';
import type { DraftRow } from './draftStore.ts';

const mk = (p: Partial<DraftRow>): DraftRow => ({
  id: 'd1', clientId: null, clientName: null, procedureNames: [], direction: '', format: 'single',
  referenceMode: 'off', refs: [], content: { posts: [{ text: '첫 줄이에요\n둘째 줄', media: [] }] }, edited: null,
  history: [], translation: null, koLatest: null, title: null, koTitle: null, dismissedFlags: [],
  status: 'draft', influencerHandle: null, taskId: null, taskType: null,
  campaignId: null, campaignName: null, campaignCode: null, scheduledOn: null, cost: null,
  batchId: null, variantIndex: null, model: null, createdAt: '2026-09-19T00:00:00.000Z', member: null,
  ...(p as object),
} as DraftRow);

test('1) 후보 한 줄 — 제목·본문 첫 줄·형식/시안 표시, edited가 있으면 그쪽을 본다', () => {
  assert.deepEqual(candidateLine(mk({ title: '치아미백 후기' })), { title: '치아미백 후기', body: '첫 줄이에요', meta: '단문' });
  assert.equal(candidateLine(mk({ format: 'thread', content: { posts: [{ text: 'a', media: [] }, { text: 'b', media: [] }] } })).meta, '스레드 2');
  assert.equal(candidateLine(mk({ variantIndex: 1 })).meta, '단문 · 시안 B');
  assert.equal(candidateLine(mk({ edited: { posts: [{ text: '고친 첫 줄', media: [] }] } })).body, '고친 첫 줄');
});

test('2) 검색 — 제목·본문 첫 줄, 대소문자 무관, 공백만이면 전부', () => {
  const rows = [mk({ id: 'a', title: '치아미백' }), mk({ id: 'b', title: null, content: { posts: [{ text: 'Whitening 3일차', media: [] }] } })];
  assert.deepEqual(searchDraftCandidates(rows, '미백').map((d) => d.id), ['a']);
  assert.deepEqual(searchDraftCandidates(rows, 'whitening').map((d) => d.id), ['b']);
  assert.deepEqual(searchDraftCandidates(rows, '   ').map((d) => d.id), ['a', 'b']);
});

test('3) 컴포저 저장 판정 — 빈 칸만 있으면 못 저장, 한 칸이라도 내용이 있으면 저장, 글자 수 초과면 못 저장', () => {
  assert.equal(composerCanSave([{ text: '', media: [], uploading: 0 }]), false);
  assert.equal(composerCanSave([{ text: '   ', media: [], uploading: 0 }]), false);
  assert.equal(composerCanSave([{ text: '올릴 글', media: [], uploading: 0 }]), true);
  assert.equal(composerCanSave([{ text: '올릴 글', media: [], uploading: 0 }, { text: '', media: [], uploading: 0 }]), false);   // 스레드 중간이 비면 안 된다
  assert.equal(composerCanSave([{ text: 'あ'.repeat(200), media: [], uploading: 0 }]), false);                      // 전각 200자 = 가중치 400 > 280
});

test('4) 컴포저 저장 판정 — 뒤 공백은 트림해서 잰다(저장이 trim을 보내므로 판정도 trim을 봐야 한다)', () => {
  // 전각 140자(가중치 280, 상한 정확히)에 공백 3칸을 더하면 트림 전엔 283으로 상한을 넘는 것처럼 보인다.
  assert.equal(composerCanSave([{ text: `${'あ'.repeat(140)}   `, media: [], uploading: 0 }]), true);
  // 공백만 있는 칸은 트림하면 빈 칸이므로 여전히 저장할 수 없다.
  assert.equal(composerCanSave([{ text: '올릴 글', media: [], uploading: 0 }, { text: '   ', media: [], uploading: 0 }]), false);
});
