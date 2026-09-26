'use client';
import { useEffect, useRef, useState } from 'react';
import type { FlowRow } from '@/lib/campaignFlowView';
import { formatDateKo, formatDateKoLong, isDateOnlyString } from '@/lib/campaignJudgment';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';
import { postedOnFromTweetLink } from '@/lib/tweetPostedOn';
import { normalizeTargetTweetUrl, DATE_MESSAGE, POST_URL_MESSAGE } from '@/lib/campaignTaskInput';
import { PROOF_REQUIRED_MESSAGE } from '@/lib/taskProofGuard';
import { TaskProofField } from '@/components/TaskProofField';
import { Button } from '@/components/ui';
import { TargetPreview } from './TargetPreview';
import { useTweetPreview } from './useTweetPreview';

// 작업 패널의 '게시' 칸(koo 09-26 posted-inline) — 팝업(PostedDialog) 없이 칸 안에서 게시 확인까지 끝낸다.
//  · 투고·인용RT·방문협찬: 게시일을 적지 않는다. 게시물 링크를 붙이면 트윗 id에서 한국 날짜가 나오고
//    (tweetPostedOn — 서버 판정 campaignTaskInput.postedAtFromLinkGate와 같은 함수), 그 게시물을 카드로 미리 본다.
//  · RT: 자기 게시물이 없다 — 지금처럼 날짜를 적고 증빙 스크린샷(필수)을 넣는다(PostedForm과 같은 칸).
//  · 게시 뒤: 날짜 줄 + (RT 아니면) 게시물 카드, RT면 증빙 보기/없음, 그리고 내림 표시·취소.
// 미리보기(X 조회)는 붙여넣기·칸 벗어남·Enter로 "확정된" 링크에서만 부른다 — 한 글자씩 칠 때마다 id의 앞부분도
// 올바른 id라 매 글자 조회가 나간다(AGENTS.md UX 원칙 6, 비용 유발 호출).
// focus: 행 메뉴 [게시 확인]이 이 칸을 열라고 한 신호 — 한 번 쓰고 onFocused로 부모가 지운다(다른 작업에
// 갔다가 돌아와 다시 마운트될 때 옛 신호로 또 스크롤하지 않게).
const input = 'h-10 w-full rounded-md border bg-white px-2.5 text-content outline-none focus:border-x-blue';
const subTitle = 'mb-1.5 text-[14px] font-semibold text-x-secondary';

