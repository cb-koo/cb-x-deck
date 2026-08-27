'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignDraftItem, CampaignRow } from '@/lib/campaignStore';
import type { DraftStatus } from '@/lib/draftStatus';
import type { InfluencerOption } from '@/lib/draftTypes';
import { DraftStatusChip, PUBLISHED_STYLE } from '@/components/DraftStatusChip';
import { InfluencerChip } from '@/components/InfluencerChip';
import { CostPopover } from '@/components/CostPopover';
import { ScheduledOnField } from '@/components/ScheduledOnField';
import { Button } from '@/components/ui';
import { draftLabel } from '@/lib/draftViews';
import { suggestDraftCost, type DraftCost, type TaskCost } from '@/lib/campaignCost';
import type { TaskType } from '@/lib/campaignJudgment';
import {
  sortContent, matchesStageFilter, isOutOfRange, defaultCostType,
  STAGE_FILTER_LABEL, CONTENT_SORT_LABEL, type ContentSortKey, type StageFilter,
} from '@/lib/campaignJudgment';
import { overdueDays, contentTypeLabel, perfLabel, handleInitial } from '@/lib/campaignTableView';

// Task 11/15에서 작업 기준으로 대체 — 임시 어댑터: 비용 유형이 작업으로 옮겨가(DraftRow.taskType) 원고 비용은 {amount,currency}만 남았다.
// 이 화면(원고 기준 표)은 Task 11/15에서 작업 표로 바뀐다 — 그때까지 옛 모양으로 되맞춰 그린다.
const asDraftCostRow = (d: { cost: TaskCost | null; taskType: TaskType | null }): { cost: DraftCost | null } =>
  ({ cost: d.cost ? { type: d.taskType ?? 'post', ...d.cost } : null });

// 콘텐츠 표 — 열 8개 고정(예정일 110 · 콘텐츠 나머지 · 유형 110 · 인플 180 · 비용 120 · 단계 120 · 게시물 120 · 성과 170, QA 5라운드).
// 유형은 콘텐츠 칸의 13px 보조줄에서 전용 열로 올렸다 — 보조줄에 유형·형식이 섞여 있어 어느 쪽으로도 훑을 수 없었다.
// '게시물 연결' 입구는 QA 5라운드에서 단계 칸 → 전용 게시물 칸으로 옮겼다 — 단계(준비 상태)와 게시물 연결(외부 링크)은 다른 축이라
// 한 칸에 섞이면 무엇을 눌러야 하는지 헷갈렸다. 단계 칸은 상태 칩 + (게시됨이면) 파생 '✓ 게시됨' 칩만 그대로 둔다.
// 행 ≥48px(py-3)·본문 15px(text-content)·보조 13px(text-ui) — "맨날 빽빽해서 보기 힘들다"(koo 08-25)가 이 표의 첫 요구사항.
// text-caption(11px)은 쓰지 않는다. 정렬·필터·밀림·기간 밖 판정은 전부 campaignJudgment — 이 파일은 결과를 그릴 뿐이다.
// 저장은 전부 콜백(부모 훅이 PATCH /api/drafts/[id]) — 캠페인 전용 경로 없음(§2-5).
const SORT_KEYS: ContentSortKey[] = ['default', 'scheduled', 'stage', 'influencer'];
const TH = 'px-3 py-2 font-normal';
const TD = 'px-3 py-3 align-top';
// 표 최소 폭 — 고정 열 합(110+110+180+120+120+120+170=930)에 콘텐츠 열 몫을 더한 값이 좁은 화면에서도 눌리지 않게(TweetTable·TrackingTable 관례)
const MIN_TABLE_WIDTH = 1050;
const MENU_W = 176; // w-44
const MENU_H = 96;  // 항목 2개 + 패딩 근사 — flip 판단에만 쓰므로 근사치로 충분하다(CostPopover 관례)

