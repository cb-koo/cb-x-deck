'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { PaymentView } from '@/lib/paymentView';

// 패널이 열린 작업의 결제 수단 한 줄(설계 §8-1). 같은 (핸들, 작업, refreshKey)는 모듈 캐시로 한 번만 부른다 —
// 이전/다음으로 오가며 같은 인플을 다시 볼 때 매번 부르지 않게. refreshKey는 정산 요청 상태가 바뀌면 달라진다.
const cache = new Map<string, PaymentView>();

// 결제 수단을 고르거나(그 작업) 새로 등록하면(그 인플의 모든 작업 — 고를 목록이 늘었다) 캐시된 보기를 버린다.
// 부르는 쪽(TaskPanel)의 refreshKey(payVersion)는 패널이 다시 마운트되면 0으로 돌아가 옛 키가 되살아나므로,
// 키만 올리면 다음에 패널을 다시 열 때 고르기 전 보기를 캐시에서 꺼낸다. taskId를 빼면 그 인플 전부.
export function dropPaymentView(handle: string, taskId?: string | null) {
  const prefix = taskId === undefined ? `${handle.toLowerCase()}|` : `${handle.toLowerCase()}|${taskId ?? ''}|`;
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}

export function usePaymentView(handle: string | null, taskId: string | null, refreshKey: string) {
  const key = handle ? `${handle.toLowerCase()}|${taskId ?? ''}|${refreshKey}` : '';
  const [state, setState] = useState<{ key: string; view: PaymentView | null; failed: boolean }>(
    () => ({ key, view: key ? cache.get(key) ?? null : null, failed: false }));
  useEffect(() => {
    if (!key || cache.has(key)) return;
    let alive = true;
    (async () => {
      const qs = new URLSearchParams({ handle: handle as string, ...(taskId ? { taskId } : {}) });
      const r = await apiFetch(`/api/influencers/payment-view?${qs}`).catch(() => null);
      const v = r && r.ok ? ((await r.json().catch(() => null)) as PaymentView | null) : null;
      if (v) cache.set(key, v);
      // await 뒤에서만 setState한다(이펙트 본문 동기 setState 금지) — 키가 바뀐 뒤 늦게 온 응답은 버린다
      if (alive) setState({ key, view: v, failed: !v });
    })();
    return () => { alive = false; };
  }, [key, handle, taskId]);
  // 키가 바뀐 첫 렌더는 state가 아직 옛 키다 — 캐시에 있으면 그걸, 없으면 불러오는 중으로 본다
  const current = state.key === key ? state : { key, view: key ? cache.get(key) ?? null : null, failed: false };
  return { view: current.view, loading: !!key && !current.view && !current.failed, failed: current.failed };
}
