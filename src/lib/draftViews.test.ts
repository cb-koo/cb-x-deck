import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftPreviewLine, draftPreviewFull, draftFirstMediaUrl, draftKoLine, draftLabel, sortDrafts, groupByStatus, searchDrafts, filterByProcedure, filterByPeriod, procedureOptions, applyPeriod, formatPeriodLabel, isRangeInverted } from './draftViews.ts';
import type { DraftStatus } from './draftStatus.ts';

const post = (text: string) => ({ posts: [{ text }] });
const postWithMedia = (text: string, media: Array<{ url: string }>) => ({ posts: [{ text, media }] });
const row = (over: Partial<{ id: string; createdAt: string; clientId: string | null; status: DraftStatus }>) => ({
  id: 'x', createdAt: '2026-08-10T00:00:00Z', clientId: null, status: 'draft' as DraftStatus, ...over,
});

test('draftPreviewLine: 편집본 우선, 첫 줄만, 공백 정리', () => {
  assert.equal(draftPreviewLine({ content: post('원문 첫 줄\n둘째 줄'), edited: null }), '원문 첫 줄');
  assert.equal(draftPreviewLine({ content: post('원문'), edited: post('  편집본 첫 줄  \n둘째') }), '편집본 첫 줄');
  assert.equal(draftPreviewLine({ content: { posts: [] }, edited: null }), '');
});

test('draftPreviewFull: 편집본 우선, 전문(자르지 않음), 빈 값은 null — campaignTaskStore.toRow.draftPreview와 같은 게이트', () => {
  assert.equal(draftPreviewFull({ content: post('첫 줄\n둘째 줄'), edited: null }), '첫 줄\n둘째 줄');
  assert.equal(draftPreviewFull({ content: post('원문'), edited: post('편집본\n둘째') }), '편집본\n둘째');
  assert.equal(draftPreviewFull({ content: { posts: [] }, edited: null }), null);
  assert.equal(draftPreviewFull({ content: post('   '), edited: null }), null);
});

test('draftFirstMediaUrl: 첫 포스트 첫 미디어 url, 없으면 null', () => {
  assert.equal(draftFirstMediaUrl({ content: postWithMedia('t', [{ url: 'drafts/a/1.jpg' }]), edited: null }), 'drafts/a/1.jpg');
  assert.equal(draftFirstMediaUrl({ content: postWithMedia('t', []), edited: null }), null);
  assert.equal(draftFirstMediaUrl({ content: { posts: [] }, edited: null }), null);
});

test('draftKoLine: 캐시 없으면 null, 있으면 첫 줄만', () => {
  assert.equal(draftKoLine({ koLatest: null }), null);
  assert.equal(draftKoLine({ koLatest: ['첫 줄\n둘째 줄'] }), '첫 줄');
  assert.equal(draftKoLine({ koLatest: ['  '] }), null);
});

test('draftLabel: 제목 우선 — koTitle이 있으면 kind=title', () => {
  const label = draftLabel({
    title: null,
    koTitle: '생성된 제목',
    koLatest: ['번역본 첫 줄'],
    content: post('원문 첫 줄'),
    edited: null,
  });
  assert.deepEqual(label, { text: '생성된 제목', kind: 'title' });
});

test('draftLabel: 제목 없으면 ko — koLatest 첫 줄이 있으면 kind=ko', () => {
  const label = draftLabel({
    title: null,
    koTitle: null,
    koLatest: ['번역본 첫 줄\n둘째 줄'],
    content: post('원문 첫 줄'),
    edited: null,
  });
  assert.deepEqual(label, { text: '번역본 첫 줄', kind: 'ko' });
});

test('draftLabel: 둘 다 없으면 원문·빈 값은 (내용 없음)', () => {
  const labelWithContent = draftLabel({
    title: null,
    koTitle: null,
    koLatest: null,
    content: post('원문 첫 줄'),
    edited: null,
  });
  assert.deepEqual(labelWithContent, { text: '원문 첫 줄', kind: 'original' });

  const labelEmpty = draftLabel({
    title: null,
    koTitle: null,
    koLatest: null,
    content: { posts: [] },
    edited: null,
  });
  assert.deepEqual(labelEmpty, { text: '(내용 없음)', kind: 'original' });
});

test('draftLabel: 사람이 붙인 title이 자동 koTitle보다 앞선다', () => {
  const label = draftLabel({
    title: '사람이 붙인 이름',
    koTitle: '자동 제목',
    koLatest: ['번역본 첫 줄'],
    content: post('원문 첫 줄'),
    edited: null,
  });
  assert.deepEqual(label, { text: '사람이 붙인 이름', kind: 'title' });
});

