'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TargetCandidate } from '@/lib/campaignTaskStore';
import { fetchTasksTargets, fetchTargeting } from '@/lib/campaignApi';
import { normalizeTargetTweetUrl } from '@/lib/campaignTaskInput';
import { TASK_TYPE_LABEL, formatDateKo } from '@/lib/campaignJudgment';

// RT/인용RT 대상 한 칸(스펙 §4-2, 시안 task-add-v3) — 탭·팝오버 없이 입력 하나: @핸들/제목/캠페인명을 치면 작업 목록,
// X 링크를 붙이면 그대로 대상(자동 인식). 아래 빠른 선택 칩 = 이 캠페인의 후보 최근 5개. 선택되면 회색 카드로 접힌다.
export type TargetValue = { taskId: string; label: string; sub: string | null; posted: boolean } | { url: string } | null;
const TYPE_CHIP: Record<string, string> = { post: 'bg-[#e8f0fe] text-[#1d4ed8]', quoteRt: 'bg-[#f3e8ff] text-[#7e22ce]', visit: 'bg-[#fff4e5] text-[#b45309]' };

export function candidateLabel(c: TargetCandidate): string {
  return `${c.influencerHandle ? `@${c.influencerHandle}` : '미배정'} · ${c.draftLabel ?? '(원고 없음)'}`;
}

