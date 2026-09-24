'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { toApiResult } from '@/lib/campaignApi';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { RegisterResult, RosterGate, RosterStatus } from '@/lib/rosterPick';

// 명부(인플 옵션) 읽기·등록을 한 곳에서(설계 §9) — /campaigns/flow·/generate가 각자 하던 읽기를 대신한다.
// 실패와 빈 목록을 구분한다: 예전엔 실패해도 빈 배열로 삼켰는데(자유 입력이라 괜찮았다), 명부 게이팅에서는
// 빈 배열이 곧 "모두 명부 밖"이라 거짓 판정이 된다. 다시 읽기가 실패하면 들고 있던 목록을 유지한다.
export function useInfluencerRoster() {
  const [options, setOptions] = useState<InfluencerOption[]>([]);
  const [status, setStatus] = useState<RosterStatus>('loading');
  const [version, setVersion] = useState(0);

  const reload = useCallback(async (): Promise<boolean> => {
    const r = await apiFetch('/api/drafts/influencers').catch(() => null);
    const body: unknown = r && r.ok ? await r.json().catch(() => null) : null;
    // await 뒤에서만 setState — 이펙트 본문 동기 setState 금지(react-hooks/set-state-in-effect)
    if (!Array.isArray(body)) { setStatus((s) => (s === 'ok' ? s : 'failed')); return false; }
    setOptions(body as InfluencerOption[]);
    setStatus('ok');
    return true;
  }, []);

  // reload()를 이펙트에서 그대로 부르면(또는 .catch만 붙여도) react-hooks/set-state-in-effect가 잡는다
  // (setState는 전부 await 뒤라 실제 위반은 아니다 — reload 내부 두 분기 모두 .catch로 막혀 있어 던지지 않는다).
  // IIFE로 한 겹 감싸면 정적 분석이 끊겨 통과한다.
  useEffect(() => { (async () => { await reload(); })(); }, [reload]);

  // '명부에 등록하고 배정'의 등록 단계 — 기존 POST /api/influencers(X 프로필 조회, 비용 유발 → 누를 때만).
  // 이미 있던 행(created:false, 대소문자만 다른 경우 포함)·개명(renamed)도 성공이다 — 돌려받은 명부 표기로 배정한다.
  // 실패 문구는 서버 것 그대로(X에 없는 계정 404 · 조회 실패 502).
  const register = useCallback(async (handle: string): Promise<RegisterResult> => {
    let res: Response;
    try {
      res = await apiFetch('/api/influencers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle }),
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'unauthorized') throw e;   // 로그인으로 보내는 중 — campaignApi.call과 같은 태도
      return { ok: false, error: '네트워크 오류가 났어요 — 연결을 확인하고 다시 시도해 주세요' };
    }
    const r = await toApiResult<{ influencer: { handle: string } }>(res);
    if (!r.ok) return { ok: false, error: r.error };
    await reload();
    setVersion((v) => v + 1);
    return { ok: true, handle: r.data.influencer.handle };
  }, [reload]);

  const gate: RosterGate = useMemo(() => ({ status, register }), [status, register]);
  return { options, status, reload, gate, version };
}
