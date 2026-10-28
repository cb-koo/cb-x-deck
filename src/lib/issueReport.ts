// 불편 알리기(이슈 리포트)의 순수 규칙 — 서버 라우트와 브라우저가 함께 쓴다(브라우저 API를 import하지 않는다).
// 스펙 docs/superpowers/specs/2026-10-22-issue-report-design.md

export type IssueStatus = 'open' | 'checking' | 'resolved';
export const ISSUE_STATUSES: readonly IssueStatus[] = ['open', 'checking', 'resolved'];
export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = { open: '접수', checking: '확인 중', resolved: '해결' };

// 목록 탭(스펙 §2-4) — '할 일' = 접수 + 확인 중
export type IssueTab = 'todo' | 'resolved' | 'mine';
export const ISSUE_TABS: readonly IssueTab[] = ['todo', 'resolved', 'mine'];
export const ISSUE_TAB_LABEL: Record<IssueTab, string> = { todo: '할 일', resolved: '해결됨', mine: '내가 보낸 것' };

// 보낼 때 브라우저가 모은 위치(스펙 §2-3). 전부 화면에서 읽은 글자라 믿되 길이만 자른다.
export interface IssueLocation {
  screen: string;          // 사이드바 메뉴 이름 — '캠페인'
  title: string | null;    // 본문 첫 h1 — '10월 4주차 가은치유한의원'
  panel: string | null;    // 열린 옆 패널 제목 — '인용RT · @miyuxxx48'
  dialog: string | null;   // 그 위에 뜬 가운데 창 제목 — '기존 방문 작업에 예약 추가'. 링크로는 열리지 않는다(상세에 그렇게 적는다)
  path: string;            // pathname + search — [이 화면 열기]가 가는 곳
  taskId: string | null;   // 캠페인 작업 패널이 열려 있었으면 그 작업 id — [이 화면 열기]가 패널까지 연다
  viewport: string | null; // '1440×900'
}

export interface IssueReport {
  id: string;
  reporterId: string | null;
  reporterName: string;
  body: string;
  screenshotPath: string | null;
  location: IssueLocation;
  status: IssueStatus;
  statusChangedAt: string | null;
  reply: string | null;
  repliedByName: string | null;
  repliedAt: string | null;
  replySeenAt: string | null;
  createdAt: string;
}

// ── 처리 담당자(스펙 §5) ──
// 상태 바꾸기와 해결 답은 이 두 사람만(koo 10-22). 앱에 역할 모델이 없어 이메일로 둔다 — 코드에 있어야 리뷰로 보인다.
export const ISSUE_HANDLER_EMAILS: readonly string[] = [
  'gugeon.park@clinicbridge.co.kr',
  'taejeong.jeon@clinicbridge.co.kr',
];

export function isIssueHandler(email: string | null | undefined): boolean {
  return !!email && ISSUE_HANDLER_EMAILS.includes(email.trim().toLowerCase());
}

