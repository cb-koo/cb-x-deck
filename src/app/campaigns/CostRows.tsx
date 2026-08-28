'use client';
import { useState } from 'react';
import type { InfluencerOption } from '@/lib/draftTypes';
import { CURRENCIES, CURRENCY_LABEL, parseAmount, suggestTaskCost, formatAmount, type TaskCost, type Currency } from '@/lib/campaignCost';
import { TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';

// 사람별 줄(스펙 §4-2) — 한 줄 = 인플 · 금액 · (방문협찬이면 방문일) · 게시 예정일 · 근거.
// 인플을 고르는 순간 명부 단가(작업 유형)로 금액이 채워지고, 단가가 없으면 빈 칸(점선) + 주황 안내.
// 사람이 적은 값은 덮지 않는다. handles가 비면 미배정 한 줄(key '').
//
// 날짜가 사람별인 이유: 같은 캠페인이어도 인플마다 올리는 날이 다르다(koo QA). 창 위쪽 날짜 칸은
// '모두에게 적용' 도우미일 뿐이고, 실제로 저장되는 값은 이 줄의 날짜다.
//
// 칸에 보이는 값은 '지금 치고 있는 한 칸'만 내가 쥐고(editing), 나머지는 언제나 부모가 쥔 values다 —
// 손을 뗀 칸이 부모 값과 다른 말을 하면(유형을 바꿔 단가가 다시 채워졌는데 옛 글자가 남는 식) 보이는 금액과
// 제출되는 금액이 갈라진다. 지운 칸(values = null)은 지운 대로 빈 칸이다.
//
// 통화는 이 컴포넌트가 쥐지 않는다 — 블록 전체의 통화라 부모(TaskAddModal) state다. 명부 단가 통화가 블록
// 통화와 다르면 이 컴포넌트는 금액을 '바꿔 넣지' 않는다(그건 금액 조작) — 부모가 그 줄을 비워 주고, 여기서는
// 근거 칸에 원래 단가·통화를 그대로 보여줄 뿐이다.
export type RowDates = { scheduledOn: string; visitOn: string };

export function CostRows({ type, handles, influencerOptions, values, currency, dates, showVisit, onChange, onCurrencyChange, onDateChange }: {
  type: TaskType; handles: string[]; influencerOptions: InfluencerOption[];
  values: Record<string, TaskCost | null>;
  currency: Currency;
  dates: Record<string, RowDates>;
  showVisit: boolean;
  onChange: (handle: string, next: TaskCost | null) => void;
  onCurrencyChange: (next: Currency) => void;
  onDateChange: (handle: string, patch: Partial<RowDates>) => void;
}) {
  const rows = handles.length ? handles : [''];
  // 지금 치고 있는 칸 하나만 글자를 따로 쥔다(잘못 친 값도 손을 뗄 때까지는 남아 있어야 고칠 수 있다).
  const [editing, setEditing] = useState<{ handle: string; text: string } | null>(null);
  const shown = (h: string) => (editing && editing.handle === h ? editing.text : values[h] ? String(values[h]!.amount) : '');
  const optionFor = (h: string) => influencerOptions.find((o) => o.handle.toLowerCase() === h.toLowerCase());

  function commit(h: string, raw: string) {
    setEditing({ handle: h, text: raw });
    const n = raw.trim() === '' ? null : parseAmount(raw);
    if (n === null && raw.trim() !== '') return;   // 잘못된 값은 저장하지 않고 입력만 남긴다(제출 시 검증)
    onChange(h, n === null ? null : { amount: n, currency });
  }
  function setAllSame() {
    const first = rows.map((h) => shown(h)).find((v) => v && parseAmount(v) !== null);
    if (!first) return;
    for (const h of rows) commit(h, first);
  }
  function changeCurrency(c: Currency) {
    onCurrencyChange(c);   // 금액을 통화별로 바꿔 붙이는 건 부모(블록 통화 하나)가 한다 — 여기선 고른 값만 올린다
  }
  const grid = showVisit ? 'grid-cols-[1fr_140px_150px_150px_1fr]' : 'grid-cols-[1fr_140px_150px_1fr]';
  const dateInput = 'h-9 w-full rounded-lg border border-x-border-strong bg-white px-2 text-content outline-none focus:border-x-blue';
  return (
    <div className="overflow-hidden rounded-[10px] border border-x-border">
      <div className={`grid ${grid} items-center gap-3 bg-x-surface px-3.5 py-2 text-ui text-x-secondary`}>
        <span>인플루언서</span><span>금액</span>{showVisit && <span>방문일</span>}<span>게시 예정일</span><span>근거</span>
      </div>
      {rows.map((h) => {
        const sug = h ? suggestTaskCost(optionFor(h)?.pricing, type) : null;
        const raw = shown(h);
        const invalid = raw.trim() !== '' && parseAmount(raw) === null;
        const who = h ? `@${h}` : '미배정';
        const d = dates[h] ?? { scheduledOn: '', visitOn: '' };
        // 근거 칸은 날짜 칸이 생기며 좁아졌다 — 잘린 문장은 title로 끝까지 읽을 수 있게 둔다
        const why = sug && sug.currency === currency
          ? `단가 ${TASK_TYPE_LABEL[type]} ${formatAmount(sug.amount, sug.currency)}`
          : sug
          ? `단가 ${TASK_TYPE_LABEL[type]} ${formatAmount(sug.amount, sug.currency)} — 통화가 달라 비워뒀어요`
          : h ? `명부에 ${TASK_TYPE_LABEL[type]} 단가 없음 — 비워두면 비용 없이 만들어요` : '비워두면 비용 없이 만들어요';
        return (
          <div key={h || '__none'} className={`grid min-h-12 ${grid} items-center gap-3 border-t border-x-border px-3.5 py-1.5`}>
            <span className="flex items-center gap-2 truncate">
              {h ? <><span aria-hidden className="inline-block h-6 w-6 shrink-0 rounded-full bg-x-border" />@{h}</> : <span className="text-x-secondary">미배정</span>}
            </span>
            <label className={`flex h-9 items-center gap-1.5 rounded-lg border bg-white px-2.5 tabular-nums ${raw === '' ? 'border-dashed border-x-border-strong text-x-muted' : 'border-x-border-strong'} ${invalid ? 'border-red-400' : ''}`}>
              {currency === 'JPY' ? '¥' : '₩'}
              <input inputMode="numeric" value={raw} onChange={(e) => commit(h, e.target.value)} placeholder="금액" aria-label={`${who} 비용`}
                     // 손을 떼면 이 칸도 부모 값으로 돌아간다 — 저장되지 않은 글자(잘못 친 값)가 남아 있지 않게
                     onBlur={() => setEditing((cur) => (cur && cur.handle === h ? null : cur))}
                     className="w-full bg-transparent text-content outline-none placeholder:text-x-muted" />
            </label>
            {showVisit && (
              <input type="date" value={d.visitOn} aria-label={`${who} 방문일`}
                     onChange={(e) => onDateChange(h, { visitOn: e.target.value })} className={dateInput} />
            )}
            <input type="date" value={d.scheduledOn} aria-label={`${who} 게시 예정일`}
                   onChange={(e) => onDateChange(h, { scheduledOn: e.target.value })} className={dateInput} />
            <span title={why} className={`truncate text-ui ${sug && sug.currency === currency ? 'text-x-muted' : 'text-amber-700'}`}>{why}</span>
          </div>
        );
      })}
      <div className="flex gap-4 border-t border-x-border bg-x-surface px-3.5 py-2.5 text-ui text-x-secondary">
        {rows.length > 1 && <button type="button" onClick={setAllSame} className="underline underline-offset-2 hover:text-x-text">모두 같은 금액으로</button>}
        <label className="flex items-center gap-1.5">통화
          <select value={currency} onChange={(e) => changeCurrency(e.target.value as Currency)} className="h-7 rounded border border-x-border-strong bg-white px-1.5 text-ui">
            {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]} ({c})</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
