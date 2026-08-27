// 판단 파생 함수 — 리스트/프로필이 같은 배지 상태·문구를 계산하도록 UI 밖으로 뺀 순수 함수들.
// (스펙 §① 현황 스트립 §④ 갱신 넛지) DB 접근 없음 — now?를 받아 테스트에서 결정적으로 검증한다.
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from './draftStatus.ts';
import { formatKoCount } from './formatKo.ts';

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

// ---- 계정 분석 판단 (스펙 §3 결과 UI) — 숫자만 던지지 않고 판단까지 서술(UX 원칙 3) ----

export interface CadenceJudgment { label: string; caution: boolean }

// 표본이 얇은 것은 오류가 아니라 판단 재료다(스펙 §3 표본): 주 1회 미만 = 확산용 주의.
export function judgeCadence(perWeek: number, sampleCount: number): CadenceJudgment {
  if (sampleCount === 0) {
    return { label: '최근 3개월 게시물이 없어요 — 활동이 없는 계정일 수 있어요', caution: true };
  }
  if (perWeek < 1) {
    return { label: '주 1회 미만 — 활동이 적은 편이에요. 확산용 계정으로는 신중히 볼 필요가 있어요', caution: true };
  }
  const n = Number.isInteger(perWeek) ? String(perWeek) : perWeek.toFixed(1);
  return perWeek > 3
    ? { label: `주 ${n}건 — 활발한 편`, caution: false }
    : { label: `주 ${n}건 — 보통`, caution: false };
}

// 조회 중앙값을 팔로워 규모에 대 보고 판단한다 — 절대값만으론 계정 크기에 따라 의미가 다르다.
// 축약 표기는 formatKoCount(천·만·억) — 분석은 읽는 화면이라 X식 K/M보다 한국어 단위가 빨리 읽힌다(스펙 §3).
export function judgeEngagement(medianViews: number | null, followers: number | null): string {
  if (medianViews === null) return '조회수를 확인할 수 없었어요';
  const v = `조회 중앙값 ${formatKoCount(medianViews)}`;
  if (followers === null || followers === 0) return v;
  const r = medianViews / followers;
  if (r >= 0.5) return `${v} — 팔로워 규모 대비 활발한 편`;
  if (r >= 0.1) return `${v} — 팔로워 규모 대비 보통`;
  return `${v} — 팔로워 규모 대비 드문 편`;
}

// v2(스펙 §4): 직접 쓴 글 기준 빈도. 임계(주 1·3건)는 2단계에서 분포를 보고 조정한다.
export function judgeDirectCadence(directPerDay: number, collectedInWindow: number): CadenceJudgment {
  if (collectedInWindow === 0) return { label: '최근 4주 게시 없음 — 활동이 멈춘 계정일 수 있어요', caution: true };
  const perWeek = Math.round(directPerDay * 7 * 10) / 10;
  const n = Number.isInteger(perWeek) ? String(perWeek) : perWeek.toFixed(1);
  if (perWeek < 1) return { label: `주 ${n}건 — 직접 쓰는 글이 드물어요`, caution: true };
  return perWeek > 3 ? { label: `주 ${n}건 — 활발한 편`, caution: false } : { label: `주 ${n}건 — 보통`, caution: false };
}
// RT는 "적으면 나쁜" 축이 아니다 — 확산 채널로서의 활동량을 서술만 한다(caution 없음).
export function judgeRt(rtPerDay: number, rtShare: number): { value: string; verdict: string; caution: false } {
  const n = Number.isInteger(rtPerDay) ? String(rtPerDay) : rtPerDay.toFixed(1);
  const value = `RT 하루 ${n}건 · 글의 ${Math.round(rtShare * 100)}%`;
  const verdict = rtPerDay < 1 ? '확산 활동이 거의 없어요' : rtPerDay < 10 ? '확산 활동이 있어요' : '확산 활동이 매우 활발해요';
  return { value, verdict, caution: false };
}
