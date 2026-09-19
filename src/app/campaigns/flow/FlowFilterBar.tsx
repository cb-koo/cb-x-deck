'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  EMPTY_FLOW_FILTER, filterCount, isFilterActive, DISPLAY_TYPE_ORDER, EXTRA_FILTERS, EXTRA_FILTER_LABEL,
  type FlowFilter, type ExtraFilter,
} from '@/lib/campaignFlowView';
import { FLOW_STAGES, FLOW_STAGE_LABEL, TASK_TYPE_LABEL, type FlowStage, type TaskType } from '@/lib/campaignJudgment';

// 필터 드롭다운 + 검색 + 요약/정렬 문구 + 정산 대기 바로가기(b-task-6-brief.md §1) — 한 줄(flex-wrap).
// 팝오버 골격(바깥 클릭·Esc capture·스크롤 닫기·createPortal·좌표 클램프)은 CostPopover와 같다 — 새로 발명하지 않는다.
const POP_W = 260;
const POP_H = 360;   // 세 묶음(단계 6·유형 4·추가 조건 3) + 제목 — flip 판정에만 쓰는 근사치(CostPopover 관례)

function toggle<T>(set: Set<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

// 세 묶음(단계·유형·추가 조건) 공통 모양 — 묶음 안 OR, 묶음 사이 AND(campaignFlowView.matchesFlowFilter)
function FilterGroup<T extends string>({ title, items, checked, onToggle, className }: {
  title: string;
  items: ReadonlyArray<{ key: T; label: string; count: number }>;
  checked: Set<T>;
  onToggle: (key: T) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-caption text-x-muted">{title}</p>
      {items.map((it) => (
        <label key={it.key} className="flex h-8 items-center gap-2 text-ui">
          <input type="checkbox" checked={checked.has(it.key)} onChange={() => onToggle(it.key)} />
          {it.label}
          <span className="ml-auto text-x-muted tabular-nums">{it.count}</span>
        </label>
      ))}
    </div>
  );
}

export function FlowFilterBar({ filter, onChange, counts, summary, sortNote, settleWait, campaignId }: {
  filter: FlowFilter;
  onChange: (f: FlowFilter) => void;
  counts: { stage: Record<FlowStage, number>; type: Record<TaskType, number>; extra: Record<ExtraFilter, number> };
  summary: string;
  sortNote: string;
  settleWait: number;
  campaignId: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - POP_W - 8));
    const below = r.bottom + 4;
    const flip = below + POP_H > window.innerHeight && r.top - POP_H - 4 > 0;
    setPos({ top: flip ? r.top - POP_H - 4 : below, left });
  }, []);
  const close = useCallback(() => {
    if (popRef.current?.contains(document.activeElement)) btnRef.current?.focus();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    // capture로 받아 전파를 끊는다 — 패널·오버레이의 Esc 리스너까지 한 번에 닫히지 않게(CostPopover 관례)
    const onKey = (e: KeyboardEvent) => { if (e.key !== 'Escape' || e.isComposing) return; e.stopPropagation(); close(); };
    const onMove = () => place();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, close, place]);

  const n = filterCount(filter);
  const active = isFilterActive(filter);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button ref={btnRef} type="button" onClick={() => { if (open) { close(); return; } place(); setOpen(true); }}
              aria-haspopup="dialog" aria-expanded={open}
              className="inline-flex h-9 items-center gap-1 rounded-full border border-x-border-strong bg-white px-3.5 text-ui hover:bg-x-hover">
        필터{n > 0 && <span className="ml-1 rounded-full bg-x-blue/10 px-1.5 text-x-blue-text">{n}</span>}▾
      </button>
      <input placeholder="인플루언서 · 원고 검색" aria-label="인플루언서·원고 검색" value={filter.q}
             onChange={(e) => onChange({ ...filter, q: e.target.value })}
             className="h-9 w-[260px] rounded-md border border-x-border-strong bg-white px-3 text-ui outline-none focus:border-x-blue" />
      <span className="text-ui text-x-secondary">
        {summary}
        {active && (
          <button type="button" onClick={() => onChange(EMPTY_FLOW_FILTER())} className="ml-1.5 text-x-blue-text hover:underline">[지우기]</button>
        )}
        <span className="ml-1.5 text-x-muted">{sortNote}</span>
      </span>
      <span className="ml-auto text-ui">
        {settleWait > 0
          ? <Link href={`/settlement?tab=candidates&campaign=${campaignId}`} className="text-x-blue-text hover:underline">정산 대기 {settleWait}건 · 정산에서 확인 →</Link>
          : <span className="text-x-muted">정산 대기 없음</span>}
      </span>
      {open && createPortal(
        <div ref={popRef} role="dialog" aria-label="필터" style={{ top: pos.top, left: pos.left, width: POP_W }}
             onClick={(e) => e.stopPropagation()}
             className="fixed z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-x-border-strong bg-white p-3 shadow-lg">
          <FilterGroup title="단계" items={FLOW_STAGES.map((k) => ({ key: k, label: FLOW_STAGE_LABEL[k], count: counts.stage[k] }))}
                       checked={filter.stages} onToggle={(k) => onChange({ ...filter, stages: toggle(filter.stages, k) })} />
          <FilterGroup title="유형" items={DISPLAY_TYPE_ORDER.map((k) => ({ key: k, label: TASK_TYPE_LABEL[k], count: counts.type[k] }))}
                       checked={filter.types} onToggle={(k) => onChange({ ...filter, types: toggle(filter.types, k) })} className="mt-3" />
          <FilterGroup title="추가 조건" items={EXTRA_FILTERS.map((k) => ({ key: k, label: EXTRA_FILTER_LABEL[k], count: counts.extra[k] }))}
                       checked={filter.extras} onToggle={(k) => onChange({ ...filter, extras: toggle(filter.extras, k) })} className="mt-3" />
        </div>,
        document.body,
      )}
    </div>
  );
}
