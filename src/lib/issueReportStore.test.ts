import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createIssue, getIssue, listIssues, updateIssue, markReplySeen, countUnseenReplies } from './issueReportStore.ts';

const sql = getSql();
const P = 'iss' + process.pid;
const UUID1 = '0b9c2b2e-1d1a-4c7e-9a43-2f1f6e4b8c01', UUID2 = '0b9c2b2e-1d1a-4c7e-9a43-2f1f6e4b8c02';
const LOC = { screen: '캠페인', title: null, panel: '작업 @a', dialog: '예약 추가', path: '/campaigns/flow', taskId: null, viewport: '1440×900' };

after(async () => {
  await sql`delete from issue_report where body like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});

async function member(suffix: string) {
  const [m] = await sql<{ id: string; name: string }[]>`insert into member (name) values (${P + suffix}) returning id, name`;
  return m;
}

test('보내고, 탭별로 나뉘고, 해결 답이 달리면 보낸 사람에게만 안 본 답이 센다', async () => {
  const a = await member('a'), b = await member('b');
  const i1 = await createIssue(sql, { reporterId: a.id, reporterName: a.name, body: P + ' 표가 안 바뀌어요', screenshotPaths: [`issue/2026-10/${UUID1}.png`, `issue/2026-10/${UUID2}.webp`], location: LOC });
  const i2 = await createIssue(sql, { reporterId: b.id, reporterName: b.name, body: P + ' 사진이 안 떠요', screenshotPaths: [], location: LOC });
  assert.equal(i1.status, 'open');
  // 번호는 보낸 순서대로, 스크린샷은 붙인 순서 그대로 — 첫 장은 1장 칸(083)에도 남는다
  assert.equal(i2.no, i1.no + 1);
  assert.deepEqual(i1.screenshotPaths, [`issue/2026-10/${UUID1}.png`, `issue/2026-10/${UUID2}.webp`]);
  assert.deepEqual(i2.screenshotPaths, []);
  const [legacy] = await sql<{ screenshot_path: string | null }[]>`select screenshot_path from issue_report where id = ${i1.id}`;
  assert.equal(legacy.screenshot_path, `issue/2026-10/${UUID1}.png`);
  // 빌드 중 옛 코드가 1장 칸에만 쓴 줄도 한 장으로 읽힌다
  await sql`update issue_report set screenshot_paths = '{}' where id = ${i1.id}`;
  assert.deepEqual((await getIssue(sql, i1.id))?.screenshotPaths, [`issue/2026-10/${UUID1}.png`]);
  assert.deepEqual(i1.location, LOC);

  const mine = (await listIssues(sql, 'mine', a.id)).items.map((i) => i.id);
  assert.deepEqual(mine, [i1.id]);
  const todo = (await listIssues(sql, 'todo', a.id)).items.map((i) => i.id);
  assert.ok(todo.includes(i1.id) && todo.includes(i2.id));

  // 확인 중 — 할 일에 남는다, 답 없음
  const c = await updateIssue(sql, i1.id, { status: 'checking', byName: '담당' });
  assert.equal(c?.status, 'checking');
  assert.ok(c?.statusChangedAt);
  assert.equal(c?.repliedAt, null);
  assert.equal(await countUnseenReplies(sql, a.id), 0);

  // 해결 + 답 — 해결됨 탭으로, a에게 안 본 답 1
  const r = await updateIssue(sql, i1.id, { status: 'resolved', reply: '  고쳤어요  ', byName: '담당' });
  assert.equal(r?.reply, '고쳤어요');
  assert.equal(r?.repliedByName, '담당');
  const listed = await listIssues(sql, 'resolved', a.id);
  assert.ok(listed.items.some((i) => i.id === i1.id));
  assert.equal(listed.unseen, 1);
  assert.equal(await countUnseenReplies(sql, b.id), 0);

  // 남(b)이 열어도 봤음이 안 된다, 보낸 사람(a)이 열면 된다
  await markReplySeen(sql, i1.id, b.id);
  assert.equal(await countUnseenReplies(sql, a.id), 1);
  await markReplySeen(sql, i1.id, a.id);
  assert.equal(await countUnseenReplies(sql, a.id), 0);

  // 답을 고치면 다시 새 답
  await new Promise((res) => setTimeout(res, 20));
  await updateIssue(sql, i1.id, { reply: '다시 고쳤어요', byName: '담당' });
  assert.equal(await countUnseenReplies(sql, a.id), 1);

  // 아무것도 안 바뀌면 그대로(시각도 안 찍힌다)
  const before = await getIssue(sql, i1.id);
  const same = await updateIssue(sql, i1.id, { status: 'resolved', reply: '다시 고쳤어요', byName: '다른 사람' });
  assert.equal(same?.repliedAt, before?.repliedAt);
  assert.equal(same?.repliedByName, '담당');

  // 답 지우기
  const cleared = await updateIssue(sql, i1.id, { reply: '', byName: '담당' });
  assert.equal(cleared?.reply, null);
  assert.equal(cleared?.repliedAt, null);
  assert.equal(await countUnseenReplies(sql, a.id), 0);

  assert.equal(await updateIssue(sql, '00000000-0000-4000-8000-000000000000', { status: 'open', byName: 'x' }), null);
});
