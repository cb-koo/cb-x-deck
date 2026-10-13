import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_FLOW_FILTER, matchesFlowFilter, matchesSearch, matchesExtra, filterCount, filterSummary,
  nextSort, sortFlowRows, dateCell, draftCell, costCell, flowFooter, flowStats, taskPerfExtra, settleWaitCount, isSettleWaiting, restoreMessage, PANEL_FIELD_ORDER,
  costConfirmScenario, profilePromptFor, detachConfirmMessage, flowStageLabel, awaitsReservation, visitStep, VISIT_STEPS, VISIT_STEP_LABEL,
  unseenLabel, REMOVED_REASON_CHIPS,
} from './campaignFlowView.ts';
import { flowStage } from './campaignJudgment.ts';
import type { CampaignTaskItem } from './campaignStore.ts';

const T = '2026-09-18';
let n = 0;
const mk = (p: Partial<CampaignTaskItem>): CampaignTaskItem => ({
  id: `t${++n}`, campaignId: 'c', influencerHandle: null, type: 'post', draftId: null, targetTaskId: null, targetTweetUrl: null,
  postUrl: null, postedAt: null, postedSource: null, removedAt: null, removedReason: '', scheduledOn: null, visitOn: null, cost: null, note: '',
  proof: null, visitTime: null, scheduledTime: null, agreement: null, paymentMethodId: null, cancelledAt: null, cancelReason: null, cancelNote: '', cancelledDraftId: null, cancelledDraftTitle: null, settledElsewhereAt: null, settledElsewhereNote: '', settledElsewhereByName: null, costChangeCount: 0,
  createdAt: `2026-09-01T00:00:${String(n).padStart(2, '0')}Z`, updatedAt: '', draftStatus: null, draftLabel: null, draftFirstLine: null,
  draftPreview: null, draftFirstImage: null, target: null,
  published: false, perf: null, replies: [], linkClicks: null, settlement: null, unseenSince: null, seenAfterRemovedAt: null, ...p,
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
  assert.deepEqual(dateCell(mk({ cancelledAt: '2026-09-17', scheduledOn: '2026-09-15' }), T), { text: '9/17 목 (취소)', tone: 'muted' });
  // 내림(koo 09-19 결정 3) — 게시일 파랑과 구분되는 톤이되, 색만이 아니라 글자로도 적는다. 꼬리표는 괄호(koo 10-12)
  assert.deepEqual(dateCell(mk({ postedAt: '2026-09-16', removedAt: '2026-09-17' }), T), { text: '9/16 수 (내림)', tone: 'muted' });
});

