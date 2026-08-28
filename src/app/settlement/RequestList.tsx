'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/lib/toastContext';
import { fetchRequests, cancelRequestApi } from '@/lib/settlementApi';
import type { PaymentRequestRow, RequestStatus } from '@/lib/settlementStore';
import { RequestRow } from './RequestRow';
import { CancelDialog } from './CancelDialog';
import { uniqPairs } from './uniqPairs';

const SEL = 'rounded-lg border border-x-border bg-white px-2.5 py-1.5 text-ui';

export function RequestList({ focusTaskId }: { focusTaskId: string | null }) {
  const { show } = useToast();
  const [rows, setRows] = useState<PaymentRequestRow[] | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<{ clientId: string; campaignId: string; status: '' | RequestStatus; from: string; to: string }>({ clientId: '', campaignId: '', status: '', from: '', to: '' });
  const [open, setOpen] = useState<string | null>(null);        // 펼친 요청 id
  const [cancelling, setCancelling] = useState<PaymentRequestRow | null>(null);
  const didFocus = useRef(false);                                // 딥링크 자동 펼침을 첫 로드 1회로 제한

  const load = useCallback(async () => {
    const r = await fetchRequests({
      clientId: filter.clientId || undefined, campaignId: filter.campaignId || undefined,
      status: filter.status || undefined, from: filter.from || undefined, to: filter.to || undefined,
    });
    if (!r.ok) { setErr(r.error); return; }
    setErr(''); setRows(r.data);
    // 배지에서 들어왔으면 그 작업의 활성 요청(없으면 최신)을 펼친다 — 최초 1회만(이후 토글은 사용자 의도 유지)
    if (focusTaskId && !didFocus.current) {
      didFocus.current = true;
      const hit = r.data.find((x) => x.taskId === focusTaskId && x.status === 'requested') ?? r.data.find((x) => x.taskId === focusTaskId);
      if (hit) setOpen(hit.id);
    }
  }, [filter, focusTaskId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트·필터 변경 시 재조회, open을 의존성에서 뺀 덕에 토글마다 재실행되지 않음(CandidateTable 관례)
  useEffect(() => { void load(); }, [load]);

  const clients = useMemo(() => uniqPairs((rows ?? []).map((r) => [r.clientId ?? '', r.clientName] as const)), [rows]);
  const campaigns = useMemo(() => uniqPairs((rows ?? []).filter((r) => !filter.clientId || r.clientId === filter.clientId).map((r) => [r.campaignId ?? '', r.campaignName] as const)), [rows, filter.clientId]);

  async function doCancel(reason: string): Promise<string | null> {
    if (!cancelling) return null;
    const r = await cancelRequestApi(cancelling.id, reason);
    if (!r.ok) return r.error;
    setCancelling(null); show('취소했어요');
    await load();
    return null;
  }

  if (err) return <p role="alert" className="text-ui text-red-700">{err}</p>;
  if (!rows) return <p className="text-ui text-x-muted">불러오는 중…</p>;
  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <select className={SEL} value={filter.clientId} onChange={(e) => setFilter({ ...filter, clientId: e.target.value, campaignId: '' })} aria-label="클라이언트">
          <option value="">클라이언트 전체</option>{clients.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
        <select className={SEL} value={filter.campaignId} onChange={(e) => setFilter({ ...filter, campaignId: e.target.value })} aria-label="캠페인">
          <option value="">캠페인 전체</option>{campaigns.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
        <select className={SEL} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as '' | RequestStatus })} aria-label="상태">
          <option value="">상태 전체</option><option value="requested">요청됨</option><option value="cancelled">취소됨</option>
        </select>
        <label className="flex items-center gap-1 text-ui text-x-secondary">기간
          <input type="date" className={SEL} value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} aria-label="시작일" />
          ~
          <input type="date" className={SEL} value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} aria-label="종료일" />
        </label>
      </div>
      <h2 className="mt-4 text-[16px] font-semibold">요청 내역 {rows.length}</h2>
      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-x-border p-8 text-center text-ui text-x-muted">아직 만든 요청이 없어요 — 검토 대기에서 골라 만들어요</p>
      ) : (
        <ul className="mt-3 divide-y divide-x-border rounded-xl border border-x-border bg-white">
          {rows.map((r) => (
            <RequestRow key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onCancel={() => setCancelling(r)} />
          ))}
        </ul>
      )}
      {cancelling && <CancelDialog target={cancelling} onConfirm={doCancel} onClose={() => setCancelling(null)} />}
    </section>
  );
}
