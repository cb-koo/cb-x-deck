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

// 열린 층 나누기 — 화면 오른쪽 끝에 붙어 위아래를 다 덮는 '옆 패널'(작업 패널 등)과, 그 위에 뜨는 '가운데 창'.
// 가운데 창은 role이 없는 것도 많아(정산 다이얼로그 등) 화면 전체를 덮는 어두운 바탕(fixed inset-0)도 창으로 친다.
// 바탕 안에 role="dialog"가 따로 있으면 그것 하나로 센다(같은 창이 두 번 잡히지 않게).
const LAYER_SEL = 'dialog[open], [role="dialog"], [aria-modal="true"], .fixed.inset-0';

function openLayers(): { sides: Element[]; modals: Element[] } {
  const vw = window.innerWidth, vh = window.innerHeight;
  const all = Array.from(document.querySelectorAll(LAYER_SEL)).filter((el) => !el.closest(OURS) && visible(el));
  const sides: Element[] = [], modals: Element[] = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const fullScreen = r.left <= 2 && r.top <= 2 && r.right >= vw - 2 && r.bottom >= vh - 2;
    if (fullScreen) {
      // 어두운 바탕 — 안에 창이 따로 잡히면 그쪽이 센다. 바탕만 있는 창(role 없음)은 바탕이 곧 창이다
      if (!all.some((o) => o !== el && el.contains(o))) modals.push(el);
      continue;
    }
    if (r.right >= vw - 2 && r.top <= 2 && r.bottom >= vh - 2) sides.push(el);
    else if (el.getAttribute('aria-modal') === 'true' || el.tagName === 'DIALOG' || el.closest('.fixed.inset-0')) modals.push(el);
    // 그 밖의 role="dialog"(작은 팝오버)는 층으로 치지 않는다 — 버튼을 옮길 이유도, 보낸 곳에 적을 이유도 없다
  }
  return { sides, modals };
}

export function collectIssueLocation(): IssueLocation {
  const { sides, modals } = openLayers();
  // 맨 위 = 문서 순서상 마지막(포털·뒤에 그려진 레이어가 뒤에 붙는다 — pasteModalGuard와 같은 판단)
  const side = sides[sides.length - 1];
  const modal = modals[modals.length - 1];
  // 제목: 화면이 직접 표시한 자리(data-issue-title — 캠페인처럼 제목이 h1이 아닌 화면)가 먼저, 없으면 첫 h1
  const pageTitle = (sel: string) => Array.from(document.querySelectorAll(sel)).find((h) => !h.closest(LAYER_SEL) && !h.closest(OURS) && visible(h));
  const h1 = pageTitle('[data-issue-title]') ?? pageTitle('h1');
  const taskId = document.querySelector('[data-issue-task-id]')?.getAttribute('data-issue-task-id') ?? null;
  return {
    screen: screenNameFor(window.location.pathname),
    title: textOf(h1),
    panel: side ? panelTitle(side) : null,
    dialog: modal ? panelTitle(modal) : null,
    path: window.location.pathname + window.location.search,
    taskId,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
  };
}

// ── 버튼 자리 재기(스펙 §2-1) ──
/**
 * 지금 화면에서 버튼의 right·bottom.
 * - 가운데 창이 떠 있으면 오른쪽 아래 구석. 어두운 바탕이 아래 패널·바를 덮어 누를 것이 없고, 패널 옆(화면 가운데 아래)에
 *   있으면 창 밑에 끼어 어색하다(koo QA 10-22, 예약 추가 창).
 * - 아니면 옆 패널을 비키고, 그 자리에 걸린 하단 고정 줄이 있으면 위로 올린다.
 */
export function measureFabPosition(): { right: number; bottom: number } {
  const vw = window.innerWidth, vh = window.innerHeight;
  const { sides, modals } = openLayers();
  if (modals.length > 0) return fabPosition({ viewportWidth: vw, rightPanelWidth: 0, bottomBarHeight: 0 });
  const rightPanelWidth = sides.reduce((w, el) => Math.max(w, vw - el.getBoundingClientRect().left), 0);
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
