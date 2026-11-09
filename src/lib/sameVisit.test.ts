// 같은 방문의 게시물(089, ISSUE-016) — 순수 판정 전부. DB 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sameVisitGroups, sameVisitPatchError, sameVisitCreateError, shareNote, sameVisitConfirmText,
  SAME_VISIT_COST_MESSAGE, SAME_VISIT_VISIT_ON_MESSAGE, SAME_VISIT_INFLUENCER_MESSAGE, SAME_VISIT_AGREEMENT_MESSAGE, SAME_VISIT_CREATE_MESSAGE,
} from './sameVisit.ts';
import { flowFooter, flowStageLabel, awaitsReservation, taskPerfExtra, replaceDisabledReason, visitStep } from './campaignFlowView.ts';
import { visitPhase, allowedVisitActions, type VisitTaskFacts } from './reservationPolicy.ts';
import { visitPhaseFromRow } from './taskSectionView.ts';
import { taskCpv, withVisitShares, summarizeInfluencer, type PerfTask } from './influencerPerformance.ts';
import { togetherFor, togetherShort, togetherText, type WeekSibling } from './settlementAuto.ts';
import type { CampaignTaskItem } from './campaignStore.ts';

const T = '2026-11-09';
let n = 0;
const mk = (p: Partial<CampaignTaskItem>): CampaignTaskItem => ({
  id: `t${++n}`, campaignId: 'c', influencerHandle: 'sara', type: 'visit', draftId: null, targetTaskId: null, targetTweetUrl: null,
  postUrl: null, postedAt: null, postedSource: null, removedAt: null, removedReason: '', scheduledOn: null, visitOn: null, cost: null, note: '',
  proof: null, visitTime: null, scheduledTime: null, agreement: null, paymentMethodId: null, cancelledAt: null, cancelReason: null, cancelNote: '', cancelledDraftId: null, cancelledDraftTitle: null, settledElsewhereAt: null, settledElsewhereNote: '', settledElsewhereByName: null, costChangeCount: 0,
  createdAt: `2026-11-01T00:00:${String(n).padStart(2, '0')}Z`, updatedAt: '', draftStatus: null, draftLabel: null, draftFirstLine: null,
  draftPreview: null, draftFirstImage: null, target: null,
  published: false, perf: null, replies: [], linkClicks: null, settlement: null, unseenSince: null, seenAfterRemovedAt: null, ...p,
});
const YEN = { amount: 15000, currency: 'JPY' as const };

test('묶음 — 원래 작업 1, 연결 작업은 만든 순서로 2·3, N은 취소 제외(게시 전 포함), 몫은 원래 작업 비용', () => {
  const o = mk({ cost: YEN, postedAt: '2026-11-05' });
  const a = mk({ sameVisitOf: o.id, noCost: true });                       // 게시 전 — N에 포함
  const b = mk({ sameVisitOf: o.id, noCost: true, postedAt: '2026-11-07' });
  const x = mk({ sameVisitOf: o.id, noCost: true, cancelledAt: '2026-11-08' });   // 취소 — 빠진다
  const other = mk({ cost: YEN });                                          // 연결 없는 작업 — 묶음 아님
  const g = sameVisitGroups([b, other, x, a, o]);
  assert.deepEqual([o, a, b].map((t) => g.get(t.id)?.ordinal), [1, 2, 3]);
  assert.equal(g.get(o.id)!.total, 3);
  assert.deepEqual(g.get(b.id)!.share, { cost: YEN, n: 3 });
  assert.equal(g.has(x.id), false);
  assert.equal(g.has(other.id), false);
  // 원래 작업이 취소면(연결 작업도 함께 취소됐어야 하지만) 묶음으로 보지 않는다
  assert.equal(sameVisitGroups([mk({ id: 'oc', cancelledAt: T }), mk({ sameVisitOf: 'oc' })]).size, 0);
  // 원래 작업에 금액이 없으면 몫도 없다(CPV는 비운다)
  const free = mk({});
  assert.equal(sameVisitGroups([free, mk({ sameVisitOf: free.id })]).get(free.id)!.share, null);
});

test('CPV — 방문 비용 ÷ 게시물 수 ÷ 그 게시물 조회, 연결 작업에도 값이 생긴다', () => {
  const o = mk({ cost: YEN, postedAt: '2026-11-05', perf: { views: 10000 } as CampaignTaskItem['perf'] });
  const a = mk({ sameVisitOf: o.id, noCost: true, postedAt: '2026-11-07', perf: { views: 5000 } as CampaignTaskItem['perf'] });
  const g = sameVisitGroups([o, a]);
  // 15,000엔 = 150,000원 → 게시물당 75,000원
  assert.equal(taskPerfExtra(o, g.get(o.id)!.share).cpvKrw, 7.5);
  assert.equal(taskPerfExtra(a, g.get(a.id)!.share).cpvKrw, 15);
  assert.equal(taskPerfExtra(o).cpvKrw, 15);           // 묶음 없이 보면 원래 작업이 다 떠안는다(예전 값)
  assert.equal(taskPerfExtra(a).cpvKrw, null);
  assert.equal(shareNote(g.get(o.id)!.share!), '방문 비용 15,000엔을 게시물 2건에 나눠 계산했어요');
});

