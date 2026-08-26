'use client';
import type { CampaignDraftItem, CampaignRow } from '@/lib/campaignStore';
import type { DraftStatus } from '@/lib/draftStatus';
import type { InfluencerOption } from '@/lib/draftTypes';
import { DraftStatusChip } from '@/components/DraftStatusChip';
import { InfluencerChip } from '@/components/InfluencerChip';
import { CostPopover } from '@/components/CostPopover';
import { ScheduledOnField } from '@/components/ScheduledOnField';
import { draftLabel } from '@/lib/draftViews';
import { suggestDraftCost, type DraftCost } from '@/lib/campaignCost';
import {
  sortContent, matchesStageFilter, isOutOfRange, defaultCostType,
  STAGE_FILTERS, STAGE_FILTER_LABEL, CONTENT_SORT_LABEL, type ContentSortKey, type StageFilter,
} from '@/lib/campaignJudgment';
import { overdueDays, contentSubline, perfLabel, handleInitial } from '@/lib/campaignTableView';

// 콘텐츠 표 — 열 6개 고정(예정일 120 · 콘텐츠 나머지 · 인플 200 · 비용 130 · 단계 130 · 성과 190, 스펙 §3-2).
// 행 ≥48px(py-3)·본문 15px(text-content)·보조 13px(text-ui) — "맨날 빽빽해서 보기 힘들다"(koo 08-25)가 이 표의 첫 요구사항.
// text-caption(11px)은 쓰지 않는다. 정렬·필터·밀림·기간 밖 판정은 전부 campaignJudgment — 이 파일은 결과를 그릴 뿐이다.
// 저장은 전부 콜백(부모 훅이 PATCH /api/drafts/[id]) — 캠페인 전용 경로 없음(§2-5).
const SORT_KEYS: ContentSortKey[] = ['default', 'scheduled', 'stage', 'influencer'];
const TH = 'px-3 py-2 font-normal';
const TD = 'px-3 py-3 align-top';

