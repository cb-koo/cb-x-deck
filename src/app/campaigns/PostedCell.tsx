'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignTaskItem } from '@/lib/campaignStore';
import { taskStage, TASK_STAGE_LABEL, isDateOnlyString, formatDateKo } from '@/lib/campaignJudgment';
import { TASK_STAGE_STYLE } from '@/components/DraftStatusChip';
import { stageTag } from '@/lib/campaignTableView';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';
import { DATE_MESSAGE } from '@/lib/campaignTaskInput';
import { TaskProofField } from '@/components/TaskProofField';
import { PROOF_REQUIRED_MESSAGE, proofUploadedLine } from '@/lib/taskProofGuard';

// 단계 셀(스펙 §3-4·§4-1) — 칩은 값만('게시됨 9/3'), 부가 정보는 옆의 회색 태그. 누르면 지금 상태에서 할 수 있는 것만 보이는 팝오버.
// 게시 확인 자체는 되돌리지 않는다 — 잘못 찍었으면 작업을 지우고 다시 만든다(팝오버 문구가 그렇게 말한다).
// 팝오버 골격(body 포털·좌표 고정·바깥 클릭/Esc/스크롤 닫기)은 CostPopover·InfluencerChip과 같다 — 표 셀의 overflow에 잘리지 않는다.
// RT는 증빙 스크린샷 칸이 붙어 팝오버가 커진다(RT 증빙 스펙 §7) — POP_H를 실제 높이에 맞춰 키웠다.
const POP_W = 320;
const POP_H = 380;

