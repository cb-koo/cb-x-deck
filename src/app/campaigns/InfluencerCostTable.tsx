'use client';
import { useEffect, useState } from 'react';
import type { InfluencerLine } from '@/lib/campaignJudgment';
import {
  formatMoneyBy, CURRENCIES, CURRENCY_LABEL, AMOUNT_MESSAGE, EXTRA_LABEL_MESSAGE, parseAmount,
  type ExtraCost, type Currency, type MoneyByCurrency,
} from '@/lib/campaignCost';
import { upsertExtraCost, removeExtraCost, extraCostLabel } from '@/lib/campaignCostEdit';
import { Button } from '@/components/ui';

// 인플루언서별 비용 표(스펙 §3-2 하단, 표·달력 두 보기 공통) — 열 5: 인플루언서(+메모) · 콘텐츠 n · 콘텐츠 비용 · 추가 비용 · 소계.
// 줄은 deriveInfluencers 결과 그대로(원고 핸들 ∪ 비용 행 핸들, 미배정 묶음 맨 아래) — 여기서 다시 세지 않는다.
// 저장은 부모가 PUT하고 boolean으로 알려준다 — 실패하면 입력을 남긴다(닫으면 안 저장된 게 저장된 것처럼 보인다).
type Editing = { handle: string; index: number | null } | null;
const TD = 'px-3 py-3 align-top';
// 한 줄뿐인 행(미배정·합계)은 py-3만으로 48px에 못 미친다 — py-3.5로 올려 보장한다
const TD_SINGLE = 'px-3 py-3.5 align-top';