// 행 메뉴 — overflow-x-auto 컨테이너 안에서는 z-index로 클리핑을 넘을 수 없다(마지막 행에서 잘림, 리뷰 반영).
// CostPopover·InfluencerChip과 같은 골격: body 포털 + 화면 좌표 고정 + 바깥 클릭/Esc/스크롤로 닫힘.
function RowMenu({ onOpenDraft, onRemoveFromCampaign }: { onOpenDraft: () => void; onRemoveFromCampaign: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // 오른쪽 맞춤(버튼이 열의 오른쪽 끝) + 화면 경계 클램프. 아래 공간이 없으면 위로 뒤집는다.
    const left = Math.min(Math.max(8, r.right - MENU_W), Math.max(8, window.innerWidth - MENU_W - 8));
    const below = r.bottom + 4;
    const flip = below + MENU_H > window.innerHeight && r.top - MENU_H - 4 > 0;
    setPos({ top: flip ? r.top - MENU_H - 4 : below, left });
  }, []);
  const close = useCallback(() => {
    if (menuRef.current?.contains(document.activeElement)) btnRef.current?.focus();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key !== 'Escape' || e.isComposing) return; e.stopPropagation(); close(); };
    const onMove = () => place();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, close, place]);

  function toggle() {
    if (open) { close(); return; }
    place();
    setOpen(true);
  }

  return (
    <>
      <button ref={btnRef} type="button" onClick={toggle}
              aria-haspopup="menu" aria-expanded={open} aria-label="행 메뉴"
              className="cursor-pointer rounded px-1.5 text-x-muted hover:bg-x-border hover:text-x-text">···</button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ top: pos.top, left: pos.left, width: MENU_W }}
             onClick={(e) => e.stopPropagation()}
             className="fixed z-50 rounded-lg border border-x-border-strong bg-white p-1 shadow-lg">
          <button type="button" role="menuitem" onClick={() => { close(); onOpenDraft(); }}
                  className="block w-full rounded px-2.5 py-1.5 text-left text-ui hover:bg-x-hover">원고 열기</button>
          <button type="button" role="menuitem" onClick={() => { close(); onRemoveFromCampaign(); }}
                  className="block w-full rounded px-2.5 py-1.5 text-left text-ui text-red-700 hover:bg-red-50">캠페인에서 빼기</button>
        </div>,
        document.body,
      )}
    </>
  );
}

