import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientSummary, procedureSummary } from './clientSummary.ts';
import type { ClientRow, ProcedureRow } from './clientStore.ts';

function client(over: Partial<ClientRow> = {}): ClientRow {
  return { id: 'c1', name: '가온피부과', info: '강남역 3번 출구', bannedPhrases: [], position: 0,
           updatedAt: '2026-08-09T00:00:00.000Z', landingUrl: '', nameEn: '', ...over };
}
function proc(over: Partial<ProcedureRow> = {}): ProcedureRow {
  return { id: 'p1', clientId: 'c1', name: '보톡스', description: '', effectPhrases: '', bannedPhrases: [], position: 0, ...over };
}

test('clientSummary: 시술 수와 금지 표현 합산(공통+시술별)', () => {
  const s = clientSummary(
    client({ bannedPhrases: ['완치', '부작용 없음'] }),
    [proc({ bannedPhrases: ['주름 제거'] }), proc({ id: 'p2', bannedPhrases: ['동안', '반영구'] })],
  );
  assert.equal(s.procedureCount, 2);
  assert.equal(s.bannedTotal, 5);
  assert.equal(s.infoMissing, false);
});

test('clientSummary: 공백뿐인 info는 미입력으로 판정', () => {
  assert.equal(clientSummary(client({ info: '  \n ' }), []).infoMissing, true);
  assert.equal(clientSummary(client({ info: '' }), []).infoMissing, true);
});

test('procedureSummary: 전부 비어 있으면 empty + 안내 문구', () => {
  const s = procedureSummary(proc());
  assert.equal(s.empty, true);
  assert.equal(s.text, '아직 비어 있어요 — 원고에 반영할 내용이 없어요');
});

test('procedureSummary: 설명·효과 표현 모두 입력 + 금지 2건', () => {
  const s = procedureSummary(proc({ description: '이마 주사', effectPhrases: '주름 완화', bannedPhrases: ['주름 제거', '동안'] }));
  assert.equal(s.empty, false);
  assert.equal(s.text, '설명·효과 표현 입력됨 · 금지 2건');
});

test('procedureSummary: 설명만 입력 (효과 표현 비어 있음, 금지 1건)', () => {
  const s = procedureSummary(proc({ description: '이마 주사', bannedPhrases: ['동안'] }));
  assert.equal(s.text, '설명 입력됨 · 효과 표현 비어 있음 · 금지 1건');
});

test('procedureSummary: 금지 표현만 있으면 설명·효과는 비어 있음으로 묶어 표기', () => {
  const s = procedureSummary(proc({ bannedPhrases: ['동안'] }));
  assert.equal(s.empty, false);
  assert.equal(s.text, '설명·효과 표현 비어 있음 · 금지 1건');
});

test('procedureSummary: 금지 0건이면 금지 항목 생략', () => {
  const s = procedureSummary(proc({ description: '이마 주사', effectPhrases: '주름 완화' }));
  assert.equal(s.text, '설명·효과 표현 입력됨');
});

test('procedureSummary: 공백뿐인 설명은 비어 있음으로 판정', () => {
  const s = procedureSummary(proc({ description: '  ', effectPhrases: '주름 완화' }));
  assert.equal(s.text, '설명 비어 있음 · 효과 표현 입력됨');
});