test('5-b) 날짜 칸 — 본 게시물이 X에서 안 보이면 (안 보임) 주황, 사람이 내림으로 정하면 (내림)이 이긴다(2026-10-12)', () => {
  const since = '2026-09-17T05:00:00.000Z';
  assert.deepEqual(dateCell(mk({ postedAt: '2026-09-16', unseenSince: since }), T), { text: '9/16 수 (안 보임)', tone: 'unseen' });
  assert.deepEqual(dateCell(mk({ postedAt: '2026-09-16', unseenSince: since, removedAt: '2026-09-17' }), T), { text: '9/16 수 (내림)', tone: 'muted' });
  // 딱지 문구는 한국 시각 — UTC 05:00 = 서울 14:00
  assert.equal(unseenLabel(since), '9/17 14:00부터 안 보임');
  assert.equal(unseenLabel('2026-09-17T16:30:00.000Z'), '9/18 01:30부터 안 보임');   // 자정 넘김
  assert.deepEqual([...REMOVED_REASON_CHIPS], ['협의 후 내림', '이슈로 내림', '인플 임의 삭제', '계정 잠금']);
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
  // 다른 곳에서 정산함(061) — 정산 대기에서 빠진다(패널 입구도 같은 판정 isSettleWaiting)
  const waiting = rows.filter(isSettleWaiting);
  assert.equal(waiting.length, 2);
  assert.equal(settleWaitCount([{ ...waiting[0], settledElsewhereAt: '2026-09-27' }, waiting[1]]), 1);
  assert.equal(isSettleWaiting({ ...waiting[0], settledElsewhereAt: '2026-09-27' }), false);
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
  // 안 보임(2026-10-12) — 내림 앞에, 내림으로 정한 건 내림으로만 센다
  const withUnseen = [...rows, mk({ type: 'post', postedAt: '2026-09-12', unseenSince: '2026-09-13T00:00:00Z', influencerHandle: 'c' }),
    mk({ type: 'post', postedAt: '2026-09-12', unseenSince: '2026-09-13T00:00:00Z', removedAt: '2026-09-14', influencerHandle: 'd' })];
  assert.equal(flowFooter(withUnseen, T), '투고 4 · 작업 비용 130,000원 · 게시 4 / 4 · 안 보임 1 · 내림 2');
  assert.equal(flowFooter([mk({ type: 'post', postedAt: '2026-09-11' })], T), '투고 1 · 작업 비용 — · 게시 1 / 1');
  // 원화 환산 총액 먼저, 통화 내역은 괄호(koo 10-07)
  const yen = (amount: number) => mk({ type: 'post', cost: { amount, currency: 'JPY' }, influencerHandle: 'y' });
  const won = (amount: number) => mk({ type: 'post', cost: { amount, currency: 'KRW' }, influencerHandle: 'w' });
  assert.equal(flowFooter([yen(95000)], T), '투고 1 · 작업 비용 ≈950,000원 (엔화 95,000엔) · 게시 0 / 1');
  assert.equal(flowFooter([won(360000), yen(95000)], T), '투고 2 · 작업 비용 ≈1,310,000원 (원화 360,000원 · 엔화 95,000엔) · 게시 0 / 2');
  // 엔화 보기 — 원화는 10원 = 1엔으로 환산
  assert.equal(flowFooter([won(360000), yen(95000)], T, 'JPY'), '투고 2 · 작업 비용 ≈131,000엔 (원화 360,000원 · 엔화 95,000엔) · 게시 0 / 2');
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

test('profilePromptFor — CostConfirmField.confirm과 같은 규칙', () => {
  const opt = { id: 'i1', handle: 'a', pricing: { post: 50000, currency: 'KRW' } } as const;
  assert.equal(profilePromptFor({ option: opt, type: 'post', cost: { amount: 50000, currency: 'KRW' } }), null);          // 같음
  assert.deepEqual(profilePromptFor({ option: opt, type: 'post', cost: { amount: 40000, currency: 'KRW' } }),
    { scenario: 'differs', profile: { amount: 50000, currency: 'KRW' } });
  assert.equal(profilePromptFor({ option: opt, type: 'post', cost: { amount: 400, currency: 'JPY' } }), null);            // 통화 다름
  assert.equal(profilePromptFor({ option: { handle: 'a', pricing: opt.pricing }, type: 'post', cost: { amount: 1, currency: 'KRW' } }), null); // 명부 밖(id 없음)
  assert.deepEqual(profilePromptFor({ option: { id: 'i1', handle: 'a' }, type: 'rt', cost: { amount: 1000, currency: 'KRW' } }),
    { scenario: 'no-profile', profile: null });
  assert.equal(profilePromptFor({ option: { id: 'i1', handle: 'a', pricing: { currency: 'JPY' } }, type: 'rt', cost: { amount: 1000, currency: 'KRW' } }), null); // 단가 없음 + 프로필 통화 다름
  assert.equal(profilePromptFor({ option: opt, type: 'post', cost: null }), null);
});

test('063) dateCell — 방문협찬은 게시 예정 시간을 붙이고(밀림 D+n은 날짜로만), 다른 유형은 시간을 무시한다', () => {
  assert.equal(dateCell(mk({ type: 'visit', scheduledOn: '2026-09-26', scheduledTime: '14:00' }), T).text, '9/26 토 14:00');
  assert.deepEqual(dateCell(mk({ type: 'visit', scheduledOn: '2026-09-16', scheduledTime: '23:59' }), T), { text: '9/16 수 23:59 · D+2', tone: 'late' });
  assert.equal(dateCell(mk({ type: 'visit', scheduledOn: '2026-09-26', scheduledTime: null }), T).text, '9/26 토');
  assert.equal(dateCell(mk({ type: 'post', scheduledOn: '2026-09-26', scheduledTime: '14:00' }), T).text, '9/26 토');
});

test('063) 해제 확인 — 방문협찬에 동의서가 있으면 남는다고 말하고, 없으면 말하지 않는다', () => {
  const agreement = { url: 'u', name: 'a.pdf', size: 1, mime: 'application/pdf', by: null, byName: '', at: '' };
  assert.equal(detachConfirmMessage({ type: 'visit', proof: null, draftStatus: null, agreement }), '인플루언서를 미정으로 되돌려요.\n올려둔 협찬 동의서는 그대로 남아요.');
  assert.equal(detachConfirmMessage({ type: 'visit', proof: null, draftStatus: null, agreement: null }), '인플루언서를 미정으로 되돌려요.');
});

test('방문협찬 단계 글자 — 예약 없음·대기는 대기, 확정은 확정, 예약 상태를 모르면 기존 글자', () => {
  assert.equal(flowStageLabel(mk({ type: 'visit', influencerHandle: 'a', reservation: null })), '대기');
  assert.equal(flowStageLabel(mk({ type: 'visit', influencerHandle: 'a', reservation: 'waiting' })), '대기');
  assert.equal(flowStageLabel(mk({ type: 'visit', influencerHandle: 'a', reservation: 'confirmed' })), '확정');
  assert.equal(flowStageLabel(mk({ type: 'visit', influencerHandle: 'a' })), '준비');
  assert.equal(flowStageLabel(mk({ type: 'visit', influencerHandle: 'a', reservation: null, postedAt: '2026-09-10' })), '게시');
  assert.equal(flowStageLabel(mk({ type: 'post', reservation: null })), '준비');
});

test('방문협찬 패널 단계 줄 — 방문 전엔 예약 단계, 방문 뒤엔 공통 단계, 취소·노쇼는 흐름 밖', () => {
  const v = (p: Partial<CampaignTaskItem>) => mk({ type: 'visit', influencerHandle: 'a', reservation: 'confirmed', ...p });
  assert.deepEqual(VISIT_STEPS.map((s) => VISIT_STEP_LABEL[s]), ['대기', '확정', '방문', '전달', '게시', '정산', '완료']);
  assert.equal(visitStep(v({ reservation: null }), 'unregistered'), 'waiting');
  assert.equal(visitStep(v({ reservation: 'waiting' }), 'waiting'), 'waiting');
  assert.equal(visitStep(v({}), 'confirmed'), 'confirmed');
  // 방문 전에 원고를 전달했어도(공통 단계 '전달') 줄에서는 아직 '확정'
  assert.equal(flowStage(v({ draftStatus: 'delivered' }), null), 'handed');   // 전제: 전달된 원고 = 공통 단계 '전달'
  assert.equal(visitStep(v({ draftStatus: 'delivered' }), 'confirmed'), 'confirmed');
  assert.equal(visitStep(v({}), 'visited'), 'visited');
  assert.equal(visitStep(v({ draftStatus: 'delivered' }), 'visited'), 'handed');
  assert.equal(visitStep(v({ postedAt: '2026-09-10' }), 'uploaded'), 'posted');
  const settled = (externalStatus: 'received' | 'paid') => ({ status: 'requested', externalStatus } as CampaignTaskItem['settlement']);
  assert.equal(visitStep(v({ postedAt: '2026-09-10', settlement: settled('received') }), 'settling'), 'settle');
  assert.equal(visitStep(v({ postedAt: '2026-09-10', settlement: settled('paid') }), 'completed'), 'done');
  assert.equal(visitStep(v({ postedAt: '2026-09-10', noCost: true }), 'completed'), 'done');
  assert.equal(visitStep(v({ cancelledAt: '2026-09-10' }), 'cancelled'), null);
  assert.equal(visitStep(v({}), 'visit_no_show'), null);
  assert.equal(visitStep(v({}), 'upload_no_show'), null);
});

test('카드 클릭 시 예약 창 — 예약 없는 살아 있는 방문 작업만', () => {
  assert.equal(awaitsReservation(mk({ type: 'visit', influencerHandle: 'a', reservation: null })), true);
  assert.equal(awaitsReservation(mk({ type: 'visit', influencerHandle: 'a', reservation: 'waiting' })), false);
  assert.equal(awaitsReservation(mk({ type: 'visit', influencerHandle: 'a' })), false);
  assert.equal(awaitsReservation(mk({ type: 'visit', influencerHandle: null, reservation: null })), false);
  assert.equal(awaitsReservation(mk({ type: 'visit', influencerHandle: 'a', reservation: null, cancelledAt: '2026-09-10' })), false);
});
