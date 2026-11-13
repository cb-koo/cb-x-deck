import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview, resolveWeek, type OverviewInput } from './campaignOverview.ts';
import { buildStatusMessage, sentAtLabel, tileDescriptions, STATUS_SCHEDULE_NOTE } from './campaignStatusSlack.ts';
import type { CampaignTaskItem, CampaignRow } from './campaignStore.ts';

let n = 0;
const task = (p: Partial<CampaignTaskItem>): CampaignTaskItem => ({
  id: `t${++n}`, campaignId: 'c', influencerHandle: null, type: 'post', draftId: null, targetTaskId: null, targetTweetUrl: null,
  postUrl: null, postedAt: null, postedSource: null, removedAt: null, removedReason: '', scheduledOn: null, visitOn: null, cost: null, note: '', otherKind: '', doneNote: '',
  proof: null, visitTime: null, scheduledTime: null, agreement: null, paymentMethodId: null, cancelledAt: null, cancelReason: null, cancelNote: '', cancelledDraftId: null, cancelledDraftTitle: null, settledElsewhereAt: null, settledElsewhereNote: '', settledElsewhereByName: null, costChangeCount: 0,
  createdAt: `2026-11-01T00:00:${String(n % 60).padStart(2, '0')}Z`, updatedAt: '', draftStatus: null, draftLabel: null, draftFirstLine: null,
  draftPreview: null, draftFirstImage: null, target: null,
  published: false, perf: null, replies: [], linkClicks: null, settlement: null, unseenSince: null, seenAfterRemovedAt: null, ...p,
});
const camp = (over: Partial<CampaignRow>): CampaignRow => ({
  id: 'c', clientId: null, clientName: null, name: '캠페인', nameEn: '', startsOn: '2026-11-09', endsOn: '2026-11-15',
  kind: null, note: '', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', closedAt: null, closedByName: null,
  taskCount: 0, progress: { planned: 0, posted: 0, assigned: 0, unassigned: 0 }, total: {}, influencerHandles: [], ...over,
});
const input = (c: Partial<CampaignRow>, tasks: CampaignTaskItem[]): OverviewInput =>
  ({ campaign: camp(c), tasks, points: [], visitPhases: {}, perfUpdatedAt: null });
// 게시 m건 + 늦은 l건 + 앞으로 예정 f건 + 미정 u건
const tasks = (m: number, l = 0, f = 0, u = 0) => [
  ...Array.from({ length: m }, () => task({ postedAt: '2026-11-10' })),
  ...Array.from({ length: l }, () => task({ scheduledOn: '2026-11-10' })),
  ...Array.from({ length: f }, () => task({ scheduledOn: '2026-11-14' })),
  ...Array.from({ length: u }, () => task({ scheduledOn: null })),
];
const TODAY = '2026-11-12';
const AT = new Date('2026-11-12T01:30:00Z');   // 11/12 (목) 10:30 KST
const URL = 'https://cb-x-deck.vercel.app/campaigns/overview';
const week = resolveWeek(null, TODAY);
const ov = (inputs: OverviewInput[]) => buildOverview(inputs, [], week, TODAY);
const text = (b: unknown) => JSON.stringify(b);

const base = ov([
  input({ id: '1', clientId: 'A', clientName: '백수약국' }, tasks(2, 3, 1)),
  input({ id: '2', clientId: 'B', clientName: '벤자민클리닉' }, tasks(3, 2, 2)),
  input({ id: '3', clientId: 'C', clientName: '가은치유한의원' }, tasks(5)),
  input({ id: '4', clientId: 'D', clientName: '마인드' }, []),
]);

test('sentAtLabel: 보내는 순간의 한국 시각', () => {
  assert.equal(sentAtLabel(AT), '11/12 (목) 10:30 기준');
  assert.equal(sentAtLabel(new Date('2026-11-16T09:00:00Z')), '11/16 (월) 18:00 기준');
});

test('기본 메시지: 제목, 요약, 링크, 이미지, 안내 순서와 문구', () => {
  const m = buildStatusMessage(base, AT, { pageUrl: URL, imageFileId: 'F1' });
  assert.deepEqual(m.blocks.map((b) => b.type), ['section', 'section', 'section', 'image', 'context']);
  assert.match(text(m.blocks[0]), /📊 \*11월 2주차 캠페인 현황\*\\n11\/12 \(목\) 10:30 기준/);
  const sum = text(m.blocks[1]);
  assert.match(sum, /✅ 게시 완료  \*10 \/ 18건\* \(56%\)/);
  assert.match(sum, /⏰ 예정일 지난 미게시  \*5건\*  백수약국 3건, 벤자민클리닉 2건/);
  assert.match(sum, /🗓️ 남은 게시 예정  \*3건\*/);
  assert.match(sum, /⚪ 세팅 전  \*1개\*  마인드/);
  assert.equal(text(m.blocks[2]).includes(`👉 <${URL}|캠페인 현황 열기>  캠페인별 게시물과 성과는 여기서 봐요`), true);
  assert.deepEqual((m.blocks[3] as { slack_file: unknown }).slack_file, { id: 'F1' });
  assert.match(text(m.blocks[4]), /진행률이 높은 캠페인부터 보여줘요\. 방문협찬\(장기\) 캠페인은 빠져 있어요\. /);
  assert.ok(text(m.blocks[4]).includes(STATUS_SCHEDULE_NOTE));
  assert.equal(m.text, '📊 11월 2주차 캠페인 현황: 18건 중 10건 게시, 예정일 지난 미게시 5건');
});

