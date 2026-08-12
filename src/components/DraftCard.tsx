'use client';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { DraftRow } from '@/lib/draftStore';
import type { RefSnapshot, InfluencerOption, DraftContent, DraftPost } from '@/lib/draftTypes';
import type { DeckMedia } from '@/lib/types';
import { xWeightedLength, X_MAX_WEIGHTED } from '@/lib/xLength';
import { hookBoundary, draftCopyText, draftTimeLabel, collectDraftFlags, variantLabel, textsChanged } from '@/lib/draftUi';
import {
  MAX_MEDIA_PER_POST, selectDraftImages, uploadDraftImage,
  draftMediaFilename, downloadDraftImage, copyDraftImageToClipboard, isGifDraftMedia,
} from '@/lib/draftMedia';
import { MediaGrid } from '@/components/MediaGrid';
import { useSignedMedia } from '@/components/useSignedMedia';
import { RefreshIcon, TrashIcon } from '@/components/XIcons';
import { useTranslations } from '@/components/useTranslations';
import { DraftStatusChip } from '@/components/DraftStatusChip';
import { InfluencerChip } from '@/components/InfluencerChip';
import type { DraftStatus } from '@/lib/draftStatus';

const MODE_LABEL: Record<DraftRow['referenceMode'], string> = {
  off: '참고 없음', form: '형식만', angle: '앵글만', both: '형식 + 앵글',
};

const FULL_SLOT_HINT = `트윗당 ${MAX_MEDIA_PER_POST}장까지예요 — 순서를 바꾸려면 이미지를 떼고 다시 올려주세요`;

// 첨부 컨트롤 — X 액션 바(카드 하단)가 아니라 포스트별 메타 행에 둔다(설계 §E). 미디어가 포스트 단위라
// 층위가 맞고, X 트윗 카드에는 첨부 버튼이 없다(있는 건 컴포저다). 남는 자리는 상시 표시한다 —
// 4장이 된 뒤에 "4장까지예요"를 띄우는 것은 사후 통보다(AGENTS #2).
function PostAttachControl({ used, busyCount, disabledReason, onFiles }: {
  used: number; busyCount: number; disabledReason: string | null; onFiles: (files: File[]) => void;
}) {
  const label = `＋ 이미지 ${used}/${MAX_MEDIA_PER_POST}`;
  if (busyCount > 0) return <span className="text-x-muted">이미지 올리는 중… {busyCount}장</span>;
  // 비활성일 때는 버튼(label)이 아니라 글자로 그린다 — 눌러도 아무 일이 없는 손잡이를 남기지 않는다.
  if (disabledReason) return <span title={disabledReason} className="cursor-default opacity-50">{label}</span>;
  return (
    <label title="jpg·png·gif·webp · 5MB까지 — 고른 이미지는 바로 저장돼요" className="cursor-pointer text-x-blue-text hover:underline">
      {label}
      <input type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp" className="hidden"
             onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; onFiles(files); }} />
    </label>
  );
}

