'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ds/badge';
import { Button } from '@/components/ds/button';
import { campaignStatus, CAMPAIGN_STATUS_LABEL, formatDateKo } from '@/lib/campaignJudgment';
import { formatMoneyBy } from '@/lib/campaignCost';
import { fetchCampaignDetail, fetchWorkflowCampaigns, type WorkflowCampaignRow } from '@/lib/campaignApi';
import { GROUP_BYS, isGroupBy, type GroupBy } from '@/lib/campaignWorkflow';
import { WorkflowTable, type WorkflowTask } from './WorkflowTable';

// 업무 흐름대로 본 캠페인 화면 — 1단계 뼈대(스펙 2026-09-03 §10). 읽기 전용이다.
// 기존 /campaigns는 그대로 두고 여기서만 새 구조를 확인한다. 쓰기(전달함 표시 등)는 2단계.

// 마지막 묶기 선택을 기억한다(§6-1) — [표|달력] 선택과 같은 관례. 기본은 '진행'.
const GROUP_BY_KEY = 'campaign-workflow-group-by';
function readGroupBy(): GroupBy {
  try {
    const v = localStorage.getItem(GROUP_BY_KEY);
    return isGroupBy(v) ? v : 'stage';
  } catch { return 'stage'; }
}

export default function CampaignWorkflowPreviewPage() {
  const [list, setList] = useState<WorkflowCampaignRow[]>([]);
  const [today, setToday] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  // 캠페인마다 따로 담는다 — 캠페인을 바꿀 때 effect 안에서 setTasks(null)로 지우면
  // 렌더 중 setState가 되어 연쇄 렌더를 부른다(react-hooks/set-state-in-effect). id가 다르면 '아직'으로 읽는다.
  const [loaded, setLoaded] = useState<{ id: string; tasks: WorkflowTask[] } | null>(null);
  const [listErr, setListErr] = useState('');
  const [detailErr, setDetailErr] = useState<{ id: string; message: string } | null>(null);
  // 서버 렌더엔 localStorage가 없다. 표는 목록 fetch 뒤에만 마운트되므로 첫 렌더가 달라도
  // hydration 불일치는 없다(campaigns/page.tsx의 readDetailView와 같은 관례).
  const [groupBy, setGroupBy] = useState<GroupBy>(() => readGroupBy());
  const changeGroupBy = useCallback((g: GroupBy) => {
    setGroupBy(g);
    try { localStorage.setItem(GROUP_BY_KEY, g); } catch { /* 저장 못 해도 화면은 동작 */ }
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchWorkflowCampaigns().then((r) => {
      if (!alive) return;
      if (!r.ok) { setListErr(r.error); return; }
      setList(r.data.campaigns);
      setToday(r.data.today);
      // 막힌 것이 많은 캠페인을 먼저 연다 — 이 화면이 답해야 하는 질문이 "어디를 열까"다(§6-3).
      // 단, 종료된 캠페인은 고르지 않는다. 실제 데이터에서 종료 캠페인이 막힌 것 1위였다 —
      // 이미 지난 것을 손대라고 띄우면 숫자가 커지고 의미가 없어진다(§5가 경계한 것).
      const live = r.data.campaigns.filter((c) => campaignStatus(c.startsOn, c.endsOn, r.data.today) !== 'ended');
      const first = [...(live.length ? live : r.data.campaigns)].sort((a, b) => b.blocked - a.blocked)[0];
      if (first) setPickedId(first.id);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!pickedId) return;
    let alive = true;
    void fetchCampaignDetail(pickedId).then((r) => {
      if (!alive) return;
      if (!r.ok) { setDetailErr({ id: pickedId, message: r.error }); return; }
      // 047 전이라 delivered_on·cancelled_on·draft_by가 없다 — null로 넣으면 campaignWorkflow가
      // 원고 상태('전달됨')를 전달 신호로 대신 읽는다. RT는 그 신호가 없어 '전달 대기'에 머문다.
      setLoaded({ id: pickedId, tasks: r.data.tasks.map((t) => ({
        id: t.id, type: t.type, influencerHandle: t.influencerHandle,
        draftId: t.draftId, draftStatus: t.draftStatus, draftLabel: t.draftLabel, draftBy: null,
        targetTweetUrl: t.targetTweetUrl, target: t.target ? { postUrl: t.target.postUrl } : null,
        cost: t.cost, scheduledOn: t.scheduledOn,
        deliveredOn: null, postedAt: t.postedAt, cancelledOn: null,
        settlement: t.settlement ? { status: t.settlement.status, externalStatus: t.settlement.externalStatus } : null,
      })) });
    });
    return () => { alive = false; };
  }, [pickedId]);

  const picked = useMemo(() => list.find((c) => c.id === pickedId) ?? null, [list, pickedId]);
  // 목록을 상태별로 — 종료된 것을 진행 중인 것과 같은 자리에 두면 "어디를 열까"에 답하지 못한다.
  const grouped = useMemo(() => {
    const of = (c: WorkflowCampaignRow) => campaignStatus(c.startsOn, c.endsOn, today || c.startsOn);
    return {
      active: list.filter((c) => of(c) === 'active'),
      upcoming: list.filter((c) => of(c) === 'upcoming'),
      ended: list.filter((c) => of(c) === 'ended'),
    };
  }, [list, today]);
  // 고른 캠페인의 것만 보여준다 — 이전 캠페인의 표가 잠깐 남아 보이지 않게.
  const tasks = loaded && loaded.id === pickedId ? loaded.tasks : null;
  const detailMessage = detailErr && detailErr.id === pickedId ? detailErr.message : '';

  return (
    <div className="ds mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-5 py-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">캠페인 — 업무 흐름 보기</h1>
          <Badge variant="secondary">뼈대 · 읽기 전용</Badge>
          <Button variant="outline" size="sm" className="ml-auto" render={<Link href="/campaigns" />}>
            지금 화면으로
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          지금 화면(<Link href="/campaigns" className="font-medium text-foreground underline underline-offset-4">/campaigns</Link>)은 그대로 있어요.
          여기서는 <strong>어느 캠페인의 무엇이 막혀 있고 다음에 무엇을 할지</strong>가 읽히는지만 봅니다.
          아직 아무것도 저장되지 않아요 — 버튼 대신 다음 행동을 문구로 적어 뒀습니다.
        </p>
        <p className="text-sm text-muted-foreground">
          「전달함」을 기록할 칸이 아직 없어서, 원고 상태가 <strong>전달됨</strong>인 것만 게시 대기로 잡힙니다.
          RT는 원고가 없어 전달 기록이 아예 없고, 원고를 인플루언서가 쓰기로 한 작업도
          <strong className="text-foreground"> &lsquo;아직 안 정함&rsquo;과 구별되지 않아 계속 준비에 남습니다</strong> — 이 두 가지가 2단계에서 칸을 추가할 근거예요.
        </p>
      </header>

      {listErr && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">{listErr}</p>}

      <div className="flex flex-col gap-5 lg:flex-row">
        <nav aria-label="캠페인" className="flex shrink-0 flex-col gap-4 lg:w-[280px]">
          {(['active', 'upcoming'] as const).map((k) => grouped[k].length > 0 && (
            <div key={k} className="flex flex-col gap-1.5">
              <p className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{CAMPAIGN_STATUS_LABEL[k]}</p>
              {grouped[k].map((c) => <CampaignButton key={c.id} c={c} picked={c.id === pickedId} onPick={setPickedId} />)}
            </div>
          ))}
          {/* 종료는 접어 둔다 — 막힌 것 숫자가 붙어 있어도 지금 손댈 것은 아니다 */}
          {grouped.ended.length > 0 && (
            <details className="flex flex-col gap-1.5">
              <summary className="cursor-pointer list-none px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground [&::-webkit-details-marker]:hidden">
                종료 {grouped.ended.length}개 보기
              </summary>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {grouped.ended.map((c) => <CampaignButton key={c.id} c={c} picked={c.id === pickedId} onPick={setPickedId} />)}
              </div>
            </details>
          )}
          {!listErr && list.length === 0 && <p className="text-sm text-muted-foreground">캠페인이 없어요</p>}
        </nav>

        <div className="min-w-0 flex-1">
          {picked && (
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-base font-semibold">{picked.name}</h2>
              <span className="text-sm text-muted-foreground">
                {picked.clientName ?? '클라이언트 없음'} · {formatDateKo(picked.startsOn)}~{formatDateKo(picked.endsOn)} · {formatMoneyBy(picked.total)}
              </span>
            </div>
          )}
          {detailMessage && <p role="alert" className="text-sm text-destructive">{detailMessage}</p>}
          {!detailMessage && tasks === null && pickedId && <p role="status" className="py-10 text-center text-sm text-muted-foreground">불러오는 중…</p>}
          {tasks !== null && (
            <WorkflowTable tasks={tasks} today={today} groupBy={groupBy} onGroupBy={changeGroupBy} />
          )}
        </div>
      </div>

      <footer className="border-t pt-4 text-sm text-muted-foreground">
        묶기 {GROUP_BYS.length}가지를 눌러 보고, 묶음 제목줄로 접어 보세요. 마지막 선택은 기억됩니다.
        보시고 나서 정할 것: 단계 일곱 개가 많지 않은지(특히 「지급 대기」), 「진행」 한 칸이 읽히는지,
        완료·취소를 접어 두는 게 불편하지 않은지.
      </footer>
    </div>
  );
}

function CampaignButton({ c, picked, onPick }: { c: WorkflowCampaignRow; picked: boolean; onPick: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onPick(c.id)} aria-current={picked ? 'true' : undefined}
            className={`flex min-h-[60px] w-full flex-col gap-1 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
              picked ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/60'}`}>
      <span className="flex w-full items-center gap-2">
        <span className="truncate text-sm font-medium">{c.name}</span>
        {c.blocked > 0 && <Badge variant="destructive" className="ml-auto shrink-0">막힌 것 {c.blocked}</Badge>}
      </span>
      <span className="text-xs text-muted-foreground">
        {formatDateKo(c.startsOn)}~{formatDateKo(c.endsOn)} · 작업 {c.taskCount}
      </span>
    </button>
  );
}
