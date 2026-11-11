// 기타 협찬(088) — 순수 규칙·유형 판정·입력 검사·정산 문구·외부 직렬화(마케팅 비용·확장 kind) 단위 테스트. DB 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOtherKind, canonicalOtherKind, filterOtherKinds, isHttpUrl, otherLinklessNote, isOtherLinklessDone, otherGateError,
  OTHER_KIND_REQUIRED_MESSAGE, DONE_NOTE_REQUIRED_MESSAGE, OTHER_ONLY_MESSAGE, DONE_DATE_FUTURE_MESSAGE,
} from './otherTask.ts';
import { TASK_TYPES, TASK_TYPE_LABEL, isTaskType, hasXPost, takesDraft, flowStage, isPriceType } from './campaignJudgment.ts';
import { PRICE_TYPES } from './influencerPricing.ts';
import { suggestTaskCost } from './campaignCost.ts';
import {
  parseTaskCreate, parseTaskPatch, postUrlTypeGateError, postedAtFromLinkGate, POST_URL_MESSAGE, OTHER_NO_DRAFT_TARGET_MESSAGE,
} from './campaignTaskInput.ts';
import { isLinklessPosted, linklessGateError } from './linklessPost.ts';
import { itemText, purposeText, computeCandidate, referenceRequiredFor, type CandidateInput } from './settlementCalc.ts';
import { SETTLEMENT_DEFAULTS, defaultCategoryFor, sanitizeSettlementSettings, CATEGORY_ID_OTHER } from './settlementSettings.ts';
import { CATEGORY_BY_TASK_TYPE } from './marketingCostExport.ts';
import { WIRE_KIND, classifyTask, toTaskDto, type TaskFacts } from './extensionTasks.ts';
import { draftCell, profilePromptFor, DISPLAY_TYPE_ORDER, X_TYPE_ORDER, PANEL_FIELD_ORDER, type FlowRow } from './campaignFlowView.ts';
import { buildTaskCreateBody } from './taskCreateBody.ts';

const TODAY = '2026-11-06';

// ── 유형 뿌리 ──
test('유형 — 작업 유형은 5종(기타 협찬 추가), 단가 유형은 4종 그대로(koo 11-06 결정 1)', () => {
  assert.deepEqual([...TASK_TYPES], ['rt', 'quoteRt', 'post', 'visit', 'other']);
  assert.deepEqual([...PRICE_TYPES], ['rt', 'quoteRt', 'post', 'visit']);
  assert.equal(TASK_TYPE_LABEL.other, '기타 협찬');
  assert.ok(isTaskType('other'));
  assert.equal(isPriceType('other'), false);
});
test('유형 — X 게시물·원고는 RT·기타 협찬에 없다', () => {
  assert.deepEqual(TASK_TYPES.filter(hasXPost), ['quoteRt', 'post', 'visit']);
  assert.deepEqual(TASK_TYPES.filter(takesDraft), ['quoteRt', 'post', 'visit']);
});
test('단가 제안 — 기타 협찬은 프로필 단가가 있어도 제안하지 않는다', () => {
  const pricing = { rt: 1000, quoteRt: 2000, post: 3000, visit: 4000 };
  assert.equal(suggestTaskCost(pricing, 'other'), null);
  assert.deepEqual(suggestTaskCost(pricing, 'post'), { amount: 3000, currency: 'KRW' });
});
test('단계 — 기타 협찬은 원고 없이 사람만 정해지면 전달(RT와 같다), 완료하면 게시', () => {
  const base = { type: 'other' as const, draftStatus: null, postedAt: null, removedAt: null, scheduledOn: null, visitOn: null, cancelledAt: null };
  assert.equal(flowStage({ ...base, influencerHandle: null }, null), 'prep');
  assert.equal(flowStage({ ...base, influencerHandle: 'a' }, null), 'handed');
  assert.equal(flowStage({ ...base, influencerHandle: 'a', postedAt: TODAY }, null), 'posted');
  // 투고는 원고가 없으면 그대로 준비(기존 규칙 유지)
  assert.equal(flowStage({ ...base, type: 'post', influencerHandle: 'a' }, null), 'prep');
});