export function ContentTable({
  rows, campaign, today, influencerOptions, sort, onSortChange, filter,
  onOpenDraft, onChangeStatus, onAssignInfluencer, onChangeScheduledOn, onChangeCost, onRemoveFromCampaign, onLinkPost,
}: {
  rows: CampaignDraftItem[];                 // 정렬·필터 전 — 여기서 sortContent·matchesStageFilter를 적용한다
  campaign: CampaignRow; today: string;      // today = 서버 detail.today(서울) — 브라우저 시계로 밀림을 판정하지 않는다
  influencerOptions: InfluencerOption[];
  sort: ContentSortKey; onSortChange: (k: ContentSortKey) => void;
  // 단계 필터 값만 받는다 — 칩은 상위 툴바(제목·보기 전환과 한 줄)에 있고 표·달력이 같은 값을 쓴다(QA 4라운드)
  filter: StageFilter;
  onOpenDraft: (id: string) => void;
  onChangeStatus: (d: CampaignDraftItem, s: DraftStatus) => void;
  onAssignInfluencer: (d: CampaignDraftItem, handle: string | null) => void;
  onChangeScheduledOn: (d: CampaignDraftItem, next: string | null) => void;
  onChangeCost: (d: CampaignDraftItem, next: DraftCost | null) => void;
  onRemoveFromCampaign: (d: CampaignDraftItem) => void;
  onLinkPost: (d: CampaignDraftItem) => void;
}) {
  const shown = sortContent(rows.filter((d) => matchesStageFilter(d, filter)), sort, today);
  const optionFor = (handle: string | null) =>
    (handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined);

  // 행 클릭 = 원고 열기. 셀 안의 컨트롤(칩·팝오버·날짜 입력·메뉴)과 글자 드래그는 열지 않는다(DraftTable.opensCard 관례).
  function opensCard(e: React.MouseEvent): boolean {
    if (e.target instanceof Element && e.target.closest('a, button, label, input, select')) return false;
    const sel = window.getSelection();
    return !(sel && !sel.isCollapsed && sel.toString().trim() !== '');
  }
  // 빈 상태 — 섹션 패널 안이라 테두리를 두지 않는다(패널 테두리와 겹쳐 상자 안 상자로 읽힌다, QA 7라운드). 연회색 면으로만 구분한다.
  const empty = (text: string) => (
    <p className="mt-4 rounded-xl bg-x-surface px-4 py-6 text-center text-content text-x-secondary">{text}</p>
  );

  return (
    // mt-3 = 상위 툴바(세그먼트·칩)와의 간격만 — 섹션 간 간격은 CampaignDetail의 패널 사이 space-y-5가 쥔다(QA 7라운드)
    <section className="mt-3">
      {/* 표 자신의 머리줄 — 단계 필터 칩이 상위 툴바로 올라가면서(QA 4라운드) 정렬만 여기 남았다.
          도움말 문장은 QA 5라운드에서 없앴다(오너 판단: 표를 몇 번 쓰면 저절로 알게 되는 것을 매번 보여줄 필요가 없다). */}
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
        <label className="flex shrink-0 items-center gap-1.5 text-ui text-x-secondary">
          정렬
          <select value={sort} onChange={(e) => onSortChange(e.target.value as ContentSortKey)} aria-label="콘텐츠 정렬"
                  className="h-8 rounded-md border border-x-border-strong bg-white px-2 text-ui outline-none focus:border-x-blue">
            {SORT_KEYS.map((k) => <option key={k} value={k}>{CONTENT_SORT_LABEL[k]}</option>)}
          </select>
        </label>
      </div>

      {rows.length === 0 ? empty('아직 이 캠페인에 원고가 없어요 — 위의 [+ 원고 추가]로 기존 원고를 넣거나 새로 만들어요.')
       : shown.length === 0 ? empty(`'${STAGE_FILTER_LABEL[filter]}'에 해당하는 콘텐츠가 없어요.`)
       : (
        <div className="mt-3 w-full overflow-x-auto">
          <table className="table-fixed text-content" style={{ width: `max(${MIN_TABLE_WIDTH}px, 100%)` }}>
            <colgroup>
              <col style={{ width: 110 }} /><col /><col style={{ width: 110 }} /><col style={{ width: 180 }} />
              <col style={{ width: 120 }} /><col style={{ width: 120 }} /><col style={{ width: 120 }} /><col style={{ width: 170 }} />
            </colgroup>
            <thead>
              <tr className="border-b border-x-border text-left text-ui text-x-muted">
                <th className={TH}>예정일</th><th className={TH}>콘텐츠</th><th className={TH}>유형</th><th className={TH}>인플루언서</th>
                <th className={TH}>비용</th><th className={TH}>단계</th><th className={TH}>게시물</th><th className={TH}>성과</th>
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
                        od !== null ? 'bg-red-50 shadow-[inset_3px_0_0_0_#dc2626] hover:bg-red-100' : 'hover:bg-x-hover'} ${unused ? 'opacity-60' : ''}`}>
                    <td className={TD}>
                      <ScheduledOnField value={d.scheduledOn} overdueDays={od}
                                        outOfRange={isOutOfRange(d.scheduledOn, campaign.startsOn, campaign.endsOn)}
                                        onChange={(next) => onChangeScheduledOn(d, next)} compact />
                    </td>
                    <td className={TD}>
                      {/* 제목만 — 좁은 열에서 한 줄로 자르면 뒤가 다 날아가서 두 줄까지 보여주고 자른다 */}
                      <p className="line-clamp-2 font-medium" title={label.text}>{label.text}</p>
                    </td>
                    <td className={TD}>
                      <span className={d.cost ? 'text-x-secondary' : 'text-x-muted'}>{contentTypeLabel(asDraftCostRow(d))}</span>
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
                      <CostPopover value={asDraftCostRow(d).cost} suggestion={suggestion} defaultType={defaultCostType(campaign.kind)}
                                   onChange={(next) => onChangeCost(d, next)} compact />
                    </td>
                    <td className={TD}>
                      <span className="flex flex-col items-start gap-1">
                        <DraftStatusChip status={d.status} onChange={(s) => onChangeStatus(d, s)} />
                        {d.published && (
                          // 색은 PUBLISHED_STYLE(DraftStatusChip) 하나만 — 표·달력이 각자 색을 두면 같은 단계가 다르게 보인다(리뷰 반영).
                          <span className={`rounded-full border px-2 py-0.5 text-ui font-bold ${PUBLISHED_STYLE}`} title="연결된 게시물이 있어요 — 상태 값과 무관하게 게시됨으로 봐요">✓ 게시됨</span>
                        )}
                      </span>
                    </td>
                    <td className={TD}>
                      {/* '게시물 연결' 입구 — QA 5라운드에서 단계 칸에서 이 전용 칸으로 옮겼다(단계≠게시물 연결). */}
                      {d.published ? (
                        <span className="text-ui font-medium text-green-700">✓ 연결됨</span>
                      ) : (
                        <Button variant="subtle" onClick={() => onLinkPost(d)} className="inline-flex h-8 items-center px-3"
                                title="올라간 게시물 링크를 붙이면 게시됨으로 바뀌고 조회·좋아요가 잡혀요">게시물 연결</Button>
                      )}
                    </td>
                    <td className={TD}>
                      <span className="flex items-start justify-between gap-1">
                        <span className={`tabular-nums ${d.published ? '' : 'text-x-muted'}`}>{perfLabel(d)}</span>
                        <span className="shrink-0">
                          <RowMenu onOpenDraft={() => onOpenDraft(d.id)} onRemoveFromCampaign={() => onRemoveFromCampaign(d)} />
                        </span>
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
