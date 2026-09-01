'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/lib/toastContext';
import { fetchRequests, cancelRequestApi } from '@/lib/settlementApi';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { useSignedTaskProofUrls } from '@/components/useSignedTaskProofUrls';
import { RequestRow } from './RequestRow';
import { CancelDialog } from './CancelDialog';
import { uniqPairs } from './uniqPairs';
import { STATUS_GROUP_OPTIONS, inGroup, keyOf, needsDiffAck, type StatusGroup } from '@/lib/settlementDisplay';
import { kstDate } from '@/lib/datetime';

const SEL = 'rounded-lg border border-x-border bg-white px-2.5 py-1.5 text-ui';

export function RequestList({ focusTaskId }: { focusTaskId: string | null }) {
  const { show } = useToast();
  const [rows, setRows] = useState<PaymentRequestRow[] | null>(null);   // 필터 없이 전량 — 옵션 목록도 이걸로 만든다
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<{ clientId: string; campaignId: string; status: StatusGroup; from: string; to: string }>({ clientId: '', campaignId: '', status: '', from: '', to: '' });
  const [open, setOpen] = useState<string | null>(null);        // 펼친 요청 id
  const [cancelling, setCancelling] = useState<PaymentRequestRow | null>(null);
  const didFocus = useRef(false);                                // 딥링크 자동 펼침을 첫 로드 1회로 제한

  const load = useCallback(async () => {
    const r = await fetchRequests({});
    if (!r.ok) { setErr(r.error); return; }
    setErr(''); setRows(r.data);
    // 배지에서 들어왔으면 그 작업의 활성 요청(없으면 최신)을 펼친다 — 최초 1회만(이후 토글은 사용자 의도 유지)
    if (focusTaskId && !didFocus.current) {
      didFocus.current = true;
      const hit = r.data.find((x) => x.taskId === focusTaskId && x.status === 'requested') ?? r.data.find((x) => x.taskId === focusTaskId);
      if (hit) setOpen(hit.id);
    }
  }, [focusTaskId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드(필터는 화면에서만 적용, 재조회 없음), 취소 후에도 load()로 재조회
  useEffect(() => { void load(); }, [load]);

  // 옵션은 전량(rows)에서 뽑는다 — 필터에 걸려 안 보이는 클라이언트/캠페인도 계속 골라 쓸 수 있게(08-28 리뷰)
  // clientId는 042부터 non-null 스냅샷이라 더 이상 걸러낼 필요가 없다
  const clients = useMemo(() => uniqPairs((rows ?? []).map((r) => [r.clientId, r.clientName] as const)), [rows]);
  const campaigns = useMemo(() => uniqPairs((rows ?? []).filter((r) => r.campaignId && (!filter.clientId || r.clientId === filter.clientId)).map((r) => [r.campaignId as string, r.campaignName] as const)), [rows, filter.clientId]);

  const filtered = useMemo(() => (rows ?? []).filter((r) =>
    (!filter.clientId || r.clientId === filter.clientId)
    && (!filter.campaignId || r.campaignId === filter.campaignId)
    && inGroup(keyOf(r), filter.status)
    && (!filter.from || kstDate(r.createdAt) >= filter.from)
    && (!filter.to || kstDate(r.createdAt) <= filter.to)), [rows, filter]);

  // 차액 확인이 필요한 건 — 알림이 없으므로 화면 안에서 눈에 띄어야 한다(스펙 §6-5)
  const needAck = useMemo(() => (rows ?? []).filter((r) => needsDiffAck(r)), [rows]);

  // 증빙 서명 URL — 한 번에 펼쳐지는 행은 하나뿐이라 그 행의 증빙만 서명한다(목록은 단조 증가하므로 전량을
  // 미리 서명하면 낭비가 계속 커진다, 리뷰 수정 5). 훅 호출 자체는 화면당 정확히 1회·조건부 return보다
  // 앞에서 여전히 무조건 실행된다 — 입력 배열의 길이만 펼침 여부에 따라 0~1개로 바뀔 뿐이다.
  // 훅이 경로→URL을 캐시하므로 같은 행을 다시 펼치면 즉시 뜬다.
  const openRow = (rows ?? []).find((r) => r.id === open) ?? null;
  const proofUrls = useSignedTaskProofUrls(openRow?.proof?.url ? [openRow.proof.url] : []);

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
        <select className={SEL} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as StatusGroup })} aria-label="상태">
          {STATUS_GROUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label className="flex items-center gap-1 text-ui text-x-secondary">기간
          <input type="date" className={SEL} value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} aria-label="시작일" />
          ~
          <input type="date" className={SEL} value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} aria-label="종료일" />
        </label>
      </div>
      {needAck.length > 0 && filter.status !== 'paid_diff' && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-ui text-amber-700">
          정산 금액이 요청과 다른 지급이 {needAck.length}건 있어요 — 확인해 주세요
          <button type="button" className="underline" onClick={() => setFilter({ ...filter, status: 'paid_diff' })}>보기</button>
        </p>
      )}
      <h2 className="mt-4 text-[16px] font-semibold">요청 내역 {filtered.length}</h2>
      {filtered.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-x-border p-8 text-center text-ui text-x-muted">
          {rows.length === 0 ? '아직 만든 요청이 없어요 — 검토 대기에서 골라 만들어요' : '조건에 맞는 요청이 없어요'}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-x-border rounded-xl border border-x-border bg-white">
          {filtered.map((r) => (
            <RequestRow key={r.id} r={r} open={open === r.id} proofSignedUrl={r.proof ? proofUrls[r.proof.url] ?? null : null}
                        onToggle={() => setOpen(open === r.id ? null : r.id)} onCancel={() => setCancelling(r)} onChanged={() => void load()} />
          ))}
        </ul>
      )}
      {cancelling && <CancelDialog target={cancelling} onConfirm={doCancel} onClose={() => setCancelling(null)} />}
    </section>
  );
}