// ── 길이 상한 ──
export const MAX_ISSUE_BODY = 4000;
export const MAX_ISSUE_REPLY = 500;
const MAX_LOC_FIELD = 200;
const MAX_LOC_PATH = 500;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`);

// ── 스크린샷 ──
// 마이그레이션 083의 버킷 file_size_limit과 반드시 같은 값 — 여기서 통과시킨 파일이 서버에서 거절되지 않게.
export const ISSUE_SCREENSHOT_BUCKET = 'issue-screenshot';
export const MAX_ISSUE_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_ISSUE_SCREENSHOT_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ISSUE_SCREENSHOT_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// 임의 URL을 저장하면 팀원 전원의 브라우저가 그 주소로 이미지 요청을 보낸다(taskProofGuard와 같은 이유) — 경로 모양으로 좁힌다.
export const ISSUE_SCREENSHOT_PATH_RE = new RegExp(`^issue/\\d{4}-\\d{2}/${UUID}\\.(?:jpg|png|webp)$`);

export function isIssueScreenshotPath(v: unknown): v is string {
  return typeof v === 'string' && ISSUE_SCREENSHOT_PATH_RE.test(v);
}

// 형식·용량 — 문구는 RT 증빙(taskProof)과 같은 말을 쓴다.
export function issueScreenshotError(file: { type: string; size: number }): string | null {
  if (!(ALLOWED_ISSUE_SCREENSHOT_MIME as readonly string[]).includes(file.type)) {
    return '형식을 지원하지 않아요(jpg, png, webp만 올릴 수 있어요)';
  }
  if (file.size > MAX_ISSUE_SCREENSHOT_BYTES) return '10MB를 넘어요 — 크기를 줄여서 다시 올려주세요';
  return null;
}

// issue/<yyyy-mm>/<uuid>.<ext> — 달로 나눠 버킷을 훑을 때 보기 쉽게
export function issueScreenshotPath(mime: string, id: string, now: Date): string {
  const ym = now.toISOString().slice(0, 7);
  return `issue/${ym}/${id}.${ISSUE_SCREENSHOT_EXT[mime] ?? 'png'}`;
}

// ── 들어온 값 다듬기(서버) ──
const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

/** 브라우저가 보낸 위치를 저장할 모양으로. screen·path가 없으면 null(잘못된 요청). */
export function sanitizeLocation(v: unknown): IssueLocation | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const screen = clip(o.screen, MAX_LOC_FIELD);
  const path = typeof o.path === 'string' && o.path.startsWith('/') ? o.path.trim().slice(0, MAX_LOC_PATH) : null;
  if (!screen || !path) return null;
  return {
    screen,
    title: clip(o.title, MAX_LOC_FIELD),
    panel: clip(o.panel, MAX_LOC_FIELD),
    dialog: clip(o.dialog, MAX_LOC_FIELD),
    path,
    taskId: typeof o.taskId === 'string' && UUID_RE.test(o.taskId) ? o.taskId : null,
    viewport: clip(o.viewport, 20),
  };
}

/** jsonb 컬럼 읽기 — 모양이 보증되지 않으므로 다듬어서 돌려준다. 깨졌으면 '알 수 없음'. */
export function locationOf(v: unknown): IssueLocation {
  return sanitizeLocation(v) ?? { screen: '알 수 없음', title: null, panel: null, dialog: null, path: '/', taskId: null, viewport: null };
}

export function isIssueStatus(v: unknown): v is IssueStatus {
  return typeof v === 'string' && (ISSUE_STATUSES as readonly string[]).includes(v);
}

// ── 표시 ──

/** 보낸 곳 한 줄 — '캠페인 › 10월 4주차 가은치유한의원 › 인용RT · @miyuxxx48 › 기존 방문 작업에 예약 추가'. 제목이 화면 이름과 같으면 한 번만. */
export function locationLine(l: IssueLocation): string {
  const parts = [l.screen];
  if (l.title && l.title !== l.screen) parts.push(l.title);
  if (l.panel) parts.push(l.panel);
  if (l.dialog && l.dialog !== l.panel) parts.push(l.dialog);
  return parts.join(' › ');
}

/** [이 화면 열기] 주소. 캠페인 작업 패널이었으면 ?task=를 붙여 그 패널까지 연다(스펙 §2-3). */
export function locationHref(l: IssueLocation): string {
  if (!l.taskId) return l.path;
  const [base, query = ''] = l.path.split('?');
  const params = new URLSearchParams(query);
  params.set('task', l.taskId);
  return `${base}?${params.toString()}`;
}

/** 안 본 답 — 답이 있고, 보낸 사람이 그 뒤로 상세를 열지 않았다. */
export function hasUnseenReply(i: Pick<IssueReport, 'reply' | 'repliedAt' | 'replySeenAt'>): boolean {
  if (!i.reply || !i.repliedAt) return false;
  return !i.replySeenAt || Date.parse(i.replySeenAt) < Date.parse(i.repliedAt);
}

export function inTab(i: Pick<IssueReport, 'status' | 'reporterId'>, tab: IssueTab, memberId: string): boolean {
  if (tab === 'mine') return i.reporterId === memberId;
  if (tab === 'resolved') return i.status === 'resolved';
  return i.status !== 'resolved';
}

/**
 * 슬랙 알림 본문(스펙 §6) — 칸으로 나눠 한눈에 읽히게(koo 10-28).
 *   🙋 *새 이슈* 박구건
 *   > 내용(줄바꿈 유지, 300자까지)
 *
 *   *화면* 캠페인 › 미모드림의원 10월 방문협찬
 *   *패널* 작업 @mi          ← 열려 있었을 때만
 *   *창* 기존 방문 작업에 예약 추가   ← 떠 있었을 때만
 *   *스크린샷* 1장           ← 있을 때만
 *   <이슈 열기 ↗>
 */
export const SLACK_BODY_MAX = 300;
export function slackIssueText(i: { reporterName: string; body: string; location: IssueLocation; hasScreenshot: boolean; url: string }): string {
  // 슬랙 mrkdwn: <url|글자> 링크. 본문의 <,>,&는 슬랙 문법과 겹쳐 이스케이프한다.
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const trimmed = i.body.trim().replace(/\n{3,}/g, '\n\n');
  const body = trimmed.length > SLACK_BODY_MAX ? trimmed.slice(0, SLACK_BODY_MAX).trimEnd() + '…' : trimmed;
  const quote = body.split('\n').map((line) => (line.trim() ? `> ${esc(line.trim())}` : '>')).join('\n');
  const l = i.location;
  const screen = l.title && l.title !== l.screen ? `${l.screen} › ${l.title}` : l.screen;
  const rows = [`*화면* ${esc(screen)}`];
  if (l.panel) rows.push(`*패널* ${esc(l.panel)}`);
  if (l.dialog && l.dialog !== l.panel) rows.push(`*창* ${esc(l.dialog)}`);
  if (i.hasScreenshot) rows.push('*스크린샷* 1장');
  return [`🙋 *새 이슈* ${esc(i.reporterName)}`, quote, '', ...rows, `<${i.url}|이슈 열기 ↗>`].join('\n');
}

// ── 둥근 버튼 자리(스펙 §2-1) ──
export const FAB_SIZE = 40;
export const FAB_GAP = 24;

/**
 * 버튼의 right·bottom(px). 오른쪽에 붙은 패널이 있으면 그 폭만큼 왼쪽으로, 아래 고정 줄이 있으면 그 높이만큼 위로.
 * 패널이 화면을 거의 다 덮으면(남는 폭이 버튼을 둘 만큼 없으면) 패널 위 구석에 둔다 — 화면 밖으로 밀어내지 않는다.
 */
export function fabPosition(i: { viewportWidth: number; rightPanelWidth: number; bottomBarHeight: number }): { right: number; bottom: number } {
  let right = FAB_GAP;
  if (i.rightPanelWidth > 0) {
    const shifted = i.rightPanelWidth + FAB_GAP;
    if (shifted + FAB_SIZE + FAB_GAP <= i.viewportWidth) right = shifted;
  }
  const bottom = i.bottomBarHeight > 0 ? i.bottomBarHeight + 12 : FAB_GAP;
  return { right, bottom };
}

// ── 화면 이름(스펙 §2-3) ──
// 주소 앞부분 → 사이드바 메뉴 이름. 긴 접두어부터 본다(/influencers/performance가 /influencers보다 먼저).
// 사이드바에 메뉴를 더하면 여기도 한 줄 더한다 — 빠뜨려도 '그 밖의 화면'이 아니라 주소 첫 마디로 남아 길을 잃지는 않는다.
const SCREEN_NAMES: ReadonlyArray<[RegExp, string]> = [
  [/^\/w\/[^/]+\/briefing/, '브리핑'],
  [/^\/w\/[^/]+\/library/, '보관함'],
  [/^\/w\/[^/]+\/research/, '리서치'],
  [/^\/w\/[^/]+/, '덱'],
  [/^\/campaigns\/flow/, '캠페인'],
  [/^\/campaigns/, '캠페인 (이전)'],
  [/^\/influencers\/performance/, '인플루언서 성과'],
  [/^\/influencers/, '인플루언서'],
  [/^\/trends/, '검색 트렌드'],
  [/^\/market-map/, '클리닉 지도'],
  [/^\/settlement/, '정산'],
  [/^\/generate/, '콘텐츠 생성'],
  [/^\/channels/, 'X 업로드 현황'],
  [/^\/tracking/, '트래킹'],
  [/^\/performance/, '콘텐츠 성과'],
  [/^\/reports/, '리포트'],
  [/^\/clients/, '클라이언트'],
  [/^\/quick-messages/, '빠른 메시지'],
  [/^\/prompt/, '프롬프트'],
  [/^\/workspaces/, '워크스페이스 관리'],
  [/^\/updates/, '업데이트 소식'],
  [/^\/usage/, 'API 사용량'],
  [/^\/issues/, '이슈'],
];

export function screenNameFor(pathname: string): string {
  if (pathname === '/' || pathname === '') return '첫 화면';
  for (const [re, name] of SCREEN_NAMES) if (re.test(pathname)) return name;
  return pathname.split('/')[1] || '첫 화면';
}
