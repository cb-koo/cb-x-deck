// 같은 방문의 게시물(089, ISSUE-016) — 순수 판정 전부. DB 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sameVisitGroups, sameVisitPatchError, sameVisitCreateError, shareNote, postNo, isBlankLinked, canUndoLinked, duplicateLinkMessage, settlementRequestNote,
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
  assert.match(togetherText(t), /^같은 방문 게시물 2건 중 1건 게시, 남은 작업: 마인드_10월 방문협찬\(게시물 2, 예정일 없음\)$/);
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

test('알림 문구 — 게시물 N 뒤 조사, 빈 연결 작업·되돌리기 가능 판정, 중복 링크 문구', () => {
  assert.deepEqual([1, 2, 3, 4, 10, 12].map((n) => postNo(n, '을')), ['게시물 1을', '게시물 2를', '게시물 3을', '게시물 4를', '게시물 10을', '게시물 12를']);
  assert.deepEqual([2, 3].map((n) => postNo(n, '이')), ['게시물 2가', '게시물 3이']);
  const blank = { sameVisitOf: 'o', cancelledAt: null, postUrl: null, postedAt: null, scheduledOn: null, note: '', draftId: null };
  assert.equal(isBlankLinked(blank), true);
  assert.equal(isBlankLinked({ ...blank, scheduledOn: '2026-11-12' }), false);   // 예정일을 넣으면 빈 작업이 아니다
  assert.equal(isBlankLinked({ ...blank, sameVisitOf: null }), false);           // 원래 작업은 아니다
  assert.equal(isBlankLinked({ ...blank, cancelledAt: '2026-11-09' }), false);
  assert.equal(canUndoLinked(blank), true);
  assert.equal(canUndoLinked({ ...blank, note: '메모' }), false);                 // 사람이 넣은 게 있으면 되돌리기 대신 [삭제]
  assert.equal(canUndoLinked({ ...blank, draftId: 'd' }), false);
  assert.equal(duplicateLinkMessage({ campaignName: '마인드_10월', influencerHandle: 'sara', sameCampaign: false, ordinal: 1 }), '이미 게시물 1에 등록된 링크예요.');
  assert.equal(duplicateLinkMessage({ campaignName: '마인드_10월', influencerHandle: 'sara', sameCampaign: true, ordinal: null }), '이미 이 캠페인의 @sara 작업에 등록된 링크예요.');
  assert.equal(duplicateLinkMessage({ campaignName: '마인드_10월', influencerHandle: null, sameCampaign: false, ordinal: null }), '이미 마인드_10월의 다른 작업에 등록된 링크예요.');
});

test('정산 기다림 — 날짜 없는 게시 전 연결 작업은 원래 게시 후 7일이 지나면 지남(안 올라옴)으로 알린다', () => {
  const sib = (o: Partial<WeekSibling> & { taskId: string }): WeekSibling => ({
    handle: 'sara', taskType: 'visit', campaignName: '마인드_10월', postedAt: null, scheduledOn: null, visitOn: null, campaignStartsOn: '2026-10-01', confirmedAt: null, ...o,
  });
  const self = { taskId: 'o', handle: 'sara', postedAt: '2026-10-31' };
  const sibs = [sib({ taskId: 'o', postedAt: '2026-10-31' }), sib({ taskId: 'a', sameVisitOf: 'o', createdAt: '1' }), sib({ taskId: 'b', sameVisitOf: 'o', createdAt: '2', postedAt: '2026-11-02' })];
  // 7일째(11/7)까지는 기다림, 8일째부터 지남
  assert.equal(togetherFor(self, sibs, '2026-11-07')!.pending[0].overdue, false);
  const late = togetherFor(self, sibs, '2026-11-09')!;
  assert.equal(late.pending[0].overdue, true);
  assert.deepEqual(late.pending[0].sameVisit, { ordinal: 2, sinceOriginal: 9 });
  assert.equal(togetherShort(late), '같은 방문 게시물 3건 중 2건 게시, 게시물 2가 아직 안 올라왔어요(원래 게시 후 9일)');
  assert.match(togetherText(late), /\(게시물 2, 예정일 없음, 원래 게시 후 9일\)$/);
  // 예정일이 있으면 그 날짜가 기준(7일 규칙 아님)
  const dated = togetherFor(self, [sibs[0], sib({ taskId: 'a', sameVisitOf: 'o', scheduledOn: '2026-11-20' })], '2026-11-09')!;
  assert.equal(dated.pending[0].overdue, false);
});

test('정산 요청 메모 — 같은 방문 나머지 게시물(게시·링크 없음·안 올라옴), 링크 없는 원래 작업은 앞에, 500자 넘으면 외 N건', () => {
  const posted = (n: number, d = '2026-11-08') => ({ postUrl: `https://x.com/skysky_ca/status/198000000000000010${n}`, postedAt: d });
  // ① 전부 게시
  assert.equal(settlementRequestNote(null, [posted(2), posted(3, '2026-11-09')]),
    '[같은 방문 게시물 3건] 게시물 2: https://x.com/skysky_ca/status/1980000000000000102 (11/8 게시), 게시물 3: https://x.com/skysky_ca/status/1980000000000000103 (11/9 게시)');
  // ② 1건 미게시 + 링크 없이 게시 확인
  assert.equal(settlementRequestNote(null, [{ postUrl: null, postedAt: '2026-11-07' }, { postUrl: null, postedAt: null }]),
    '[같은 방문 게시물 3건] 게시물 2: 링크 없음(게시물 삭제), 게시물 3: 아직 안 올라옴');
  // ③ 원래 작업이 링크 없이 게시 확인 — 기존 [게시물 삭제] 문장이 앞, ' / '로 잇는다
  assert.equal(settlementRequestNote('[게시물 삭제] 이슈로 내림 (게시 11/5, 지워짐 확인 11/9)', [posted(2)]),
    '[게시물 삭제] 이슈로 내림 (게시 11/5, 지워짐 확인 11/9) / [같은 방문 게시물 2건] 게시물 2: https://x.com/skysky_ca/status/1980000000000000102 (11/8 게시)');
  // 연결 작업이 없으면 예전 그대로
  assert.equal(settlementRequestNote(null, []), '');
  assert.equal(settlementRequestNote('[게시물 삭제] x (게시 1/1, 지워짐 확인 1/2)', []), '[게시물 삭제] x (게시 1/1, 지워짐 확인 1/2)');
  // 길이 — 20건이면 500자를 넘지 않게 뒤를 '외 N건'으로
  const many = Array.from({ length: 20 }, (_, i) => ({ postUrl: `https://x.com/a_very_long_handle_name/status/19800000000000${String(i).padStart(5, '0')}`, postedAt: '2026-11-08' }));
  const long = settlementRequestNote(null, many);
  assert.ok(long.length <= 500, String(long.length));
  assert.match(long, /^\[같은 방문 게시물 21건\] 게시물 2: .*, 외 \d+건$/);
  const longWithLinkless = settlementRequestNote('[게시물 삭제] ' + '긴 이유 '.repeat(30) + '(게시 1/1, 지워짐 확인 1/2)', many);
  assert.ok(longWithLinkless.length <= 500);
  assert.match(longWithLinkless, /^\[게시물 삭제\] .* \/ \[같은 방문 게시물 21건\] .*외 \d+건$/);
});