test('표 아래 줄 — 방문협찬은 방문 수, 게시물 수가 다르면 괄호, 나열은 쉼표', () => {
  const o = mk({ cost: YEN });
  const rows = [o, mk({ sameVisitOf: o.id, noCost: true }), mk({ type: 'post' })];
  assert.equal(flowFooter(rows, T), '투고 1, 방문협찬 1 (게시물 2), 작업 비용 ≈150,000원 (엔화 15,000엔), 게시 0 / 3');
  assert.match(flowFooter([o], T), /^방문협찬 1, /);
});

test('연결 작업 화면 판정 — 단계 칩 방문, 예약 창 자동 열기 없음, 인플 바꾸기 막힘', () => {
  const o = mk({ cost: YEN, reservation: null });
  const a = mk({ sameVisitOf: o.id, noCost: true, reservation: null });
  assert.equal(flowStageLabel(a), '방문');
  assert.equal(flowStageLabel(o), '대기');            // 원래 작업(예약 없음)은 그대로
  assert.equal(awaitsReservation(a), false);
  assert.equal(awaitsReservation(o), true);
  assert.equal(replaceDisabledReason(a, T), '같은 방문의 게시물이라 바꿀 수 없어요');
  assert.equal(visitPhaseFromRow(a, T), 'visited');
  assert.equal(visitStep(a, 'visited'), 'visited');
  assert.equal(visitPhaseFromRow(mk({ ...a, id: 'p', postedAt: '2026-11-08' }), T), 'completed');   // 비용 없음 + 게시 = 완료
});

test('예약 판정 — 연결 작업은 게시 전 방문, 허용 행동 없음(예약 추가·노쇼·취소 모두)', () => {
  const f = (o: Partial<VisitTaskFacts>): VisitTaskFacts => ({
    endKind: null, cancelledAt: null, postedAt: null, noCost: true, settlement: null, visitCompletedAt: null, visitOn: '2026-09-02', reservation: null, ...o,
  });
  assert.equal(visitPhase(f({ sameVisitOf: 'o' }), T), 'visited');
  assert.deepEqual(allowedVisitActions(f({ sameVisitOf: 'o' }), 0, T), []);
  assert.equal(visitPhase(f({ sameVisitOf: 'o', postedAt: '2026-11-08' }), T), 'completed');
  // 연결 아닌 예약 없는 방문 작업은 예전 그대로(방문일이 지났으면 예약 추가·업로드 노쇼)
  assert.equal(visitPhase(f({}), T), 'unregistered');
  assert.deepEqual(allowedVisitActions(f({}), 0, T), ['add_reservation', 'upload_no_show']);
});

test('연결 작업 편집 잠금 — 비용 없음·금액·방문일·인플·동의서, 나머지(예정일·메모·게시)는 통과', () => {
  const cur = { sameVisitOf: 'o' };
  assert.equal(sameVisitPatchError(cur, { noCost: false }), SAME_VISIT_COST_MESSAGE);
  assert.equal(sameVisitPatchError(cur, { cost: YEN }), SAME_VISIT_COST_MESSAGE);
  assert.equal(sameVisitPatchError(cur, { cost: null }), null);
  assert.equal(sameVisitPatchError(cur, { visitOn: '2026-11-01' }), SAME_VISIT_VISIT_ON_MESSAGE);
  assert.equal(sameVisitPatchError(cur, { visitTime: '10:00' }), SAME_VISIT_VISIT_ON_MESSAGE);
  assert.equal(sameVisitPatchError(cur, { influencerHandle: null }), SAME_VISIT_INFLUENCER_MESSAGE);
  assert.equal(sameVisitPatchError(cur, { agreementInput: null }), SAME_VISIT_AGREEMENT_MESSAGE);
  assert.equal(sameVisitPatchError(cur, {}), null);
  assert.equal(sameVisitPatchError({ sameVisitOf: null }, { cost: YEN, visitOn: '2026-11-01' }), null);   // 일반 작업은 상관없다
});

test('만들 수 있는 원래 작업 — 방문협찬, 연결 작업 아님, 취소 아님, 인플 있음(게시 여부 무관)', () => {
  const base = { type: 'visit', cancelledAt: null, sameVisitOf: null, influencerHandle: 'sara' };
  assert.equal(sameVisitCreateError(base), null);
  assert.equal(sameVisitCreateError({ ...base, type: 'post' }), SAME_VISIT_CREATE_MESSAGE.notVisit);
  assert.equal(sameVisitCreateError({ ...base, sameVisitOf: 'o' }), SAME_VISIT_CREATE_MESSAGE.linked);   // 체인 금지
  assert.equal(sameVisitCreateError({ ...base, cancelledAt: T }), SAME_VISIT_CREATE_MESSAGE.cancelled);
  assert.equal(sameVisitCreateError({ ...base, influencerHandle: null }), SAME_VISIT_CREATE_MESSAGE.noInfluencer);
  assert.match(sameVisitConfirmText({ influencerHandle: 'sara', visitOn: '2026-09-02', visitTime: '10:30' }, '9/2 화 10:30'), /^@sara의 .*\n\n같은 인플루언서, 같은 방문\(9\/2 화 10:30\)\n비용 없음/);
});

