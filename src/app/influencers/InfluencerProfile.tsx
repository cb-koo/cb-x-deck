'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { formatCount } from '@/lib/format';
import { relTime } from '@/lib/relTime';
import { isProfileStale, judgeContact, summarizeDraftStatuses } from '@/lib/influencerJudgment';
import { PricingSection } from './PricingSection';
import { AnalysisSection } from './AnalysisSection';
import { Timeline } from './Timeline';
import { ContentTab } from './ContentTab';
import { errOf } from './profileShared';
import type { InfluencerDetail } from '@/lib/influencerStore';

// 아바타 — 없으면 이니셜 원. 프로필 사진은 X CDN 원본이라 next/image 최적화 대상이 아니다.
export function Avatar({ url, name, size }: { url: string | null; name: string; size: number }) {
  const style = { width: size, height: size };
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- X CDN 원본 URL
      <img src={url} alt="" style={style} className="shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <span style={style} aria-hidden
          className="flex shrink-0 items-center justify-center rounded-full bg-x-border-strong font-bold text-white">
      <span style={{ fontSize: Math.round(size * 0.42) }}>{name.replace(/^@/, '').slice(0, 1).toUpperCase()}</span>
    </span>
  );
}

type Msg = { tone: 'ok' | 'warn' | 'err'; text: string };
const MSG_STYLE: Record<Msg['tone'], string> = {
  ok: 'bg-green-50 text-green-800',
  warn: 'bg-amber-50 text-amber-800',
  err: 'bg-red-50 text-red-700',
};

