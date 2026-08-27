'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignTaskItem } from '@/lib/campaignStore';
import { taskStage, TASK_STAGE_LABEL, isDateOnlyString, formatDateKo } from '@/lib/campaignJudgment';
import { TASK_STAGE_STYLE } from '@/components/DraftStatusChip';
import { stageTag } from '@/lib/campaignTableView';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';
import { DATE_MESSAGE } from '@/lib/campaignTaskInput';

// 단계 셀(스펙 §3-4·§4-1) — 칩은 값만('게시됨 9/3'), 부가 정보는 옆의 회색 태그. 누르면 지금 상태에서 할 수 있는 것만 보이는 팝오버.
// 게시 확인 자체는 되돌리지 않는다 — 잘못 찍었으면 작업을 지우고 다시 만든다(팝오버 문구가 그렇게 말한다).
// 팝오버 골격(body 포털·좌표 고정·바깥 클릭/Esc/스크롤 닫기)은 CostPopover·InfluencerChip과 같다 — 표 셀의 overflow에 잘리지 않는다.
const POP_W = 320;
const POP_H = 260;

export function PostedCell({ task, today, onMarkPosted, onMarkRemoved, onUnmarkRemoved }: {
  task: CampaignTaskItem; today: string;
  onMarkPosted: (date: string, postUrl?: string) => void;
  onMarkRemoved: (date: string, reason: string) => void;
  onUnmarkRemoved: () => void;
}) {
  const stage = taskStage(task, today);
  const tag = stageTag(task);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [date, setDate] = useState(today);
  const [url, setUrl] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

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
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    // capture로 받아 전파를 끊는다 — 카드 peek 오버레이의 Esc까지 한 번에 닫히지 않게(CostPopover 관례)
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

  function openPop() { setDate(today); setUrl(''); setReason(task.removedReason); setErr(''); place(); setOpen(true); }
  const label = stage === 'published' ? `게시됨 ${formatDateKo(task.postedAt as string)}`
    : stage === 'removed' ? `내려짐 ${formatDateKo(task.removedAt as string)}`
    : TASK_STAGE_LABEL[stage];
  const input = 'mt-0.5 h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue';

  function submitPosted() {
    if (!isDateOnlyString(date)) { setErr(DATE_MESSAGE); return; }
    const u = url.trim();
    if (u) { const p = parseTweetLink(u); if (!p.ok) { setErr(tweetLinkParseMessage(p.reason)); return; } }
    onMarkPosted(date, u || undefined); close();
  }
  function submitRemoved() {
    if (!isDateOnlyString(date)) { setErr(DATE_MESSAGE); return; }
    onMarkRemoved(date, reason.trim()); close();
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <button ref={btnRef} type="button" onClick={() => (open ? close() : openPop())} aria-haspopup="dialog" aria-expanded={open}
                title={task.postedAt ? '게시 확인됨 — 눌러서 게시 내림 표시' : '눌러서 게시 확인'}
                className={`rounded-md border px-2.5 py-1 text-ui font-medium hover:brightness-95 ${TASK_STAGE_STYLE[stage]}`}>{label}</button>
        {tag && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600">{tag}</span>}
      </span>
      {open && createPortal(
        <div ref={popRef} role="dialog" aria-label="게시 확인" style={{ top: pos.top, left: pos.left, width: POP_W }} onClick={(e) => e.stopPropagation()}
             className="fixed z-50 rounded-xl border border-x-border-strong bg-white p-3 shadow-lg">
          {!task.postedAt ? (
            <>
              <p className="text-ui font-bold">게시 확인</p>
              <p className="mt-0.5 text-ui text-x-muted">게시된 날을 적으면 이 작업이 게시됨으로 바뀌고 정산 후보가 돼요</p>
              <label className="mt-2 block text-ui text-x-secondary">게시된 날
                <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setErr(''); }} className={input} />
              </label>
              {task.type !== 'rt' && (
                <label className="mt-2 block text-ui text-x-secondary">게시물 링크 <span className="text-x-muted">선택</span>
                  <input value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }} placeholder="https://x.com/계정/status/…" className={input} />
                </label>
              )}
              {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={close} className="ml-auto rounded-full px-3 py-1 text-ui text-x-secondary hover:bg-x-text/5">취소</button>
                <button type="button" onClick={submitPosted} className="rounded-full bg-x-blue px-3 py-1 text-ui font-bold text-white hover:bg-x-blue-hover">게시됨으로 표시</button>
              </div>
            </>
          ) : !task.removedAt ? (
            <>
              <p className="text-ui font-bold">게시 내림 표시</p>
              <p className="mt-0.5 text-ui text-x-muted">게시 확인은 그대로 남고 &quot;내려짐&quot;이 붙어요 — 정산할지는 정산 화면에서 판단해요</p>
              <label className="mt-2 block text-ui text-x-secondary">내려진 날
                <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setErr(''); }} className={input} />
              </label>
              <label className="mt-2 block text-ui text-x-secondary">사유 <span className="text-x-muted">선택</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="본인 요청" className={input} />
              </label>
              {task.postUrl && <a href={task.postUrl} target="_blank" rel="noreferrer" className="mt-2 block text-ui text-x-blue-text hover:underline">게시물 보기 ↗</a>}
              {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={close} className="ml-auto rounded-full px-3 py-1 text-ui text-x-secondary hover:bg-x-text/5">취소</button>
                <button type="button" onClick={submitRemoved} className="rounded-full bg-x-text px-3 py-1 text-ui font-bold text-white hover:opacity-90">내려짐으로 표시</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-ui font-bold">내려짐 {formatDateKo(task.removedAt)}</p>
              {task.removedReason && <p className="mt-0.5 text-ui text-x-secondary">{task.removedReason}</p>}
              <p className="mt-1 text-ui text-x-muted">잘못 표시했으면 취소할 수 있어요</p>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={close} className="ml-auto rounded-full px-3 py-1 text-ui text-x-secondary hover:bg-x-text/5">닫기</button>
                <button type="button" onClick={() => { onUnmarkRemoved(); close(); }} className="rounded-full border border-x-border-strong px-3 py-1 text-ui font-bold hover:bg-x-hover">내림 취소</button>
              </div>
            </>
          )}
        </div>, document.body)}
    </>
  );
}
