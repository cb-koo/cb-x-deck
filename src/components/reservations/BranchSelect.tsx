'use client';
import type { BranchOption } from '@/lib/reservationBranch';

const BASE = 'w-full min-w-0 rounded-md border px-2.5 py-2 text-ui outline-none focus:border-x-blue disabled:bg-x-hover disabled:text-x-muted';
// 지점 드롭다운(목업 branchField) — 파싱으로 고른 지점은 초록, 맞는 지점이 없으면 주황 테두리와 안내.
export function BranchSelect({ id, options, value, hint, disabled, onChange }: {
  id: string; options: BranchOption[]; value: string | null; hint?: { warn: boolean; text: string } | null;
  disabled?: boolean; onChange: (id: string) => void;
}) {
  const selected = options.find((o) => o.id === value) ?? null;
  const tone = hint?.warn ? 'border-amber-500 bg-amber-50' : hint ? 'border-green-600 bg-green-50' : 'border-x-border-strong bg-white';
  return <>
    <select id={id} value={selected?.id ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`${BASE} ${tone}`}>
      <option value="" disabled>지점 선택</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
    {hint && <small className={`text-caption ${hint.warn ? 'font-semibold text-amber-700' : 'text-green-700'}`}>{hint.text}</small>}
  </>;
}
