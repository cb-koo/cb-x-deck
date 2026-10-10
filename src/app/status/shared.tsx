// 클라이언트 현황 주간·월간 상세가 같이 쓰는 부품 — 카드 아이콘, 구간 머리, 예약 상태 막대, 숫자 표기, 예산 문장.
import { StageChips } from './StageChips';
import { SegmentedBar } from '@/components/charts/SegmentedBar';
import { NUM } from '@/components/charts/tokens';
import { countTotal, type StatusCounts, type Stage, type Check } from '@/lib/clientStatus';

export const Icon = {
  users: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.7 2.6 3 5.2" /></svg>,
  bookmark: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M6 3.5h12v17l-6-4.2-6 4.2z" /></svg>,
  calendar: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>,
  list: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>,
  funnel: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M3.5 5h17l-6.5 7.5V19l-4 1.5v-8z" /></svg>,
  scatter: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4v16h16" /><circle cx="9" cy="14" r="1.6" /><circle cx="13" cy="9" r="2.2" /><circle cx="17.5" cy="12" r="1.4" /></svg>,
};

/** 배수 표기 — 10배 이상은 정수, 0은 0, 그 밖은 소수 한 자리 */
export const fmtX = (n: number) => (n >= 10 ? NUM.format(Math.round(n)) : n === 0 ? '0' : n.toFixed(1));

export const STAGE_BAR: Record<Stage, string> = { campaign: '#1d9bf0', conversion: '#6b3fc8', result: '#d97706' };
// 구간 머리 — 왼쪽 색 막대(구간 색 = 점검 칩 색) + 제목 + 그 구간의 점검 칩
export function SectionHead({ stage, title, checks }: { stage: Stage; title: string; checks: Check[] }) {
  const mine = checks.filter((c) => c.stage === stage);
  return (
    <div className="mt-4 flex items-center gap-3">
      <span className="h-5 w-1 rounded-full" style={{ background: STAGE_BAR[stage] }} />
      <h2 className="text-[18px] font-bold">{title}</h2>
      <StageChips checks={mine} max={3} />
    </div>
  );
}

const STATUS_SEG: Array<[keyof StatusCounts, string, string]> = [
  ['visited', '방문', '#1573ad'], ['confirmed', '확정(방문 전)', '#8ecdf8'], ['reviewing', '검토 중', '#c9d3d9'],
  ['lost', '실주', '#6b3fc8'], ['cancelled', '취소', '#e2a3a3'], ['noshow', '노쇼', '#dc2626'],
];
export function StatusBar({ c }: { c: StatusCounts }) {
  const total = countTotal(c);
  if (!total) return <p className="text-[13px] text-x-muted">이 기간 예약이 없어요</p>;
  return (
    <div className="flex flex-col gap-3">
      <SegmentedBar inBar total={total} segments={STATUS_SEG.map(([k, label, color]) => ({ value: c[k], color, label }))} />
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-[13px]">
        {STATUS_SEG.map(([k, label, color]) => (
          <span key={k} className="flex items-center gap-1.5 tabular-nums" style={{ opacity: c[k] ? 1 : 0.45 }}>
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label} <b>{c[k]}</b>
          </span>
        ))}
      </div>
      <p className="text-[12px] text-x-muted">전체 {total}건</p>
    </div>
  );
}

export function budgetHeadline(b: { total: number; spent: number; planned: number; pace: number }): string {
  const gap = b.total ? b.spent / b.total - b.pace : 0;
  const state = gap < -0.1 ? '집행이 느려요' : gap > 0.1 ? '집행이 빨라요' : '적정 속도예요';
  return `${state} — 집행 ${Math.round((b.spent / (b.total || 1)) * 100)}% · 예정 포함 ${Math.round((b.planned / (b.total || 1)) * 100)}%`;
}
