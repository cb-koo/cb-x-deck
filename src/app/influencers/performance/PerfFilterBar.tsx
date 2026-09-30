// 인플루언서 성과 — 표 위 필터 두 줄(스펙 §16). 1줄 = 검색 · 클라이언트 · 유형 · 게시 [n]건 이상 ··· 오른쪽 끝 중앙값/평균,
// 2줄 = 기간 빠른 선택 · 직접 지정. 한 줄 안 컨트롤은 전부 h-8·같은 테두리(x-border-strong)라 높이·선 굵기가 맞는다.
// 켜진 필터는 테두리·글자를 파랑으로 한 단계(배경은 그대로). 좁으면 줄바꿈(가로 스크롤 없음).
// 기간 모양은 콘텐츠 성과(performance/page.tsx)의 기간 세그먼트·직접 지정, 복수 선택 팝오버는 캠페인 FlowFilterBar의
// 체크박스 행·팝오버 골격(바깥 클릭·Esc capture·스크롤 닫기·createPortal·좌표 클램프)과 같다 — 새로 발명하지 않는다.
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SearchIcon } from '@/components/XIcons';
import { TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';
import { DISPLAY_TYPE_ORDER } from '@/lib/campaignFlowView';
import {
  PERIOD_PRESETS, selectionLabel, typeNames, toggleType, normalizeMinPosted, customDateHint,
  type PerfFilter, type Period, type Agg,
} from '@/lib/influencerPerformance';

const CTRL = 'h-8 rounded-lg border bg-white text-ui';
const tone = (on: boolean) => (on ? 'border-x-blue text-x-blue-text' : 'border-x-border-strong text-x-text');
const AGGS: Array<[Agg, string]> = [['median', '중앙값'], ['mean', '평균']];
const PERIODS: Array<[Period, string]> = [['all', '전체'], ...PERIOD_PRESETS.map((p): [Period, string] => [p, `${p}일`])];

export interface ClientOption { id: string; name: string }

// 세그먼트 — 이 화면의 중앙값/평균 토글과 같은 규격(h-8·text-ui), 고른 칸만 파랑 채움
function Segment<T extends string>({ label, title, items, value, onPick }: {
  label: string; title?: string; items: ReadonlyArray<[T, string]>; value: T | null; onPick: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} title={title} className="flex h-8 w-fit overflow-hidden rounded-lg border border-x-border-strong">
      {items.map(([v, text], i) => (
        <button key={v} type="button" onClick={() => onPick(v)} aria-pressed={value === v}
                className={`h-full px-3 text-ui ${i > 0 ? 'border-l border-x-border-strong' : ''} ${value === v ? 'bg-x-blue font-bold text-white' : 'bg-white text-x-secondary hover:bg-x-hover'}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

const POP_W = 240;
const ROW_H = 32;

// 복수 선택 — 버튼 `이름: 요약 ▾` + 체크박스 목록 팝오버(항목 오른쪽 = 그 항목의 게시된 작업 수), 맨 아래 모두 해제
function MultiSelect<T extends string>({ name, title, summary, items, selected, onToggle, onClear }: {
  name: string; title: string; summary: string;
  items: ReadonlyArray<{ key: T; label: string; count: number }>;
  selected: readonly T[]; onToggle: (key: T) => void; onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const popH = items.length * ROW_H + ROW_H + 24;   // flip 판정용 근사치(FlowFilterBar 관례)

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - POP_W - 8));
    const below = r.bottom + 4;
    const flip = below + popH > window.innerHeight && r.top - popH - 4 > 0;
    setPos({ top: flip ? r.top - popH - 4 : below, left });
  }, [popH]);
  const close = useCallback(() => {
    if (popRef.current?.contains(document.activeElement)) btnRef.current?.focus();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    popRef.current?.focus();   // 포털이라 DOM 끝에 붙는다 — 포커스를 옮겨야 다음 Tab이 체크박스로 간다
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
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

  const on = selected.length > 0;
  return (
    <>
      <button ref={btnRef} type="button" title={title} aria-haspopup="dialog" aria-expanded={open}
              onClick={() => { if (open) { close(); return; } place(); setOpen(true); }}
              className={`${CTRL} inline-flex max-w-[260px] items-center gap-1 px-2.5 hover:bg-x-hover ${tone(on)}`}>
        <span className={on ? '' : 'text-x-secondary'}>{name}:</span>
        <span className="truncate">{summary}</span>
        <span aria-hidden className="text-x-muted">▾</span>
      </button>
      {open && createPortal(
        <div ref={popRef} role="dialog" aria-label={name} tabIndex={-1} style={{ top: pos.top, left: pos.left, width: POP_W }}
             className="fixed z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-x-border-strong bg-white px-3 py-2 shadow-lg outline-none">
          {items.map((it) => (
            <label key={it.key} className="flex h-8 cursor-pointer items-center gap-2 text-ui">
              <input type="checkbox" checked={selected.includes(it.key)} onChange={() => onToggle(it.key)} />
              <span className="truncate">{it.label}</span>
              <span className="ml-auto text-x-muted tabular-nums">{it.count}</span>
            </label>
          ))}
          <div className="mt-1 border-t border-x-border pt-1">
            <button type="button" onClick={onClear} disabled={!on}
                    className="h-8 text-ui text-x-blue-text hover:underline disabled:cursor-default disabled:text-x-muted disabled:no-underline">
              모두 해제
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export function PerfFilterBar({ filter, clients, counts, onChange, agg, onAgg }: {
  filter: PerfFilter;
  clients: ClientOption[];
  counts: { client: Record<string, number>; type: Record<TaskType, number> };
  onChange: (patch: Partial<PerfFilter>) => void;
  agg: Agg; onAgg: (agg: Agg) => void;
}) {
  // 최소 게시 수 — 치는 동안은 친 그대로(raw), 적용은 정규화 값. 칸을 떠나면 적용 값으로 돌아간다.
  // raw가 null이면 적용 값을 그대로 보인다 → '필터 지우기'가 동기화 코드 없이 칸에도 반영된다
  const [minRaw, setMinRaw] = useState<string | null>(null);
  const minOn = filter.minPosted !== 1;

  const clientNames = clients.filter((c) => filter.clientIds.includes(c.id)).map((c) => c.name);
  const toggleClient = (id: string) => onChange({
    clientIds: filter.clientIds.includes(id) ? filter.clientIds.filter((x) => x !== id) : [...filter.clientIds, id],
  });
  const hasDate = filter.from !== '' || filter.to !== '';
  const customApplied = filter.from !== '' && filter.to !== '' && filter.from <= filter.to;
  const hint = customDateHint(filter);
  const dateCls = (v: string) => `${CTRL} px-2 ${tone(customApplied && v !== '')}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <span className="sr-only">핸들·이름 검색</span>
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-x-muted" />
          <input type="search" placeholder="핸들·이름 검색" value={filter.q} onChange={(e) => onChange({ q: e.target.value })}
                 className={`${CTRL} w-[200px] pl-8 pr-2.5 outline-none placeholder:text-x-muted focus:border-x-blue ${filter.q.trim() ? 'border-x-blue' : 'border-x-border-strong'}`} />
        </label>
        <MultiSelect name="클라이언트" title="고른 클라이언트 캠페인의 작업만으로 성과를 다시 계산해요 — 여러 곳을 고를 수 있어요"
                     summary={selectionLabel(clientNames, 1)}
                     items={clients.map((c) => ({ key: c.id, label: c.name, count: counts.client[c.id] ?? 0 }))}
                     selected={filter.clientIds} onToggle={toggleClient} onClear={() => onChange({ clientIds: [] })} />
        <MultiSelect name="유형" title="고른 유형의 작업만으로 성과를 다시 계산해요 — 여러 개를 고를 수 있어요"
                     summary={selectionLabel(typeNames(filter.types), 2)}
                     items={DISPLAY_TYPE_ORDER.map((t) => ({ key: t, label: TASK_TYPE_LABEL[t], count: counts.type[t] }))}
                     selected={filter.types} onToggle={(t) => onChange({ types: toggleType(filter.types, t) })}
                     onClear={() => onChange({ types: [] })} />
        <label className={`flex items-center gap-1.5 text-ui ${minOn ? 'text-x-blue-text' : 'text-x-secondary'}`}
               title="게시한 작업이 이만큼 이상인 인플만 보여요 — 숫자는 바뀌지 않아요">
          게시
          <input type="number" min={1} step={1} inputMode="numeric" aria-label="최소 게시 수"
                 value={minRaw ?? String(filter.minPosted)}
                 onChange={(e) => {
                   setMinRaw(e.target.value);
                   const n = normalizeMinPosted(e.target.value);
                   if (n !== filter.minPosted) onChange({ minPosted: n });
                 }}
                 onBlur={() => setMinRaw(null)}
                 className={`${CTRL} w-14 px-2 text-center tabular-nums outline-none focus:border-x-blue ${tone(minOn)}`} />
          건 이상
        </label>

        {/* 오른쪽 끝 — 성과 열 전체와 정렬이 이 기준으로 바뀐다(스펙 §4-2) */}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-ui text-x-muted">기본은 중앙값 — 한 번 크게 터진 글에 덜 흔들려요</span>
          <Segment label="성과 기준" items={AGGS} value={agg} onPick={onAgg} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* 날짜를 고르면 빠른 선택은 꺼진 상태로 보인다(스펙 §16) — 빠른 선택을 누르면 날짜를 비운다 */}
        <Segment label="기간" title="게시일(서울) 기준 — 오늘 포함 N일 동안 게시한 작업만으로 성과를 다시 계산해요"
                 items={PERIODS} value={hasDate ? null : filter.period}
                 onPick={(p) => onChange({ period: p, from: '', to: '' })} />
        {/* 직접 지정 — 둘 다 고르면 적용된다(반쪽이면 적용 전, 옆에 흐린 안내). 시작·종료일 모두 포함 */}
        <label className={`flex items-center gap-1.5 text-ui ${hasDate ? 'text-x-text' : 'text-x-secondary'}`}
               title="시작일과 종료일을 둘 다 고르면 그 사이(양 끝 포함)에 게시한 작업만으로 계산해요">
          직접 지정
          <input type="date" value={filter.from} max={filter.to || undefined} aria-label="시작일"
                 onChange={(e) => onChange({ period: 'all', from: e.target.value })} className={dateCls(filter.from)} />
          <span className="text-x-muted">~</span>
          <input type="date" value={filter.to} min={filter.from || undefined} aria-label="종료일"
                 onChange={(e) => onChange({ period: 'all', to: e.target.value })} className={dateCls(filter.to)} />
        </label>
        {hint && <span className="text-ui text-x-muted">{hint}</span>}
      </div>
    </div>
  );
}
