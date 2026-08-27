'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/lib/toastContext';
import type { CampaignRow, CampaignTaskItem, InfluencerCostRow } from '@/lib/campaignStore';
import type { CampaignPatchInput } from '@/lib/campaignInput';
import type { ExtraCost } from '@/lib/campaignCost';
import { fetchCampaignDetail, patchCampaignApi, deleteCampaignApi, putInfluencerCostApi } from '@/lib/campaignApi';
import {
  summarizeTasks, summarizeTaskPerf, deriveTaskInfluencers, taskCampaignTotal, matchesTaskFilter,
  STAGE_FILTERS, STAGE_FILTER_LABEL, type StageFilter,
} from '@/lib/campaignJudgment';
import type { DetailView } from '@/lib/campaignView';
import { Button } from '@/components/ui';
import { CampaignHeader } from './CampaignHeader';
import { SummaryCards } from './SummaryCards';
import { InfluencerCostTable } from './InfluencerCostTable';

// 캠페인 상세 컨테이너 — 로드·낙관적 갱신·모달을 쥔다. 요약·인플 목록·합계·성과는 서버 응답을 그대로 쓰지 않고
// 같은 판정 함수(campaignJudgment)로 여기서 다시 계산한다 — 표에서 값을 고친 즉시 카드 숫자가 따라가야 하고,
// 서버와 같은 함수라 새로고침해도 숫자가 바뀌지 않는다. '오늘'은 서버가 준 today(서울) — 브라우저 시계를 쓰지 않는다.
//
// Task 11에서 작업 기준으로 대체 — 표·달력·원고 카드(TaskTable·달력·DraftCard 배선)는 작업 단위로 다시 만든다.
// 그때까지 표 영역은 안내 문구 한 줄이고, 원고 편집(다시 쓰기·삭제·게시물 연결·있는 원고 넣기)은 이 화면에 없다.

// 섹션 패널(QA 7라운드 결정 B) — 오너 피드백: 전부 같은 흰 배경이라 헤더·요약·표가 "경계 없이 붙어 보인다".
// 간격만으로 나누던 것을 연회색 바닥(page.tsx의 bg-x-surface) 위 흰 패널 4장으로 바꿨다: 헤더 / 요약 / 작업 진행 현황 / 인플루언서별 비용.
// 데이터 중심 대시보드의 관례(리서치 §3)라 처음 보는 사람도 어디까지가 한 섹션인지 스크롤만 해도 알 수 있다.
// 패널 사이 간격(space-y-5 = 20px)이 섹션 간 여백의 단일 소스다 — 안쪽 컴포넌트가 각자 mt-8을 두면 간격이 두 벌이 된다.
const PANEL = 'rounded-xl border border-x-border bg-white p-5';
// 패널 제목 — 16px semibold(가독성 기준: 본문 15px보다 한 단 위, text-caption은 쓰지 않는다)
const PANEL_TITLE = 'text-[16px] font-semibold';

interface DetailState {
  campaign: CampaignRow; tasks: CampaignTaskItem[]; costRows: InfluencerCostRow[];
  deleteInfo: { taskCount: number; detachedTargets: number }; today: string;
}

