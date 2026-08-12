'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { DraftRow } from '@/lib/draftStore';
import type { DraftContent, DraftPost } from '@/lib/draftTypes';
import type { DeckMedia } from '@/lib/types';
import { xWeightedLength, X_MAX_WEIGHTED } from '@/lib/xLength';
import { textsChanged } from '@/lib/draftUi';
import { uploadDraftImage, selectDraftImages, MAX_MEDIA_PER_POST } from '@/lib/draftMedia';
import { useSignedMedia } from '@/components/useSignedMedia';
import { MediaGrid } from '@/components/MediaGrid';
import { InfoTip } from '@/components/InfoTip';
import { MediaIcon } from '@/components/XIcons';

// X 컴포즈 모달 구조: ✕ / 원본과 비교 / 아바타 40 / 입력 20px·lh24 / 하단 바 + 저장 36px (스펙 §4)
// 저장 완료 콜백이 둘인 이유: 텍스트 저장은 "저장 버튼을 눌러 편집을 마쳤다"는 뜻이라 모달이 닫혀야
// 하지만, 이미지 첨부·떼기는 즉시 저장이라 붙일 때마다 모달이 닫히면 두 장째를 못 붙인다.
// 한 콜백으로 합치면 호출부가 "이번 건 닫아도 되는 저장인가"를 다시 판별해야 한다 — 여기서 나눈다.
export function DraftEditModal({ draft, onClose, onSaved, onMediaSaved }: {
  draft: DraftRow; onClose: () => void;
  onSaved: (updated: DraftRow) => void;        // 텍스트 저장 완료 — 호출부가 모달을 닫는다
  onMediaSaved: (updated: DraftRow) => void;   // 이미지 즉시 저장 완료 — 목록만 갱신하고 모달은 열어둔다
}) {
  const base = draft.edited ?? draft.content;
  const [texts, setTexts] = useState(base.posts.map((p) => p.text));
  // 첨부는 즉시 저장되므로(설계 §확정 판단) 텍스트와는 별도로 "마지막으로 서버에 반영된 텍스트"를
  // 들고 있는다. 이미지만 붙이거나 뗄 때도 같은 edited jsonb를 통째로 써야 하는데, 그 순간 아직
  // 저장 버튼을 안 누른 texts(초안 편집 중)를 함께 실어 보내면 "저장 안 눌렀는데 텍스트가 저장됐다"는
  // 사고가 난다. 그래서 이미지 PATCH는 항상 이 savedTexts를 쓰고, texts는 저장 버튼을 눌렀을 때만 반영된다.
  const [savedTexts, setSavedTexts] = useState(base.posts.map((p) => p.text));
  const [media, setMedia] = useState<DeckMedia[][]>(base.posts.map((p) => p.media));
  const [compare, setCompare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // 이미지 PATCH 진행 중인 포스트 인덱스 — null이면 아무 것도 진행 중이 아니다.
  // 텍스트 저장(saving)과 이미지 저장(busyPost)이 같은 edited jsonb를 쓰므로, 둘 중 하나가 진행
  // 중이면 다른 쪽 컨트롤을 모두 잠가 두 PATCH가 동시에 나가지 않게 한다(경쟁 방지의 핵심).
  const [busyPost, setBusyPost] = useState<number | null>(null);
  const [mediaErr, setMediaErr] = useState<Record<number, string>>({});
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const fileInputs = useRef<Array<HTMLInputElement | null>>([]);
  const mediaBusy = saving || busyPost !== null;

  const empty = texts.some((t) => !t.trim());
  // dirty 판정은 텍스트 기준 그대로 — 미디어는 이미 저장돼 있으므로 넣으면 "저장 안 됨" 거짓 경고가 된다(설계 §확정 판단).
  const dirty = textsChanged(savedTexts, texts);

  // 서명 URL 발급은 카드와 같은 훅으로 딱 한 번 — 포스트마다 부르면 훅 개수가 바뀌어 크래시한다.
  // text는 서명과 무관해 빈 문자열로 채운다(이 훅은 media만 본다).
  const mediaPosts = useMemo<DraftPost[]>(() => media.map((m) => ({ text: '', media: m })), [media]);
  const { posts: signedPosts } = useSignedMedia(mediaPosts);
  // resign(만료 재서명)은 <img onError>에 연결해야 하는데 MediaGrid는 그 훅을 노출하지 않는다.
  // 이 모달은 열려 있는 짧은 시간(분 단위) 안에서만 쓰여 24시간 만료를 실제로 만날 일이 없어 지금은 안 쓴다.

  // 이 모달엔 별도 '취소' 버튼이 없어 ✕·Esc·배경 클릭 모두 확인 대상 (스펙 3-3)
  function requestClose() {
    if (!dirty || window.confirm('저장하지 않은 수정이 있어요. 닫을까요?')) onClose();
  }

  // Esc로 모달 닫기 — ColumnSettings 선례와 동일한 방식. IME 조합 중 Esc는 무시.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      if (!dirty || window.confirm('저장하지 않은 수정이 있어요. 닫을까요?')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dirty, onClose]);

  async function save() {
    if (mediaBusy) return; // 이미지 PATCH가 진행 중이면 기다린다 — 같은 edited를 동시에 쓰지 않기 위해
    setErr(''); setSaving(true);
    const edited: DraftContent = {
      // base.posts(마운트 시점에 캡처된 값)가 아니라 지금 이 화면의 media를 쓴다 — 모달이 열려 있는
      // 동안 첨부/떼기로 이미 서버에 반영된 이미지를, 텍스트 저장이 캡처된 옛 값으로 덮어써 지우는
      // 사고를 막는다(리뷰에서 발견된 결함).
      posts: texts.map((t, i) => ({ text: t, media: media[i] })),
    };
    const r = await apiFetch(`/api/drafts/${draft.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edited }),
    });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? `오류 ${r.status}`); return; }
    const updated = (await r.json()) as DraftRow;
    setSavedTexts(texts); // 이제부터 이미지 PATCH도 이 텍스트를 기준으로 나간다
    onSaved(updated);
  }

  // 이미지 PATCH — 첨부·떼기 공통. savedTexts(마지막으로 저장 확인된 텍스트)로 edited를 조립해
  // 아직 저장 버튼을 안 누른 texts가 함께 실려 나가지 않게 한다.
  async function patchMedia(nextMedia: DeckMedia[][]): Promise<DraftRow | null> {
    const edited: DraftContent = { posts: savedTexts.map((t, j) => ({ text: t, media: nextMedia[j] })) };
    const r = await apiFetch(`/api/drafts/${draft.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edited }),
    });
    if (!r.ok) return null;
    return (await r.json()) as DraftRow;
  }

  async function attachFiles(i: number, files: File[]) {
    if (files.length === 0 || mediaBusy || compare) return;
    const remaining = MAX_MEDIA_PER_POST - media[i].length;
    if (remaining <= 0) {
      setMediaErr((cur) => ({ ...cur, [i]: `트윗당 ${MAX_MEDIA_PER_POST}장까지예요 — 먼저 기존 이미지를 떼어주세요` }));
      return;
    }
    const { accepted, rejected, slotMessage } = selectDraftImages(files, remaining);
    const overflowReason = `트윗당 ${MAX_MEDIA_PER_POST}장까지예요`;
    // 자리 부족 사유는 slotMessage 한 줄로 이미 요약되므로, 같은 사유의 개별 항목은 중복 표시하지 않는다.
    const otherReasons = [...new Set(rejected.filter((r) => r.reason !== overflowReason).map((r) => r.reason))];
    setMediaErr((cur) => ({ ...cur, [i]: [...(slotMessage ? [slotMessage] : []), ...otherReasons].join(' · ') }));
    if (accepted.length === 0) return;

    setBusyPost(i);
    const uploaded: DeckMedia[] = [];
    const failReasons: string[] = [];
    for (const file of accepted) {
      try {
        uploaded.push(await uploadDraftImage(draft.id, file));
      } catch (e) {
        failReasons.push(e instanceof Error ? e.message : '업로드에 실패했어요 — 다시 시도해주세요');
      }
    }
    if (uploaded.length === 0) {
      setBusyPost(null);
      setMediaErr((cur) => ({ ...cur, [i]: [...new Set(failReasons)].join(' · ') }));
      return;
    }

    const prevMedia = media;
    const nextMedia = media.map((m, j) => (j === i ? [...m, ...uploaded] : m));
    setMedia(nextMedia); // 낙관적 갱신 — 카드/모달을 열어둔 채 즉시 보이게(설계 §확정 판단)
    const updated = await patchMedia(nextMedia);
    setBusyPost(null);
    if (!updated) {
      setMedia(prevMedia); // 롤백
      setMediaErr((cur) => ({ ...cur, [i]: [...new Set(failReasons), '저장에 실패했어요 — 다시 시도해주세요'].join(' · ') }));
      return;
    }
    setMediaErr((cur) => ({ ...cur, [i]: failReasons.length ? [...new Set(failReasons)].join(' · ') : '' }));
    onMediaSaved(updated);
  }

  async function detachImage(i: number, k: number) {
    if (mediaBusy || compare) return;
    const prevMedia = media;
    const nextMedia = media.map((m, j) => (j === i ? m.filter((_, idx) => idx !== k) : m));
    setBusyPost(i);
    setMedia(nextMedia); // 낙관적 갱신
    const updated = await patchMedia(nextMedia);
    setBusyPost(null);
    if (!updated) {
      setMedia(prevMedia); // 롤백
      setMediaErr((cur) => ({ ...cur, [i]: '떼기에 실패했어요 — 다시 시도해주세요' }));
      return;
    }
    setMediaErr((cur) => ({ ...cur, [i]: '' }));
    onMediaSaved(updated);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-x-text/40 p-6" onClick={requestClose}>
      <div className="w-full max-w-[600px] rounded-2xl bg-white" role="dialog" aria-label="초안 편집"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <button onClick={requestClose} aria-label="닫기" className="rounded-full px-2 py-1 text-[19px] hover:bg-x-text/5">✕</button>
          <button onClick={() => setCompare(!compare)} className="text-[15px] font-bold text-x-blue-text hover:underline">
            {compare ? '편집으로 돌아가기' : '원본과 비교'}
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-4 pb-2">
          {base.posts.map((_p, i) => {
            const len = xWeightedLength(texts[i]);
            const remaining = MAX_MEDIA_PER_POST - media[i].length;
            const full = remaining <= 0;
            return (
              // preventDefault는 compare 검사보다 먼저 — 안 그러면 비교 모드에서 떨군 파일을 브라우저가
              // 기본 동작으로 열어 탭째 이동한다(모달의 미저장 텍스트가 통째로 날아감, 리뷰 발견)
              <div key={i}
                   className={`flex gap-3 rounded-xl py-2 transition-colors ${dragOverIndex === i ? 'bg-x-blue/5 ring-2 ring-inset ring-x-blue/40' : ''}`}
                   onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (compare) return; setDragOverIndex(i); }}
                   onDragLeave={() => setDragOverIndex((cur) => (cur === i ? null : cur))}
                   onDrop={(e) => {
                     e.preventDefault(); e.stopPropagation(); setDragOverIndex(null);
                     if (compare) return;
                     void attachFiles(i, Array.from(e.dataTransfer.files ?? []));
                   }}>
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
                      style={{ background: draft.member?.color ?? '#1d9bf0' }}>
                  {(draft.member?.name ?? '초').slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  {base.posts.length > 1 && <p className="text-caption font-bold text-x-muted">{i + 1} / {base.posts.length}</p>}
                  {compare ? (
                    <div className="space-y-4">
                      <div>
                        <p className="mb-1 text-[13px] font-bold text-x-muted">생성 원본</p>
                        <p className="whitespace-pre-wrap rounded-lg bg-x-surface p-3 text-[17px] leading-normal text-x-secondary">{draft.content.posts[i]?.text}</p>
                      </div>
                      <div>
                        <p className="mb-1 text-[13px] font-bold text-x-blue-text">현재 편집본</p>
                        <p className="whitespace-pre-wrap rounded-lg border border-x-border-strong p-3 text-[17px] leading-normal">{texts[i]}</p>
                      </div>
                    </div>
                  ) : (
                    <textarea value={texts[i]} rows={Math.max(3, texts[i].split('\n').length + 1)}
                              onChange={(e) => setTexts(texts.map((t, j) => (j === i ? e.target.value : t)))}
                              className="w-full resize-y text-[20px] leading-6 outline-none placeholder:text-x-muted"
                              placeholder="본문을 입력하세요" autoFocus={i === 0} />
                  )}
                  {/* 비교 모드엔 첨부 컨트롤이 없어 글자수만 따로 선다 */}
                  {compare && (
                    <p className={`text-caption tabular-nums ${len > X_MAX_WEIGHTED ? 'font-bold text-amber-700' : 'text-x-muted'}`}>
                      X 기준 {len} / {X_MAX_WEIGHTED}{len > X_MAX_WEIGHTED && ` — ${len - X_MAX_WEIGHTED} 줄여야 해요`}
                    </p>
                  )}

                  {/* 첨부 — X 컴포저 미러(설계 §E). 여기서 즉시 저장되므로 아래 '저장' 버튼은 텍스트만 책임진다.
                      X 컴포저와 같은 배치: 미디어 버튼은 입력창 아래 왼쪽, 글자수는 같은 줄 오른쪽 끝. */}
                  {!compare && (
                    <div className="mt-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <input ref={(el) => { fileInputs.current[i] = el; }} type="file" multiple
                               accept="image/jpeg,image/png,image/gif,image/webp" className="hidden"
                               onChange={(e) => {
                                 const files = Array.from(e.target.files ?? []);
                                 e.target.value = ''; // 같은 파일을 다시 골라도 change가 다시 뜨도록
                                 void attachFiles(i, files);
                               }} />
                        {/* X 컴포저 하단 바의 미디어 버튼 그대로 — 20px 글리프 + 32px 원형 히트 영역 + 파랑 10% 호버.
                            테두리 달린 작은 글자 버튼으로 먼저 냈다가 "너무 작아서 보이지 않는다"는 피드백을 받아 바꿨다. */}
                        <button type="button" onClick={() => fileInputs.current[i]?.click()}
                                disabled={mediaBusy || full} aria-label="이미지 첨부"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-x-blue hover:bg-x-blue/10 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent">
                          <MediaIcon className="h-5 w-5" />
                        </button>
                        {/* 0장일 때 '0/4'는 아직 필요 없는 정보다 — 상한은 4장에 가까워질 때 의미가 생긴다(AGENTS #2) */}
                        {media[i].length > 0 && (
                          <span className="text-caption tabular-nums text-x-muted">{media[i].length}/{MAX_MEDIA_PER_POST}</span>
                        )}
                        {full && (
                          <InfoTip label="이미지 자리 없음 설명 보기"
                                   text={`트윗당 최대 ${MAX_MEDIA_PER_POST}장까지 붙일 수 있어요 — 더 붙이려면 먼저 하나를 떼어주세요`} />
                        )}
                        {busyPost === i && <span className="text-caption text-x-muted">올리는 중…</span>}
                        <span className={`ml-auto shrink-0 text-caption tabular-nums ${len > X_MAX_WEIGHTED ? 'font-bold text-amber-700' : 'text-x-muted'}`}>
                          X 기준 {len} / {X_MAX_WEIGHTED}{len > X_MAX_WEIGHTED && ` — ${len - X_MAX_WEIGHTED} 줄여야 해요`}
                        </span>
                      </div>
                      {mediaErr[i] && <p className="mt-1 text-caption text-red-500">{mediaErr[i]}</p>}
                      <MediaGrid media={signedPosts[i]?.media ?? []} renderOverlay={(k) => (
                        <div className="group h-full w-full">
                          <button onClick={() => void detachImage(i, k)} disabled={mediaBusy}
                                  aria-label="이미지 떼기" title="이미지 떼기"
                                  className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-black/60 text-[13px] leading-none text-white hover:bg-black/80 disabled:opacity-50 group-hover:flex">
                            ✕
                          </button>
                        </div>
                      )} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="border-t border-x-border px-4 py-2 text-[14px] font-bold text-x-blue-text">
          🌐 인플루언서가 자기 계정으로 게시합니다 — PR 표기 안내를 함께 전달하세요
        </p>
        <div className="flex items-center gap-3 border-t border-x-border px-4 py-2.5">
          {err && <span className="text-ui text-red-500">{err}</span>}
          <button onClick={save} disabled={saving || empty || compare || busyPost !== null}
                  className="ml-auto h-9 rounded-full bg-x-blue px-[17px] text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
