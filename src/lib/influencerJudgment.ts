// 판단 파생 함수 — 리스트/프로필이 같은 배지 상태·문구를 계산하도록 UI 밖으로 뺀 순수 함수들.
// (스펙 §① 현황 스트립 §④ 갱신 넛지) DB 접근 없음 — now?를 받아 테스트에서 결정적으로 검증한다.
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from './draftStatus.ts';

export const FOLLOWUP_DAYS = 14;
export const PROFILE_STALE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: string, to: Date): number {
  return (to.getTime() - new Date(from).getTime()) / DAY_MS;
}

export interface ContactJudgment {
  daysSince: number | null;  // lastContactAt 기준 경과일 (기록 없으면 null)
  label: string;             // '연락 기록 N일 전' | '연락 기록 없음' | '오늘 연락 기록'
  needsFollowup: boolean;    // now - (lastContactAt ?? createdAt) > FOLLOWUP_DAYS일
}

export function judgeContact(lastContactAt: string | null, createdAt: string, now?: Date): ContactJudgment {
  const n = now ?? new Date();
  const baseline = lastContactAt ?? createdAt;
  const needsFollowup = daysBetween(baseline, n) > FOLLOWUP_DAYS;

  if (!lastContactAt) {
    return { daysSince: null, label: '연락 기록 없음', needsFollowup };
  }
  const daysSince = Math.floor(daysBetween(lastContactAt, n));
  const label = daysSince <= 0 ? '오늘 연락 기록' : `연락 기록 ${daysSince}일 전`;
  return { daysSince, label, needsFollowup };
}

// null(미조회)은 넛지를 띄우지 않는다 — 아직 조회한 적 없다는 사실은 별도 문구(§④)로 다룬다.
export function isProfileStale(profileRefreshedAt: string | null, now?: Date): boolean {
  if (!profileRefreshedAt) return false;
  const n = now ?? new Date();
  return daysBetween(profileRefreshedAt, n) > PROFILE_STALE_DAYS;
}

// '게시완료 3 · 진행중 1' — 존재하는(count>0) 상태만, 표시 순서·라벨은 draftStatus.ts 그대로 재사용.
export function summarizeDraftStatuses(counts: Partial<Record<DraftStatus, number>>): string {
  return DRAFT_STATUSES
    .filter((s) => (counts[s] ?? 0) > 0)
    .map((s) => `${STATUS_LABEL[s]} ${counts[s]}`)
    .join(' · ');
}
