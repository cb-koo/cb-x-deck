'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button, PANEL } from '@/components/ui';
import { EDIT_INPUT as INPUT } from '@/components/product/EditorParts';
import { representativeLocation, type ClinicSummary } from '@/lib/clinicLocation';

type Row = ClinicSummary & { reservations: number };
async function errOf(r: Response): Promise<string> {
  return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`;
}

// 클라이언트 상세의 '지점' 탭 — 지점 추가·이름·순서·사용 중지·삭제. 서버가 규칙(중복 이름·마지막 사용 중 지점 등)을 지키고,
// 여기서는 막힌 이유를 그 자리에 보여 준다. 목록은 매번 서버에서 다시 받아 순서·대표 표시를 항상 서버 기준으로 맞춘다.
export function BranchesTab({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');           // 목록 단위 오류(추가·순서 변경)
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState(''), [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/clients/${clientId}/locations`);
    if (!r.ok) { setError(await errOf(r)); return; }
    setRows(((await r.json()) as { items: Row[] }).items);
  }, [clientId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 최초 로드(기존 코드베이스 관례)
  useEffect(() => { void load(); }, [load]);

  const call = useCallback(async (path: string, method: string, body?: unknown) =>
    apiFetch(`/api/clients/${clientId}/locations${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), [clientId]);

  async function patch(id: string, body: object) {
    setBusy(true); setRowError((e) => ({ ...e, [id]: '' }));
    try {
      const r = await call(`/${id}`, 'PATCH', body);
      if (!r.ok) { const msg = await errOf(r); setRowError((e) => ({ ...e, [id]: msg })); return false; }
      await load(); return true;
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setRowError((e) => ({ ...e, [id]: '' }));
    try {
      const r = await call(`/${id}`, 'DELETE');
      if (!r.ok) { const msg = await errOf(r); setRowError((e) => ({ ...e, [id]: msg })); return; }
      await load();
    } finally { setBusy(false); }
  }
  // ↑↓ — 이웃과 자리를 바꾼다. 순서 값이 겹쳐 있어도 되도록 바뀐 순서대로 1..n을 다시 매기고 달라진 행만 저장한다.
  async function move(index: number, dir: -1 | 1) {
    if (!rows) return;
    const next = [...rows]; const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setBusy(true); setError('');
    try {
      for (const [i, l] of next.entries()) {
        if (l.position === i + 1) continue;
        const r = await call(`/${l.id}`, 'PATCH', { position: i + 1 });
        if (!r.ok) { setError(await errOf(r)); break; }
      }
      await load();
    } finally { setBusy(false); }
  }
  async function add() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true); setError('');
    try {
      const r = await call('', 'POST', { name });
      if (!r.ok) { setError(await errOf(r)); return; }
      setNewName(''); setAdding(false); await load();
    } finally { setBusy(false); }
  }

  if (!rows) return <div className={PANEL}>{error ? <p role="alert" className="text-content text-amber-800">{error}</p> : <p className="text-content text-x-secondary">지점을 불러오는 중…</p>}</div>;
  const rep = representativeLocation(rows);
  const activeCount = rows.filter((l) => l.active).length;
  return (
    <div className={`${PANEL} space-y-3`}>
      <p className="text-ui text-x-secondary">
        지점마다 운영시간·지도·방문 안내를 따로 둘 수 있어요. 맨 위의 사용 중 지점이 대표 지점이고, 예약 양식은 대표 지점 기준으로 읽어요.
        사용 중지한 지점은 새 예약에서 빠지고, 이미 있는 예약은 그대로 남아요.
      </p>
      {error && <p role="alert" className="text-ui text-red-500">{error}</p>}
      <ul className="divide-y divide-x-border rounded-lg border border-x-border">
        {rows.map((l, i) => (
          <li key={l.id} className={`px-3 py-2 ${l.active ? '' : 'bg-x-surface'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex flex-col">
                <button type="button" aria-label="위로" disabled={busy || i === 0} onClick={() => void move(i, -1)} className="px-1 text-x-secondary hover:text-x-text disabled:opacity-30">▲</button>
                <button type="button" aria-label="아래로" disabled={busy || i === rows.length - 1} onClick={() => void move(i, 1)} className="px-1 text-x-secondary hover:text-x-text disabled:opacity-30">▼</button>
              </span>
              <NameInput key={`${l.id}:${l.branchName}`} value={l.branchName} placeholder={l.kind === 'main' ? '본점' : '지점명'}
                         disabled={busy} onSave={(name) => patch(l.id, { name })} />
              <span className="rounded-full bg-x-hover px-2 py-0.5 text-caption text-x-secondary">{l.kind === 'main' ? '본점' : '지점'}</span>
              {rep?.id === l.id && <span className="rounded-full bg-x-blue/10 px-2 py-0.5 text-caption font-medium text-x-blue-text">대표</span>}
              {!l.active && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-caption text-amber-800">사용 중지</span>}
              <span className="text-caption text-x-secondary">예약 {l.reservations}건</span>
              <span className="ml-auto flex items-center gap-1">
                <Button disabled={busy || (l.active && activeCount <= 1)} title={l.active && activeCount <= 1 ? '사용 중인 지점이 하나는 있어야 해요.' : undefined}
                        onClick={() => void patch(l.id, { active: !l.active })}>{l.active ? '사용 중지' : '다시 사용'}</Button>
                <Button variant="ghost" className="hover:text-red-500" disabled={busy || l.kind === 'main' || l.reservations > 0}
                        title={l.kind === 'main' ? '본점은 삭제할 수 없어요. 이름을 바꾸거나 사용 중지해 주세요.' : l.reservations > 0 ? '예약이 연결된 지점은 삭제할 수 없어요. 대신 사용 중지해 주세요.' : undefined}
                        onClick={() => void remove(l.id)}>삭제</Button>
              </span>
            </div>
            {(l.kind === 'main' || l.reservations > 0) && (
              <p className="mt-1 pl-7 text-caption text-x-secondary">
                {l.kind === 'main' ? '본점은 삭제할 수 없어요. 이름을 바꾸거나 사용 중지해 주세요.' : '예약이 연결돼 있어 삭제할 수 없어요. 대신 사용 중지해 주세요.'}
              </p>
            )}
            {rowError[l.id] && <p role="alert" className="mt-1 pl-7 text-ui text-red-500">{rowError[l.id]}</p>}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="flex items-center gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="새 지점 이름 (예: 명동점)" maxLength={100} autoFocus
                 onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void add(); }} className={`${INPUT} max-w-xs`} />
          <Button variant="primary" disabled={busy || !newName.trim()} onClick={() => void add()}>추가</Button>
          <Button variant="ghost" onClick={() => { setAdding(false); setNewName(''); setError(''); }}>취소</Button>
        </div>
      ) : <Button onClick={() => setAdding(true)}>+ 지점 추가</Button>}
    </div>
  );
}

// 이름 칸 — 포커스를 잃을 때(blur) 바뀐 경우만 저장한다. 저장이 거절되면 서버 값으로 되돌린다(부모가 key로 다시 그림).
function NameInput({ value, placeholder, disabled, onSave }: { value: string; placeholder: string; disabled: boolean; onSave: (name: string) => Promise<boolean> }) {
  const [text, setText] = useState(value);
  return <input value={text} placeholder={placeholder} disabled={disabled} maxLength={100} aria-label="지점 이름" onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur(); }}
                onBlur={() => { if (text.trim() !== value) void onSave(text).then((ok) => { if (!ok) setText(value); }); }}
                className={`${INPUT} max-w-[200px]`} />;
}