test('인플 성과 — 연결 작업도 CPV가 생기고 원래 작업은 몫만, 방문협찬 수는 방문 횟수', () => {
  const m = (views: number) => ({ postCount: 1, views, likes: 0, replies: 0, bookmarks: 0, retweets: 0, quotes: 0 });
  const base = { campaignId: 'c', campaignName: '캠', type: 'visit' as const, postUrl: 'https://x.com/a/status/1', removedAt: null, removedReason: '', clientId: null, clientName: null };
  const o: PerfTask = { ...base, id: 'o', postedAt: '2026-11-05', cost: YEN, metrics: m(10000), createdAt: '1' };
  const a: PerfTask = { ...base, id: 'a', postedAt: '2026-11-07', cost: null, metrics: m(5000), sameVisitOf: 'o', createdAt: '2' };
  assert.equal(taskCpv(o), 15);                        // 몫 없이: 예전 값
  assert.equal(taskCpv(a), null);
  const [so, sa] = withVisitShares([o, a]);
  assert.equal(taskCpv(so), 7.5);
  assert.equal(taskCpv(sa), 15);
  const row = summarizeInfluencer({ handle: 'sara', influencerId: null, displayName: null, avatarUrl: null, isBlueVerified: null, tasks: [so, sa] });
  assert.equal(row.typeCounts.visit, 1);
  assert.equal(row.stats.cpv.n, 2);
});

test('정산 기다림 — 원래 작업은 주와 상관없이 같은 방문 게시물을 기다린다, 날짜 없는 게시 전 연결 작업은 다른 작업을 붙잡지 않는다', () => {
  const sib = (o: Partial<WeekSibling> & { taskId: string }): WeekSibling => ({
    handle: 'sara', taskType: 'visit', campaignName: '마인드_10월', postedAt: null, scheduledOn: null, visitOn: null, campaignStartsOn: '2026-10-01', confirmedAt: null, ...o,
  });
  const self = { taskId: 'o', handle: 'sara', postedAt: '2026-11-05' };
  // 연결 작업이 날짜 없이 게시 전 — 주가 달라도(캠페인 시작일 10/1) 묶인다
  const t = togetherFor(self, [sib({ taskId: 'o', postedAt: '2026-11-05' }), sib({ taskId: 'a', sameVisitOf: 'o' })], T)!;
  assert.equal(t.kind, 'visit');
  assert.deepEqual([t.total, t.posted, t.pending.length], [2, 1, 1]);
  assert.equal(togetherShort(t), '같은 방문 게시물 2건 중 1건 게시, 1건 예정일 없음');
  assert.match(togetherText(t), /^같은 방문 게시물 2건 중 1건 게시, 남은 작업: 마인드_10월 방문협찬\(예정일 없음\)$/);
  // 다 올라오면 남은 것 없음 → 함께 전송(묶음은 있지만 pending 0)
  assert.equal(togetherFor(self, [sib({ taskId: 'o', postedAt: '2026-11-05' }), sib({ taskId: 'a', sameVisitOf: 'o', postedAt: '2026-11-12' })], T)!.pending.length, 0);
  // 같은 주의 다른 작업과 섞이면 both
  const both = togetherFor(self, [sib({ taskId: 'o', postedAt: '2026-11-05' }), sib({ taskId: 'a', sameVisitOf: 'o' }), sib({ taskId: 'q', taskType: 'quoteRt', scheduledOn: '2026-11-06' })], T)!;
  assert.equal(both.kind, 'both');
  assert.match(togetherShort(both), /^같은 주, 같은 방문 게시물 3건 중 1건 게시/);
  // 다른 후보(같은 인플, 캠페인 시작 주에 게시)는 날짜 없는 게시 전 연결 작업을 기다리지 않는다
  const other = togetherFor({ taskId: 'p', handle: 'sara', postedAt: '2026-10-01' },
    [sib({ taskId: 'p', postedAt: '2026-10-01' }), sib({ taskId: 'a', sameVisitOf: 'o' })], T);
  assert.equal(other, null);
  // 같은 주만이면 표시는 예전 그대로(머리말 없음)
  const week = togetherFor(self, [sib({ taskId: 'o', postedAt: '2026-11-05' }), sib({ taskId: 'q', scheduledOn: '2026-11-06' })], T)!;
  assert.equal(week.kind, 'week');
  assert.match(togetherShort(week), /^2건 중 1건 게시/);
});
