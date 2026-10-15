// 새로 뜨는 검색 — 우리 시술 목록에 없는데 1년 새 늘어난 검색 후보(trendDiscover, 매달 새 달을 받은 뒤 자동). 사람이 고른다.
// 오른쪽 패널(koo 10-15 시안 A): 새 시술 → [시술로 추가](양식) / 다른 표기 → [○○에 더하기] / 새 고민 → [고민으로 추가] / [무시]는 다시 안 보임.
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { fmtVolume } from '@/lib/searchTrend';
import { ProcedureForm } from './TrendManage';

export type Candidate = {
  id: string; kind: 'new' | 'variant' | 'concern' | 'self' | 'clinic' | 'other'; term: string; ko: string | null; texts: string[];
  volume: number; increase: number; foundMonth: string; of: { id: string; name: string; jp: string } | null;
  firstMonth: string | null; risingMonths: number | null; action: 'add' | 'replace' | null; korea: number | null;
  serp: { derm: number; med: number; self: number; unrelated: number; note: string } | null;
};

// 뜻 확인 경고 — 시술과 같은 기준(무관한 뜻 10/20·제품 10/20·다른 진료과 8/20)
const meaningWarn = (c: Candidate) => !c.serp ? null : c.serp.unrelated >= 10 ? '다른 뜻 많음' : c.serp.med >= 8 ? '다른 진료과 많음' : c.serp.self >= 10 ? '제품 검색 많음' : null;

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
    { kind: 'new', title: '새 시술', hint: '목록에 없는 시술·장비·주사' },
    { kind: 'variant', title: '기존 시술의 다른 표기', hint: '오타·새 통칭 — 더하면 그 시술에 합산' },
    { kind: 'concern', title: '새 고민', hint: "더하면 '피부 고민' 분류에" },
  ] as const;
  const excluded = items.filter((c) => c.kind in EXCLUDED_LABEL);

  async function act(c: Candidate, action: 'ignore' | 'adopt' | 'added' | 'replace') {
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

  const [open, setOpen] = useState<string | null>(null);  // 예시 검색어를 펼친 후보

  // 한 줄 = 후보 하나(koo 10-15 시안: 표 + 줄 끝 버튼 하나). 이름·숫자를 열로 맞추고, 예시 검색어는 줄을 누르면 펼친다.
  const row = (c: Candidate) => {
    const isOpen = open === c.id;
    const replace = c.kind === 'variant' && c.action === 'replace';
    const primary = replace ? '표기 바꾸기' : c.kind === 'variant' ? '더하기' : '추가';
    const primaryTitle = replace ? `${c.of?.name ?? '시술'}의 일본어(${c.of?.jp ?? ''})보다 3배 이상 많이 찾는 표기예요 — 이 표기로 바꾸고 다시 받아요(시트 원래 값은 남겨요)`
      : c.kind === 'variant' ? `${c.of?.name ?? '시술'}에 이 표기를 더해 검색량을 합쳐요(바로 수집, 약 6초)`
      : c.kind === 'concern' ? "'피부 고민'에 더하고 바로 수집해요(약 6초)" : '이름·분류를 정해 시술로 추가해요';
    const warn = meaningWarn(c);
    return [
      <tr key={c.id} onClick={() => setOpen(isOpen ? null : c.id)} className={`cursor-pointer border-t border-x-border/60 ${isOpen ? 'bg-x-surface' : 'hover:bg-x-hover'}`}>
        <td className="max-w-0 truncate px-3 py-2.5" title={c.texts.map(show).join(' · ')}>
          <span className="mr-1.5 inline-block w-3 text-ui text-x-muted">{isOpen ? '▾' : '▸'}</span>
          {c.kind === 'variant' ? (<>
            <span className="font-medium">{show(c.term)}</span>
            {c.of && <span className="ml-2 rounded-full bg-x-surface px-2 py-0.5 text-ui text-x-secondary" title={`우리 표기: ${c.of.jp}`}>{c.of.name}{replace && ` · 우리 ${c.of.jp}`}</span>}
          </>) : (<>
            <span className="font-medium">{c.ko ?? show(c.term)}</span>
            {c.ko && <span className="ml-2 text-ui text-x-muted">{show(c.term)}</span>}
            {c.kind in EXCLUDED_LABEL && <span className="ml-2 text-ui text-x-muted">· {EXCLUDED_LABEL[c.kind]}</span>}
          </>)}
          {warn && <span className="ml-2 text-ui text-amber-700" title={c.serp?.note}>⚠ {warn}</span>}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">{fmtVolume(c.volume)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums" title={c.risingMonths ? `${c.risingMonths}개월째 1년 전보다 늘어난 상태(3개월 평균)${c.firstMonth ? ` · 처음 찾은 달 ${c.firstMonth}` : ''}` : undefined}>
          <span className="text-green-700">+{fmtVolume(c.increase)}</span>
          {c.risingMonths ? <span className="block text-[12px] leading-tight text-x-muted">{c.risingMonths}개월째</span> : null}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-x-secondary" title="'韓国 + 후보' 검색 월평균">{c.korea ? fmtVolume(c.korea) : <span className="text-x-muted">—</span>}</td>
        <td className="px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
          <span className="inline-flex items-center gap-1">
            {c.kind === 'new' || c.kind in EXCLUDED_LABEL
              ? <Button variant="primary" disabled={!!busy} onClick={() => setAdding(c)} title={primaryTitle}>{primary}</Button>
              : <Button variant="primary" disabled={!!busy || (c.kind === 'variant' && !c.of)} onClick={() => act(c, replace ? 'replace' : 'adopt')} title={primaryTitle}>
                  {busy === c.id ? '받는 중…' : primary}
                </Button>}
            <button onClick={() => act(c, 'ignore')} disabled={!!busy} aria-label="무시" title="무시 — 다시 안 보여요"
                    className="rounded-full px-2 py-1 text-x-muted hover:bg-x-hover hover:text-x-text disabled:opacity-50">✕</button>
          </span>
        </td>
      </tr>,
      isOpen && (
        <tr key={`${c.id}-ex`} className="bg-x-surface">
          <td colSpan={5} className="px-3 pb-3 pl-8 text-ui text-x-secondary">
            <span className="text-x-muted">실제 검색어 </span>{c.texts.map(show).join(' · ')}
          </td>
        </tr>
      ),
    ];
  };

  const table = (list: Candidate[]) => (
    <div className="overflow-hidden rounded-lg border border-x-border">
      <table className="w-full table-fixed border-collapse text-[15px]">
        <colgroup><col /><col className="w-[84px]" /><col className="w-[92px]" /><col className="w-[64px]" /><col className="w-[128px]" /></colgroup>
        <thead><tr className="text-left text-ui text-x-muted">
          <th className="px-3 py-2 font-medium">후보</th>
          <th className="px-3 py-2 text-right font-medium">월 검색</th>
          <th className="px-3 py-2 text-right font-medium">1년 증가</th>
          <th className="px-3 py-2 text-right font-medium" title="'韓国 + 후보' 검색 월평균 — 한국 클리닉 관련성">한국</th>
          <th className="px-3 py-2" />
        </tr></thead>
        <tbody>{list.flatMap(row)}</tbody>
      </table>
    </div>
  );

  return (
    <aside className="flex w-[clamp(560px,44vw,780px)] shrink-0 flex-col overflow-y-auto border-l border-x-border bg-white">
      <div className="sticky top-0 z-10 border-b border-x-border bg-white px-6 py-4">
        <div className="flex items-center">
          <p className="text-[18px] font-bold">새로 뜨는 검색{month && <span className="ml-2 text-ui font-normal text-x-muted">{Number(month.slice(5, 7))}월 기준</span>}</p>
          <button onClick={onClose} aria-label="닫기" className="ml-auto rounded-full px-2 py-1 text-x-secondary hover:bg-x-hover">✕</button>
        </div>
        <p className="mt-0.5 text-[15px] text-x-secondary" title="월 300건 이상, 1년 전보다 +300건·+30% 이상 늘어난 검색 · 매달 새 달을 받은 뒤 자동으로 찾아요">
          우리 목록에 없는데 1년 새 늘어난 검색 <b className="font-semibold text-x-text">{items.length - excluded.length}개</b>
          <span className="ml-2 text-ui text-x-muted">줄을 누르면 실제 검색어 · ✕는 다시 안 보임</span>
        </p>
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
                <p className="mb-2 text-[15px] font-semibold">{g.title} <span className="tabular-nums text-x-secondary">{list.length}</span>
                  <span className="ml-2 text-ui font-normal text-x-muted">{g.hint}</span></p>
                {table(list)}
              </section>
            );
          })}
          {excluded.length > 0 && (
            <section>
              <button onClick={() => setShowExcluded(!showExcluded)} className="text-ui text-x-secondary hover:text-x-text">
                {showExcluded ? '▾' : '▸'} 제외한 것 {excluded.length} <span className="text-x-muted">(화장품·병원 이름·일반어 — 잘못 걸렀으면 시술로 추가)</span>
              </button>
              {showExcluded && <div className="mt-2">{table(excluded)}</div>}
            </section>
          )}
        </>)}
      </div>
    </aside>
  );
}