export function PostedBox({ task, today, proofSignedUrl, focus, onFocused, onMarkPosted, onZoomProof, onOpenRemoved, onUnmarkRemoved }: {
  task: FlowRow;
  today: string;
  proofSignedUrl: string | null;
  focus: boolean;
  onFocused: () => void;
  onMarkPosted: (date: string, postUrl?: string, proof?: string) => Promise<boolean>;
  onZoomProof: (url: string) => void;
  onOpenRemoved: () => void;
  onUnmarkRemoved: () => void;
}) {
  const isRt = task.type === 'rt';
  const [text, setText] = useState('');
  const [committed, setCommitted] = useState<string | null>(null);   // 붙여넣기·블러·Enter로 확정된 링크
  const [date, setDate] = useState(today);                             // RT만
  const [pendingProof, setPendingProof] = useState<string | null>(null);   // RT만 — [게시 확인]과 함께 나간다
  const [err, setErr] = useState('');                                 // RT만(날짜 형식)
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 확정된 링크의 판정 — 게시일 줄·오류·미리보기가 이 값을 본다. [게시 확인]은 같은 판정(judgeLink)을 지금 칸의 글자에 쓴다(아래).
  const link = committed ? judgeLink(committed) : null;
  const previewUrl = task.postedAt ? (isRt ? null : task.postUrl) : (link?.ok ? link.url : null);
  const prev = useTweetPreview(previewUrl);

  useEffect(() => {
    if (!focus) return;
    rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    inputRef.current?.focus({ preventScroll: true });
    onFocused();
  }, [focus, onFocused]);

  function commit(v: string) {
    const t = v.trim();
    setCommitted(t || null);
  }

  async function submit(postedOn: string, postUrl?: string, proof?: string) {
    setBusy(true);
    // 실패하면 훅이 서버 문구를 토스트로 띄우고 낙관값을 되돌린다 — 입력은 그대로 남아 다시 누를 수 있다
    try { await onMarkPosted(postedOn, postUrl, proof); } finally { setBusy(false); }
  }

  // ── 게시 뒤 ──
  if (task.postedAt) {
    return (
      <div ref={rootRef}>
        <p className="text-content">
          게시 {formatDateKoLong(task.postedAt, false)}
          {task.postUrl && (
            <> · <a href={task.postUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">게시물 보기 ↗</a></>
          )}
        </p>
        {previewUrl && (
          <div className="mt-2.5"><TargetPreview state={{ kind: 'link', url: previewUrl }} {...prev} lines={3}
                                                repostMessage="리포스트 링크로 게시 확인됐어요 — 원본 게시물이 아니라 카드를 보여줄 수 없어요" /></div>
        )}
        {isRt && (
          task.proof
            ? (
              <button type="button" disabled={!proofSignedUrl} onClick={() => proofSignedUrl && onZoomProof(proofSignedUrl)}
                      title={proofSignedUrl ? '증빙 스크린샷 — 눌러서 크게 보기' : '증빙 스크린샷 불러오는 중…'}
                      className="mt-1 rounded bg-slate-100 px-1.5 py-0.5 text-ui text-slate-600 hover:bg-slate-200 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-slate-100">
                증빙 보기
              </button>
            )
            : <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-ui text-amber-700">증빙 없음</span>
        )}
        {/* 게시 내림(koo 09-19 결정 3) — 되돌리기는 확인 없이 즉시(되돌리는 동작이라 R18과 같은 결) */}
        {task.removedAt ? (
          <div className="mt-2">
            <p className="text-content">
              내림 {formatDateKo(task.removedAt)}
              {task.removedReason && ` · ${task.removedReason}`}
            </p>
            <button type="button" onClick={onUnmarkRemoved} className="mt-1 text-ui text-x-secondary hover:underline">내림 취소</button>
          </div>
        ) : (
          <button type="button" onClick={onOpenRemoved} className="mt-2 block text-ui text-x-secondary hover:underline">내림 표시</button>
        )}
      </div>
    );
  }

  // ── 인플 미정 — 여기서 게시 확인되면 배정·교체·취소·정산이 전부 막혀 복구 길이 없다(C1-a, 행 메뉴 prePost 게이트와 같은 조건) ──
  if (task.influencerHandle === null) {
    return (
      <div ref={rootRef}>
        <Button variant="subtle" disabled title="인플루언서를 먼저 정해요" className="h-9 px-3.5 text-ui">게시 확인</Button>
        <p className="mt-1 text-ui text-x-muted">인플 선택 후</p>
      </div>
    );
  }

  // ── RT — 날짜 + 증빙(필수) ──
  if (isRt) {
    const canSubmit = !!pendingProof && !busy;
    const onRtSubmit = () => {
      if (!isDateOnlyString(date)) { setErr(DATE_MESSAGE); return; }
      void submit(date, undefined, pendingProof ?? undefined);
    };
    return (
      <div ref={rootRef}>
        <p className={subTitle}>게시된 날</p>
        <input ref={inputRef} type="date" value={date} onChange={(e) => { setDate(e.target.value); setErr(''); }}
               className={`${input} border-x-border-strong`} />
        <TaskProofField taskId={task.id} value={pendingProof} signedUrl={null}
                        postedAt={null} influencerHandle={task.influencerHandle}
                        required canRemove disabled={busy}
                        onChange={(p) => { setPendingProof(p); setErr(''); }} />
        {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
        <div className="mt-2.5 flex justify-end">
          <Button variant="primary" disabled={!canSubmit} onClick={onRtSubmit}
                  title={!pendingProof ? PROOF_REQUIRED_MESSAGE : undefined} className="h-9 px-3.5 text-ui">
            {busy ? '저장 중…' : '게시 확인'}
          </Button>
        </div>
        {/* 막힌 이유 한 줄은 TaskProofField가 이미 보여준다(required && !value의 안내 + '필수') — 여기서 또 적으면
            두 줄이 된다(리뷰 M5). 버튼 title은 남긴다. */}
      </div>
    );
  }

  // ── 투고·인용RT·방문협찬 — 링크만, 게시일은 링크에서 ──
  // 버튼은 지금 칸의 글자로 판정한다 — 링크를 치고 곧바로 버튼을 눌러도(누르는 순간 블러로 확정) 막히지 않게.
  const typed = text.trim() ? judgeLink(text.trim()) : null;
  // 순수 리포스트 링크는 막는다(리뷰 M1) — 투고·인용RT·방문협찬은 인플 본인의 게시물이어야 하고, 리포스트 id는
  // 리포스트한 시각이라 게시일도 틀린다. 미리보기 결과(kind 'repost')로만 안다 — 불러오는 중엔 막지 않는다.
  // 안내 줄은 카드 자리의 기존 문구('리포스트 링크예요 — 원본 게시물 링크로 바꿔 주세요')가 맡는다.
  const isRepost = !!link?.ok && !!typed?.ok && typed.url === link.url && prev.preview?.kind === 'repost';
  const canSubmit = !!typed?.ok && !isRepost && !busy;
  const shownErr = link && !link.ok ? link.message : '';
  return (
    <div ref={rootRef}>
      <div className="flex items-center gap-2">
        <input ref={inputRef} value={text} placeholder="게시물 링크 붙여넣기 (https://x.com/…/status/…)"
               aria-label="게시물 링크" aria-invalid={!!shownErr}
               onChange={(e) => {
                 setText(e.target.value);
                 // 붙여넣기는 그 자리에서 확정한다(주 경로) — 손으로 치는 중엔 확정하지 않는다(위 주석)
                 if ((e.nativeEvent as InputEvent).inputType === 'insertFromPaste') commit(e.target.value);
                 else if (committed !== null) setCommitted(null);
               }}
               onBlur={(e) => commit(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); commit(text); } }}
               className={`${input} min-w-0 flex-1 ${shownErr ? 'border-red-500' : 'border-x-border-strong'}`} />
        <Button variant="primary" disabled={!canSubmit}
                onClick={() => { if (typed?.ok) { commit(text); void submit(typed.postedOn, typed.url); } }}
                className="h-10 shrink-0 px-4 text-ui">
          {busy ? '저장 중…' : '게시 확인'}
        </Button>
      </div>
      {shownErr && <p role="alert" className="mt-1.5 text-ui text-red-600">{shownErr}</p>}
      {link?.ok && (
        <>
          <p className="mt-2 text-content">
            게시일 <b className="font-semibold">{formatDateKoLong(link.postedOn)}</b>
            <span className="text-ui text-x-muted"> · 링크에서 확인</span>
          </p>
          <div className="mt-2.5"><TargetPreview state={{ kind: 'link', url: link.url }} {...prev} lines={3} /></div>
        </>
      )}
    </div>
  );
}

// 링크 한 줄 판정 — 모양(tweetLink) → 정규형(서버와 같은 normalizeTargetTweetUrl) → 게시일(tweetPostedOn).
// 오류 문구는 앱 전체의 링크 문구(tweetLinkParseMessage)를 그대로 쓴다. 모양은 맞는데 날짜가 안 나오는
// id(스노플레이크 이전)는 서버가 돌려줄 문구(POST_URL_MESSAGE)와 같게 말한다.
function judgeLink(v: string): { ok: true; url: string; postedOn: string } | { ok: false; message: string } {
  const p = parseTweetLink(v);
  if (!p.ok) return { ok: false, message: tweetLinkParseMessage(p.reason) };
  const url = normalizeTargetTweetUrl(v);
  const postedOn = url ? postedOnFromTweetLink(url) : null;
  return url && postedOn ? { ok: true, url, postedOn } : { ok: false, message: POST_URL_MESSAGE };
}
