'use client';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { AnalysisSection } from './AnalysisSection';
import { Timeline } from './Timeline';
import { errOf, PANEL, PANEL_TITLE, useErrorReport } from './profileShared';
import type { InfluencerDetail } from '@/lib/influencerStore';

// 계정 정보 탭 — "이 사람은 누구이고 우리와 무슨 일이 있었나". 분석 → 태그·메모(사람이 붙이는 것)
// → 기록 → 제거 순. 섹션은 각자 흰 패널 1장이고, 패널 사이 간격은 ProfileTabs의 tabpanel space-y-5가 준다
// — 여기서 첫 섹션 여백을 따로 손대지 않는다(그 오버라이드가 간격의 두 번째 출처였다).
export function AccountTab({ id, data, onChanged, onDeleted, setData, reportError }: {
  id: string; data: InfluencerDetail;
  onChanged: () => Promise<void>;   // 명부(왼쪽) 새로고침 — 태그·마지막 기록이 바뀌면 목록도 같이 움직여야 한다
  onDeleted: () => void;
  setData: (fn: (d: InfluencerDetail | null) => InfluencerDetail | null) => void;
  reportError: (source: string, hasError: boolean) => void;
}) {
  const inf = data.influencer;
  return (
    <>
      {/* 계정 분석 — 태그·메모 앞. X 수집+LLM은 버튼을 누를 때만 돈다. */}
      <AnalysisSection id={id} analysis={data.analysis} analyzedAt={data.analyzedAt}
                       followers={inf.followersCount}
                       onAnalyzed={(analysis, analyzedAt) => {
                         setData((d) => (d ? { ...d, analysis, analyzedAt } : d));
                       }} />
      <TagEditor id={id} tags={inf.tags} onSaved={onChanged} onErrorChange={(v) => reportError('tags', v)} />
      <NoteEditor id={id} note={inf.note} onErrorChange={(v) => reportError('note', v)} />
      <Timeline id={id} logs={data.logs}
                onAdded={(row) => { setData((d) => (d ? { ...d, logs: [row, ...d.logs] } : d)); onChanged(); }}
                onRemoved={(logId) => {
                  setData((d) => (d ? { ...d, logs: d.logs.filter((l) => l.id !== logId) } : d));
                  onChanged();
                }}
                onErrorChange={(v) => reportError('timeline', v)} />
      <DangerZone id={id} logCount={data.logs.length} onDeleted={onDeleted} />
    </>
  );
}

// 태그 — 칩 + 입력. 어떤 조건으로 이 사람을 다시 찾을지(분야·등급 등)를 사용자가 직접 정한다.
function TagEditor({ id, tags, onSaved, onErrorChange }: {
  id: string; tags: string[]; onSaved: () => Promise<void>; onErrorChange?: (v: boolean) => void;
}) {
  const [list, setList] = useState<string[]>(tags);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  useErrorReport(err !== '', onErrorChange);   // 이 탭이 숨어 있어도 저장 실패는 탭 라벨에 남는다

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
    <section className={PANEL}>
      <div className="flex items-center gap-2">
        <h2 className={PANEL_TITLE}>태그</h2>
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
function NoteEditor({ id, note, onErrorChange }: {
  id: string; note: string; onErrorChange?: (v: boolean) => void;
}) {
  const [text, setText] = useState(note);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  useErrorReport(err !== '', onErrorChange);   // 숨은 탭의 저장 실패도 탭 라벨이 알린다
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
    <section className={PANEL}>
      <div className="flex items-center gap-2">
        <h2 className={PANEL_TITLE}>고정 메모</h2>
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
// 실패가 누른 버튼 바로 밑에 뜨는 자리라 탭 표식(useErrorReport)을 달지 않는다 — 숨은 채 실패할 일이 없다.
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
    // 위험 액션은 패널로 승격하지 않는다(스펙 §7) — 테두리·흰 면 없이 바닥 위 텍스트 링크로만 둔다.
    // 카드가 되면 "제거"가 다른 섹션과 같은 무게로 눈에 들어온다.
    <section className="px-5 py-3">
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
