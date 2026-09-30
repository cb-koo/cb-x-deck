'use client';
import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { CampaignTaskItem } from '@/lib/campaignStore';
import type { InfluencerOption } from '@/lib/draftTypes';
import { suggestTaskCost, type TaskCost } from '@/lib/campaignCost';
import { patchTaskApi, deleteTaskApi, type TaskPatchRequest } from '@/lib/campaignApi';
import type { TaskAgreementInput } from '@/lib/taskAgreementGuard';

// 작업 편집은 전부 PATCH /api/campaigns/[id]/tasks/[taskId] 하나로 간다(스펙 §6). 낙관적 갱신 + "이 요청이 세팅한 값이
// 아직 표시 중일 때만" 롤백/덮어쓰기 — 응답은 보낸 순서대로 오지 않는다.
type Item = CampaignTaskItem;
type Optimistic = Partial<Item>;

export function useCampaignTaskActions({ campaignId, setTasks, influencerOptions, show, onChanged }: {
  campaignId: string;
  setTasks: Dispatch<SetStateAction<Item[]>>;
  influencerOptions: InfluencerOption[];   // pricing 포함 — 배정 시 비용 제안 소스
  show: (message: string) => void;
  onChanged: () => void;                   // 목록(왼쪽)의 작업 수·합계가 바뀌는 변경 뒤
}) {
  const patch = useCallback(async (t: Item, body: TaskPatchRequest, optimistic: Optimistic): Promise<boolean> => {
    const keys = Object.keys(optimistic) as Array<keyof Item>;
    // 이 요청이 쓴 칸이 아직 내가 세팅한 값 그대로인가 — 성공·실패가 같은 기준을 쓴다
    const stillMine = (x: Item) => keys.every((k) => JSON.stringify(x[k]) === JSON.stringify(optimistic[k]));
    setTasks((cur) => cur.map((x) => (x.id === t.id ? { ...x, ...optimistic } : x)));
    const r = await patchTaskApi(campaignId, t.id, body);
    if (r.ok) {
      // 응답은 TaskRow — perf·linkClicks는 이 PATCH로 바뀌지 않으니 기존 값을 유지한 채 덮고,
      // published만 새 postedAt에서 다시 파생한다(게시 확인이 판정, §2-5).
      setTasks((cur) => cur.map((x) => (x.id === t.id && stillMine(x) ? { ...x, ...r.data, published: r.data.postedAt !== null } : x)));
      return true;
    }
    setTasks((cur) => cur.map((x) => {
      if (x.id !== t.id || !stillMine(x)) return x;   // 그 사이 사용자가 또 바꿨으면 뒤 갱신이 이긴다
      const back: Item = { ...x };
      for (const k of keys) Object.assign(back, { [k]: t[k] });   // 요청 전 값으로 — 건드린 칸만
      return back;
    }));
    show(r.error);
    return false;
  }, [campaignId, setTasks, show]);

  return useMemo(() => ({
    patch,
    // 배정·변경 시 비용 제안 — 비어 있을 때만 자동(사람이 적은 값은 덮지 않는다). 금액 = pricing[작업 유형].
    // autoCost:false면 제안을 저장하지 않는다 — 캠페인 v2는 프로필 단가를 칸에 채워만 두고 [확인]을 눌러야
    // 확정한다(R24: 아무도 안 본 값이 예산이 되면 안 된다). 기존 화면은 기본값(true) 그대로다.
    assignInfluencer: async (t: Item, handle: string | null, opts?: { autoCost?: boolean }) => {
      const opt = handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined;
      const suggested = opts?.autoCost === false ? null : (!t.cost && opt ? suggestTaskCost(opt.pricing, t.type) : null);
      const body: TaskPatchRequest = { influencerHandle: handle, ...(suggested ? { cost: suggested } : {}) };
      const ok = await patch(t, body, { influencerHandle: handle, ...(suggested ? { cost: suggested } : {}) });
      if (ok) onChanged();   // 인플 목록·(제안이 들어갔으면) 합계가 바뀐다
      return ok;
    },
    changeTarget: (t: Item, next: { taskId: string } | { url: string } | null) => {
      if (next === null) return patch(t, { targetTaskId: null, targetTweetUrl: null }, { targetTaskId: null, targetTweetUrl: null, target: null });
      // 작업 참조로 바꾸면 target 요약은 서버 응답이 채운다(낙관적으로는 '대상 게시 대기'로 보인다) —
      // target: null도 같이 낙관 반영해야 응답 오기 전까지 직전 대상의 요약(옛 target)이 잘못 남지 않는다.
      if ('taskId' in next) return patch(t, { targetTaskId: next.taskId }, { targetTaskId: next.taskId, targetTweetUrl: null, target: null });
      return patch(t, { targetTweetUrl: next.url }, { targetTweetUrl: next.url, targetTaskId: null, target: null });
    },
    // 날짜를 지우면 서버가 그 날짜의 시간도 비운다(063) — 낙관값에도 같이 넣어야 응답 전까지 시간만 남아 보이지 않는다
    changeScheduledOn: (t: Item, next: string | null) =>
      patch(t, { scheduledOn: next }, { scheduledOn: next, ...(next === null && t.scheduledTime ? { scheduledTime: null } : {}) }),
    changeVisitOn: (t: Item, next: string | null) =>
      patch(t, { visitOn: next }, { visitOn: next, ...(next === null && t.visitTime ? { visitTime: null } : {}) }),
    // 방문협찬의 시간(063) — 'HH:MM' | null(시간 미정)
    changeVisitTime: (t: Item, next: string | null) => patch(t, { visitTime: next }, { visitTime: next }),
    changeScheduledTime: (t: Item, next: string | null) => patch(t, { scheduledTime: next }, { scheduledTime: next }),
    // 협찬 동의서(063) — 올린 파일 정보 | null(떼기). 낙관값의 by/byName/at은 응답이 진짜 값으로 덮는다(setProof와 같은 방식)
    setAgreement: (t: Item, a: TaskAgreementInput | null) =>
      patch(t, { agreement: a }, { agreement: a ? { url: a.path, name: a.name, size: a.size, mime: a.mime, by: null, byName: '', at: new Date().toISOString() } : null }),
    changeCost: async (t: Item, next: TaskCost | null) => {
      const ok = await patch(t, { cost: next }, { cost: next });
      if (ok) onChanged();   // 합계가 목록 보조줄에도 실린다
      return ok;
    },
    setNote: (t: Item, note: string) => patch(t, { note }, { note }),
    // 게시 확인 — 사람이 찍은 것이라 postedSource는 'manual'(수집기가 찾은 것은 'auto', 표에 회색 태그로 구분).
    // 링크를 함께 넣으면 서버가 같은 요청 안에서 작성자 확인(= 배정 인플의 글인지) → 저장 → 트래킹 등록·연결까지 한다
    // (다른 인플의 게시물 차단 스펙 §3 ①). 작성자가 다르거나 확인이 안 되면 아무것도 저장되지 않고 서버 문구가 토스트로 뜬다
    // (patch가 r.error를 보여 준다). 투고·인용RT·방문협찬의 게시일은 서버가 링크에서 정한다(postedAtFromLinkGate).
    // RT는 증빙(proof)이 함께 와야 서버가 받는다(RT 증빙 스펙 §5).
    markPosted: async (t: Item, date: string, postUrl?: string, proof?: string) => {
      const ok = await patch(t, { postedAt: date, ...(postUrl ? { postUrl } : {}), ...(proof ? { proof } : {}) },
                             { postedAt: date, postedSource: 'manual', published: true, ...(postUrl ? { postUrl } : {}),
                               ...(proof ? { proof: { url: proof, by: null, byName: '', at: new Date().toISOString() } } : {}) });
      if (!ok) return false;
      onChanged();
      return true;
    },
    // 증빙만 바꾸기·떼기 — 게시됨인 RT는 서버가 떼기를 거절한다(비우기가 아니라 바꾸기만).
    // 낙관값의 by/byName은 응답이 진짜 값으로 덮는다(patch가 r.data로 덮어쓴다).
    setProof: (t: Item, path: string | null) =>
      patch(t, { proof: path }, { proof: path ? { url: path, by: null, byName: '', at: new Date().toISOString() } : null }),
    markRemoved: (t: Item, date: string, reason: string) => patch(t, { removedAt: date, removedReason: reason }, { removedAt: date, removedReason: reason }),
    unmarkRemoved: (t: Item) => patch(t, { removedAt: null, removedReason: '' }, { removedAt: null, removedReason: '' }),
    // 삭제 — 행이 사라지는 변경이라 필드 롤백 대신 목록 복원으로 되돌린다(순서는 표 정렬이 다시 잡는다)
    remove: async (t: Item) => {
      setTasks((cur) => cur.filter((x) => x.id !== t.id));
      const r = await deleteTaskApi(campaignId, t.id);
      if (r.ok) { show('작업을 지웠어요 — 원고는 남아 있어요'); onChanged(); return true; }
      setTasks((cur) => (cur.some((x) => x.id === t.id) ? cur : [...cur, t]));
      show(r.error);
      return false;
    },
  }), [patch, campaignId, influencerOptions, onChanged, setTasks, show]);
}
