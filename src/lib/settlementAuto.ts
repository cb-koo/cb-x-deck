// 정산 요청 자동 전송(스펙 2026-10-12 §2·§4) — 순수. 언제 보내는지와 어느 묶음인지를 한 곳에서 정한다.
// 서버 스윕(runAutoSend)·정산 화면 묶음·캠페인 필터 줄이 모두 이 판정을 쓴다(라벨-값 일치, UX 원칙 4).
import type { SettlementCandidate, IssueCode, ReadinessIssue } from './settlementCalc.ts';
import { TASK_TYPE_LABEL, weekStartOf, daysBetweenDates, type TaskType } from './campaignJudgment.ts';
import { postNo } from './sameVisit.ts';

const KST_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
// 월요일 07:00·12:00·15:00(서울) — 정산팀 지급 리듬(월요일, koo 10-12). 7시 뒤에 보완·확인한 작업이 한 주를 기다리지 않게
// 같은 월요일 낮 회차를 더했다(koo 11-09). 회차는 월요일에만 있다 — 화~일에 확인된 작업은 다음 월요일 07:00.
export const SEND_HOURS_KST: readonly number[] = [7, 12, 15];
// 마지막 실행이 이보다 오래되면 화면이 "자동 전송이 확인되지 않아요"를 띄운다(예약은 5분 주기)
export const AUTO_RUN_STALE_MS = 15 * 60_000;
export const AUTO_REQUESTER_FALLBACK = '자동 전송';   // 작업·캠페인을 만든 사람이 모두 없을 때 요청자 이름(멤버 없음)
export const HOLD_REASON_MAX = 100;                  // [보류] 사유 길이 — 화면 입력과 서버가 같은 값

// now가 속한 주(서울, 월요일 시작)의 월요일 00:00(서울) 순간
function mondayStart(now: Date): number {
  const k = new Date(now.getTime() + KST_MS);   // 서울 벽시계를 UTC 필드로 읽는다
  const back = (k.getUTCDay() + 6) % 7;          // 월 0 · 화 1 · … · 일 6
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - back) - KST_MS;
}
// now 이하에서 가장 최근의 전송 회차(월요일 07·12·15시, 서울) 순간
export function lastSendSlot(now: Date): Date {
  const t = now.getTime();
  for (const base of [mondayStart(now), mondayStart(now) - 7 * DAY_MS]) {
    for (const h of [...SEND_HOURS_KST].reverse()) {
      const at = base + h * 3_600_000;
      if (at <= t) return new Date(at);
    }
  }
  throw new Error('unreachable');
}
// now보다 뒤의 다음 전송 회차
export function nextSendSlot(now: Date): Date {
  const t = now.getTime();
  for (const base of [mondayStart(now), mondayStart(now) + 7 * DAY_MS]) {
    for (const h of SEND_HOURS_KST) {
      const at = base + h * 3_600_000;
      if (at > t) return new Date(at);
    }
  }
  throw new Error('unreachable');
}

// 게시 확인 시각 — 071 이전 행은 비어 있어 게시일(서울 00:00)로 대신한다
export function confirmedInstant(postedConfirmedAt: string | null, postedAt: string): Date {
  return postedConfirmedAt ? new Date(postedConfirmedAt) : new Date(Date.parse(`${postedAt}T00:00:00Z`) - KST_MS);
}
// 이번 회차에 보낼 때가 됐나 — 가장 최근 회차 전에 확인됐으면 지금 보낸다(회차 시각에 놓쳐도 다음 5분에 잡힌다)
export function isDue(confirmedAt: Date, now: Date): boolean {
  return confirmedAt.getTime() < lastSendSlot(now).getTime();
}
// 언제 보내는가(화면 표시) — 지났으면 null(곧 보냄)
export function sendAtFor(confirmedAt: Date, now: Date): Date | null {
  return isDue(confirmedAt, now) ? null : nextSendSlot(now);
}

