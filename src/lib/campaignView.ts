// 캠페인 목록·선택·보기 기억의 순수 규칙 — 페이지 컴포넌트가 아니라 여기 두어 테스트로 고정한다.
import { campaignStatus, formatDateKo } from './campaignJudgment.ts';

export interface CampaignGroups<T> { active: T[]; upcoming: T[]; ended: T[] }

// 그룹은 기간에서 파생한 상태로만 나눈다(§10 수동 상태 없음). 그룹 안 순서는 서버 순서(starts_on desc) 그대로.
export function groupCampaigns<T extends { startsOn: string; endsOn: string }>(rows: T[], today: string): CampaignGroups<T> {
  const g: CampaignGroups<T> = { active: [], upcoming: [], ended: [] };
  for (const r of rows) g[campaignStatus(r.startsOn, r.endsOn, today)].push(r);
  return g;
}

// 진입 시 자동 선택(스펙 §3-2 목록): ?id=가 살아 있으면 그것, 아니면 진행 중 첫 → 예정 첫 → 종료 첫.
// missing = ?id=가 있었는데 목록에 없음(삭제됨) → 페이지가 토스트로 알리고 폴백을 연다(§7).
export function pickCampaignId<T extends { id: string; startsOn: string; endsOn: string }>(
  rows: T[], urlId: string | null, today: string,
): { id: string | null; missing: boolean } {
  if (urlId && rows.some((r) => r.id === urlId)) return { id: urlId, missing: false };
  const g = groupCampaigns(rows, today);
  const first = g.active[0] ?? g.upcoming[0] ?? g.ended[0] ?? null;
  return { id: first?.id ?? null, missing: !!urlId };
}

/** '8/24 월 ~ 8/30 일' — 목록 보조줄. (인플 프로필 참여 캠페인(Task 14)은 G4와 병렬이라 이 파일을 import하지 않고 formatDateKo로 같은 모양을 조립한다) */
export function periodLabel(startsOn: string, endsOn: string): string {
  return `${formatDateKo(startsOn)} ~ ${formatDateKo(endsOn)}`;
}
/** 목록 행 보조줄 — 콘텐츠 수는 미사용 제외(campaignStore.draftCount) */
export function listSubline(c: { startsOn: string; endsOn: string; draftCount: number }): string {
  return `${periodLabel(c.startsOn, c.endsOn)} · 콘텐츠 ${c.draftCount}개`;
}

// 상세 [표 | 주간 달력] — 작업 방식 선호라 저장한다(generate VIEW_KEY 관례). 기본은 표(§3-2).
export type DetailView = 'table' | 'calendar';
export const DETAIL_VIEW_KEY = 'campaign-detail-view';
export function parseDetailView(raw: string | null): DetailView {
  return raw === 'calendar' ? 'calendar' : 'table';
}
