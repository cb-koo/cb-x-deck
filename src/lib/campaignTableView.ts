// 콘텐츠 표·요약 카드·달력 카드가 쓰는 표시 문자열 — 컴포넌트가 아니라 여기 두어 테스트로 고정한다.
// 라벨-값 일치(AGENTS 원칙 4)는 대개 문구에서 깨진다: 판정은 campaignJudgment, 문구는 여기, 그리기는 컴포넌트.
import {
  isOverdue, daysBetweenDates, formatDateKo,
  type StageInput, type CampaignSummary, type PerfSummary,
} from './campaignJudgment.ts';
import { COST_TYPE_LABEL, type DraftCost } from './campaignCost.ts';

/** 밀림이면 며칠 지났는지, 아니면 null — 게시됨·미사용·예정일 없음·오늘 이후는 전부 null(isOverdue와 같은 모집단) */
export function overdueDays(d: StageInput, today: string): number | null {
  return isOverdue(d, today) ? daysBetweenDates(d.scheduledOn as string, today) : null;
}

/** '8/26 수 · 1일 지남' | '8/29 토' | '예정일 없음' — 표 셀·달력 카드가 같은 문구 */
export function scheduledOnLabel(d: StageInput, today: string): string {
  if (!d.scheduledOn) return '예정일 없음';
  const od = overdueDays(d, today);
  return od ? `${formatDateKo(d.scheduledOn)} · ${od}일 지남` : formatDateKo(d.scheduledOn);
}

/** 콘텐츠 셀 보조줄 '투고 · 단문' — 유형은 비용 유형(없으면 생략). 캠페인 유형은 헤더에 있어 행마다 반복하지 않는다. */
export function contentSubline(d: { cost: DraftCost | null; format: 'single' | 'thread' }): string {
  return [d.cost ? COST_TYPE_LABEL[d.cost.type] : null, d.format === 'thread' ? '스레드' : '단문']
    .filter(Boolean).join(' · ');
}

const num = (n: number | null) => (n === null ? '—' : n.toLocaleString('ko-KR'));

/** 성과 셀 — 게시됨 행만 '조회 12,400 · 링크 96'. 스냅샷 없으면 '조회 —'(0으로 위장하지 않는다, 스펙 §7). 미게시는 '—'. */
export function perfLabel(d: { published: boolean; perf: { views: number | null } | null; linkClicks: number | null }): string {
  if (!d.published) return '—';
  const parts = [`조회 ${num(d.perf?.views ?? null)}`];
  if (d.linkClicks !== null) parts.push(`링크 ${num(d.linkClicks)}`);
  return parts.join(' · ');
}

/** 인플 아바타 이니셜(InfluencerProfile.Avatar와 같은 규칙 — 프로필 사진은 여기까지 안 내려온다) */
export function handleInitial(handle: string): string {
  return handle.replace(/^@/, '').slice(0, 1).toUpperCase();
}

// 요약 카드 보조 문구(스펙 §3-2) — 숫자만 던지지 않고 판단을 붙인다(UX 원칙 3)
export function overdueJudgment(n: number): string {
  return n === 0 ? '밀린 콘텐츠가 없어요' : '예정일 지났는데 아직 안 올라감';
}
export function publishedSub(s: CampaignSummary): string {
  return `전달됨 ${s.delivered} · 준비 중 ${s.preparing}`;
}
export function perfSub(p: PerfSummary): string {
  return `게시 ${p.publishedCount}건 · 좋아요 ${num(p.likes)} · 링크 클릭 ${num(p.linkClicks)}`;
}