// 게시됐지만 정산 요청을 만들 수 없는 작업(koo 11-02) — 작업 비용·인플루언서가 비어 후보(CANDIDATE_BASE)에서 빠진다.
// 예전엔 정산 메뉴 어디에도 안 보여 입금 누락이 문의로만 드러났다(10-30 백수약국 4주차 8건). '보완 필요'에 같이 보여 준다.
// 비용 없음(064)·다른 곳에서 정산함(061)·취소는 일부러 지급하지 않는 작업이라 넣지 않는다. 자동 전송은 지금처럼 건너뛴다.
export type UnsendableReason = 'no-cost' | 'no-influencer';
export interface UnsendableRow {
  taskId: string; campaignId: string; campaignName: string; clientName: string;
  influencerHandle: string | null; taskType: TaskType; postedAt: string; reasons: UnsendableReason[];
}
export const UNSENDABLE_TEXT: Record<UnsendableReason, string> = { 'no-cost': '작업 비용 없음', 'no-influencer': '인플루언서 미배정' };

export type PendingGroup = 'attention' | 'blocked' | 'together' | 'waiting' | 'stopped';
// 확인 필요 = 지급 전에 글이 내려가거나 안 보임 — 사람이 보낼지 정한다(koo 10-12)
const ATTENTION: ReadonlySet<IssueCode> = new Set<IssueCode>(['removed', 'unseen']);
// 🟡지만 자동 전송에선 막는 것 — 첨부 필수(koo 10-12 "첨부되어야 할 파일이 없는 작업도 보내지 않음")
const BLOCK_ON_AUTO: ReadonlySet<IssueCode> = new Set<IssueCode>(['no-agreement']);

export interface PendingState {
  hold: { at: string; byName: string | null; reason: string } | null;
  cancelled: { at: string | null; byName: string | null; reason: string | null } | null;   // 활성 요청 없이 취소된 요청이 있다(가장 최근)
}
// 같은 주 함께 보내기(ISSUE-010, koo 11-04) — 한 인플루언서의 그 주 작업이 전부 게시돼야 자동 전송한다(캠페인과 무관, koo: '같은 주').
// 업로드가 여러 건인 협찬은 업로드마다 작업을 두면 다 올라올 때까지 기다린다. 안 올라오는 작업은 풀지 않고 알린다(koo: 알려주는 것으로).
// 작업의 날짜 = 게시일 → 게시 예정일 → 방문일 → 캠페인 시작일(먼저 있는 것). 주 = 월~일(서울 날짜).
// 취소·다른 곳에서 정산함·마감한 캠페인의 작업은 저장소가 애초에 넘기지 않는다(settlementAutoStore.loadWeekSiblings).
export interface WeekSibling {
  taskId: string; handle: string; taskType: TaskType; campaignName: string;
  postedAt: string | null; scheduledOn: string | null; visitOn: string | null; campaignStartsOn: string;
  confirmedAt: string | null;   // 게시 확인 시각(ISO) — 묶음이 '가장 늦게 끝난 작업'에 맞춰 함께 나가게(koo 11-05: 동일한 시점에)
  sameVisitOf?: string | null;  // 같은 방문의 원래 작업(089) — 원래 작업(금액이 있는 후보)은 주와 상관없이 이 게시물을 기다린다
  createdAt?: string;           // 만든 시각 — 같은 방문 게시물 번호(게시물 2, 3…)를 매기는 순서
}
// sameVisit — 원래 작업에 연결된 게시물이면 그 번호와 원래 작업 게시 후 지난 날수. 날짜 없이 안 올라오면 이 날수로 '지남'을 판정한다
export interface TogetherPending { taskId: string; campaignName: string; taskType: TaskType; dueOn: string | null; overdue: boolean; sameVisit?: { ordinal: number; sinceOriginal: number } | null }
// 날짜 없는 게시 전 연결 작업을 '안 올라옴'으로 보는 기준 — 원래 작업 게시 후 7일(검토 반영 11-09: 예정일이 없으면 영영 '지남'이 안 돼
// 원래 작업 정산이 조용히 멈췄다). 지나면 정산 대기에서 주황·확인 필요 숫자에 잡힌다. 예정일이 있으면 그 날짜가 기준이다.
export const SAME_VISIT_WAIT_DAYS = 7;
// kind — 묶인 이유. week = 같은 주 작업만, visit = 같은 방문의 게시물만(089, koo 11-09 결정 8), both = 둘 다. 표시 글자만 가른다
export interface Together { total: number; posted: number; pending: TogetherPending[]; lastConfirmedAt: string | null; kind?: 'week' | 'visit' | 'both' }
export const taskWeekDate = (t: Pick<WeekSibling, 'postedAt' | 'scheduledOn' | 'visitOn' | 'campaignStartsOn'>): string =>
  t.postedAt ?? t.scheduledOn ?? t.visitOn ?? t.campaignStartsOn;
