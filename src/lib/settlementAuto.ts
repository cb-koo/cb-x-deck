// 정산 요청 자동 전송(스펙 2026-10-12 §2·§4) — 순수. 언제 보내는지와 어느 묶음인지를 한 곳에서 정한다.
// 서버 스윕(runAutoSend)·정산 화면 묶음·캠페인 필터 줄이 모두 이 판정을 쓴다(라벨-값 일치, UX 원칙 4).
import type { SettlementCandidate, IssueCode } from './settlementCalc.ts';

const KST_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
export const SEND_HOUR_KST = 7;   // 매주 월요일 07:00(서울) — 정산팀 지급 리듬(월요일)에 맞춘다(koo 10-12)
// 마지막 실행이 이보다 오래되면 화면이 "자동 전송이 확인되지 않아요"를 띄운다(예약은 5분 주기)
export const AUTO_RUN_STALE_MS = 15 * 60_000;

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
export function blockingIssues(c: SettlementCandidate) {
  return c.issues.filter((i) => i.level === 'blocked' || BLOCK_ON_AUTO.has(i.code));
}
