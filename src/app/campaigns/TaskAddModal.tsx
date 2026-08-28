'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { DraftRow } from '@/lib/draftStore';
import { createTasksApi, fetchTasksTargets, type TaskCreateRequest } from '@/lib/campaignApi';
import { suggestTaskCost, type Currency, type TaskCost } from '@/lib/campaignCost';
import { TASK_TYPES, TASK_TYPE_LABEL, TARGETING_TYPES, isDateOnlyString, type TaskType } from '@/lib/campaignJudgment';
import { InfluencerField } from '@/components/InfluencerField';
import { parseXHandle } from '@/lib/xHandle';
import { draftLabel } from '@/lib/draftViews';
import { Button } from '@/components/ui';
import { TargetPicker, type TargetValue, candidateLabel } from './TargetPicker';
import { CostRows, type RowDates } from './CostRows';
import { AttachDraftModal } from './AttachDraftModal';

// [+ 작업 추가](스펙 §4-2, 시안 task-add-v3) — 한 창에서 유형을 바꾸면 칸이 바뀐다(입력한 인플·예정일은 유지).
// RT·인용RT: 유형 → 대상 → 인플(여러 명) → (인용RT: 원고) → 사람별 줄(금액·날짜) → 메모 / 투고·방문협찬: 유형 → 인플 → 원고 → 사람별 줄 → 메모.
// 여러 명 = 사람 수만큼 작업. 0명 = 미배정 1개. 원고는 0~1명일 때만.
//
// 날짜는 사람별 줄에서 받는다(koo QA) — 인플마다 올리는 날이 다른 게 실무인데, 창 위 한 칸이면 N명에게 같은
// 날이 들어간다. 위의 '(전체)' 칸은 [모두에게 적용]을 눌렀을 때만 줄에 퍼진다 — 치는 대로 자동으로 퍼지면
// 사람이 줄에서 고쳐 둔 날짜를 조용히 덮는다.
type DraftChoice = { kind: 'none' } | { kind: 'existing'; draft: DraftRow } | { kind: 'new' };
const EMPTY_DATES: RowDates = { scheduledOn: '', visitOn: '' };

// 비용 블록의 통화는 하나(통화 select도 하나) — 명부 단가 통화가 블록 통화와 다르면 금액을 그 통화로 '바꿔 넣지'
// 않는다(금액을 조작하는 셈이라 위험 — 결정 로그 참조). 그 사람 줄은 비워 두고 근거에 원래 단가·통화를 보여준다.
// 통화가 같을 때만 그대로 쓴다.
const suggestForRow = (pricing: Parameters<typeof suggestTaskCost>[0], type: TaskType, currency: Currency): TaskCost | null => {
  const sug = suggestTaskCost(pricing, type);
  return sug && sug.currency === currency ? sug : null;
};

