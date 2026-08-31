'use client';
import { useEffect, useState } from 'react';
import { Button, PANEL, PANEL_TITLE } from '@/components/ui';
import { useToast } from '@/lib/toastContext';
import { fetchSettlementSettings, saveSettlementSettingsApi, fetchExternalLog } from '@/lib/settlementApi';
import { sanitizeSettlementSettings, type SettlementSettings, type SettlementCategory } from '@/lib/settlementSettings';
import type { SettlementVersionRow } from '@/lib/settlementStore';
import { TASK_TYPES, TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';
import { kstMonthDay, kstDateTime } from '@/lib/datetime';
import { describeExternalCall, type ExternalLogRow } from '@/lib/externalLogCopy';

const TONE_CLASS: Record<'ok' | 'warn' | 'bad', string> = { ok: '', warn: 'text-amber-700', bad: 'text-red-700' };

const FIELD = 'rounded-lg border border-x-border bg-white px-2 py-1 text-ui w-full';

export function SettingsTab() {
  const { show } = useToast();
  const [s, setS] = useState<SettlementSettings | null>(null);
  const [versions, setVersions] = useState<SettlementVersionRow[]>([]);
  const [log, setLog] = useState<ExternalLogRow[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { (async () => {
    const r = await fetchSettlementSettings();
    if (!r.ok) { setErr(r.error); return; }
    setS(r.data.settings); setVersions(r.data.versions);
  })(); }, []);

  useEffect(() => { (async () => {
    const r = await fetchExternalLog();
    if (r.ok) setLog(r.data.rows);
  })(); }, []);

  if (err && !s) return <p role="alert" className="text-ui text-red-700">{err}</p>;
  if (!s) return <p className="text-ui text-x-muted">불러오는 중…</p>;

  const patchCat = (id: string, p: Partial<SettlementCategory>) => setS({ ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  // 한 유형은 한 분류에만 — 다른 분류에 있던 체크는 자동 해제(§4-3)
  const toggleDefault = (id: string, t: TaskType, on: boolean) => setS({
    ...s, categories: s.categories.map((c) => c.id === id
      ? { ...c, defaultFor: on ? [...c.defaultFor.filter((x) => x !== t), t] : c.defaultFor.filter((x) => x !== t) }
      : { ...c, defaultFor: on ? c.defaultFor.filter((x) => x !== t) : c.defaultFor }),
  });
  const add = () => setS({ ...s, categories: [...s.categories, { id: crypto.randomUUID(), label: '', sendAs: '', hidden: false, defaultFor: [] }] });

  async function save() {
    const clean = sanitizeSettlementSettings(s);
    if (typeof clean === 'string') { setErr(clean); return; }
    setBusy(true);
    const r = await saveSettlementSettingsApi(clean);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setErr(''); setS(r.data.settings); show('설정을 저장했어요');
    const v = await fetchSettlementSettings(); if (v.ok) setVersions(v.data.versions);
  }

  return (
    <div className="space-y-5">
      <section className={PANEL}>
        <h2 className={PANEL_TITLE}>분류</h2>
        <p className="mt-1 text-ui text-x-muted">요청의 &apos;분류&apos; 칸에 고를 수 있는 목록이에요. 숨기면 새 요청에서만 사라지고, 이미 만든 요청은 그대로예요.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-ui">
            <thead className="text-left text-x-secondary">
              <tr><th className="py-2 pr-3">표시명</th><th className="py-2 pr-3">정산 쪽 이름</th><th className="py-2 pr-3">기본값으로 쓰는 유형</th><th className="py-2 pr-3">숨김</th></tr>
            </thead>
            <tbody>
              {s.categories.map((c) => (
                <tr key={c.id} className={`border-t border-x-border ${c.hidden ? 'text-x-muted' : ''}`}>
                  <td className="py-2 pr-3 min-w-[180px]"><input className={FIELD} value={c.label} onChange={(e) => patchCat(c.id, { label: e.target.value })} aria-label="표시명" /></td>
                  <td className="py-2 pr-3 min-w-[280px]"><input className={FIELD} value={c.sendAs} onChange={(e) => patchCat(c.id, { sendAs: e.target.value })} aria-label="정산 쪽 이름" /></td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {TASK_TYPES.map((t) => (
                      <label key={t} className="mr-3 inline-flex items-center gap-1">
                        <input type="checkbox" checked={c.defaultFor.includes(t)} onChange={(e) => toggleDefault(c.id, t, e.target.checked)} />{TASK_TYPE_LABEL[t]}
                      </label>
                    ))}
                  </td>
                  <td className="py-2 pr-3"><input type="checkbox" checked={c.hidden} onChange={(e) => patchCat(c.id, { hidden: e.target.checked })} aria-label="숨김" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button className="mt-3" onClick={add}>+ 분류 추가</Button>
        <p className="mt-2 text-ui text-x-muted">인용RT는 기본값을 비워 두면 담당자가 마지막에 고른 분류로 미리 채워져요.</p>
      </section>
      <section className={PANEL}>
        <h2 className={PANEL_TITLE}>환율</h2>
        <label className="mt-2 flex items-center gap-2 text-ui">
          <input type="number" min={1} step={1} className="w-24 rounded-lg border border-x-border px-2 py-1 text-ui tabular-nums" value={s.rateKrwPerJpy}
                 onChange={(e) => setS({ ...s, rateKrwPerJpy: Number(e.target.value) })} aria-label="환율" />
          원 = 1엔
        </label>
        <p className="mt-2 text-ui text-x-muted">바꿔도 이미 만든 요청은 안 바뀌어요 — 만든 시점 값이 저장돼 있어요.</p>
      </section>
      <section className={PANEL}>
        <h2 className={PANEL_TITLE}>연동 기록</h2>
        <p className="mt-1 text-ui text-x-muted">정산 프로덕트가 우리 서버를 호출한 기록이에요. &quot;보냈는데 안 보인다&quot;는 상황이 생기면 여기서 확인해요.</p>
        {log.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-ui">
              <thead className="text-left text-x-secondary">
                <tr><th className="py-2 pr-3">시각</th><th className="py-2 pr-3">내용</th><th className="py-2 pr-3">응답</th></tr>
              </thead>
              <tbody>
                {log.map((row) => {
                  const d = describeExternalCall(row);
                  return (
                    <tr key={row.id} className="border-t border-x-border">
                      <td className="py-2 pr-3 whitespace-nowrap">{kstDateTime(row.at)}</td>
                      <td className={`py-2 pr-3 ${TONE_CLASS[d.tone]}`}>{d.line}</td>
                      <td className="py-2 pr-3 text-ui text-x-muted tabular-nums">{row.statusCode}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-ui text-x-muted">아직 정산 프로덕트가 호출한 기록이 없어요.</p>
        )}
      </section>
      {err && <p role="alert" className="text-ui text-red-700">{err}</p>}
      <div className="flex items-center justify-between">
        <span className="text-ui text-x-muted">최근 변경: {versions.length ? versions.map((v) => `${kstMonthDay(v.createdAt)} ${v.memberName ?? '—'}`).join(' · ') : '없음'}</span>
        <Button variant="primary" onClick={save} disabled={busy}>{busy ? '저장 중…' : '저장'}</Button>
      </div>
    </div>
  );
}