// ── 무엇을 했는지·추천 ──
test('무엇을 했는지 — 공백 정리, 띄어쓰기·대소문자만 다르면 전에 쓴 말로 맞춘다', () => {
  assert.equal(normalizeOtherKind('  구글맵   리뷰 '), '구글맵 리뷰');
  assert.equal(canonicalOtherKind('구글맵리뷰', ['구글맵 리뷰', '상담회 참석']), '구글맵 리뷰');
  assert.equal(canonicalOtherKind('Google Review', ['google review']), 'google review');
  assert.equal(canonicalOtherKind('구글맵 리뷰', ['구글맵 리뷰']), null);   // 같으면 바꿀 것 없음
  assert.equal(canonicalOtherKind('인스타 스토리', ['구글맵 리뷰']), null);
  const known = [{ kind: '구글맵 리뷰', count: 8 }, { kind: '상담회 참석', count: 3 }];
  assert.deepEqual(filterOtherKinds('맵', known), [known[0]]);
  assert.deepEqual(filterOtherKinds('', known), known);
});
test('확인 링크 — http(s)만, 공백 없는 주소만', () => {
  assert.ok(isHttpUrl('https://maps.app.goo.gl/AbC123'));
  assert.ok(isHttpUrl('http://example.com/a?b=1'));
  assert.equal(isHttpUrl('maps.app.goo.gl/AbC123'), false);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('https://a b.com'), false);
});

// ── 완료 확인 판정 ──
const cur = { type: 'other' as const, postedAt: null, postUrl: null, otherKind: '', doneNote: '' };
test('완료 확인 — 무엇을 했는지 필수, 링크 또는 확인 메모 필수, 날짜는 오늘 이하', () => {
  assert.equal(otherGateError(cur, { postedAt: TODAY, postUrl: 'https://x.y' }, TODAY), OTHER_KIND_REQUIRED_MESSAGE);
  assert.equal(otherGateError({ ...cur, otherKind: '상담회 참석' }, { postedAt: TODAY }, TODAY), DONE_NOTE_REQUIRED_MESSAGE);
  assert.equal(otherGateError({ ...cur, otherKind: '상담회 참석' }, { postedAt: TODAY, doneNote: '현장 참석 확인' }, TODAY), null);
  assert.equal(otherGateError({ ...cur, otherKind: '구글맵 리뷰' }, { postedAt: TODAY, postUrl: 'https://maps.app.goo.gl/x' }, TODAY), null);
  // 같은 요청에 무엇을 했는지를 함께 보내도 된다(패치 후 상태로 본다)
  assert.equal(otherGateError(cur, { postedAt: TODAY, postUrl: 'https://maps.app.goo.gl/x', otherKind: '구글맵 리뷰' }, TODAY), null);
  assert.equal(otherGateError({ ...cur, otherKind: 'a' }, { postedAt: '2026-11-07', doneNote: 'm' }, TODAY), DONE_DATE_FUTURE_MESSAGE);
});
test('완료 확인 — 완료 뒤엔 무엇을 했는지·링크 없는 완료의 메모를 비울 수 없다, 완료 전엔 자유', () => {
  const done = { ...cur, postedAt: TODAY, otherKind: '상담회 참석', doneNote: '현장 확인' };
  assert.equal(otherGateError(done, { otherKind: '' }, TODAY), OTHER_KIND_REQUIRED_MESSAGE);
  assert.equal(otherGateError(done, { doneNote: '' }, TODAY), DONE_NOTE_REQUIRED_MESSAGE);
  assert.equal(otherGateError(done, { doneNote: '' , postUrl: 'https://a.b' }, TODAY), null);
  assert.equal(otherGateError(cur, { otherKind: '' }, TODAY), null);
});
test('완료 확인 — 기타 협찬 칸은 다른 유형에 보내면 거절, 아무것도 안 보내면 판정 없음', () => {
  assert.equal(otherGateError({ ...cur, type: 'post' }, { otherKind: '리뷰' }, TODAY), OTHER_ONLY_MESSAGE);
  assert.equal(otherGateError({ ...cur, type: 'rt' }, { doneNote: '' }, TODAY), OTHER_ONLY_MESSAGE);
  assert.equal(otherGateError({ ...cur, type: 'post' }, { postedAt: TODAY }, TODAY), null);
});