export function InfluencerProfile({ id, onChanged, onDeleted }: {
  id: string;
  onChanged: () => Promise<void>;   // 명부(왼쪽) 새로고침 — 태그·마지막 기록이 바뀌면 목록도 같이 움직여야 한다
  onDeleted: () => void;
}) {
  const [data, setData] = useState<InfluencerDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  // setState는 전부 await 뒤 — 동기 setState가 앞에 있으면 set-state-in-effect에 걸린다(GlobalShell 관례)
  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/influencers/${id}`);
      if (!r.ok) throw new Error(String(r.status));
      setData((await r.json()) as InfluencerDetail);
      setLoadErr(false);
    } catch {
      setLoadErr(true);
    } finally {
      setLoaded(true);
    }
  }, [id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(GlobalShell·clients 관례)
  useEffect(() => { load(); }, [load]);

  // 프로필 조회는 X API를 1회 부르는 비용 액션 — 자동으로 부르지 않고 버튼으로만 (AGENTS.md 원칙 6)
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setMsg(null);
    try {
      const r = await apiFetch(`/api/influencers/${id}/refresh`, { method: 'POST' });
      const body = (await r.json().catch(() => ({}))) as {
        status?: string; duplicateOf?: string | null; error?: string;
      };
      // 502(상류 조회 실패·X에 없는 핸들 포함)는 서버 문구를 그대로 쓴다 — 원인을 넘겨짚지 않는다
      if (!r.ok) { setMsg({ tone: 'err', text: body.error ?? `가져오지 못했어요 (오류 ${r.status})` }); return; }

      if (body.status === 'handle_taken') {
        setMsg({ tone: 'warn', text: '이 핸들은 현재 다른 계정이 쓰고 있어요 — 기존 정보는 남겨뒀어요' });
        return;
      }
      if (body.status === 'not_found') {
        setMsg({ tone: 'warn', text: 'X에서 이 핸들을 찾을 수 없어요 — 개명했다면 새 핸들로 추가하면 이 기록에 이어져요' });
        return;
      }
      setMsg(body.duplicateOf
        ? { tone: 'warn', text: `같은 계정이 @${body.duplicateOf}로도 등록돼 있어요 — 한쪽을 지워 정리할 수 있어요` }
        : { tone: 'ok', text: 'X에서 프로필을 새로 가져왔어요' });
      await load();
      await onChanged();
    } catch {
      setMsg({ tone: 'err', text: '가져오지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요' });
    } finally {
      setRefreshing(false);
    }
  }

  if (!loaded) return <p className="px-6 py-6 text-ui text-x-muted">불러오는 중…</p>;
  // 전체 오류 화면은 "한 번도 못 받아온" 경우에만 — 이미 좋은 데이터가 있는데 재조회만 실패했다면
  // 화면을 지우지 말고 얇은 안내띠로만 알린다(아래 loadErr strip).
  if (loadErr && !data) {
    return (
      <div className="px-6 py-6">
        <p className="mb-2 text-ui text-x-secondary" role="alert">프로필을 불러오지 못했습니다</p>
        <Button onClick={load}>다시 시도</Button>
      </div>
    );
  }
  if (!data) return null; // 위 분기가 모든 "data 없음"을 처리하므로 이론상 도달하지 않음 — 타입 좁히기용

  const inf = data.influencer;
  const unfetched = inf.profileRefreshedAt === null; // 아직 X에서 한 번도 프로필을 받아오지 않은 상태
  // 판단은 리스트와 같은 함수로 한 번만 — 프로필과 명부가 서로 다른 말을 하지 않게(라벨-값 일치)
  const contact = judgeContact(inf.lastContactAt, inf.createdAt);
  const draftLine = summarizeDraftStatuses(data.draftStatusCounts);
  const stale = isProfileStale(inf.profileRefreshedAt);

  return (
    <div className="min-w-0 px-6 py-6">
      {loadErr && (
        <div role="alert" className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-ui text-red-700">
          <span>새로고침에 실패했어요 — 표시된 정보가 최신이 아닐 수 있어요</span>
          <Button variant="subtle" className="ml-auto shrink-0 bg-white" onClick={load}>다시 시도</Button>
        </div>
      )}
      <div className="flex items-start gap-3">
        <Avatar url={inf.avatarUrl} name={inf.displayName ?? inf.handle} size={48} />
        <div className="min-w-0 flex-1">
          <h1 className="min-w-0 truncate text-[20px] font-bold">{inf.displayName ?? `@${inf.handle}`}</h1>
          <p className="flex flex-wrap items-baseline gap-x-2 text-ui text-x-secondary">
            <a href={`https://x.com/${inf.handle}`} target="_blank" rel="noopener noreferrer"
               className="text-x-blue-text hover:underline">@{inf.handle} ↗</a>
            {inf.followersCount !== null && <span>팔로워 {formatCount(inf.followersCount)}</span>}
            <span className="text-caption text-x-muted">
              {inf.profileRefreshedAt ? relTime(inf.profileRefreshedAt, '기준') : '프로필 미조회'}
            </span>
            {/* 갱신 넛지(스펙 §④) — 경고색을 쓰지 않는다. 비용 유발 액션(X 1회 조회)을 재촉하는 것처럼
                읽히면 안 되고, 지금 보이는 값이 언제 것인지만 알려주면 된다. */}
            {stale && <span className="text-caption text-x-secondary">오래된 정보예요 — 갱신 권장</span>}
          </p>
          {inf.bio && <p className="mt-1 whitespace-pre-wrap text-ui leading-relaxed text-x-secondary">{inf.bio}</p>}
        </div>
        <div className="shrink-0 text-right">
          <Button variant={unfetched ? 'primary' : 'subtle'} onClick={refresh} disabled={refreshing}>
            {refreshing ? '가져오는 중…' : unfetched ? '프로필 가져오기' : '프로필 갱신'}
          </Button>
          <p className="mt-1 max-w-[180px] text-caption text-x-muted">
            누를 때만 X에 1번 물어 이름·프로필 사진·팔로워를 새로 받아와요.
          </p>
        </div>
      </div>

      {/* 현황 스트립(스펙 §①) — "이 사람 지금 어떤 상태인가"를 스크롤 없이 답한다.
          경고를 색으로만 전하지 않는다: 넘겼으면 '팔로업 필요'라는 말이 항상 함께 붙는다. */}
      <div className="mt-3">
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-ui ${
          contact.needsFollowup ? 'bg-red-50 font-medium text-red-700' : 'bg-x-surface text-x-secondary'
        }`}>
          {contact.label}{contact.needsFollowup && ' → 팔로업 필요'}
        </span>
        {/* 원고 상태 요약은 전체 카운트 기준 — 아래 '넘긴 원고' 목록(최근 50건)과 세는 범위가 다르다 */}
        {draftLine && <p className="mt-1 text-ui text-x-secondary">원고 {draftLine}</p>}
      </div>

      {/* 계정 분석 — 현황 다음, 사람이 붙이는 태그·메모 앞. X 수집+LLM은 버튼을 누를 때만 돈다. */}
      <AnalysisSection id={id} analysis={data.analysis} analyzedAt={data.analyzedAt}
                       followers={inf.followersCount}
                       onAnalyzed={(analysis, analyzedAt) => {
                         setData((d) => (d ? { ...d, analysis, analyzedAt } : d));
                       }} />

      {msg && <p role="alert" className={`mt-3 rounded-lg px-3 py-2 text-ui ${MSG_STYLE[msg.tone]}`}>{msg.text}</p>}

      <TagEditor id={id} tags={inf.tags} onSaved={onChanged} />
      <NoteEditor id={id} note={inf.note} />

      {/* 단가 변경은 서버가 자동 로그를 남긴다 — 새 로그를 타임라인 맨 앞에 그대로 붙여 다시 부르지 않는다.
          patch는 그 요청이 실제로 바꾼 키만 담고 있으므로(PricingSection.save 참고) 다른 행의 병행
          PATCH 응답이 뒤섞여 도착해도 서로 다른 키끼리는 덮어쓰지 않고 병합만 된다 — 같은 키는
          busyKeys가 동시 전송 자체를 막아 직렬화한다. 로그 prepend는 도착 순서대로라 병행 저장 시
          몇 ms 정도 시간순과 어긋나 보일 수 있으나(일시적 표시 문제) 감수한다. */}
      <PricingSection id={id} pricing={data.pricing} logs={data.logs}
                      onSaved={(patch, newLogs) => {
                        setData((d) => (d ? { ...d, pricing: { ...d.pricing, ...patch }, logs: [...newLogs, ...d.logs] } : d));
                        // 단가 저장은 auto 로그를 남겨 last_log_at이 바뀐다 — 명부(왼쪽)도 같이 움직여야 한다.
                        // 무변경 no-op(newLogs 0건)까지 명부를 새로고침할 필요는 없다.
                        if (newLogs.length > 0) onChanged();
                      }} />

      <Timeline id={id} logs={data.logs}
                onAdded={(row) => { setData((d) => (d ? { ...d, logs: [row, ...d.logs] } : d)); onChanged(); }}
                onRemoved={(logId) => {
                  setData((d) => (d ? { ...d, logs: d.logs.filter((l) => l.id !== logId) } : d));
                  onChanged();
                }} />

      <ContentTab drafts={data.drafts} draftCount={inf.draftCount} />

      <DangerZone id={id} logCount={data.logs.length} onDeleted={onDeleted} />
    </div>
  );
}

// 태그 — 칩 + 입력. 어떤 조건으로 이 사람을 다시 찾을지(분야·등급 등)를 사용자가 직접 정한다.
function TagEditor({ id, tags, onSaved }: { id: string; tags: string[]; onSaved: () => Promise<void> }) {
  const [list, setList] = useState<string[]>(tags);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // 저장 중에는 칩 버튼을 잠근다 — PATCH가 태그 배열 전체를 덮어쓰기 때문에, 겹쳐 보내면
  // 나중 요청이 앞 요청의 변경을 되돌린다(사용자에겐 "지운 태그가 되살아남"으로 보인다).
  async function save(next: string[]): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    try {
      const r = await apiFetch(`/api/influencers/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: next }),
      });
      if (!r.ok) { setErr(await errOf(r)); return false; }
      setList(next); setErr('');
      await onSaved();
      return true;
    } catch {
      setErr('태그를 저장하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
      return false;
    } finally { setSaving(false); }
  }

  // 입력칸은 저장에 성공했을 때만 비운다 — 실패했는데 비우면 저장된 것처럼 보인다(거짓 성공 방지)
  async function add() {
    const t = input.trim();
    if (!t) return;
    if (list.some((x) => x.toLowerCase() === t.toLowerCase())) { setInput(''); return; } // 같은 태그 중복 금지
    if (await save([...list, t])) setInput('');
  }

  return (
    <section className="mt-7 border-t border-x-border pt-5">
      <div className="flex items-center gap-2">
        <h2 className="text-content font-bold">태그</h2>
        {saving && <span className="text-caption text-x-muted">저장 중…</span>}
      </div>
      <p className="text-caption leading-relaxed text-x-muted">분야·등급처럼 나중에 이 사람을 다시 찾을 말을 붙여두세요. 명부에서 태그로 골라볼 수 있어요.</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {list.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full border border-x-border-strong px-2 py-0.5 text-ui">
            {t}
            <button onClick={() => save(list.filter((x) => x !== t))} disabled={saving} aria-label={`${t} 태그 빼기`}
                    className="text-x-muted hover:text-red-500 disabled:opacity-50">✕</button>
          </span>
        ))}
        <input value={input} onChange={(e) => setInput(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }}
               placeholder="태그 입력 후 Enter" aria-label="태그 추가"
               className="w-40 rounded-lg border border-x-border-strong px-2 py-0.5 text-ui outline-none focus:border-x-blue" />
      </div>
      {err && <p role="alert" className="mt-1 text-caption text-red-500">{err}</p>}
    </section>
  );
}

