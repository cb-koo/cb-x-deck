// 불편 알리기 저장소 — issue_report(083, 번호·여러 장은 084). 스펙 2026-10-22-issue-report-design.md §3·§4
import type postgres from 'postgres';
import { locationOf, type IssueLocation, type IssueReport, type IssueStatus, type IssueTab } from './issueReport.ts';

type Row = {
  id: string; no: string; reporter_id: string | null; reporter_name: string; body: string; screenshot_path: string | null; screenshot_paths: string[] | null;
  location: unknown; status: IssueStatus; status_changed_at: Date | null; reply: string | null; replied_by_name: string | null;
  replied_at: Date | null; reply_seen_at: Date | null; created_at: Date;
};
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const toIssue = (r: Row): IssueReport => ({
  id: r.id, no: Number(r.no), reporterId: r.reporter_id, reporterName: r.reporter_name, body: r.body,
  // 여러 장 칸이 비어 있으면 1장 칸을 본다 — 084 적용 전후로 빌드 중 옛 코드가 1장 칸에만 쓴 줄이 생길 수 있다
  screenshotPaths: r.screenshot_paths?.length ? r.screenshot_paths : r.screenshot_path ? [r.screenshot_path] : [],
  location: locationOf(r.location), status: r.status, statusChangedAt: iso(r.status_changed_at),
  reply: r.reply, repliedByName: r.replied_by_name, repliedAt: iso(r.replied_at), replySeenAt: iso(r.reply_seen_at),
  createdAt: new Date(r.created_at).toISOString(),
});
const COLS = (sql: postgres.Sql) => sql`id, no::text as no, reporter_id, reporter_name, body, screenshot_path, screenshot_paths, location, status, status_changed_at,
  reply, replied_by_name, replied_at, reply_seen_at, created_at`;

export async function createIssue(sql: postgres.Sql, i: {
  reporterId: string; reporterName: string; body: string; screenshotPaths: string[]; location: IssueLocation;
}): Promise<IssueReport> {
  const rows = await sql<Row[]>`
    -- 첫 장은 1장 칸(083)에도 쓴다 — 되돌려 옛 코드가 돌아도 첫 장은 보이게
    insert into issue_report (reporter_id, reporter_name, body, screenshot_path, screenshot_paths, location)
    values (${i.reporterId}, ${i.reporterName}, ${i.body}, ${i.screenshotPaths[0] ?? null}, ${i.screenshotPaths}, ${sql.json(i.location as never)})
    returning ${COLS(sql)}`;
  return toIssue(rows[0]);
}

export async function getIssue(sql: postgres.Sql, id: string): Promise<IssueReport | null> {
  const rows = await sql<Row[]>`select ${COLS(sql)} from issue_report where id = ${id}`;
  return rows[0] ? toIssue(rows[0]) : null;
}

/** 탭 하나의 목록(최신순) + 세 탭의 건수 + 내 안 본 답 수. 2~5명이 쓰는 표라 한 번에 다 읽는다. */
export async function listIssues(sql: postgres.Sql, tab: IssueTab, memberId: string): Promise<{
  items: IssueReport[]; counts: Record<IssueTab, number>; unseen: number;
}> {
  const where = tab === 'mine' ? sql`reporter_id = ${memberId}`
    : tab === 'resolved' ? sql`status = 'resolved'`
    : sql`status <> 'resolved'`;
  const [items, counts] = await Promise.all([
    sql<Row[]>`select ${COLS(sql)} from issue_report where ${where} order by created_at desc`,
    sql<{ todo: number; resolved: number; mine: number; unseen: number }[]>`
      select count(*) filter (where status <> 'resolved')::int as todo,
             count(*) filter (where status = 'resolved')::int as resolved,
             count(*) filter (where reporter_id = ${memberId})::int as mine,
             count(*) filter (where ${unseenFor(sql, memberId)})::int as unseen
        from issue_report`,
  ]);
  const c = counts[0];
  return { items: items.map(toIssue), counts: { todo: c.todo, resolved: c.resolved, mine: c.mine }, unseen: c.unseen };
}

// 안 본 답 — issueReport.hasUnseenReply와 같은 판정을 SQL로
const unseenFor = (sql: postgres.Sql, memberId: string) =>
  sql`reporter_id = ${memberId} and reply is not null and replied_at is not null and (reply_seen_at is null or reply_seen_at < replied_at)`;

export async function countUnseenReplies(sql: postgres.Sql, memberId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`select count(*)::int as n from issue_report where ${unseenFor(sql, memberId)}`;
  return rows[0].n;
}

/**
 * 상태·답 바꾸기(처리 담당자만 — 권한은 라우트가 본다). undefined = 그대로.
 * 답 글자가 바뀌면 replied_at을 새로 찍는다 — 보낸 사람에게 다시 '안 본 답'으로 뜬다. 빈 글자는 답 지우기.
 */
export async function updateIssue(sql: postgres.Sql, id: string, patch: {
  status?: IssueStatus; reply?: string | null; byName: string;
}): Promise<IssueReport | null> {
  const cur = await getIssue(sql, id);
  if (!cur) return null;
  const nextStatus = patch.status ?? cur.status;
  const nextReply = patch.reply === undefined ? cur.reply : (patch.reply?.trim() || null);
  const statusChanged = nextStatus !== cur.status;
  const replyChanged = nextReply !== cur.reply;
  if (!statusChanged && !replyChanged) return cur;
  const rows = await sql<Row[]>`
    update issue_report set
      status = ${nextStatus},
      status_changed_at = ${statusChanged ? sql`now()` : sql`status_changed_at`},
      reply = ${nextReply},
      replied_by_name = ${replyChanged ? (nextReply ? patch.byName : null) : sql`replied_by_name`},
      replied_at = ${replyChanged ? (nextReply ? sql`now()` : null) : sql`replied_at`}
    where id = ${id}
    returning ${COLS(sql)}`;
  return rows[0] ? toIssue(rows[0]) : null;
}

/** 보낸 사람이 상세를 열었다 — 답을 봤음. 남의 이슈면 아무것도 안 한다. */
export async function markReplySeen(sql: postgres.Sql, id: string, memberId: string): Promise<void> {
  await sql`update issue_report set reply_seen_at = now() where id = ${id} and reporter_id = ${memberId} and reply is not null`;
}