// ── 입력 검사(라우트 파서) ──
test('파서 — 게시물 링크는 X 링크면 정규형, 아니면 http(s) 주소 그대로(기타 협찬의 확인 링크)', () => {
  const x = parseTaskPatch({ postUrl: 'https://twitter.com/abc/status/1850000000000000000?s=20' });
  assert.ok(x.ok); assert.equal(x.value.postUrl, 'https://x.com/abc/status/1850000000000000000');
  const g = parseTaskPatch({ postUrl: ' https://maps.app.goo.gl/AbC123 ' });
  assert.ok(g.ok); assert.equal(g.value.postUrl, 'https://maps.app.goo.gl/AbC123');
  const bad = parseTaskPatch({ postUrl: 'not a url' });
  assert.ok(!bad.ok);
  const k = parseTaskPatch({ otherKind: '  구글맵  리뷰 ', doneNote: ' 메모 ' });
  assert.ok(k.ok); assert.equal(k.value.otherKind, '구글맵 리뷰'); assert.equal(k.value.doneNote, '메모');
  assert.ok(!parseTaskPatch({ otherKind: 'x'.repeat(41) }).ok);
});
test('파서 — X 유형에 X가 아닌 링크는 거절(유형 판정은 라우트의 postUrlTypeGateError)', () => {
  assert.equal(postUrlTypeGateError({ type: 'post' }, { postUrl: 'https://maps.app.goo.gl/x' }), POST_URL_MESSAGE);
  assert.equal(postUrlTypeGateError({ type: 'visit' }, { postUrl: 'https://x.com/a/status/1850000000000000000' }), null);
  assert.equal(postUrlTypeGateError({ type: 'other' }, { postUrl: 'https://maps.app.goo.gl/x' }), null);
});
test('파서 — 기타 협찬의 완료일은 사람이 고른 날 그대로(트윗에서 계산하지 않는다), 링크 없어도 여기선 통과', () => {
  assert.deepEqual(postedAtFromLinkGate({ type: 'other', postUrl: null }, { postedAt: '2026-11-03' }), { ok: true, value: '2026-11-03' });
  assert.deepEqual(postedAtFromLinkGate({ type: 'other', postUrl: null }, { postedAt: '2026-11-03', postUrl: 'https://maps.app.goo.gl/x' }), { ok: true, value: '2026-11-03' });
});
test('파서 — 작업 만들기: 무엇을 했는지는 기타 협찬만, 기타 협찬엔 원고·대상 없음', () => {
  const ok = parseTaskCreate({ type: 'other', otherKind: ' 구글맵 리뷰 ', influencers: [] });
  assert.ok(ok.ok); assert.equal(ok.value.otherKind, '구글맵 리뷰');
  const empty = parseTaskCreate({ type: 'other', influencers: [] });
  assert.ok(empty.ok); assert.equal(empty.value.otherKind, '');   // 만들 때는 비워도 된다(결정 2)
  assert.ok(!parseTaskCreate({ type: 'post', otherKind: '리뷰', influencers: [] }).ok);
  const withTarget = parseTaskCreate({ type: 'other', targetTweetUrl: 'https://x.com/a/status/1850000000000000000', influencers: [] });
  assert.ok(!withTarget.ok); assert.equal(withTarget.message, OTHER_NO_DRAFT_TARGET_MESSAGE);
  assert.ok(!parseTaskCreate({ type: 'other', draftId: '00000000-0000-4000-8000-000000000001', influencers: [] }).ok);
});
test('새 작업 본문 — 기타 협찬이면 무엇을 했는지를 싣고, 다른 유형이면 싣지 않는다', () => {
  const base = { handle: null, cost: null, scheduledOn: null, visitOn: null, note: '', target: null, draftId: null };
  assert.equal(buildTaskCreateBody({ ...base, type: 'other', otherKind: ' 상담회 참석 ' }).otherKind, '상담회 참석');
  assert.equal('otherKind' in buildTaskCreateBody({ ...base, type: 'other', otherKind: '' }), false);
  assert.equal('otherKind' in buildTaskCreateBody({ ...base, type: 'post', otherKind: '리뷰' }), false);
});

