// 새로 뜨는 검색 — 우리 시술 목록에 없는데 1년 새 늘어난 검색 후보(trendDiscover, 매달 새 달을 받은 뒤 자동). 사람이 고른다.
// 오른쪽 패널(koo 10-15 시안 A): 새 시술 → [시술로 추가](양식) / 다른 표기 → [○○에 더하기] / 새 고민 → [고민으로 추가] / [무시]는 다시 안 보임.
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { fmtVolume } from '@/lib/searchTrend';
import { ProcedureForm } from './TrendManage';

export type Candidate = {
  id: string; kind: 'new' | 'variant' | 'concern' | 'self' | 'clinic' | 'other'; term: string; ko: string | null; texts: string[];
  volume: number; increase: number; foundMonth: string; of: { id: string; name: string } | null;
};

const EXCLUDED_LABEL: Record<string, string> = { self: '화장품·셀프', clinic: '병원 이름', other: '일반어' };
const show = (t: string) => t.replace(/(?<=[^\x00-\x7f]) (?=[^\x00-\x7f])/g, '');

export function TrendCandidates({ items, onClose, onChanged, onOpen }: {
  items: Candidate[]; onClose: () => void; onChanged: () => Promise<void>; onOpen: (procedureId: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Candidate | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const month = items[0]?.foundMonth;
  const groups = [
    { kind: 'new', title: '새 시술', hint: '목록에 없는 시술·장비·주사 이름' },
    { kind: 'variant', title: '기존 시술의 다른 표기', hint: '오타·새 통칭 — 더하면 그 시술 줄에 검색량이 합쳐져요' },
    { kind: 'concern', title: '새 고민', hint: '피부 고민·증상 — 더하면 \'피부 고민\' 분류에 들어가요' },
  ] as const;
  const excluded = items.filter((c) => c.kind in EXCLUDED_LABEL);

  async function act(c: Candidate, action: 'ignore' | 'adopt' | 'added') {
    setBusy(c.id); setError(null);
    try {
      const r = await fetch(`/api/trends/candidates/${c.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? '처리하지 못했어요');
      await onChanged();
      if (j.id) onOpen(j.id);
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  }

  const row = (c: Candidate) => (
    <li key={c.id} className="px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{c.kind === 'variant' ? show(c.term) : c.ko ?? show(c.term)}</span>
        {c.kind === 'variant' && c.of ? <span className="text-ui text-x-secondary">→ {c.of.name}</span> : c.ko && <span className="text-ui text-x-muted">{show(c.term)}</span>}
        {c.kind in EXCLUDED_LABEL && <span className="text-ui text-x-muted">· {EXCLUDED_LABEL[c.kind]}</span>}
        <span className="ml-auto shrink-0 text-ui tabular-nums text-x-secondary">월 {fmtVolume(c.volume)} <span className="text-green-700">+{fmtVolume(c.increase)}</span></span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-ui text-x-muted" title={c.texts.map(show).join(' · ')}>예) {c.texts.slice(0, 2).map(show).join(' · ')}</span>
        <Button variant="ghost" disabled={!!busy} onClick={() => act(c, 'ignore')}>무시</Button>
        {c.kind === 'new' || c.kind in EXCLUDED_LABEL
          ? <Button variant="primary" disabled={!!busy} onClick={() => setAdding(c)}>시술로 추가</Button>
          : <Button variant="primary" disabled={!!busy || (c.kind === 'variant' && !c.of)} onClick={() => act(c, 'adopt')}>
              {busy === c.id ? '받아 오는 중…' : c.kind === 'variant' ? `${c.of?.name ?? '시술'}에 더하기` : '고민으로 추가'}
            </Button>}
      </div>
    </li>
  );

  return (
    <aside className="flex w-[clamp(560px,44vw,780px)] shrink-0 flex-col overflow-y-auto border-l border-x-border bg-white">
      <div className="sticky top-0 z-10 border-b border-x-border bg-white px-6 py-4">
        <div className="flex items-center">
          <p className="text-[18px] font-bold">새로 뜨는 검색{month && <span className="ml-2 text-ui font-normal text-x-muted">{Number(month.slice(5, 7))}월 기준</span>}</p>
          <button onClick={onClose} aria-label="닫기" className="ml-auto rounded-full px-2 py-1 text-x-secondary hover:bg-x-hover">✕</button>
        </div>
        <p className="mt-0.5 text-ui text-x-muted">우리 목록에 없는데 1년 새 늘어난 검색(월 300건 이상, 1년 전보다 +300건·+30% 이상) · 매달 새 달을 받은 뒤 자동으로 찾아요</p>
      </div>
      <div className="space-y-6 px-6 py-5">
        {error && <p className="text-ui text-red-600">{error}</p>}
        {adding ? (
          <div>
            <p className="mb-3 text-[15px] font-semibold">시술로 추가 — {adding.ko ?? show(adding.term)}</p>
            <ProcedureForm mode="add" onCancel={() => setAdding(null)}
              initial={{ name: adding.ko ?? '', category: '', sub: '', hidden: false, members: [{ id: null, kr: adding.ko ?? '', jp: show(adding.term), en: '' }] }}
              onSaved={async (id) => { await act(adding, 'added'); setAdding(null); onOpen(id); }} />
          </div>
        ) : (<>
          {items.length === 0 && <p className="py-8 text-center text-[15px] text-x-secondary">지금은 새 후보가 없어요 — 다음 달 갱신 때 다시 찾아요</p>}
          {groups.map((g) => {
            const list = items.filter((c) => c.kind === g.kind);
            if (!list.length) return null;
            return (
              <section key={g.kind}>
                <p className="mb-1.5 text-ui font-semibold text-x-secondary">{g.title} {list.length} <span className="font-normal text-x-muted">· {g.hint}</span></p>
                <ul className="divide-y divide-x-border/60 rounded-lg border border-x-border text-[15px]">{list.map(row)}</ul>
              </section>
            );
          })}
          {excluded.length > 0 && (
            <section>
              <button onClick={() => setShowExcluded(!showExcluded)} className="text-ui text-x-secondary hover:text-x-text">
                {showExcluded ? '▾' : '▸'} 제외한 것 {excluded.length} <span className="text-x-muted">(화장품·병원 이름·일반어 — 잘못 걸렀으면 시술로 추가)</span>
              </button>
              {showExcluded && (
                <ul className="mt-1.5 divide-y divide-x-border/60 rounded-lg border border-x-border text-[15px]">
                  {excluded.map(row)}
                </ul>
              )}
            </section>
          )}
        </>)}
      </div>
    </aside>
  );
}
