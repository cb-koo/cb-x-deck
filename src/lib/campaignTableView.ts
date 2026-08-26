// 콘텐츠 표·요약 카드·달력 카드가 쓰는 표시 문자열 — 컴포넌트가 아니라 여기 두어 테스트로 고정한다.
// 라벨-값 일치(AGENTS 원칙 4)는 대개 문구에서 깨진다: 판정은 campaignJudgment, 문구는 여기, 그리기는 컴포넌트.
import {
  isOverdue, daysBetweenDates, formatDateKo,
  type StageInput, type CampaignSummary, type PerfSummary,
} from './campaignJudgment.ts';
import {
  COST_TYPE_LABEL, CURRENCIES, moneyParts,
  type Currency, type DraftCost, type MoneyByCurrency,
} from './campaignCost.ts';

/** 밀림이면 며칠 지났는지, 아니면 null — 게시됨·미사용·예정일 없음·오늘 이후는 전부 null(isOverdue와 같은 모집단) */
export function overdueDays(d: StageInput, today: string): number | null {
  return isOverdue(d, today) ? daysBetweenDates(d.scheduledOn as string, today) : null;
}

/** 예정일이 없을 때 표시하는 문구 — 표 셀·ScheduledOnField(compact)가 같은 상수를 쓴다(리뷰 반영: 두 경로 중복 제거) */
export const NO_SCHEDULE_LABEL = '예정일 없음';

/** '1일 지남' — 밀림 접미사. scheduledOnLabel과 ScheduledOnField가 같은 문구를 조립한다 */
export function overdueSuffix(days: number): string {
  return `${days}일 지남`;
}

/** '8/26 수 · 1일 지남' | '8/29 토' | '예정일 없음' — 표 셀·달력 카드가 같은 문구 */
export function scheduledOnLabel(d: StageInput, today: string): string {
  if (!d.scheduledOn) return NO_SCHEDULE_LABEL;
  const od = overdueDays(d, today);
  return od !== null ? `${formatDateKo(d.scheduledOn)} · ${overdueSuffix(od)}` : formatDateKo(d.scheduledOn);
}

/** 콘텐츠 유형 셀 '투고' — 비용 유형이 곧 콘텐츠 유형. 없으면 '—'(QA 1라운드: 콘텐츠 칸 13px 보조줄 → 전용 열).
 *  단문/스레드 구분은 열에서 뺐다 — 표에서 판단에 쓰이지 않는다는 오너 결정(QA 1라운드). */
export function contentTypeLabel(d: { cost: DraftCost | null }): string {
  return d.cost ? COST_TYPE_LABEL[d.cost.type] : '—';
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

// 요약 카드 보조 문구(스펙 §3-2) — 숫자만 던지지 않고 판단을 붙인다(UX 원칙 3).
// QA 1라운드: 보조 줄은 '판단 한 줄'로 짧게, 방법 설명("통화가 다르면…")은 라벨 옆 ⓘ로 옮겼다.
export function overdueJudgment(n: number): string {
  return n === 0 ? '없음 — 예정대로' : '예정일 지났는데 아직 안 올라감';
}
/** '준비 중 1' · '전달됨 1 · 준비 중 2' — 0인 항목은 빼서 눈이 붙잡을 숫자만 남긴다.
 *  콘텐츠가 없으면 '콘텐츠 없음', 남은 게 없으면(전부 게시) '모두 게시됨'. */
export function publishedSub(s: CampaignSummary): string {
  if (s.total === 0) return '콘텐츠 없음';
  const parts = [
    s.delivered > 0 ? `전달됨 ${s.delivered}` : null,
    s.preparing > 0 ? `준비 중 ${s.preparing}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '모두 게시됨';
}
// 비용 카드 보조 줄에서만 쓰는 통화 이름 — '원/엔'(금액 뒤 단위)과 달리 문장 안에서는 '원화/엔화'로 읽힌다(오너 결정).
const CURRENCY_WORD: Record<Currency, string> = { KRW: '원화', JPY: '엔화' };
/** 비용 카드 보조 줄 — 한 통화만 있으면 '원화 기준 · 엔화 없음', 둘 다면 숫자 두 줄이 스스로 말하므로 빈 문자열,
 *  아예 없으면 '비용 입력 없음'. 통화 간 합산은 어디서도 하지 않는다(§2-4). */
export function costSub(m: MoneyByCurrency): string {
  const present = moneyParts(m).map((p) => p.currency);
  if (present.length === 0) return '비용 입력 없음';
  if (present.length > 1) return '';
  const has = present[0];
  const missing = CURRENCIES.filter((c) => c !== has).map((c) => CURRENCY_WORD[c]).join(' · ');
  return `${CURRENCY_WORD[has]} 기준 · ${missing} 없음`;
}
/** 조회 카드 보조 줄 — 게시된 게 없으면 숫자 대신 그 사실을 말한다(링크 클릭은 있을 때만 덧붙임). */
export function perfSub(p: PerfSummary): string {
  if (p.publishedCount === 0) {
    return p.linkClicks ? `게시된 콘텐츠 없음 · 링크 클릭 ${num(p.linkClicks)}` : '게시된 콘텐츠 없음';
  }
  return `게시 ${p.publishedCount}건 · 좋아요 ${num(p.likes)} · 링크 클릭 ${num(p.linkClicks)}`;
}