// ── 009 링크 없이 게시 확인과 섞이지 않는다 ──
test('링크 없는 게시(009)는 X 게시물 유형만 — 기타 협찬의 링크 없는 완료는 다른 규칙(otherTask)', () => {
  const t = { type: 'other' as const, postedAt: TODAY, postUrl: null, removedAt: TODAY, removedReason: '이유' };
  assert.equal(isLinklessPosted(t), false);
  assert.equal(linklessGateError({ ...t, postedAt: null }, { postedAt: TODAY }), null);
});

// ── 정산 ──
test('정산 문구 — 품목에 무엇을 했는지를 괄호로, 목적은 {클라이언트} {무엇을 했는지} 협찬(결정 9)', () => {
  assert.equal(itemText('yumi', 'other', '구글맵 리뷰'), '@yumi 기타 협찬(구글맵 리뷰) 1건 정산');
  assert.equal(itemText('yumi', 'post', '무시됨'), '@yumi 투고 1건 정산');
  assert.equal(purposeText('가은치유한의원', 'visit', 'other', '구글맵 리뷰'), '가은치유한의원 구글맵 리뷰 협찬');
  assert.equal(purposeText('블리비', 'content', 'other', '  상담회   참석 '), '블리비 상담회 참석 협찬');
  assert.equal(purposeText('블리비', 'content', 'post'), '블리비 정보성 콘텐츠 Viral 협찬');   // 기존 문구 그대로
  assert.ok(referenceRequiredFor('other'));
});
test('정산 기본 분류 — 코드 기본값에 기타 유형(X 없음)이 기타 협찬의 기본, 설정 검사가 other를 받는다', () => {
  const c = defaultCategoryFor(SETTLEMENT_DEFAULTS, 'other');
  assert.equal(c?.id, CATEGORY_ID_OTHER);
  assert.equal(c?.label, '기타 유형');
  assert.equal(c?.sendAs, '기타 유형');
  assert.ok(!/X/.test(c?.sendAs ?? ''));
  assert.equal(typeof sanitizeSettlementSettings(SETTLEMENT_DEFAULTS), 'object');
});
const method = { id: 'm1', type: 'paypal' as const, holder: 'Yumi', currency: 'KRW' as const, email: 'y@example.com', fee: null };
const candInput = (task: Partial<CandidateInput['task']>): CandidateInput => ({
  task: { id: 't1', type: 'other', influencerHandle: 'yumi', cost: { amount: 30000, currency: 'KRW' }, postUrl: null, targetTweetUrl: null, targetPostUrl: null,
    postedAt: TODAY, removedAt: null, removedReason: '', draftLabel: null, proof: null, hasAgreement: false, otherKind: '상담회 참석', doneNote: '현장 참석 확인', ...task },
  campaign: { id: 'c1', name: '[QA] 캠페인', kind: 'content', clientId: 'cl1', clientName: '[QA] 클리닉' },
  influencer: { inRoster: true, method: method as never },
  settings: SETTLEMENT_DEFAULTS, lastQuoteRtCategory: null, today: TODAY,
});
test('정산 후보 — 링크 없이 완료한 기타 협찬: 링크 null + note "[링크 없음] …", 막지 않고 알림(🟡)', () => {
  const c = computeCandidate(candInput({}));
  assert.equal(c.referenceDefault, null);
  assert.equal(c.linklessNote, '[링크 없음] 상담회 참석 — 현장 참석 확인 (완료 11/6)');
  assert.equal(c.categoryDefault, '기타 유형');
  assert.equal(c.itemText, '@yumi 기타 협찬(상담회 참석) 1건 정산');
  assert.equal(c.otherKind, '상담회 참석');
  assert.equal(c.readiness, 'warn');
  assert.ok(c.issues.some((i) => i.code === 'no-reference' && i.level === 'warn' && i.text.includes('확인 메모')));
});
test('정산 후보 — 링크로 완료한 기타 협찬: 그 링크가 참고 링크, note 없음, 바로 보낼 수 있음(🟢)', () => {
  const c = computeCandidate(candInput({ postUrl: 'https://maps.app.goo.gl/AbC123', doneNote: '', otherKind: '구글맵 리뷰' }));
  assert.equal(c.referenceDefault, 'https://maps.app.goo.gl/AbC123');
  assert.equal(c.linklessNote, null);
  assert.equal(c.readiness, 'ready');
});
test('정산 후보 — 링크도 메모도 없는 기타 협찬(옛 데이터 방어)은 막힌다(🔴)', () => {
  const c = computeCandidate(candInput({ doneNote: '' }));
  assert.equal(c.readiness, 'blocked');
  assert.ok(c.issues.some((i) => i.code === 'no-reference' && i.level === 'blocked'));
});
test('링크 없는 완료 메모 — 링크가 있으면 null', () => {
  assert.equal(otherLinklessNote({ type: 'other', postedAt: TODAY, postUrl: 'https://a.b', otherKind: 'x', doneNote: 'm' }), null);
  assert.equal(isOtherLinklessDone({ type: 'post', postedAt: TODAY, postUrl: null, doneNote: 'm' }), false);
});

