import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateLine, searchDraftCandidates } from './draftPickView.ts';
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
