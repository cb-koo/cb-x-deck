'use client';
import type { ClientRow } from '@/lib/clientStore';
import type { ReportUnit } from '@/lib/reportApi';
import { addDays, bucketRanges, recommendUnit } from '@/lib/reportSeries';
import { kstToday } from '@/lib/datetime';

export interface ReportQuery { clientId: string; start: string; end: string; unit: ReportUnit }
const UNIT_LABEL: Record<ReportUnit, string> = { day: '일간', week: '주간', month: '월간' };

const CHIPS: Array<{ label: string; range: () => { start: string; end: string } }> = [
  { label: '지난달 (보고서용)', range: () => { const t = kstToday(); const first = t.slice(0, 8) + '01';
      return { start: addDays(first, -1).slice(0, 8) + '01', end: addDays(first, -1) }; } },
  { label: '이번 달', range: () => { const t = kstToday(); return { start: t.slice(0, 8) + '01', end: t }; } },
  { label: '최근 7일', range: () => ({ start: addDays(kstToday(), -7), end: addDays(kstToday(), -1) }) },
  { label: '최근 30일', range: () => ({ start: addDays(kstToday(), -30), end: addDays(kstToday(), -1) }) },
  { label: '최근 6개월', range: () => ({ start: addDays(kstToday(), -182), end: addDays(kstToday(), -1) }) },
];

// 클리닉·기간·단위를 고르면 400ms 디바운스 후 자동 조회(page.tsx) — 반복 마찰이 실사용 피드백으로
// 확인돼 opt-in 버튼에서 자동화로 승격(AGENTS.md UX 원칙 §6). 여기서는 선택 UI와 로딩 표시만 맡는다.
export function ReportControls({ clients, value, onChange, loading }: {
  clients: ClientRow[]; value: ReportQuery; onChange: (q: ReportQuery) => void;
  loading: boolean;
}) {
  const setRange = (start: string, end: string) => onChange({ ...value, start, end, unit: recommendUnit(start, end) });
  const buckets = value.start <= value.end ? bucketRanges(value.start, value.end, value.unit).length : 0;
  const tooMany = buckets > 120;
  const inverted = value.start > value.end;
  return (
    <div className="mt-4 rounded-xl border border-x-border bg-x-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={value.clientId} onChange={(e) => onChange({ ...value, clientId: e.target.value })}
                aria-label="클리닉 선택"
                className="h-8 rounded-md border border-x-border-strong bg-white px-2 text-[13px]">
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={value.start} aria-label="시작일"
               onChange={(e) => setRange(e.target.value, value.end)}
               className="h-8 rounded-md border border-x-border-strong bg-white px-2 text-[13px]" />
        <span className="text-x-muted">~</span>
        <input type="date" value={value.end} aria-label="끝일"
               onChange={(e) => setRange(value.start, e.target.value)}
               className="h-8 rounded-md border border-x-border-strong bg-white px-2 text-[13px]" />
        <div role="group" aria-label="단위" className="flex overflow-hidden rounded-md border border-x-border-strong">
          {(['day', 'week', 'month'] as const).map((u) => (
            <button key={u} onClick={() => onChange({ ...value, unit: u })}
                    className={`px-3 py-1.5 text-[13px] ${value.unit === u ? 'bg-x-blue/10 font-bold text-x-blue-text' : 'bg-white text-x-secondary'}`}>
              {UNIT_LABEL[u]}
            </button>
          ))}
        </div>
        {loading && <span className="text-caption text-x-muted">불러오는 중…</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-caption text-x-muted">자주 쓰는 기간:</span>
        {CHIPS.map((c) => (
          <button key={c.label} onClick={() => { const r = c.range(); setRange(r.start, r.end); }}
                  className="rounded-full border border-x-border px-2.5 py-1 text-caption text-x-secondary hover:bg-x-hover">
            {c.label}
          </button>
        ))}
      </div>
      {inverted && <p className="mt-2 text-caption text-red-600">시작이 끝보다 늦어요</p>}
      {tooMany && <p className="mt-2 text-caption text-red-600">
        {UNIT_LABEL[value.unit]} 단위로는 {buckets}칸이라 차트가 읽기 어려워요 — 기간을 줄이거나 단위를 키워 주세요 (최대 120칸)</p>}
    </div>
  );
}
