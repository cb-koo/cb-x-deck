'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CURRENCIES, CURRENCY_LABEL, AMOUNT_MESSAGE, parseAmount, formatAmount,
  type TaskCost, type Currency,
} from '@/lib/campaignCost';

// 작업 비용(금액·통화 한 벌) — 팝오버에서 고친다(작업 스펙 §4-1 비용 칸). 저장은 부모 몫(낙관적 갱신·롤백은 호출부 훅).
// 유형 칸은 없앴다(2026-08-28): 비용 유형 = 작업 유형이라 표의 '유형' 열과 두 벌이 됐고, 두 값이 어긋나면 어느 쪽이 참인지 알 수 없었다.
// InfluencerChip과 같은 골격(body 포털·좌표 고정·바깥 클릭/Esc 닫기) — 표 셀·카드 도구층 어디서 열려도 overflow에 잘리지 않는다.
// 단가 제안(suggestion)은 '비어 있을 때 열면 그 값으로 시작'만 한다 — 사람이 적은 값을 덮지 않는다(§3-2).
const POP_W = 300;
const POP_H = 260; // 실측(제목·설명·금액/통화 2열·안내문·버튼줄) 근사 — 아래 공간 판정(flip)에만 쓴다

export function CostPopover({ value, suggestion, onChange, compact }: {
  value: TaskCost | null;
  suggestion: TaskCost | null;    // 배정된 인플의 단가에서 온 제안(suggestTaskCost) — 없으면 null
  onChange: (next: TaskCost | null) => void;
  compact?: boolean;              // 표 셀 = 글자만(테두리 없음, 15px), 카드 도구층 = 칩(32px, 13px)
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('KRW');
  const [err, setErr] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  // 앵커의 화면 좌표에 고정 + 화면 경계 클램프 + 아래 공간이 없으면 위로(InfluencerChip.place와 같은 계산)
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - POP_W - 8));
    const below = r.bottom + 4;
    const flip = below + POP_H > window.innerHeight && r.top - POP_H - 4 > 0;
    setPos({ top: flip ? r.top - POP_H - 4 : below, left });
  }, []);
  const close = useCallback(() => {
    if (popRef.current?.contains(document.activeElement)) btnRef.current?.focus();
    setOpen(false);
  }, []);

  function openPop() {
    const start = value ?? suggestion;   // 비어 있으면 제안으로 시작 — 저장을 눌러야 값이 된다(자동 저장 아님)
    setAmount(start ? String(start.amount) : '');
    setCurrency(start?.currency ?? 'KRW');
    setErr(null); place(); setOpen(true);
  }
  function save() {
    const n = parseAmount(amount);
    if (n === null) { setErr(AMOUNT_MESSAGE); return; }
    const next: TaskCost = { amount: n, currency };
    // 바뀐 게 없으면 부모를 부르지 않는다 — 같은 값으로 PATCH를 한 번 더 보낼 이유가 없다(InfluencerChip 관례)
    if (!value || value.amount !== next.amount || value.currency !== next.currency) onChange(next);
    close();
  }
  function clear() { if (value) onChange(null); close(); }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    // capture로 받아 전파를 끊는다 — 카드 peek 오버레이의 Esc 리스너까지 한 번에 닫히지 않게(InfluencerChip 관례)
    const onKey = (e: KeyboardEvent) => { if (e.key !== 'Escape' || e.isComposing) return; e.stopPropagation(); close(); };
    const onMove = () => place();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, close, place]);

  const label = value ? formatAmount(value.amount, value.currency) : null;
  const trigger = value
    ? label
    : suggestion
      ? <span className="text-x-blue-text">제안 {formatAmount(suggestion.amount, suggestion.currency)}</span>
      : (compact ? <span className="text-x-muted">비용 없음</span> : '+ 비용');

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => (open ? close() : openPop())}
              aria-haspopup="dialog" aria-expanded={open}
              // 보이는 글자(trigger)와 aria-label을 늘 맞춘다 — 제안 상태에서 스크린리더가 "비용 입력하기"만 읽으면
              // 화면에 보이는 "제안 300,000원"과 어긋나 무엇이 있는지 모른다.
              aria-label={
                value ? `비용 ${label} — 바꾸기`
                : suggestion ? `제안 ${formatAmount(suggestion.amount, suggestion.currency)} — 비용 입력하기`
                : '비용 입력하기'
              }
              title={value ? '이 작업의 비용 — 눌러서 바꾸기'
                           : suggestion ? '배정된 인플루언서의 단가에서 제안한 값이에요 — 눌러서 확인하고 저장'
                           : '이 작업 하나의 비용을 적어요'}
              className={compact
                ? 'text-content tabular-nums hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-x-blue'
                : `inline-flex h-10 items-center gap-1.5 rounded-lg border bg-white px-2.5 text-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-blue ${
                    value ? 'border-x-border-strong text-x-text hover:bg-x-hover'
                          : 'border-dashed border-x-border-strong text-x-muted hover:bg-x-hover hover:text-x-secondary'}`}>
        {trigger}
      </button>
      {open && createPortal(
        <div ref={popRef} role="dialog" aria-label="작업 비용" style={{ top: pos.top, left: pos.left, width: POP_W }}
             onClick={(e) => e.stopPropagation()}
             className="fixed z-50 rounded-xl border border-x-border-strong bg-white p-3 shadow-lg">
          <p className="text-ui font-bold">작업 비용</p>
          <p className="mt-0.5 text-ui text-x-muted">이 작업 하나에 드는 비용이에요 — 인플루언서별 소계와 캠페인 합계에 바로 반영돼요</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block text-ui text-x-secondary">금액
              <input inputMode="numeric" value={amount} autoFocus
                     onChange={(e) => { setAmount(e.target.value); setErr(null); }}
                     onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) save(); }}
                     placeholder="300000"
                     className="mt-0.5 h-10 w-full rounded-md border border-x-border-strong px-2 text-content tabular-nums outline-none focus:border-x-blue" />
            </label>
            <label className="block text-ui text-x-secondary">통화
              <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}
                      className="mt-0.5 h-10 w-full rounded-md border border-x-border-strong bg-white px-2 text-content outline-none focus:border-x-blue">
                {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]} ({c})</option>)}
              </select>
            </label>
          </div>
          <p className="mt-1 text-ui text-x-muted">통화를 바꿔도 금액은 그대로예요 — 환산하지 않아요</p>
          {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
          <div className="mt-2 flex items-center gap-2">
            {value && <button type="button" onClick={clear} className="text-ui text-x-secondary hover:text-red-600">비용 지우기</button>}
            <button type="button" onClick={close} className="ml-auto rounded-full px-3 py-1 text-ui text-x-secondary hover:bg-x-text/5">취소</button>
            <button type="button" onClick={save} className="rounded-full bg-x-blue px-3 py-1 text-ui font-bold text-white hover:bg-x-blue-hover">저장</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
