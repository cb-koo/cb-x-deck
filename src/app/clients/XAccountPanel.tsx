// 클라이언트 상세 › 기본 정보 탭의 'X 업로드' 패널 — X 계정과 업로드 약속(주 N회). 스펙 2026-10-20 §2-2
// 저장할 때 X에서 계정을 확인한다(틀린 핸들로 매일 0을 세지 않게). 다른 계정으로 바꾸거나 비우면 이전 기록이 지워져서 한 번 확인을 받는다.
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { Button, PANEL, PANEL_TITLE } from '@/components/ui';
import type { Register } from './ClientDetail';

type Channel = { handle: string; weeklyTarget: number | null; promiseStartedOn: string | null; followers: number | null; lastError: string | null };
// 오늘(한국) — 새 계정의 약속 시작일 기본값
const todayKst = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const TARGETS = [1, 2, 3, 5, 7];
const norm = (h: string) => h.trim().replace(/^@/, '').toLowerCase();

export function XAccountPanel({ clientId, register }: { clientId: string; register: Register }) {
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [handle, setHandle] = useState('');
  const [target, setTarget] = useState<number | null>(1);
  const [start, setStart] = useState(todayKst);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState<'replace' | 'remove' | null>(null);
  const [newName, setNewName] = useState<string | null>(null);   // 교체 확인에 보일 새 계정 이름

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await apiFetch(`/api/clients/${clientId}/x-account`);
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { channel: Channel | null; suggestion: string | null };
        if (!alive) return;
        setChannel(d.channel); setSuggestion(d.suggestion);
        setHandle(d.channel ? `@${d.channel.handle}` : ''); setTarget(d.channel ? d.channel.weeklyTarget : 1); setStart(d.channel?.promiseStartedOn ?? (d.channel ? '' : todayKst()));
        setLoaded(true);
      } catch { if (alive) { setLoadErr(true); setLoaded(true); } }
    })();
    return () => { alive = false; };
  }, [clientId]);

  const cur = useRef({ handle, target, start });
  useEffect(() => { cur.current = { handle, target, start }; }, [handle, target, start]);
  const base = useRef<{ handle: string; target: number | null; start: string }>({ handle: '', target: 1, start: '' });
  useEffect(() => { base.current = { handle: channel ? `@${channel.handle}` : '', target: channel ? channel.weeklyTarget : 1, start: channel?.promiseStartedOn ?? '' }; }, [channel]);

  const isDirty = useCallback(() => {
    const c = cur.current, b = base.current;
    if (!channel && !norm(c.handle)) return false;   // 비어 있는 칸에서 약속만 만진 건 저장할 게 없다
    return norm(c.handle) !== norm(b.handle) || c.target !== b.target || c.start !== b.start;
  }, [channel]);

  const doSave = useCallback(async (): Promise<boolean> => {
    const h = norm(cur.current.handle);
    setSaving(true); setErr(''); setNote('');
    try {
      if (!h) {
        const r = await apiFetch(`/api/clients/${clientId}/x-account`, { method: 'DELETE' });
        if (!r.ok) { setErr('연결을 끊지 못했어요 — 다시 시도해 주세요'); return false; }
        setChannel(null); setNote('X 계정 연결을 끊었어요');
        return true;
      }
      const r = await apiFetch(`/api/clients/${clientId}/x-account`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: cur.current.handle, weeklyTarget: cur.current.target, promiseStartedOn: cur.current.start || null }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        error?: string; channel?: Channel; name?: string | null; isNew?: boolean; collected?: boolean | null;
      };
      if (!r.ok || !body.channel) { setErr(body.error ?? '저장하지 못했어요'); return false; }
      const wasTarget = channel?.weeklyTarget ?? null;
      const wasStart = channel?.promiseStartedOn ?? null;
      const renamed = !!channel && norm(channel.handle) !== norm(body.channel.handle);
      setChannel(body.channel); setHandle(`@${body.channel.handle}`); setStart(body.channel.promiseStartedOn ?? '');
      const who = body.name ? `${body.name}(@${body.channel.handle})` : `@${body.channel.handle}`;
      // 문구는 서버가 실제로 한 일에서 고른다 — 받지 않았으면 받았다고 말하지 않는다(UX 원칙 4)
      if (body.isNew) setNote(body.collected ? `${who} 계정을 확인했어요. 지난 8주 글을 받아 왔어요.` : `${who} 계정을 저장했어요. 글은 내일 아침에 받아 와요.`);
      else if (renamed) setNote('새 이름으로 저장했어요. 같은 계정이라 기록은 그대로예요.');
      else if (wasStart !== body.channel.promiseStartedOn && wasTarget === body.channel.weeklyTarget)
        setNote(body.channel.promiseStartedOn ? `${Number(body.channel.promiseStartedOn.slice(5, 7))}/${Number(body.channel.promiseStartedOn.slice(8, 10))}이 든 주부터 판정해요` : '지난 8주를 모두 판정해요')
      else if (wasTarget !== body.channel.weeklyTarget)
        setNote(body.channel.weeklyTarget === null ? '이번 주부터 점검하지 않아요' : `이번 주부터 주 ${body.channel.weeklyTarget}회로 판정해요`);
      else setNote('저장했어요');
      return true;
    } finally { setSaving(false); setConfirming(null); }
  }, [clientId, channel]);

  // 기록이 지워지는 저장인지 — 핸들 글자가 아니라 X 계정(숫자 id)이 바뀌는지로 판단한다. 같은 계정의 이름만 바뀐 거면 기록은 그대로다.
  // 'ok' = 그냥 저장 / 'confirm' = 확인을 띄웠다 / 'error' = 확인 실패(문구는 err에)
  const needsConfirm = useCallback(async (): Promise<'ok' | 'confirm' | 'error'> => {
    const h = norm(cur.current.handle);
    if (!channel) return 'ok';
    if (!h) { setConfirming('remove'); return 'confirm'; }
    if (h === norm(channel.handle)) return 'ok';
    setSaving(true); setErr(''); setNote('');
    try {
      const r = await apiFetch(`/api/clients/${clientId}/x-account`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: cur.current.handle, weeklyTarget: cur.current.target, dryRun: true }),
      });
      const body = (await r.json().catch(() => ({}))) as { error?: string; wouldReplace?: boolean; name?: string | null };
      if (!r.ok) { setErr(body.error ?? 'X에서 계정을 확인하지 못했어요'); return 'error'; }
      if (body.wouldReplace) { setNewName(body.name ?? null); setConfirming('replace'); return 'confirm'; }
      return 'ok';
    } finally { setSaving(false); }
  }, [channel, clientId]);

  // 페이지의 '저장하고 이동'도 같은 확인을 거친다 — 기록이 지워지는 저장이면 멈추고 여기서 확인을 받는다
  const saveFromGuard = useCallback(async () => {
    const step = await needsConfirm();
    return step === 'ok' ? doSave() : false;
  }, [needsConfirm, doSave]);
  useEffect(() => register('x-account', { isDirty, save: saveFromGuard }), [register, isDirty, saveFromGuard]);

  const onSave = async () => {
    if ((await needsConfirm()) === 'ok') await doSave();
  };

  return (
    <div className={PANEL}>
      <h2 className={`${PANEL_TITLE} mb-1`}>X 업로드</h2>
      <p className="mb-3 text-caption text-x-muted">
        여기서 정하면 <Link href="/channels" className="text-x-blue-text hover:underline">X 업로드 현황</Link>에서 약속을 지키고 있는지 볼 수 있어요.
      </p>
      {!loaded && <p className="text-ui text-x-muted">불러오는 중…</p>}
      {loaded && loadErr && <p className="text-ui text-red-500">X 계정 정보를 불러오지 못했어요 — 새로고침해 주세요</p>}
      {loaded && !loadErr && (
        <>
          <label className="block">
            <span className="text-ui font-bold">X 계정 <span className="font-normal text-x-muted">선택</span></span>
            <p className="text-caption text-x-muted">우리가 운영을 맡은 X 계정이에요. 매일 아침 이 계정의 글을 세요.</p>
            <input value={handle} onChange={(e) => { setHandle(e.target.value); setNote(''); setErr(''); }}
                   placeholder="@계정 또는 x.com/계정 주소" autoComplete="off" autoCapitalize="none" spellCheck={false}
                   className="mt-1 w-full max-w-[320px] rounded-md border border-x-border-strong p-2 text-ui outline-none focus:border-x-blue" />
          </label>
          {channel && norm(handle) === norm(channel.handle) && channel.followers !== null && (
            <p className="mt-1 text-caption text-x-secondary">✓ 확인된 계정이에요(팔로워 {channel.followers.toLocaleString('ko-KR')}명)</p>
          )}
          {channel?.lastError && channel.lastError !== 'fetchFailed' && (
            <p className="mt-1 text-caption text-[#b45309]">최근에 이 계정을 X에서 확인하지 못했어요. 계정 이름이 바뀌었다면 새 이름으로 저장해 주세요.</p>
          )}
          {!channel && !norm(handle) && suggestion && (
            <p className="mt-1 text-caption text-x-secondary">
              온보딩에서 받은 계정이 있어요: @{suggestion}{' '}
              <button type="button" onClick={() => setHandle(`@${suggestion}`)} className="font-semibold text-x-blue-text hover:underline">채우기</button>
            </p>
          )}

          <label className="mt-3 block">
            <span className="text-ui font-bold">업로드 약속</span>
            <p className="text-caption text-x-muted">클라이언트에게 한 주(월~일)에 새 글을 몇 번 올리기로 했는지예요. 인용, RT, 답글은 세지 않아요. &apos;약속 없음&apos;이면 점검하지 않아요.</p>
            <select value={target ?? ''} onChange={(e) => { setTarget(e.target.value ? Number(e.target.value) : null); setNote(''); }}
                    className="mt-1 block h-8 w-40 rounded-md border border-x-border-strong bg-white px-2 text-ui outline-none focus:border-x-blue">
              <option value="">약속 없음</option>
              {[...new Set([...TARGETS, ...(target && !TARGETS.includes(target) ? [target] : [])])].sort((a, b) => a - b)
                .map((n) => <option key={n} value={n}>주 {n}회</option>)}
            </select>
          </label>

          <label className="mt-3 block">
            <span className="text-ui font-bold">약속 시작일</span>
            <p className="text-caption text-x-muted">이 날이 든 주부터 약속을 지켰는지 봐요. 그 전 주는 올린 글 수만 보여요. 비우면 지난 8주를 모두 판정해요.</p>
            <input type="date" value={start} onChange={(e) => { setStart(e.target.value); setNote(''); }}
                   className="mt-1 block h-8 w-44 rounded-md border border-x-border-strong bg-white px-2 text-ui outline-none focus:border-x-blue" />
          </label>

          {confirming ? (
            <div className="mt-3 rounded-lg border border-[#f5c48f] bg-[#fffaf3] p-3 text-ui">
              <p className="mb-2 text-x-text">
                {confirming === 'replace'
                  ? `${norm(handle) ? `@${norm(handle)}${newName ? `(${newName})` : ''}` : '새 계정'}은 @${channel?.handle}과 다른 X 계정이에요. @${channel?.handle}의 업로드 기록이 지워지고 새 계정으로 다시 시작해요.`
                  : `@${channel?.handle} 계정 연결을 끊으면 업로드 기록이 지워져요.`}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setConfirming(null)}>취소</Button>
                <Button variant="danger" onClick={() => void doSave()} disabled={saving}>
                  {confirming === 'replace' ? '기록 지우고 바꾸기' : '기록 지우고 끊기'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2.5">
              <Button variant="primary" onClick={() => void onSave()} disabled={saving || (!channel && !norm(handle))}>
                {saving ? (channel && norm(handle) === norm(channel.handle) ? '저장 중…' : 'X에서 확인하는 중…') : '저장'}
              </Button>
              {err && <span className="text-ui text-red-500">{err}</span>}
              {note && <span className="text-ui font-medium text-x-green">{note}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
