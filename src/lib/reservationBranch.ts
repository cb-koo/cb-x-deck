// 예약 창의 지점 선택 — 순수 부분(클라이언트 컴포넌트에서 쓴다. clinicStore를 끌어오지 않는다).
import type { ClinicSummary } from './clinicLocation';
import { readClientSheetInputs } from './reservationSheet';

export type BranchOption = { id: string; name: string; label: string; active: boolean };
// 지점명이 빈 본점은 '본점'으로 — 드롭다운 글자와 시트 7. 지점 값이 같은 이름을 쓰게(UX 원칙 4)
export const branchName = (l: Pick<ClinicSummary, 'branchName'>) => l.branchName || '본점';

// 사용 중 지점(순서대로) + 저장된 예약이 가리키는 지점이면 사용 중지여도 남긴다(스펙 §3).
export function branchOptions(locations: ClinicSummary[], keepId?: string | null): BranchOption[] {
  return locations.filter((l) => l.active || l.id === keepId)
    .sort((a, b) => a.position - b.position)
    .map((l) => ({ id: l.id, name: branchName(l), label: `${branchName(l)}${l.active ? '' : ' (사용 중지)'}`, active: l.active }));
}
// 고를 게 2개 이상일 때만 드롭다운 — 지점 1개 클리닉은 예전 그대로(QA H5).
// 사용 중 1곳 + 예약의 중지 지점이면 2개라 드롭다운이 뜬다(옮길 수 있게).
export const isMultiBranch = (options: BranchOption[]) => options.length >= 2;

// 저장된 예약은 그 지점, 새 예약은 1곳이면 그 지점·여러 곳이면 비워 둔다(목업 webDraft.branchId '' · QA G2/D14).
export function initialBranchId(options: BranchOption[], savedId?: string | null): string | null {
  if (savedId) return savedId;
  return options.length === 1 ? options[0].id : null;
}

// 파싱 뒤 안내 — parsedBranch는 파싱 전 null, 뒤에는 시트 7. 지점 값(서버가 등록된 지점명으로 맞춘 값).
export function branchHint(parsedBranch: string | null, selected: BranchOption | null): { warn: boolean; text: string } | null {
  if (parsedBranch === null) return null;
  if (selected) return { warn: false, text: parsedBranch ? `고객 답변 "${parsedBranch}" → ${selected.name} 자동 선택` : `고객 답변으로 ${selected.name} 자동 선택` };
  return { warn: true, text: '고객 답변과 맞는 지점이 없어요 · 직접 골라 주세요' };
}

// 사람이 시트의 7. 지점 줄을 직접 고쳤을 때 — 등록된 사용 중 지점 이름과 같으면 그 지점(드롭다운이 따라간다), 아니면 null(드롭다운은 그대로).
export function branchFromSheet(sheet: string, options: BranchOption[]): BranchOption | null {
  const name = readClientSheetInputs(sheet).branch.trim();
  return name ? options.find((o) => o.active && o.name === name) ?? null : null;
}

// 양식 {{branch}} — 지점 1곳이면 예전처럼 '본점', 여러 곳이면 고른 지점명(없으면 빈 칸) — 스펙 §3 '지점 값의 출처'.
export function branchContext(options: BranchOption[], selected: BranchOption | null): string {
  return isMultiBranch(options) ? selected?.name ?? '' : '본점';
}
