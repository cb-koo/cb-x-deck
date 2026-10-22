// 불편 알리기 — 브라우저 쪽(스토리지 업로드·서명, 화면에서 위치 모으기, 버튼 자리 재기). 순수 규칙은 issueReport.ts.
import { createClient } from './supabase/client.ts';
import {
  ISSUE_SCREENSHOT_BUCKET, issueScreenshotError, issueScreenshotPath, screenNameFor, FAB_SIZE, fabPosition,
  type IssueLocation,
} from './issueReport.ts';

// ── 스크린샷 ──
export async function uploadIssueScreenshot(file: File): Promise<string> {
  const err = issueScreenshotError(file);
  if (err) throw new Error(err);
  const path = issueScreenshotPath(file.type, crypto.randomUUID(), new Date());
  const { error } = await createClient().storage.from(ISSUE_SCREENSHOT_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new Error('스크린샷을 올리지 못했어요 — 다시 시도해주세요');
  return path;
}

export async function signIssueScreenshot(path: string): Promise<string> {
  const { data, error } = await createClient().storage.from(ISSUE_SCREENSHOT_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error('스크린샷을 불러오지 못했어요');
  return data.signedUrl;
}

// ── 위치 모으기(스펙 §2-3) ──
// 우리 자신(버튼·보내는 창)은 data-issue-report로 표시해 두고 모든 탐색에서 뺀다.
const OURS = '[data-issue-report]';
const PANEL_SEL = 'dialog[open], [role="dialog"]';

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const textOf = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim() || null;

function panelTitle(el: Element): string | null {
  // 머리글을 먼저 본다 — 작업 패널은 aria-label이 '작업 편집'이라 머리글('인용RT · @miyuxxx48')이 더 많이 말해 준다
  const heading = textOf(el.querySelector('h2, h3'));
  if (heading) return heading;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const t = textOf(document.getElementById(labelledBy));
    if (t) return t;
  }
  return el.getAttribute('aria-label');
}

export function collectIssueLocation(): IssueLocation {
  const panels = Array.from(document.querySelectorAll(PANEL_SEL)).filter((el) => !el.closest(OURS) && visible(el));
  // 맨 위 = 문서 순서상 마지막(포털·뒤에 그려진 레이어가 뒤에 붙는다 — pasteModalGuard와 같은 판단)
  const top = panels[panels.length - 1];
  // 제목: 화면이 직접 표시한 자리(data-issue-title — 캠페인처럼 제목이 h1이 아닌 화면)가 먼저, 없으면 첫 h1
  const pageTitle = (sel: string) => Array.from(document.querySelectorAll(sel)).find((h) => !h.closest(PANEL_SEL) && !h.closest(OURS) && visible(h));
  const h1 = pageTitle('[data-issue-title]') ?? pageTitle('h1');
  const taskId = document.querySelector('[data-issue-task-id]')?.getAttribute('data-issue-task-id') ?? null;
  return {
    screen: screenNameFor(window.location.pathname),
    title: textOf(h1),
    panel: top ? panelTitle(top) : null,
    path: window.location.pathname + window.location.search,
    taskId,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
  };
}

// ── 버튼 자리 재기(스펙 §2-1) ──
/**
 * 지금 화면에서 버튼의 right·bottom. 먼저 화면 오른쪽 끝에 붙어 위아래를 다 덮는 패널을 찾아 옆으로 비키고,
 * 그 자리(비킨 뒤의 오른쪽 아래)에 걸린 하단 고정 줄이 있으면 위로 올린다.
 */
export function measureFabPosition(): { right: number; bottom: number } {
  const vw = window.innerWidth, vh = window.innerHeight;
  let rightPanelWidth = 0;
  for (const el of document.querySelectorAll(PANEL_SEL)) {
    if (el.closest(OURS)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.right >= vw - 2 && r.top <= 2 && r.bottom >= vh - 2) rightPanelWidth = Math.max(rightPanelWidth, vw - r.left);
  }
  const fabRight = fabPosition({ viewportWidth: vw, rightPanelWidth, bottomBarHeight: 0 }).right;
  let bottomBarHeight = 0;
  for (const el of document.querySelectorAll('[data-bottom-bar]')) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    // 구석에 실제로 걸린 줄만 — 표 아래에 떠 있는(아직 바닥에 닿지 않은) 줄은 버튼과 겹치지 않는다
    const atBottom = r.bottom >= vh - 4;
    const underFab = r.right > vw - fabRight - FAB_SIZE && r.left < vw - fabRight;
    if (atBottom && underFab) bottomBarHeight = Math.max(bottomBarHeight, vh - r.top);
  }
  return fabPosition({ viewportWidth: vw, rightPanelWidth, bottomBarHeight });
}