export function CampaignDetail({ id, view, onViewChange, onChanged, onDeleted }: {
  id: string;
  campaigns: CampaignRow[];   // 전 캠페인 목록 — 원고 카드의 '다른 캠페인으로 옮기기' 후보(Task 11에서 다시 쓴다)
  view: DetailView;           // [표 | 주간 달력] — page가 쥐고 localStorage에 기억한다(캠페인을 바꿔도 유지)
  onViewChange: (v: DetailView) => void;
  onChanged: () => void;      // 목록(왼쪽) 새로고침 — 이름·작업 수·합계가 바뀌면 목록 보조줄도 움직여야 한다
  onDeleted: () => void;
}) {
  const { show } = useToast();
  const [data, setData] = useState<DetailState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [filter, setFilter] = useState<StageFilter>('all');

  // 요청 토큰 — 캠페인을 빠르게 갈아타면 앞 캠페인의 응답이 뒤에 도착할 수 있다. 그때 화면에는 이미 다른 캠페인이
  // 떠 있으므로 옛 응답은 성공이든 실패든 버린다(남의 캠페인 데이터·오류 배너가 붙는 것을 막는다).
  const reqRef = useRef(0);
  const load = useCallback(async () => {
    const token = ++reqRef.current;
    const r = await fetchCampaignDetail(id);
    if (token !== reqRef.current) return;   // 그 사이 다른 캠페인(또는 새 로드)이 시작됐다 — 이 응답은 화면의 것이 아니다
    if (r.ok) {
      const { campaign, tasks, costRows, deleteInfo, today } = r.data;   // summary·influencers는 아래 useMemo가 같은 함수로 다시 만든다
      setData({ campaign, tasks, costRows, deleteInfo, today });
      setLoadErr(false);
    } else {
      setLoadErr(true);   // 실패를 빈 상태로 위장하지 않는다
    }
    setLoaded(true);
  }, [id]);
  // id가 바뀌면 이전 캠페인의 data를 먼저 지우고 로딩 상태로 돌아간다 — 안 지우면 새 캠페인을 불러오는 동안
  // 앞 캠페인의 헤더·표·합계가 새 id의 화면인 척 남아 있고, '최신이 아닐 수 있어요' 배너도 남의 데이터에 붙는다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- id 전환 시의 리셋이 목적이라 동기 setState가 맞다(그 뒤 로드는 비동기 콜백)
    setData(null); setLoaded(false); setLoadErr(false);
    void load();
  }, [load]);

  // 파생값 — 서버와 같은 함수(campaignJudgment). 작업 하나를 고치면 넷이 함께 바뀐다.
  const summary = useMemo(() => (data ? summarizeTasks(data.tasks, data.today) : null), [data]);
  const perf = useMemo(() => (data ? summarizeTaskPerf(data.tasks) : null), [data]);
  const influencers = useMemo(() => (data ? deriveTaskInfluencers(data.tasks, data.costRows) : []), [data]);
  // 툴바 칩의 숫자 — 표가 쓰는 matchesTaskFilter 그대로라 '전달됨 2'를 눌렀을 때 나오는 행 수와 항상 같다
  const stageCounts = useMemo(() => Object.fromEntries(
    STAGE_FILTERS.map((f) => [f, (data?.tasks ?? []).filter((t) => matchesTaskFilter(t, f, data?.today ?? '')).length]),
  ) as Record<StageFilter, number>, [data]);
  const total = useMemo(() => taskCampaignTotal(influencers), [influencers]);

  const patchCampaign = useCallback(async (patch: CampaignPatchInput) => {
    const r = await patchCampaignApi(id, patch);
    if (!r.ok) { show(r.error); return false; }
    setData((cur) => (cur ? { ...cur, campaign: r.data } : cur));
    onChanged();
    return true;
  }, [id, show, onChanged]);

  async function removeCampaign() {
    const r = await deleteCampaignApi(id);
    if (!r.ok) { show(r.error); return; }
    // deleted:false = 이미 없는 캠페인(다른 사람이 지웠거나 내 화면이 오래됐다) — 지웠다고 말하지 않되 화면은 똑같이 목록으로 빠진다
    show(r.data.deleted ? `캠페인을 삭제했어요 — 작업 ${r.data.taskCount}개도 지워졌고 원고는 남아 있어요` : '이미 삭제된 캠페인이에요');
    onDeleted();
  }

  // 추가 비용·메모 — PUT 응답 행으로 costRows를 갈아끼운다(같은 핸들은 lower 기준 하나). 합계가 목록 보조줄에도 실리므로 onChanged.
  const saveCostRow = useCallback(async (handle: string, patch: { extraCosts?: ExtraCost[]; note?: string }) => {
    const r = await putInfluencerCostApi(id, handle, patch);
    if (!r.ok) { show(r.error); return false; }
    setData((cur) => {
      if (!cur) return cur;
      const others = cur.costRows.filter((x) => x.influencerHandle.toLowerCase() !== r.data.influencerHandle.toLowerCase());
      return { ...cur, costRows: [...others, r.data] };
    });
    onChanged();
    return true;
  }, [id, show, onChanged]);

  if (!loaded) return <p className="px-6 py-6 text-content text-x-muted">불러오는 중…</p>;
  if (loadErr && !data) {
    return (
      <div className="px-6 py-6">
        <p className="mb-2 text-content text-x-secondary" role="alert">캠페인을 불러오지 못했어요</p>
        <Button onClick={() => void load()}>다시 시도</Button>
      </div>
    );
  }
  if (!data || !summary || !perf) return null;

  return (
    <div className="min-w-0 space-y-5 p-5 pb-24">
      {loadErr && (
        <div role="alert" className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-ui text-red-700">
          <span>새로고침에 실패했어요 — 표시된 정보가 최신이 아닐 수 있어요</span>
          <Button variant="subtle" className="ml-auto shrink-0 bg-white" onClick={() => void load()}>다시 시도</Button>
        </div>
      )}
      <div className={PANEL}>
        <CampaignHeader campaign={data.campaign} deleteInfo={data.deleteInfo} today={data.today} onPatch={patchCampaign}
                        onDelete={() => void removeCampaign()}
                        onAddDrafts={() => show('작업 추가로 바꾸는 중이에요 — 곧 여기서 작업을 추가할 수 있어요')} />
      </div>
      <div className={PANEL}>
        <h2 className={PANEL_TITLE}>캠페인 요약</h2>
        <div className="mt-3.5">
          <SummaryCards summary={summary} perf={perf} total={total} />
        </div>
      </div>
      {/* 툴바 두 줄(QA 5라운드) — 첫 줄은 제목+건수만, 둘째 줄은 [표 | 주간 달력] + 단계 필터 칩.
          건수(N건)는 이 캠페인의 작업 전부(= 표의 '전체' 행 수)라 제목과 표가 같은 숫자를 말한다. */}
      <div className={PANEL}>
        <h2 className={PANEL_TITLE}>
          작업 진행 현황 <span className="text-ui font-normal text-x-muted tabular-nums">{data.tasks.length}건</span>
        </h2>
        <div className="mt-3.5 flex flex-wrap items-center gap-3">
          <div role="group" aria-label="작업 보기" className="inline-flex rounded-full border border-x-border-strong p-0.5">
            {(['table', 'calendar'] as DetailView[]).map((v) => (
              <button key={v} type="button" onClick={() => onViewChange(v)} aria-pressed={view === v}
                      className={`h-8 rounded-full px-3.5 text-ui ${view === v ? 'bg-x-text font-bold text-white' : 'text-x-secondary hover:bg-x-hover'}`}>
                {v === 'table' ? '표' : '주간 달력'}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {STAGE_FILTERS.map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
                      className={`inline-flex h-8 items-center rounded-full border px-3 text-ui tabular-nums ${
                        filter === f ? 'border-x-blue bg-x-blue/10 font-bold text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
                {STAGE_FILTER_LABEL[f]} {stageCounts[f]}
              </button>
            ))}
          </div>
        </div>
        {/* Task 11에서 작업 기준으로 대체 — TaskTable(표)·작업 달력이 이 자리에 들어온다 */}
        <p className="mt-3 text-ui text-x-muted">작업 표로 바꾸는 중…</p>
      </div>
      <div className={PANEL}>
        <InfluencerCostTable lines={influencers} total={total}
                             onSaveExtraCosts={(h, next) => saveCostRow(h, { extraCosts: next })}
                             onSaveNote={(h, note) => saveCostRow(h, { note })} />
      </div>
    </div>
  );
}
