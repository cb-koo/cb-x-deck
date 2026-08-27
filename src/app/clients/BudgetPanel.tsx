'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { InfoTip } from '@/components/InfoTip';
import { formatAmount, parseAmount } from '@/lib/campaignCost';
import {
  budgetJudgment, monthLabel, budgetTipText, BUDGET_AMOUNT_MESSAGE, JPY_TO_KRW, type MonthRow,
} from '@/lib/clientBudget';
import type { ClientRow } from '@/lib/clientStore';
import type { Register } from './ClientDetail';

// 월 마케팅 예산 패널(스펙 2026-08-27 §6-1) — 위: 기본 월 예산(클라이언트 저장 흐름과 같은 dirty/저장됨 패턴),
// 아래: 월별 예산·집행·잔액 표. 표는 자기 데이터(/budget)를 따로 부른다 — 집행은 캠페인에서 계산되는 값이라
// 클라이언트 목록 응답에 실리지 않는다. 예산 셀 클릭 → 그 행 인라인 편집(즉시 저장).

async function errOf(r: Response): Promise<string> {
  return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`;
}

export function BudgetPanel({ client, register, onChanged }: {
  client: ClientRow; register: Register; onChanged: () => Promise<void>;
}) {
  const [rows, setRows] = useState<MonthRow[] | null>(null);
  const [rowsErr, setRowsErr] = useState(false);
  const loadRows = useCallback(async () => {
    setRowsErr(false);
    try {
      const r = await apiFetch(`/api/clients/${client.id}/budget`);
      if (!r.ok) throw new Error(String(r.status));
      setRows(((await r.json()) as { rows: MonthRow[] }).rows);
    } catch {
      setRowsErr(true); // 실패를 빈 표로 위장하지 않는다
    }
  }, [client.id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 표 데이터 최초 로드(기존 코드베이스 관례)
  useEffect(() => { void loadRows(); }, [loadRows]);

  return (
    <div className="mt-4 rounded-2xl border border-x-border-strong">
      <div className="px-4 py-3">
        <h3 className="text-content font-bold">월 마케팅 예산</h3>
        <p className="text-caption text-x-muted">매달 이 금액을 기준으로 캠페인 비용을 대조해요. 특정 달만 다르면 아래 표에서 그 달을 고쳐요.</p>
      </div>
      <div className="border-t border-x-border px-4 py-4">
        <DefaultBudgetEditor key={client.id} client={client} register={register}
                             onSaved={async () => { await onChanged(); await loadRows(); }} />
      </div>
      <div className="border-t border-x-border px-4 py-4">
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-ui font-bold">월별 예산과 집행</span>
          <InfoTip text={budgetTipText()} label="집계 방식 설명 보기" />
        </div>
        {rowsErr ? (
          <div className="flex items-center gap-2 text-ui text-red-500">
            <span>예산 정보를 불러오지 못했어요</span>
            <Button onClick={() => void loadRows()}>다시 시도</Button>
          </div>
        ) : rows === null ? (
          <p className="text-ui text-x-muted">불러오는 중…</p>
        ) : (
          <BudgetTable clientId={client.id} rows={rows} onChanged={async () => { await onChanged(); await loadRows(); }} />
        )}
      </div>
    </div>
  );
}

// 기본 월 예산 — BasicInfoEditor와 같은 dirty/저장됨 패턴(baseline 대비, register로 일괄 저장에 포함)
function DefaultBudgetEditor({ client, register, onSaved }: {
  client: ClientRow; register: Register; onSaved: () => Promise<void>;
}) {
  const initial = client.monthlyBudget === null ? '' : String(client.monthlyBudget);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const baseline = useRef(initial);
  const cur = useRef(value);
  useEffect(() => { cur.current = value; }, [value]);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const save = useCallback(async (): Promise<boolean> => {
    const raw = cur.current.trim();
    const n = raw === '' ? null : parseAmount(raw);
    if (raw !== '' && n === null) { setErr(BUDGET_AMOUNT_MESSAGE); return false; }
    setSaving(true);
    try {
      const r = await apiFetch(`/api/clients/${client.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monthlyBudget: n }),
      });
      if (!r.ok) { setErr(await errOf(r)); return false; }
      baseline.current = n === null ? '' : String(n);
      setValue(baseline.current);
      setErr(''); setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2500);
      await onSaved();
      return true;
    } finally { setSaving(false); }
  }, [client.id, onSaved]);

  useEffect(() => register('budget', {
    isDirty: () => (parseAmount(cur.current) ?? cur.current.trim()) !== (parseAmount(baseline.current) ?? baseline.current),
    save,
  }), [register, save]);

  return (
    <label className="block">
      <span className="text-ui font-bold">기본 월 예산 <span className="font-normal text-x-muted">선택</span></span>
      <div className="mt-1 flex items-center gap-2.5">
        <input value={value} inputMode="numeric" autoComplete="off"
               onChange={(e) => { setValue(e.target.value); setSaved(false); }}
               placeholder="예: 3,000,000"
               className="w-48 rounded-md border border-x-border-strong p-2 text-right text-ui tabular-nums outline-none focus:border-x-blue" />
        <span className="text-ui">원</span>
        <Button variant="primary" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</Button>
        {saved && <span className="text-ui font-medium text-x-green">저장됨 ✓</span>}
      </div>
      {err && <p className="mt-1 text-ui text-red-500">{err}</p>}
    </label>
  );
}