export function ContentTable({
  rows, campaign, today, influencerOptions, sort, onSortChange, filter, onFilterChange,
  onOpenDraft, onChangeStatus, onAssignInfluencer, onChangeScheduledOn, onChangeCost, onRemoveFromCampaign, onLinkPost,
}: {
  rows: CampaignDraftItem[];                 // 정렬·필터 전 — 여기서 sortContent·matchesStageFilter를 적용한다
  campaign: CampaignRow; today: string;      // today = 서버 detail.today(서울) — 브라우저 시계로 밀림을 판정하지 않는다
  influencerOptions: InfluencerOption[];
  sort: ContentSortKey; onSortChange: (k: ContentSortKey) => void;
  filter: StageFilter; onFilterChange: (f: StageFilter) => void;
  onOpenDraft: (id: string) => void;
  onChangeStatus: (d: CampaignDraftItem, s: DraftStatus) => void;
  onAssignInfluencer: (d: CampaignDraftItem, handle: string | null) => void;
  onChangeScheduledOn: (d: CampaignDraftItem, next: string | null) => void;
  onChangeCost: (d: CampaignDraftItem, next: DraftCost | null) => void;
  onRemoveFromCampaign: (d: CampaignDraftItem) => void;
  onLinkPost: (d: CampaignDraftItem) => void;
}) {
  const counts = Object.fromEntries(
    STAGE_FILTERS.map((f) => [f, rows.filter((d) => matchesStageFilter(d, f)).length]),
  ) as Record<StageFilter, number>;
  const shown = sortContent(rows.filter((d) => matchesStageFilter(d, filter)), sort, today);
  const optionFor = (handle: string | null) =>
    (handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined);

  // 행 클릭 = 원고 열기. 셀 안의 컨트롤(칩·팝오버·날짜 입력·메뉴)과 글자 드래그는 열지 않는다(DraftTable.opensCard 관례).
  function opensCard(e: React.MouseEvent): boolean {
    if (e.target instanceof Element && e.target.closest('a, button, label, input, select, details')) return false;
    const sel = window.getSelection();
    return !(sel && !sel.isCollapsed && sel.toString().trim() !== '');
  }
  const chip = (on: boolean) =>
    `inline-flex h-8 items-center rounded-full border px-3 text-ui tabular-nums ${on ? 'border-x-blue bg-x-blue/10 font-bold text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`;

  const empty = (text: string) => (
    <p className="mt-4 rounded-xl border border-x-border bg-x-surface px-4 py-6 text-center text-content text-x-secondary">{text}</p>
  );

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-1.5">
        {STAGE_FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => onFilterChange(f)} aria-pressed={filter === f} className={chip(filter === f)}>
            {STAGE_FILTER_LABEL[f]} {counts[f]}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-ui text-x-secondary">
          정렬
          <select value={sort} onChange={(e) => onSortChange(e.target.value as ContentSortKey)} aria-label="콘텐츠 정렬"
                  className="h-8 rounded-md border border-x-border-strong bg-white px-2 text-ui outline-none focus:border-x-blue">
            {SORT_KEYS.map((k) => <option key={k} value={k}>{CONTENT_SORT_LABEL[k]}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-1.5 text-ui text-x-muted">밀린 콘텐츠가 맨 위에 와요 — 예정일·인플루언서·비용·단계는 칸을 눌러 바로 고칠 수 있어요. 행을 누르면 원고가 열려요.</p>

      {rows.length === 0 ? empty('아직 이 캠페인에 원고가 없어요 — 위의 [+ 원고 추가]로 기존 원고를 넣거나 새로 만들어요.')
       : shown.length === 0 ? empty(`'${STAGE_FILTER_LABEL[filter]}'에 해당하는 콘텐츠가 없어요.`)
       : (
        <div className="mt-3 w-full overflow-x-auto">
          <table className="w-full table-fixed text-content">
            <colgroup>
              <col style={{ width: 120 }} /><col /><col style={{ width: 200 }} />
              <col style={{ width: 130 }} /><col style={{ width: 130 }} /><col style={{ width: 190 }} />
            </colgroup>
            <thead>
              <tr className="border-b border-x-border text-left text-ui text-x-muted">
                <th className={TH}>예정일</th><th className={TH}>콘텐츠</th><th className={TH}>인플루언서</th>
                <th className={TH}>비용</th><th className={TH}>단계</th><th className={TH}>성과</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const unused = d.status === 'unused';
                const od = overdueDays(d, today);
                const label = draftLabel(d);
                const suggestion = suggestDraftCost(optionFor(d.influencerHandle)?.pricing, defaultCostType(campaign.kind));
                return (
                  // 밀린 행: 연한 빨강 배경 + 왼쪽 3px 빨간 막대(inset shadow — border-left는 table-fixed에서 열 폭을 민다). 미사용은 흐리게.
                  <tr key={d.id} tabIndex={0}
                      onClick={(e) => { if (opensCard(e)) onOpenDraft(d.id); }}
                      onKeyDown={(e) => {
                        if ((e.key !== 'Enter' && e.key !== ' ') || e.target !== e.currentTarget) return;
                        e.preventDefault(); onOpenDraft(d.id);
                      }}
                      className={`relative cursor-pointer border-b border-x-border focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-x-blue ${
                        od !== null ? 'bg-red-50 shadow-[inset_3px_0_0_0_#dc2626]' : 'hover:bg-x-hover'} ${unused ? 'opacity-60' : ''}`}>
                    <td className={TD}>
                      <ScheduledOnField value={d.scheduledOn} overdueDays={od}
                                        outOfRange={isOutOfRange(d.scheduledOn, campaign.startsOn, campaign.endsOn)}
                                        onChange={(next) => onChangeScheduledOn(d, next)} compact />
                    </td>
                    <td className={TD}>
                      <p className="truncate font-medium" title={label.text}>{label.text}</p>
                      <p className="mt-0.5 text-ui text-x-muted">{contentSubline(d)}</p>
                    </td>
                    <td className={TD}>
                      <span className="flex items-center gap-2">
                        {d.influencerHandle && (
                          <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-x-border-strong text-ui font-bold text-white">
                            {handleInitial(d.influencerHandle)}
                          </span>
                        )}
                        {/* 배정·변경 = InfluencerChip(InfluencerField + 명부 자동완성 재사용) — 배정 시 비용 제안은 부모 훅이 넣는다 */}
                        <InfluencerChip handle={d.influencerHandle} options={influencerOptions} onChange={(next) => onAssignInfluencer(d, next)} />
                      </span>
                    </td>
                    <td className={TD}>
                      <CostPopover value={d.cost} suggestion={suggestion} defaultType={defaultCostType(campaign.kind)}
                                   onChange={(next) => onChangeCost(d, next)} compact />
                    </td>
                    <td className={TD}>
                      <span className="flex flex-col items-start gap-1">
                        <DraftStatusChip status={d.status} onChange={(s) => onChangeStatus(d, s)} />
                        {d.published ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-ui font-bold text-green-800" title="연결된 게시물이 있어요 — 상태 값과 무관하게 게시됨으로 봐요">✓ 게시됨</span>
                        ) : (
                          <button type="button" onClick={() => onLinkPost(d)} className="text-ui text-x-blue-text hover:underline"
                                  title="올라간 게시물 링크를 붙이면 게시됨으로 바뀌고 조회·좋아요가 잡혀요">게시물 연결</button>
                        )}
                      </span>
                    </td>
                    <td className={TD}>
                      <span className="flex items-start justify-between gap-1">
                        <span className={`tabular-nums ${d.published ? '' : 'text-x-muted'}`}>{perfLabel(d)}</span>
                        {/* 행 메뉴 — 네이티브 details: 상태 없이 열고 닫히고, 바깥 클릭엔 닫히지 않지만 항목 2개라 감수 */}
                        <details className="relative shrink-0">
                          <summary aria-label="행 메뉴" className="cursor-pointer list-none rounded px-1.5 text-x-muted hover:bg-x-border hover:text-x-text">···</summary>
                          <div className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-x-border-strong bg-white p-1 shadow-lg">
                            <button type="button" onClick={() => onOpenDraft(d.id)} className="block w-full rounded px-2.5 py-1.5 text-left text-ui hover:bg-x-hover">원고 열기</button>
                            <button type="button" onClick={() => onRemoveFromCampaign(d)} className="block w-full rounded px-2.5 py-1.5 text-left text-ui text-red-700 hover:bg-red-50">캠페인에서 빼기</button>
                          </div>
                        </details>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