// 고정 메모 — 타임라인이 "언제 무슨 일이 있었나"라면 여기는 "항상 기억해야 할 것"이다.
function NoteEditor({ id, note }: { id: string; note: string }) {
  const [text, setText] = useState(note);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const baseline = useRef(note);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function saveOnBlur() {
    if (text === baseline.current) return;
    try {
      const r = await apiFetch(`/api/influencers/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: text }),
      });
      if (!r.ok) { setErr(await errOf(r)); return; }
      baseline.current = text;
      setErr(''); setSaved(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), 2500);
    } catch {
      setErr('메모를 저장하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
    }
  }

  return (
    <section className="mt-7 border-t border-x-border pt-5">
      <div className="flex items-center gap-2">
        <h2 className="text-content font-bold">고정 메모</h2>
        {saved && <span className="text-caption font-medium text-x-green">저장됨 ✓</span>}
      </div>
      <p className="text-caption leading-relaxed text-x-muted">단가·정산 방식처럼 매번 확인하는 내용을 적어두세요. 칸 밖을 클릭하면 저장돼요.</p>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} onBlur={saveOnBlur} rows={3}
                className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui leading-normal outline-none focus:border-x-blue" />
      {err && <p role="alert" className="text-caption text-red-500">{err}</p>}
    </section>
  );
}

// 명부에서 제거 — 인라인 확인(브라우저 confirm 금지). 무엇이 사라지고 무엇이 남는지 먼저 말한다.
function DangerZone({ id, logCount, onDeleted }: { id: string; logCount: number; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState('');
  const busy = useRef(false);

  async function remove() {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await apiFetch(`/api/influencers/${id}`, { method: 'DELETE' });
      if (!r.ok) { setErr(await errOf(r)); return; }
      onDeleted();
    } catch {
      setErr('제거하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
    } finally { busy.current = false; }
  }

  return (
    <section className="mt-7 border-t border-x-border pt-5">
      {confirming ? (
        <div>
          <p className="text-ui">기록 {logCount}건도 함께 지워져요. 원고의 배정 표기는 남아요.</p>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={remove} className="rounded-full bg-x-pink px-3 py-1 text-ui font-medium text-white hover:opacity-90">
              명부에서 제거
            </button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>취소</Button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setConfirming(true); setErr(''); }}
                className="text-ui text-x-secondary hover:text-red-500">명부에서 제거</button>
      )}
      {err && <p role="alert" className="mt-1 text-caption text-red-500">{err}</p>}
    </section>
  );
}
