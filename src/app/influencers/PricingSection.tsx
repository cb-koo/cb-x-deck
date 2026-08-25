'use client';
import { useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { kstMonthDay } from '@/lib/datetime';
import {
  CURRENCY_LABEL, PRICE_TYPES, PRICE_TYPE_LABEL, formatMoney, normalizeCurrency,
  type Currency, type Pricing, type PriceType, type PricingChange,
} from '@/lib/influencerPricing';
import { useErrorReport } from './profileShared';
import type { InfluencerLogRow } from '@/lib/influencerStore';

const NUM_ERR = '숫자만 입력해 주세요';

// 입력 문자열 → 금액. 비움=null(미정으로 되돌림), 불량은 undefined(저장 안 함).
function parseAmount(s: string): number | null | undefined {
  const t = s.replace(/[,\s]/g, '');
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return undefined;
  return Number(t);
}

export function PricingSection({ id, pricing, logs, onSaved, onErrorChange }: {
  id: string;
  pricing: Pricing;
  logs: InfluencerLogRow[];
  onSaved: (patch: Partial<Pricing>, newLogs: InfluencerLogRow[]) => void;
  onErrorChange?: (v: boolean) => void;   // 이 탭이 숨어 있을 때 저장 실패를 탭 라벨이 대신 알린다
}) {
  const currency = normalizeCurrency(pricing);
  // 입력 중 텍스트는 로컬, 확정값은 부모 pricing이 단일 출처 — blur 저장 성공 시 부모가 갱신한다.
  const [drafts, setDrafts] = useState<Partial<Record<PriceType, string>>>({});
  // 행(유형 또는 통화)별로 독립된 에러 슬롯 — A행 실패 안내를 B행 성공이 지우지 않게.
  type Key = PriceType | 'currency';
  const [err, setErr] = useState<Partial<Record<Key, string>>>({});
  const [savingCount, setSavingCount] = useState(0);
  useErrorReport(Object.keys(err).length > 0, onErrorChange);
  // 행 단위 busy — 서로 다른 키(다른 행)의 동시 PATCH는 서버가 행 잠금하므로 안전, 같은 키만 중복 차단.
  const busyKeys = useRef(new Set<Key>());

  // 성공 여부를 돌려준다 — 실패했는데 입력칸을 되돌리면 "저장된 값"처럼 보인다(거짓 성공 방지).
  async function save(key: Key, patch: Pricing): Promise<boolean> {
    if (busyKeys.current.has(key)) return false;
    busyKeys.current.add(key);
    setSavingCount((n) => n + 1);
    try {
      const r = await apiFetch(`/api/influencers/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricing: patch }),
      });
      if (!r.ok) {
        const msg = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`;
        setErr((e) => ({ ...e, [key]: msg }));
        return false;
      }
      const body = (await r.json()) as { pricing: Pricing; pricingLogs: InfluencerLogRow[] };
      setErr((e) => { const n = { ...e }; delete n[key]; return n; });
      // 응답은 서버의 pricing 전체 스냅샷이지만, 여기서 그대로 부모에 덮어쓰면 서로 다른 행의 병행
      // PATCH 중 나중에 커밋된 요청의 응답이 먼저 도착했을 때 그 값을 되돌려버린다(행 잠금은 커밋
      // 순서만 보장하지 HTTP 응답 도착 순서는 보장하지 않는다). 그래서 내가 보낸 patch의 키만 뽑아
      // 넘긴다 — 다른 키(다른 행)는 건드리지 않으니 도착 순서와 무관하게 각자 수렴한다.
      const applied = Object.fromEntries(
        Object.keys(patch).map((k) => [k, body.pricing[k as keyof Pricing]]),
      ) as Partial<Pricing>;
      onSaved(applied, body.pricingLogs);
      return true;
    } catch {
      setErr((e) => ({ ...e, [key]: '단가를 저장하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요' }));
      return false;
    } finally {
      busyKeys.current.delete(key);
      setSavingCount((n) => n - 1);
    }
  }

  // 입력 텍스트(draft)는 저장이 확정된 뒤에만 지운다 — 지우는 순간 표시값의 출처가 부모 pricing으로
  // 돌아가므로, 실패했는데 먼저 지우면 방금 친 숫자가 옛 값으로 되돌아가 버린다.
  async function onBlur(t: PriceType) {
    const raw = drafts[t];
    if (raw === undefined) return;                 // 만진 적 없음
    const amount = parseAmount(raw);
    if (amount === undefined) { setErr((e) => ({ ...e, [t]: NUM_ERR })); return; }
    if (err[t] === NUM_ERR) setErr((e) => { const n = { ...e }; delete n[t]; return n; }); // 숫자로 고쳤으니 안내는 내린다(저장 실패 안내는 건드리지 않는다)
    const clear = () => setDrafts((d) => { const n = { ...d }; delete n[t]; return n; });
    if (amount === (pricing[t] ?? null)) { clear(); return; }  // 값이 안 바뀌면 보내지 않는다
    if (await save(t, { [t]: amount })) clear();
  }

  return (
    <section className="mt-7 border-t border-x-border pt-5">
      <div className="flex items-center gap-2">
        <h2 className="text-content font-bold">협찬 단가</h2>
        <select value={currency} aria-label="통화"
                onChange={(e) => { const c = e.target.value as Currency; if (c !== currency) save('currency', { currency: c }); }}
                className="rounded-lg border border-x-border-strong bg-white px-1.5 py-0.5 text-caption outline-none focus:border-x-blue">
          {(Object.keys(CURRENCY_LABEL) as Currency[]).map((c) => (
            <option key={c} value={c}>{c === 'JPY' ? '¥ 엔화' : '₩ 원화'}</option>
          ))}
        </select>
        {savingCount > 0 && <span className="text-caption text-x-muted">저장 중…</span>}
      </div>
      <p className="text-caption leading-relaxed text-x-muted">유형별 1건당 단가예요. 바꾸면 아래 기록에 변경 이력이 남아요.</p>
      {err.currency && <p role="alert" className="mt-1 text-caption text-red-500">{err.currency}</p>}
      <ul className="mt-1.5 space-y-2">
        {PRICE_TYPES.map((t) => (
          <PriceRow key={t} type={t} currency={currency}
                    value={drafts[t] ?? (pricing[t] != null ? String(pricing[t]) : '')}
                    history={logs.filter((l) => l.eventType === 'pricing_changed'
                      && (l.payload as PricingChange | null)?.priceType === t)}
                    error={err[t]}
                    onChange={(v) => setDrafts((d) => ({ ...d, [t]: v }))}
                    onBlur={() => onBlur(t)} />
        ))}
      </ul>
    </section>
  );
}

function PriceRow({ type, currency, value, history, error, onChange, onBlur }: {
  type: PriceType; currency: Currency; value: string;
  history: InfluencerLogRow[]; error?: string;
  onChange: (v: string) => void; onBlur: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="flex items-center gap-2">
        {/* 라벨 폭(w-20=80px) + gap-2(8px) = 88px — 아래 들여쓰기 pl-[88px]가 이 합계에 맞물려 있다 */}
        <span className="w-20 shrink-0 text-ui text-x-secondary">{PRICE_TYPE_LABEL[type]}</span>
        <input value={value} inputMode="numeric" placeholder="미정"
               aria-label={`${PRICE_TYPE_LABEL[type]} 단가`}
               onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
               className="w-32 rounded-lg border border-x-border-strong px-2 py-1 text-right text-ui outline-none focus:border-x-blue" />
        <span className="text-ui text-x-muted">{CURRENCY_LABEL[currency]}</span>
        {/* 이력이 없으면 버튼 자체를 두지 않는다 — 눌러도 아무 것도 없는 어포던스는 만들지 않는다 */}
        {history.length > 0 && (
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
                  aria-label={`${PRICE_TYPE_LABEL[type]} 단가 변경 이력 ${history.length}건 ${open ? '접기' : '펼치기'}`}
                  className="text-caption text-x-muted hover:text-x-secondary">
            <span aria-hidden>{open ? '▾' : '▸'} 이력 {history.length}</span>
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-0.5 pl-[88px] text-caption text-red-500">{error}</p>}
      {open && (
        <ul className="mt-0.5 pl-[88px]">
          {history.map((l) => {
            const p = l.payload as PricingChange;
            const fmt = (v: number | string | null) =>
              v === null ? '미정' : formatMoney(v as number, p.currency);
            return (
              <li key={l.id} className="text-caption text-x-muted">
                {fmt(p.from)} → {fmt(p.to)} · {kstMonthDay(l.createdAt)}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
