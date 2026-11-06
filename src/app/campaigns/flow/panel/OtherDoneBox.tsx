'use client';
import { useEffect, useRef, useState } from 'react';
import type { FlowRow } from '@/lib/campaignFlowView';
import { formatDateKoLong, isDateOnlyString, DONE_NOTE_MAX } from '@/lib/campaignJudgment';
import { DATE_MESSAGE } from '@/lib/campaignTaskInput';
import { isHttpUrl, isOtherLinklessDone, DONE_DATE_FUTURE_MESSAGE, LINK_MESSAGE, OTHER_KIND_REQUIRED_MESSAGE } from '@/lib/otherTask';
import { Button } from '@/components/ui';

// 기타 협찬(088, koo 11-06)의 '완료' 칸 — 게시 칸(PostedBox)의 기타 협찬판. X 게시물이 아니라서
//  · 완료한 날을 사람이 고르고(기본 오늘 — 예정일이 지났으면 그날), 확인 링크는 아무 http(s) 주소(구글맵·인스타 등)
//  · 링크가 없으면 [링크 없이 완료 확인 ▸]을 펼쳐 확인 메모(필수) — 정산 때 링크 대신 정산팀에 간다('[링크 없음] …')
//  · X 미리보기·작성자 확인·성과 측정 없음(조회 비용도 없다)
//  · '무엇을 했는지'가 비어 있으면 [완료 확인]을 막고 이유를 버튼 옆에 말한다(서버 otherGateError와 같은 문구)
// FlowDetail이 기타 협찬이면 PostedBox 대신 이 컴포넌트를 그린다 — 유형이 다르면 다른 컴포넌트라 훅 순서가 섞이지 않는다.
const input = 'h-10 w-full rounded-md border bg-white px-2.5 text-content outline-none focus:border-x-blue';
const subTitle = 'mb-1.5 text-[14px] font-semibold text-x-secondary';

export function OtherDoneBox({ task, today, otherKindDraft, focus, onFocused, onDone, onCancel }: {
  task: FlowRow;
  today: string;
  otherKindDraft?: string;   // 패널 '무엇을 했는지' 칸에 적혔지만 아직 저장 전인 글자 — 있으면 완료 확인과 함께 보낸다
  focus: boolean;
  onFocused: () => void;
  onDone: (date: string, done: { url: string } | { note: string }, otherKind?: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(() => (task.scheduledOn && task.scheduledOn <= today ? task.scheduledOn : today));
  const [url, setUrl] = useState('');
  const [linkless, setLinkless] = useState(false);
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
    return (
      <div ref={rootRef}>
        <p className="text-content">
          완료 {formatDateKoLong(task.postedAt, false)}
          {task.postUrl && <>{'  '}<a href={task.postUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">확인 링크 열기 ↗</a></>}
          {noLink && <span className="text-x-secondary">  (링크 없음)</span>}
        </p>
        {task.postUrl && <p className="mt-0.5 truncate text-ui text-x-muted" title={task.postUrl}>{task.postUrl.replace(/^https?:\/\//, '')}</p>}
        {task.doneNote && <p className="mt-1 text-ui text-x-secondary">확인 메모: {task.doneNote}</p>}
      </div>
    );
  }

  const kind = (otherKindDraft ?? task.otherKind).trim();
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
  async function submit() {
    if (!isDateOnlyString(date)) { setErr(DATE_MESSAGE); return; }
    if (date > today) { setErr(DONE_DATE_FUTURE_MESSAGE); return; }
    let done: { url: string } | { note: string };
    if (linkless) {
      if (!doneNote.trim()) { setErr('확인 메모를 적어 주세요'); return; }
      done = { note: doneNote.trim() };
    } else {
      const u = url.trim();
      if (!isHttpUrl(u)) { setErr(LINK_MESSAGE); return; }
      done = { url: u };
    }
    setBusy(true);
    try { await onDone(date, done, otherKindDraft !== undefined && otherKindDraft.trim() !== task.otherKind ? otherKindDraft.trim() : undefined); }
    finally { setBusy(false); }
  }
  const canSubmit = !busy && !blockReason && (linkless ? !!doneNote.trim() : !!url.trim());

  return (
    <div ref={rootRef}>
      <p className={subTitle}>완료한 날</p>
      <input type="date" value={date} max={today} aria-label="완료한 날" onChange={(e) => { setDate(e.target.value); setErr(''); }}
             className={`${input} border-x-border-strong`} />
      {linkless ? (
        <>
          <p className="mt-3 text-content font-semibold">링크 없이 완료 확인</p>
          <p className="mt-0.5 text-ui text-x-muted">상담회 참석처럼 남길 링크가 없을 때 써요.</p>
          <p id="done-note-label" className={`${subTitle} mt-3`}>확인 메모 <span className="font-normal text-x-muted">필수</span></p>
          <input value={doneNote} maxLength={DONE_NOTE_MAX} onChange={(e) => { setDoneNote(e.target.value); setErr(''); }}
                 placeholder="예: 상담회 현장에서 참석 확인" aria-labelledby="done-note-label" className={`${input} border-x-border-strong`} />
          <p className="mt-2 text-ui text-x-secondary">정산 요청 때 이 메모가 링크 대신 정산팀에 전달돼요.</p>
        </>
      ) : (
        <>
          <p className={`${subTitle} mt-3`}>확인 링크</p>
          <input ref={inputRef} value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }}
                 placeholder="리뷰, 게시물 등 아무 링크나 붙여넣기 (https://…)" aria-label="확인 링크"
                 onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && canSubmit) void submit(); }}
                 className={`${input} border-x-border-strong`} />
          <p className="mt-1 text-ui text-x-secondary">정산팀이 이 링크로 완료를 확인해요.</p>
        </>
      )}
      {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
      <div className="mt-2.5 flex items-center justify-end gap-2">
        {blockReason && <span className="text-ui text-amber-700">{blockReason}</span>}
        {linkless && <Button type="button" onClick={() => { setLinkless(false); setErr(''); }} className="h-9 px-3.5 text-ui">취소</Button>}
        <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()} title={blockReason || undefined} className="h-9 px-3.5 text-ui">
          {busy ? '저장 중…' : '완료 확인'}
        </Button>
      </div>
      {!linkless && (
        <p className="mt-2 text-ui text-x-secondary">
          링크가 없나요?{' '}
          <button type="button" onClick={() => { setLinkless(true); setErr(''); }} className="text-x-blue-text hover:underline">링크 없이 완료 확인 ▸</button>
        </p>
      )}
      {cancelBtn}
    </div>
  );
}