export function PostedCell({ task, today, proofSignedUrl, onMarkPosted, onMarkRemoved, onUnmarkRemoved, onSetProof }: {
  task: CampaignTaskItem; today: string; proofSignedUrl: string | null;
  onMarkPosted: (date: string, postUrl?: string, proof?: string) => void;
  onMarkRemoved: (date: string, reason: string) => void;
  onUnmarkRemoved: () => void;
  onSetProof: (path: string | null) => void;
}) {
  const stage = taskStage(task, today);
  const tag = stageTag(task);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [date, setDate] = useState(today);
  const [url, setUrl] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [pendingProof, setPendingProof] = useState<string | null>(null);   // 아직 저장 전 — [게시됨으로 표시]와 함께 나간다
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

  // 취소된 작업(055)은 조작이 없다 — 칩만 보이고 팝오버를 열지 않는다. 되돌리기는 v2 화면에서(R20).
  if (stage === 'cancelled') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-ui ${TASK_STAGE_STYLE.cancelled}`}
            title={task.cancelledDraftTitle ? `원고 있었음: ${task.cancelledDraftTitle}` : '취소된 작업'}>
        취소됨 {formatDateKo(task.cancelledAt as string)}
      </span>
    );
  }

  function openPop() { setDate(today); setUrl(''); setReason(task.removedReason); setErr(''); setPendingProof(null); place(); setOpen(true); }
  const label = stage === 'published' ? `게시됨 ${formatDateKo(task.postedAt as string)}`
    : stage === 'removed' ? `내려짐 ${formatDateKo(task.removedAt as string)}`
    : TASK_STAGE_LABEL[stage];
  const input = 'mt-0.5 h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue';

  function submitPosted() {
    if (!isDateOnlyString(date)) { setErr(DATE_MESSAGE); return; }
    // 증빙 없는 RT는 [게시됨으로 표시] 버튼 자체가 disabled라 onClick이 나지 않는다 — 여기서 다시
    // 막을 필요가 없다(리뷰 수정 3). 이유는 버튼 위 안내 문구(PROOF_REQUIRED_MESSAGE)가 화면에 늘 보인다.
    const u = url.trim();
    if (u) { const p = parseTweetLink(u); if (!p.ok) { setErr(tweetLinkParseMessage(p.reason)); return; } }
    onMarkPosted(date, u || undefined, pendingProof ?? undefined); close();
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
              <p className="mt-0.5 text-ui text-x-muted">
                {task.type === 'rt'
                  ? '게시된 날을 적고 증빙 스크린샷을 넣으면 게시됨으로 바뀌고 정산 후보가 돼요'
                  : '게시된 날을 적으면 이 작업이 게시됨으로 바뀌고 정산 후보가 돼요'}
              </p>
              <label className="mt-2 block text-ui text-x-secondary">게시된 날
                <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setErr(''); }} className={input} />
              </label>
              {task.type !== 'rt' && (
                <label className="mt-2 block text-ui text-x-secondary">게시물 링크 <span className="text-x-muted">선택</span>
                  <input value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }} placeholder="https://x.com/계정/status/…" className={input} />
                  <span className="mt-0.5 block text-ui text-x-muted">링크를 붙이면 트래킹에도 등록돼 조회·좋아요가 잡혀요</span>
                </label>
              )}
              {task.type === 'rt' && (
                <TaskProofField taskId={task.id} value={pendingProof} signedUrl={null}
                                postedAt={null} influencerHandle={task.influencerHandle}
                                required canRemove disabled={false}
                                onChange={(p) => { setPendingProof(p); setErr(''); }} />
              )}
              {/* 비활성 버튼의 이유를 툴팁(터치·키보드 사용자에겐 안 보인다)에만 두지 않고 화면에도 문구로
                  말한다(리뷰 수정 3) — 이 저장소 규칙. */}
              {task.type === 'rt' && !pendingProof && (
                <p className="mt-1 text-ui text-x-muted">{PROOF_REQUIRED_MESSAGE}</p>
              )}
              {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={close} className="ml-auto rounded-full px-3 py-1 text-ui text-x-secondary hover:bg-x-text/5">취소</button>
                <button type="button" onClick={submitPosted}
                        disabled={task.type === 'rt' && !pendingProof}
                        title={task.type === 'rt' && !pendingProof ? PROOF_REQUIRED_MESSAGE : undefined}
                        className="rounded-full bg-x-blue px-3 py-1 text-ui font-bold text-white hover:bg-x-blue-hover disabled:cursor-not-allowed disabled:opacity-50">게시됨으로 표시</button>
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
              {/* 안내 문구는 첨부 칸 '위'에 온다 — 읽는 순서상 상자보다 먼저 와야 한다(리뷰 수정 4). */}
              {task.type === 'rt' && !task.proof && (
                <p className="mt-0.5 text-ui text-amber-700">증빙 없음 — 지금 채울 수 있어요</p>
              )}
              {/* key를 주지 않는다 — TaskProofField가 preview를 자신이 올린 경로와 함께 들고 있어서,
                  실패한 '바꾸기'가 롤백돼 value가 이전 경로로 돌아가면 컴포넌트가 알아서 signedUrl로
                  되돌아간다(강제 리마운트로 성공 경로의 미리보기까지 지우던 문제 — RT 증빙 리뷰 수정 1). */}
              {task.type === 'rt' && (
                <TaskProofField taskId={task.id} value={task.proof?.url ?? null} signedUrl={proofSignedUrl}
                                postedAt={task.postedAt} influencerHandle={task.influencerHandle}
                                required={false} canRemove={false} disabled={false}
                                onChange={(p) => onSetProof(p)} />
              )}
              {/* '누가 언제 올림' — 세 화면(이 칸·내려짐 칸·정산 요청 상세)이 같은 문구 함수를 쓴다(리뷰 수정 5).
                  proofUploadedLine이 KST 기준 날짜를 계산한다(.slice(0, 10) UTC 절단 버그, 리뷰 수정 2). */}
              {task.type === 'rt' && task.proof && (
                <p className="mt-0.5 text-ui text-x-muted">{proofUploadedLine(task.proof.byName, task.proof.at)}</p>
              )}
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
              {/* key를 주지 않는다 — TaskProofField가 preview를 자신이 올린 경로와 함께 들고 있어서,
                  실패한 '바꾸기'가 롤백돼 value가 이전 경로로 돌아가면 컴포넌트가 알아서 signedUrl로
                  되돌아간다(강제 리마운트로 성공 경로의 미리보기까지 지우던 문제 — RT 증빙 리뷰 수정 1). */}
              {task.type === 'rt' && (
                <TaskProofField taskId={task.id} value={task.proof?.url ?? null} signedUrl={proofSignedUrl}
                                postedAt={task.postedAt} influencerHandle={task.influencerHandle}
                                required={false} canRemove={false} disabled={false}
                                onChange={(p) => onSetProof(p)} />
              )}
              {/* 내려짐 분기도 게시됨 분기와 같은 '누가 언제 올림' 문구를 쓴다 — 이전엔 여기만 빠져 있었다(리뷰 수정 5). */}
              {task.type === 'rt' && task.proof && (
                <p className="mt-0.5 text-ui text-x-muted">{proofUploadedLine(task.proof.byName, task.proof.at)}</p>
              )}
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
