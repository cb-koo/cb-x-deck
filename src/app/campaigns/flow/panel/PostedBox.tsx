'use client';
import { useEffect, useRef, useState } from 'react';
import type { FlowRow } from '@/lib/campaignFlowView';
import { formatDateKo, formatDateKoLong, isDateOnlyString } from '@/lib/campaignJudgment';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';
import { postedOnFromTweetLink } from '@/lib/tweetPostedOn';
import { normalizeTargetTweetUrl, DATE_MESSAGE, POST_URL_MESSAGE } from '@/lib/campaignTaskInput';
import { PROOF_REQUIRED_MESSAGE } from '@/lib/taskProofGuard';
import { judgePostAuthor, authorVerdictMessage } from '@/lib/postAuthor';
import { TaskProofField } from '@/components/TaskProofField';
import { Button } from '@/components/ui';
import { TargetPreview } from './TargetPreview';
import { useTweetPreview } from './useTweetPreview';
import { PostThread } from './PostThread';

// 작업 패널의 '게시' 칸(koo 09-26 posted-inline) — 팝업(PostedDialog) 없이 칸 안에서 게시 확인까지 끝낸다.
//  · 투고·인용RT·방문협찬: 게시일을 적지 않는다. 게시물 링크를 붙이면 트윗 id에서 한국 날짜가 나오고
//    (tweetPostedOn — 서버 판정 campaignTaskInput.postedAtFromLinkGate와 같은 함수), 그 게시물을 카드로 미리 본다.
//  · RT: 자기 게시물이 없다 — 지금처럼 날짜를 적고 증빙 스크린샷(필수)을 넣는다(PostedForm과 같은 칸).
//  · 게시 뒤: 날짜 줄 + (RT 아니면) 게시물 카드, RT면 증빙 칸(TaskProofField — 크게 보기·바꾸기·받기, 없으면 올리기), 그리고 내림 표시·취소.
//  · 게시 전: 맨 아래 구분선 + [✕ 진행 안 됨](koo 09-26 시안 A). 행 메뉴의
//    [작업 취소]와 같은 창(CancelDialog)을 연다. 메뉴에만 있던 때는 아무도 못 찾아 메모로 '섭외 불성립'을 적었다.
// 미리보기(X 조회)는 붙여넣기·칸 벗어남·Enter로 "확정된" 링크에서만 부른다 — 한 글자씩 칠 때마다 id의 앞부분도
// 올바른 id라 매 글자 조회가 나간다(AGENTS.md UX 원칙 6, 비용 유발 호출).
// focus: 행 메뉴 [게시 확인]이 이 칸을 열라고 한 신호 — 한 번 쓰고 onFocused로 부모가 지운다(다른 작업에
// 갔다가 돌아와 다시 마운트될 때 옛 신호로 또 스크롤하지 않게).
const input = 'h-10 w-full rounded-md border bg-white px-2.5 text-content outline-none focus:border-x-blue';
const subTitle = 'mb-1.5 text-[14px] font-semibold text-x-secondary';
// 내림 줄 버튼 — [✕ 진행 안 됨]과 같은 크기의 테두리 버튼(위험한 동작이 아니라 회색)
const removedBtn = 'inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border border-x-border-strong bg-white px-3.5 text-[14px] font-semibold text-x-text hover:bg-x-hover';