/** self(게시된 후보)와 같은 인플·같은 주 작업 묶음 — 자기 하나뿐이면 null. today는 서울 날짜(예정일 지남 판정).
 *  같은 방문의 게시물(self에 연결된 작업)은 주와 상관없이 묶는다 — 방문 한 번 = 묶음 가격이라 다 올라온 뒤 함께 보낸다(koo 11-09).
 *  날짜가 하나도 없는 게시 전 연결 작업은 주로는 묶지 않는다 — 캠페인 시작일로 잡혀 그 주 다른 작업을 붙잡지 않게. */
export function togetherFor(self: { taskId: string; handle: string; postedAt: string }, siblings: WeekSibling[], today: string): Together | null {
  const week = weekStartOf(self.postedAt);
  const h = self.handle.toLowerCase();
  const linkedToSelf = (x: WeekSibling) => x.sameVisitOf === self.taskId;
  const inWeek = (x: WeekSibling) => !(x.sameVisitOf && !x.postedAt && !x.scheduledOn) && weekStartOf(taskWeekDate(x)) === week;
  const same = siblings.filter((x) => x.handle.toLowerCase() === h && (x.taskId === self.taskId || linkedToSelf(x) || inWeek(x)));
  if (!same.some((x) => x.taskId === self.taskId)) same.push({ taskId: self.taskId, handle: self.handle, taskType: 'post', campaignName: '', postedAt: self.postedAt, scheduledOn: null, visitOn: null, campaignStartsOn: self.postedAt, confirmedAt: null });
  if (same.length <= 1) return null;
  const linkedOrder = same.filter(linkedToSelf).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.taskId.localeCompare(b.taskId));
  const since = daysBetweenDates(self.postedAt, today);
  const pending = same.filter((x) => !x.postedAt).map((x): TogetherPending => {
    const dueOn = x.scheduledOn ?? x.visitOn;
    const sv = linkedToSelf(x) ? { ordinal: linkedOrder.indexOf(x) + 2, sinceOriginal: since } : null;
    const overdue = dueOn ? dueOn < today : !!sv && since > SAME_VISIT_WAIT_DAYS;
    return { taskId: x.taskId, campaignName: x.campaignName, taskType: x.taskType, dueOn, overdue, sameVisit: sv };
  });
  const confirmed = same.map((x) => x.confirmedAt).filter((d): d is string => !!d).sort();
  const others = same.filter((x) => x.taskId !== self.taskId);
  const kind = others.every(linkedToSelf) ? 'visit' : others.some(linkedToSelf) ? 'both' : 'week';
  return { total: same.length, posted: same.length - pending.length, pending, lastConfirmedAt: confirmed.at(-1) ?? null, kind };
}
const TOGETHER_HEAD: Record<NonNullable<Together['kind']>, string> = { week: '같은 주', visit: '추가 게시물까지', both: '같은 주, 추가 게시물까지' };
/** 사유 한 칸 — '같은 주 3건 중 2건 게시, 남은 작업: 백수약국_11월1주차 인용RT(11/6 예정)'. */
export function togetherText(t: Together): string {
  const left = t.pending.map((p) => `${p.campaignName} ${TASK_TYPE_LABEL[p.taskType]}${p.dueOn ? `(${md(p.dueOn)} 예정${p.overdue ? ', 지남' : ''})`
    : p.sameVisit ? `(게시물 ${p.sameVisit.ordinal}, 예정일 없음${p.overdue ? `, 원래 게시 후 ${p.sameVisit.sinceOriginal}일` : ''})` : '(예정일 없음)'}`);
  return `${TOGETHER_HEAD[t.kind ?? 'week']} ${t.total}건 중 ${t.posted}건 게시, 남은 작업: ${left.join(', ')}`;
}

