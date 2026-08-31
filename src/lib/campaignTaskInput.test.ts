import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskCreate, parseTaskPatch, proofGateError, normalizeTargetTweetUrl, parseTaskIdPatch, TASK_TYPE_MESSAGE, TARGET_MESSAGE, POST_URL_MESSAGE, VISIT_ON_MESSAGE, DRAFT_MULTI_MESSAGE, POSTED_AT_NULL_MESSAGE, DATE_MESSAGE } from './campaignTaskInput.ts';
import { PROOF_VALUE_MESSAGE, PROOF_ONLY_RT_MESSAGE, PROOF_KEEP_MESSAGE, PROOF_REQUIRED_MESSAGE } from './taskProofGuard.ts';

const U = '11111111-1111-1111-1111-111111111111';

test('생성 — 정규화된 핸들·비용, 대상 링크 permalink 정규화, 빈 인플 허용, 오류 문구', () => {
  const ok = parseTaskCreate({ type: 'rt', targetTweetUrl: 'twitter.com/Mika/status/123?s=20', influencers: [{ handle: '@Rio', cost: { amount: '3,000', currency: 'JPY' } }, { handle: 'sora' }], scheduledOn: '2026-09-03', note: ' 메모 ' });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.targetTweetUrl, 'https://x.com/Mika/status/123');
    assert.deepEqual(ok.value.influencers, [
      { handle: 'Rio', cost: { amount: 3000, currency: 'JPY' }, scheduledOn: null, visitOn: null },
      { handle: 'sora', cost: null, scheduledOn: null, visitOn: null },
    ]);
    assert.equal(ok.value.note, '메모'); assert.equal(ok.value.draftId, null); assert.equal(ok.value.visitOn, null); assert.equal(ok.value.cost, null);
  }
  assert.ok(parseTaskCreate({ type: 'post', influencers: [] }).ok);
  assert.ok(parseTaskCreate({ type: 'post' }).ok);   // influencers 생략 = []
  assert.deepEqual(parseTaskCreate({ type: 'x' }), { ok: false, message: TASK_TYPE_MESSAGE });
  assert.deepEqual(parseTaskCreate({ type: 'rt', targetTweetUrl: 'https://example.com' }), { ok: false, message: TARGET_MESSAGE });
  assert.deepEqual(parseTaskCreate({ type: 'rt', visitOn: '2026-09-01' }), { ok: false, message: VISIT_ON_MESSAGE });
  assert.deepEqual(parseTaskCreate({ type: 'post', draftId: U, influencers: [{ handle: 'a' }, { handle: 'b' }] }), { ok: false, message: DRAFT_MULTI_MESSAGE });
  assert.deepEqual(parseTaskCreate({ type: 'post', scheduledOn: '2026-9-1' }), { ok: false, message: DATE_MESSAGE });
  assert.equal(parseTaskCreate({ type: 'post', influencers: [{ handle: 'bad handle!' }] }).ok, false);
  assert.equal(parseTaskCreate({ type: 'rt', targetTaskId: 'nope' }).ok, false);
  assert.equal(parseTaskCreate({ type: 'visit', visitOn: '2026-09-10', influencers: [{ handle: 'h' }] }).ok, true);
});

test('생성 — 사람별 날짜(인플마다 게시일이 다르다), 형식 오류·방문일은 방문협찬만', () => {
  const ok = parseTaskCreate({ type: 'visit', scheduledOn: '2026-09-01', influencers: [
    { handle: 'Rio', scheduledOn: '2026-09-03', visitOn: '2026-09-02' },
    { handle: 'sora' },   // 줄에 날짜가 없으면 null — 기본값을 쓰는 건 저장소 쪽 규칙
  ] });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.value.influencers, [
      { handle: 'Rio', cost: null, scheduledOn: '2026-09-03', visitOn: '2026-09-02' },
      { handle: 'sora', cost: null, scheduledOn: null, visitOn: null },
    ]);
    assert.equal(ok.value.scheduledOn, '2026-09-01');
  }
  assert.deepEqual(parseTaskCreate({ type: 'post', influencers: [{ handle: 'a', scheduledOn: '2026-9-3' }] }), { ok: false, message: DATE_MESSAGE });
  assert.deepEqual(parseTaskCreate({ type: 'post', influencers: [{ handle: 'a', visitOn: '2026-09-03' }] }), { ok: false, message: VISIT_ON_MESSAGE });
  // 빈 문자열은 '안 적음'과 같다(달력 칸을 비운 상태)
  const blank = parseTaskCreate({ type: 'post', influencers: [{ handle: 'a', scheduledOn: '' }] });
  assert.ok(blank.ok && blank.value.influencers[0].scheduledOn === null);
});

test('패치 — 온 키만, null=지움, postedAt null 거절, removedReason trim', () => {
  const p = parseTaskPatch({ scheduledOn: null, cost: { amount: 1, currency: 'KRW' }, removedAt: '2026-09-05', removedReason: ' 본인 요청 ', postUrl: 'x.com/a/status/9' });
  assert.ok(p.ok);
  if (p.ok) {
    assert.deepEqual(p.value, { scheduledOn: null, cost: { amount: 1, currency: 'KRW' }, removedAt: '2026-09-05', removedReason: '본인 요청', postUrl: 'https://x.com/a/status/9' });
    assert.equal('note' in p.value, false);
  }
  // 같은 파서를 쓰지만 오류 문구는 사용자가 채운 칸을 가리킨다 — 게시물 링크는 'RT 대상'이라고 말하지 않는다
  assert.deepEqual(parseTaskPatch({ postUrl: 'nope' }), { ok: false, message: POST_URL_MESSAGE });
  assert.deepEqual(parseTaskPatch({ targetTweetUrl: 'nope' }), { ok: false, message: TARGET_MESSAGE });
  assert.deepEqual(parseTaskPatch({ postedAt: null }), { ok: false, message: POSTED_AT_NULL_MESSAGE });
  assert.ok(parseTaskPatch({ postedAt: '2026-09-01' }).ok);
  assert.ok(parseTaskPatch({ influencerHandle: null }).ok);
  assert.equal(parseTaskPatch({ influencerHandle: 'bad handle' }).ok, false);
  assert.equal(parseTaskPatch({}).ok, true);
  assert.equal(normalizeTargetTweetUrl('https://x.com/i/web/status/55'), 'https://x.com/i/status/55');
  assert.equal(normalizeTargetTweetUrl('nope'), null);
  assert.deepEqual(parseTaskIdPatch(undefined), { ok: true, value: undefined });
});

