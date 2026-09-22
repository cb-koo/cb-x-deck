import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_FLOW_FILTER, matchesFlowFilter, matchesSearch, matchesExtra, filterCount, filterSummary,
  nextSort, sortFlowRows, dateCell, draftCell, costCell, flowFooter, flowStats, taskPerfExtra, settleWaitCount, restoreMessage, PANEL_FIELD_ORDER,
  costConfirmScenario, detachConfirmMessage,
} from './campaignFlowView.ts';
import type { CampaignTaskItem } from './campaignStore.ts';

const T = '2026-09-18';
let n = 0;
const mk = (p: Partial<CampaignTaskItem>): CampaignTaskItem => ({
  id: `t${++n}`, campaignId: 'c', influencerHandle: null, type: 'post', draftId: null, targetTaskId: null, targetTweetUrl: null,
  postUrl: null, postedAt: null, postedSource: null, removedAt: null, removedReason: '', scheduledOn: null, visitOn: null, cost: null, note: '',
  proof: null, cancelledAt: null, cancelReason: null, cancelNote: '', cancelledDraftId: null, cancelledDraftTitle: null,
  createdAt: `2026-09-01T00:00:${String(n).padStart(2, '0')}Z`, updatedAt: '', draftStatus: null, draftLabel: null, draftFirstLine: null, target: null,
  published: false, perf: null, linkClicks: null, settlement: null, ...p,
});

test('1) 필터 — 묶음 안 OR, 묶음 사이 AND, 빈 필터는 전부 통과', () => {
  const a = mk({ influencerHandle: 'a', draftStatus: 'delivered', draftId: 'd' });   // handed
  const b = mk({ type: 'rt' });                                                        // prep(인플 미정)
  const c = mk({ postedAt: '2026-09-10', published: true });                           // posted
  const f = EMPTY_FLOW_FILTER();
  assert.ok([a, b, c].every((t) => matchesFlowFilter(t, f, T)));
  f.stages.add('prep'); f.stages.add('posted');
  assert.deepEqual([a, b, c].filter((t) => matchesFlowFilter(t, f, T)).map((t) => t.id), [b.id, c.id]);
  f.types.add('rt');
  assert.deepEqual([a, b, c].filter((t) => matchesFlowFilter(t, f, T)).map((t) => t.id), [b.id]);
  assert.equal(filterCount(f), 3);
});

test('2) 지금 볼 것 — 지연·오늘·미정은 게시·취소 작업을 세지 않는다', () => {
  assert.equal(matchesExtra(mk({ scheduledOn: '2026-09-17' }), 'late', T), true);
  assert.equal(matchesExtra(mk({ scheduledOn: '2026-09-17', postedAt: '2026-09-17' }), 'late', T), false);
  assert.equal(matchesExtra(mk({ scheduledOn: '2026-09-17', cancelledAt: '2026-09-17' }), 'late', T), false);
  assert.equal(matchesExtra(mk({ scheduledOn: T }), 'today', T), true);
  assert.equal(matchesExtra(mk({}), 'none', T), true);
  assert.equal(matchesExtra(mk({ postedAt: '2026-09-10' }), 'none', T), false);
});

test('3) 검색 — 핸들(@ 무관, 대소문자 무관)·원고 제목·첫 줄·취소 스냅샷 제목', () => {
  const t = mk({ influencerHandle: 'Toppogi', draftId: 'd', draftLabel: '치아미백 후기', draftFirstLine: 'ホワイトニングして3日目' });
  assert.ok(matchesSearch(t, '@toppo')); assert.ok(matchesSearch(t, '미백')); assert.ok(matchesSearch(t, '3日目')); assert.ok(matchesSearch(t, '  '));
  assert.equal(matchesSearch(t, 'zzz'), false);
  assert.ok(matchesSearch(mk({ cancelledAt: '2026-09-10', cancelledDraftTitle: '스케일링 루틴' }), '스케일'));
});