/** 표의 사유 칸용 짧은 말(koo QA 11-05: 긴 문장이 칸을 넘쳐 버튼이 밀렸다) — '3건 중 1건 게시, 1건 예정일 지남' / '…, 다음 예정 11/7'.
 *  남은 작업 목록 전체는 togetherText(마우스 올림·작업 패널). */
export function togetherShort(t: Together): string {
  // 같은 주만이면 예전 그대로(묶음 머리말이 이미 말한다), 같은 방문이 섞이면 무엇을 기다리는지 앞에 붙인다
  const head = `${t.kind && t.kind !== 'week' ? `${TOGETHER_HEAD[t.kind]} ` : ''}${t.total}건 중 ${t.posted}건 게시`;
  // 날짜 없이 안 올라온 같은 방문 게시물 — '예정일 지남'이 아니라 무엇이 얼마나 늦었는지 말한다
  const stale = t.pending.filter((p) => p.overdue && !p.dueOn && p.sameVisit);
  if (stale.length) {
    const s = stale[0].sameVisit!;
    return `${head}, ${postNo(s.ordinal, '이')} 아직 안 올라왔어요(원래 게시 후 ${s.sinceOriginal}일${stale.length > 1 ? `, 외 ${stale.length - 1}건` : ''})`;
  }
  const late = t.pending.filter((p) => p.overdue).length;
  if (late) return `${head}, ${late}건 예정일 지남`;
  const next = t.pending.map((p) => p.dueOn).filter((d): d is string => !!d).sort()[0];
  return next ? `${head}, 다음 예정 ${md(next)}` : `${head}, ${t.pending.length}건 예정일 없음`;
}

// 묶음 판정. 멈춤이 먼저(사람이 정한 것), 그다음 확인 필요, 막힘, 같은 주 작업 대기, 그 외는 기다림.
export function pendingGroup(c: SettlementCandidate, s: PendingState, together: Together | null = null): PendingGroup {
  if (s.hold || s.cancelled) return 'stopped';
  if (c.issues.some((i) => ATTENTION.has(i.code))) return 'attention';
  if (blockingIssues(c).length) return 'blocked';
  if (together && together.pending.length) return 'together';
  return 'waiting';
}
// 자동 전송을 막는 이유(내림·안 보임 제외) — '보완 필요' 사유이자, 사람이 [보내기]를 눌러도 막히는 이유
// 문구는 자동 전송의 뜻으로 바꿔 쓴다 — 옛 검토 화면 문구("요청은 만들 수 있어요"·"분류를 골라 주세요")가 남으면 라벨과 동작이 어긋난다(원칙 4)
const AUTO_TEXT: Partial<Record<IssueCode, string>> = {
  'no-agreement': '협찬 동의서가 없어요 — 첨부해야 보내져요',
  'no-category': '이 유형의 기본 분류가 없어요 — 정산 설정에서 정해 주세요',
};
export function blockingIssues(c: SettlementCandidate): ReadinessIssue[] {
  return c.issues
    .filter((i) => i.level === 'blocked' || BLOCK_ON_AUTO.has(i.code))
    .map((i) => (AUTO_TEXT[i.code] ? { ...i, level: 'blocked' as const, text: AUTO_TEXT[i.code]! } : i));
}

