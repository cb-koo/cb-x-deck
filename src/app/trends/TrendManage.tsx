// 검색 트렌드 관리 — 상세 패널 안에서 시술을 고치고(수정·숨기기), 검색어 태그를 점검한다. 시술 추가도 같은 양식(스펙 2026-10-13 §7, koo 10-14 시안 A).
// 일본어 검색어를 바꾸거나 시술을 더하면 그 시술만 바로 다시 수집한다(약 5초) — 키워드 플래너는 무료라 따로 확인을 묻지 않는다.
'use client';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui';
import { CATEGORIES } from '@/lib/procedureTaxonomy';
import { INTENT_LABEL, type Intent } from '@/lib/searchIntent';
import { fmtVolume } from '@/lib/searchTrend';

const INPUT = 'h-9 w-full rounded-lg border border-x-border-strong bg-white px-3 text-[15px] focus:border-x-blue focus:outline-none';
const LABEL = 'mb-1 block text-ui font-medium text-x-secondary';

export interface ProcedureFormValue {
  name: string; category: string; sub: string; hidden: boolean;
  members: Array<{ id: string | null; kr: string; jp: string; en: string }>;  // 묶음의 행마다(새 시술이면 id null 한 줄)
}

// 시술 양식 — [수정]과 [+ 시술 추가]가 같이 쓴다. 이름·분류·숨기기는 묶음 전체, 한국어 이름·일본어 검색어는 행마다.
export function ProcedureForm({ initial, mode, onCancel, onSaved }: {
  initial: ProcedureFormValue; mode: 'edit' | 'add'; onCancel: () => void; onSaved: (id: string) => Promise<void> | void;
}) {
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jpChanged = mode === 'edit' && v.members.some((m, i) => m.jp.trim() !== initial.members[i].jp);
  const set = (p: Partial<ProcedureFormValue>) => setV({ ...v, ...p });
  const setMember = (i: number, p: Partial<ProcedureFormValue['members'][number]>) => set({ members: v.members.map((m, k) => (k === i ? { ...m, ...p } : m)) });

  async function save() {
    setSaving(true); setError(null);
    try {
      if (mode === 'add') {
        const m = v.members[0];
        const r = await fetch('/api/trends/procedures', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: v.name, category: v.category, sub: v.sub, kr: m.kr, jp: m.jp, en: m.en }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error ?? '추가하지 못했어요');
        await onSaved(j.id);
      } else {
        for (const [i, m] of v.members.entries()) {
          const before = initial.members[i];
          const r = await fetch(`/api/trends/procedures/${m.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: v.name, category: v.category, sub: v.sub, hidden: v.hidden,
              kr: m.kr !== before.kr ? m.kr : undefined, jp: m.jp !== before.jp ? m.jp : undefined, en: m.en !== before.en ? m.en : undefined }) });
          const j = await r.json(); if (!r.ok) throw new Error(j.error ?? '저장하지 못했어요');
        }
        await onSaved(v.members[0].id!);
      }
    } catch (e) { setError((e as Error).message); setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2"><span className={LABEL}>시술명 <span className="font-normal text-x-muted">· 화면에 보이는 이름</span></span>
          <input className={INPUT} value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 리투오" /></label>
        <label><span className={LABEL}>분류</span>
          <select className={INPUT} value={v.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">고르기</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <label><span className={LABEL}>세부 분류 <span className="font-normal text-x-muted">· 비우면 시술명</span></span>
          <input className={INPUT} value={v.sub} onChange={(e) => set({ sub: e.target.value })} placeholder="예: PLA" /></label>
      </div>
      {v.members.map((m, i) => (
        <div key={m.id ?? i} className="grid grid-cols-2 gap-3 rounded-lg bg-x-surface p-3">
          <label><span className={LABEL}>일본어 검색어{v.members.length > 1 && ` ${i + 1}`}</span>
            <input className={INPUT} value={m.jp} onChange={(e) => setMember(i, { jp: e.target.value })} placeholder="예: リトゥオ" /></label>
          <label><span className={LABEL}>한국어 이름</span>
            <input className={INPUT} value={m.kr} onChange={(e) => setMember(i, { kr: e.target.value })} placeholder="예: 리투오" /></label>
        </div>
      ))}
      <p className="text-ui text-x-muted">
        {mode === 'add' ? '추가하면 이 일본어 검색어로 4년치 검색량·연관 검색어를 바로 받아 와요(약 5초).'
          : jpChanged ? '일본어 검색어를 바꾸면 그 시술만 바로 다시 받아 와요(약 5초).' : '일본 사람이 실제로 검색하는 표기여야 숫자가 나와요.'}
      </p>
      {mode === 'edit' && (
        <label className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" checked={v.hidden} onChange={(e) => set({ hidden: e.target.checked })} />
          숨기기 <span className="text-ui text-x-muted">· 목록·지도에서 빼요(데이터는 남아 있어 다시 켤 수 있어요)</span>
        </label>
      )}
      {error && <p className="text-ui text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} disabled={saving}>취소</Button>
        <Button variant="primary" onClick={save} disabled={saving || !v.name.trim() || !v.category || v.members.some((m) => !m.jp.trim())}>
          {saving ? (mode === 'add' || jpChanged ? '받아 오는 중…' : '저장 중…') : mode === 'add' ? '추가하고 받아 오기' : '저장'}
        </Button>
      </div>
    </div>
  );
}

type Kw = { id: string; text: string; ko: string | null; source: string; intent: Intent; override: Intent | null; avg12: number | null };
const INTENTS = Object.keys(INTENT_LABEL) as Intent[];
const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'other', label: '기타' },
  { key: 'override', label: '직접 고친 것' },
] as const;
const PAGE = 60;

// 검색어 점검 — 묶음의 검색어 전부(월평균 큰 순)와 태그. 태그를 바꾸면 그 검색어는 규칙 대신 고친 태그로 센다.
export function KeywordReview({ ids, onChanged }: { ids: string[]; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Kw[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  // 다른 묶음을 열면 상세 패널이 key로 새로 그려 처음 상태가 된다. 검색어는 펼칠 때 받아 온다.
  const fetchRows = () => fetch(`/api/trends/keywords?ids=${encodeURIComponent(ids.join(','))}`, { cache: 'no-store' })
    .then((r) => r.json()).then(setRows).catch(() => setRows([]));
  const toggle = () => { if (!open && !rows) void fetchRows(); setOpen(!open); };
  const shown = useMemo(() => (rows ?? []).filter((r) => filter === 'all' || (filter === 'other' ? r.intent === 'other' : r.override !== null)), [rows, filter]);

  async function change(k: Kw, value: string) {
    const intent = value === 'auto' ? null : (value as Intent);
    setBusy(k.id);
    const r = await fetch(`/api/trends/keywords/${k.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent }) });
    if (r.ok) {
      await fetchRows();  // 규칙대로 되돌리면 태그가 무엇이 되는지 서버가 다시 알려 준다
      await onChanged();
    }
    setBusy(null);
  }

  return (
    <div>
      <button onClick={toggle} className="flex w-full items-center gap-2 text-left">
        <span className="text-ui font-semibold text-x-secondary">검색어 점검</span>
        <span className="text-ui text-x-muted">· 태그가 틀린 검색어를 고치면 검색량·의도 비중에 바로 반영돼요</span>
        <span className="ml-auto text-ui text-x-secondary">{open ? '접기 ▴' : '열기 ▾'}</span>
      </button>
      {open && (
        <div className="mt-2">
          <div className="mb-2 flex items-center gap-1.5">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => { setFilter(f.key); setLimit(PAGE); }}
                      className={`rounded-full border px-3 py-1 text-ui ${filter === f.key ? 'border-x-text bg-x-text text-white' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
                {f.label} <span className="tabular-nums opacity-70">{(rows ?? []).filter((r) => f.key === 'all' || (f.key === 'other' ? r.intent === 'other' : r.override !== null)).length}</span>
              </button>
            ))}
          </div>
          {!rows ? <p className="py-4 text-ui text-x-muted">불러오는 중…</p> : (
            <div className="overflow-hidden rounded-lg border border-x-border">
              <table className="w-full border-collapse text-[15px]">
                <thead><tr className="border-b border-x-border text-left text-ui text-x-muted">
                  <th className="w-[72px] px-3 py-2 text-right font-medium">월평균</th><th className="px-3 py-2 font-medium">검색어</th><th className="w-[150px] px-3 py-2 font-medium">태그</th>
                </tr></thead>
                <tbody>
                  {shown.slice(0, limit).map((k) => (
                    <tr key={k.id} className="border-t border-x-border/60">
                      <td className="px-3 py-1.5 text-right tabular-nums text-x-secondary">{k.avg12 === null ? <span className="text-ui text-x-muted">값 없음</span> : fmtVolume(k.avg12)}</td>
                      <td className="max-w-0 truncate px-3 py-1.5" title={k.ko ? `${k.ko} · ${k.text}` : k.text}>
                        {k.text}{k.ko && <span className="ml-2 text-ui text-x-muted">{k.ko}</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <select value={k.override ?? 'auto'} disabled={busy === k.id} onChange={(e) => change(k, e.target.value)}
                                className={`h-8 w-full rounded-md border px-2 text-ui ${k.override ? 'border-x-blue text-x-blue-text' : 'border-x-border-strong'}`}>
                          <option value="auto">{k.override ? '규칙대로 되돌리기' : `규칙대로 (${INTENT_LABEL[k.intent]})`}</option>
                          {INTENTS.map((i) => <option key={i} value={i}>{INTENT_LABEL[i]}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > limit && (
                <button onClick={() => setLimit(limit + PAGE)} className="w-full border-t border-x-border py-2 text-ui text-x-secondary hover:bg-x-hover">
                  {shown.length - limit}개 더 보기
                </button>
              )}
              {shown.length === 0 && <p className="py-4 text-center text-ui text-x-muted">해당하는 검색어가 없어요</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