test('draftLabel: title이 공백뿐이면 없는 것으로 본다', () => {
  const label = draftLabel({
    title: '   ',
    koTitle: '자동 제목',
    koLatest: null,
    content: post('원문 첫 줄'),
    edited: null,
  });
  assert.deepEqual(label, { text: '자동 제목', kind: 'title' });
});

test('draftLabel: 제목이 둘 다 없으면 기존 폴백 그대로', () => {
  assert.deepEqual(
    draftLabel({ title: null, koTitle: null, koLatest: ['번역 첫 줄'], content: post('원문'), edited: null }),
    { text: '번역 첫 줄', kind: 'ko' });
  assert.deepEqual(
    draftLabel({ title: null, koTitle: null, koLatest: null, content: post('원문 첫 줄'), edited: null }),
    { text: '원문 첫 줄', kind: 'original' });
});

test('sortDrafts: 생성일 내림차순 기본·원본 불변', () => {
  const a = row({ id: 'a', createdAt: '2026-08-01T00:00:00Z' });
  const b = row({ id: 'b', createdAt: '2026-08-09T00:00:00Z' });
  const list = [a, b];
  const sorted = sortDrafts(list, { key: 'createdAt', dir: 'desc' }, () => '');
  assert.deepEqual(sorted.map((x) => x.id), ['b', 'a']);
  assert.deepEqual(list.map((x) => x.id), ['a', 'b']); // 원본 그대로
});

test('sortDrafts: 클라이언트명은 한국어 locale 비교', () => {
  const names: Record<string, string> = { c1: '바른의원', c2: '가온의원' };
  const list = [row({ id: 'a', clientId: 'c1' }), row({ id: 'b', clientId: 'c2' })];
  const sorted = sortDrafts(list, { key: 'client', dir: 'asc' }, (id) => (id ? names[id] : '—'));
  assert.deepEqual(sorted.map((x) => x.id), ['b', 'a']); // 가온 < 바른
});

test('sortDrafts: 상태는 워크플로 순서(초안→…→미사용)', () => {
  const list = [row({ id: 'a', status: 'delivered' }), row({ id: 'b', status: 'draft' }), row({ id: 'c', status: 'review' })];
  const sorted = sortDrafts(list, { key: 'status', dir: 'asc' }, () => '');
  assert.deepEqual(sorted.map((x) => x.id), ['b', 'c', 'a']);
});

test('groupByStatus: 5개 열이 항상 존재하고 열 안은 최신순', () => {
  const g = groupByStatus([
    row({ id: 'old', status: 'draft', createdAt: '2026-08-01T00:00:00Z' }),
    row({ id: 'new', status: 'draft', createdAt: '2026-08-09T00:00:00Z' }),
    row({ id: 'd1', status: 'delivered' }),
  ]);
  assert.deepEqual(g.draft.map((x) => x.id), ['new', 'old']);
  assert.equal(g.delivered.length, 1);
  assert.deepEqual(g.review, []); assert.deepEqual(g.approved, []); assert.deepEqual(g.unused, []);
});

test('searchDrafts: 빈 질의는 전체, 토큰 AND, 대소문자 무시, 4개 필드 대상', () => {
  const d = (over: object) => ({ title: null, koTitle: null, koLatest: null, direction: '', content: { posts: [{ text: '' }] }, edited: null, ...over });
  const list = [
    d({ koTitle: '다운타임 후기형' }),
    d({ koLatest: ['가격 비교 정리'] }),
    d({ content: { posts: [{ text: 'ダウンタイム' }] } }),
    d({ direction: '여름 시즌 Lifting' }),
  ];
  assert.equal(searchDrafts(list, '').length, 4);
  assert.equal(searchDrafts(list, '  ').length, 4);
  assert.deepEqual(searchDrafts(list, '다운타임'), [list[0]]);
  assert.deepEqual(searchDrafts(list, '가격 정리'), [list[1]]);      // 토큰 AND
  assert.deepEqual(searchDrafts(list, 'ダウン'), [list[2]]);
  assert.deepEqual(searchDrafts(list, 'lifting'), [list[3]]);        // 대소문자 무시
  assert.equal(searchDrafts(list, '가격 후기형').length, 0);         // 서로 다른 항목에 분산되면 미매치
});

test('searchDrafts: 편집본이 있으면 편집본 기준', () => {
  const x = { title: null, koTitle: null, koLatest: null, direction: '',
    content: { posts: [{ text: '원문에만 있는말' }] }, edited: { posts: [{ text: '편집본' }] } };
  assert.equal(searchDrafts([x], '원문에만').length, 0);
  assert.equal(searchDrafts([x], '편집본').length, 1);
});

