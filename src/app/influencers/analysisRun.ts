// src/app/influencers/analysisRun.ts — 분석 실행의 단일 출처(스펙 §6).
// 계약: 서버는 이탈과 무관하게 끝까지 돌아 저장한다 — 여기는 표시·중복 방지용 상태다.
// 구독 가능해야 하는 이유: 명부의 일괄 실행이 시작한 분석을 "이미 열려 있는" 프로필도 봐야 한다.
import { useSyncExternalStore } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { InfluencerAnalysis } from '@/lib/influencerStore';

export type RunState = 'idle' | 'running' | 'done' | 'failed';
export type AnalyzeResult = { analysis: InfluencerAnalysis; analyzedAt: string };
export class AnalyzeError extends Error {}

const inflight = new Map<string, Promise<AnalyzeResult>>();
const state = new Map<string, RunState>();
const errors = new Map<string, string>();
const subs = new Map<string, Set<() => void>>();
const allSubs = new Set<() => void>();

function emit(id: string) { subs.get(id)?.forEach((cb) => cb()); allSubs.forEach((cb) => cb()); }
function setState(id: string, s: RunState, err?: string) {
  state.set(id, s);
  if (err) errors.set(id, err); else errors.delete(id);
  emit(id);
}

export function getState(id: string): RunState { return state.get(id) ?? 'idle'; }
export function getError(id: string): string | null { return errors.get(id) ?? null; }
export function subscribe(id: string, cb: () => void): () => void {
  const set = subs.get(id) ?? new Set(); set.add(cb); subs.set(id, set);
  return () => { set.delete(cb); };
}
export function subscribeAll(cb: () => void): () => void { allSubs.add(cb); return () => { allSubs.delete(cb); }; }
export function useRunState(id: string): RunState {
  return useSyncExternalStore((cb) => subscribe(id, cb), () => getState(id), () => 'idle');
}

export function start(id: string): Promise<AnalyzeResult> {
  const existing = inflight.get(id);
  if (existing) return existing;       // 진행 중 재요청은 붙기만 — 비용 2배 방지
  const p = (async () => {
    const r = await apiFetch(`/api/influencers/${id}/analyze`, { method: 'POST' });
    const body = (await r.json().catch(() => ({}))) as { analysis?: InfluencerAnalysis; analyzedAt?: string; error?: string };
    if (!r.ok || !body.analysis) throw new AnalyzeError(body.error ?? `분석하지 못했어요 (오류 ${r.status})`);
    return { analysis: body.analysis, analyzedAt: body.analyzedAt ?? new Date().toISOString() };
  })();
  inflight.set(id, p);
  setState(id, 'running');
  p.then(() => setState(id, 'done'),
         (e: unknown) => setState(id, 'failed', e instanceof AnalyzeError ? e.message : '분석하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요'))
   .finally(() => { if (inflight.get(id) === p) inflight.delete(id); });
  return p;
}
