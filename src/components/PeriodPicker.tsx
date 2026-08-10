'use client';
import { useEffect, useRef, useState } from 'react';
import { formatPeriodLabel, isRangeInverted, type Period, type PeriodValue } from '@/lib/draftViews';

const PRESETS: Array<{ preset: Period; label: string }> = [
  { preset: 'all', label: '전체 기간' }, { preset: 'today', label: '오늘' },
  { preset: '7d', label: '최근 7일' }, { preset: '30d', label: '최근 30일' },
];

// 기간 렌즈 — 프리셋은 즉시 적용+닫힘, 직접 지정은 네이티브 date 입력(브라우저 캘린더 활용, 내부 도구 관례).
// 팝오버는 date 입력이 잘리지 않는 폭을 보장한다(min-w + w-full — 시안 피드백).
export function PeriodPicker({ value, onChange }: { value: PeriodValue; onChange: (v: PeriodValue) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const range = value.kind === 'range' ? value : { kind: 'range' as const, from: '', to: '' };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open}
              className="flex h-8 items-center gap-1 rounded-md border border-x-border-strong bg-white px-2.5 text-[13px] text-x-secondary hover:bg-x-hover">
        <span aria-hidden>🗓</span> {formatPeriodLabel(value)} <span aria-hidden>⌄</span>
      </button>
      {open && (
        <div role="dialog" aria-label="기간 선택"
             className="absolute left-0 z-30 mt-1 min-w-[300px] rounded-xl border border-x-border-strong bg-white p-3 shadow-lg">
          <div className="flex flex-col gap-1" role="group" aria-label="기간 프리셋">
            {PRESETS.map((p) => (
              <button key={p.preset} onClick={() => { onChange({ kind: 'preset', preset: p.preset }); setOpen(false); }}
                      className={`rounded-md px-2.5 py-1.5 text-left text-[13px] ${value.kind === 'preset' && value.preset === p.preset ? 'bg-x-blue/10 font-bold text-x-blue-text' : 'text-x-secondary hover:bg-x-hover'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-2 border-t border-x-border pt-2">
            <p className="mb-1.5 text-caption text-x-muted">직접 지정 — 날짜를 고르면 바로 적용됩니다</p>
            <div className="flex flex-col gap-1.5">
              <input type="date" value={range.from} aria-label="시작 날짜"
                     onChange={(e) => onChange({ kind: 'range', from: e.target.value, to: range.to })}
                     className="h-8 w-full rounded-md border border-x-border-strong bg-white px-2 text-[13px] outline-none focus:border-x-blue" />
              <input type="date" value={range.to} aria-label="끝 날짜"
                     onChange={(e) => onChange({ kind: 'range', from: range.from, to: e.target.value })}
                     className="h-8 w-full rounded-md border border-x-border-strong bg-white px-2 text-[13px] outline-none focus:border-x-blue" />
            </div>
            {isRangeInverted(value) && (
              <p className="mt-1.5 text-caption text-red-600">시작이 끝보다 늦어요 — 기간이 적용되지 않았어요</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
