'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { useTranslations } from '@/components/useTranslations';
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
  const [sel, setSel] = useState<string[]>(selectedIds);
  // scope를 넘나들며 선택이 쌓인다 — 현재 scope 응답(rows)엔 없는 row도 sel에 남을 수 있어
  // "N건 적용"이 실제 적용 내용과 어긋나지 않으려면 본 적 있는 row를 전부 여기 누적해둬야 한다.
  const cacheRef = useRef(new Map<string, ReferenceRow>());
  // 번역 — 덱/보관함과 같은 훅·같은 전역 캐시(tweet_translation). 이미 번역된 건 무과금 재사용.
  const { translations, showTranslations, translatingAll, translateProgress, translateErr, loadCached, translateAll } = useTranslations();

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 시트를 열 때마다 상위 선택값으로 재동기화(기존 코드베이스 관례)
  useEffect(() => { if (open) setSel(selectedIds); }, [open, selectedIds]);
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
  }, [open, scope, lastWsId, loadCached]);

  // Esc로 시트 닫기 — ColumnSettings 선례와 동일한 방식(document 레벨 리스너). IME 조합 중 Esc는 무시.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const allTags = useMemo(() => [...new Set(rows.flatMap((r) => r.tags))].slice(0, 12), [rows]);
  const visible = tag ? rows.filter((r) => r.tags.includes(tag)) : rows;

  if (!open) return null;
  function toggle(id: string) {
    setSel((cur) => cur.includes(id) ? cur.filter((x) => x !== id)
      : cur.length >= MAX_REFS_UI ? cur : [...cur, id]);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-x-text/40 p-6" onClick={onClose}>
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
          {loaded && visible.length === 0 && (
            <p className="p-4 text-ui text-x-secondary">보관함이 비어 있어요 — 덱에서 트윗을 ☆ 저장하면 여기서 참고할 수 있어요.</p>
          )}
          {visible.map((r) => {
            const on = sel.includes(r.tweetId);
            return (
              <button key={r.tweetId} onClick={() => toggle(r.tweetId)}
                      className={`flex w-full gap-2.5 border-b border-x-border px-4 py-2.5 text-left ${on ? 'bg-x-blue/5 shadow-[inset_3px_0_0_#1d9bf0]' : 'hover:bg-x-hover'}`}>
                <span aria-hidden className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border text-caption font-bold ${on ? 'border-x-blue bg-x-blue text-white' : 'border-x-border-strong bg-white'}`}>{on ? '✓' : ''}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ui"><b>{r.authorName ?? r.authorHandle}</b> <span className="text-x-muted">@{r.authorHandle}{r.likes != null && ` · ♡${r.likes}`}</span></span>
                  <span className="mt-0.5 line-clamp-2 block text-[15px] leading-5">{r.text}</span>
                  {showTranslations && translations[r.tweetId] && (
                    <span className="mt-1 block rounded-lg border border-x-border bg-x-blue/[0.03] px-2.5 py-1.5">
                      <span className="block text-[10px] font-bold text-x-blue-text" title="AI 자동 번역입니다 — 원문을 함께 확인하세요">🌐 AI 번역</span>
                      <span className="mt-0.5 line-clamp-2 block text-[15px] leading-5">{translations[r.tweetId].content}</span>
                    </span>
                  )}
                  {r.memos.map((m, i) => (
                    <span key={i} className="mt-1 block rounded-r border-l-2 border-x-blue bg-x-surface px-2 py-1 text-caption"><b>{m.member}</b> {m.text}</span>
                  ))}
                  <span className="mt-1 block text-caption text-x-muted">
                    {r.memos.length === 0 && '메모 없음 — 저장만 되어 있어요 · '}
                    {r.tags.map((t) => `#${t}`).join(' ')}{r.tags.length > 0 && ' · '}
                    {r.workspaces.length > 1 ? `${r.workspaces.length}곳에 저장됨 · ` : ''}{r.workspaces.map((w) => w.name).join(', ')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="sticky bottom-0 border-t border-x-border bg-white px-4 py-3">
          <p className="mb-2 text-caption text-amber-700">
            {MAX_REFS_UI}건까지 고를 수 있어요. 더 넣으면 원고가 레퍼런스 문구를 그대로 베낄 위험이 커져요 — 서로 다른 앵글로 3~5건이 가장 좋아요.
          </p>
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={() => { onApply(sel.map((id) => cacheRef.current.get(id)).filter((r): r is ReferenceRow => !!r)); onClose(); }}>
              {sel.length}건 적용
            </Button>
            <button onClick={onClose} className="text-ui text-x-secondary">취소</button>
            <span className="ml-auto text-caption text-x-muted">선택은 다음 생성에도 유지돼요</span>
          </div>
        </div>
      </div>
    </div>
  );
}
