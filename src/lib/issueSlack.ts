// 새 이슈 슬랙 알림(스펙 §6) — 서버 전용. 실패해도 이슈 저장은 성공이다: 보낸 사람에게 실패를 보이지 않고 로그만 남긴다.
// SLACK_ISSUE_WEBHOOK_URL은 운영(Production)에만 있다 — 스테이징·로컬에서는 조용히 건너뛴다.
import { slackIssueText, type IssueReport } from './issueReport.ts';

export async function notifyIssueToSlack(issue: IssueReport, origin: string): Promise<void> {
  const webhook = process.env.SLACK_ISSUE_WEBHOOK_URL;
  if (!webhook) return;
  const text = slackIssueText({
    reporterName: issue.reporterName, body: issue.body, location: issue.location,
    hasScreenshot: !!issue.screenshotPath, url: `${origin}/issues?id=${issue.id}`,
  });
  try {
    const res = await fetch(webhook, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(4000),   // 슬랙이 느려도 보내는 창이 오래 붙잡히지 않게
    });
    if (!res.ok) console.error('[issue-slack] 전송 실패', res.status, await res.text().catch(() => ''));
  } catch (e) {
    console.error('[issue-slack] 전송 실패', e instanceof Error ? e.message : e);
  }
}