test('4) 정렬 — 기본 만든 순, 헤더 클릭 순환, 미정은 오름차순에서 맨 뒤, 취소는 단계 맨 뒤', () => {
  assert.deepEqual(nextSort({ key: null, dir: 1 }, 'date'), { key: 'date', dir: 1 });
  assert.deepEqual(nextSort({ key: 'date', dir: 1 }, 'date'), { key: 'date', dir: -1 });
  assert.deepEqual(nextSort({ key: 'date', dir: -1 }, 'date'), { key: null, dir: 1 });
  assert.deepEqual(nextSort({ key: 'date', dir: -1 }, 'cost'), { key: 'cost', dir: 1 });
  const a = mk({ scheduledOn: '2026-09-20' }), b = mk({}), c = mk({ scheduledOn: '2026-09-15' });
  assert.deepEqual(sortFlowRows([a, b, c], { key: null, dir: 1 }).map((t) => t.id), [a.id, b.id, c.id]);
  assert.deepEqual(sortFlowRows([a, b, c], { key: 'date', dir: 1 }).map((t) => t.id), [c.id, a.id, b.id]);
  assert.deepEqual(sortFlowRows([a, b, c], { key: 'date', dir: -1 }).map((t) => t.id), [a.id, c.id, b.id]);
  const x = mk({ influencerHandle: 'b' }), y = mk({ influencerHandle: 'A' }), z = mk({});
  assert.deepEqual(sortFlowRows([x, y, z], { key: 'influencer', dir: 1 }).map((t) => t.id), [y.id, x.id, z.id]);
  // 날짜 정렬은 화면에 찍히는 날짜를 따른다 — 취소 행은 취소일로 보이므로 원래 예정일로 줄을 세우면 안 된다
  const dz = mk({ scheduledOn: '2026-09-01', cancelledAt: '2026-09-17' });   // 표시: 9/17 목 취소
  const dy = mk({ scheduledOn: '2026-09-10' });                               // 표시: 9/10 목
  assert.deepEqual(sortFlowRows([dz, dy], { key: 'date', dir: 1 }).map((t) => t.id), [dy.id, dz.id]);
  // 비용 미정도 다른 키와 같이 방향과 무관하게 맨 뒤 — 오름차순에서 맨 앞으로 오면 '0원'처럼 읽힌다
  const c1 = mk({}), c2 = mk({ cost: { amount: 10000, currency: 'KRW' } }), c3 = mk({ cost: { amount: 50000, currency: 'KRW' } });
  assert.deepEqual(sortFlowRows([c1, c2, c3], { key: 'cost', dir: 1 }).map((t) => t.id), [c2.id, c3.id, c1.id]);
  assert.deepEqual(sortFlowRows([c1, c2, c3], { key: 'cost', dir: -1 }).map((t) => t.id), [c3.id, c2.id, c1.id]);
  const p = mk({ postedAt: '2026-09-10' }), q = mk({ cancelledAt: '2026-09-10' }), r = mk({});
  assert.deepEqual(sortFlowRows([q, p, r], { key: 'stage', dir: 1 }).map((t) => t.id), [r.id, p.id, q.id]);
});

test('5) 날짜 칸 — 지남 빨강 D+N, 오늘·예정 기본, 게시된 건 게시일 파랑, 미정 회색, 취소는 취소일', () => {
  assert.deepEqual(dateCell(mk({ scheduledOn: '2026-09-15' }), T), { text: '9/15 화 · D+3', tone: 'late' });
  assert.deepEqual(dateCell(mk({ scheduledOn: T }), T), { text: '9/18 금', tone: 'plain' });
  assert.deepEqual(dateCell(mk({ scheduledOn: '2026-09-15', postedAt: '2026-09-16' }), T), { text: '9/16 수', tone: 'posted' });
  assert.deepEqual(dateCell(mk({}), T), { text: '미정', tone: 'muted' });
  assert.deepEqual(dateCell(mk({ cancelledAt: '2026-09-17', scheduledOn: '2026-09-15' }), T), { text: '9/17 목 취소', tone: 'muted' });
  // 내림(koo 09-19 결정 3) — 게시일 파랑과 구분되는 톤이되, 색만이 아니라 글자로도 적는다
  assert.deepEqual(dateCell(mk({ postedAt: '2026-09-16', removedAt: '2026-09-17' }), T), { text: '9/16 수 · 내림', tone: 'muted' });
});