export function PostedBox({ task, today, proofSignedUrl, focus, onFocused, onMarkPosted, onSetProof, onOpenRemoved, onUnmarkRemoved, onCancel }: {
  task: FlowRow;
  today: string;
  proofSignedUrl: string | null;
  focus: boolean;
  onFocused: () => void;
  onMarkPosted: (date: string, postUrl?: string, proof?: string) => Promise<boolean>;
  onSetProof: (path: string | null) => Promise<boolean>;   // 게시된 RT의 증빙 바꾸기(actions.setProof) — 저장 결과를 돌려준다
  onOpenRemoved: () => void;
  onUnmarkRemoved: () => void;
  onCancel: () => void;
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
    const hasReplies = !isRt && task.replies.length > 0;
    return (
      <div ref={rootRef}>
        {/* 첫 줄: 게시일 + (RT면) 증빙 상태 딱지(koo 10-01 시안 A) — 칸을 열자마자 '증빙이 있나'가 보이게.
            색은 기존 딱지 체계(정산 상태 🟢 emerald·PaymentLine 주황 amber)를 그대로 쓴다. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-content">
            게시 {formatDateKoLong(task.postedAt, false)}
            {task.postUrl && (
              <> · <a href={task.postUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">게시물 보기 ↗</a></>
            )}
          </p>
          {isRt && (
            <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-ui font-semibold ${task.proof ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              {task.proof ? '증빙 있음' : '증빙 없음'}
            </span>
          )}
        </div>
        {/* 게시된 본 게시물 + 인플 본인 댓글(추가 콘텐츠) — X 본인 스레드 모양(PostThread, koo 10-06 시안 A).
            §10(koo 10-06, X 비교): 게시된 게시물은 댓글이 없어도 X처럼 전부(본문 전체·사진 전부·인용한 글 카드) — 그래서 미리보기가 되면 늘 PostThread.
            본 게시물을 못 불러왔으면(불러오는 중·실패·리포스트) 지금의 안내 상자 아래에 댓글 글만 같은 모양으로.
            RT엔 자기 게시물이 없어 붙지 않는다 */}
        {previewUrl && (prev.preview?.kind === 'ok' ? (
          <div className="mt-2.5">
            <PostThread main={prev.preview.tweet} replies={hasReplies ? task.replies : []} fallbackHandle={task.influencerHandle}
                        mainStats={{ views: task.perf?.views ?? prev.preview.tweet.metrics.views, likes: task.perf?.likes ?? prev.preview.tweet.metrics.likes }} />
          </div>
        ) : (
          <div className="mt-2.5"><TargetPreview state={{ kind: 'link', url: previewUrl }} {...prev} lines={3}
                                                repostMessage="리포스트 링크로 게시 확인됐어요 — 원본 게시물이 아니라 카드를 보여줄 수 없어요" /></div>
        ))}
        {hasReplies && !(previewUrl && prev.preview?.kind === 'ok') && (
          <div className="mt-2.5">
            <PostThread main={null} replies={task.replies} fallbackHandle={task.influencerHandle} mainStats={{ views: null, likes: null }} />
          </div>
        )}
        {/* RT 증빙(koo 10-01) — 파일 카드: 썸네일 | 제목·올린 정보 | [보기·바꾸기·받기]. 게시된 RT는 서버가 증빙 비우기를 거절하므로 지우기는 없다(canRemove=false) —
            '지우고 다시 올리기'는 [바꾸기]로 연 교체 상자에 새 스크린샷을 붙여넣는 한 동작이다. 증빙이 없는 옛 데이터면 올리기 상자가 바로 뜬다
            (없다는 사실은 위 딱지가 말한다).
            key를 주지 않는다 — 실패한 바꾸기가 롤백되면 TaskProofField가 옛 이미지(signedUrl)로 알아서 돌아간다(PostedCell과 같은 이유). */}
        {isRt && (
          <TaskProofField taskId={task.id} value={task.proof?.url ?? null} signedUrl={proofSignedUrl}
                          postedAt={task.postedAt} influencerHandle={task.influencerHandle}
                          uploaded={task.proof ? { byName: task.proof.byName, at: task.proof.at } : null}
                          required={false} canRemove={false} disabled={false}
                          onChange={(p) => onSetProof(p)} />
        )}
        {/* 게시 내림(koo 09-19 결정 3) — 증빙에 붙어 보이지 않게 구분선 아래 따로 한 줄(koo 10-01 시안 A, 게시 전의 [✕ 진행 안 됨] 줄과 같은 모양).
            되돌리기는 확인 없이 즉시(되돌리는 동작이라 R18과 같은 결) */}
        <div className="-mx-4 mt-3.5 flex items-center justify-between gap-3 border-t border-x-border px-4 pt-3">
          {task.removedAt ? (
            <>
              <span className="min-w-0 text-content">
                내림 {formatDateKo(task.removedAt)}
                {task.removedReason && <span className="text-x-secondary"> · {task.removedReason}</span>}
              </span>
              <button type="button" onClick={onUnmarkRemoved} className={removedBtn}>내림 취소</button>
            </>
          ) : (
            <>
              <span className="text-[14px] text-x-secondary">게시물을 내렸다면</span>
              <button type="button" onClick={onOpenRemoved} className={removedBtn}>내림 표시</button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── 게시 전 공통 — 진행이 안 된 작업(거절·무응답 등)을 여기서 바로 취소한다 ──
  // 게시 칸 안을 구분선으로 나눠 '게시됨'과 '진행 안 됨' 두 결말을 보여준다(koo 09-26 시안 A). 빨간 테두리지만
  // 검은 [게시 확인]보다 약하게 — 주 동작과 헷갈리지 않게. 구분선은 섹션 안쪽 여백(px-4)까지 끝까지 긋는다.
  const cancelBtn = (
    <div className="-mx-4 mt-3.5 flex items-center justify-between gap-3 border-t border-x-border px-4 pt-3">
      <span className="text-[14px] text-x-secondary">진행이 안 됐다면</span>
      <button type="button" onClick={onCancel} title="거절·무응답 등으로 진행이 안 된 작업을 취소해요 — 취소해도 되돌릴 수 있어요"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-red-200 bg-white px-3.5 text-[14px] font-semibold text-red-600 hover:bg-red-50">
        ✕ 진행 안 됨
      </button>
    </div>
  );

  // ── 인플 미정 — 여기서 게시 확인되면 배정·교체·취소·정산이 전부 막혀 복구 길이 없다(C1-a, 행 메뉴 prePost 게이트와 같은 조건) ──
  // 안내 문구는 postAuthor.ts의 unassigned 문구(spec §4)와 같은 말을 쓴다 — 서버 거절 문구와 화면 안내가 어긋나지 않게.
  if (task.influencerHandle === null) {
    return (
      <div ref={rootRef}>
        <Button variant="subtle" disabled title="인플루언서를 먼저 정해요" className="h-9 px-3.5 text-ui">게시 확인</Button>
        <p className="mt-1 text-ui text-x-muted">{authorVerdictMessage({ kind: 'unassigned' }).error}</p>
        {cancelBtn}
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
        {cancelBtn}
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
  // 작성자 확인(spec §4·§5) — 미리보기가 'ok'로 온 뒤에만 판정한다. 조회 실패·불러오는 중엔 버튼을 막지 않는다(서버가 최종 판정, §5).
  // 화면 비교는 핸들만(고유번호는 서버만 안다) — task.influencerHandle은 여기 도달했다는 것 자체로 null이 아니다(위 인플 미정 분기가 먼저 걸러낸다).
  // 칸 글자가 확정된 링크와 같을 때만 — 다른 링크를 치는 중에 옛 링크의 불일치로 버튼이 막혀 있지 않게(isRepost와 같은 조건, 최종 리뷰)
  const authorVerdict = link?.ok && !!typed?.ok && typed.url === link.url && prev.preview?.kind === 'ok'
    ? judgePostAuthor({
        author: { handle: prev.preview.tweet.authorHandle, userId: null },
        assigned: { handle: task.influencerHandle, xUserId: null },
      })
    : null;
  const authorMismatch = authorVerdict?.kind === 'mismatch' ? authorVerdictMessage(authorVerdict) : null;
  const canSubmit = !!typed?.ok && !isRepost && !authorMismatch && !busy;
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
        <Button variant="primary" disabled={!canSubmit} title={authorMismatch ? authorMismatch.error : undefined}
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
          {authorMismatch && <p role="alert" className="mt-1.5 text-ui text-red-600">{authorMismatch.error}</p>}
        </>
      )}
      {cancelBtn}
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
