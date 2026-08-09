'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { clientSummary } from '@/lib/clientSummary';
import { relTime } from '@/lib/relTime';
import { setNavGuard } from '@/lib/navGuard';
import { ClientDetail, type DetailHandle } from './ClientDetail';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';

type ClientWithProcs = { client: ClientRow; procedures: ProcedureRow[] };
// 미저장 확인 모달의 이동 대상 — 페이지 내 클라이언트 전환 또는 밖으로의 이동(워크스페이스 select)
type PendingNav = { kind: 'client'; id: string } | { kind: 'href'; href: string };

export default function ClientsPage() {
  // useSearchParams는 Suspense 경계 필수 (generate/page.tsx 선례)
  return <Suspense><ClientsSplit /></Suspense>;
}

function ClientsSplit() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlId = searchParams.get('client');

  const [rows, setRows] = useState<ClientWithProcs[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [notice, setNotice] = useState(''); // 무효 딥링크 폴백 안내
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const creating = useRef(false); // IME Enter 이중 발화·더블클릭 중복 생성 방지
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<PendingNav | null>(null);
  const [guardErr, setGuardErr] = useState('');
  const guardBusy = useRef(false);
  const detailRef = useRef<DetailHandle | null>(null);

  const load = useCallback(async () => {
    setLoadErr(false);
    try {
      const r = await apiFetch('/api/clients');
      if (!r.ok) throw new Error(String(r.status));
      setRows(await r.json());
    } catch {
      setLoadErr(true); // 실패를 빈 상태로 위장하지 않는다
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selected = rows.find((x) => x.client.id === urlId) ?? null;

  // 쿼리 없음/무효 → 첫 번째로 폴백. 무효 딥링크(삭제된 클라이언트 등)면 정직하게 알린다 (87f8353 원칙).
  useEffect(() => {
    if (!loaded || loadErr || rows.length === 0 || selected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 폴백 안내는 URL 교체와 함께 1회 설정 (기존 코드베이스 관례)
    if (urlId) setNotice('링크가 가리키는 클라이언트를 찾을 수 없어 첫 번째 클라이언트를 표시했어요.');
    router.replace(`${pathname}?client=${rows[0].client.id}`);
  }, [loaded, loadErr, rows, selected, urlId, pathname, router]);

  // 탭 닫기·새로고침 유실 방지 (페이지 내 전환은 selectClient 모달이 담당)
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (detailRef.current?.isDirty()) e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  // 워크스페이스 select 전환(클라이언트 라우팅)은 beforeunload를 우회한다 — navGuard로 같은 모달에 연결.
  // 사이드바 페이지 링크는 전부 <a>(하드 내비게이션)라 위 beforeunload가 잡는다.
  useEffect(() => setNavGuard((href) => {
    if (!detailRef.current?.isDirty()) return false;
    setPending({ kind: 'href', href });
    setGuardErr('');
    return true;
  }), []);

  function applySelect(id: string) {
    setNotice('');
    router.replace(`${pathname}?client=${id}`);
  }
  function selectClient(id: string) {
    if (id === urlId) return;
    if (detailRef.current?.isDirty()) { setPending({ kind: 'client', id }); setGuardErr(''); return; }
    applySelect(id);
  }

  // 모달의 "이동" 실행 — 대상 종류에 따라 페이지 내 전환 또는 라우터 이동
  function proceedPending() {
    if (!pending) return;
    setPending(null);
    if (pending.kind === 'client') applySelect(pending.id);
    else router.push(pending.href);
  }

  async function guardSaveAndMove() {
    if (!pending || guardBusy.current) return;
    guardBusy.current = true;
    try {
      const ok = (await detailRef.current?.saveAll()) ?? true;
      if (!ok) { setGuardErr('저장하지 못했어요 — 네트워크를 확인하고 다시 시도해주세요.'); return; }
      proceedPending();
    } finally { guardBusy.current = false; }
  }

  async function createClient() {
    const name = newName.trim();
    if (!name || creating.current) return;
    creating.current = true;
    try {
      // 편집 중이던 내용은 자동 저장 후 진행 — 생성 의사가 명확하므로 모달을 띄우지 않는다
      if (detailRef.current?.isDirty() && !(await detailRef.current.saveAll())) {
        setErr('편집 중인 내용을 저장하지 못해 생성을 멈췄어요 — 네트워크를 확인해주세요.');
        return;
      }
      const r = await apiFetch('/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!r.ok) { setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`); return; }
      const c = (await r.json()) as ClientRow;
      setNewName(''); setAdding(false); setErr('');
      await load();
      applySelect(c.id);
    } finally { creating.current = false; }
  }

  // 삭제 후: 쿼리를 비우면 폴백 effect가 첫 번째(남은 것)를 안내 없이 선택한다
  function handleDeleted() {
    router.replace(pathname);
    load();
  }

  return (
    <div className="flex">
      <aside className="sticky top-0 max-h-screen w-[236px] shrink-0 self-start overflow-y-auto border-r border-x-border px-3 py-5">
        <div className="mb-3 flex items-center justify-between px-2">
          <h2 className="text-content font-bold">클라이언트</h2>
          <button onClick={() => setAdding(true)} className="text-ui font-medium text-x-blue-text hover:underline">+ 추가</button>
        </div>
        <p className="mb-3 px-2 text-caption text-x-muted">
          클리닉 정보와 금지 표현을 등록해두면 원고를 만들 때마다 자동으로 반영돼요.
        </p>
        {adding && (
          <div className="mb-2 px-1">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
                   onKeyDown={(e) => {
                     if (e.key === 'Enter' && !e.nativeEvent.isComposing) createClient();
                     if (e.key === 'Escape') { setAdding(false); setNewName(''); }
                   }}
                   placeholder="새 클라이언트 이름"
                   className="w-full rounded-lg border border-x-border-strong px-2.5 py-1.5 text-ui outline-none focus:border-x-blue" />
            <div className="mt-1.5 flex gap-1.5">
              <Button variant="primary" onClick={createClient}>만들기</Button>
              <Button variant="ghost" onClick={() => { setAdding(false); setNewName(''); }}>취소</Button>
            </div>
          </div>
        )}
        {err && <p className="mb-2 px-2 text-caption text-red-500">{err}</p>}

        {!loaded && <p className="px-2 py-4 text-ui text-x-muted">불러오는 중…</p>}
        {loaded && loadErr && (
          <div className="px-2 py-4">
            <p className="mb-2 text-ui text-x-secondary">목록을 불러오지 못했습니다</p>
            <Button onClick={load}>다시 시도</Button>
          </div>
        )}
        {loaded && !loadErr && rows.map(({ client, procedures }) => {
          const s = clientSummary(client, procedures);
          const on = client.id === urlId;
          return (
            <button key={client.id} onClick={() => selectClient(client.id)}
                    className={`mb-0.5 block w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                      on ? 'bg-[#e3f1fb]' : 'hover:bg-x-hover'
                    }`}>
              <p className={`flex items-center gap-1.5 text-ui font-semibold ${on ? 'text-x-blue-text' : ''}`}>
                <span className="min-w-0 truncate">{client.name}</span>
                {s.infoMissing && <span title="클리닉 정보 미입력" className="shrink-0 text-caption text-[#b45309]">⚠️</span>}
              </p>
              <p className="text-caption text-x-muted">
                시술 {s.procedureCount} · {s.infoMissing ? '정보 미입력' : `금지 ${s.bannedTotal}`} · {relTime(client.updatedAt, '수정')}
              </p>
            </button>
          );
        })}
      </aside>

      <main className="min-w-0 flex-1">
        {notice && (
          <p className="mx-6 mt-4 rounded-lg bg-x-surface px-3 py-2 text-ui text-x-secondary">{notice}</p>
        )}
        {loaded && !loadErr && rows.length === 0 && !adding && (
          <div className="px-6 py-16 text-center">
            <p className="mb-1 text-content font-bold">아직 클라이언트가 없어요</p>
            <p className="mb-4 text-ui text-x-secondary">
              클리닉 정보와 금지 표현을 등록해두면, 원고를 만들 때마다 자동으로 반영돼요.
            </p>
            <Button variant="primary" onClick={() => setAdding(true)}>+ 새 클라이언트</Button>
          </div>
        )}
        {selected && (
          <ClientDetail key={selected.client.id} data={selected}
                        handleRef={detailRef} onChanged={load} onDeleted={handleDeleted} />
        )}
      </main>

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPending(null)}>
          <div className="w-full max-w-[360px] rounded-xl bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
               role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-[20px] font-bold">저장 안 한 변경이 있어요</h2>
            <p className="mb-4 text-content">지금 이동하면 편집 중인 내용이 사라져요. 어떻게 할까요?</p>
            {guardErr && <p className="mb-2 text-caption text-red-500">{guardErr}</p>}
            <div className="flex flex-col gap-2">
              <Button variant="primary" onClick={guardSaveAndMove}>저장하고 이동</Button>
              <Button onClick={proceedPending}>저장 안 하고 이동</Button>
              <Button variant="ghost" onClick={() => setPending(null)}>취소</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