// 이미지별 hover 액션 — 떼기·받기·복사 (설계 §E·§G). MediaGrid의 renderOverlay 슬롯으로 주입된다.
// 진행·완료·실패 상태를 이미지마다 따로 들어야 해서 카드 본체가 아니라 여기가 들고 있는다 —
// 카드에 이미지 수만큼 상태를 두면 그리드 칸 수가 바뀔 때마다 상태 맵을 청소해야 한다.
function MediaOverlayActions({ canDetach, isGif, onDetach, onDownload, onCopy }: {
  canDetach: boolean; isGif: boolean;
  onDetach: () => void; onDownload: () => Promise<void>; onCopy: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<'download' | 'copy' | null>(null);
  const [flash, setFlash] = useState('');   // 짧은 완료 표시 — 카드의 '복사됨 ✓'와 같은 방식
  const [err, setErr] = useState('');

  async function run(kind: 'download' | 'copy', fn: () => Promise<void>, ok: string) {
    setErr(''); setBusy(kind);
    try {
      await fn();
      setFlash(ok); setTimeout(() => setFlash(''), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '실패했어요 — 다시 시도해주세요');
    } finally {
      setBusy(null);
    }
  }

  const btn = 'rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-black/80 disabled:opacity-60';
  return (
    <div className="flex h-full w-full flex-col items-end justify-between p-1.5 opacity-0 transition-opacity focus-within:opacity-100 hover:opacity-100">
      <div className="flex gap-1">
        {canDetach && (
          <button onClick={onDetach} aria-label="이미지 떼기"
                  title="이미지 떼기 — 파일은 남아 있어 다시 올릴 수 있어요" className={btn}>✕</button>
        )}
        <button onClick={() => void run('download', onDownload, '받았어요 ✓')} disabled={busy !== null} className={btn}>
          {busy === 'download' ? '받는 중…' : '받기'}
        </button>
        {/* GIF에는 복사 버튼을 그리지 않는다 — 클립보드는 PNG만 받아 캔버스를 거치는데 그러면 움직임이 죽는다(설계 §G) */}
        {!isGif && (
          <button onClick={() => void run('copy', onCopy, '복사됨 ✓')} disabled={busy !== null} className={btn}>
            {busy === 'copy' ? '복사 중…' : '복사'}
          </button>
        )}
      </div>
      {(err || flash) && (
        <span className={`rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-bold ${err ? 'text-red-200' : 'text-white'}`}>{err || flash}</span>
      )}
    </div>
  );
}

// 초안 카드 — X 실측(600px·radius16·아바타40·본문 15/20). 지표·배지·이미지 자리 없음(없는 데이터는 자리도 안 만듦)
export function DraftCard({ draft, banned, onEdit, onRewrite, rewriteBusy, onDelete, onRegenPost, regenBusyIndex, onDismissFlag, onRestoreAllFlags, onChangeStatus, siblingTotal, influencerOptions, onAssignInfluencer, onSaveMedia }: {
  draft: DraftRow; banned: string[];
  onEdit: () => void; onRewrite: (feedback: string, baseIndex: number) => void; rewriteBusy: boolean;
  onDelete: () => void; onRegenPost: (index: number) => void; regenBusyIndex: number | null;
  onDismissFlag: (key: string, dismiss: boolean) => void;
  onRestoreAllFlags: () => void;
  onChangeStatus: (s: DraftStatus) => void;
  siblingTotal: number | null; // 다중 시안 형제 수 (batch 없으면 null)
  influencerOptions: InfluencerOption[]; // 배정 자동완성 후보 — 편집 모달에서 옮겨온 배선
  onAssignInfluencer: (next: string | null) => void;
  // 이미지 첨부·떼기 즉시 저장 (설계 §확정 판단) — 낙관적 갱신·롤백은 페이지가 한다(assignInfluencer와 같은 패턴)
  onSaveMedia: (next: DraftContent) => void;
}) {
  const [refsOpen, setRefsOpen] = useState(false);
  // 레퍼런스 번역 — 덱/보관함과 같은 훅·같은 캐시(tweet_translation, tweet_id 단위 전역).
  // 덱에서 이미 번역한 트윗은 여기서 과금 없이 재사용되고, 여기서 번역한 것도 덱에서 재사용된다.
  const refTr = useTranslations();
  const [copied, setCopied] = useState(false);
  const [copiedPost, setCopiedPost] = useState<number | null>(null);
  const [rwOpen, setRwOpen] = useState(false);   // 다시 쓰기 피드백 입력 열림
  const [rwText, setRwText] = useState('');
  const current = draft.edited ?? draft.content;
  const flags = collectDraftFlags(current, banned, draft.dismissedFlags);
  const active = flags.filter((f) => !f.dismissed);
  const dismissedCount = flags.length - active.length;
  const isThread = draft.format === 'thread';

  // 버전 이력 — 재생성 직전 스냅샷들(history) + 현재 표시본. ‹ 1/2 › 페이저로 이전 버전 열람.
  // verIdx=null은 '항상 최신' — 새 버전이 생겨도 자동으로 따라간다.
  const versions = [...draft.history, current];
  const [verIdx, setVerIdx] = useState<number | null>(null);
  const shownIdx = Math.min(verIdx ?? versions.length - 1, versions.length - 1);
  const shown = versions[shownIdx];
  const isLatest = shownIdx === versions.length - 1;
  const total = shown.posts.reduce((n, p) => n + xWeightedLength(p.text), 0);

  // 텍스트가 실제로 달라졌을 때만 '편집됨' (설계 §H-2) — 이미지만 붙여도 edited가 채워지므로
  // draft.edited 유무만 보면 첨부가 편집으로 둔갑한다. 첨부 사실은 이미지 자체가 이미 보여준다.
  const textEdited = draft.edited !== null &&
    textsChanged(draft.content.posts.map((p) => p.text), draft.edited.posts.map((p) => p.text));

  // ── 이미지 (설계 §D·§E·§G) ─────────────────────────────────────────
  // 서명 URL은 카드에서 딱 한 번, 보고 있는 버전의 포스트 배열 전체에 대해 발급받는다 —
  // 포스트마다 훅을 부르면 버전 전환으로 트윗 수가 바뀔 때 훅 개수가 달라져 React가 죽는다(useSignedMedia 주석).
  const { posts: signedPosts, resign } = useSignedMedia(shown.posts);
  const [uploading, setUploading] = useState<Record<number, number>>({}); // 포스트 index → 올리는 중인 파일 수
  const [mediaErr, setMediaErr] = useState<Record<number, string>>({});   // 실패 사유는 그 포스트 자리에(§E)
  const [dragPost, setDragPost] = useState<number | null>(null);
  const [dlBusy, setDlBusy] = useState(false);    // 전체 받기 진행 중
  const [dlDone, setDlDone] = useState(0);        // 그중 몇 장까지 받았는지
  const [dlErr, setDlErr] = useState('');
  const [nameNotice, setNameNotice] = useState(false);
  const mediaCount = shown.posts.reduce((n, p) => n + p.media.length, 0);

  // 저장 병합의 기준은 렌더 시점 값이 아니라 이 거울이다 — 업로드는 몇 초 걸리고, 그동안 다른 포스트에
  // 떨군 첨부가 먼저 저장될 수 있다. 렌더 시점 current에 얹으면 먼저 저장된 첨부가 조용히 지워진다.
  const latestRef = useRef(current);
  useEffect(() => { latestRef.current = current; }, [current]);

  // 만료된 서명 URL을 <img onError>에서 한 번만 재서명한다(설계 §D). MediaGrid는 4개 호출부가 함께 쓰는
  // 순수 렌더라 오류 슬롯이 없어서, 그리드를 감싼 div에서 캡처 단계로 받는다.
  // 경로당 한 번만 부르는 이유: 재서명도 실패하면 훅이 원본 경로를 그대로 돌려주고, 그 경로가 다시
  // 404를 내며 onError → resign이 무한히 돈다.
  const resignedRef = useRef<Set<string>>(new Set());
  function handleMediaError(e: SyntheticEvent<HTMLDivElement>, post: DraftPost, signedPost: DraftPost) {
    const src = (e.target as HTMLImageElement | null)?.getAttribute?.('src') ?? '';
    if (!src) return;
    const k = signedPost.media.findIndex((m) => m.url === src);
    const path = post.media[k]?.url;
    if (!path || path.startsWith('http')) return; // X CDN 절대 URL은 우리가 서명한 것이 아니다(§B)
    if (resignedRef.current.has(path)) return;
    resignedRef.current.add(path);
    resign(path);
  }

  function mergeMedia(postIndex: number, media: DeckMedia[]): DraftContent {
    const latest = latestRef.current;
    return { posts: latest.posts.map((p, n) => (n === postIndex ? { ...p, media } : p)) };
  }

  // 파일을 고른(또는 떨군) 즉시 올리고 바로 저장한다 — 모달의 저장 버튼을 기다리지 않는다(설계 §확정 판단).
  async function attachFiles(postIndex: number, files: File[]) {
    if (files.length === 0) return;
    // 막는 이유를 그 자리에 말한다 — 드롭은 버튼이 비활성이어도 들어올 수 있는 입구다.
    if (!isLatest) { setMediaErr((cur) => ({ ...cur, [postIndex]: '이전 버전을 보는 중 — 첨부는 최신 버전에서' })); return; }
    if (uploading[postIndex]) { setMediaErr((cur) => ({ ...cur, [postIndex]: '올리는 중이에요 — 끝나면 이어서 올려주세요' })); return; }
    const remaining = MAX_MEDIA_PER_POST - (latestRef.current.posts[postIndex]?.media.length ?? 0);
    if (remaining <= 0) { setMediaErr((cur) => ({ ...cur, [postIndex]: FULL_SLOT_HINT })); return; }
    const sel = selectDraftImages(files, remaining);
    // 자리 초과는 slotMessage 한 줄이 이미 말하므로 같은 사유를 항목별로 또 늘어놓지 않는다.
    const otherReasons = [...new Set(sel.rejected.map((r) => r.reason))]
      .filter((r) => r !== `트윗당 ${MAX_MEDIA_PER_POST}장까지예요`);
    const notice = [sel.slotMessage, ...otherReasons].filter(Boolean).join(' · ');
    setMediaErr((cur) => ({ ...cur, [postIndex]: notice }));
    if (sel.accepted.length === 0) return;

    setUploading((cur) => ({ ...cur, [postIndex]: sel.accepted.length }));
    const uploaded: DeckMedia[] = [];
    let failMsg = '';
    for (const file of sel.accepted) {
      try { uploaded.push(await uploadDraftImage(draft.id, file)); }
      catch (e) { failMsg = e instanceof Error ? e.message : '업로드에 실패했어요 — 다시 시도해주세요'; break; }
    }
    // 중간에 실패해도 이미 올라간 것은 저장한다 — 성공한 업로드를 버리면 사용자가 같은 일을 두 번 한다.
    if (uploaded.length > 0) {
      onSaveMedia(mergeMedia(postIndex, [...(latestRef.current.posts[postIndex]?.media ?? []), ...uploaded]));
    }
    setMediaErr((cur) => ({ ...cur, [postIndex]: [notice, failMsg].filter(Boolean).join(' · ') }));
    setUploading((cur) => { const next = { ...cur }; delete next[postIndex]; return next; });
  }

  function detachMedia(postIndex: number, mediaIndex: number) {
    // 스토리지 객체는 지우지 않는다(설계 §확정 판단) — 이전 버전이 같은 파일을 참조한다. 참조만 뗀다.
    const media = (latestRef.current.posts[postIndex]?.media ?? []).filter((_, k) => k !== mediaIndex);
    onSaveMedia(mergeMedia(postIndex, media));
  }

  const filenameBase = {
    createdAt: draft.createdAt, influencerHandle: draft.influencerHandle,
    clientName: draft.clientName, batchId: draft.batchId, variantIndex: draft.variantIndex,
  };
  // 미배정으로 받으면 파일명이 클라이언트명으로 나간다 — 배정 전후로 같은 이미지가 두 이름으로
  // 남는 것을 모르고 겪지 않게 알린다(설계 §G). 이미 받은 뒤의 사실 통지라 잠깐 띄웠다 걷는다.
  function noticeIfUnassigned() {
    if (draft.influencerHandle) return;
    setNameNotice(true);
    setTimeout(() => setNameNotice(false), 8000);
  }
  function mediaFilename(postIndex: number, mediaIndex: number, storageUrl: string) {
    return draftMediaFilename({ ...filenameBase, postIndex, mediaIndex, storageUrl });
  }

  async function downloadOne(postIndex: number, mediaIndex: number) {
    const path = shown.posts[postIndex]?.media[mediaIndex]?.url ?? '';
    await downloadDraftImage(path, mediaFilename(postIndex, mediaIndex, path));
    noticeIfUnassigned();
  }

  async function downloadAll() {
    setDlErr(''); setDlDone(0); setDlBusy(true);
    const items = shown.posts.flatMap((p, pi) => p.media.map((m, mi) => ({ path: m.url, pi, mi })));
    try {
      for (const [n, it] of items.entries()) {
        await downloadDraftImage(it.path, mediaFilename(it.pi, it.mi, it.path));
        setDlDone(n + 1);
      }
      noticeIfUnassigned();
    } catch (e) {
      setDlErr(e instanceof Error ? e.message : '이미지를 받지 못했어요 — 다시 시도해주세요');
    } finally {
      setDlBusy(false);
    }
  }

  // 버전을 옮기면 첨부 안내·오류를 걷는다 — 포스트 index로 붙어 있어서 그냥 두면 다른 버전의
  // 엉뚱한 트윗 밑에 남는다.
  function goVersion(next: number | null) { setVerIdx(next); setMediaErr({}); }

  async function copyAll() {
    await navigator.clipboard.writeText(draftCopyText(shown));
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  // 검토용 한국어 번역 — 보고 있는 버전 기준. 카드 로컬은 한 버전 슬롯만 들고,
  // 버전을 오가면 서버의 버전별 캐시(draft.translation 맵)에서 무과금으로 다시 받아온다.
  const [trPosts, setTrPosts] = useState<string[] | null>(null);
  const [trFor, setTrFor] = useState('');
  const [showTr, setShowTr] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [trErr, setTrErr] = useState('');
  const srcKey = JSON.stringify(shown.posts.map((p) => p.text));
  const hasTr = trPosts !== null && trFor === srcKey;

  async function toggleTranslate() {
    if (showTr && hasTr) { setShowTr(false); return; }
    if (hasTr) { setShowTr(true); return; }
    setTranslating(true); setTrErr('');
    const key = srcKey; // 요청 중 버전 이동 대비 — 응답을 요청 시점 버전에 귀속
    try {
      const r = await apiFetch(`/api/drafts/${draft.id}/translate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionIndex: shownIdx }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setTrErr((body as { error?: string }).error ?? `오류 ${r.status}`); return; }
      setTrPosts((body as { posts: string[] }).posts); setTrFor(key); setShowTr(true);
    } catch {
      setTrErr('번역에 실패했어요 — 네트워크를 확인해주세요');
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="w-full max-w-[600px] overflow-hidden rounded-2xl border border-x-border-strong bg-white">
      {/* 상단 도구층 스트립 — 상태·조건 메타를 좌상단 동일 위치에, 카드를 열지 않고 훑도록 (스펙 §DraftCard) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-x-border bg-x-surface px-4 py-2">
        <DraftStatusChip status={draft.status} onChange={onChangeStatus} />
        {/* 인플루언서 배정 — 상태와 나란히 "누구에게·어디까지"를 한 자리에서 (스펙 §F). 편집 모달을 열지 않고 카드에서 바로 배정 — 미배정 표시도 칩이 알아서 그린다 */}
        <InfluencerChip handle={draft.influencerHandle} options={influencerOptions} onChange={onAssignInfluencer} />
        {draft.batchId !== null && siblingTotal !== null && (
          <span className="text-caption text-x-muted">
            시안 {variantLabel(draft.variantIndex ?? 0)} · 같은 조건 {siblingTotal}개 중
          </span>
        )}
        {/* 시술명은 여기 두지 않는다 — 아래 근거 풋터에 '클라이언트 · 시술'로 이미 있어 한 카드에 두 번
            나왔고, 커진 컨트롤 바로 옆의 중복 글자가 대비를 갉아먹었다. 이 줄은 '내가 정하는 것'만 남긴다. */}
        <span className="ml-auto text-caption text-x-muted">
          {draft.format === 'thread' ? '스레드' : '단문'}
        </span>
      </div>
      {/* 흰색 = X 콘텐츠층 */}
      <div className="flex gap-3 px-4 py-3">
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
              style={{ background: draft.member?.color ?? '#1d9bf0' }}>
          {(draft.member?.name ?? '초').slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-5">
            <b>{draft.member?.name ?? '초안'}</b>
            <span className="text-x-secondary"> · 초안 · {draftTimeLabel(draft.createdAt)}</span>
            {textEdited && <span className="text-x-muted"> · 편집됨</span>}
          </p>
          <div className={isThread ? 'relative mt-1 space-y-3 pl-3 before:absolute before:bottom-1 before:left-0 before:top-1 before:w-0.5 before:bg-x-border-strong' : 'mt-0.5'}>
            {shown.posts.map((p, i) => {
              const hb = i === 0 ? hookBoundary(p.text) : null;
              const len = xWeightedLength(p.text);
              const signedPost = signedPosts[i] ?? p;
              const attachDisabled = !isLatest
                ? '이전 버전을 보는 중 — 첨부는 최신 버전에서'
                : p.media.length >= MAX_MEDIA_PER_POST ? FULL_SLOT_HINT : null;
              return (
                // 드롭 대상은 포스트 블록 — 떨군 자리의 트윗에 붙는다(설계 §E). 미디어가 포스트 단위라
                // 카드 전체를 대상으로 하면 "몇 번째 트윗 것인지"가 다시 사라진다.
                // 첨부할 수 없는 상태에서도 preventDefault는 한다 — 안 하면 브라우저가 그 파일로 페이지를
                // 열어버려 작업 중인 화면이 통째로 날아간다. 대신 왜 안 되는지를 attachFiles가 말한다.
                <div key={i}
                     onDragOver={(e) => { e.preventDefault(); if (!attachDisabled) setDragPost(i); }}
                     onDragLeave={() => setDragPost((cur) => (cur === i ? null : cur))}
                     onDrop={(e) => { e.preventDefault(); setDragPost(null); void attachFiles(i, Array.from(e.dataTransfer.files)); }}
                     className={dragPost === i ? 'rounded-lg ring-2 ring-x-blue ring-offset-2' : undefined}>
                  {isThread && <p className="text-caption font-bold text-x-muted">{i + 1} / {shown.posts.length}</p>}
                  {hb ? (
                    <p className="whitespace-pre-wrap text-[15px] leading-5">
                      {hb.hook}
                      <span className="relative my-1.5 block border-t border-dashed border-x-border-strong">
                        <span className="absolute -top-2 right-0 bg-white px-1 text-[10.5px] text-x-muted">↑ 첫 단락 = 타임라인에서 시선을 잡는 훅</span>
                      </span>
                      {hb.rest}
                    </p>
                  ) : (
                    <p className="whitespace-pre-wrap text-[15px] leading-5">{p.text}</p>
                  )}
                  {showTr && hasTr && (
                    <div className="mt-1 rounded-lg border border-x-border bg-x-blue/[0.03] px-2.5 py-2">
                      <span className="text-[10px] font-bold text-x-blue-text" title="AI 자동 번역입니다 — 원문을 함께 확인하세요">🌐 AI 번역</span>
                      <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-5">{trPosts?.[i]}</p>
                    </div>
                  )}
                  {/* 그리드 자체는 X 미러링 한 벌뿐이다(설계 §D) — 우리 것은 오버레이 슬롯과, 만료 서명을
                      되살리는 이 onErrorCapture뿐이다. */}
                  <div onErrorCapture={(e) => handleMediaError(e, p, signedPost)}>
                    <MediaGrid media={signedPost.media}
                               renderOverlay={(mi) => (
                                 <MediaOverlayActions canDetach={isLatest} isGif={isGifDraftMedia(p.media[mi]?.url ?? '')}
                                                      onDetach={() => detachMedia(i, mi)}
                                                      onDownload={() => downloadOne(i, mi)}
                                                      onCopy={() => copyDraftImageToClipboard(p.media[mi]?.url ?? '')} />
                               )} />
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption tabular-nums text-x-muted">
                    <span className={len > X_MAX_WEIGHTED ? 'font-bold text-amber-700' : ''}>X 기준 {len} / {X_MAX_WEIGHTED}{len > X_MAX_WEIGHTED && ` — ${len - X_MAX_WEIGHTED} 줄여야 해요`}</span>
                    {isThread && isLatest && (
                      <button onClick={() => onRegenPost(i)} disabled={regenBusyIndex !== null}
                              className="text-x-blue-text hover:underline disabled:opacity-50">
                        {regenBusyIndex === i ? '다시 만드는 중…' : '이 트윗만 다시'}
                      </button>
                    )}
                    {isThread && (
                      <button onClick={() => { void navigator.clipboard.writeText(p.text).catch(() => {}); setCopiedPost(i); setTimeout(() => setCopiedPost(null), 1500); }}
                              className="text-x-blue-text hover:underline">
                        {copiedPost === i ? '복사됨 ✓' : '복사'}
                      </button>
                    )}
                    <PostAttachControl used={p.media.length} busyCount={uploading[i] ?? 0}
                                       disabledReason={attachDisabled}
                                       onFiles={(files) => void attachFiles(i, files)} />
                    {dragPost === i && <span className="text-x-blue-text">여기에 놓으면 이 트윗에 붙어요</span>}
                    {mediaErr[i] && <span className="text-red-600">{mediaErr[i]}</span>}
                  </p>
                </div>
              );
            })}
          </div>
          {/* 전달 안내 — 지금 이미지가 앱 밖으로 나가는 길은 받기와 복사뿐이고 화면이 그렇게 말해야 한다(설계 §G).
              액션 행이 아니라 콘텐츠 열에 둔다: 액션 행은 X 액션 바 미러링 자리다(§E).
              '모두 받기'가 카드 단위인 이유 — 스레드 전체를 한 번에 넘기는 것이 실제 전달 단위이고,
              포스트당 최대 4장이라 7장 같은 수는 카드 단위로만 나온다. */}
          {mediaCount > 0 && (
            <div className="mt-2 space-y-0.5 text-caption text-x-muted">
              {mediaCount >= 2 && (
                <p>
                  <button onClick={() => void downloadAll()} disabled={dlBusy}
                          className="text-x-blue-text hover:underline disabled:opacity-50">
                    {/* 파일 개수를 밝혀 여러 파일 확인창을 미리 알린다(§G) */}
                    {dlBusy ? `받는 중… ${dlDone} / ${mediaCount}` : `이미지 ${mediaCount}장 모두 받기(파일 ${mediaCount}개)`}
                  </button>
                  {dlErr && <span className="ml-2 text-red-600">{dlErr}</span>}
                </p>
              )}
              <p>이미지는 받거나 복사해서 인플루언서에게 전달하세요 — 텍스트 ‘복사’에는 이미지가 함께 담기지 않아요</p>
              {nameNotice && <p className="text-x-secondary">아직 인플루언서가 정해지지 않아 클라이언트명으로 저장했어요.</p>}
            </div>
          )}
          {versions.length > 1 && (
            <p className="mt-1.5 flex items-center justify-end gap-1.5 text-caption tabular-nums text-x-muted">
              {!isLatest && <span>이전 버전 (읽기 전용)</span>}
              <button onClick={() => goVersion(shownIdx - 1)} disabled={shownIdx === 0} aria-label="이전 버전 보기"
                      className="rounded px-1.5 text-[15px] leading-none text-x-blue-text hover:bg-x-blue/10 disabled:opacity-30 disabled:hover:bg-transparent">‹</button>
              {shownIdx + 1} / {versions.length}
              <button onClick={() => goVersion(shownIdx + 2 >= versions.length ? null : shownIdx + 1)} disabled={isLatest} aria-label="다음 버전 보기"
                      className="rounded px-1.5 text-[15px] leading-none text-x-blue-text hover:bg-x-blue/10 disabled:opacity-30 disabled:hover:bg-transparent">›</button>
            </p>
          )}
          <p className="mt-2 text-[13px]">
            <button onClick={toggleTranslate} disabled={translating} className="text-x-blue-text hover:underline disabled:opacity-50">
              {translating ? '번역 중…' : showTr && hasTr ? '원문만 보기' : '🌐 번역 보기'}
            </button>
            {trErr && <span className="ml-2 text-red-600">{trErr}</span>}
          </p>
          {/* 액션 행 — X 액션 바 자리에 우리 액션 (없는 지표를 채우지 않고 교체).
              X는 이 폭(440px) 안에서 아이콘 5개를 균등 분산하지만 우리는 왼쪽에 몰아 붙였다 —
              폭 제한이 하던 일이 글자수를 칼럼 오른쪽 끝이 아닌 440px 지점에 세우는 것뿐이라 걷어냈다. */}
          <div className="mt-3 flex items-center gap-1 text-[13px] text-x-secondary">
            <button onClick={onEdit} disabled={!isLatest} title={isLatest ? undefined : '이전 버전을 보는 중 — 편집은 최신 버전에서'}
                    className="flex items-center gap-1.5 rounded-full px-2 py-1 text-x-blue-text hover:bg-x-blue/10 disabled:opacity-50 disabled:hover:bg-transparent">
              <svg viewBox="0 0 24 24" className="h-[19px] w-[19px] fill-current" aria-hidden><path d="M14.06 9.02l.92.92L5.92 19H5v-.92l9.06-9.06zM17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29zm-3.6 3.19L3 17.25V21h3.75L17.81 9.94l-3.75-3.75z" /></svg>
              편집
            </button>
            <button onClick={() => setRwOpen(!rwOpen)} disabled={rewriteBusy}
                    className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-x-text/5 disabled:opacity-50 disabled:hover:bg-transparent">
              <RefreshIcon className="h-[19px] w-[19px]" />{rewriteBusy ? '다시 쓰는 중…' : '다시 쓰기'}
            </button>
            <button onClick={copyAll} className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-x-text/5">
              <svg viewBox="0 0 24 24" className="h-[19px] w-[19px] fill-current" aria-hidden><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg>
              {copied ? '복사됨 ✓' : '복사'}
            </button>
            <span className="ml-auto tabular-nums">{isThread ? `${shown.posts.length}개 · 총 ${total}자` : ''}</span>
            {/* 삭제만 오른쪽 끝으로 떼어놓는다 — 되돌릴 수 있는 액션(복사) 바로 옆에 파괴적 액션이
                8px 간격으로 붙어 있으면 오클릭이 난다. 5초 실행취소가 있지만 토스트를 놓치면 끝이다. */}
            <button onClick={onDelete} aria-label="초안 삭제" className="ml-1 flex items-center rounded-full px-2 py-1 hover:bg-red-50 hover:text-red-600">
              <TrashIcon className="h-[19px] w-[19px]" />
            </button>
          </div>
          {rwOpen && !rewriteBusy && (
            <div className="mt-2 rounded-xl border border-x-border-strong p-2.5">
              {!isLatest && (
                <p className="mb-1 text-caption text-x-muted">지금 보고 있는 {shownIdx + 1}번 버전을 기준으로 다시 써요 — 결과는 새 버전({versions.length + 1}번)으로 추가됩니다</p>
              )}
              <textarea value={rwText} onChange={(e) => setRwText(e.target.value)} rows={2} autoFocus
                        placeholder="고칠 점이나 원하는 방향을 적어주세요 — 비워두면 같은 조건으로 다시 생성해요"
                        className="w-full resize-y text-[15px] leading-5 outline-none placeholder:text-x-muted" />
              <div className="mt-1.5 flex items-center justify-end gap-2">
                <button onClick={() => { setRwOpen(false); setRwText(''); }}
                        className="rounded-full px-3 py-1 text-[13px] text-x-secondary hover:bg-x-text/5">취소</button>
                <button onClick={() => { onRewrite(rwText.trim(), shownIdx); setRwOpen(false); setRwText(''); setVerIdx(null); }}
                        className="rounded-full bg-x-blue px-3 py-1 text-[13px] font-bold text-white hover:opacity-90">
                  {rwText.trim() ? '피드백 반영해 다시 쓰기' : '같은 조건으로 다시 쓰기'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 회색 = 도구층: 검수 표식 + PR 안내 + 근거 풋터 (spec §2 표면 2층) */}
      <div className="border-t border-x-border bg-x-surface px-4 py-2.5">
        {active.map((f) => (
          <p key={`${f.postIndex}:${f.key}`} className="flex items-baseline gap-2 py-0.5 text-[13px]">
            <span className="border-b-2 border-amber-700 font-bold text-amber-700">{f.flag.term}</span>
            <span className="text-x-secondary">{f.flag.reason}{isThread ? ` (${f.postIndex + 1}번)` : ''}</span>
            <button onClick={() => onDismissFlag(f.key, true)} className="ml-auto shrink-0 text-x-blue-text hover:underline">무시</button>
          </p>
        ))}
        {dismissedCount > 0 && (
          <p className="py-0.5 text-caption text-x-muted">
            무시한 표식 {dismissedCount}개
            <button onClick={onRestoreAllFlags} className="ml-2 text-x-blue-text hover:underline">모두 되돌리기</button>
          </p>
        )}
        <p className="py-0.5 text-caption text-x-muted">ℹ️ PR 표기(#PR)는 원고와 함께 인플루언서에게 안내하세요 — 스테마 규제</p>

        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-x-border pt-1.5 text-[13px]">
          <button onClick={() => { const opening = !refsOpen; setRefsOpen(opening); if (opening) void refTr.loadCached(draft.refs.map((r) => r.tweetId)); }}
                  disabled={draft.refs.length === 0}
                  className="text-left disabled:cursor-default">
            참고 레퍼런스 {draft.refs.length}건{draft.refs.length > 0 && <span className="text-x-blue-text"> · {MODE_LABEL[draft.referenceMode]} {refsOpen ? '⌃' : '⌄'}</span>}
          </button>
          <span className="shrink-0 text-caption tabular-nums text-x-muted">
            {[draft.clientName, ...draft.procedureNames].filter(Boolean).join(' · ')}
          </span>
        </div>
        {refsOpen && draft.refs.map((r: RefSnapshot) => (
          <div key={r.tweetId} className="mt-2 rounded-lg border border-x-border bg-white px-3 py-2">
            <p className="text-ui"><b>{r.name ?? r.handle}</b> <span className="text-x-muted">@{r.handle}</span>
              <a href={`https://x.com/i/status/${r.tweetId}`} target="_blank" rel="noreferrer" className="ml-2 text-x-blue-text hover:underline">원문 ↗</a>
            </p>
            <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[15px] leading-5">{r.excerpt}</p>
            {refTr.showTranslations && refTr.translations[r.tweetId] && (
              <div className="mt-1 rounded-lg border border-x-border bg-x-blue/[0.03] px-2.5 py-1.5">
                <span className="text-[10px] font-bold text-x-blue-text" title="AI 자동 번역입니다 — 원문을 함께 확인하세요">🌐 AI 번역</span>
                <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[15px] leading-5">{refTr.translations[r.tweetId].content}</p>
              </div>
            )}
            {r.memos.map((m, i) => (
              <p key={i} className="mt-1 rounded-r border-l-2 border-x-blue bg-x-surface px-2 py-1 text-caption"><b>{m.member}</b> {m.text}</p>
            ))}
          </div>
        ))}
        {refsOpen && draft.refs.length > 0 && (
          <p className="mt-1.5 text-[13px]">
            <button onClick={() => void refTr.translateAll(draft.refs.map((r) => r.tweetId))} disabled={refTr.translatingAll}
                    className="text-x-blue-text hover:underline disabled:opacity-50">
              {refTr.translatingAll ? '번역 중…' : refTr.showTranslations ? '원문만 보기' : '🌐 번역 보기'}
            </button>
            {refTr.translateErr && <span className="ml-2 text-red-600">{refTr.translateErr}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
