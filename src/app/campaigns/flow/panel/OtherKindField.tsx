'use client';
import { createContext, useId, useState } from 'react';
import { fetchOtherKinds } from '@/lib/campaignApi';
import { OTHER_KIND_MAX } from '@/lib/campaignJudgment';
import { canonicalOtherKind, filterOtherKinds, normalizeOtherKind } from '@/lib/otherTask';

// 기타 협찬(088)의 '무엇을 했는지' 한 줄 + 전에 쓴 말 추천(koo 11-06 결정 2). 새 작업 폼과 작업 패널이 같이 쓴다.
// 추천은 칸에 들어왔을 때 한 번 읽는다(작업에서 모은 목록 — 비용 없는 DB 조회). 많이 쓴 순, 입력 글자로 거른다.
// 띄어쓰기·대소문자만 다른 말을 치면 전에 쓴 말로 맞춘다('구글맵리뷰' → '구글맵 리뷰') — 이름이 흩어지지 않게(나중에 옮길 때 기준).
// onCommit: 칸을 벗어나거나 Enter·추천 클릭 때 정리된 값으로 한 번. onChange(선택): 칠 때마다(새 작업 폼은 이걸로 값을 들고 있는다).
let cache: Array<{ kind: string; count: number }> | null = null;

// 작업 패널의 '무엇을 했는지' 칸에 지금 적혀 있는 글자(저장 전 포함) — 같은 패널 안의 완료 칸(OtherDoneBox)이 읽어
// 입력 중에도 [완료 확인]을 켠다(koo 11-06 결함: 칸 밖을 눌러야 켜졌다). 완료 칸은 FlowDetail이 만든 슬롯이지만
// TaskPanel 안에서 그려지므로 TaskPanel이 감싼 이 Provider의 값을 받는다. null = 칸을 건드리지 않음(저장된 값 그대로).
export const OtherKindDraftContext = createContext<string | null>(null);

export function OtherKindField({ value, onCommit, onChange, disabled = false, autoFocus = false }: {
  value: string;
  onCommit: (next: string) => void;
  onChange?: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [buf, setBuf] = useState(value);
  const [open, setOpen] = useState(false);
  const [known, setKnown] = useState(cache ?? []);
  const listId = useId();
  // 바깥 값이 바뀌면(저장·롤백·다른 작업) 칸을 맞춘다 — 렌더 중 맞추기(이펙트의 연쇄 렌더 대신, React 권장 패턴)
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setBuf(value); }

  async function load() {
    if (cache) { setKnown(cache); return; }
    const r = await fetchOtherKinds();
    if (r.ok) { cache = r.data; setKnown(r.data); }
  }
  function commit(raw: string) {
    let v = normalizeOtherKind(raw);
    v = canonicalOtherKind(v, known.map((k) => k.kind)) ?? v;
    setBuf(v); onChange?.(v); setOpen(false);
    if (v !== value) {
      onCommit(v);
      // 새로 쓴 말은 다음 추천에 바로 보이게(다시 읽지 않고 앞에 하나 얹는다)
      if (v && cache && !cache.some((k) => k.kind === v)) cache = [{ kind: v, count: 1 }, ...cache];
    }
  }
  const items = filterOtherKinds(buf, known).filter((k) => k.kind !== buf.trim()).slice(0, 6);

  return (
    <div className="relative">
      <input value={buf} disabled={disabled} autoFocus={autoFocus} maxLength={OTHER_KIND_MAX}
             onFocus={() => { setOpen(true); void load(); }}
             onChange={(e) => { setBuf(e.target.value); onChange?.(e.target.value); setOpen(true); }}
             onBlur={() => commit(buf)}
             onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur(); if (e.key === 'Escape') setOpen(false); }}
             placeholder="예: 구글맵 리뷰, 상담회 참석" aria-label="작업 내용" aria-autocomplete="list" aria-controls={listId}
             className="h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue disabled:bg-x-hover disabled:text-x-muted" />
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" aria-label="전에 쓴 작업 내용"
            className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-x-border-strong bg-white py-1 shadow-sm">
          {items.map((k) => (
            <li key={k.kind} role="option" aria-selected={false}
                onMouseDown={(e) => e.preventDefault()} onClick={() => commit(k.kind)}
                className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-content hover:bg-x-hover">
              <span className="truncate">{k.kind}</span>
              <span className="shrink-0 text-ui text-x-muted">{k.count}건</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-ui text-x-muted">같은 작업이면 목록에서 전에 쓴 이름을 골라 주세요. 이름이 똑같아야 나중에 작업 내용별로 모아 볼 수 있어요.</p>
    </div>
  );
}
