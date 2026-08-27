'use client';
import { useEffect, useState } from 'react';
import type { InfluencerOption } from '@/lib/draftTypes';
import { CURRENCIES, CURRENCY_LABEL, parseAmount, suggestTaskCost, formatAmount, type TaskCost, type Currency } from '@/lib/campaignCost';
import { TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';

// 비용 — 사람별 금액 줄(스펙 §4-2). 인플을 고르는 순간 명부 단가(작업 유형)로 채워진 금액 칸이 사람마다 한 줄, 옆에 근거.
// 단가 없으면 빈 칸(점선) + 주황 안내. 사람이 적은 값은 덮지 않는다. handles가 비면 미배정 한 줄(key '').
//
// 칸에 보이는 값은 '지금 치고 있는 한 칸'만 내가 쥐고(editing), 나머지는 언제나 부모가 쥔 values다 —
// 손을 뗀 칸이 부모 값과 다른 말을 하면(유형을 바꿔 단가가 다시 채워졌는데 옛 글자가 남는 식) 보이는 금액과
// 제출되는 금액이 갈라진다. 지운 칸(values = null)은 지운 대로 빈 칸이다.
export function CostRows({ type, handles, influencerOptions, values, onChange }: {
  type: TaskType; handles: string[]; influencerOptions: InfluencerOption[];
  values: Record<string, TaskCost | null>;
  onChange: (handle: string, next: TaskCost | null) => void;
}) {
  const rows = handles.length ? handles : [''];
  // 지금 치고 있는 칸 하나만 글자를 따로 쥔다(잘못 친 값도 손을 뗄 때까지는 남아 있어야 고칠 수 있다).
  const [editing, setEditing] = useState<{ handle: string; text: string } | null>(null);
  // 통화는 줄 전체가 하나 — 사람이 고르기 전에는 부모가 채운 값(명부 통화)을 따라간다
  const [picked, setPicked] = useState<Currency | null>(null);
  const currency = picked ?? rows.map((h) => values[h]).find(Boolean)?.currency ?? 'JPY';
  const shown = (h: string) => (editing && editing.handle === h ? editing.text : values[h] ? String(values[h]!.amount) : '');
  const optionFor = (h: string) => influencerOptions.find((o) => o.handle.toLowerCase() === h.toLowerCase());

  // 통화가 다른 값이 섞여 들어오면(명부 단가 통화가 사람마다 다를 때) 앞의 기호 하나와 값들이 어긋난다 —
  // 블록 통화로 맞춘다. 맞추고 나면 더 부를 일이 없어 한 번에 멎는다.
  useEffect(() => {
    for (const h of handles.length ? handles : ['']) {
      const v = values[h];
      if (v && v.currency !== currency) onChange(h, { amount: v.amount, currency });
    }
  }, [handles, values, currency, onChange]);

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
    setPicked(c);
    for (const h of rows) { const n = parseAmount(shown(h)); if (n !== null) onChange(h, { amount: n, currency: c }); }
  }
  return (
    <div className="overflow-hidden rounded-[10px] border border-x-border">
      {rows.map((h) => {
        const sug = h ? suggestTaskCost(optionFor(h)?.pricing, type) : null;
        const raw = shown(h);
        const invalid = raw.trim() !== '' && parseAmount(raw) === null;
        return (
          <div key={h || '__none'} className="grid h-12 grid-cols-[1fr_150px_1fr] items-center gap-3 border-t border-x-border px-3.5 first:border-t-0">
            <span className="flex items-center gap-2 truncate">
              {h ? <><span aria-hidden className="inline-block h-6 w-6 shrink-0 rounded-full bg-x-border" />@{h}</> : <span className="text-x-secondary">미배정</span>}
            </span>
            <label className={`flex h-9 items-center gap-1.5 rounded-lg border bg-white px-2.5 tabular-nums ${raw === '' ? 'border-dashed border-x-border-strong text-x-muted' : 'border-x-border-strong'} ${invalid ? 'border-red-400' : ''}`}>
              {currency === 'JPY' ? '¥' : '₩'}
              <input inputMode="numeric" value={raw} onChange={(e) => commit(h, e.target.value)} placeholder="금액" aria-label={`${h ? `@${h}` : '미배정'} 비용`}
                     // 손을 떼면 이 칸도 부모 값으로 돌아간다 — 저장되지 않은 글자(잘못 친 값)가 남아 있지 않게
                     onBlur={() => setEditing((cur) => (cur && cur.handle === h ? null : cur))}
                     className="w-full bg-transparent text-content outline-none placeholder:text-x-muted" />
            </label>
            <span className={`truncate text-ui ${sug ? 'text-x-muted' : 'text-amber-700'}`}>
              {sug ? `단가 ${TASK_TYPE_LABEL[type]} ${formatAmount(sug.amount, sug.currency)}` : h ? `명부에 ${TASK_TYPE_LABEL[type]} 단가 없음 — 비워두면 비용 없이 만들어요` : '비워두면 비용 없이 만들어요'}
            </span>
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
