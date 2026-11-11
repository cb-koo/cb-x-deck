'use client';
import { useContext, useEffect, useRef, useState } from 'react';
import type { FlowRow } from '@/lib/campaignFlowView';
import { formatDateKoLong, isDateOnlyString, DONE_NOTE_MAX } from '@/lib/campaignJudgment';
import { DATE_MESSAGE } from '@/lib/campaignTaskInput';
import { isHttpUrl, isOtherLinklessDone, DONE_DATE_FUTURE_MESSAGE, LINK_MESSAGE, OTHER_KIND_REQUIRED_MESSAGE } from '@/lib/otherTask';
import { TaskProofField } from '@/components/TaskProofField';
import { Button } from '@/components/ui';
import { OtherKindDraftContext } from './OtherKindField';

// 기타 협찬(088, koo 11-06)의 '완료' 칸 — 게시 칸(PostedBox)의 기타 협찬판. X 게시물이 아니라서
//  · 순서: 완료한 날 → 확인 링크(선택, 아무 http(s) 주소) → 스크린샷 붙여넣기(선택, RT 증빙과 같은 칸) → [완료 확인]
//  · 확인 자료 셋(링크, 스크린샷, 확인 메모)을 대등한 칸으로 나란히 둔다 — 하나 이상이면 된다(koo 11-11: 메모가 접힌 글자 링크라
//    셋 중 하나라는 게 안 보였다). 여러 개를 넣어도 된다. 정산 note 규칙은 그대로(otherSettlementNote)
//  · X 미리보기·작성자 확인·성과 측정 없음(조회 비용도 없다)
//  · '무엇을 했는지'가 비어 있으면 [완료 확인]을 막는다 — 패널 칸에 지금 적힌 글자(OtherKindDraftContext)로 판정해 입력 중에도 켜진다
//  · 완료 뒤: 스크린샷은 RT처럼 [바꾸기]로 교체. 떼기는 링크나 메모가 남아 있을 때만(확인 자료가 0개가 되면 안 된다 — 서버도 막는다)
// FlowDetail이 기타 협찬이면 PostedBox 대신 이 컴포넌트를 그린다 — 유형이 다르면 다른 컴포넌트라 훅 순서가 섞이지 않는다.
const input = 'h-10 w-full rounded-md border bg-white px-2.5 text-content outline-none focus:border-x-blue';
const subTitle = 'mb-1.5 text-[14px] font-semibold text-x-secondary';

export type OtherDone = { url?: string; proof?: string; note?: string };