export function TargetPicker({ value, clientId, campaignId, excludeTaskId, onChange, onTargetingLoaded, autoFocus }: {
  value: TargetValue; clientId: string | null; campaignId: string; excludeTaskId?: string;
  onChange: (next: { taskId: string } | { url: string } | null) => void;
  onTargetingLoaded?: (handles: string[]) => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [cands, setCands] = useState<TargetCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);

  // 후보 로드 — 클라이언트 기본, '전체 클라이언트 보기'로 넓힘. q는 서버 검색(50건 상한).
  // '불러오는 중'은 따로 켜고 끄는 상태가 아니라 '지금 조건 ≠ 화면에 있는 목록의 조건'에서 파생한다
  // (effect 본문에서 동기 setState를 하지 않는다 — 조건이 바뀌는 순간 이미 옛 목록임이 드러난다).
  const key = `${clientId ?? ''}|${q}|${all ? '1' : ''}|${excludeTaskId ?? ''}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== key;
  const chosen = !!value;   // 대상이 정해지면 접힌 카드만 보인다 — 후보 목록은 그릴 자리가 없으니 부르지도 않는다
  useEffect(() => {
    if (chosen) return;
    let alive = true;
    fetchTasksTargets({ clientId, q, all }).then((r) => {
      if (!alive) return;
      setCands(r.ok ? r.data.filter((c) => c.taskId !== excludeTaskId) : []);
      setLoadedKey(key);
    });
    return () => { alive = false; };
  }, [clientId, q, all, excludeTaskId, key, chosen]);
  // "이미 RT하기로 한 사람" — 값이 정해질 때마다
  useEffect(() => {
    if (!value || !onTargetingLoaded) return;
    fetchTargeting('taskId' in value ? { taskId: value.taskId } : { url: value.url }).then((r) => onTargetingLoaded(r.ok ? r.data.handles : []));
  }, [value, onTargetingLoaded]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const quick = useMemo(() => cands.filter((c) => c.campaignId === campaignId).slice(0, 5), [cands, campaignId]);
  const isLink = /(?:x\.com|twitter\.com)\//i.test(q);

  function pickLink() {
    const u = normalizeTargetTweetUrl(q);
    if (!u) { setErr('X 게시물 주소가 아니에요 — x.com/계정/status/숫자 형식이어야 해요'); return; }
    setErr(''); setQ(''); setOpen(false); onChange({ url: u });
  }
  const input = 'h-11 w-full rounded-[10px] border border-x-border-strong bg-white px-3 text-content outline-none focus:border-x-blue';

  if (value) {
    return (
      <div className="flex min-h-11 items-center gap-2.5 rounded-[10px] border border-x-border-strong bg-x-surface px-3 py-2">
        {'taskId' in value ? (
          <>
            <span className="min-w-0 flex-1 truncate">{value.label}{value.sub && <span className="text-x-muted"> · {value.sub}</span>}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[12px] ${value.posted ? 'bg-green-100 text-green-800' : 'bg-x-border/60 text-x-secondary'}`}>{value.posted ? '게시됨' : '게시 전'}</span>
          </>
        ) : <span className="min-w-0 flex-1 truncate">{value.url.replace(/^https?:\/\//, '')}</span>}
        <button type="button" onClick={() => onChange(null)} className="shrink-0 text-ui text-x-secondary hover:underline">바꾸기</button>
      </div>
    );
  }
  return (
    <div ref={boxRef} className="relative">
      <input value={q} autoFocus={autoFocus} onChange={(e) => { setQ(e.target.value); setErr(''); setOpen(true); }} onFocus={() => setOpen(true)}
             onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (isLink) pickLink(); } if (e.key === 'Escape') { if (open) e.stopPropagation(); setOpen(false); } }}
             placeholder="@핸들이나 원고 제목으로 찾기 — 또는 X 링크 붙이기" aria-label="대상 찾기" className={input} />
      {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
      {quick.length > 0 && !q && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-ui text-x-muted">이 캠페인 →</span>
          {quick.map((c) => (
            <button key={c.taskId} type="button" onClick={() => onChange({ taskId: c.taskId })}
                    className="inline-flex items-center gap-1.5 rounded-full border border-x-border px-3 py-1.5 text-ui hover:bg-x-hover">
              <span className={`rounded-full px-1.5 text-[12px] ${TYPE_CHIP[c.type] ?? 'bg-x-surface text-x-secondary'}`}>{TASK_TYPE_LABEL[c.type]}</span>
              <span className="max-w-[220px] truncate">{candidateLabel(c)}</span>
              {!c.postedAt && <span className="text-x-muted">· 게시 전</span>}
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1.5 max-h-[320px] overflow-y-auto rounded-[10px] border border-x-border bg-white shadow-lg">
          <div className="flex items-center gap-3 px-3.5 py-2 text-ui text-x-muted">
            <span>{all ? '전체 클라이언트' : '같은 클라이언트'} · 최근 만든 순</span>
            <button type="button" onClick={() => setAll((v) => !v)} className="underline hover:text-x-secondary">{all ? '같은 클라이언트만' : '전체 클라이언트 보기'}</button>
            {loading && <span className="ml-auto">불러오는 중…</span>}
          </div>
          {isLink && (
            <button type="button" onClick={pickLink} className="flex w-full items-center gap-2 border-t border-x-border px-3.5 py-3 text-left text-ui hover:bg-x-hover">
              <span className="rounded bg-x-surface px-1.5 text-[12px] text-x-secondary">링크</span>이 주소를 대상으로 <span className="truncate text-x-muted">{q}</span>
            </button>
          )}
          {cands.length === 0 && !loading && <p className="border-t border-x-border px-3.5 py-3 text-ui text-x-muted">맞는 작업이 없어요 — 링크를 붙이거나 나중에 정해도 돼요</p>}
          {cands.map((c) => (
            <button key={c.taskId} type="button" onClick={() => { setOpen(false); setQ(''); onChange({ taskId: c.taskId }); }}
                    className="flex h-[46px] w-full items-center gap-2.5 border-t border-x-border px-3.5 text-left hover:bg-x-hover">
              <span className={`shrink-0 rounded-full px-2 text-[12px] ${TYPE_CHIP[c.type] ?? 'bg-x-surface text-x-secondary'}`}>{TASK_TYPE_LABEL[c.type]}</span>
              <span className="min-w-0 flex-1 truncate text-content">{candidateLabel(c)}</span>
              <span className="shrink-0 text-ui text-x-muted">{c.campaignName} · {c.postedAt ? <span className="text-green-700">게시됨 {formatDateKo(c.postedAt)}</span> : '게시 전'}</span>
            </button>
          ))}
          <p className="border-t border-x-border px-3.5 py-2 text-ui text-x-muted">링크를 붙이면 바로 대상으로 들어가요 (x.com/…/status/…)</p>
        </div>
      )}
    </div>
  );
}
