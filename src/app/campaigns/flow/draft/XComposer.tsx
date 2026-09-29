'use client';
import { useRef, useState } from 'react';
import { X_MAX_WEIGHTED, xWeightedLength } from '@/lib/xLength';
import { selectDraftImages, MAX_MEDIA_PER_POST } from '@/lib/draftMedia';
import type { ComposerPost } from '@/lib/draftPickView';
import { useSignedMedia } from '@/components/useSignedMedia';
import { MediaGrid } from '@/components/MediaGrid';
import { MediaIcon, BlueCheckIcon } from '@/components/XIcons';
import { Avatar } from '@/components/Avatar';
import { imageFilesFromClipboard } from '@/lib/clipboardImages';

// 직접 쓰기(§5-2) — X 작성 화면의 모양을 가져온 컴포저. DraftWriteModal(기존 두 번째 입구)과 갈리는
// 지점 하나: 저장 전엔 서버를 안 부르는 DraftWriteModal과 달리, 이미지는 고르는 순간 올라간다.
// 업로드 자체(uploadPendingDraftImage 호출)는 이 컴포넌트가 하지 않는다 — onPickImages로 골라낸 파일만
// 부모(DraftWrite)에 넘기고, 그 결과(올라간 이미지·올라가는 중인 개수)는 posts prop(media·uploading)으로
// 되돌려받는다. uploading은 칸(ComposerPost)에 직접 실린 값이라(draftPickView.ts 주석) 칸별로 진행을
// 보여줄 수 있고, 총합은 이 컴포넌트가 posts를 접어서 낸다(부모가 따로 셀 필요가 없다).
export function XComposer({ handle, author, posts, onChange, onPickImages, disabledReason }: {
  handle: string | null;
  // 명부의 표시 이름·프로필 사진(koo 09-28) — 패널 인플루언서 칸과 같은 데이터(FlowDetail.optionFor). 없으면 첫 글자.
  author?: { name?: string; avatarUrl?: string; blueVerified?: boolean };
  posts: ComposerPost[];
  onChange: (next: ComposerPost[]) => void;
  onPickImages: (postIndex: number, files: File[]) => void;
  // 전체를 잠그는 진짜 이유 — 부모(DraftWrite)가 '저장하는 중이에요'·'글은 저장됐어요 — 붙이기만
  // 다시 시도하면 돼요' 등 그 순간 참인 문장을 준다(자문 리뷰) — boolean이었을 때는 이유를 이 컴포넌트가
  // '저장하는 중이에요'로 혼자 지어냈는데, 붙이기만 재시도하는 동안(저장 중이 아님)에도 그 문구가 뜨는
  // 거짓 어포던스가 생겼다. null/undefined면 안 막혀 있다는 뜻.
  disabledReason?: string | null;
}) {
  const [rejectMsg, setRejectMsg] = useState<Record<number, string>>({});
  const fileInputs = useRef<Array<HTMLInputElement | null>>([]);
  // 서명 URL 발급은 카드·편집 모달과 같은 훅으로 딱 한 번(posts 배열 전체) — 포스트마다 부르면 스레드
  // 칸 추가·삭제로 개수가 바뀔 때 훅 호출 수가 달라져 React가 죽는다(useSignedMedia.ts 머리 주석).
  const { posts: signedPosts } = useSignedMedia(posts);
  const disabled = !!disabledReason;
  // 칸 구조(추가·삭제)는 어느 칸이든 업로드 중이면 잠근다 — onPickImages(postIndex, files)가 인덱스로
  // 목적지를 기억하는데, 업로드가 끝나기 전에 칸이 밀리면 방금 고른 이미지가 엉뚱한 칸에 붙는다. 본문
  // 입력·이미지 더 고르기는 잠그지 않는다 — 그 둘은 인덱스가 안 바뀌므로 위험이 없다(X도 업로드 중 계속
  // 타이핑 가능). 같은 칸에 더 고르는 것만 따로 막는다(pickFiles) — 리뷰 지적 1.
  const anyUploading = posts.some((p) => p.uploading > 0);
  const structureLocked = disabled || anyUploading;
  // 칸 지우기·스레드 이어 쓰기가 막힌 진짜 이유 — 거짓 어포던스 금지(AGENTS 원칙 5). null이면 안 막혀 있다.
  const structureLockedReason = disabledReason ?? (anyUploading ? '이미지를 올리는 중이에요' : null);
  // 도구줄(이미지·글자 수·스레드 +)은 지금 쓰는 칸에만 — X와 같다. 칸마다 되풀이하면 스레드가 길수록 복잡해진다(koo 09-28).
  // 다른 칸의 이미지·글자 수는 그 칸을 누르면(포커스) 도구줄이 그쪽으로 옮겨 온다. 글자 수가 넘은 칸은 머리줄이 따로 알린다.
  const [active, setActive] = useState(0);
  const activeIdx = Math.min(active, posts.length - 1);

  function updateText(i: number, text: string) {
    onChange(posts.map((p, j) => (j === i ? { ...p, text } : p)));
  }
  function removeMedia(postIndex: number, mediaIndex: number) {
    onChange(posts.map((p, j) => (j === postIndex ? { ...p, media: p.media.filter((_, k) => k !== mediaIndex) } : p)));
  }
  function addSlot() {
    onChange([...posts, { text: '', media: [], uploading: 0 }]);
    setActive(posts.length);   // 새 칸으로 도구줄을 옮긴다(autoFocus가 그 칸에 초점도 준다)
  }
  function removeSlotAt(i: number) {
    onChange(posts.filter((_, j) => j !== i));
    setActive((a) => (a > i ? a - 1 : a === i ? Math.max(0, i - 1) : a));
    // 인덱스별로 골라 지우지 않는다 — 지운 칸보다 뒤쪽 메시지는 인덱스가 한 칸씩 밀리는데 내용은 그대로라,
    // 엉뚱한 칸 아래에 남의 거절 사유가 붙는다(표시된 이유가 사실과 달라진다). 거절 메시지는 어차피
    // 일시적인 안내라 구조가 바뀌면 전부 지우는 편이 더 간단하고 항상 맞다.
    setRejectMsg({});
  }
  function pickFiles(i: number, files: File[]) {
    if (files.length === 0) return;
    // 이 칸이 이미 올라가는 중이면 더 고르지 못하게 막는다(리뷰 지적 1) — 안 막으면 remaining이 '이미
    // 올라간 것'만 세서, 올라가는 중에 더 고르면 상한을 넘겨 받고 저장할 때 normalizeDraftMedia가
    // 넘친 것을 말없이 자른다(이미 올라간 파일은 스토리지에 남는다). 문구는 선례(DraftCard.tsx의
    // attachFiles)와 같다.
    if (posts[i].uploading > 0) {
      setRejectMsg((cur) => ({ ...cur, [i]: '올리는 중이에요 — 끝나면 이어서 올려주세요' }));
      return;
    }
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

  const name = author?.name?.trim() || null;
  return (
    <div>
      {posts.map((p, i) => {
        const len = xWeightedLength(p.text);
        const remain = X_MAX_WEIGHTED - len;
        // 블루마크 계정은 280을 넘겨도 X에 올릴 수 있다 — 넘음 표시(빨강·음수·'N자 넘음')를 하지 않는다(koo 09-28)
        const over = !author?.blueVerified && remain < 0;
        const full = p.media.length >= MAX_MEDIA_PER_POST;
        const media = signedPosts[i]?.media ?? p.media;
        const isActive = i === activeIdx;
        return (
          <div key={i} className="relative flex gap-3 pb-3 pt-1">
            {/* 칸 사이 세로 연결선 — 아바타(40px) 중심을 잇는다 */}
            {i < posts.length - 1 && <span aria-hidden className="absolute left-5 top-12 bottom-0 w-0.5 bg-x-border" />}
            {handle
              ? <Avatar url={author?.avatarUrl} name={name || handle} size={40} />
              : <span aria-hidden className="h-10 w-10 shrink-0 rounded-full bg-x-border" />}
            <div className="min-w-0 flex-1">
              {/* 머리줄 — X처럼 '이름 @핸들'. 스레드면 칸 번호와 '칸 지우기'(그 칸 오른쪽 끝) */}
              <div className="flex items-baseline gap-1.5">
                <p className="min-w-0 truncate text-content">
                  {handle
                    ? <>{name ? <b className="font-bold">{name}</b> : <b className="font-bold">@{handle}</b>}
                        {author?.blueVerified && <> <BlueCheckIcon className="inline h-4 w-4 align-[-3px]" /></>}
                        {name && <> <span className="text-x-secondary">@{handle}</span></>}</>
                    : <span className="text-x-muted">인플루언서 미정</span>}
                </p>
                {posts.length > 1 && <span className="shrink-0 text-ui font-semibold tabular-nums text-x-muted">{i + 1}/{posts.length}</span>}
                {!isActive && over && <span className="shrink-0 text-ui text-red-600">{-remain}자 넘음</span>}
                {posts.length > 1 && (
                  // 막혔으면 title로 진짜 이유를 말한다(거짓 어포던스 금지 — 흐림만으로는 왜 안 되는지 안 보인다)
                  <button type="button" disabled={structureLocked} onClick={() => removeSlotAt(i)}
                          title={structureLockedReason ?? undefined}
                          className="ml-auto shrink-0 text-ui text-x-muted hover:text-red-600 disabled:opacity-40">
                    칸 지우기
                  </button>
                )}
              </div>
              {/* 쓰는 만큼 자란다(field-sizing) — 크기 조절 손잡이는 없앤다(koo 09-28). 지원 안 하는 브라우저는 rows 계산이 받친다 */}
              <textarea value={p.text} rows={Math.max(3, p.text.split('\n').length + 1)}
                        onChange={(e) => updateText(i, e.target.value)} onFocus={() => setActive(i)} disabled={disabled}
                        // ⌘V에 이미지가 있으면 이 칸에 이미지로(koo 09-29) — 고르기와 같은 pickFiles(장수·형식·업로드 중 검사 그대로). 글자면 그대로
                        onPaste={(e) => { const imgs = imageFilesFromClipboard(e.clipboardData); if (imgs.length === 0) return; e.preventDefault(); pickFiles(i, imgs); }}
                        // 전역 :focus-visible 테두리(globals.css)는 글상자엔 마우스 클릭에도 뜬다 — 이 본문은 깜빡이는 커서가 이미
                        // 초점을 보여주고 X 작성 화면에도 테두리가 없어 이 칸만 끈다(인라인이라 레이어 밖 전역 규칙을 이긴다).
                        style={{ outline: 'none' }}
                        className="mt-0.5 min-h-[84px] w-full resize-none bg-transparent text-[20px] leading-7 [field-sizing:content] placeholder:text-x-muted disabled:opacity-60"
                        placeholder="원고를 써 주세요" autoFocus={i === 0 || i === posts.length - 1 && i === activeIdx}
                        aria-label={posts.length > 1 ? `본문 ${i + 1}번째 칸` : '본문'} />

              <MediaGrid media={media} renderOverlay={disabled ? undefined : (k) => (
                <div className="group h-full w-full">
                  <button type="button" onClick={() => removeMedia(i, k)} aria-label="이미지 떼기" title="이미지 떼기"
                          className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-black/60 text-[13px] leading-none text-white hover:bg-black/80 group-hover:flex">
                    ✕
                  </button>
                </div>
              )} />
              {/* 업로드 진행·거절 이유는 그 칸 바로 아래에(칸마다 자기 것을 보여준다) */}
              {p.uploading > 0 && <p className="mt-1 text-ui text-x-muted">이미지를 올리는 중이에요</p>}
              {rejectMsg[i] && <p className="mt-1 text-ui text-red-500">{rejectMsg[i]}</p>}

              <input ref={(el) => { fileInputs.current[i] = el; }} type="file" multiple
                     accept="image/jpeg,image/png,image/gif,image/webp" className="hidden"
                     onChange={(e) => {
                       const files = Array.from(e.target.files ?? []);
                       e.target.value = ''; // 같은 파일을 다시 골라도 change가 다시 뜨도록
                       pickFiles(i, files);
                     }} />
              {isActive && (
                // 도구줄 — 구분선 위로 한 줄: 왼쪽 이미지, 오른쪽 글자 수 원 | + 스레드(X와 같은 자리)
                <div className="mt-2 flex items-center gap-1 border-t border-x-border pt-2">
                  <button type="button" onClick={() => fileInputs.current[i]?.click()}
                          disabled={disabled || full || p.uploading > 0} aria-label="이미지 첨부"
                          title={p.uploading > 0 ? '올리는 중이에요 — 끝나면 이어서 올려주세요' : full ? `트윗당 ${MAX_MEDIA_PER_POST}장까지예요` : '이미지 첨부 — 본문에 ⌘V로 붙여 넣어도 돼요'}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-x-blue hover:bg-x-blue/10 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent">
                    <MediaIcon className="h-5 w-5" />
                  </button>
                  {/* 0장일 때 '0/4'는 아직 필요 없는 정보다 — 상한은 4장에 가까워질 때 의미가 생긴다(AGENTS 원칙 2) */}
                  {p.media.length > 0 && <span className="text-ui tabular-nums text-x-muted">{p.media.length}/{MAX_MEDIA_PER_POST}</span>}
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {/* 원형 카운터 — 남은 글자가 20 이하면 숫자를 같이 보여준다(X와 같은 규칙) */}
                    <span className={`text-ui tabular-nums ${over ? 'text-red-600' : 'text-x-muted'}`}>{remain <= 20 && (over || remain >= 0) ? remain : ''}</span>
                    <svg viewBox="0 0 20 20" className="h-6 w-6 -rotate-90" aria-hidden>
                      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" className="text-x-border" strokeWidth="2" />
                      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2"
                              className={over ? 'text-red-600' : 'text-x-blue'}
                              strokeDasharray={`${Math.min(1, len / X_MAX_WEIGHTED) * 50.3} 50.3`} />
                    </svg>
                    <span aria-hidden className="mx-1.5 h-6 w-px bg-x-border" />
                    <button type="button" disabled={structureLocked} onClick={addSlot} aria-label="스레드로 이어 쓰기"
                            title={structureLockedReason ?? '스레드로 이어 쓰기'}
                            className="flex h-7 w-7 items-center justify-center rounded-full border border-x-border-strong text-[18px] leading-none text-x-blue hover:bg-x-blue/10 disabled:cursor-not-allowed disabled:opacity-40">
                      +
                    </button>
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
      {/* 칸 지우기·+ 가 막힌 진짜 이유는 한 번만(칸마다 되풀이하지 않는다). 업로드 중이라 막힌 건 그 칸 아래가 이미 말한다. */}
      {disabledReason && <p className="pl-[52px] text-ui text-x-muted">{disabledReason}</p>}
    </div>
  );
}