function BudgetTable({ clientId, rows, onChanged }: { clientId: string; rows: MonthRow[]; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);   // 편집 중인 month
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-content">
        <thead>
          <tr className="text-left text-x-secondary">
            <th className="py-2 pr-4 font-bold">월</th>
            <th className="py-2 pr-4 font-bold">예산</th>
            <th className="py-2 pr-4 font-bold">집행</th>
            <th className="py-2 font-bold">잔액</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <BudgetRow key={r.month} clientId={clientId} row={r} editing={editing === r.month}
                       onEdit={() => setEditing(r.month)} onClose={() => setEditing(null)} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BudgetRow({ clientId, row, editing, onEdit, onClose, onChanged }: {
  clientId: string; row: MonthRow; editing: boolean; onEdit: () => void; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [value, setValue] = useState(row.budget === null ? '' : String(row.budget));
  const [err, setErr] = useState('');
  const busy = useRef(false);
  // 편집 진입(전이) 때만 리셋 — editing이 true인 동안 row.budget이 바뀌어도(백그라운드 loadRows 등)
  // 입력값을 덮어쓰지 않는다. row.budget은 의도적으로 deps에 남겨(린트) 있지만 wasEditing 가드가 실제 리셋을 막는다.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing && !wasEditing.current) { setValue(row.budget === null ? '' : String(row.budget)); setErr(''); }
    wasEditing.current = editing;
  }, [editing, row.budget]);

  async function put(amount: number | null) {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await apiFetch(`/api/clients/${clientId}/budget/${row.month}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount }),
      });
      if (!r.ok) { setErr(await errOf(r)); return; }
      onClose(); await onChanged();
    } finally { busy.current = false; }
  }
  function save() {
    const raw = value.trim();
    if (raw === '') { setErr(BUDGET_AMOUNT_MESSAGE); return; }   // 예외를 지우려면 '기본값으로 되돌리기'
    const n = parseAmount(raw);
    if (n === null) { setErr(BUDGET_AMOUNT_MESSAGE); return; }
    void put(n);
  }

  const over = row.remaining !== null && row.remaining < 0;
  return (
    <tr className="border-t border-x-border align-top">
      <td className="whitespace-nowrap py-3.5 pr-4">{monthLabel(row.month)}</td>
      <td className="py-3.5 pr-4">
        {editing ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <input value={value} inputMode="numeric" autoFocus autoComplete="off"
                     onChange={(e) => setValue(e.target.value)}
                     onKeyDown={(e) => {
                       if (e.key === 'Enter' && !e.nativeEvent.isComposing) save();
                       if (e.key === 'Escape') onClose();
                     }}
                     aria-label={`${monthLabel(row.month)} 예산`}
                     className="w-36 rounded-md border border-x-border-strong p-1.5 text-right text-ui tabular-nums outline-none focus:border-x-blue" />
              <span>원</span>
              <Button variant="primary" onClick={save}>저장</Button>
              <Button variant="ghost" onClick={onClose}>취소</Button>
            </div>
            {row.source === 'override' && (
              <button onClick={() => void put(null)} className="text-caption text-x-secondary hover:text-x-text">기본값으로 되돌리기</button>
            )}
            {err && <p className="text-caption text-red-500">{err}</p>}
          </div>
        ) : (
          <button onClick={onEdit} className="text-left tabular-nums hover:text-x-blue-text">
            {row.budget === null ? '—' : formatAmount(row.budget, 'KRW')}
            <span className="ml-1.5 text-caption text-x-muted">{row.source === 'override' ? '(수정)' : row.source === 'default' ? '기본' : '미설정'}</span>
            <span className="ml-1.5 text-ui text-x-muted">고치기</span>
          </button>
        )}
      </td>
      <td className="py-3.5 pr-4 tabular-nums">
        {formatAmount(row.spentKrw, 'KRW')}
        <span className="ml-1.5 text-x-muted">· {row.campaignCount === 0 ? '캠페인 없음' : `캠페인 ${row.campaignCount}개`}</span>
        {row.jpyIncluded > 0 && (
          <p className="text-ui text-x-muted">엔화 {formatAmount(row.jpyIncluded, 'JPY')} 포함({formatAmount(row.jpyIncluded * JPY_TO_KRW, 'KRW')}으로 환산)</p>
        )}
      </td>
      <td className={`py-3.5 tabular-nums ${over ? 'font-bold text-red-700' : row.remaining === null ? 'text-x-muted' : ''}`}>
        {budgetJudgment(row.budget, row.remaining)}
      </td>
    </tr>
  );
}
