'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { Toast } from '@/components/Toast';
import { DraftCard } from '@/components/DraftCard';
import { DraftEditModal } from '@/components/DraftEditModal';
import { RefPickerSheet } from '@/components/RefPickerSheet';
import { DraftComposer, DEFAULT_COMPOSER, type ComposerState } from '@/components/DraftComposer';
import { LAST_WS_KEY } from '@/components/GlobalShell';
import type { DraftRow } from '@/lib/draftStore';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';
import type { ReferenceRow } from '@/lib/referenceStore';

const COMPOSER_KEY = 'cbx-composer'; // 직전 설정 유지 (스펙 §4 "바꾸기 — 직전 값 유지")

export default function GeneratePage() {
  return (
    <Suspense>
      <Workbench />
    </Suspense>
  );
}

function Workbench() {
  const searchParams = useSearchParams();
  const [clients, setClients] = useState<Array<{ client: ClientRow; procedures: ProcedureRow[] }>>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [composer, setComposer] = useState<ComposerState>(DEFAULT_COMPOSER);
  const [refRows, setRefRows] = useState<ReferenceRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<DraftRow | null>(null);
  const [generating, setGenerating] = useState(false);
  const [rewritingId, setRewritingId] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState<{ draftId: string; index: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<DraftRow | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedRef = useRef<Record<string, string[]>>({});
  const lastWsId = typeof window !== 'undefined' ? localStorage.getItem(LAST_WS_KEY) : null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로컬 저장값 복원(기존 코드베이스 관례, RefPickerSheet 선례)
    try { const s = localStorage.getItem(COMPOSER_KEY); if (s) setComposer({ ...DEFAULT_COMPOSER, ...JSON.parse(s) }); } catch { /* 무시 */ }
    Promise.all([
      apiFetch('/api/clients').then((r) => r.json()),
      apiFetch('/api/drafts').then((r) => r.json()),
    ]).then(([c, d]) => {
      setClients(c); setDrafts(d); setLoaded(true);
      // 복원된 clientId가 응답 목록에 없으면(유령 클라이언트) 정리 — 400 방지
      setComposer((cur) => (cur.clientId && !(c as Array<{ client: ClientRow }>).some((x) => x.client.id === cur.clientId)
        ? { ...cur, clientId: null, procedureIds: [] } : cur));
    }).catch(() => { setLoaded(true); setToast('목록을 불러오지 못했어요 — 새로고침해 주세요'); });
  }, []);
  const updateComposer = useCallback((v: ComposerState) => {
    setComposer(v);
    localStorage.setItem(COMPOSER_KEY, JSON.stringify({ ...v, direction: '' })); // 방향성은 매번 새로
  }, []);

  // 진입점 A: /generate?ref=<tweetId> — 보관함에 있으면 레퍼런스로 연결
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (!ref) return;
    apiFetch('/api/references?scope=all').then((r) => r.json()).then((rows: ReferenceRow[]) => {
      const found = rows.find((x) => x.tweetId === ref);
      if (found) setRefRows((cur) => (cur.some((x) => x.tweetId === ref) ? cur : [...cur, found]));
      else setToast('이 트윗은 보관함에 없어요 — 덱에서 ☆ 저장한 뒤 다시 시도해주세요');
    });
  }, [searchParams]);

  const selectedRefIds = useMemo(() => refRows.map((x) => x.tweetId), [refRows]);

  const bannedFor = useCallback((d: DraftRow) => {
    const c = clients.find((x) => x.client.id === d.clientId);
    if (!c) return [];
    return [...c.client.bannedPhrases, ...c.procedures.filter((p) => d.procedureNames.includes(p.name)).flatMap((p) => p.bannedPhrases)];
  }, [clients]);

  async function generate() {
    if (generating) return;
    setGenerating(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const src = {
        clientId: composer.clientId, procedureIds: composer.procedureIds,
        refTweetIds: refRows.map((x) => x.tweetId),
        mode: refRows.length > 0 ? composer.mode : 'off',
        direction: composer.direction, format: composer.format,
      };
      const r = await apiFetch('/api/drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({ ...src, constraintsOn: composer.constraintsOn }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setToast((body as { error?: string }).error ?? `오류 ${r.status}`); return; }
      setDrafts((cur) => [body as DraftRow, ...cur]);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setToast('생성 중 오류가 났어요 — 잠시 후 다시 시도해주세요');
    } finally {
      setGenerating(false); abortRef.current = null;
    }
  }

  // 다시 쓰기 — 같은 초안의 새 버전으로. 피드백이 있으면 반영, 없으면 같은 조건 재생성.
  // baseIndex = 사용자가 보고 있던 버전(그 버전을 기준으로 다시 쓴다).
  async function rewrite(id: string, feedback: string, baseIndex: number) {
    if (rewritingId) return;
    setRewritingId(id);
    try {
      const r = await apiFetch(`/api/drafts/${id}/rewrite`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseIndex, ...(feedback ? { feedback } : {}) }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setToast((body as { error?: string }).error ?? `오류 ${r.status}`); return; }
      setDrafts((cur) => cur.map((d) => (d.id === id ? (body as DraftRow) : d)));
    } catch {
      setToast('다시 쓰기 중 오류가 났어요 — 잠시 후 다시 시도해주세요');
    } finally {
      setRewritingId(null);
    }
  }

  function cancelGenerate() {
    abortRef.current?.abort();
    setToast('기다리기를 취소했어요 — 완성되면 목록에 저장됩니다 (새로고침으로 확인)');
  }

  async function patchDraft(id: string, body: object) {
    const r = await apiFetch(`/api/drafts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (r.ok) { const updated = (await r.json()) as DraftRow; setDrafts((cur) => cur.map((d) => (d.id === id ? updated : d))); return updated; }
    setToast(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    return null;
  }

  // 삭제: 낙관적 제거 + 5초 실행취소 (보관함 패턴)
  function requestRemove(d: DraftRow) {
    setToast(null); // 죽은 에러 토스트가 삭제 직후 다시 뜨는 것을 방지
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (pendingRemove) void apiFetch(`/api/drafts/${pendingRemove.id}`, { method: 'DELETE' });
    delete dismissedRef.current[d.id];
    setPendingRemove(d);
    setDrafts((cur) => cur.filter((x) => x.id !== d.id));
    removeTimer.current = setTimeout(() => {
      void apiFetch(`/api/drafts/${d.id}`, { method: 'DELETE' });
      setPendingRemove(null);
    }, 5000);
  }
  function undoRemove() {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (pendingRemove) setDrafts((cur) => [pendingRemove, ...cur]);
    setPendingRemove(null);
  }

  // 무시/되돌리기 — 연속 클릭 레이스 방지: 렌더 클로저가 아니라 ref 미러에서 누적 계산 (리뷰 발견)
  function toggleDismiss(d: DraftRow, key: string, dismiss: boolean) {
    const base = dismissedRef.current[d.id] ?? d.dismissedFlags;
    const next = dismiss ? [...new Set([...base, key])] : base.filter((k) => k !== key);
    dismissedRef.current[d.id] = next;
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, dismissedFlags: next } : x)));
    void patchDraft(d.id, { dismissedFlags: next });
  }
  function restoreAllFlags(d: DraftRow) {
    dismissedRef.current[d.id] = [];
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, dismissedFlags: [] } : x)));
    void patchDraft(d.id, { dismissedFlags: [] });
  }

  async function regenPost(d: DraftRow, index: number) {
    setRegenBusy({ draftId: d.id, index });
    const r = await apiFetch(`/api/drafts/${d.id}/regen-post`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index }),
    });
    if (r.ok) { const updated = (await r.json()) as DraftRow; setDrafts((cur) => cur.map((x) => (x.id === d.id ? updated : x))); }
    else setToast(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    setRegenBusy(null);
  }

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <div className="w-full max-w-[600px]">
        <h1 className="text-[20px] font-bold">콘텐츠 생성</h1>
        <p className="mt-0.5 text-ui text-x-secondary">레퍼런스와 클라이언트 정보를 조합해 인플루언서에게 보낼 X 원고 초안을 만들어요.</p>
        {loaded && clients.length === 0 && (
          <p className="mt-2 rounded-lg bg-x-surface p-3 text-ui text-x-secondary">
            클라이언트를 먼저 등록하면 클리닉 정보가 원고에 반영돼요 — <a href="/clients" className="font-bold text-x-blue-text hover:underline">등록하러 가기</a>
          </p>
        )}
      </div>

      <DraftComposer clients={clients} value={composer} onChange={updateComposer}
                     refRows={refRows} onOpenPicker={() => setPickerOpen(true)}
                     onRemoveRef={(id) => setRefRows((cur) => cur.filter((x) => x.tweetId !== id))}
                     onClearRefs={() => setRefRows([])}
                     generating={generating} onGenerate={() => generate()} onCancel={cancelGenerate} />

      {generating && (
        <div className="w-full max-w-[600px] animate-pulse rounded-2xl border border-x-border-strong bg-white px-4 py-3">
          <div className="flex gap-3">
            <div className="h-10 w-10 rounded-full bg-x-border" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-3.5 w-1/3 rounded bg-x-border" />
              <div className="h-3.5 w-full rounded bg-x-border" />
              <div className="h-3.5 w-4/5 rounded bg-x-border" />
            </div>
          </div>
          <p className="mt-2 text-ui text-x-secondary">원고 작성 중… 보통 15~30초 걸려요</p>
          <p className="mt-0.5 text-caption text-x-muted">취소해도 완성되면 목록에 저장됩니다 — 생성 자체는 멈추지 않아요</p>
        </div>
      )}

      {loaded && drafts.length === 0 && !generating && (
        <p className="w-full max-w-[600px] rounded-2xl border border-x-border bg-x-surface p-6 text-center text-ui text-x-secondary">
          아직 초안이 없어요. 방향성을 적거나 레퍼런스를 골라 첫 원고를 만들어보세요 — 만든 초안은 자동으로 저장돼요.
        </p>
      )}

      {drafts.map((d) => (
        <DraftCard key={d.id} draft={d} banned={bannedFor(d)}
                   onEdit={() => setEditing(d)}
                   onRewrite={(feedback, baseIndex) => rewrite(d.id, feedback, baseIndex)}
                   rewriteBusy={rewritingId === d.id}
                   onDelete={() => requestRemove(d)}
                   onRegenPost={(i) => regenPost(d, i)}
                   regenBusyIndex={regenBusy?.draftId === d.id ? regenBusy.index : null}
                   onDismissFlag={(key, dismiss) => toggleDismiss(d, key, dismiss)}
                   onRestoreAllFlags={() => restoreAllFlags(d)} />
      ))}

      {editing && (
        <DraftEditModal draft={editing} onClose={() => setEditing(null)}
                        onSaved={(u) => { setDrafts((cur) => cur.map((d) => (d.id === u.id ? u : d))); setEditing(null); }} />
      )}
      <RefPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} lastWsId={lastWsId}
                      selectedIds={selectedRefIds} seedRows={refRows} onApply={setRefRows} />
      {pendingRemove && <Toast message="초안을 삭제했어요" actionLabel="실행 취소" onAction={undoRemove} />}
      {toast && !pendingRemove && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
