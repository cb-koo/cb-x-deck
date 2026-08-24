'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { InfoTip } from '@/components/InfoTip';
import { formatCount } from '@/lib/format';
import { relTime } from '@/lib/relTime';
import { kstMonthDay } from '@/lib/datetime';
import { isProfileStale, judgeContact, summarizeDraftStatuses } from '@/lib/influencerJudgment';
import { STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import { PRICE_TYPE_LABEL, formatMoney, type PricingChange } from '@/lib/influencerPricing';
import { PricingSection } from './PricingSection';
import { AnalysisSection } from './AnalysisSection';
import type {
  DraftRollupItem, InfluencerAutoEvent, InfluencerChannel, InfluencerDetail, InfluencerLogRow,
} from '@/lib/influencerStore';

const CHANNEL_LABEL: Record<InfluencerChannel, string> = {
  dm: 'DM', line: '라인', email: '이메일', other: '기타',
};

// 읽기 전용 상태 뱃지. 라벨·키는 lib(draftStatus)에서 오고 색만 여기서 정한다 — 색 규칙은
// DraftStatusChip과 같은 계열을 쓰되, 이 화면의 원고는 "고르는 것"이 아니라 "지나간 사실"이라
// 누를 수 있는 칩(select)으로 만들지 않는다(거짓 어포던스 방지).
const STATUS_BADGE: Record<DraftStatus, string> = {
  draft: 'border-x-border-strong bg-white text-x-secondary',
  review: 'border-amber-300 bg-amber-100 text-amber-800',
  approved: 'border-x-blue/40 bg-x-blue/10 text-x-blue-text',
  delivered: 'border-green-300 bg-green-100 text-green-800',
  unused: 'border-x-border-strong bg-x-border/40 text-x-muted',
};

async function errOf(r: Response): Promise<string> {
  return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`;
}

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
          {inf.bio && <p className="mt-1 whitespace-pre-wrap text-ui text-x-secondary">{inf.bio}</p>}
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

      {/* 단가 변경은 서버가 자동 로그를 남긴다 — 새 로그를 타임라인 맨 앞에 그대로 붙여 다시 부르지 않는다 */}
      <PricingSection id={id} pricing={data.pricing} logs={data.logs}
                      onSaved={(pricing, newLogs) => {
                        setData((d) => (d ? { ...d, pricing, logs: [...newLogs, ...d.logs] } : d));
                      }} />

      <Timeline id={id} logs={data.logs}
                onAdded={(row) => { setData((d) => (d ? { ...d, logs: [row, ...d.logs] } : d)); onChanged(); }}
                onRemoved={(logId) => {
                  setData((d) => (d ? { ...d, logs: d.logs.filter((l) => l.id !== logId) } : d));
                  onChanged();
                }} />

      <DraftRollup drafts={data.drafts} draftCount={inf.draftCount} />

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
    <section className="mt-5">
      <div className="flex items-center gap-2">
        <h2 className="text-ui font-bold">태그</h2>
        {saving && <span className="text-caption text-x-muted">저장 중…</span>}
      </div>
      <p className="text-caption text-x-muted">분야·등급처럼 나중에 이 사람을 다시 찾을 말을 붙여두세요. 명부에서 태그로 골라볼 수 있어요.</p>
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
    <section className="mt-5">
      <div className="flex items-center gap-2">
        <h2 className="text-ui font-bold">고정 메모</h2>
        {saved && <span className="text-caption font-medium text-x-green">저장됨 ✓</span>}
      </div>
      <p className="text-caption text-x-muted">단가·정산 방식처럼 매번 확인하는 내용을 적어두세요. 칸 밖을 클릭하면 저장돼요.</p>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} onBlur={saveOnBlur} rows={3}
                className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui leading-normal outline-none focus:border-x-blue" />
      {err && <p role="alert" className="text-caption text-red-500">{err}</p>}
    </section>
  );
}

// 자동 이벤트 문구 — 로그에는 사실만 저장되고 표현은 여기서 만든다(스펙 §2).
function autoText(l: InfluencerLogRow): ReactNode {
  const title = l.draftTitle?.trim() || '제목 없는 원고';
  const draft = l.draftId
    ? <Link href={`/generate?draft=${l.draftId}`} className="text-x-blue-text hover:underline">{title}</Link>
    : <span>{title}</span>;   // 원고가 지워졌으면 링크 없이 제목만 (누를 수 없는 것은 링크로 보이지 않게)
  switch (l.eventType) {
    case 'draft_assigned': return <>원고 배정 — {draft}</>;
    case 'draft_unassigned': return <>배정 해제 — {draft}</>;
    case 'draft_delivered': return <>원고 전달됨 — {draft}</>;
    case 'handle_changed': return <>핸들 변경 @{l.payload?.from ?? '?'} → @{l.payload?.to ?? '?'}</>;
    case 'pricing_changed': {
      const p = l.payload as PricingChange | null;
      if (!p) return <>단가 변경</>;
      if (p.priceType === 'currency') {
        return <>단가 통화 {p.from === 'JPY' ? '엔화' : '원화'} → {p.to === 'JPY' ? '엔화' : '원화'}</>;
      }
      const fmt = (v: number | string | null) => (v === null ? '미정' : formatMoney(v as number, p.currency));
      return <>{PRICE_TYPE_LABEL[p.priceType]} 단가 {fmt(p.from)} → {fmt(p.to)}</>;
    }
    default: return <>활동 기록</>;
  }
}

// 묶음 한 줄 문구 — 개별 행의 동사(autoText)를 그대로 이어 쓴다. 같은 사실을 두 가지 말로 부르지 않는다.
function groupText(eventType: InfluencerAutoEvent | null, n: number): string {
  switch (eventType) {
    case 'draft_assigned': return `원고 ${n}건 배정`;
    case 'draft_unassigned': return `배정 해제 ${n}건`;
    case 'draft_delivered': return `원고 ${n}건 전달됨`;
    case 'handle_changed': return `핸들 변경 ${n}건`;
    case 'pricing_changed': return `단가 변경 ${n}건`;
    default: return `활동 기록 ${n}건`;
  }
}

// 인접한 같은 event_type의 auto 항목을 한 덩어리로 (스펙 §②). manual이 사이에 끼면 묶지 않는다 —
// 묶으면 시간 순서가 왜곡된다. 렌더 시점 파생일 뿐 원본 logs는 그대로 둔다.
function groupAuto(logs: InfluencerLogRow[]): InfluencerLogRow[][] {
  const out: InfluencerLogRow[][] = [];
  for (const l of logs) {
    const prev = out[out.length - 1];
    const head = prev?.[0];
    if (prev && head && head.kind === 'auto' && l.kind === 'auto' && head.eventType === l.eventType) prev.push(l);
    else out.push([l]);
  }
  return out;
}

// 묶음 기간 — 목록이 최신순이므로 마지막 항목이 가장 오래된 것. 하루 안에 몰렸으면 날짜 하나만 적는다.
function groupRange(logs: InfluencerLogRow[]): string {
  const from = kstMonthDay(logs[logs.length - 1].createdAt);
  const to = kstMonthDay(logs[0].createdAt);
  return from === to ? from : `${from}~${to}`;
}

function Timeline({ id, logs, onAdded, onRemoved }: {
  id: string; logs: InfluencerLogRow[];
  onAdded: (row: InfluencerLogRow) => void;
  onRemoved: (logId: string) => void;
}) {
  const [body, setBody] = useState('');
  // 채널 기본값 = 가장 최근 manual 로그의 채널(스펙 §③). 상태에는 "사용자가 고른 값"만 담고 기본값은
  // 렌더에서 파생한다 — 한 번 직접 고르면 기록을 남긴 뒤에도 그 선택이 그대로 남는다.
  const [picked, setPicked] = useState<'' | InfluencerChannel | null>(null);
  const channel = picked ?? logs.find((l) => l.kind === 'manual')?.channel ?? '';
  const [err, setErr] = useState('');
  const busy = useRef(false);

  async function add() {
    const text = body.trim();
    if (!text || busy.current) return;
    busy.current = true;
    try {
      const r = await apiFetch(`/api/influencers/${id}/logs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, ...(channel ? { channel } : {}) }),
      });
      if (!r.ok) { setErr(await errOf(r)); return; }
      setBody(''); setErr('');
      onAdded((await r.json()) as InfluencerLogRow);
    } catch {
      setErr('기록을 남기지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
    } finally { busy.current = false; }
  }

  return (
    <section className="mt-6">
      <h2 className="text-ui font-bold">주고받은 기록</h2>
      <p className="text-caption text-x-muted">DM·통화에서 오간 이야기를 한 줄로 남겨두면, 나중에 누가 봐도 어디까지 이야기했는지 알 수 있어요.</p>
      <div className="mt-1.5 flex gap-1.5">
        <input value={body} onChange={(e) => setBody(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }}
               placeholder="예: 단가 협의 완료, 다음 주 원고 전달 예정" aria-label="기록 내용"
               className="min-w-0 flex-1 rounded-lg border border-x-border-strong px-2.5 py-1.5 text-ui outline-none focus:border-x-blue" />
        <select value={channel} onChange={(e) => setPicked(e.target.value as '' | InfluencerChannel)}
                aria-label="이야기가 오간 곳"
                className="shrink-0 rounded-lg border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue">
          <option value="">어디서 (선택)</option>
          {(Object.keys(CHANNEL_LABEL) as InfluencerChannel[]).map((c) => (
            <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
          ))}
        </select>
        <Button variant="primary" className="shrink-0 whitespace-nowrap" onClick={add}>기록</Button>
      </div>
      {err && <p role="alert" className="mt-1 text-caption text-red-500">{err}</p>}

      {logs.length === 0 ? (
        <p className="mt-3 text-ui text-x-muted">아직 기록이 없어요 — 위에 한 줄 남기면 여기 쌓여요.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {groupAuto(logs).map((g) => {
            if (g.length > 1) return <AutoGroup key={g[g.length - 1].id} logs={g} />;
            const l = g[0];
            return l.kind === 'auto'
              ? <AutoLine key={l.id} log={l} />
              : <LogItem key={l.id} id={id} log={l} onRemoved={onRemoved} />;
          })}
        </ul>
      )}
    </section>
  );
}

