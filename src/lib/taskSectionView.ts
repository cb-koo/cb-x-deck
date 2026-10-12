import type { CampaignTaskItem } from './campaignStore';
import { hasActiveSettlement, type VisitPhase } from './reservationPolicy';

// 방문협찬 작업 패널의 접히는 상자(목업 x-extension task-presentation) — 일정 상자는 늘 펼쳐 두고,
// 예약 변경 내역 → 협찬 동의서 → 예산 · 정산 → 원고 → 메모 → 게시는 요약 한 줄 + [펼치기]로 둔다.
// 기본으로 펼칠 상자는 방문 단계가 정한다: 확정이면 동의서, 방문이면 원고·게시, 업로드·정산이면 예산 · 정산.
// 변경 내역·메모는 기본으로 접는다.
export type TaskSectionKey = 'history' | 'consent' | 'draft' | 'money' | 'memo' | 'posting';
// 사람이 직접 접고 편 기록 — 어느 단계에서 했는지 함께 적는다(아래 규칙에 쓴다)
export type TaskSectionPrefs = Partial<Record<TaskSectionKey, { open: boolean; phase: VisitPhase }>>;

// 직접 펼친 상자는 단계가 바뀌어도·다른 작업을 다녀와도 펼쳐 둔다. 직접 접은 것은 그 단계에서만 유효하다 —
// 새로 관련 있는 단계에 들어서면(예: 방문 → 업로드의 예산 · 정산) 다시 펼친다.
export function taskSectionOpen(phase: VisitPhase, key: TaskSectionKey, preferences: TaskSectionPrefs): boolean {
  const preference = preferences[key];
  if (preference?.open || preference?.phase === phase) return preference.open;
  if (key === 'consent') return phase === 'confirmed';
  if (key === 'draft' || key === 'posting') return phase === 'visited';
  if (key === 'money') return phase === 'uploaded' || phase === 'settling';
  return false;
}

// 표 행만으로 어림한 방문 단계 — 서버 단계(예약 상세·TaskDto.visitPhase)가 오기 전의 첫 그림에 쓴다.
// 행에는 수동 방문 완료·예약 종료 사유가 없어 그 둘은 못 본다(서버 값이 오면 그쪽이 이긴다). 그 밖은 서버 visitPhase(reservationPolicy)와
// 같은 순서·같은 판정이어야 서버 값이 도착해도 상자가 접혔다 펴지지 않는다 — 그래서 flowStage가 아니라 그 함수를 그대로 옮겼다
// (다른 곳에서 정산함은 flowStage엔 '완료'지만 서버 방문 단계는 보지 않아 '업로드'다).
export function visitPhaseFromRow(t: CampaignTaskItem, today: string): VisitPhase {
  if (t.cancelledAt) return 'cancelled';
  const paid = t.settlement?.status === 'requested' && t.settlement.externalStatus === 'paid';
  if (paid || (t.postedAt && t.noCost)) return 'completed';
  if (hasActiveSettlement(t.settlement)) return 'settling';
  if (t.postedAt) return 'uploaded';
  if (!t.reservation) return 'unregistered';
  // 확정 방문일 다음 날부터 방문으로 본다(reservationPolicy.visitPhase와 같은 기준) — 예약 저장이 작업 방문일을 함께 맞춘다
  if (t.reservation === 'confirmed' && t.visitOn && t.visitOn < today) return 'visited';
  return t.reservation;
}

// 변경 시각 한 줄 — 목업과 같은 모양('2026. 10. 07. 14:30', 한국 시간)
export function changedAtLabel(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(t);
}
