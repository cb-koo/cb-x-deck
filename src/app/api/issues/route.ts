import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { createIssue, listIssues } from '@/lib/issueReportStore';
import { notifyIssueToSlack } from '@/lib/issueSlack';
import { ISSUE_TABS, MAX_ISSUE_BODY, isIssueHandler, isIssueScreenshotPath, sanitizeLocation, type IssueTab } from '@/lib/issueReport';

// 이슈 목록(스펙 §4) — 탭 하나의 목록 + 세 탭 건수 + 내 안 본 답 수 + 내가 처리 담당자인지
export async function GET(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const t = new URL(req.url).searchParams.get('tab');
  const tab: IssueTab = (ISSUE_TABS as readonly string[]).includes(t ?? '') ? (t as IssueTab) : 'todo';
  const r = await listIssues(getSql(), tab, gate.member.id);
  return NextResponse.json({ ...r, tab, canHandle: isIssueHandler(gate.user.email), memberId: gate.member.id });
}

// 새 이슈 — 저장한 뒤 슬랙에 한 줄(실패해도 저장은 성공)
export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const b = (await req.json().catch(() => null)) as { body?: unknown; screenshotPath?: unknown; location?: unknown } | null;
  const body = typeof b?.body === 'string' ? b.body.trim() : '';
  if (!body) return NextResponse.json({ error: '내용을 적어 주세요' }, { status: 400 });
  if (body.length > MAX_ISSUE_BODY) return NextResponse.json({ error: `${MAX_ISSUE_BODY}자까지 쓸 수 있어요` }, { status: 400 });
  const location = sanitizeLocation(b?.location);
  if (!location) return NextResponse.json({ error: '보낸 화면을 알 수 없어요 — 새로고침 후 다시 보내 주세요' }, { status: 400 });
  const shot = b?.screenshotPath ?? null;
  if (shot !== null && !isIssueScreenshotPath(shot)) return NextResponse.json({ error: '스크린샷을 다시 붙여 넣어 주세요' }, { status: 400 });

  const issue = await createIssue(getSql(), {
    reporterId: gate.member.id, reporterName: gate.member.name, body, screenshotPath: shot, location,
  });
  await notifyIssueToSlack(issue, new URL(req.url).origin);
  return NextResponse.json(issue, { status: 201 });
}