export function OtherDoneBox({ task, today, proofSignedUrl, focus, onFocused, onDone, onSetProof, onCancel }: {
  task: FlowRow;
  today: string;
  proofSignedUrl: string | null;
  focus: boolean;
  onFocused: () => void;
  onDone: (date: string, done: OtherDone, otherKind?: string) => Promise<boolean>;
  onSetProof: (path: string | null) => Promise<boolean>;   // 완료된 작업의 스크린샷 바꾸기·떼기(actions.setProof)
  onCancel: () => void;
}) {
  const kindDraft = useContext(OtherKindDraftContext);
  const [date, setDate] = useState(() => (task.scheduledOn && task.scheduledOn <= today ? task.scheduledOn : today));
  const [url, setUrl] = useState('');
  const [pendingProof, setPendingProof] = useState<string | null>(null);   // 완료 전 — [완료 확인]과 함께 나간다
  const [doneNote, setDoneNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!focus) return;
    rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    inputRef.current?.focus({ preventScroll: true });
    onFocused();
  }, [focus, onFocused]);

  // ── 완료 뒤 ──
  if (task.postedAt) {
    const noLink = isOtherLinklessDone(task);
    // 스크린샷을 떼도 링크나 메모가 남으면 뗄 수 있다 — 아니면 [바꾸기]만(RT 증빙과 같은 규칙)
    const canRemoveProof = !!task.postUrl || !!task.doneNote.trim();
    return (
      <div ref={rootRef}>
        <p className="text-content">
          완료 {formatDateKoLong(task.postedAt, false)}
          {task.postUrl && <>{'  '}<a href={task.postUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">확인 링크 열기 ↗</a></>}
          {noLink && <span className="text-x-secondary">  (링크 없음)</span>}
        </p>
        {task.postUrl && <p className="mt-0.5 truncate text-ui text-x-muted" title={task.postUrl}>{task.postUrl.replace(/^https?:\/\//, '')}</p>}
        {task.doneNote && <p className="mt-1 text-ui text-x-secondary">확인 메모: {task.doneNote}</p>}
        {task.proof && (
          <div className="mt-2.5">
            <TaskProofField taskType="other" taskId={task.id} value={task.proof.url} signedUrl={proofSignedUrl}
                            postedAt={task.postedAt} influencerHandle={task.influencerHandle}
                            uploaded={{ byName: task.proof.byName, at: task.proof.at }}
                            required={false} canRemove={canRemoveProof} disabled={false}
                            onChange={(p) => onSetProof(p)} />
          </div>
        )}
      </div>
    );
  }

  const kind = (kindDraft ?? task.otherKind).trim();
  const cancelBtn = (
    <div className="-mx-4 mt-3.5 flex items-center justify-between gap-3 border-t border-x-border px-4 pt-3">
      <span className="text-[14px] text-x-secondary">진행이 안 됐다면</span>
      <button type="button" onClick={onCancel} title="거절·무응답 등으로 진행이 안 된 작업을 취소해요 — 취소해도 되돌릴 수 있어요"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-red-200 bg-white px-3.5 text-[14px] font-semibold text-red-600 hover:bg-red-50">
        ✕ 진행 안 됨
      </button>
    </div>
  );

  // 인플 미정 — 완료 확인되면 배정·교체·취소·정산이 막힌다(PostedBox와 같은 이유)
  if (task.influencerHandle === null) {
    return (
      <div ref={rootRef}>
        <Button variant="subtle" disabled title="인플루언서를 먼저 정해요" className="h-9 px-3.5 text-ui">완료 확인</Button>
        <p className="mt-1 text-ui text-x-muted">인플루언서를 먼저 정해 주세요</p>
        {cancelBtn}
      </div>
    );
  }

  const blockReason = !kind ? OTHER_KIND_REQUIRED_MESSAGE : '';
  const hasEvidence = !!url.trim() || !!pendingProof || !!doneNote.trim();
  async function submit() {
    if (!isDateOnlyString(date)) { setErr(DATE_MESSAGE); return; }
    if (date > today) { setErr(DONE_DATE_FUTURE_MESSAGE); return; }
    const done: OtherDone = {};
    const u = url.trim();
    if (u && !isHttpUrl(u)) { setErr(LINK_MESSAGE); return; }
    if (!u && !pendingProof && !doneNote.trim()) { setErr('확인 링크, 스크린샷, 확인 메모 중 하나를 넣어 주세요'); return; }
    if (u) done.url = u;
    if (pendingProof) done.proof = pendingProof;
    if (doneNote.trim()) done.note = doneNote.trim();
    setBusy(true);
    // 칸에 적혔지만 아직 저장 전인 '무엇을 했는지'도 함께 보낸다(서버가 같은 요청 안에서 판정한다)
    try { await onDone(date, done, kindDraft !== null && kind !== task.otherKind ? kind : undefined); }
    finally { setBusy(false); }
  }
  const canSubmit = !busy && !blockReason && hasEvidence;

  return (
    <div ref={rootRef}>
      <p className={subTitle}>완료한 날</p>
      <input type="date" value={date} max={today} aria-label="완료한 날" onChange={(e) => { setDate(e.target.value); setErr(''); }}
             className={`${input} border-x-border-strong`} />
      {/* 확인 자료 셋 — 같은 모양의 칸 셋을 나란히(어느 하나가 '예외 경로'로 보이지 않게). 하나 이상이면 [완료 확인]이 켜진다 */}
      <div className="mt-4 rounded-lg border border-x-border px-3.5 pb-3.5 pt-3">
        <p className="text-content font-semibold">확인 자료 <span className="font-normal text-x-secondary">셋 중 하나만 있어도 돼요</span></p>
        <p className="mt-0.5 text-ui text-x-muted">정산팀이 이걸로 완료를 확인해요. 여러 개 넣어도 돼요.</p>
        <p className={`${subTitle} mt-3`}>확인 링크 <span className="font-normal text-x-muted">리뷰, 게시물처럼 링크가 있을 때</span></p>
        <input ref={inputRef} value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }}
               placeholder="리뷰, 게시물 등 아무 링크나 붙여넣기 (https://…)" aria-label="확인 링크"
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && canSubmit) void submit(); }}
               className={`${input} border-x-border-strong`} />
        <p className={`${subTitle} mt-3`}>스크린샷 <span className="font-normal text-x-muted">화면을 캡처해 뒀을 때</span></p>
        <TaskProofField taskType="other" taskId={task.id} value={pendingProof} signedUrl={null}
                        postedAt={null} influencerHandle={task.influencerHandle}
                        required={false} canRemove disabled={busy}
                        onChange={(p) => { setPendingProof(p); setErr(''); }} />
        <p id="done-note-label" className={`${subTitle} mt-3`}>확인 메모 <span className="font-normal text-x-muted">상담회 참석처럼 남길 자료가 없을 때</span></p>
        <input value={doneNote} maxLength={DONE_NOTE_MAX} onChange={(e) => { setDoneNote(e.target.value); setErr(''); }}
               placeholder="예: 상담회 현장에서 참석 확인" aria-labelledby="done-note-label" className={`${input} border-x-border-strong`} />
      </div>
      {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
      <div className="mt-2.5 flex items-center justify-end gap-2">
        {blockReason && <span className="text-ui text-amber-700">{blockReason}</span>}
        {!blockReason && !hasEvidence && <span className="text-ui text-x-muted">확인 자료를 하나 넣으면 눌러져요</span>}
        <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()} title={blockReason || undefined} className="h-9 px-3.5 text-ui">
          {busy ? '저장 중…' : '완료 확인'}
        </Button>
      </div>
      {cancelBtn}
    </div>
  );
}
