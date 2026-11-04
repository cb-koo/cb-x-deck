'use client';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { ClientRow } from '@/lib/clientStore';
import type { CampaignRow } from '@/lib/campaignStore';
import { createCampaignsBulkApi } from '@/lib/campaignApi';
import { checkPeriod } from '@/lib/campaignInput';
import { formatDateKo } from '@/lib/campaignJudgment';
import { bulkSuggestion, defaultPreset, hasSamePeriod, presetRange, BULK_EMPTY_MESSAGE, BULK_PERIOD_MESSAGE, type PeriodPreset } from '@/lib/campaignBulk';
import { Button } from '@/components/ui';

// 새 캠페인 › 여러 곳 한 번에(ISSUE-006, koo 11-04) — 기간 하나 + 클라이언트 여러 곳. 기간은 [이번 주][다음 주][기간 지정],
// 기본은 월요일이면 이번 주·그 외엔 다음 주(defaultPreset). 클라이언트는 전부 골라진 채로 시작하고 필요한 곳만 뺀다(koo 결정).
// 같은 기간 캠페인이 이미 있는 곳은 회색으로 빼 둔다 — 서버도 같은 판정(hasSamePeriod)으로 거절한다.
// 한 줄 = 클라이언트 하나(koo 표 선호) — 체크, 클라이언트, 만들어질 이름, 영문 코드. 이름은 만든 뒤 각 캠페인에서 고친다.
const INPUT = 'mt-0.5 h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue';
const HELP = 'mt-1 text-ui text-x-muted';
const chip = (on: boolean) => `h-9 rounded-full border px-3.5 text-ui ${on ? 'border-x-blue bg-x-blue/10 font-semibold text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`;

export function CampaignBulkForm({ today, clients, onClose, onCreated }: {
  today: string; clients: ClientRow[];
  onClose: () => void; onCreated: (rows: CampaignRow[]) => void;
}) {
  const [preset, setPreset] = useState<PeriodPreset>(() => defaultPreset(today));
  const initial = useMemo(() => presetRange(today, defaultPreset(today)), [today]);
  const [customStart, setCustomStart] = useState<string>(initial.startsOn);
  const [customEnd, setCustomEnd] = useState<string>(initial.endsOn);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());   // 사람이 뺀 곳 — 기본은 전부 고름
  const [existing, setExisting] = useState<CampaignRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // 같은 기간 캠페인 판정용 목록 — 실패해도 만들 수는 있다(서버가 같은 판정으로 막는다)
  useEffect(() => {
    apiFetch('/api/campaigns').then((r) => (r.ok ? r.json() : Promise.reject(new Error('load failed'))))
      .then((rows: CampaignRow[]) => setExisting(Array.isArray(rows) ? rows : []))
      .catch(() => setExisting([]));
  }, []);

  const range = preset === 'custom' ? { startsOn: customStart, endsOn: customEnd } : presetRange(today, preset);
  const periodErr = !range.startsOn || !range.endsOn ? BULK_PERIOD_MESSAGE : checkPeriod(range.startsOn, range.endsOn);
  const rows = clients.map((c) => {
    const taken = !periodErr && existing ? hasSamePeriod(existing, c.id, range.startsOn, range.endsOn) : false;
    return { c, taken, on: !taken && !excluded.has(c.id), s: bulkSuggestion(c, range.startsOn) };
  });
  const chosen = rows.filter((r) => r.on);
  const reason = periodErr ?? (chosen.length === 0 ? BULK_EMPTY_MESSAGE : '');
  const canSubmit = !reason && !busy && existing !== null;

  function toggle(id: string) {
    setExcluded((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setErr('');
    const r = await createCampaignsBulkApi({ clientIds: chosen.map((x) => x.c.id), startsOn: range.startsOn, endsOn: range.endsOn });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onCreated(r.data);
  }

  const periodLabel = !periodErr ? `${formatDateKo(range.startsOn)} ~ ${formatDateKo(range.endsOn)}` : '';
  return (
    <>
      <p className="mt-3 text-ui text-x-secondary">기간</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <button type="button" aria-pressed={preset === 'this'} onClick={() => setPreset('this')} className={chip(preset === 'this')}>이번 주</button>
        <button type="button" aria-pressed={preset === 'next'} onClick={() => setPreset('next')} className={chip(preset === 'next')}>다음 주</button>
        <button type="button" aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')} className={chip(preset === 'custom')}>기간 지정</button>
        {preset !== 'custom' && periodLabel && <span className="ml-1 text-content">{periodLabel}</span>}
      </div>
      {preset === 'custom' && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block text-ui text-x-secondary">시작일
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className={INPUT} />
          </label>
          <label className="block text-ui text-x-secondary">종료일
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className={INPUT} />
          </label>
        </div>
      )}
      {periodErr && <p className="mt-1 text-ui text-red-600">{periodErr}</p>}

      <div className="mt-4 flex items-baseline">
        <p className="text-ui text-x-secondary">클라이언트</p>
        <span className="ml-auto text-ui text-x-muted">{chosen.length}곳 골랐어요</span>
      </div>
      <ul className="mt-1 max-h-[340px] overflow-y-auto rounded-md border border-x-border">
        {rows.map(({ c, taken, on, s }) => (
          <li key={c.id} className="border-b border-x-border last:border-b-0">
            <label className={`flex h-11 items-center gap-2.5 px-3 ${taken ? 'cursor-default' : 'cursor-pointer hover:bg-x-hover'}`}>
              <input type="checkbox" checked={on} disabled={taken} onChange={() => toggle(c.id)} className="h-4 w-4 shrink-0" />
              <span className={`w-[130px] shrink-0 truncate text-content ${taken ? 'text-x-muted' : ''}`}>{c.name}</span>
              {taken
                ? <span className="truncate text-ui text-x-muted">이 기간 캠페인 있음</span>
                : <>
                    <span className="min-w-0 flex-1 truncate text-ui text-x-secondary">{s.name}</span>
                    <span className="max-w-[170px] shrink-0 truncate font-mono text-ui text-x-muted">{s.nameEn}</span>
                  </>}
            </label>
          </li>
        ))}
      </ul>
      <p className={HELP}>이름과 영문 코드는 자동으로 붙어요. 고칠 게 있으면 만든 뒤 각 캠페인에서 고쳐요.</p>

      {err && <p role="alert" className="mt-2 text-ui text-red-600">{err}</p>}
      <div className="mt-4 flex items-center justify-end gap-3">
        <Button type="button" onClick={onClose} disabled={busy} className="h-10 px-4 text-content">취소</Button>
        <Button type="button" variant="primary" onClick={() => void submit()} disabled={!canSubmit} className="h-10 px-4 text-content">
          {busy ? '만드는 중…' : `캠페인 ${chosen.length}개 만들기`}
        </Button>
      </div>
      {!canSubmit && !busy && reason && <p className="mt-1.5 text-ui text-x-muted">{reason}</p>}
    </>
  );
}