export function InfluencerCostTable({ lines, total, onSaveExtraCosts, onSaveNote }: {
  lines: InfluencerLine[]; total: MoneyByCurrency;
  onSaveExtraCosts: (handle: string, next: ExtraCost[]) => Promise<boolean>;
  onSaveNote: (handle: string, note: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteErr, setNoteErr] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const editingLine = editing
    ? lines.find((l) => l.handle !== null && l.handle.toLowerCase() === editing.handle.toLowerCase()) ?? null
    : null;

  async function saveNote(handle: string, current: string) {
    if (savingNote) return;   // Enter가 이미 저장을 보냈으면 뒤따르는 blur가 다시 보내지 않는다
    const next = noteDraft.trim();
    if (next === current) { setNoteFor(null); return; }   // 바뀐 게 없으면 PUT하지 않는다
    setSavingNote(true);
    const ok = await onSaveNote(handle, next);
    setSavingNote(false);
    // 실패하면 입력을 열어 둔다 — 닫으면 안 저장된 메모가 저장된 것처럼 보인다
    if (ok) { setNoteFor(null); setNoteErr(''); } else { setNoteErr('메모를 저장하지 못했어요 — 잠시 후 다시 시도해 주세요'); }
  }

  return (
    <section className="mt-8">
      <h2 className="text-content font-bold">인플루언서별 비용</h2>
      {lines.length === 0 ? (
        <p className="mt-3 rounded-xl border border-x-border bg-x-surface px-4 py-6 text-center text-content text-x-secondary">
          원고에 인플루언서를 배정하면 사람별 비용이 여기 모여요.
        </p>
      ) : (
        <div className="mt-3 w-full overflow-x-auto">
          <table className="w-full text-content">
            <thead>
              <tr className="border-b border-x-border text-left text-ui text-x-muted">
                <th className="px-3 py-2 font-normal">인플루언서</th>
                <th className="w-[130px] px-3 py-2 font-normal">콘텐츠</th>
                <th className="w-[170px] px-3 py-2 font-normal">콘텐츠 비용</th>
                <th className="px-3 py-2 font-normal">추가 비용</th>
                <th className="w-[170px] px-3 py-2 font-normal">소계</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const td = l.handle === null ? TD_SINGLE : TD;   // 미배정 행은 한 줄뿐이라 48px 보장이 필요
                return (
                <tr key={l.handle ?? '__unassigned'} className="border-b border-x-border">
                  <td className={td}>
                    {l.handle === null ? (
                      <p className="text-x-secondary" title="인플루언서가 아직 배정되지 않은 원고들의 비용 — 배정하면 그 사람 줄로 옮겨가요">미배정 원고</p>
                    ) : (
                      <>
                        <p className="font-medium">@{l.handle}</p>
                        {noteFor === l.handle ? (
                          <>
                            <input autoFocus value={noteDraft}
                                   onChange={(e) => { setNoteDraft(e.target.value); setNoteErr(''); }}
                                   onBlur={() => void saveNote(l.handle as string, l.note)}
                                   onKeyDown={(e) => {
                                     if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveNote(l.handle as string, l.note);
                                     if (e.key === 'Escape') { setNoteFor(null); setNoteErr(''); }
                                   }}
                                   aria-label={`@${l.handle} 메모`} placeholder="이 캠페인에서 이 사람에 대한 한 줄"
                                   className="mt-1 h-10 w-full rounded-md border border-x-border-strong px-3 text-content outline-none focus:border-x-blue" />
                            {noteErr && <p role="alert" className="mt-1 text-ui text-red-600">{noteErr}</p>}
                          </>
                        ) : (
                          <button type="button" onClick={() => { setNoteFor(l.handle); setNoteDraft(l.note); setNoteErr(''); }}
                                  className={`mt-0.5 block text-left text-ui hover:underline ${l.note ? 'text-x-secondary' : 'text-x-muted'}`}>
                            {l.note || '+ 메모'}
                          </button>
                        )}
                      </>
                    )}
                  </td>
                  <td className={`${td} tabular-nums`}>
                    {l.contentCount > 0 ? `${l.contentCount}개` : (
                      // 돈이 붙었는데 원고가 안 보이는 일을 막는다(§2-4) — 색만 아니라 말로
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-ui text-amber-800"
                            title="추가 비용은 적혀 있는데 배정된 원고가 없어요 — 원고를 배정하거나 비용 항목을 정리하세요">배정 원고 없음</span>
                    )}
                  </td>
                  <td className={`${td} tabular-nums`}>{formatMoneyBy(l.contentCost)}</td>
                  <td className={td}>
                    {l.handle === null ? (
                      <span className="text-x-muted" title="인플루언서를 배정하면 추가 비용을 적을 수 있어요">—</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {l.extraCosts.map((e, i) => (
                          <button key={i} type="button" onClick={() => setEditing({ handle: l.handle as string, index: i })}
                                  className="rounded-full border border-x-border-strong bg-white px-2.5 py-1 text-ui tabular-nums hover:bg-x-hover"
                                  title="눌러서 고치거나 지우기">
                            {extraCostLabel(e)}
                          </button>
                        ))}
                        <button type="button" onClick={() => setEditing({ handle: l.handle as string, index: null })}
                                className="rounded-full border border-dashed border-x-border-strong px-2.5 py-1 text-ui text-x-secondary hover:bg-x-hover">
                          + 추가
                        </button>
                      </span>
                    )}
                  </td>
                  <td className={`${td} font-medium tabular-nums`}>{formatMoneyBy(l.subtotal)}</td>
                </tr>
              );})}
            </tbody>
            <tfoot>
              <tr>
                <td className="px-3 py-3.5 font-bold" colSpan={4}>
                  캠페인 합계
                </td>
                <td className="px-3 py-3.5 font-bold tabular-nums">{formatMoneyBy(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {editing && editingLine && editingLine.handle !== null && (
        <ExtraCostDialog
          handle={editingLine.handle}
          initial={editing.index !== null ? (editingLine.extraCosts[editing.index] ?? null) : null}
          onClose={() => setEditing(null)}
          onSave={async (item) => {
            const ok = await onSaveExtraCosts(editingLine.handle as string, upsertExtraCost(editingLine.extraCosts, editing.index, item));
            if (ok) setEditing(null);
            return ok;
          }}
          onDelete={editing.index !== null ? async () => {
            const ok = await onSaveExtraCosts(editingLine.handle as string, removeExtraCost(editingLine.extraCosts, editing.index as number));
            if (ok) setEditing(null);
            return ok;
          } : undefined} />
      )}
    </section>
  );
}

// 항목 하나(항목명·금액·통화) — 작은 다이얼로그. 팝오버 좌표 계산 없이 중앙에 띄운다: 표 하단 셀에서 열리면 화면 아래로 잘리기 쉽다.
function ExtraCostDialog({ handle, initial, onClose, onSave, onDelete }: {
  handle: string; initial: ExtraCost | null; onClose: () => void;
  onSave: (item: ExtraCost) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;   // 기존 항목을 열었을 때만
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? 'KRW');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function save() {
    const name = label.trim();
    if (!name) { setErr(EXTRA_LABEL_MESSAGE); return; }
    const n = parseAmount(amount);
    if (n === null) { setErr(AMOUNT_MESSAGE); return; }
    setBusy(true); setErr('');
    const ok = await onSave({ label: name, amount: n, currency });
    setBusy(false);
    if (!ok) setErr('저장하지 못했어요 — 잠시 후 다시 시도해 주세요');
  }
  // 삭제도 저장과 대칭 — busy를 세워 바깥 클릭/Esc를 막고, 실패하면 같은 스타일로 알린다
  async function del() {
    if (!onDelete) return;
    setBusy(true); setErr('');
    const ok = await onDelete();
    setBusy(false);
    if (!ok) setErr('지우지 못했어요 — 잠시 후 다시 시도해 주세요');
  }
  const input = 'mt-0.5 h-10 w-full rounded-md border border-x-border-strong bg-white px-3 text-content outline-none focus:border-x-blue';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div className="w-full max-w-[380px] rounded-2xl bg-white p-4" role="dialog" aria-modal="true" aria-label="추가 비용" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-content font-bold">{initial ? '추가 비용 고치기' : '추가 비용 추가'} <span className="text-ui font-normal text-x-muted">@{handle}</span></h2>
        <p className="mt-0.5 text-ui text-x-muted">교통비·패키지·선물처럼 콘텐츠 비용 밖의 항목이에요 — 이 사람의 소계와 캠페인 합계에 더해져요.</p>
        <label className="mt-3 block text-ui text-x-secondary">항목명
          <input autoFocus value={label} onChange={(e) => { setLabel(e.target.value); setErr(''); }} placeholder="교통비" className={input} />
        </label>
        <div className="mt-2 grid grid-cols-[1fr_130px] gap-2">
          <label className="block text-ui text-x-secondary">금액
            <input inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value); setErr(''); }}
                   onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(); }}
                   placeholder="20000" className={`${input} tabular-nums`} />
          </label>
          <label className="block text-ui text-x-secondary">통화
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className={input}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]} ({c})</option>)}
            </select>
          </label>
        </div>
        <p className="mt-1 text-ui text-x-muted">통화를 바꿔도 금액은 그대로예요 — 환산하지 않아요</p>
        {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
        <div className="mt-3 flex items-center gap-2">
          {onDelete && (
            <button type="button" disabled={busy} onClick={() => void del()} className="flex h-10 items-center text-content text-x-secondary hover:text-red-600 disabled:opacity-40">이 항목 지우기</button>
          )}
          <Button type="button" variant="subtle" onClick={onClose} disabled={busy} className="ml-auto flex h-10 items-center text-content text-x-secondary">취소</Button>
          <button type="button" disabled={busy} onClick={() => void save()} className="flex h-10 items-center rounded-full bg-x-blue px-3 text-content font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