const P_TASK = '11111111-2222-3333-4444-555555555555';
const P_FILE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const P_OK = `task/${P_TASK}/${P_FILE}.png`;

test('parseTaskPatch — 증빙 경로는 통과, 임의 URL은 거절', () => {
  const ok = parseTaskPatch({ proof: P_OK });
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.value.proofUrl, P_OK);

  const bad = parseTaskPatch({ proof: 'https://evil.example/pixel.png' });
  assert.equal(bad.ok, false);
  assert.equal(bad.ok === false && bad.message, PROOF_VALUE_MESSAGE);

  const obj = parseTaskPatch({ proof: { url: P_OK, byName: '남의 이름' } });
  assert.equal(obj.ok, false);   // 객체는 받지 않는다 — 서버가 by/byName/at을 채운다
});

test('parseTaskPatch — 증빙 null은 떼기(파서 단계에서는 허용)', () => {
  const r = parseTaskPatch({ proof: null });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value.proofUrl, null);
});

test('parseTaskPatch — 증빙 키가 없으면 결과에도 없다(건드리지 않음)', () => {
  const r = parseTaskPatch({ note: '메모' });
  assert.equal(r.ok, true);
  assert.equal(r.ok && 'proofUrl' in r.value, false);
});

// ── proofGateError — RT 증빙 3규칙 판정(패치 후 상태로 봐야 한다) ──
// 픽스처는 실제 TaskProof 모양을 그대로 쓴다 — 껍데기 객체를 쓰면 테스트가 계약을 고정하지 못한다.
const savedProof = { url: P_OK, by: null, byName: '박구건', at: '2026-08-30T01:00:00.000Z' };
const rtUnposted = { id: P_TASK, type: 'rt' as const, postedAt: null, proof: savedProof };
const rtUnpostedNoProof = { id: P_TASK, type: 'rt' as const, postedAt: null, proof: null };
const rtPosted = { id: P_TASK, type: 'rt' as const, postedAt: '2026-08-20', proof: savedProof };
const postUnposted = { id: P_TASK, type: 'post' as const, postedAt: null, proof: null };

test('proofGateError — 구멍: 한 요청에 postedAt+proofUrl:null을 합치면(패치 전 증빙 있음, 미게시 RT) 거절', () => {
  // 이게 리뷰에서 Critical로 잡힌 우회다: cur.proof(패치 전)만 보면 통과해 버린다.
  // 문구는 '증빙이 필요하다'여야 한다 — 그 작업은 아직 게시됨이 아니라 '떼기 금지'가 사실과 어긋난다(문구-값 일치).
  assert.equal(proofGateError(rtUnposted, { postedAt: '2026-09-01', proofUrl: null }), PROOF_REQUIRED_MESSAGE);
});

test('proofGateError — 다른 작업의 경로는 거절(모양만 맞는 값으로 남의 객체를 가리킬 수 없다)', () => {
  const otherTask = '99999999-8888-7777-6666-555555555555';
  const otherPath = `task/${otherTask}/${P_FILE}.png`;
  assert.equal(proofGateError(rtUnpostedNoProof, { proofUrl: otherPath }), PROOF_VALUE_MESSAGE);
  // 자기 작업 경로는 통과한다 — 과잉 차단이 아닌지 함께 못박는다
  assert.equal(proofGateError(rtUnpostedNoProof, { proofUrl: P_OK }), null);
});

test('proofGateError — 한 요청에 postedAt+올바른 proofUrl은 통과', () => {
  assert.equal(proofGateError(rtUnpostedNoProof, { postedAt: '2026-09-01', proofUrl: P_OK }), null);
});

test('proofGateError — postedAt만, 패치 전 증빙 있음 → 통과(증빙을 안 건드리는 정상 경로)', () => {
  assert.equal(proofGateError(rtUnposted, { postedAt: '2026-09-01' }), null);
});

test('proofGateError — postedAt만, 증빙 없음, RT → 거절(필수)', () => {
  assert.equal(proofGateError(rtUnpostedNoProof, { postedAt: '2026-09-01' }), PROOF_REQUIRED_MESSAGE);
});

test('proofGateError — postedAt만, 증빙 없음, post 유형 → 통과(RT만 요구한다)', () => {
  assert.equal(proofGateError(postUnposted, { postedAt: '2026-09-01' }), null);
});

test('proofGateError — 이미 게시됨인 RT에서 증빙을 떼면 거절(떼기 금지)', () => {
  assert.equal(proofGateError(rtPosted, { proofUrl: null }), PROOF_KEEP_MESSAGE);
});

test('proofGateError — 미게시 RT는 증빙을 자유롭게 뗄 수 있다', () => {
  assert.equal(proofGateError(rtUnposted, { proofUrl: null }), null);
});

test('proofGateError — post 유형에 증빙을 붙이면 거절(범위)', () => {
  assert.equal(proofGateError(postUnposted, { proofUrl: P_OK }), PROOF_ONLY_RT_MESSAGE);
});