test('6) 원고 칸 — 첫 줄, RT는 —, 없으면 미정, 취소는 사유·메모·있었던 원고', () => {
  assert.equal(draftCell(mk({ draftId: 'd', draftFirstLine: '첫 줄', draftLabel: '제목' })).text, '첫 줄');
  assert.equal(draftCell(mk({ draftId: 'd', draftFirstLine: null, draftLabel: '제목' })).text, '제목');   // 본문이 비면 라벨
  assert.deepEqual(draftCell(mk({ type: 'rt' })), { text: '—', muted: true, title: '' });
  assert.equal(draftCell(mk({})).text, '미정');
  // 원고가 붙어 있는데 제목·본문이 둘 다 비면 '미정'이 아니다 — 붙일 원고가 없다는 뜻으로 읽히면 안 된다(라벨-값 일치)
  assert.equal(draftCell(mk({ draftId: 'd', draftFirstLine: null, draftLabel: null })).text, '(내용 없음)');
  const c = draftCell(mk({ cancelledAt: '2026-09-17', cancelReason: 'declined', cancelNote: '일정 안 맞음', cancelledDraftTitle: '치아미백 후기' }));
  assert.equal(c.text, '🙅 거절 · 일정 안 맞음 · 원고 있었음: 치아미백 후기');
  assert.equal(draftCell(mk({ cancelledAt: '2026-09-17', cancelReason: null, cancelNote: '' })).text, '취소');
});

test('7) 비용 칸 — 값·제안(회색)·미정·취소 취소선', () => {
  assert.deepEqual(costCell(mk({ cost: { amount: 80000, currency: 'KRW' } }), null), { text: '80,000원', tone: 'plain' });
  assert.deepEqual(costCell(mk({}), { amount: 30000, currency: 'KRW' }), { text: '30,000원', tone: 'suggested', title: '아직 확인 전 — 프로필 단가로 채운 값이에요' });
  assert.deepEqual(costCell(mk({}), null), { text: '미정', tone: 'muted' });
  assert.deepEqual(costCell(mk({ cancelledAt: '2026-09-17', cost: { amount: 1000, currency: 'JPY' } }), null), { text: '1,000엔', tone: 'struck' });
});

test('8) 하단 줄·요약 줄·카드 숫자·정산 대기 — 취소 제외, 소진 = 게시된 작업 비용', () => {
  const rows = [
    mk({ type: 'post', cost: { amount: 80000, currency: 'KRW' }, postedAt: '2026-09-10', influencerHandle: 'a', perf: { postCount: 1, views: 100, likes: 3, bookmarks: 1 } }),
    mk({ type: 'rt', cost: { amount: 30000, currency: 'KRW' }, scheduledOn: '2026-09-15' }),
    mk({ type: 'rt', cost: { amount: 30000, currency: 'KRW' }, cancelledAt: '2026-09-17' }),
    mk({ type: 'post', postedAt: '2026-09-11', influencerHandle: 'b', cost: { amount: 50000, currency: 'KRW' } }),
  ];
  // M3 — 하단 줄 라벨을 '비용' → '작업 비용'으로(카드의 '계획'과 이름이 겹쳐 다른 값인데 같아 보였다)
  assert.equal(flowFooter(rows, T), '투고 2 · RT 1 · 작업 비용 160,000원 · 게시 2 / 3 · 밀림 1');
  const s = flowStats(rows);
  assert.equal(s.planned, 3); assert.equal(s.posted, 2);
  assert.deepEqual(s.spent, { KRW: 130000 }); assert.deepEqual(s.plannedCost, { KRW: 160000 });
  assert.deepEqual(s.perf, { views: 100, likes: 3, bookmarks: 1, withPerf: 1, noLink: 1 });
  // koo 09-22 — CPV = 소진(원화 환산) ÷ 조회, 좋아요율·북마크율 = 각 ÷ 조회(비율)
  assert.equal(s.cpvKrw, 1300); assert.equal(s.likeRate, 0.03); assert.equal(s.bookmarkRate, 0.01);
  // I2 — 게시된 작업은 있지만 성과 스냅샷이 하나도 없으면 0이 아니라 null(0으로 위장하지 않는다)
  const noSnap = [mk({ type: 'post', postedAt: '2026-09-10', influencerHandle: 'a' })];
  const noSnapStats = flowStats(noSnap);
  assert.deepEqual(noSnapStats.perf, { views: null, likes: null, bookmarks: null, withPerf: 0, noLink: 1 });
  assert.equal(noSnapStats.cpvKrw, null); assert.equal(noSnapStats.likeRate, null); assert.equal(noSnapStats.bookmarkRate, null);
  // koo 09-22 — 표 성과 열의 괄호 값(작업 하나만의 CPV·좋아요율·북마크율)
  assert.deepEqual(taskPerfExtra(rows[0]), { cpvKrw: 800, likeRate: 0.03, bookmarkRate: 0.01 });
  assert.deepEqual(taskPerfExtra(rows[1]), { cpvKrw: null, likeRate: null, bookmarkRate: null }); // 성과 스냅샷 없음
  assert.equal(settleWaitCount(rows), 2);
  const f = EMPTY_FLOW_FILTER();
  assert.equal(filterSummary(f, 4, 4), '전체 4건');
  f.stages.add('posted'); f.q = 'a';
  assert.equal(filterSummary(f, 1, 4), '게시 · "a" 1건');
  assert.equal(restoreMessage('taken'), '되돌렸어요 — 원고는 그 사이 다른 작업에 붙어 있어요');
  assert.deepEqual(PANEL_FIELD_ORDER.visit, ['influencer', 'dates', 'cost', 'draft', 'note']);
  assert.deepEqual(PANEL_FIELD_ORDER.quoteRt, ['influencer', 'cost', 'draft', 'target', 'scheduled', 'note']);
});

