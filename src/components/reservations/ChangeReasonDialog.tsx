'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui';
import type { ChangeReason } from '@/lib/reservationPolicy';

// 예약 창들의 공통 껍데기(목업 Modal, wide = 목업 .mock-modal.wide 900px) — body로 포털, 반투명 배경, 제목 줄 + ✕. 바깥을 '누르고 뗀' 때만 닫는다(드래그로 빠져나온 클릭은 무시).
// Esc는 캡처 단계에서 가로채 패널까지 전파하지 않는다. 저장 중(busy)에는 어느 길로도 닫히지 않는다.
export function DialogShell({ heading, busy = false, wide = false, onClose, children }: { heading: string; busy?: boolean; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, busy]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
         onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
         onClick={(e) => { const both = downOnBackdrop.current && e.target === e.currentTarget; downOnBackdrop.current = false; if (both && !busy) onClose(); }}>
      {/* wide(예약 수정)는 입력란이 많아 창 안에서 스크롤한다(NewReservationDialog와 같이 max-h-[90vh]) — 바닥 버튼 줄은 자식이 마지막에 두므로 본문과 함께 흐른다 */}
      <div role="dialog" aria-modal="true" aria-label={heading} className={`mt-6 w-full rounded-2xl bg-white shadow-xl ${wide ? 'flex max-h-[90vh] max-w-[900px] flex-col overflow-y-auto' : 'max-w-[540px]'}`}>
        <div className="flex shrink-0 items-center justify-between border-b border-x-border px-6 py-4">
          <h2 className="text-[17px] font-semibold">{heading}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="닫기" className="text-[18px] text-x-muted hover:text-x-text">✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export const REASON_HEADING = '수정 사유를 선택해 주세요';
export const LIMIT_HEADING = '변경 요청 3회를 모두 사용했어요';
// 사유 딱지 글자 — 수정 창·사유 창·인라인 수정 폼이 같은 말을 쓴다
export const reasonBadgeText = (reason: ChangeReason, requestCount: number) =>
  reason === 'customer_request' ? `인플루언서 요청 · 현재 ${requestCount}/3회` : '내 입력 정정 · 횟수 제외';

// '수정 사유를 선택해 주세요' 본문(목업) — 인플루언서 요청(n/3) / 내 입력 정정(횟수 제외)
export function ReasonChoices({ requestCount, onChoose }: { requestCount: number; onChoose: (reason: Exclude<ChangeReason, 'waiting_edit'>) => void }) {
  return (
    <div className="px-6 py-5">
      <p className="text-ui text-x-muted">실제로 변경한 내용을 저장했을 때만 이력이 남아요.</p>
      <button type="button" onClick={() => onChoose('customer_request')}
              className="mt-3 block w-full rounded-lg border border-x-border-strong p-4 text-left hover:border-x-blue hover:bg-[#f0f8fe]">
        <b className="block text-content">인플루언서 요청</b>
        <span className="mt-1 block text-[12px] text-x-secondary">예약 내용 변경 · 현재 {requestCount}/3회</span>
      </button>
      <button type="button" onClick={() => onChoose('correction')}
              className="mt-3 block w-full rounded-lg border border-x-border-strong p-4 text-left hover:border-x-blue hover:bg-[#f0f8fe]">
        <b className="block text-content">내 입력 정정</b>
        <span className="mt-1 block text-[12px] text-x-secondary">잘못 입력한 내용 수정 · 요청 횟수 제외</span>
      </button>
    </div>
  );
}

// '변경 요청 3회를 모두 사용했어요' 본문(목업) — 네 번째 요청은 협찬 중단으로만 기록한다. 결과 오류는 창 안에 보인다.
// 요청 중(busy)에는 부모 창(DialogShell)도 닫히지 않게 onBusy로 알린다 — 닫혀 버리면 돌아온 오류 문구를 보여 줄 곳이 없다.
export function LimitNotice({ onBack, onStopForLimit, onBusy }: { onBack: () => void; onStopForLimit?: () => Promise<string | void>; onBusy?: (busy: boolean) => void }) {
  const [busy, setBusyState] = useState(false), [error, setError] = useState('');
  const setBusy = (next: boolean) => { setBusyState(next); onBusy?.(next); };
  return (
    <>
      <div className="grid gap-3 px-6 py-5">
        <div role="alert" className="rounded-lg border border-[#f4d9d3] bg-[#fff5f3] px-3 py-2.5 text-[12px] text-[#a44334]">네 번째 요청은 협찬 중단으로 기록해요. 기존 예약·기재 시트·첨부는 그대로 남아요.</div>
        <p className="text-ui text-x-muted">이 안내를 닫으면 예약과 횟수는 바뀌지 않아요.</p>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-x-border px-6 py-3">
        <Button disabled={busy} onClick={onBack}>뒤로가기</Button>
        {onStopForLimit && <Button variant="primary" disabled={busy} onClick={() => { setBusy(true); void onStopForLimit().then((m) => { if (m) setError(m); }).finally(() => setBusy(false)); }}>요청 기록·협찬 중단</Button>}
      </div>
      {error && <p role="alert" className="px-6 pb-4 text-ui text-red-600">{error}</p>}
    </>
  );
}

// [예약 수정]을 눌렀을 때 먼저 뜨는 사유 창(목업 '수정 사유를 선택해 주세요') — 확정된 예약의 수정 폼은 사유를 고른 뒤에 열린다.
// 인플루언서 요청이 3회를 다 썼으면 '변경 요청 3회를 모두 사용했어요'로 넘어가 협찬 중단만 할 수 있다.
export function ChangeReasonDialog({ requestCount, onChoose, onStopForLimit, onClose }: {
  requestCount: number;
  onChoose: (reason: Exclude<ChangeReason, 'waiting_edit'>) => void;
  onStopForLimit?: () => Promise<string | void>;
  onClose: () => void;
}) {
  const [limit, setLimit] = useState(false), [busy, setBusy] = useState(false);
  return (
    <DialogShell heading={limit ? LIMIT_HEADING : REASON_HEADING} busy={busy} onClose={onClose}>
      {limit
        ? <LimitNotice onBack={() => setLimit(false)} onStopForLimit={onStopForLimit} onBusy={setBusy} />
        : <ReasonChoices requestCount={requestCount} onChoose={(reason) => { if (reason === 'customer_request' && requestCount >= 3) setLimit(true); else onChoose(reason); }} />}
    </DialogShell>
  );
}
