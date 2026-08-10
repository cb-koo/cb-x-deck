'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { MediaGrid } from '@/components/MediaGrid';
import { useTranslations } from '@/components/useTranslations';
import { formatCount } from '@/lib/format';
import { ReplyIcon, RepostIcon, LikeIcon, ViewIcon, BookmarkIcon } from '@/components/XIcons';
import { idSetChanged } from '@/lib/draftUi';
import { AddByLinkModal, type AddedByLink } from '@/components/AddByLinkModal';
import { matchesRefSearch, sortRefRows, REF_SORT_LABEL, type RefSortKey } from '@/lib/refSheetFilter';
import type { ReferenceRow } from '@/lib/referenceStore';

export const MAX_REFS_UI = 8; // 서버 MAX_REFS와 동일 (generate.ts)

// 레퍼런스 선택 — 진입점 B에서만 만나는 화면. 전체/워크스페이스 세그먼트 + 태그 필터 + 메모 우선(서버 정렬)
export function RefPickerSheet({ open, onClose, lastWsId, selectedIds, seedRows, onApply }: {
  open: boolean; onClose: () => void; lastWsId: string | null;
  selectedIds: string[]; seedRows: ReferenceRow[]; onApply: (rows: ReferenceRow[]) => void;
}) {
  const [scope, setScope] = useState<'all' | 'ws'>('all');
  const [rows, setRows] = useState<ReferenceRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<RefSortKey>('default');
  const [sel, setSel] = useState<string[]>(selectedIds);
  const [addOpen, setAddOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [addNotice, setAddNotice] = useState<string | null>(null); // /generate엔 토스트가 없다 — 인라인 안내
  // scope를 넘나들며 선택이 쌓인다 — 현재 scope 응답(rows)엔 없는 row도 sel에 남을 수 있어
  // "N건 적용"이 실제 적용 내용과 어긋나지 않으려면 본 적 있는 row를 전부 여기 누적해둬야 한다.
  const cacheRef = useRef(new Map<string, ReferenceRow>());
  // 번역 — 덱/보관함과 같은 훅·같은 전역 캐시(tweet_translation). 이미 번역된 건 무과금 재사용.
  const { translations, showTranslations, translatingAll, translateProgress, translateErr, loadCached, translateAll } = useTranslations();

  // setAddOpen(false): Esc는 시트·모달 리스너가 함께 반응해 모달이 열린 채 시트가 닫힐 수 있다 — 다음에 열 때 모달이 되살아나지 않게.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 시트를 열 때마다 상위 선택값으로 재동기화(기존 코드베이스 관례)
  useEffect(() => { if (open) { setSel(selectedIds); setQuery(''); setSortKey('default'); setAddNotice(null); setAddOpen(false); } }, [open, selectedIds]);
  // 시트를 열 때 부모가 이미 알고 있는 row(현재 선택된 레퍼런스)를 캐시에 시드 —
  // 그렇지 않으면 열자마자 적용을 누를 때 캐시엔 id만 있고 row 본문이 없다.
  useEffect(() => { if (open) seedRows.forEach((r) => cacheRef.current.set(r.tweetId, r)); }, [open, seedRows]);
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 재조회 시작 시 로딩 표시 초기화
    setLoaded(false);
    const s = scope === 'ws' && lastWsId ? lastWsId : 'all';
    apiFetch(`/api/references?scope=${s}`).then((r) => r.json())
      .then((data: ReferenceRow[]) => {
        data.forEach((r) => cacheRef.current.set(r.tweetId, r));
        setRows(data); setLoaded(true);
        void loadCached(data.map((r) => r.tweetId)); // 기번역분 조용히 로드(과금 없음)
      });
  }, [open, scope, lastWsId, loadCached, reloadKey]);

  // Esc로 시트 닫기 — ColumnSettings 선례와 동일한 방식(document 레벨 리스너). IME 조합 중 Esc는 무시.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      // 두 리스너가 같은 Esc에 함께 발화 — 모달이 열려 있으면 시트는 무시(모달 자체 리스너가 처리)
      if (addOpen) return;
      if (!idSetChanged(sel, selectedIds) || window.confirm('선택을 적용하지 않았어요. 닫을까요?')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, sel, selectedIds, addOpen]);

  const allTags = useMemo(() => [...new Set(rows.flatMap((r) => r.tags))].slice(0, 12), [rows]);
  const visible = useMemo(() => {
    const tagged = tag ? rows.filter((r) => r.tags.includes(tag)) : rows;
    const searched = tagged.filter((r) => matchesRefSearch(r, query, translations[r.tweetId]?.content));
    return sortRefRows(searched, sortKey);
  }, [rows, tag, query, sortKey, translations]);

  if (!open) return null;
  const dirty = idSetChanged(sel, selectedIds);
  function requestClose() {
    if (!dirty || window.confirm('선택을 적용하지 않았어요. 닫을까요?')) onClose();
  }
  function toggle(id: string) {
    setSel((cur) => cur.includes(id) ? cur.filter((x) => x !== id)
      : cur.length >= MAX_REFS_UI ? cur : [...cur, id]);
  }
  // 링크 추가 성공 — 선택은 즉시, 목록은 재조회로. 결과는 판단까지 서술(UX 원칙 3).
  function handleAdded(r: AddedByLink) {
    const saved = r.alreadyInLibrary ? '이미 보관함에 있어요' : '보관함에 추가했어요';
    if (sel.includes(r.tweetId)) setAddNotice(`${saved} — 이미 선택돼 있어요`);
    else if (sel.length >= MAX_REFS_UI) setAddNotice(`${saved} — 선택이 ${MAX_REFS_UI}건이라 자동 선택은 안 했어요. 목록에서 직접 조정해주세요`);
    else { setSel((cur) => [...cur, r.tweetId]); setAddNotice(`${saved} — 레퍼런스로 선택했어요`); }
    // 다른 워크스페이스에 저장한 경우 현재 범위 밖 — 전체 보관함으로 전환해 방금 트윗이 보이게
    if (r.workspaceId !== lastWsId && scope === 'ws') setScope('all');
    setReloadKey((k) => k + 1);
  }

  return (
    <>
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-x-text/40 p-6" onClick={requestClose}>
      <div className="max-h-full w-full max-w-[640px] overflow-y-auto rounded-2xl bg-white"
           role="dialog" aria-label="레퍼런스 선택" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center gap-3 border-b border-x-border bg-white px-4 py-3">
          <h2 className="text-[15px] font-bold">참고할 레퍼런스</h2>
          <span className="ml-auto text-ui tabular-nums text-x-secondary"><b className="text-x-text">{sel.length}</b> / {MAX_REFS_UI} 선택</span>
          <button onClick={onClose} aria-label="닫기" className="rounded px-1.5 text-x-secondary hover:bg-x-border">✕</button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-x-border bg-x-surface px-4 py-2">
          <span className="text-caption text-x-muted">범위</span>
          <div className="flex overflow-hidden rounded-full border border-x-border-strong bg-white text-ui">
            <button onClick={() => setScope('all')} className={`px-3 py-1 ${scope === 'all' ? 'bg-x-blue font-medium text-white' : 'text-x-secondary'}`}>전체 보관함</button>
            <button onClick={() => setScope('ws')} className={`px-3 py-1 ${scope === 'ws' ? 'bg-x-blue font-medium text-white' : 'text-x-secondary'}`}>이 워크스페이스</button>
          </div>
          {allTags.map((t) => (
            <button key={t} onClick={() => setTag(tag === t ? null : t)}
                    className={`rounded-full border px-2.5 py-0.5 text-caption ${tag === t ? 'border-x-blue bg-x-blue/10 text-x-blue-text' : 'border-x-border-strong text-x-muted'}`}>
              #{t}
            </button>
          ))}
          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="본문·작성자·메모·태그·번역문 검색"
                 aria-label="레퍼런스 검색"
                 className="min-w-[180px] flex-1 rounded-md border border-x-border-strong bg-white px-2 py-1 text-ui outline-none focus:border-x-blue" />
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as RefSortKey)}
                  aria-label="레퍼런스 정렬"
                  className="rounded-md border border-x-border-strong bg-white px-2 py-1 text-caption outline-none focus:border-x-blue">
            {(Object.keys(REF_SORT_LABEL) as RefSortKey[]).map((k) => (
              <option key={k} value={k}>{REF_SORT_LABEL[k]}</option>
            ))}
          </select>
          <button onClick={() => void translateAll(visible.map((r) => r.tweetId))} disabled={translatingAll}
                  title="지금 보이는 레퍼런스를 한국어로 — 덱/보관함에서 이미 번역한 건 무료로 바로 표시돼요"
                  className="ml-auto text-ui text-x-blue-text hover:underline disabled:opacity-50">
            {translatingAll
              ? `번역 중… ${translateProgress ? `${translateProgress.done}/${translateProgress.total}` : ''}`
              : showTranslations ? '번역 숨기기' : '🌐 전체 번역'}
          </button>
        </div>
        {translateErr && (
          <p className="border-b border-x-border bg-red-50 px-4 py-1.5 text-caption text-red-700">
            {translateErr} <button onClick={() => void translateAll(visible.map((r) => r.tweetId))} className="underline">재시도</button>
          </p>
        )}

        <p className="flex gap-1.5 border-b border-x-border bg-x-blue/5 px-4 py-2 text-caption text-x-secondary">
          <span>ℹ️</span><span><b>메모가 달린 것부터</b> 보여드려요 — 메모가 &ldquo;이 레퍼런스의 무엇이 좋은지&rdquo;를 알려줘서 원고 품질에 직접 기여해요.</span>
        </p>

        <div>
          {!loaded && <p className="p-4 text-ui text-x-muted">불러오는 중…</p>}
          {loaded && rows.length === 0 && (
            <p className="p-4 text-ui text-x-secondary">보관함이 비어 있어요 — 덱에서 트윗을 ☆ 저장하면 여기서 참고할 수 있어요.</p>
          )}
          {loaded && rows.length > 0 && visible.length === 0 && (
            <p className="p-4 text-ui text-x-secondary">검색과 일치하는 레퍼런스가 없어요 — 검색어를 줄이거나 태그·정렬을 바꿔보세요.</p>
          )}
          {visible.map((r) => {
            const on = sel.includes(r.tweetId);
            return (
              // X 실측 트윗 카드 구조(시안 A) — 아바타40·본문15/20·전폭 이미지·액션행 자리 지표·우상단 원형 체크
              <button key={r.tweetId} onClick={() => toggle(r.tweetId)} aria-pressed={on}
                      className={`relative flex w-full gap-3 border-b border-x-border px-4 pb-3.5 pt-3 text-left ${on ? 'bg-x-blue/5' : 'hover:bg-x-hover'}`}>
                {r.authorAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 외부 X 아바타는 next/image 최적화 대상 아님(덱 카드 관례)
                  <img src={r.authorAvatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full" />
                ) : (
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-x-border-strong text-[15px] font-bold text-white">
                    {(r.authorName ?? r.authorHandle).slice(0, 1)}
                  </span>
                )}
                <span className="min-w-0 flex-1 pr-8">
                  <span className="block text-[15px] leading-5"><b>{r.authorName ?? r.authorHandle}</b> <span className="text-x-muted">@{r.authorHandle}</span></span>
                  <span className="block whitespace-pre-wrap text-[15px] leading-5">{r.text}</span>
                  <MediaGrid media={r.media} />
                  {/* X 액션 행 자리에 성과 지표 — 덱 카드와 같은 배치(19px 아이콘 + 13px 수치 분산) */}
                  <span className="mt-3 flex max-w-[440px] items-center justify-between text-[13px] tabular-nums text-x-muted">
                    <span className="flex items-center gap-1.5"><ReplyIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.replies)}</span>
                    <span className="flex items-center gap-1.5"><RepostIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.retweets)}</span>
                    <span className="flex items-center gap-1.5"><LikeIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.likes)}</span>
                    <span className="flex items-center gap-1.5"><ViewIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.views)}</span>
                    <span className="flex items-center gap-1.5"><BookmarkIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.bookmarks)}</span>
                  </span>
                  {showTranslations && translations[r.tweetId] && (
                    <span className="mt-2.5 block rounded-xl border border-x-border bg-x-blue/5 px-3 py-2">
                      <span className="block text-caption font-bold text-x-blue-text" title="AI 자동 번역입니다 — 원문을 함께 확인하세요">🌐 AI 번역</span>
                      <span className="mt-1 block whitespace-pre-wrap text-[15px] leading-5">{translations[r.tweetId].content}</span>
                    </span>
                  )}
                  {/* 회색 = 도구층 밴드: 메모·태그·워크스페이스는 X에 없는 우리 요소라 층을 분리 */}
                  <span className="mt-3 block rounded-xl bg-x-surface px-3 py-2.5">
                    {r.memos.map((m, i) => (
                      <span key={i} className="mb-1.5 block border-l-2 border-x-blue pl-2 text-[13px] leading-[18px] text-x-secondary"><b className="text-x-text">{m.member}</b> {m.text}</span>
                    ))}
                    <span className="block text-[13px] text-x-muted">
                      {r.memos.length === 0 && '메모 없음 — 저장만 되어 있어요 · '}
                      {r.tags.map((t) => `#${t}`).join(' ')}{r.tags.length > 0 && ' · '}
                      {r.workspaces.length > 1 ? `${r.workspaces.length}곳에 저장됨 · ` : ''}{r.workspaces.map((w) => w.name).join(', ')}
                    </span>
                  </span>
                  <span aria-hidden
                        className={`absolute right-4 top-3 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 text-[13px] font-bold ${on ? 'border-x-blue bg-x-blue text-white' : 'border-x-border-strong bg-white'}`}>
                    {on ? '✓' : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="sticky bottom-0 border-t border-x-border bg-white px-4 py-3">
          {addNotice && <p className="mb-2 text-caption text-x-blue-text">{addNotice}</p>}
          <p className="mb-2 text-caption text-amber-700">
            {MAX_REFS_UI}건까지 고를 수 있어요. 더 넣으면 원고가 레퍼런스 문구를 그대로 베낄 위험이 커져요 — 서로 다른 앵글로 3~5건이 가장 좋아요.
          </p>
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={() => { onApply(sel.map((id) => cacheRef.current.get(id)).filter((r): r is ReferenceRow => !!r)); onClose(); }}>
              {sel.length}건 적용
            </Button>
            <button onClick={onClose} className="text-ui text-x-secondary">취소</button>
            <button onClick={() => { setAddNotice(null); setAddOpen(true); }} className="text-ui text-x-blue-text hover:underline">🔗 링크로 추가</button>
            <span className="ml-auto text-caption text-x-muted">선택은 다음 생성에도 유지돼요</span>
          </div>
        </div>
      </div>
    </div>
    {/* 시트 오버레이의 형제로 — 안에 두면 모달 클릭이 시트 배경의 requestClose로 버블링된다 */}
    <AddByLinkModal open={addOpen} onClose={() => setAddOpen(false)} defaultWsId={lastWsId} onAdded={handleAdded} />
    </>
  );
}
