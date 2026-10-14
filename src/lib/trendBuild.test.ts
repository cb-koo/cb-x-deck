import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrendView, showKeyword, type TrendProcedureInput, type TrendKeywordInput } from './trendBuild.ts';
import { ownerResolver } from './trendStore.ts';

const MONTHS = Array.from({ length: 24 }, (_, i) => `${2024 + Math.floor((i + 8) / 12)}-${String(((i + 8) % 12) + 1).padStart(2, '0')}`);
const s = (v: number) => Array(24).fill(v) as number[];
const P = (id: string, name: string, jp: string, extra: Partial<TrendProcedureInput> = {}): TrendProcedureInput =>
  ({ id, major: '초음파 리프팅', majorOrder: 1, middle: 'HIFU', name, kr: name, jp, en: '', ...extra });
const K = (text: string, procedureId: string, source: TrendKeywordInput['source'], v: number | null, extra: Partial<TrendKeywordInput> = {}): TrendKeywordInput =>
  ({ text, procedureId, source, series: v === null ? null : s(v), ...extra });
const build = (procedures: TrendProcedureInput[], keywords: TrendKeywordInput[]) =>
  buildTrendView({ market: 'jp', fetchedAt: '2026-10-14', months: MONTHS, procedures, keywords });

test('같은 분류·같은 시술명은 한 묶음(울쎄라 3행) — 첫 행 id로, 검색어 구성은 행마다', () => {
  const doc = build(
    [P('p29', '울쎄라', 'ウルセラ'), P('p203', '울쎄라', 'ウルセラリフト')],
    [K('ウルセラ', 'p29', 'name', 1000), K('ウルセラ 効果', 'p29', 'template', 200), K('ウルセラリフト', 'p203', 'name', 100)],
  );
  assert.deepEqual(Object.keys(doc.intent), ['p29']);
  assert.equal(doc.intent.p29.total[0], 1300);
  assert.deepEqual(doc.intent.p29.members?.map((m) => m.total[0]), [1200, 100]);
});

test('태그 — 한국 조합은 한국, 사람이 고친 태그가 규칙보다 먼저', () => {
  const doc = build([P('p1', '포텐자', 'ポテンツァ')], [
    K('ポテンツァ', 'p1', 'name', 1000), K('韓国 ポテンツァ', 'p1', 'korea', 50),
    K('ポテンツァ 効果', 'p1', 'template', 300), K('ポテンツァ 化粧品', 'p1', 'idea', 80, { intentOverride: 'effect' }),
  ]);
  const it = doc.intent.p1;
  assert.equal(it.korea[0], 50);
  assert.equal(it.top.effect?.[0][0], 'ポテンツァ効果');
  assert.equal(it.top.effect?.length, 2);  // 화장품(규칙상 제외)이지만 사람이 효과로 고침
});

test('검색 결과로 확인한 동음이의 — 시술명 단독은 빼고 다른 뜻 표시', () => {
  const doc = build([P('p86', '제네시스', 'ジェネシス', { serp: { derm: 1, med: 0, self: 0, unrelated: 19, note: '자동차' } })], [
    K('ジェネシス', 'p86', 'name', 40000), K('ジェネシス 効果', 'p86', 'template', 4000),
  ]);
  assert.equal(doc.intent.p86.total[0], 4000);
  assert.equal(doc.intent.p86.ambiguous, true);
  assert.equal(doc.intent.p86.serp?.note, '자동차');
});

test('시술명 검색량 — 값 없음(null)은 그대로 null, 시트 중복 행도 같은 값', () => {
  const doc = build([P('p1', 'A', 'エラボトックス'), P('p2', 'A', 'エラ ボトックス'), P('p3', 'B', 'ミラドライ')],
    [K('エラボトックス', 'p1', 'name', 500), K('ミラドライ', 'p3', 'name', null), K('ミラドライ 値段', 'p3', 'template', 90)]);
  assert.deepEqual(doc.procedures.map((p) => p.volumes?.[0] ?? null), [500, 500, null]);
  assert.equal(doc.intent.p3.total[0], 90);
});

test('숨긴 시술은 빠진다', () => {
  const doc = build([P('p1', 'A', 'アー'), P('p2', 'B', 'ビー', { hidden: true })], [K('アー', 'p1', 'name', 100), K('ビー', 'p2', 'name', 100)]);
  assert.deepEqual(doc.procedures.map((p) => p.id), ['p1']);
  assert.deepEqual(Object.keys(doc.intent), ['p1']);
});

test('검색어 주인 — 가장 긴 시술 이름', () => {
  const owner = ownerResolver([{ id: 'p1', jp: 'ボトックス' }, { id: 'p2', jp: 'エラボトックス' }]);
  assert.equal(owner('エラ ボトックス 値段'), 'p2');
  assert.equal(owner('ボトックス 効果'), 'p1');
  assert.equal(owner('ヒアルロン酸'), null);
});

test('화면 표기 — 일본어 사이 띄어쓰기만 지운다', () => {
  assert.equal(showKeyword('リジュラン 効果'), 'リジュラン効果');
  assert.equal(showKeyword('ipl 光 治療'), 'ipl 光治療');
});
