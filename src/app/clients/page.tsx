'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';

type ClientWithProcs = { client: ClientRow; procedures: ProcedureRow[] };

// 줄바꿈 textarea ↔ string[] (금지 표현 입력)
const toLines = (arr: string[]) => arr.join('\n');
const fromLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export default function ClientsPage() {
  const [rows, setRows] = useState<ClientWithProcs[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const r = await apiFetch('/api/clients');
    if (r.ok) setRows(await r.json());
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const selected = rows.find((x) => x.client.id === selectedId) ?? null;

  async function createClient() {
    const name = newName.trim();
    if (!name) return;
    const r = await apiFetch('/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? `오류 ${r.status}`); return; }
    const c = (await r.json()) as ClientRow;
    setNewName(''); await load(); setSelectedId(c.id);
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-[20px] font-bold">클라이언트</h1>
      <p className="mt-1 text-ui text-x-secondary">
        클리닉 정보와 금지 표현을 한 번 등록해두면, 원고를 만들 때마다 자동으로 반영돼요.
      </p>
      {err && <p className="mt-2 text-ui text-red-500">{err}</p>}

      <div className="mt-4 flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) createClient(); }}
               placeholder="새 클라이언트 이름 (예: A클리닉)"
               className="w-64 rounded-md border border-x-border-strong bg-white px-3 py-1.5 text-ui outline-none focus:border-x-blue" />
        <Button variant="primary" onClick={createClient}>추가</Button>
      </div>

      {loaded && rows.length === 0 && (
        <p className="mt-6 rounded-lg bg-x-surface p-4 text-ui text-x-secondary">
          아직 클라이언트가 없어요. 위에서 이름을 추가하면 상세 정보를 채울 수 있어요.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {rows.map(({ client }) => (
          <button key={client.id} onClick={() => setSelectedId(client.id)}
                  className={`rounded-full border px-3 py-1 text-ui ${selectedId === client.id ? 'border-x-blue text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
            {client.name}
          </button>
        ))}
      </div>

      {selected && <ClientEditor key={selected.client.id} data={selected} onChanged={load} onDeleted={() => { setSelectedId(null); load(); }} />}
    </div>
  );
}

function ClientEditor({ data, onChanged, onDeleted }: {
  data: ClientWithProcs; onChanged: () => Promise<void>; onDeleted: () => void;
}) {
  const { client, procedures } = data;
  const [info, setInfo] = useState(client.info);
  const [banned, setBanned] = useState(toLines(client.bannedPhrases));
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [newProc, setNewProc] = useState('');

  async function save() {
    setSaving(true);
    await apiFetch(`/api/clients/${client.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ info, bannedPhrases: fromLines(banned) }),
    });
    setSaving(false); await onChanged();
  }
  async function removeClient() {
    await apiFetch(`/api/clients/${client.id}`, { method: 'DELETE' });
    onDeleted();
  }
  async function addProc() {
    const name = newProc.trim();
    if (!name) return;
    await apiFetch(`/api/clients/${client.id}/procedures`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    setNewProc(''); await onChanged();
  }

  return (
    <div className="mt-6 rounded-2xl border border-x-border-strong">
      <div className="flex items-baseline justify-between px-4 py-3">
        <h2 className="text-[15px] font-bold">{client.name}</h2>
        {confirmDel ? (
          <span className="flex items-center gap-2 text-caption">
            <span className="text-red-600">시술·초안 연결이 함께 정리돼요. 초안은 스냅샷으로 남아요.</span>
            <button onClick={removeClient} className="rounded bg-red-600 px-2 py-0.5 text-white">삭제 확정</button>
            <button onClick={() => setConfirmDel(false)} className="rounded border border-x-border-strong px-2 py-0.5">취소</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDel(true)} className="text-caption text-x-muted hover:text-red-500">클라이언트 삭제</button>
        )}
      </div>

      <div className="space-y-4 border-t border-x-border px-4 py-4">
        <label className="block">
          <span className="text-caption text-x-muted">클리닉·의사 정보 — 원고를 만드는 재료예요. 기존 소개 문서를 붙여넣어도 좋아요</span>
          <textarea value={info} onChange={(e) => setInfo(e.target.value)} rows={6}
                    className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui leading-normal outline-none focus:border-x-blue" />
        </label>
        <label className="block">
          <span className="text-caption text-x-muted">금지 표현 (한 줄에 하나) — 원고 검수 기준으로도 쓰여요 (예: 경쟁사명, 계약상 못 쓰는 표현)</span>
          <textarea value={banned} onChange={(e) => setBanned(e.target.value)} rows={3}
                    className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui leading-normal outline-none focus:border-x-blue" />
        </label>
        <Button variant="primary" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</Button>
      </div>

      <div className="border-t border-x-border px-4 py-4">
        <h3 className="text-ui font-medium">시술 ({procedures.length})</h3>
        <p className="text-caption text-x-muted">원고를 만들 때 이번 건에 해당하는 시술만 골라 반영해요</p>
        <div className="mt-2 space-y-3">
          {procedures.map((p) => <ProcedureEditor key={p.id} proc={p} onChanged={onChanged} />)}
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
  );
}

function ProcedureEditor({ proc, onChanged }: { proc: ProcedureRow; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState(proc.description);
  const [effect, setEffect] = useState(proc.effectPhrases);
  const [banned, setBanned] = useState(toLines(proc.bannedPhrases));

  async function save() {
    await apiFetch(`/api/procedures/${proc.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, effectPhrases: effect, bannedPhrases: fromLines(banned) }),
    });
    setOpen(false); await onChanged();
  }
  async function remove() {
    await apiFetch(`/api/procedures/${proc.id}`, { method: 'DELETE' });
    await onChanged();
  }

  return (
    <div className="rounded-lg border border-x-border bg-x-surface px-3 py-2">
      <div className="flex items-baseline justify-between">
        <button onClick={() => setOpen(!open)} className="text-ui font-medium hover:text-x-blue-text">
          {proc.name} {open ? '⌃' : '⌄'}
        </button>
        <button onClick={remove} className="text-caption text-x-muted hover:text-red-500">삭제</button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <label className="block">
            <span className="text-caption text-x-muted">시술 설명</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                      className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white p-2 text-ui outline-none focus:border-x-blue" />
          </label>
          <label className="block">
            <span className="text-caption text-x-muted">효과·결과로 쓸 수 있는 표현 — 여기 적힌 범위까지만 원고에 사용돼요</span>
            <textarea value={effect} onChange={(e) => setEffect(e.target.value)} rows={2}
                      className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white p-2 text-ui outline-none focus:border-x-blue" />
          </label>
          <label className="block">
            <span className="text-caption text-x-muted">이 시술만의 금지 표현 (한 줄에 하나)</span>
            <textarea value={banned} onChange={(e) => setBanned(e.target.value)} rows={2}
                      className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white p-2 text-ui outline-none focus:border-x-blue" />
          </label>
          <Button variant="primary" onClick={save}>시술 저장</Button>
        </div>
      )}
    </div>
  );
}