// 자동 이벤트 한 줄 — 카드도 아이콘도 없는 회색 텍스트. 사람이 남긴 기록이 스캔에서 먼저 보이도록
// 일부러 약하게 둔다(스펙 §②). 지우기 버튼이 없는 것도 그대로다 — 자동 기록은 지나간 사실이다.
function AutoLine({ log }: { log: InfluencerLogRow }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 px-3 py-0.5 text-ui text-x-secondary">
      {/* 카드·아이콘을 걷어내면 화면에서는 위계로 구분되지만 스크린리더에는 아무 단서도 남지 않는다 —
          '자동 기록'이라는 사실은 눈에 보이지 않게라도 반드시 읽혀야 한다(기존 sr-only 관례). */}
      <span><span className="sr-only">자동 기록: </span>{autoText(log)}</span>
      {log.member && <span className="text-caption text-x-muted">{log.member.name}</span>}
      <span className="text-caption text-x-muted">{relTime(log.createdAt, '').trim()}</span>
    </li>
  );
}

// 같은 일이 연달아 일어난 구간은 한 줄로 접는다 — 펼치면 개별 행(원고 제목 링크 포함)이 그대로 나온다.
function AutoGroup({ logs }: { logs: InfluencerLogRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
              className="flex w-full flex-wrap items-baseline gap-x-1.5 rounded-lg px-3 py-0.5 text-left text-ui text-x-secondary hover:bg-x-hover">
        <span aria-hidden className="text-caption text-x-muted">{open ? '▾' : '▸'}</span>
        <span><span className="sr-only">자동 기록: </span>{groupText(logs[0].eventType, logs.length)}</span>
        <span className="text-caption text-x-muted">({groupRange(logs)})</span>
      </button>
      {open && <ul className="pl-4">{logs.map((l) => <AutoLine key={l.id} log={l} />)}</ul>}
    </li>
  );
}