// ── 외부: 마케팅 비용·확장 ──
test('마케팅 비용 — 기타 협찬은 other_type(기타 유형)', () => {
  assert.equal(CATEGORY_BY_TASK_TYPE.other, 'other_type');
});
test('확장 — 기타 협찬은 kind "other", 콘텐츠 작업 분기(방문 단계 없음)', () => {
  assert.equal(WIRE_KIND.other, 'other');
  const facts: TaskFacts = {
    id: 't1', campaignId: 'c1', campaignName: '[QA] 캠페인', type: 'other', influencerHandle: 'yumi', draftStatus: null,
    postedAt: TODAY, postUrl: null, removedAt: null, cancelledAt: null, scheduledOn: '2026-11-05', visitOn: null,
    cost: { amount: 30000, currency: 'KRW' }, noCost: false, version: 1, hasConsent: false, visitCompletedAt: null,
    settlement: null, endKind: null, reservation: null, requestCount: 0,
  };
  const c = classifyTask(facts, TODAY);
  assert.equal(c.visitPhase, null);
  assert.equal(c.bucket, 'active');
  const dto = toTaskDto(facts, c, 'p1', TODAY, 'https://example.com');
  assert.equal(dto.kind, 'other');
  assert.equal(dto.title, '[QA] 캠페인 · 기타 협찬');
});

// ── 캠페인 화면 ──
test('캠페인 화면 — 원고 칸엔 무엇을 했는지, 표시 순서 끝에 기타 협찬, 한 번에 만들기·성과 페이지 목록엔 없음', () => {
  const row = { type: 'other', cancelledAt: null, otherKind: '구글맵 리뷰', draftId: null } as unknown as FlowRow;
  assert.deepEqual(draftCell(row), { text: '구글맵 리뷰', muted: false, title: '구글맵 리뷰' });
  assert.deepEqual(draftCell({ ...row, otherKind: '' } as FlowRow), { text: '미정', muted: true, title: '' });
  assert.equal(DISPLAY_TYPE_ORDER.at(-1), 'other');
  assert.ok(!X_TYPE_ORDER.includes('other'));
  assert.deepEqual(PANEL_FIELD_ORDER.other, ['influencer', 'otherKind', 'cost', 'scheduled', 'note']);
  assert.equal(profilePromptFor({ option: { id: 'i1', handle: 'yumi', pricing: {} } as never, type: 'other', cost: { amount: 1, currency: 'KRW' } }), null);
});

