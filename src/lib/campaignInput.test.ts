import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCampaignCreate, parseCampaignPatch, checkPeriod,
  PERIOD_MESSAGE, NAME_MESSAGE, CLIENT_MESSAGE, DATE_MESSAGE, KIND_MESSAGE, NOTE_MESSAGE, NAME_MAX,
} from './campaignInput.ts';
import { campaignMessage } from './trackingLink.ts';

const CLIENT = '11111111-2222-4333-8444-555555555555';
const ok = {
  clientId: CLIENT, name: ' 리프팅 8월 4주 ', nameEn: 'lifting 20260824',
  startsOn: '2026-08-24', endsOn: '2026-08-30', kind: 'content', note: ' 메모 ',
};
const msg = (p: { ok: true } | { ok: false; message: string }) => (p.ok ? null : p.message);

test('1) 생성 — 트림·코드 정규화(공백→하이픈, checkCampaign)·유형·메모. 빈 유형·빈 메모는 null·\'\'', () => {
  assert.deepEqual(parseCampaignCreate(ok), { ok: true, value: {
    clientId: CLIENT, name: '리프팅 8월 4주', nameEn: 'lifting-20260824',
    startsOn: '2026-08-24', endsOn: '2026-08-30', kind: 'content', note: '메모',
  } });
  const noKind = parseCampaignCreate({ ...ok, kind: '', note: undefined });
  assert.ok(noKind.ok);
  if (noKind.ok) { assert.equal(noKind.value.kind, null); assert.equal(noKind.value.note, ''); }
  const nullKind = parseCampaignCreate({ ...ok, kind: null });
  if (nullKind.ok) assert.equal(nullKind.value.kind, null);
});

test('2) 생성 — 필수·형식 위반은 사용자 문구로(첫 위반 하나만), 하루짜리 기간 허용', () => {
  assert.equal(msg(parseCampaignCreate({ ...ok, clientId: 'abc' })), CLIENT_MESSAGE);
  assert.equal(msg(parseCampaignCreate({ ...ok, name: '  ' })), NAME_MESSAGE);
  assert.equal(msg(parseCampaignCreate({ ...ok, name: 'x'.repeat(NAME_MAX + 1) })), `캠페인 이름은 ${NAME_MAX}자까지 쓸 수 있어요`);
  assert.equal(msg(parseCampaignCreate({ ...ok, nameEn: '리프팅' })), campaignMessage('not-ascii'));
  assert.equal(msg(parseCampaignCreate({ ...ok, nameEn: '' })), campaignMessage('empty'));
  assert.equal(msg(parseCampaignCreate({ ...ok, startsOn: '2026-08-24T00:00:00Z' })), DATE_MESSAGE);
  assert.equal(msg(parseCampaignCreate({ ...ok, endsOn: '2026-8-30' })), DATE_MESSAGE);
  assert.equal(msg(parseCampaignCreate({ ...ok, startsOn: '2026-08-31' })), PERIOD_MESSAGE); // 종료 < 시작
  assert.equal(msg(parseCampaignCreate({ ...ok, kind: 'party' })), KIND_MESSAGE);
  assert.equal(msg(parseCampaignCreate({ ...ok, note: 3 })), NOTE_MESSAGE);
  assert.equal(msg(parseCampaignCreate(null)), CLIENT_MESSAGE);                          // 빈 body는 첫 필수 항목부터
  assert.equal(checkPeriod('2026-08-24', '2026-08-24'), null);                            // 같은 날 = 하루짜리, DB check와 같은 경계
  assert.equal(checkPeriod('2026-08-25', '2026-08-24'), PERIOD_MESSAGE);
});

test('3) 수정 — 온 키만 검증, kind null·\'\'=지움, 양쪽 날짜가 다 오면 순서 검사, 모르는 키는 무시', () => {
  assert.deepEqual(parseCampaignPatch({}), { ok: true, value: {} });
  assert.deepEqual(parseCampaignPatch({ name: ' 새 이름 ' }), { ok: true, value: { name: '새 이름' } });
  assert.deepEqual(parseCampaignPatch({ kind: null }), { ok: true, value: { kind: null } });
  assert.deepEqual(parseCampaignPatch({ kind: '' }), { ok: true, value: { kind: null } });
  assert.deepEqual(parseCampaignPatch({ kind: 'visit' }), { ok: true, value: { kind: 'visit' } });
  assert.deepEqual(parseCampaignPatch({ nameEn: 'Clinic A' }), { ok: true, value: { nameEn: 'Clinic-A' } });
  assert.deepEqual(parseCampaignPatch({ endsOn: '2026-09-06' }), { ok: true, value: { endsOn: '2026-09-06' } }); // 한쪽만 — 순서는 라우트가 기존값과 합쳐 본다
  assert.equal(msg(parseCampaignPatch({ startsOn: '2026-09-07', endsOn: '2026-09-06' })), PERIOD_MESSAGE);
  assert.equal(msg(parseCampaignPatch({ name: '' })), NAME_MESSAGE);
  assert.equal(msg(parseCampaignPatch({ note: 3 })), NOTE_MESSAGE);
  assert.deepEqual(parseCampaignPatch({ clientId: CLIENT, note: '' }), { ok: true, value: { note: '' } }); // 클라 변경은 범위 밖 — 키가 값에 실리지 않는다
});