export function TaskAddModal({ campaign, influencerOptions, onClose, onCreated }: {
  campaign: CampaignRow; influencerOptions: InfluencerOption[]; onClose: () => void;
  onCreated: (created: { count: number; firstTaskId: string; goToGenerate: boolean }) => void;
}) {
  const [type, setType] = useState<TaskType>('post');
  const [target, setTarget] = useState<TargetValue>(null);
  const [targeting, setTargeting] = useState<string[]>([]);
  const [handles, setHandles] = useState<string[]>([]);
  const [handleInput, setHandleInput] = useState('');
  const [handleErr, setHandleErr] = useState<string | null>(null);
  const [costs, setCosts] = useState<Record<string, TaskCost | null>>({});
  // 비용 블록의 통화 — 모달 전체 상태(CostRows의 로컬 state였다가 여기로 옮김, 유형이 바뀌어도 안 사라지게).
  const [currency, setCurrency] = useState<Currency>('JPY');
  const [draft, setDraft] = useState<DraftChoice>({ kind: 'none' });
  const [attachOpen, setAttachOpen] = useState(false);
  const [scheduledOn, setScheduledOn] = useState('');
  const [visitOn, setVisitOn] = useState('');
  const [dates, setDates] = useState<Record<string, RowDates>>({});   // 사람별 날짜 — key는 핸들, 미배정은 ''
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const hasTarget = TARGETING_TYPES.includes(type);
  const hasDraft = type !== 'rt';
  const optionFor = useCallback((h: string) => influencerOptions.find((o) => o.handle.toLowerCase() === h.toLowerCase()), [influencerOptions]);
  const changeCost = useCallback((h: string, next: TaskCost | null) => setCosts((cur) => ({ ...cur, [h]: next })), []);
  const changeDate = useCallback((h: string, patch: Partial<RowDates>) =>
    setDates((cur) => ({ ...cur, [h]: { ...(cur[h] ?? EMPTY_DATES), ...patch } })), []);
  const rowKeys = handles.length ? handles : [''];
  // [모두에게 적용] — 누른 그 순간에만 모든 줄에 같은 날짜를 넣는다(빈 줄만이 아니라 전부, 눌렀으니 그게 뜻이다)
  function applyDateToAll(kind: keyof RowDates, value: string) {
    if (!value) return;
    setDates((cur) => {
      const out = { ...cur };
      for (const h of rowKeys) out[h] = { ...(out[h] ?? EMPTY_DATES), [kind]: value };
      return out;
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy && !attachOpen) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy, attachOpen]);

  // 유형이 바뀌면 비용 제안도 그 유형 단가로 — 사람이 고친 값(직전 유형의 제안과 다른 값)과 사람이 지운 칸은 덮지 않는다.
  // 유형은 세그먼트 버튼에서만 바뀌므로 여기서 처리한다(effect + 직전 유형 ref보다 읽기 쉽고, 인플을 더할 때
  // 사람이 지운 금액이 되살아나는 일도 없다).
  function changeType(next: TaskType) {
    if (next === type) return;
    setCosts((cur) => {
      const out = { ...cur };
      for (const h of Object.keys(cur)) {
        if (!h) continue;   // 미배정 줄엔 명부 단가가 없다
        const was = cur[h];
        if (was == null) continue;   // 지운 칸(통화가 달라 비운 칸 포함)은 지운 대로 — 유형을 바꿨다고 되살아나면 안 된다
        const pricing = optionFor(h)?.pricing;
        if (JSON.stringify(was) !== JSON.stringify(suggestForRow(pricing, type, currency))) continue;   // 사람이 고친 값
        out[h] = suggestForRow(pricing, next, currency);
      }
      return out;
    });
    if (next === 'rt') setDraft({ kind: 'none' });   // RT엔 원고 칸이 없다 — 골라 둔 원고가 몰래 따라가면 안 된다
    if (!TARGETING_TYPES.includes(next)) setTargeting([]);   // 대상 칸이 사라지면 '이미 있음' 주황 표시도 근거를 잃는다
    setType(next);
  }

  function addHandle(raw: string) {
    const p = parseXHandle(raw);
    if (!p.ok) { setHandleErr('핸들 형식이 아니에요 — 영문·숫자·_ 1~15자'); return; }
    if (handles.some((h) => h.toLowerCase() === p.handle.toLowerCase())) { setHandleInput(''); return; }
    const pricing = optionFor(p.handle)?.pricing;
    const sug = suggestTaskCost(pricing, type);
    // 블록 통화는 여기서 절대 건드리지 않는다 — 첫 인플의 단가 통화로 슬쩍 바뀌면, 그다음 사람 단가가
    // 거꾸로 안 맞아 비게 되는 걸 사람이 왜 그런지 모른 채 보게 된다(Fix report 2 추적: @a(₩) 다음 @b(¥)
    // 순서에서 이게 실제로 어긋난다는 걸 확인했다). 통화는 오직 통화 select(명시적 행동)로만 바뀐다.
    setHandles((cur) => [...cur, p.handle]);
    setCosts((cur) => ({ ...cur, [p.handle]: sug && sug.currency === currency ? sug : null }));
    setHandleInput(''); setHandleErr(null);
  }
  const removeHandle = (h: string) => {
    setHandles((cur) => cur.filter((x) => x !== h));
    setCosts((cur) => { const out = { ...cur }; delete out[h]; return out; });
    setDates((cur) => { const out = { ...cur }; delete out[h]; return out; });
  };
  // 통화를 바꾸는 건 명시적 사용자 행동 — 이때는 금액을 그대로 두고 통화만 새로 붙인다(도움말이 이미 그렇게 말한다)
  function changeCurrency(c: Currency) {
    setCurrency(c);
    setCosts((cur) => {
      const out: Record<string, TaskCost | null> = {};
      for (const h of Object.keys(cur)) { const v = cur[h]; out[h] = v == null ? null : { amount: v.amount, currency: c }; }
      return out;
    });
  }
  const dup = useMemo(() => new Set(targeting.map((h) => h.toLowerCase())), [targeting]);
  const canAttachDraft = hasDraft && handles.length <= 1;

  // TargetPicker는 id만 돌려준다 — 접힌 카드에 보여줄 라벨·게시 여부는 후보 목록에서 다시 찾는다(한 번 더 조회, 50건 안에 있다)
  async function resolveTarget(next: { taskId: string } | { url: string } | null) {
    if (next === null) { setTarget(null); setTargeting([]); return; }
    if ('url' in next) { setTarget(next); return; }
    const r = await fetchTasksTargets({ clientId: campaign.clientId, all: true });
    const c = r.ok ? r.data.find((x) => x.taskId === next.taskId) : undefined;
    setTarget({ taskId: next.taskId, label: c ? candidateLabel(c) : '선택한 작업', sub: c && c.campaignId !== campaign.id ? c.campaignName : null, posted: !!c?.postedAt });
  }

  async function submit(goToGenerate: boolean) {
    if (busy) return;
    for (const h of rowKeys) {
      const d = dates[h] ?? EMPTY_DATES;
      const who = h ? `@${h}의 ` : '';
      if (d.scheduledOn && !isDateOnlyString(d.scheduledOn)) { setErr(`${who}게시 예정일 형식이 올바르지 않아요`); return; }
      if (type === 'visit' && d.visitOn && !isDateOnlyString(d.visitOn)) { setErr(`${who}방문일 형식이 올바르지 않아요`); return; }
    }
    if (!canAttachDraft && draft.kind !== 'none') { setErr('원고는 한 사람에게만 붙일 수 있어요 — 인플루언서를 한 명만 고르거나 원고를 빼 주세요'); return; }
    // 저장되는 날짜는 언제나 줄의 날짜다. 최상위 값은 미배정(0명) 한 줄일 때만 쓴다 — 서버가 그때 items 없이 1행을 만든다.
    const solo = dates[''] ?? EMPTY_DATES;
    const body: TaskCreateRequest = {
      type,
      ...(hasTarget && target ? ('taskId' in target ? { targetTaskId: target.taskId } : { targetTweetUrl: target.url }) : {}),
      ...(draft.kind === 'existing' ? { draftId: draft.draft.id } : {}),
      scheduledOn: handles.length === 0 ? solo.scheduledOn || null : null,
      visitOn: handles.length === 0 && type === 'visit' && solo.visitOn ? solo.visitOn : null,
      note,
      influencers: handles.map((h) => {
        const d = dates[h] ?? EMPTY_DATES;
        return { handle: h, cost: costs[h] ?? null, scheduledOn: d.scheduledOn || null, visitOn: type === 'visit' && d.visitOn ? d.visitOn : null };
      }),
      ...(handles.length === 0 ? { cost: costs[''] ?? null } : {}),
    };
    setBusy(true); setErr('');
    const r = await createTasksApi(campaign.id, body);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onCreated({ count: r.data.tasks.length, firstTaskId: r.data.tasks[0].id, goToGenerate });
  }

  const label = 'text-ui text-x-secondary';
  const input = 'mt-1.5 h-11 w-full rounded-[10px] border border-x-border-strong bg-white px-3 text-content outline-none focus:border-x-blue';
  const field = 'mt-4';
  const draftField = (
    <div className={field}>
      <p className={label}>원고 <span className="text-x-muted">우리가 써서 전달할 때</span></p>
      <div className="mt-1.5 flex flex-wrap items-center gap-4 text-content">
        {(['none', 'existing', 'new'] as const).map((k) => (
          <label key={k} className={`flex items-center gap-1.5 ${!canAttachDraft && k !== 'none' ? 'text-x-muted' : ''}`}>
            <input type="radio" name="draft" checked={draft.kind === k} disabled={!canAttachDraft && k !== 'none'}
                   onChange={() => { if (k === 'existing') setAttachOpen(true); else setDraft({ kind: k }); }} />
            {k === 'none' ? '없음 (인플루언서가 직접 씀)' : k === 'existing' ? '있는 원고 고르기' : '새로 만들기'}
          </label>
        ))}
      </div>
      {draft.kind === 'existing' && (
        <p className="mt-1.5 flex items-center gap-2 rounded-[10px] bg-x-surface px-3 py-2 text-content">
          <span className="min-w-0 flex-1 truncate">{draftLabel(draft.draft).text}</span>
          <button type="button" onClick={() => setAttachOpen(true)} className="text-ui text-x-secondary hover:underline">바꾸기</button>
        </p>
      )}
      <p className="mt-1 text-ui text-x-muted">{draft.kind === 'new' ? '만들기를 누르면 작업이 먼저 생기고 원고 생성 화면으로 가요 — 거기서 만든 원고가 이 작업에 붙어요' : !canAttachDraft ? '인플루언서가 여러 명이면 원고를 붙일 수 없어요' : ' '}</p>
    </div>
  );
  const influencerField = (
    <div className={field}>
      <p className={label}>인플루언서 <span className="text-x-muted">여러 명이면 사람 수만큼 작업이 생겨요</span></p>
      <div className="mt-1.5 flex min-h-11 flex-wrap items-center gap-2 rounded-[10px] border border-x-border-strong bg-white px-3 py-1.5">
        {handles.map((h) => (
          <span key={h} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-ui ${dup.has(h.toLowerCase()) ? 'bg-amber-100 text-amber-800' : 'bg-x-surface'}`}>
            <span aria-hidden className="inline-block h-5 w-5 rounded-full bg-x-border" />@{h}{dup.has(h.toLowerCase()) && ' · 이미 있음'}
            <button type="button" onClick={() => removeHandle(h)} aria-label={`@${h} 빼기`} className="text-x-muted hover:text-x-text">✕</button>
          </span>
        ))}
        <span className="min-w-[180px] flex-1">
          {/* 라벨·도움말은 이 칸 위 '인플루언서' 줄이 이미 말한다 — 칩 상자 안에서 두 번 말하지 않는다(오류 줄은 남긴다) */}
          <InfluencerField value={handleInput} options={influencerOptions} hideLabel hideHelp onChange={(v) => { setHandleInput(v); setHandleErr(null); }} error={handleErr} onEnter={(v) => { if (v.trim()) addHandle(v); }} />
        </span>
      </div>
      {targeting.length > 0 && hasTarget && <p className="mt-1.5 text-ui text-x-secondary">이 게시물을 이미 RT하기로 한 사람: {targeting.map((h) => `@${h}`).join(' · ')}</p>}
      {dup.size > 0 && handles.some((h) => dup.has(h.toLowerCase())) && <p className="mt-1 text-ui text-x-muted">주황 표시는 같은 대상으로 이미 작업이 있는 사람 — 그대로 두면 두 번째 작업이 만들어져요</p>}
    </div>
  );
  const rowsField = (
    <div className={field}>
      <p className={label}>사람별 금액·날짜 <span className="text-x-muted">명부 단가로 채웠어요 — 사람마다 다르면 그 줄에서 고치세요</span></p>
      {/* key={type}: 유형을 바꾸면 칸을 새로 그린다 — 치던 글자가 남아 새 단가를 가리는 일이 없게 */}
      <div className="mt-1.5">
        <CostRows key={type} type={type} handles={handles} influencerOptions={influencerOptions} values={costs} currency={currency}
                  dates={dates} showVisit={type === 'visit'} onChange={changeCost} onCurrencyChange={changeCurrency} onDateChange={changeDate} />
      </div>
    </div>
  );
  // 창 위의 '(전체)' 칸 — 값을 치는 것만으로는 아무 줄도 바뀌지 않는다. [모두에게 적용]을 눌러야 퍼진다.
  const dateHelper = (kind: keyof RowDates, id: string, text: string, value: string, set: (v: string) => void) => (
    <div className="w-[318px]">
      <label htmlFor={id} className={`block ${label}`}>{text} <span className="text-x-muted">선택</span></label>
      <div className="mt-1.5 flex items-center gap-2">
        <input id={id} type="date" value={value} onChange={(e) => set(e.target.value)} className={`${input} mt-0`} />
        <button type="button" onClick={() => applyDateToAll(kind, value)} disabled={!value}
                className="h-11 shrink-0 rounded-[10px] border border-x-border-strong px-3.5 text-content text-x-secondary hover:bg-x-hover disabled:opacity-40">모두에게 적용</button>
      </div>
    </div>
  );
  const dateFields = (
    <div className={`${field} flex flex-wrap items-start gap-x-4 gap-y-3`}>
      {type === 'visit' && dateHelper('visitOn', 'visit-on-all', '방문일 (전체)', visitOn, setVisitOn)}
      {dateHelper('scheduledOn', 'scheduled-on-all', '게시 예정일 (전체)', scheduledOn, setScheduledOn)}
      <p className="w-full text-ui text-x-muted">사람별로 다르면 아래 줄에서 고쳐요</p>
    </div>
  );
  const noteField = (
    <label className={`${field} block ${label}`}>메모 <span className="text-x-muted">선택</span>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="한 줄" className={input} />
    </label>
  );

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div className="w-full max-w-[760px] rounded-[14px] bg-white" role="dialog" aria-modal="true" aria-label="작업 추가" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-1.5">
          <h2 className="text-[17px] font-bold">작업 추가 — {campaign.name}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="닫기" className="text-[18px] text-x-muted hover:text-x-text">✕</button>
        </div>
        <div className="px-6 pb-2">
          <div className={field}>
            <p className={label}>유형</p>
            <div role="radiogroup" aria-label="작업 유형" className="mt-1.5 inline-flex overflow-hidden rounded-[10px] border border-x-border-strong">
              {TASK_TYPES.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={type === k} onClick={() => changeType(k)}
                        className={`border-r border-x-border-strong px-[18px] py-2.5 text-content last:border-r-0 ${type === k ? 'bg-x-text text-white' : 'text-x-secondary hover:bg-x-hover'}`}>{TASK_TYPE_LABEL[k]}</button>
              ))}
            </div>
          </div>
          {hasTarget && (
            <div className={field}>
              <p className={label}>{TASK_TYPE_LABEL[type]} 대상 <span className="text-x-muted">나중에 정해도 돼요</span></p>
              <div className="mt-1.5"><TargetPicker value={target} clientId={campaign.clientId} campaignId={campaign.id} onChange={(next) => void resolveTarget(next)} onTargetingLoaded={setTargeting} /></div>
            </div>
          )}
          {influencerField}
          {hasDraft && draftField}
          {dateFields}
          {rowsField}
          {noteField}
          {err && <p role="alert" className="mt-3 text-ui text-red-600">{err}</p>}
        </div>
        <div className="flex justify-end gap-2.5 border-t border-x-border px-6 py-4">
          <Button onClick={onClose} disabled={busy} className="h-10 px-4 text-content">취소</Button>
          <Button variant="primary" onClick={() => void submit(draft.kind === 'new')} disabled={busy} className="h-10 px-4 text-content">
            {busy ? '만드는 중…' : draft.kind === 'new' ? '작업 만들고 원고 쓰기' : handles.length > 1 ? `작업 ${handles.length}개 만들기` : '작업 만들기'}
          </Button>
        </div>
      </div>
    </div>
    {/* 원고 고르기 창은 이 오버레이 '밖'에 둔다 — 안에 두면 그 창을 누른 클릭이 오버레이까지 올라가 작업 추가 창이 닫힌다 */}
    {attachOpen && (
      <AttachDraftModal clientId={campaign.clientId} onClose={() => { setAttachOpen(false); if (draft.kind !== 'existing') setDraft({ kind: 'none' }); }}
                        onPick={(d) => { setDraft({ kind: 'existing', draft: d }); setAttachOpen(false); if (d.influencerHandle && handles.length === 0) addHandle(d.influencerHandle); }} />
    )}
    </>
  );
}
