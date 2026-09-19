'use client';
import { useRef, useState } from 'react';
import { X_MAX_WEIGHTED, xWeightedLength } from '@/lib/xLength';
import { selectDraftImages, MAX_MEDIA_PER_POST } from '@/lib/draftMedia';
import { handleInitial } from '@/lib/campaignTableView';
import type { ComposerPost } from '@/lib/draftPickView';
import { useSignedMedia } from '@/components/useSignedMedia';
import { MediaGrid } from '@/components/MediaGrid';
import { MediaIcon } from '@/components/XIcons';

// 직접 쓰기(§5-2) — X 작성 화면의 모양을 가져온 컴포저. DraftWriteModal(기존 두 번째 입구)과 갈리는
// 지점 하나: 저장 전엔 서버를 안 부르는 DraftWriteModal과 달리, 이미지는 고르는 순간 올라간다.
// 업로드 자체(uploadPendingDraftImage 호출)는 이 컴포넌트가 하지 않는다 — onPickImages로 골라낸 파일만
// 부모(DraftWrite)에 넘기고, 그 결과(올라간 이미지)는 posts prop(media)으로 되돌려받는다. 그래야
// "지금 몇 장이 올라가는 중인가"(uploading)를 부모가 [저장하고 붙이기] 잠금과 함께 한 곳에서 센다.
export function XComposer({ handle, posts, onChange, onPickImages, uploading, disabled }: {
  handle: string | null;
  posts: ComposerPost[];
  onChange: (next: ComposerPost[]) => void;
  onPickImages: (postIndex: number, files: File[]) => void;
  uploading: number;   // 지금 올라가는 중인 이미지 수(부모가 센다)
  disabled?: boolean;  // 저장하는 동안 — 전체를 잠근다
}) {
  const [rejectMsg, setRejectMsg] = useState<Record<number, string>>({});
  const fileInputs = useRef<Array<HTMLInputElement | null>>([]);
  // 서명 URL 발급은 카드·편집 모달과 같은 훅으로 딱 한 번(posts 배열 전체) — 포스트마다 부르면 스레드
  // 칸 추가·삭제로 개수가 바뀔 때 훅 호출 수가 달라져 React가 죽는다(useSignedMedia.ts 머리 주석).
  const { posts: signedPosts } = useSignedMedia(posts);
  // 칸 구조(추가·삭제)는 업로드 중에도 잠근다 — onPickImages(postIndex, files)가 인덱스로 목적지를
  // 기억하는데, 업로드가 끝나기 전에 칸이 밀리면 방금 고른 이미지가 엉뚱한 칸에 붙는다. 본문 입력·이미지
  // 더 고르기는 잠그지 않는다 — 그 둘은 인덱스가 안 바뀌므로 위험이 없다(X도 업로드 중 계속 타이핑 가능).
  const structureLocked = !!disabled || uploading > 0;
  const avatarInitial = handle ? handleInitial(handle) : '·';

  function updateText(i: number, text: string) {
    onChange(posts.map((p, j) => (j === i ? { ...p, text } : p)));
  }
  function removeMedia(postIndex: number, mediaIndex: number) {
    onChange(posts.map((p, j) => (j === postIndex ? { ...p, media: p.media.filter((_, k) => k !== mediaIndex) } : p)));
  }
  function addSlot() {
    onChange([...posts, { text: '', media: [] }]);
  }
  function removeSlotAt(i: number) {
    onChange(posts.filter((_, j) => j !== i));
    setRejectMsg((cur) => { const next = { ...cur }; delete next[i]; return next; });
  }
  function pickFiles(i: number, files: File[]) {
    if (files.length === 0) return;
    const remaining = MAX_MEDIA_PER_POST - posts[i].media.length;
    if (remaining <= 0) {
      setRejectMsg((cur) => ({ ...cur, [i]: `트윗당 ${MAX_MEDIA_PER_POST}장까지예요 — 먼저 기존 이미지를 떼어주세요` }));
      return;
    }
    const { accepted, rejected, slotMessage } = selectDraftImages(files, remaining);
    // 자리 부족 사유는 slotMessage 한 줄로 이미 요약되므로, 같은 사유의 개별 항목은 중복 표시하지 않는다
    // (DraftEditModal.attachFiles와 같은 규칙).
    const reasons = slotMessage ? [slotMessage] : [...new Set(rejected.map((r) => r.reason))];
    setRejectMsg((cur) => ({ ...cur, [i]: reasons.join(' · ') }));
    if (accepted.length > 0) onPickImages(i, accepted);
  }

  return (
    <div>
      {posts.map((p, i) => {
        const len = xWeightedLength(p.text);
        const remain = X_MAX_WEIGHTED - len;
        const over = remain < 0;
        const full = p.media.length >= MAX_MEDIA_PER_POST;
        const media = signedPosts[i]?.media ?? p.media;
        return (
          <div key={i} className="relative flex gap-3 py-2">
            {/* 칸 사이 세로 연결선 — 아바타(40px) 중심을 잇는다 */}
            {i < posts.length - 1 && <span aria-hidden className="absolute left-5 top-12 bottom-[-8px] w-px bg-x-border" />}
            <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-x-blue text-[15px] font-bold text-white">
              {avatarInitial}
            </span>
            <div className="min-w-0 flex-1">
              {handle
                ? <p className="text-ui font-bold text-x-text">@{handle}</p>
                : <p className="text-ui text-x-muted">인플루언서 미정</p>}
              {posts.length > 1 && <p className="text-caption font-bold text-x-muted">{i + 1} / {posts.length}</p>}
              <textarea value={p.text} rows={Math.max(3, p.text.split('\n').length + 1)}
                        onChange={(e) => updateText(i, e.target.value)} disabled={disabled}
                        className="w-full resize-y text-[20px] leading-6 outline-none placeholder:text-x-muted disabled:opacity-60"
                        placeholder="무슨 일이 있었나요?" autoFocus={i === 0}
                        aria-label={posts.length > 1 ? `본문 ${i + 1}번째 칸` : '본문'} />

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input ref={(el) => { fileInputs.current[i] = el; }} type="file" multiple
                       accept="image/jpeg,image/png,image/gif,image/webp" className="hidden"
                       onChange={(e) => {
                         const files = Array.from(e.target.files ?? []);
                         e.target.value = ''; // 같은 파일을 다시 골라도 change가 다시 뜨도록
                         pickFiles(i, files);
                       }} />
                <button type="button" onClick={() => fileInputs.current[i]?.click()}
                        disabled={disabled || full} aria-label="이미지 첨부"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-x-blue hover:bg-x-blue/10 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent">
                  <MediaIcon className="h-5 w-5" />
                </button>
                {/* 0장일 때 '0/4'는 아직 필요 없는 정보다 — 상한은 4장에 가까워질 때 의미가 생긴다(AGENTS 원칙 2) */}
                {p.media.length > 0 && <span className="text-caption tabular-nums text-x-muted">{p.media.length}/{MAX_MEDIA_PER_POST}</span>}
                {/* 칸 삭제는 칸이 둘 이상일 때만(0칸 원고는 저장할 수 없다) */}
                {posts.length > 1 && (
                  <button type="button" disabled={structureLocked} onClick={() => removeSlotAt(i)}
                          className="text-caption text-x-muted hover:text-red-600 disabled:opacity-40">
                    칸 지우기
                  </button>
                )}
                {/* 오른쪽 아래 원형 카운터 — 남은 글자가 20 이하면 숫자를 같이 보여준다(X와 같은 규칙) */}
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <span className={`text-caption tabular-nums ${over ? 'text-red-600' : 'text-x-muted'}`}>
                    {remain <= 20 ? remain : ''}
                  </span>
                  <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90" aria-hidden>
                    <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" className="text-x-border" strokeWidth="2" />
                    <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2"
                            className={over ? 'text-red-600' : 'text-x-blue'}
                            strokeDasharray={`${Math.min(1, len / X_MAX_WEIGHTED) * 50.3} 50.3`} />
                  </svg>
                </span>
              </div>
              {/* 거절된 파일은 이유를 한 줄로 말한다 */}
              {rejectMsg[i] && <p className="mt-1 text-caption text-red-500">{rejectMsg[i]}</p>}

              <MediaGrid media={media} renderOverlay={disabled ? undefined : (k) => (
                <div className="group h-full w-full">
                  <button type="button" onClick={() => removeMedia(i, k)} aria-label="이미지 떼기" title="이미지 떼기"
                          className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-black/60 text-[13px] leading-none text-white hover:bg-black/80 group-hover:flex">
                    ✕
                  </button>
                </div>
              )} />
            </div>
          </div>
        );
      })}

      {/* 마지막 칸 아래 + 버튼 — 아바타 열에 맞춘다(40px + gap 12px = 52px) */}
      <div className="flex items-center gap-2 pl-[52px]">
        <button type="button" disabled={structureLocked} onClick={addSlot} aria-label="스레드로 이어 쓰기"
                title="스레드로 이어 쓰기"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-x-border-strong text-x-blue hover:bg-x-blue/10 disabled:cursor-not-allowed disabled:opacity-40">
          +
        </button>
        {posts.length === 1 && <span className="text-caption text-x-muted">스레드로 이어 쓸 수 있어요</span>}
        {uploading > 0 && <span className="ml-auto text-caption text-x-muted">이미지를 올리는 중이에요</span>}
      </div>
    </div>
  );
}