test('늦은 건 0건이면 "없음" 줄, 예정일 미정 0건이면 꼬리 없음, 세팅 전 없으면 줄 없음', () => {
  const o = ov([input({ id: '1', clientId: 'A', clientName: '가' }, tasks(1, 0, 2))]);
  const m = buildStatusMessage(o, AT, { pageUrl: URL, imageFileId: 'F1' });
  const sum = text(m.blocks[1]);
  assert.match(sum, /✅ 예정일 지난 미게시 없음/);
  assert.match(sum, /🗓️ 남은 게시 예정  \*2건\*"/);   // 꼬리 없이 줄 끝(JSON 문자열 끝)
  assert.ok(!sum.includes('세팅 전'));
  assert.ok(m.text.endsWith('예정일 지난 미게시 없음'));
});

test('예정일 미정이 있으면 꼬리를 붙인다', () => {
  const o = ov([input({ id: '1', clientId: 'A', clientName: '가' }, tasks(1, 0, 1, 2))]);
  assert.match(text(buildStatusMessage(o, AT, { pageUrl: URL, imageFileId: null }).blocks[1]), /🗓️ 남은 게시 예정  \*3건\*  예정일 미정 2건 포함/);
});

test('늦은 클라이언트 4곳 → 3곳 + 외 1곳, 세팅 전 4곳 → 3곳 + 외 1곳', () => {
  const o = ov([
    ...['가', '나', '다', '라'].map((c, i) => input({ id: `l${i}`, clientId: c, clientName: c }, tasks(0, i + 1))),
    ...['마', '바', '사', '아'].map((c, i) => input({ id: `u${i}`, clientId: c, clientName: c }, [])),
  ]);
  const sum = text(buildStatusMessage(o, AT, { pageUrl: URL, imageFileId: null }).blocks[1]);
  assert.match(sum, /\*10건\*  라 4건, 다 3건, 나 2건, 외 1곳/);
  assert.match(sum, /⚪ 세팅 전  \*4개\*  마, 바, 사, 외 1곳/);
});

test('계획 0건(전부 세팅 전)이면 퍼센트 없이 0 / 0건', () => {
  const o = ov([input({ id: '1', clientId: 'A', clientName: '가' }, [])]);
  const sum = text(buildStatusMessage(o, AT, { pageUrl: URL, imageFileId: null }).blocks[1]);
  assert.match(sum, /✅ 게시 완료  \*0 \/ 0건\*"|✅ 게시 완료  \*0 \/ 0건\*\\n/);
  assert.ok(!sum.includes('%'));
});

test('카드 0개 → 이미지 없는 세 블록, imageFileId null → image 블록 없음', () => {
  const empty = buildStatusMessage(ov([]), AT, { pageUrl: URL, imageFileId: 'F1' });
  assert.deepEqual(empty.blocks.map((b) => b.type), ['section', 'section', 'section']);
  assert.ok(text(empty.blocks[1]).includes('이번 주에 시작한 주차 캠페인이 아직 없어요.'));
  const noImg = buildStatusMessage(base, AT, { pageUrl: URL, imageFileId: null });
  assert.ok(!noImg.blocks.some((b) => b.type === 'image'));
});

test('tileDescriptions는 화면 문구와 같다', () => {
  assert.deepEqual(tileDescriptions(base.tiles), {
    planned: '캠페인 4개, 1개는 세팅 전', overdue: '백수약국 3건, 벤자민클리닉 2건', remaining: null,
  });
  const o = ov([input({ id: '1', clientId: 'A', clientName: '가' }, tasks(1, 0, 0, 2))]);
  assert.deepEqual(tileDescriptions(o.tiles), { planned: '캠페인 1개', overdue: '없음', remaining: '예정일 미정 2건 포함' });
});

test('문구에 가운뎃점이 없다', () => {
  assert.ok(!text(buildStatusMessage(base, AT, { pageUrl: URL, imageFileId: 'F1' })).includes('·'));
});