test('8-b) 하단 줄 — 내려진 작업이 있으면 끝에 · 내림 N(밀림과 같은 방식, 0이면 생략, koo 09-19 결정 3)', () => {
  const rows = [
    mk({ type: 'post', cost: { amount: 80000, currency: 'KRW' }, postedAt: '2026-09-10', removedAt: '2026-09-16', influencerHandle: 'a' }),
    mk({ type: 'post', cost: { amount: 50000, currency: 'KRW' }, postedAt: '2026-09-11', influencerHandle: 'b' }),
  ];
  assert.equal(flowFooter(rows, T), '투고 2 · 작업 비용 130,000원 · 게시 2 / 2 · 내림 1');
  assert.equal(flowFooter([mk({ type: 'post', postedAt: '2026-09-11' })], T), '투고 1 · 작업 비용 — · 게시 1 / 1');
});

test('9) 비용 확인 시나리오 — 같음 / 다름 / 프로필 없음 / 통화 다름 / 빈칸', () => {
  const k = (amount: number, currency: 'KRW' | 'JPY' = 'KRW') => ({ amount, currency });
  assert.equal(costConfirmScenario({ profile: k(30000), entered: k(30000) }), 'same');
  assert.equal(costConfirmScenario({ profile: k(30000), entered: k(35000) }), 'differs');
  assert.equal(costConfirmScenario({ profile: null, entered: k(50000) }), 'no-profile');
  assert.equal(costConfirmScenario({ profile: k(30000), entered: k(3000, 'JPY') }), 'currency-mismatch');
  assert.equal(costConfirmScenario({ profile: k(30000), entered: null }), 'empty');
});

test('10) 해제 확인 문구 — 실제로 일어날 일만, 해당하는 것만 붙는다(koo 09-19 결정 2)', () => {
  assert.equal(detachConfirmMessage({ type: 'post', proof: null, draftStatus: null }), '인플루언서를 미정으로 되돌려요.');
  assert.equal(
    detachConfirmMessage({ type: 'rt', proof: { url: 'p', by: null, byName: '', at: '' }, draftStatus: null }),
    '인플루언서를 미정으로 되돌려요.\n올려둔 RT 증빙도 지워져요.',
  );
  assert.equal(
    detachConfirmMessage({ type: 'post', proof: null, draftStatus: 'delivered' }),
    "인플루언서를 미정으로 되돌려요.\n원고 상태는 '전달됨'에서 '사용 확정'으로 돌아가요.",
  );
  // RT 증빙이 없으면 언급하지 않는다 — 없는 것을 지운다고 말하지 않는다
  assert.equal(detachConfirmMessage({ type: 'rt', proof: null, draftStatus: null }), '인플루언서를 미정으로 되돌려요.');
});

test('11) 원고 칸은 본문 첫 줄을 쓴다 — 첫 줄이 갱신되면 표도 따라간다', () => {
  const t = mk({ draftId: 'd', draftLabel: '제목', draftFirstLine: '옛 첫 줄' });
  assert.equal(draftCell(t).text, '옛 첫 줄');
  assert.equal(draftCell({ ...t, draftFirstLine: '새 첫 줄' }).text, '새 첫 줄');
});
