// 정산 요청 자동 전송(스펙 2026-10-12 §2·§4) — 순수. 언제 보내는지와 어느 묶음인지를 한 곳에서 정한다.
// 서버 스윕(runAutoSend)·정산 화면 묶음·캠페인 필터 줄이 모두 이 판정을 쓴다(라벨-값 일치, UX 원칙 4).
import type { SettlementCandidate, IssueCode, ReadinessIssue } from './settlementCalc.ts';
import { kstDate } from './datetime.ts';

const KST_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
export const SEND_HOUR_KST = 7;   // 매주 월요일 07:00(서울) — 정산팀 지급 리듬(월요일)에 맞춘다(koo 10-12)
// 마지막 실행이 이보다 오래되면 화면이 "자동 전송이 확인되지 않아요"를 띄운다(예약은 5분 주기)
export const AUTO_RUN_STALE_MS = 15 * 60_000;
export const AUTO_REQUESTER_FALLBACK = '자동 전송';   // 작업·캠페인을 만든 사람이 모두 없을 때 요청자 이름(멤버 없음)
export const HOLD_REASON_MAX = 100;                  // [보내지 않기] 사유 길이 — 화면 입력과 서버가 같은 값

// now 이하에서 가장 최근의 월요일 07:00(서울) 순간
export function lastMondaySeven(now: Date): Date {
  const k = new Date(now.getTime() + KST_MS);   // 서울 벽시계를 UTC 필드로 읽는다
  const dow = k.getUTCDay();                     // 0 일 … 1 월
  const back = (dow + 6) % 7;                    // 월 0 · 화 1 · … · 일 6
  const mon = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - back, SEND_HOUR_KST) - KST_MS;
  return new Date(mon <= now.getTime() ? mon : mon - 7 * DAY_MS);
}
// now보다 뒤의 다음 월요일 07:00(서울)
export function nextMondaySeven(now: Date): Date {
  return new Date(lastMondaySeven(now).getTime() + 7 * DAY_MS);
}

// 게시 확인 시각 — 070 이전 행은 비어 있어 게시일(서울 00:00)로 대신한다
export function confirmedInstant(postedConfirmedAt: string | null, postedAt: string): Date {
  return postedConfirmedAt ? new Date(postedConfirmedAt) : new Date(Date.parse(`${postedAt}T00:00:00Z`) - KST_MS);
}
// 이번 회차에 보낼 때가 됐나 — 이번 주 월요일 07:00 전에 확인됐으면 지금 보낸다(7시에 놓쳐도 다음 5분에 잡힌다)
export function isDue(confirmedAt: Date, now: Date): boolean {
  return confirmedAt.getTime() < lastMondaySeven(now).getTime();
}
// 언제 보내는가(화면 표시) — 지났으면 null(곧 보냄)
export function sendAtFor(confirmedAt: Date, now: Date): Date | null {
  return isDue(confirmedAt, now) ? null : nextMondaySeven(now);
}

export type PendingGroup = 'attention' | 'blocked' | 'waiting' | 'stopped';
// 확인이 필요해요 = 지급 전에 글이 내려가거나 안 보임 — 사람이 보낼지 정한다(koo 10-12)
const ATTENTION: ReadonlySet<IssueCode> = new Set<IssueCode>(['removed', 'unseen']);
// 🟡지만 자동 전송에선 막는 것 — 첨부 필수(koo 10-12 "첨부되어야 할 파일이 없는 작업도 보내지 않음")
const BLOCK_ON_AUTO: ReadonlySet<IssueCode> = new Set<IssueCode>(['no-agreement']);

export interface PendingState {
  hold: { at: string; byName: string | null; reason: string } | null;
  cancelled: { at: string | null; byName: string | null; reason: string | null } | null;   // 활성 요청 없이 취소된 요청이 있다(가장 최근)
}
// 묶음 판정. 멈춤이 먼저(사람이 정한 것), 그다음 확인 필요, 막힘, 그 외는 기다림.
export function pendingGroup(c: SettlementCandidate, s: PendingState): PendingGroup {
  if (s.hold || s.cancelled) return 'stopped';
  if (c.issues.some((i) => ATTENTION.has(i.code))) return 'attention';
  if (blockingIssues(c).length) return 'blocked';
  return 'waiting';
}
// 자동 전송을 막는 이유(내림·안 보임 제외) — '고쳐야 보내져요'에 보이는 문구이자, 사람이 [보내기]를 눌러도 막히는 이유
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
  createdVia: 'manual' | 'auto'; createdAt: string;
}): { kind: 'act' | 'info' | 'acked'; text: string } | null {
  if (r.status === 'cancelled') return null;
  // 사람이 보낸 건은 그날까지 내려간 걸 보고 보냈다([확인하고 보내기]) — 그 뒤에 내려간 것만 알린다.
  // 자동으로 보낸 건은 내림·안 보임이면 애초에 안 나가므로 보인 내림은 전부 보낸 뒤다.
  const sentOn = kstDate(r.createdAt);
  const after = (d: string | null) => d !== null && (r.createdVia === 'auto' || d > sentOn);
  r = { ...r, taskRemovedAt: after(r.taskRemovedAt) ? r.taskRemovedAt : null, taskUnseenOn: after(r.taskUnseenOn) ? r.taskUnseenOn : null };
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const what = r.taskRemovedAt ? `${md(r.taskRemovedAt)}에 글이 내려갔어요${r.taskRemovedReason ? ` (${r.taskRemovedReason})` : ''}`
    : r.taskUnseenOn ? `${md(r.taskUnseenOn)}부터 글이 안 보여요` : null;
  if (!what) return null;
  if (r.externalStatus === 'paid') return { kind: 'info', text: `지급 후 ${what} · 따로 할 일 없어요` };
  if (r.removalAckAt) return { kind: 'acked', text: `보낸 뒤 ${what} · 그대로 두기로 했어요${r.removalAckByName ? ` · ${r.removalAckByName}` : ''}` };
  return { kind: 'act', text: `보낸 뒤 ${what} · 아직 지급 전이에요 — 지급할지 정해 주세요` };
}
// 요청자 표시 — 자동으로 보낸 건은 "자동 전송 · 작업 만든 사람 X"(본인이 직접 요청한 걸로 오해하지 않게)
export function requesterLabel(r: { createdVia: 'manual' | 'auto'; requesterName: string; requesterMemberId: string | null }): string {
  if (r.createdVia !== 'auto') return r.requesterName;
  return r.requesterMemberId ? `자동 전송 · 작업 만든 사람 ${r.requesterName}` : '자동 전송';
}
