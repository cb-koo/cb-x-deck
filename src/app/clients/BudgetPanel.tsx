'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button, PANEL_SPLIT, PANEL_TITLE } from '@/components/ui';
import { InfoTip } from '@/components/InfoTip';
import { formatAmount, parseAmount } from '@/lib/campaignCost';
import {
  budgetJudgment, budgetTipText, badgeText, periodLabel, remainingOf, JPY_TO_KRW, type PeriodRow,
} from '@/lib/clientBudget';
import type { ClientRow } from '@/lib/clientStore';

// 예산 기간 패널(스펙 2026-09-22 §6-1) — 기간 목록 표 + 인라인 추가/편집. 037의 '기본값+월별 표'를 대체한다.
// 모든 변경(추가·수정·삭제)은 즉시 저장 — 시술 카드와 같은 패턴(register 일괄 저장 대상 아님).

async function errOf(r: Response): Promise<string> {
  return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`;
}

type SpendBasis = 'unit' | 'withFee';
const BASIS_LABEL: Record<SpendBasis, string> = { unit: '단가', withFee: '수수료 포함' };
const DATE_INPUT = 'rounded-md border border-x-border-strong p-1.5 text-ui outline-none focus:border-x-blue';
const AMOUNT_INPUT = 'w-32 rounded-md border border-x-border-strong p-1.5 text-right text-ui tabular-nums outline-none focus:border-x-blue';

export function BudgetPanel({ client, onChanged }: { client: ClientRow; onChanged: () => Promise<void> }) {
  const [rows, setRows] = useState<PeriodRow[] | null>(null);
  const [rowsErr, setRowsErr] = useState(false);
  const [basis, setBasis] = useState<SpendBasis>('unit');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setRowsErr(false);
    try {
      const r = await apiFetch(`/api/clients/${client.id}/budget-periods`);
      if (!r.ok) throw new Error(String(r.status));
      setRows(((await r.json()) as { rows: PeriodRow[] }).rows);
    } catch {
      setRowsErr(true);
    }
  }, [client.id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 표 데이터 최초 로드(기존 코드베이스 관례)
  useEffect(() => { void loadRows(); }, [loadRows]);

  async function refresh() { await onChanged(); await loadRows(); }

  return (
    <div className={PANEL_SPLIT}>
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className={PANEL_TITLE}>예산 기간</h2>
          <p className="text-caption text-x-muted">시작한 캠페인은 시작일이 속한 기간의 예산과 대조해요.</p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)} disabled={adding}>+ 새 기간 추가</Button>
      </div>
      <div className="border-t border-x-border px-5 py-5">
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-ui font-bold">기간별 예산과 지출</span>
          <InfoTip text={budgetTipText()} label="집계 방식 설명 보기" />
        </div>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-ui text-x-secondary">지출 기준</span>
          <div role="group" aria-label="지출 기준" className="inline-flex rounded-full border border-x-border-strong p-0.5">
            {(['unit', 'withFee'] as const).map((b) => (
              <button key={b} type="button" onClick={() => setBasis(b)} aria-pressed={basis === b}
                      className={`h-7 rounded-full px-3 text-ui ${
                        basis === b ? 'bg-x-text font-bold text-white' : 'text-x-secondary hover:bg-x-hover'}`}>
                {BASIS_LABEL[b]}
              </button>
            ))}
          </div>
        </div>
        {rowsErr ? (
          <div className="flex items-center gap-2 text-ui text-red-500">
            <span>예산 정보를 불러오지 못했어요</span>
            <Button onClick={() => void loadRows()}>다시 시도</Button>
          </div>
        ) : rows === null ? (
          <p className="text-ui text-x-muted">불러오는 중…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-content">
              <thead>
                <tr className="text-left text-x-secondary">
                  <th className="py-2 pr-4 font-bold">기간</th>
                  <th className="py-2 pr-4 font-bold">예산</th>
                  <th className="py-2 pr-4 font-bold">지출</th>
                  <th className="py-2 font-bold">잔액</th>
                </tr>
              </thead>
              <tbody>
                {adding && (
                  <AddPeriodRow clientId={client.id}
                                onDone={async (ok) => { setAdding(false); if (ok) await refresh(); }} />
                )}
                {rows.map((r) => (
                  <PeriodRowView key={r.period.id} clientId={client.id} row={r} basis={basis}
                                 editing={editingId === r.period.id}
                                 onEdit={() => setEditingId(r.period.id)} onClose={() => setEditingId(null)}
                                 onChanged={refresh} />
                ))}
                {rows.length === 0 && !adding && (
                  <tr><td colSpan={4} className="py-6 text-center text-ui text-x-muted">아직 설정한 예산 기간이 없어요</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AddPeriodRow({ clientId, onDone }: { clientId: string; onDone: (ok: boolean) => Promise<void> }) {
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const busy = useRef(false);

  async function save() {
    if (busy.current) return;
    if (!startsOn || !endsOn) { setErr('시작일·종료일을 입력해 주세요'); return; }
    const n = parseAmount(amount);
    if (n === null) { setErr('예산은 0 이상 숫자로 입력해 주세요'); return; }
    busy.current = true;
    try {
      const r = await apiFetch(`/api/clients/${clientId}/budget-periods`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startsOn, endsOn, amountKrw: n }),
      });
      if (!r.ok) { setErr(await errOf(r)); return; }
      await onDone(true);
    } finally { busy.current = false; }
  }

  return (
    <tr className="border-t border-x-border align-top bg-x-surface">
      <td className="py-3.5 pr-4">
        <div className="flex items-center gap-1.5">
          <input type="date" autoFocus value={startsOn} onChange={(e) => setStartsOn(e.target.value)} aria-label="시작일" className={DATE_INPUT} />
          <span className="text-x-secondary">~</span>
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} aria-label="종료일" className={DATE_INPUT} />
        </div>
      </td>
      <td className="py-3.5 pr-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input value={amount} inputMode="numeric" autoComplete="off" placeholder="예: 5,000,000" aria-label="예산"
                   onChange={(e) => setAmount(e.target.value)} className={AMOUNT_INPUT} />
            <span>원</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={save}>저장</Button>
            <Button variant="ghost" onClick={() => void onDone(false)}>취소</Button>
          </div>
          {err && <p className="text-caption text-red-500">{err}</p>}
        </div>
      </td>
      <td className="py-3.5 pr-4 text-x-muted">—</td>
      <td className="py-3.5 text-x-muted">—</td>
    </tr>
  );
}

function PeriodRowView({ clientId, row, basis, editing, onEdit, onClose, onChanged }: {
  clientId: string; row: PeriodRow; basis: SpendBasis; editing: boolean;
  onEdit: () => void; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const { period } = row;
  const [startsOn, setStartsOn] = useState(period.startsOn);
  const [endsOn, setEndsOn] = useState(period.endsOn);
  const [amount, setAmount] = useState(String(period.amountKrw));
  const [err, setErr] = useState('');
  const busy = useRef(false);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing && !wasEditing.current) {
      setStartsOn(period.startsOn); setEndsOn(period.endsOn); setAmount(String(period.amountKrw)); setErr('');
    }
    wasEditing.current = editing;
  }, [editing, period.startsOn, period.endsOn, period.amountKrw]);

  async function save() {
    if (busy.current) return;
    const n = parseAmount(amount);
    if (n === null) { setErr('예산은 0 이상 숫자로 입력해 주세요'); return; }
    busy.current = true;
    try {
      const r = await apiFetch(`/api/clients/${clientId}/budget-periods/${period.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startsOn, endsOn, amountKrw: n }),
      });
      if (!r.ok) { setErr(await errOf(r)); return; }
      onClose(); await onChanged();
    } finally { busy.current = false; }
  }
  async function remove() {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await apiFetch(`/api/clients/${clientId}/budget-periods/${period.id}`, { method: 'DELETE' });
      if (!r.ok) { setErr(await errOf(r)); return; }
      onClose(); await onChanged();
    } finally { busy.current = false; }
  }

  const spentKrw = basis === 'unit' ? row.spentKrw : row.spentWithFeeKrw;
  const remaining = basis === 'unit' ? row.remaining : remainingOf(period.amountKrw, row.spentWithFeeKrw);
  const over = remaining < 0;

  return (
    <tr className="border-t border-x-border align-top">
      <td className="py-3.5 pr-4">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input type="date" autoFocus value={startsOn} onChange={(e) => setStartsOn(e.target.value)} aria-label="시작일" className={DATE_INPUT} />
            <span className="text-x-secondary">~</span>
            <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} aria-label="종료일" className={DATE_INPUT} />
          </div>
        ) : (
          <button onClick={onEdit} className="text-left hover:text-x-blue-text">{periodLabel(period)} <span className="text-ui text-x-muted">고치기</span></button>
        )}
      </td>
      <td className="py-3.5 pr-4">
        {editing ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <input value={amount} inputMode="numeric" autoComplete="off" aria-label="예산"
                     onChange={(e) => setAmount(e.target.value)} className={AMOUNT_INPUT} />
              <span>원</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={save}>저장</Button>
              <Button variant="ghost" onClick={onClose}>취소</Button>
              <button onClick={remove} className="text-caption text-x-secondary hover:text-red-500">삭제</button>
            </div>
            {err && <p className="text-caption text-red-500">{err}</p>}
          </div>
        ) : (
          <span className="tabular-nums">{formatAmount(period.amountKrw, 'KRW')}</span>
        )}
      </td>
      <td className="py-3.5 pr-4 tabular-nums">
        {formatAmount(spentKrw, 'KRW')}
        <span className="ml-1.5 text-x-muted">· {row.campaignCount === 0 ? '캠페인 없음' : `캠페인 ${row.campaignCount}개`}</span>
        {row.jpyIncluded > 0 && (
          <p className="text-ui text-x-muted">엔화 {formatAmount(row.jpyIncluded, 'JPY')} 포함({formatAmount(row.jpyIncluded * JPY_TO_KRW, 'KRW')}으로 환산)</p>
        )}
        {basis === 'withFee' && (row.feeKrw > 0 || row.feeUnknown > 0) && (
          <p className="text-ui text-x-muted">
            송금 수수료 {formatAmount(row.feeKrw, 'KRW')} 포함
            {row.feeUnknown > 0 && ` · 수수료 미확인 ${row.feeUnknown}건은 단가만 넣었어요`}
          </p>
        )}
      </td>
      <td className={`py-3.5 tabular-nums ${over ? 'font-bold text-red-700' : ''}`}>
        {budgetJudgment(remaining)}
        {row.badge && <p className="text-ui font-normal text-x-secondary">{badgeText(row.badge)}</p>}
      </td>
    </tr>
  );
}