// 보낸 뒤 글이 내려가거나 안 보임(스펙 §2-7) — 지급 전이면 담당자가 정한다(act), 지급 후면 기록만(info). 취소된 요청·확인한 요청은 없음.
// 요청 내역 행 아래 한 줄이 이 판정 하나로 그려진다.
export function removalAfterSend(r: {
  status: string; externalStatus: string | null; removalAckAt: string | null; removalAckByName: string | null;
  taskRemovedAt: string | null; taskRemovedReason: string; taskUnseenOn: string | null;
  sentRemovedOn: string | null; sentUnseenOn: string | null;
}): { kind: 'act' | 'info' | 'acked'; text: string } | null {
  if (r.status === 'cancelled') return null;
  // 보낼 때 이미 있던 내림·안 보임은 사람이 보고 보낸 것([보내기]) — 그 뒤에 새로 생긴 것만 알린다.
  // 날짜 크기로 가르지 않는다: 내림 날짜는 나중에 과거 날짜로 적힐 수 있다(리뷰 10-12).
  r = { ...r, taskRemovedAt: r.taskRemovedAt !== r.sentRemovedOn ? r.taskRemovedAt : null, taskUnseenOn: r.taskUnseenOn !== r.sentUnseenOn ? r.taskUnseenOn : null };
  const mmdd = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const what = r.taskRemovedAt ? `내림 ${mmdd(r.taskRemovedAt)}${r.taskRemovedReason ? ` · ${r.taskRemovedReason}` : ''}`
    : r.taskUnseenOn ? `안 보임 ${mmdd(r.taskUnseenOn)}~` : null;
  if (!what) return null;
  if (r.externalStatus === 'paid') return { kind: 'info', text: `지급 후 ${what}` };
  if (r.removalAckAt) return { kind: 'acked', text: `보낸 뒤 ${what} · 그대로 둠${r.removalAckByName ? `(${r.removalAckByName})` : ''}` };
  return { kind: 'act', text: `보낸 뒤 ${what} · 지급 전 — 지급할지 정해 주세요` };
}
// 요청자 표시 — 자동으로 보낸 건은 "자동 전송 · X"(X = 작업 만든 사람, 본인이 직접 보낸 걸로 오해하지 않게 title로 풀어 쓴다)
export function requesterLabel(r: { createdVia: 'manual' | 'auto'; requesterName: string; requesterMemberId: string | null }): string {
  if (r.createdVia !== 'auto') return r.requesterName;
  return r.requesterMemberId ? `자동 전송 · ${r.requesterName}` : '자동 전송';
}

// ── 짧은 표시(koo 10-13 QA: 동사형 대신 짧은 명사형, 의미는 분명하게) ──
export const GROUP_LABEL: Record<PendingGroup, string> = { attention: '확인 필요', blocked: '보완 필요', together: '남은 게시물 대기', waiting: '전송 예정', stopped: '전송 보류' };   // '전송 보류' — 정산팀 '지급 보류'(보낸 뒤)와 단계로 구분(10-13)
// 사유 한 칸 — 이슈 코드마다 짧은 말. 고치는 자리는 행을 눌러 여는 작업 패널이라 링크는 패널 밖(설정)만 단다.
const SHORT: Partial<Record<IssueCode, string>> = {
  'no-influencer': '명부 미등록', 'no-payment-method': '결제 수단 없음', 'paypay-no-receiving-info': 'PayPay 수취 정보 없음',
  'no-client': '클라이언트 없음', 'no-category': '기본 분류 없음', 'no-reference': '게시물 링크 없음', 'no-proof': 'RT 증빙 없음',
  'no-agreement': '동의서 없음',
};
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
export function shortReason(c: SettlementCandidate, group: PendingGroup, blocking: ReadinessIssue[]): string {
  if (group === 'attention') {
    if (c.removedAt) return `내림 ${md(c.removedAt)}${c.removedReason ? ` · ${c.removedReason}` : ''}`;
    const u = c.issues.find((i) => i.code === 'unseen');
    return u ? u.text.replace('게시물 안 보임', '안 보임') : '확인 필요';
  }
  return blocking.map((i) => SHORT[i.code] ?? i.text).join(' · ');
}
// "10/19(월) 07:00" (서울)
export function sendWhenLabel(iso: string): string {
  const k = new Date(Date.parse(iso) + KST_MS);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${'일월화수목금토'[k.getUTCDay()]}) ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
}
