import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendCampaignStatus, authorize, pickChannel, ALLOWED_CHANNELS, type SendDeps } from './campaignStatusSend.ts';
import { buildOverview, resolveWeek, type Overview } from './campaignOverview.ts';
import type { CampaignRow } from './campaignStore.ts';
import type { SlackBlock } from './campaignStatusSlack.ts';

const camp = (over: Partial<CampaignRow>): CampaignRow => ({
  id: 'c', clientId: 'A', clientName: '가', name: '캠페인', nameEn: '', startsOn: '2026-11-09', endsOn: '2026-11-15',
  kind: null, note: '', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', closedAt: null, closedByName: null,
  taskCount: 0, progress: { planned: 0, posted: 0, assigned: 0, unassigned: 0 }, total: {}, influencerHandles: [], ...over,
});
const week = resolveWeek(null, '2026-11-12');
const withCard: Overview = buildOverview([{ campaign: camp({}), tasks: [], points: [], visitPhases: {}, perfUpdatedAt: null }], [], week, '2026-11-12');
const empty: Overview = buildOverview([], [], week, '2026-11-12');

type Posted = { channel: string; msg: { text: string; blocks: SlackBlock[] } };
function deps(over: Partial<SendDeps> & { at?: string; overview?: Overview } = {}) {
  const posted: Posted[] = [], logs: string[] = [];
  let renders = 0;
  const d: SendDeps = {
    now: () => new Date(over.at ?? '2026-11-12T01:30:00Z'),
    loadOverview: async () => over.overview ?? withCard,
    renderPng: async () => { renders++; return new ArrayBuffer(4); },
    upload: async () => 'F9',
    post: async (channel, msg) => { posted.push({ channel, msg }); return { ts: '1.2' }; },
    log: (m) => { logs.push(m); },
    ...over,
  };
  return { d, posted, logs, renders: () => renders };
}

test('공휴일이면 보내지 않는다', async () => {
  const { d, posted } = deps({ at: '2026-12-25T01:30:00Z' });
  assert.deepEqual(await sendCampaignStatus('C0CGWSFBDPV', d), { skipped: 'holiday', name: '기독탄신일' });
  assert.equal(posted.length, 0);
});

test('이미지 실패해도 글은 보낸다', async () => {
  const { d, posted, logs } = deps({ renderPng: async () => { throw new Error('font missing'); } });
  const r = await sendCampaignStatus('C0CGWSFBDPV', d);
  assert.deepEqual(r, { sent: true, channel: 'C0CGWSFBDPV', ts: '1.2', withImage: false });
  assert.equal(posted.length, 1);
  assert.ok(!posted[0].msg.blocks.some((b) => b.type === 'image'));
  assert.equal(logs.length, 1);
});

test('업로드 실패도 글만 보낸다', async () => {
  const { d, posted } = deps({ upload: async () => { throw new Error('upload failed'); } });
  const r = await sendCampaignStatus('C0CGWSFBDPV', d);
  assert.equal('withImage' in r && r.withImage, false);
  assert.equal(posted.length, 1);
});

test('업로드 성공이면 image 블록에 그 파일 id', async () => {
  const { d, posted } = deps();
  const r = await sendCampaignStatus('C0AD9E5HE1K', d);
  assert.deepEqual(r, { sent: true, channel: 'C0AD9E5HE1K', ts: '1.2', withImage: true });
  const img = posted[0].msg.blocks.find((b) => b.type === 'image') as { slack_file: { id: string } };
  assert.equal(img.slack_file.id, 'F9');
});

test('목록 없는 해는 보내고 표시를 남긴다', async () => {
  const { d, posted, logs } = deps({ at: '2028-01-05T01:30:00Z' });
  const r = await sendCampaignStatus('C0CGWSFBDPV', d);
  assert.equal('holidayListMissing' in r && r.holidayListMissing, true);
  assert.equal(posted.length, 1);
  assert.equal(logs.length, 1);
});

test('카드 0개면 그리지 않는다', async () => {
  const { d, renders, posted } = deps({ overview: empty });
  const r = await sendCampaignStatus('C0CGWSFBDPV', d);
  assert.equal('withImage' in r && r.withImage, false);
  assert.equal(renders(), 0);
  assert.equal(posted.length, 1);
});

test('공휴일 판단은 한국 날짜 기준 — UTC로는 전날 밤이어도 한국이 공휴일이면 건너뛴다', async () => {
  const { d } = deps({ at: '2026-12-24T16:30:00Z' });   // 12/25 01:30 KST
  assert.deepEqual(await sendCampaignStatus('C0CGWSFBDPV', d), { skipped: 'holiday', name: '기독탄신일' });
});

test('전송 실패는 그대로 던진다(재전송 없음)', async () => {
  const { d } = deps({ post: async () => { throw new Error('not_in_channel'); } });
  await assert.rejects(sendCampaignStatus('C0CGWSFBDPV', d), /not_in_channel/);
});

test('authorize: 시크릿 없음, 틀림은 401, 맞으면 null', () => {
  const req = (h?: string) => new Request('https://x/api', { method: 'POST', headers: h ? { authorization: h } : {} });
  assert.equal(authorize(req('Bearer s'), undefined)?.status, 401);
  assert.equal(authorize(req('Bearer wrong'), 's')?.status, 401);
  assert.equal(authorize(req(), 's')?.status, 401);
  assert.equal(authorize(req('Bearer s'), 's'), null);
});

test('pickChannel: 본문 채널 > 환경 변수, 허용 목록 밖은 400', () => {
  assert.equal(pickChannel({ channel: 'C0CGWSFBDPV' }, 'C0AD9E5HE1K'), 'C0CGWSFBDPV');
  assert.equal(pickChannel({}, 'C0AD9E5HE1K'), 'C0AD9E5HE1K');
  assert.equal((pickChannel({ channel: 'CEVIL' }, 'C0AD9E5HE1K') as Response).status, 400);
  assert.equal((pickChannel({}, undefined) as Response).status, 400);
  assert.deepEqual([...ALLOWED_CHANNELS], ['C0AD9E5HE1K', 'C0CGWSFBDPV']);
});

test('이미지 블록이 끝내 거절되면(invalid_blocks) 이미지 없이 한 번 더 보낸다', async () => {
  const { SlackApiError } = await import('./slackUpload.ts');
  const posted: Array<{ blocks: SlackBlock[] }> = [];
  const { d, logs } = deps({
    post: async (_ch, msg) => {
      posted.push(msg);
      if (msg.blocks.some((b) => b.type === 'image')) throw new SlackApiError('chat.postMessage', 'invalid_blocks');
      return { ts: '3.4' };
    },
  });
  const r = await sendCampaignStatus('C0CGWSFBDPV', d);
  assert.deepEqual(r, { sent: true, channel: 'C0CGWSFBDPV', ts: '3.4', withImage: false });
  assert.equal(posted.length, 2);
  assert.ok(!posted[1].blocks.some((b) => b.type === 'image'));
  assert.equal(logs.length, 1);
});

test('이미지 없는 메시지의 전송 오류는 다시 보내지 않고 던진다', async () => {
  const { SlackApiError } = await import('./slackUpload.ts');
  let calls = 0;
  const { d } = deps({ overview: empty, post: async () => { calls++; throw new SlackApiError('chat.postMessage', 'invalid_blocks'); } });
  await assert.rejects(sendCampaignStatus('C0CGWSFBDPV', d), /invalid_blocks/);
  assert.equal(calls, 1);
});
