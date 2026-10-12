'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { uploadWindow } from '@/lib/reservationPolicy';
import { kstToday } from '@/lib/datetime';
import { DialogShell, ReasonChoices, LimitNotice, reasonBadgeText, REASON_HEADING, LIMIT_HEADING } from './ChangeReasonDialog';

// 일정 상자의 날짜 줄을 눌렀을 때 뜨는 '방문일 수정 / 업로드 기한 수정' 창(목업 x-extension ScheduleEditor) — 달력에서 날짜를 고르고
// (방문일이면 시간도) [일정 저장]. 예약이 있으면 저장이 예약 폼·기재 시트에 함께 반영된다(부모 onApply가 PATCH). 확정된 예약은
// 먼저 수정 사유를 고른다(ChangeReasonDialog와 같은 '수정 사유를 선택해 주세요' 본문) — 인플루언서 요청이 3회를 다 썼으면
// '변경 요청 3회를 모두 사용했어요'로 넘어가 협찬 중단만 할 수 있다. 창이 떠 있는 동안 패널의 Esc·바깥 클릭은 부모가 끈다(body로 포털).
export type ScheduleReason = 'waiting_edit' | 'customer_request' | 'correction';
export function ScheduleEditorDialog({ title, hasReservation, initialValue, withTime, minimumDate = '', defaultDeadline, askReason, allowCustomerRequest = true, requestCount, guidanceFor, onApply, onStopForLimit, onClose }: {
  title: string;
  hasReservation: boolean;
  initialValue: string;          // 'YYYY-MM-DDTHH:mm' | 'YYYY-MM-DD' | ''
  withTime: boolean;
  minimumDate?: string;          // 업로드 기한은 방문일 이후만
  defaultDeadline?: string;      // 업로드 기한 창의 '기본 기한으로'(방문 후 14일)
  askReason: boolean;            // 확정된 예약(게시 뒤 정정 포함) — 사유가 필요하다
  allowCustomerRequest?: boolean; // 인플루언서 요청으로 고칠 수 있는 단계인지 — 아니면(게시 뒤) 묻지 않고 '내 입력 정정'으로 간다
  requestCount: number;          // 인플루언서 요청 n/3
  guidanceFor?: (value: string) => string | null;   // 방문 시간의 운영시간 안내(클리닉 설정)
  onApply: (value: string, reason: ScheduleReason) => Promise<string | void>;   // 오류 문구를 돌려주면 창에 보인다
  onStopForLimit?: () => Promise<string | void>;   // 오류 문구를 돌려주면 창에 보인다
  onClose: () => void;
}) {
  const [view, setView] = useState<'reason' | 'editor' | 'limit'>(askReason && allowCustomerRequest ? 'reason' : 'editor');
  const [reason, setReason] = useState<ScheduleReason>(askReason ? 'correction' : 'waiting_edit');
  const [date, setDate] = useState(initialValue.slice(0, 10));
  const [time, setTime] = useState(initialValue.slice(11, 16));
  const [month, setMonth] = useState(() => (uploadWindow(initialValue) ? initialValue : minimumDate || kstToday()).slice(0, 7));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const first = new Date(`${month}-01T00:00:00Z`);
  const total = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const value = withTime ? `${date}T${time}` : date;
  const limitReached = requestCount >= 3;

  function move(delta: number) {
    const next = new Date(first); next.setUTCMonth(next.getUTCMonth() + delta);
    setMonth(next.toISOString().slice(0, 7));
  }
  function select(next: string) {
    setDate(next);
    if (uploadWindow(next)) setMonth(next.slice(0, 7));
    setError('');
  }
  function choose(next: ScheduleReason) {
    setReason(next);
    setView(next === 'customer_request' && limitReached ? 'limit' : 'editor');
  }
  async function apply() {
    if (!uploadWindow(date) || (minimumDate && date < minimumDate)) { setError(minimumDate ? '방문일 이후의 올바른 날짜를 선택해 주세요.' : '올바른 날짜를 선택해 주세요.'); return; }
    if (withTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { setError('방문 시간을 선택해 주세요.'); return; }
    if (value === initialValue) { onClose(); return; }
    if (reason === 'customer_request' && limitReached) { setView('limit'); return; }
    setBusy(true);
    try { const message = await onApply(value, reason); if (message) setError(message); }
    finally { setBusy(false); }
  }
  const guidance = withTime && guidanceFor && date && time ? guidanceFor(value) : null;
  const heading = view === 'reason' ? REASON_HEADING : view === 'limit' ? LIMIT_HEADING : title;

  return (
    <DialogShell heading={heading} busy={busy} onClose={onClose}>
      {view === 'reason' && <ReasonChoices requestCount={requestCount} onChoose={choose} />}
      {view === 'limit' && <LimitNotice onBack={() => setView(askReason ? 'reason' : 'editor')} onStopForLimit={onStopForLimit} onBusy={setBusy} />}
      {view === 'editor' && (
        <>
          <div className="grid gap-4 px-6 py-5">
            <p className="text-ui text-x-muted">한국 시간 · {hasReservation ? '저장하면 일정과 예약 폼·기재 시트에 함께 반영해요.' : '날짜를 선택한 뒤 일정을 저장해 주세요.'}</p>
            {reason !== 'waiting_edit' && (
              <span className="inline-flex w-fit rounded-md bg-[#e8f4fd] px-1.5 py-0.5 text-caption font-semibold text-[#1573ad]">
                {reasonBadgeText(reason, requestCount)}
              </span>
            )}
            <div className="rounded-[10px] border border-x-border p-3" aria-label="일정 달력">
              <div className="mb-3 flex items-center justify-between">
                <Button variant="icon" aria-label="이전 달" onClick={() => move(-1)}>‹</Button>
                <strong aria-live="polite" className="text-content">{first.getUTCFullYear()}년 {first.getUTCMonth() + 1}월</strong>
                <Button variant="icon" aria-label="다음 달" onClick={() => move(1)}>›</Button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {['일', '월', '화', '수', '목', '금', '토'].map((d) => <span key={d} className="py-1.5 text-caption text-x-muted">{d}</span>)}
                {Array.from({ length: first.getUTCDay() }, (_, i) => <span key={`e${i}`} />)}
                {Array.from({ length: total }, (_, i) => {
                  const day = `${month}-${String(i + 1).padStart(2, '0')}`;
                  const selected = date === day;
                  return (
                    <button key={day} type="button" aria-label={day} aria-pressed={selected} disabled={!!minimumDate && day < minimumDate} onClick={() => select(day)}
                            className={`min-h-9 rounded-lg text-ui tabular-nums disabled:text-[#c2c9ce] ${selected ? 'bg-x-blue font-semibold text-white' : 'hover:bg-[#e8f5fd]'}`}>
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className={`grid gap-3 ${withTime ? 'grid-cols-2' : ''}`}>
              <label className="block text-ui text-x-secondary">날짜
                <input type="date" value={date} min={minimumDate || undefined} onChange={(e) => select(e.target.value)}
                       className="mt-1 h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-ui text-x-text outline-none focus:border-x-blue" />
              </label>
              {withTime && (
                <label className="block text-ui text-x-secondary">방문 시간
                  <input type="time" value={time} onChange={(e) => { setTime(e.target.value); setError(''); }}
                         className="mt-1 h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-ui text-x-text outline-none focus:border-x-blue" />
                </label>
              )}
            </div>
            {defaultDeadline && (
              <div className="flex items-center justify-between gap-2">
                <small className="text-caption text-x-secondary">방문 후 14일 기준: {defaultDeadline}</small>
                <Button variant="ghost" onClick={() => select(defaultDeadline)}>기본 기한으로</Button>
              </div>
            )}
            {guidance && <div role="status" className="rounded-lg border border-[#d8ebf8] bg-[#f0f8fe] px-3 py-2.5 text-[12px] text-[#245c7e]">{guidance}</div>}
            {error && <div role="alert" className="rounded-lg border border-[#f4d9d3] bg-[#fff5f3] px-3 py-2.5 text-[12px] text-[#a44334]">{error}</div>}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-x-border px-6 py-3">
            <Button disabled={busy} onClick={onClose}>돌아가기</Button>
            <Button variant="primary" disabled={busy} onClick={() => void apply()}>{busy ? '저장 중…' : '일정 저장'}</Button>
          </div>
        </>
      )}
    </DialogShell>
  );
}