// ── 스크린샷으로 완료 확인(koo 11-06 2차) ──
import { proofGateError } from './campaignTaskInput.ts';
import { PROOF_ONLY_RT_MESSAGE, PROOF_KEEP_MESSAGE } from './taskProofGuard.ts';
const TID = '11111111-1111-4111-8111-111111111111';
const shot = (taskId = TID) => `task/${taskId}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;
const proofObj = (taskId = TID) => ({ url: shot(taskId), by: null, byName: 'koo', at: '2026-11-06T01:00:00.000Z' });

test('스크린샷 — 기타 협찬에도 붙일 수 있다(RT와 같은 경로 검사), 다른 유형은 지금처럼 거절', () => {
  assert.equal(proofGateError({ id: TID, type: 'other', postedAt: null, proof: null }, { proofUrl: shot() }), null);
  assert.equal(proofGateError({ id: TID, type: 'post', postedAt: null, proof: null }, { proofUrl: shot() }), PROOF_ONLY_RT_MESSAGE);
  // 남의 작업 경로는 거절(RT와 같은 ②)
  assert.notEqual(proofGateError({ id: TID, type: 'other', postedAt: null, proof: null }, { proofUrl: shot('22222222-2222-4222-8222-222222222222') }), null);
  // 완료된 기타 협찬의 스크린샷 떼기는 여기서 막지 않는다(RT는 막는다) — 남는 자료가 있는지는 otherGateError가 본다
  assert.equal(proofGateError({ id: TID, type: 'other', postedAt: TODAY, proof: proofObj() }, { proofUrl: null }), null);
  assert.equal(proofGateError({ id: TID, type: 'rt', postedAt: TODAY, proof: proofObj() }, { proofUrl: null }), PROOF_KEEP_MESSAGE);
});
test('스크린샷 — 완료 확인 자료는 링크·스크린샷·메모 중 하나 이상(스크린샷만으로 완료 가능)', () => {
  const k = { ...cur, otherKind: '구글맵 리뷰' };
  assert.equal(otherGateError(k, { postedAt: TODAY, proofUrl: shot() }, TODAY), null);
  assert.equal(otherGateError(k, { postedAt: TODAY, proofUrl: shot(), postUrl: 'https://maps.app.goo.gl/x' }, TODAY), null);   // 둘 다도 된다
  assert.equal(otherGateError(k, { postedAt: TODAY }, TODAY), DONE_NOTE_REQUIRED_MESSAGE);
});
test('스크린샷 — 완료 뒤 떼서 확인 자료가 0개가 되면 막고, 링크·메모가 남으면 뗄 수 있다', () => {
  const done = { ...cur, otherKind: '구글맵 리뷰', postedAt: TODAY, proof: proofObj() };
  assert.equal(otherGateError(done, { proofUrl: null }, TODAY), DONE_NOTE_REQUIRED_MESSAGE);
  assert.equal(otherGateError({ ...done, postUrl: 'https://a.b' }, { proofUrl: null }, TODAY), null);
  assert.equal(otherGateError({ ...done, doneNote: '현장 확인' }, { proofUrl: null }, TODAY), null);
  assert.equal(otherGateError(done, { proofUrl: shot() }, TODAY), null);   // 바꾸기는 된다
  // 링크만 있던 건에서 링크를 지우면 0개
  assert.equal(otherGateError({ ...cur, otherKind: 'x', postedAt: TODAY, postUrl: 'https://a.b' }, { postUrl: null }, TODAY), DONE_NOTE_REQUIRED_MESSAGE);
});
test('스크린샷 — 정산 note: 스크린샷만이면 [스크린샷 확인], 메모도 있으면 붙이고, 링크가 있으면 note 없음', () => {
  const t = { type: 'other' as const, postedAt: TODAY, postUrl: null, otherKind: '구글맵 리뷰', doneNote: '', proof: proofObj() };
  assert.equal(otherLinklessNote(t), '[스크린샷 확인] 구글맵 리뷰 (완료 11/6)');
  assert.equal(otherLinklessNote({ ...t, doneNote: '별점 5' }), '[스크린샷 확인] 구글맵 리뷰 — 별점 5 (완료 11/6)');
  assert.equal(otherLinklessNote({ ...t, postUrl: 'https://a.b' }), null);
  assert.ok(isOtherLinklessDone(t));
});
test('스크린샷 — 정산 후보: 링크 없이 스크린샷만이면 링크 null + proof + [스크린샷 확인] note, 막지 않음(🟡)', () => {
  const c = computeCandidate(candInput({ otherKind: '구글맵 리뷰', doneNote: '', proof: proofObj('t1') as never }));
  assert.equal(c.referenceDefault, null);
  assert.equal(c.proof?.url, shot('t1'));
  assert.equal(c.linklessNote, '[스크린샷 확인] 구글맵 리뷰 (완료 11/6)');
  assert.equal(c.readiness, 'warn');
  assert.ok(!c.issues.some((i) => i.level === 'blocked'));
  // 링크 + 스크린샷: 링크가 참고 링크, note 없음, 🟢
  const both = computeCandidate(candInput({ otherKind: '구글맵 리뷰', doneNote: '', postUrl: 'https://maps.app.goo.gl/x', proof: proofObj('t1') as never }));
  assert.equal(both.readiness, 'ready'); assert.equal(both.linklessNote, null); assert.equal(both.proof?.url, shot('t1'));
});