function LogItem({ id, log, onRemoved }: { id: string; log: InfluencerLogRow; onRemoved: (logId: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState('');

  async function remove() {
    try {
      const r = await apiFetch(`/api/influencers/${id}/logs/${log.id}`, { method: 'DELETE' });
      if (!r.ok) { setErr(await errOf(r)); return; }
      onRemoved(log.id);
    } catch {
      setErr('지우지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
    }
  }

  // 사람이 남긴 기록만 이 카드로 온다(자동 이벤트는 AutoLine) — 배경·채널칩·작성자를 그대로 유지한다.
  return (
    <li className="rounded-lg border border-x-border px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-ui">
          <span className="whitespace-pre-wrap">{log.body}</span>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-caption text-x-muted">
            {log.channel && (
              <span className="rounded-full bg-x-border/50 px-1.5 py-0.5 text-x-secondary">{CHANNEL_LABEL[log.channel]}</span>
            )}
            {log.member && <span>{log.member.name}</span>}
            <span>{relTime(log.createdAt, '').trim()}</span>
          </p>
        </div>
        {/* 지울 수 있는 건 사람이 쓴 기록뿐 — 자동 기록은 사실이라 버튼 자체를 두지 않는다 */}
        {confirming ? (
          <span className="flex shrink-0 items-center gap-1.5 text-caption">
            <button onClick={remove} className="rounded bg-red-600 px-2 py-0.5 text-white">지우기</button>
            <button onClick={() => setConfirming(false)} className="rounded border border-x-border-strong px-2 py-0.5">취소</button>
          </span>
        ) : (
          <button onClick={() => setConfirming(true)} aria-label="이 기록 지우기"
                  className="shrink-0 text-caption text-x-muted hover:text-red-500">✕</button>
        )}
      </div>
      {err && <p role="alert" className="mt-1 text-caption text-red-500">{err}</p>}
    </li>
  );
}

// 헤더 숫자는 전체 배정 수(draftCount), 아래 목록은 최근 것만 온다 — 두 숫자가 다르면 그 사실을 적는다.
// (v1에서 "넘긴 원고 62"라 써놓고 50건만 나오던 자기모순을 여기서 해소한다)
function DraftRollup({ drafts, draftCount }: { drafts: DraftRollupItem[]; draftCount: number }) {
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 className="text-ui font-bold">넘긴 원고 <span className="font-normal text-x-secondary">{draftCount}</span></h2>
        <InfoTip text="이 계정으로 배정한 원고를 모아 보여줘요. 원고를 누르면 콘텐츠 생성 화면에서 그 원고가 열려요." />
        {draftCount > drafts.length && (
          <span className="text-caption text-x-muted">· 최근 {drafts.length}건 표시</span>
        )}
      </div>
      {drafts.length === 0 ? (
        <p className="mt-1 text-ui text-x-muted">아직 배정한 원고가 없어요 — 콘텐츠 생성에서 원고를 만들고 이 계정을 배정하면 여기 모여요.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {drafts.map((d) => (
            <li key={d.id}>
              <Link href={`/generate?draft=${d.id}`}
                    className="flex items-center gap-2 rounded-lg border border-x-border px-3 py-2 hover:bg-x-hover">
                <span className="min-w-0 flex-1 truncate text-ui">{d.title || '제목 없는 원고'}</span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-caption font-bold ${STATUS_BADGE[d.status]}`}>
                  {STATUS_LABEL[d.status]}
                </span>
                <span className="shrink-0 text-caption text-x-muted">{relTime(d.createdAt, '생성')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
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
    <section className="mt-8 border-t border-x-border pt-4">
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