test('searchDrafts: 사람이 붙인 제목도 검색 대상이다', () => {
  const rows = [
    { title: '보톡스 다운타임 훅', koTitle: null, koLatest: null, direction: '',
      content: { posts: [{ text: '本文' }] }, edited: null },
    { title: null, koTitle: '자동 제목', koLatest: null, direction: '',
      content: { posts: [{ text: '다른 본문' }] }, edited: null },
  ];
  assert.equal(searchDrafts(rows, '다운타임').length, 1);
  assert.equal(searchDrafts(rows, '보톡스 훅').length, 1, '공백 토큰 AND도 제목 안에서 동작');
  assert.equal(searchDrafts(rows, '자동').length, 1, '자동 제목 검색은 그대로');
});

test('filterByProcedure: 빈 이름은 전체, 지정 시 포함 항목만', () => {
  const a = { procedureNames: ['리프팅', '보톡스'] }, b = { procedureNames: [] };
  assert.equal(filterByProcedure([a, b], '').length, 2);
  assert.deepEqual(filterByProcedure([a, b], '리프팅'), [a]);
});

test('filterByPeriod: 자정·N일 경계', () => {
  const now = Date.parse('2026-08-10T15:00:00+09:00');
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const mk = (t: number) => ({ createdAt: new Date(t).toISOString() });
  const justBefore = mk(midnight.getTime() - 60_000), justAfter = mk(midnight.getTime() + 60_000);
  assert.deepEqual(filterByPeriod([justBefore, justAfter], 'today', now), [justAfter]);
  const eightDays = mk(now - 8 * 86_400_000), sixDays = mk(now - 6 * 86_400_000);
  assert.deepEqual(filterByPeriod([eightDays, sixDays], '7d', now), [sixDays]);
  assert.equal(filterByPeriod([eightDays, sixDays], 'all', now).length, 2);
});

test('procedureOptions: 유니크·가나다 정렬', () => {
  assert.deepEqual(procedureOptions([
    { procedureNames: ['보톡스', '리프팅'] }, { procedureNames: ['리프팅', '가슴성형'] },
  ]), ['가슴성형', '리프팅', '보톡스']);
});

test('applyPeriod: preset은 filterByPeriod 위임과 동일', () => {
  const now = Date.parse('2026-08-10T15:00:00+09:00');
  const rows = [{ createdAt: new Date(now - 8 * 86_400_000).toISOString() }, { createdAt: new Date(now - 1000).toISOString() }];
  assert.deepEqual(applyPeriod(rows, { kind: 'preset', preset: '7d' }, now), filterByPeriod(rows, '7d', now));
  assert.equal(applyPeriod(rows, { kind: 'preset', preset: 'all' }, now).length, 2);
});

test('applyPeriod: range는 양끝 날짜 포함(로컬 자정 경계)', () => {
  const day = (s: string, h: number) => ({ createdAt: new Date(new Date(`${s}T00:00:00`).getTime() + h * 3_600_000).toISOString() });
  const rows = [day('2026-08-01', 12), day('2026-08-05', 23), day('2026-08-06', 1)];
  const out = applyPeriod(rows, { kind: 'range', from: '2026-08-01', to: '2026-08-05' }, 0);
  assert.deepEqual(out, [rows[0], rows[1]]); // 8/6 01시는 제외, 8/5 23시는 포함
});

test('applyPeriod: 단측 range와 역전 range', () => {
  const rows = [{ createdAt: '2026-08-01T05:00:00.000Z' }, { createdAt: '2026-08-09T05:00:00.000Z' }];
  assert.equal(applyPeriod(rows, { kind: 'range', from: '', to: '' }, 0).length, 2);
  assert.equal(applyPeriod(rows, { kind: 'range', from: '2026-08-05', to: '' }, 0).length, 1);
  assert.equal(applyPeriod(rows, { kind: 'range', from: '2026-08-09', to: '2026-08-01' }, 0).length, 2); // 역전은 미적용(전체)
  assert.equal(isRangeInverted({ kind: 'range', from: '2026-08-09', to: '2026-08-01' }), true);
  assert.equal(isRangeInverted({ kind: 'range', from: '2026-08-01', to: '2026-08-09' }), false);
});

test('formatPeriodLabel: 프리셋·범위·단측 표기', () => {
  assert.equal(formatPeriodLabel({ kind: 'preset', preset: 'all' }), '전체 기간');
  assert.equal(formatPeriodLabel({ kind: 'preset', preset: '7d' }), '최근 7일');
  assert.equal(formatPeriodLabel({ kind: 'range', from: '2026-08-01', to: '2026-08-10' }), '8.1 – 8.10');
  assert.equal(formatPeriodLabel({ kind: 'range', from: '2026-08-01', to: '' }), '8.1 이후');
  assert.equal(formatPeriodLabel({ kind: 'range', from: '', to: '' }), '전체 기간');
});
