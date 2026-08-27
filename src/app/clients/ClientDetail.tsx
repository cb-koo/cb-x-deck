'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button, PANEL, PANEL_SPLIT, PANEL_TITLE } from '@/components/ui';
import { procedureSummary } from '@/lib/clientSummary';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';
import { BudgetPanel } from './BudgetPanel';

// 부모(page)가 미저장 확인·일괄 저장에 쓰는 핸들
export interface DetailHandle { isDirty: () => boolean; saveAll: () => Promise<boolean> }
// 내부 편집기(기본 정보/펼친 시술)가 레지스트리에 등록하는 인터페이스
export type Editor = { isDirty: () => boolean; save: () => Promise<boolean> };
export type Register = (key: string, editor: Editor) => () => void;

// 줄바꿈 textarea ↔ string[] (금지 표현 입력)
const toLines = (arr: string[]) => arr.join('\n');
const fromLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

async function errOf(r: Response): Promise<string> {
  return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`;
}

export function ClientDetail({ data, handleRef, onChanged, onDeleted }: {
  data: { client: ClientRow; procedures: ProcedureRow[] };
  handleRef: React.RefObject<DetailHandle | null>;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}) {
  const { client, procedures } = data;
  const editors = useRef(new Map<string, Editor>());
  const register: Register = useCallback((key, editor) => {
    editors.current.set(key, editor);
    return () => { editors.current.delete(key); };
  }, []);
  useEffect(() => {
    const reg = editors.current;
    handleRef.current = {
      isDirty: () => [...reg.values()].some((e) => e.isDirty()),
      saveAll: async () => {
        for (const e of reg.values()) if (e.isDirty() && !(await e.save())) return false;
        return true;
      },
    };
    return () => { handleRef.current = null; };
  }, [handleRef]);

  // 이름 변경 (인라인) — workspaces/page.tsx saveRename 패턴
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const renaming = useRef(false); // IME Enter 이중 발화 방지
  // 삭제 모달 — 이름 입력 확인 (워크스페이스 삭제와 동일 격: 시술·초안 연결 파급이 있음)
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const deletingBusy = useRef(false);
  const [deleteErr, setDeleteErr] = useState('');
  // 시술 추가
  const [newProc, setNewProc] = useState('');
  const addingProc = useRef(false);
  const [err, setErr] = useState('');

  async function saveRename() {
    const name = editName.trim();
    if (!name || renaming.current) return;
    renaming.current = true;
    try {
      const r = await apiFetch(`/api/clients/${client.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!r.ok) { setErr(await errOf(r)); return; }
      setEditingName(false); setErr(''); await onChanged();
    } finally { renaming.current = false; }
  }

  async function confirmDelete() {
    if (confirmText !== client.name || deletingBusy.current) return;
    deletingBusy.current = true;
    try {
      const r = await apiFetch(`/api/clients/${client.id}`, { method: 'DELETE' });
      if (!r.ok) { setDeleteErr(await errOf(r)); return; } // 모달 유지해 재시도 가능하게
      setDeleting(false); setConfirmText(''); setDeleteErr('');
      onDeleted();
    } finally { deletingBusy.current = false; }
  }

  async function addProc() {
    const name = newProc.trim();
    if (!name || addingProc.current) return;
    addingProc.current = true;
    try {
      const r = await apiFetch(`/api/clients/${client.id}/procedures`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!r.ok) { setErr(await errOf(r)); return; }
      setErr(''); setNewProc(''); await onChanged();
    } finally { addingProc.current = false; }
  }

  return (
    // 연회색 바닥(page.tsx의 bg-x-surface) 위 흰 패널 4장: 헤더 / 기본 정보 / 시술 / 월 마케팅 예산 — 캠페인 상세와 같은 구조
    <div className="min-w-0 flex-1 space-y-5 p-5 pb-24">
      <div className={PANEL}>
      <div className="flex items-baseline justify-between gap-3">
        {editingName ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus
                   onKeyDown={(e) => {
                     if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveRename();
                     if (e.key === 'Escape') setEditingName(false);
                   }}
                   className="w-full max-w-[320px] rounded-lg border border-x-border-strong bg-white px-3 py-1.5 text-content outline-none focus:border-x-blue" />
            <Button variant="primary" className="shrink-0 whitespace-nowrap" onClick={saveRename}>저장</Button>
            <Button variant="ghost" className="shrink-0 whitespace-nowrap" onClick={() => setEditingName(false)}>취소</Button>
          </div>
        ) : (
          <>
            <h1 className="min-w-0 truncate text-[20px] font-bold">{client.name}</h1>
            <span className="flex shrink-0 items-center gap-3">
              <button onClick={() => { setEditingName(true); setEditName(client.name); }}
                      className="text-ui text-x-secondary hover:text-x-text">이름 변경</button>
              <button onClick={() => { setDeleting(true); setConfirmText(''); setDeleteErr(''); }}
                      className="text-ui text-x-secondary hover:text-red-500">삭제</button>
            </span>
          </>
        )}
      </div>
      {err && <p className="mt-2 text-ui text-red-500">{err}</p>}
      </div>

      <BasicInfoEditor key={client.id} client={client} register={register} onSaved={onChanged} />

      <div className={PANEL_SPLIT}>
        <div className="px-5 py-4">
          <h2 className={PANEL_TITLE}>시술 <span className="text-ui font-normal text-x-secondary">{procedures.length}개</span></h2>
          <p className="text-caption text-x-muted">원고를 만들 때 이번 건에 해당하는 시술만 골라 반영해요.</p>
        </div>
        <div className="border-t border-x-border px-5 py-5">
          <div className="space-y-2">
            {procedures.map((p) => (
              <ProcedureCard key={p.id} proc={p} register={register} onChanged={onChanged} />
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={newProc} onChange={(e) => setNewProc(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) addProc(); }}
                   placeholder="새 시술 이름 (예: 보톡스)"
                   className="w-56 rounded-md border border-x-border-strong px-2 py-1 text-ui outline-none focus:border-x-blue" />
            <Button onClick={addProc}>시술 추가</Button>
          </div>
        </div>
      </div>

      <BudgetPanel client={client} register={register} onChanged={onChanged} />

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setDeleting(false); setDeleteErr(''); }}>
          <div className="w-full max-w-[360px] rounded-xl bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
               role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-[20px] font-bold">클라이언트 삭제</h2>
            <p className="mb-1 text-content">
              &lsquo;{client.name}&rsquo;과(와) 시술 {procedures.length}개가 함께 삭제됩니다. 되돌릴 수 없습니다.
            </p>
            <p className="mb-3 text-caption text-x-muted">이 클라이언트로 만든 초안은 스냅샷으로 남아요.</p>
            <p className="mb-1 text-ui text-x-secondary">계속하려면 클라이언트 이름을 입력하세요</p>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus
                   onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) confirmDelete(); }}
                   placeholder={client.name}
                   className="mb-3 w-full rounded-lg border border-x-border-strong px-3 py-1.5 text-content outline-none focus:border-x-blue" />
            {deleteErr && <p className="mb-2 text-caption text-red-500">{deleteErr}</p>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => { setDeleting(false); setDeleteErr(''); }}>취소</Button>
              <button onClick={confirmDelete} disabled={confirmText !== client.name}
                      className="rounded-full bg-x-pink px-3 py-1 text-ui font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50">
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 기본 정보(클리닉·의사 정보 + 공통 금지 표현) 편집기.
// baseline(마지막 저장값) 대비로 dirty를 판정하고, 저장 성공 시 "저장됨 ✓"를 잠시 표시한다.
function BasicInfoEditor({ client, register, onSaved }: {
  client: ClientRow; register: Register; onSaved: () => Promise<void>;
}) {
  const [info, setInfo] = useState(client.info);
  const [banned, setBanned] = useState(toLines(client.bannedPhrases));
  const [landingUrl, setLandingUrl] = useState(client.landingUrl);
  const [nameEn, setNameEn] = useState(client.nameEn);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const baseline = useRef({ info: client.info, banned: toLines(client.bannedPhrases), landingUrl: client.landingUrl, nameEn: client.nameEn });
  const cur = useRef({ info, banned, landingUrl, nameEn });
  // 렌더 중 ref 쓰기는 금지(react-hooks/refs) — isDirty/save는 이벤트 핸들러에서만 읽으므로 커밋 후 갱신이면 충분
  useEffect(() => { cur.current = { info, banned, landingUrl, nameEn }; }, [info, banned, landingUrl, nameEn]);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      const r = await apiFetch(`/api/clients/${client.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          info: cur.current.info, bannedPhrases: fromLines(cur.current.banned),
          landingUrl: cur.current.landingUrl, nameEn: cur.current.nameEn,
        }),
      });
      if (!r.ok) { setErr(await errOf(r)); return false; }
      baseline.current = { ...cur.current };
      setErr(''); setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2500);
      await onSaved();
      return true;
    } finally { setSaving(false); }
  }, [client.id, onSaved]);

  useEffect(() => register('info', {
    isDirty: () =>
      cur.current.info !== baseline.current.info || cur.current.banned !== baseline.current.banned ||
      cur.current.landingUrl !== baseline.current.landingUrl || cur.current.nameEn !== baseline.current.nameEn,
    save,
  }), [register, save]);

  return (
    <div className={PANEL}>
      <h2 className={`${PANEL_TITLE} mb-3`}>기본 정보</h2>
      {err && <p className="mb-2 text-ui text-red-500">{err}</p>}
      <label className="block">
        <span className="text-ui font-bold">기본 랜딩페이지 주소 <span className="font-normal text-x-muted">선택</span></span>
        <p className="text-caption text-x-muted">트래킹 링크를 만들 때 이 주소가 자동으로 채워져요. (만들 때 바꿀 수도 있어요)</p>
        <input type="url" value={landingUrl} onChange={(e) => { setLandingUrl(e.target.value); setSaved(false); }}
               placeholder="https://…" autoComplete="off" spellCheck={false}
               className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui outline-none focus:border-x-blue" />
      </label>
      <label className="mt-3 block">
        <span className="text-ui font-bold">영문 이름 <span className="font-normal text-x-muted">선택</span></span>
        <p className="text-caption text-x-muted">트래킹 링크의 캠페인명에 쓰여요 — 영어·숫자로. (예: yonsei-clinic)</p>
        <input value={nameEn} onChange={(e) => { setNameEn(e.target.value); setSaved(false); }}
               placeholder="yonsei-clinic" autoComplete="off" autoCapitalize="none" spellCheck={false}
               className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui outline-none focus:border-x-blue" />
      </label>
      <label className="mt-3 block">
        <span className="text-ui font-bold">클리닉·의사 정보</span>
        <p className="text-caption text-x-muted">원고를 만드는 재료예요. 기존 소개 문서를 붙여넣어도 좋아요.</p>
        <textarea value={info} onChange={(e) => { setInfo(e.target.value); setSaved(false); }} rows={6}
                  className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui leading-normal outline-none focus:border-x-blue" />
      </label>
      <label className="mt-3 block">
        <span className="text-ui font-bold">금지 표현 <span className="font-normal text-x-muted">한 줄에 하나</span></span>
        <p className="text-caption text-x-muted">원고에 절대 쓰면 안 되는 말 — 검수 기준으로도 쓰여요. (예: 경쟁사명, 계약상 못 쓰는 표현)</p>
        <textarea value={banned} onChange={(e) => { setBanned(e.target.value); setSaved(false); }} rows={3}
                  className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui leading-normal outline-none focus:border-x-blue" />
      </label>
      <div className="mt-3 flex items-center gap-2.5">
        <Button variant="primary" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</Button>
        {saved && <span className="text-ui font-medium text-x-green">저장됨 ✓</span>}
      </div>
    </div>
  );
}

// 시술 카드 — 접힘 시 요약 줄(채움 상태), 펼침 시 편집기. 삭제는 2단계 확인.
function ProcedureCard({ proc, register, onChanged }: {
  proc: ProcedureRow; register: Register; onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState('');
  const summary = procedureSummary(proc);

  async function remove() {
    const r = await apiFetch(`/api/procedures/${proc.id}`, { method: 'DELETE' });
    if (!r.ok) { setErr(await errOf(r)); return; }
    setErr(''); await onChanged();
  }

  return (
    <div className="rounded-lg border border-x-border bg-x-surface px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <button onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left">
          <span className="text-ui font-medium hover:text-x-blue-text">{proc.name} {open ? '⌃' : '⌄'}</span>
          {!open && (
            <p className={`text-caption ${summary.empty ? 'text-[#b45309]' : 'text-x-secondary'}`}>{summary.text}</p>
          )}
        </button>
        {confirmDel ? (
          <span className="flex shrink-0 items-center gap-2 text-caption">
            <button onClick={remove} className="rounded bg-red-600 px-2 py-0.5 text-white">삭제 확정</button>
            <button onClick={() => setConfirmDel(false)} className="rounded border border-x-border-strong px-2 py-0.5">취소</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDel(true)} className="shrink-0 text-caption text-x-muted hover:text-red-500">삭제</button>
        )}
      </div>
      {err && <p className="mt-1 text-ui text-red-500">{err}</p>}
      {open && <ProcedureEditor proc={proc} register={register} onSaved={onChanged} onClose={() => setOpen(false)} />}
    </div>
  );
}

// 펼친 시술 편집기 — 펼쳐진 동안만 레지스트리에 등록된다 (접으면 dirty 대상에서 제외).
function ProcedureEditor({ proc, register, onSaved, onClose }: {
  proc: ProcedureRow; register: Register; onSaved: () => Promise<void>; onClose: () => void;
}) {
  const [description, setDescription] = useState(proc.description);
  const [effect, setEffect] = useState(proc.effectPhrases);
  const [banned, setBanned] = useState(toLines(proc.bannedPhrases));
  const [err, setErr] = useState('');
  const baseline = useRef({ description: proc.description, effect: proc.effectPhrases, banned: toLines(proc.bannedPhrases) });
  const cur = useRef({ description, effect, banned });
  // 렌더 중 ref 쓰기는 금지(react-hooks/refs) — isDirty/save는 이벤트 핸들러에서만 읽으므로 커밋 후 갱신이면 충분
  useEffect(() => { cur.current = { description, effect, banned }; }, [description, effect, banned]);

  const save = useCallback(async (): Promise<boolean> => {
    const r = await apiFetch(`/api/procedures/${proc.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: cur.current.description, effectPhrases: cur.current.effect,
        bannedPhrases: fromLines(cur.current.banned),
      }),
    });
    if (!r.ok) { setErr(await errOf(r)); return false; }
    baseline.current = { ...cur.current };
    setErr('');
    await onSaved();
    return true;
  }, [proc.id, onSaved]);

  useEffect(() => register(`proc:${proc.id}`, {
    isDirty: () =>
      cur.current.description !== baseline.current.description ||
      cur.current.effect !== baseline.current.effect ||
      cur.current.banned !== baseline.current.banned,
    save,
  }), [register, save, proc.id]);

  async function saveAndClose() { if (await save()) onClose(); }

  return (
    <div className="mt-2 space-y-2">
      {err && <p className="text-ui text-red-500">{err}</p>}
      <label className="block">
        <span className="text-caption font-bold text-x-secondary">시술 설명</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                  className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white p-2 text-ui outline-none focus:border-x-blue" />
      </label>
      <label className="block">
        <span className="text-caption font-bold text-x-secondary">효과·결과로 쓸 수 있는 표현</span>
        <p className="text-caption text-x-muted">여기 적힌 범위까지만 원고에 사용돼요.</p>
        <textarea value={effect} onChange={(e) => setEffect(e.target.value)} rows={2}
                  className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white p-2 text-ui outline-none focus:border-x-blue" />
      </label>
      <label className="block">
        <span className="text-caption font-bold text-x-secondary">이 시술만의 금지 표현 <span className="font-normal text-x-muted">한 줄에 하나</span></span>
        <textarea value={banned} onChange={(e) => setBanned(e.target.value)} rows={2}
                  className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white p-2 text-ui outline-none focus:border-x-blue" />
      </label>
      <Button variant="primary" onClick={saveAndClose}>시술 저장</Button>
    </div>
  );
}
