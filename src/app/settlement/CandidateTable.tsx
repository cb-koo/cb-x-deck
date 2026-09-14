'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui';
import { useToast } from '@/lib/toastContext';
import { fetchCandidates, createRequestsApi, type CreateFailure } from '@/lib/settlementApi';
import type { SettlementCandidate } from '@/lib/settlementCalc';
import type { SettlementSettings } from '@/lib/settlementSettings';
import { visibleCategories } from '@/lib/settlementSettings';
import { TASK_TYPES, TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';
import { PAYMENT_TYPES, PAYMENT_TYPE_LABEL, type PaymentMethodType } from '@/lib/influencerPayment';
import { formatMoney } from '@/lib/influencerPricing';
import { useSignedTaskProofUrls } from '@/components/useSignedTaskProofUrls';
import { CandidateRow, type RowEdit } from './CandidateRow';
import { CreateConfirmDialog } from './CreateConfirmDialog';
import { effectiveReadiness } from './readinessView';
import { uniqPairs } from './uniqPairs';

const SEL = 'rounded-lg border border-x-border bg-white px-2.5 py-1.5 text-ui';
const deadlineLabel = (ymd: string) => {
  const d = new Date(ymd + 'T12:00:00Z');
  return `${d.getUTCMonth() + 1}-${d.getUTCDate()}(${'일월화수목금토'[d.getUTCDay()]})`;
};

export function CandidateTable({ onCreated }: { onCreated?: () => void }) {
  const { show } = useToast();
  const [data, setData] = useState<{ candidates: SettlementCandidate[]; settings: SettlementSettings; today: string } | null>(null);
  const [err, setErr] = useState('');
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<{ clientId: string; campaignId: string; type: '' | TaskType; method: '' | PaymentMethodType }>({ clientId: '', campaignId: '', type: '', method: '' });
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchCandidates();
    if (!r.ok) { setErr(r.error); return; }
    setErr('');
    setData(r.data);
    // 편집 상태는 서버 기본값으로 초기화 — 이미 사람이 고친 행은 유지(재조회로 손댄 값을 잃지 않게)
    setEdits((prev) => {
      const next: Record<string, RowEdit> = {};
      for (const c of r.data.candidates) next[c.taskId] = prev[c.taskId] ?? { category: c.categoryDefault, deadlineOn: c.deadlineDefault, referenceUrl: c.referenceDefault ?? '' };
      return next;
    });
    setSelected((prev) => new Set([...prev].filter((id) => r.data.candidates.some((c) => c.taskId === id))));
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(CampaignDetail·tracking 관례)
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const f = data.candidates.filter((c) =>
      (!filter.clientId || c.clientId === filter.clientId) && (!filter.campaignId || c.campaignId === filter.campaignId)
      && (!filter.type || c.taskType === filter.type) && (!filter.method || c.method?.type === filter.method));
    // 🔴 맨 아래, 나머지 게시일 오래된 순(서버 정렬 유지) — §4-1
    const blocked = (c: SettlementCandidate) => effectiveReadiness(c, edits[c.taskId]) === 'blocked';
    return [...f.filter((c) => !blocked(c)), ...f.filter(blocked)];
  }, [data, filter, edits]);

  const clients = useMemo(() => uniqPairs(data?.candidates.map((c) => [c.clientId ?? '', c.clientName] as const) ?? []), [data]);
  const campaigns = useMemo(() => uniqPairs((data?.candidates ?? []).filter((c) => !filter.clientId || c.clientId === filter.clientId).map((c) => [c.campaignId, c.campaignName] as const)), [data, filter.clientId]);

  const picked = rows.filter((c) => selected.has(c.taskId));
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of picked) if (c.money) t[c.money.payoutCurrency] = (t[c.money.payoutCurrency] ?? 0) + c.money.amountGross;
    return t;
  }, [picked]);
  // 증빙 서명 URL — 표 전체에서 한 번만 배치 요청한다(행마다 부르면 왕복이 행 수만큼 늘어난다, useSignedTaskProofUrls 관례).
  // data가 아직 없어도(로딩 중) 훅은 매 렌더 호출돼야 하므로 빈 배열로 대체한다(입력 크기와 무관하게 고정된 훅 호출 규칙).
  const proofUrls = useSignedTaskProofUrls((data?.candidates ?? []).map((c) => c.proof?.url ?? '').filter(Boolean));

  async function submit() {
    if (!data) return;
    const items = picked.map((c) => ({
      taskId: c.taskId, category: edits[c.taskId].category ?? '', deadlineOn: edits[c.taskId].deadlineOn,
      referenceUrl: edits[c.taskId].referenceUrl || null,
      expected: { amountGross: c.money!.amountGross, payoutCurrency: c.money!.payoutCurrency, paymentMethodId: c.method!.id },
    }));
    const r = await createRequestsApi(items);
    setConfirming(false);
    if (r.ok) {
      show(`${r.data.created.length}건 만들었어요`);
      setSelected(new Set()); setFailures({});
      // 만든 요청을 바로 보게 요청 내역 탭으로 넘긴다(원 스펙 QA 항목 '만들기 → 내역 이동', 09-02 koo 확정).
      // 탭이 바뀌면 이 컴포넌트는 언마운트되므로 재조회는 하지 않는다 — 돌아오면 마운트 시 다시 읽는다.
      if (onCreated) { onCreated(); return; }
      await load();
      return;
    }
    // 전체 거절(§5-2) — 목록 재조회 + 실패 건에 이유, 체크 해제
    const f: Record<string, string> = {};
    for (const x of (r.failures ?? []) as CreateFailure[]) f[x.taskId] = x.reason;
    setFailures(f); setSelected(new Set());
    show(r.error);
    await load();
  }

  if (err) return <p role="alert" className="text-ui text-red-700">{err}</p>;
  if (!data) return <p className="text-ui text-x-muted">불러오는 중…</p>;
  const cats = visibleCategories(data.settings);
  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <select className={SEL} value={filter.clientId} onChange={(e) => setFilter({ ...filter, clientId: e.target.value, campaignId: '' })} aria-label="클라이언트">
          <option value="">클라이언트 전체</option>{clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className={SEL} value={filter.campaignId} onChange={(e) => setFilter({ ...filter, campaignId: e.target.value })} aria-label="캠페인">
          <option value="">캠페인 전체</option>{campaigns.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className={SEL} value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value as '' | TaskType })} aria-label="유형">
          <option value="">유형 전체</option>{TASK_TYPES.map((t) => <option key={t} value={t}>{TASK_TYPE_LABEL[t]}</option>)}
        </select>
        <select className={SEL} value={filter.method} onChange={(e) => setFilter({ ...filter, method: e.target.value as '' | PaymentMethodType })} aria-label="결제 수단">
          <option value="">결제 수단 전체</option>{PAYMENT_TYPES.map((t) => <option key={t} value={t}>{PAYMENT_TYPE_LABEL[t]}</option>)}
        </select>
        <span className="ml-auto text-ui text-x-muted">이번 주 마감 {deadlineLabel(rows[0]?.deadlineDefault ?? data.today)}</span>
      </div>
      <h2 className="mt-4 text-[16px] font-semibold">검토 대기 {rows.length}</h2>
      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-x-border p-8 text-center text-ui text-x-muted">게시 확인된 작업이 없어요 — 캠페인에서 게시된 날을 적으면 여기 나타나요</p>
      ) : (
        <ul className="mt-3 divide-y divide-x-border rounded-xl border border-x-border bg-white">
          {rows.map((c) => (
            <CandidateRow key={c.taskId} c={c} edit={edits[c.taskId]} categories={cats} failure={failures[c.taskId]}
                          selected={selected.has(c.taskId)}
                          proofSignedUrl={c.proof ? proofUrls[c.proof.url] ?? null : null}
                          onEdit={(e) => {
                            setEdits((p) => ({ ...p, [c.taskId]: e }));
                            // 분류를 비우는 등으로 즉시 🔴가 되면 체크도 같이 풀어 준다(라벨-값 불일치 방지, §4 리뷰)
                            if (effectiveReadiness(c, e) === 'blocked') setSelected((p) => { const n = new Set(p); n.delete(c.taskId); return n; });
                          }}
                          onToggle={(on) => setSelected((p) => { const n = new Set(p); if (on) n.add(c.taskId); else n.delete(c.taskId); return n; })} />
          ))}
        </ul>
      )}
      {/* 하단 고정 바 — 지급 통화별 합계, 0인 통화는 생략 */}
      <div className="sticky bottom-0 mt-4 flex items-center justify-between rounded-xl border border-x-border bg-white px-4 py-3 shadow-sm">
        <span className="text-ui tabular-nums">선택 {picked.length}건{Object.keys(totals).length > 0 && ' · '}{Object.entries(totals).map(([cur, v]) => formatMoney(v, cur as 'KRW' | 'JPY')).join(' / ')}</span>
        <Button variant="primary" disabled={picked.length === 0} onClick={() => setConfirming(true)}>선택 {picked.length}건 요청 만들기</Button>
      </div>
      {confirming && <CreateConfirmDialog items={picked} edits={edits} onConfirm={submit} onClose={() => setConfirming(false)} />}
    </section>
  );
}
