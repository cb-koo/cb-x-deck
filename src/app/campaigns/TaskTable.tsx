'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { CampaignTaskItem, CampaignRow } from '@/lib/campaignStore';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { MoneyByCurrency } from '@/lib/campaignCost';
import { InfluencerChip } from '@/components/InfluencerChip';
import { CostPopover } from '@/components/CostPopover';
import { ScheduledOnField } from '@/components/ScheduledOnField';
import { useSignedTaskProofUrls } from '@/components/useSignedTaskProofUrls';
import { ImageLightbox } from '@/components/ImageLightbox';
import { PostedCell } from './PostedCell';
import { suggestTaskCost, formatMoneyBy, type TaskCost } from '@/lib/campaignCost';
import { displayStatus, TONE_CLASS } from '@/lib/settlementDisplay';
import {
  sortTasks, matchesTaskFilter, isTaskUnused, isOutOfRange, targetStatus, TARGETING_TYPES, draftWriteHref,
  TASK_TYPE_LABEL, TASK_SORT_LABEL, STAGE_FILTER_LABEL, type TaskSortKey, type StageFilter, type TypeSubtotal, type TaskSummary,
} from '@/lib/campaignJudgment';
import { taskOverdueDays, targetLabel, typeFooterLabel, handleInitial } from '@/lib/campaignTableView';
import type { useCampaignTaskActions } from './useCampaignTaskActions';
import type { TaskType } from '@/lib/campaignJudgment';

// 작업 표(스펙 §4-1, 시안 task-table-v4) — 표 하나·열 7개 고정·행은 만든 순(밀림도 자리를 바꾸지 않고 강조만 한다).
// 판정은 campaignJudgment, 문구는 campaignTableView, 여기는 그리기만. 저장은 actions(PATCH tasks/[taskId]).
// 행 ≥52px·본문 15px(text-content)·보조 13px(text-ui) — "빽빽해서 보기 힘들다"(koo)가 이 표의 첫 요구사항.
// 연한 글씨 규칙(koo 08-28): 흐린 행 = 미사용 원고가 붙은 작업만 · 내려짐 행은 일반 진하기 · 값 없는 칸만 '—'를 연하게.
// 열 너비(px, colgroup): 유형 110·인플루언서 180·원고 가변·RT/인용RT 대상 250·예정일 230(방문협찬은 '방문 · 게시' 한 줄, wrap 없음)·단계 190·비용 190.
const SORT_KEYS: TaskSortKey[] = ['created', 'scheduled', 'stage', 'influencer'];
const TH = 'px-3.5 py-2 font-normal';
const TD = 'px-3.5 py-3.5 align-middle';
const MIN_TABLE_WIDTH = 1260;
const TYPE_CHIP: Record<TaskType, string> = {
  post: 'bg-[#e8f0fe] text-[#1d4ed8]', quoteRt: 'bg-[#f3e8ff] text-[#7e22ce]', rt: 'bg-[#e6f6ee] text-[#15803d]', visit: 'bg-[#fff4e5] text-[#b45309]',
};
const MENU_W = 176;
const MENU_H = 128;  // 항목 3개 + 패딩 근사 — flip 판단에만 쓰므로 근사치로 충분하다(CostPopover 관례)

// 행 메뉴 — 자주 쓰지 않는 동작(원고 열기·게시물 연결·작업 삭제)만. 팝오버 골격은 CostPopover와 같다.
function RowMenu({ onOpenDraft, onLinkPost, onDelete }: {
  onOpenDraft: (() => void) | null; onLinkPost: (() => void) | null; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.right - MENU_W), Math.max(8, window.innerWidth - MENU_W - 8));
    const below = r.bottom + 4;
    const flip = below + MENU_H > window.innerHeight && r.top - MENU_H - 4 > 0;
    setPos({ top: flip ? r.top - MENU_H - 4 : below, left });
  }, []);
  const close = useCallback(() => { if (menuRef.current?.contains(document.activeElement)) btnRef.current?.focus(); setOpen(false); }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { const t = e.target as Node | null; if (!t || menuRef.current?.contains(t) || btnRef.current?.contains(t)) return; close(); };
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
  return (
    <>
      <button ref={btnRef} type="button" onClick={() => { if (open) { close(); return; } place(); setOpen(true); }} aria-haspopup="menu" aria-expanded={open} aria-label="행 메뉴"
              className="cursor-pointer rounded px-1.5 text-x-muted hover:bg-x-border hover:text-x-text">···</button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ top: pos.top, left: pos.left, width: MENU_W }} onClick={(e) => e.stopPropagation()}
             className="fixed z-50 rounded-lg border border-x-border-strong bg-white p-1 shadow-lg">
          {onOpenDraft && <button type="button" role="menuitem" onClick={() => { close(); onOpenDraft(); }} className="block w-full rounded px-2.5 py-1.5 text-left text-ui hover:bg-x-hover">원고 열기</button>}
          {/* 올라간 게시물 링크를 붙이는 자리 — 붙이면 게시됨으로 표시되고 조회수가 잡힌다. RT는 별도 게시물이 없어 뺀다(§2-4). */}
          {onLinkPost && <button type="button" role="menuitem" onClick={() => { close(); onLinkPost(); }} className="block w-full rounded px-2.5 py-1.5 text-left text-ui hover:bg-x-hover">게시물 연결(트래킹)</button>}
          <button type="button" role="menuitem" onClick={() => { close(); onDelete(); }} className="block w-full rounded px-2.5 py-1.5 text-left text-ui text-red-700 hover:bg-red-50">작업 삭제</button>
        </div>, document.body)}
    </>
  );
}

export function TaskTable({ rows, campaign, today, influencerOptions, sort, onSortChange, filter, byType, total, summary, actions, onOpenDraft, onAttachDraft, onPickTarget, onLinkPost, onDelete }: {
  rows: CampaignTaskItem[]; campaign: CampaignRow; today: string; influencerOptions: InfluencerOption[];
  sort: TaskSortKey; onSortChange: (k: TaskSortKey) => void; filter: StageFilter;
  byType: TypeSubtotal[]; total: MoneyByCurrency; summary: TaskSummary;
  actions: ReturnType<typeof useCampaignTaskActions>;
  onOpenDraft: (draftId: string) => void; onAttachDraft: (t: CampaignTaskItem) => void;
  onPickTarget: (t: CampaignTaskItem) => void; onLinkPost: (t: CampaignTaskItem) => void;
  onDelete: (t: CampaignTaskItem) => void;
}) {
  const shown = sortTasks(rows.filter((t) => matchesTaskFilter(t, filter, today)), sort, today);
  // 증빙 서명 URL — 표 전체에서 한 번만 배치 요청한다(행마다 부르면 왕복이 행 수만큼 늘어난다, useSignedTaskProofUrls 관례)
  const proofUrls = useSignedTaskProofUrls(rows.map((t) => t.proof?.url ?? '').filter(Boolean));
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const optionFor = (handle: string | null) => (handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined);
  const empty = (text: string) => <p className="mt-4 rounded-xl bg-x-surface px-4 py-6 text-center text-content text-x-secondary">{text}</p>;

  return (
    <section className="mt-3">
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
        <label className="flex shrink-0 items-center gap-1.5 text-ui text-x-secondary">정렬
          <select value={sort} onChange={(e) => onSortChange(e.target.value as TaskSortKey)} aria-label="작업 정렬"
                  className="h-8 rounded-md border border-x-border-strong bg-white px-2 text-ui outline-none focus:border-x-blue">
            {SORT_KEYS.map((k) => <option key={k} value={k}>{TASK_SORT_LABEL[k]}</option>)}
          </select>
        </label>
      </div>
      {rows.length === 0 ? empty('아직 이 캠페인에 작업이 없어요 — 위의 [+ 작업 추가]로 투고·인용RT·RT·방문협찬을 올려요.')
       : shown.length === 0 ? empty(`'${STAGE_FILTER_LABEL[filter]}'에 해당하는 작업이 없어요.`)
       : (
        <div className="mt-3 w-full overflow-x-auto">
          <table className="table-fixed text-content" style={{ width: `max(${MIN_TABLE_WIDTH}px, 100%)` }}>
            <colgroup>
              <col style={{ width: 110 }} /><col style={{ width: 180 }} /><col /><col style={{ width: 250 }} />
              <col style={{ width: 230 }} /><col style={{ width: 190 }} /><col style={{ width: 190 }} />
            </colgroup>
            <thead>
              <tr className="border-b border-x-border text-left text-ui text-x-muted">
                <th className={TH}>유형</th><th className={TH}>인플루언서</th><th className={TH}>원고</th><th className={TH}>RT/인용RT 대상</th>
                <th className={TH}>예정일</th><th className={TH}>단계</th><th className={`${TH} text-right`}>비용</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const unused = isTaskUnused(t);
                const od = taskOverdueDays(t, today);
                const tgt = targetLabel(t, campaign.id);
                const tStatus = targetStatus({ targetTaskId: t.targetTaskId, targetPostUrl: t.target?.postUrl ?? null, targetTweetUrl: t.targetTweetUrl });
                const suggestion = suggestTaskCost(optionFor(t.influencerHandle)?.pricing, t.type);
                return (
                  <tr key={t.id} className={`border-b border-x-border ${od !== null ? 'bg-red-50 shadow-[inset_3px_0_0_0_#dc2626]' : 'hover:bg-x-hover'} ${unused ? 'opacity-60' : ''}`}>
                    <td className={TD}><span className={`inline-block min-w-[64px] rounded-full px-2.5 py-1 text-center text-ui ${TYPE_CHIP[t.type]}`}>{TASK_TYPE_LABEL[t.type]}</span></td>
                    <td className={TD}>
                      <span className="flex items-center gap-2">
                        {t.influencerHandle && <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-x-border-strong text-ui font-bold text-white">{handleInitial(t.influencerHandle)}</span>}
                        <InfluencerChip handle={t.influencerHandle} options={influencerOptions} onChange={(next) => void actions.assignInfluencer(t, next)} />
                      </span>
                    </td>
                    <td className={`${TD} min-w-0`}>
                      {t.type === 'rt' ? <span className="text-x-muted">—</span>
                        : t.draftId ? <button type="button" onClick={() => onOpenDraft(t.draftId as string)} className="block max-w-full truncate text-left font-medium hover:underline" title={t.draftLabel ?? ''}>{t.draftLabel ?? '(제목 없음)'}</button>
                        : (
                          // 원고 없는 줄의 두 갈래(스펙 2026-08-31 §3-1). 캠페인을 먼저 짜두는 방식에선
                          // '새로 만들기'가 흔한 경우라 앞에 둔다. Link인 이유는 ⌘·가운데 클릭으로
                          // 새 탭에 열어 캠페인 표를 띄워둔 채 원고만 따로 쓸 수 있게 하기 위해서다.
                          <span className="flex flex-wrap items-center gap-x-1.5 text-x-muted">
                            <span>원고 없음</span>
                            <span aria-hidden>·</span>
                            <Link href={draftWriteHref(t.id, campaign.id)} className="text-x-blue-text hover:underline">새로 만들기</Link>
                            <span aria-hidden>·</span>
                            <button type="button" onClick={() => onAttachDraft(t)} className="hover:text-x-secondary hover:underline">고르기</button>
                          </span>
                        )}
                    </td>
                    <td className={TD}>
                      {TARGETING_TYPES.includes(t.type) ? (
                        <button type="button" onClick={() => onPickTarget(t)} className={`block max-w-full truncate text-left hover:underline ${tgt.muted ? 'text-x-muted' : ''}`} title={t.targetTweetUrl ?? t.target?.postUrl ?? ''}>
                          {tgt.text}{tgt.sub && <span className="text-x-muted"> · {tgt.sub}</span>}{tStatus === 'pending' && <span className="text-x-muted"> · 게시 전</span>}
                        </button>
                      ) : <span className="text-x-muted">—</span>}
                    </td>
                    <td className={TD}>
                      {t.type === 'visit' ? (
                        <span className="flex items-center gap-1 whitespace-nowrap">
                          <span className="text-x-secondary">방문</span>
                          <ScheduledOnField value={t.visitOn} overdueDays={null} outOfRange={isOutOfRange(t.visitOn, campaign.startsOn, campaign.endsOn)} emptyLabel="미정" ariaLabel="방문일" onChange={(next) => void actions.changeVisitOn(t, next)} compact />
                          <span className="text-x-muted">·</span><span className="text-x-secondary">게시</span>
                          <ScheduledOnField value={t.scheduledOn} overdueDays={od} outOfRange={isOutOfRange(t.scheduledOn, campaign.startsOn, campaign.endsOn)} emptyLabel="미정" ariaLabel="게시 예정일" onChange={(next) => void actions.changeScheduledOn(t, next)} compact />
                        </span>
                      ) : (
                        <ScheduledOnField value={t.scheduledOn} overdueDays={od} outOfRange={isOutOfRange(t.scheduledOn, campaign.startsOn, campaign.endsOn)} onChange={(next) => void actions.changeScheduledOn(t, next)} compact />
                      )}
                    </td>
                    <td className={TD}>
                      <PostedCell task={t} today={today}
                                  proofSignedUrl={t.proof ? proofUrls[t.proof.url] ?? null : null}
                                  onMarkPosted={(date, url, proof) => void actions.markPosted(t, date, url, proof)}
                                  onMarkRemoved={(date, reason) => void actions.markRemoved(t, date, reason)}
                                  onUnmarkRemoved={() => void actions.unmarkRemoved(t)}
                                  onSetProof={(path) => void actions.setProof(t, path)} />
                      {/* RT 증빙 표시 — 게시 확인 전에는 아무것도 없다(증빙은 게시 확인과 함께 생긴다). 썸네일을 늘어놓아
                          행을 빽빽하게 만들지 않고 작은 태그 하나로 대신하며, 누르면 ImageLightbox로 확대한다.
                          서명 URL이 아직 안 왔을 때도 '증빙 보기'로 자리를 채운다(눌러도 반응 없을 뿐) —
                          '증빙 없음'이 잘못 스치면 라벨-값이 어긋난다(UX 원칙 4). */}
                      {t.type === 'rt' && t.postedAt && (
                        t.proof
                          ? (() => {
                              const url = proofUrls[t.proof.url];
                              return (
                                <button type="button" disabled={!url} onClick={() => url && setZoomUrl(url)}
                                        title={url ? '증빙 스크린샷 — 눌러서 크게 보기' : '증빙 스크린샷 불러오는 중…'}
                                        className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600 hover:bg-slate-200 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-slate-100">
                                  증빙 보기
                                </button>
                              );
                            })()
                          : <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[12px] text-amber-700">증빙 없음</span>
                      )}
                    </td>
                    <td className={`${TD} text-right`}>
                      <span className="flex items-center justify-end gap-2 tabular-nums">
                        <CostPopover value={t.cost} suggestion={suggestion} onChange={(next: TaskCost | null) => void actions.changeCost(t, next)} compact />
                        {t.settlement && (() => { const st = displayStatus(t.settlement, 'campaign'); return (
                          <Link href={`/settlement?tab=requests&task=${t.id}`} className={`rounded-full px-2 py-0.5 text-ui whitespace-nowrap ${TONE_CLASS[st.tone]}`} title={st.title}>{st.label}</Link>
                        ); })()}
                        <RowMenu onOpenDraft={t.draftId ? () => onOpenDraft(t.draftId as string) : null}
                                 onLinkPost={t.type === 'rt' ? null : () => onLinkPost(t)}
                                 onDelete={() => onDelete(t)} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="text-ui text-x-secondary">
                <td className="px-3.5 py-3" colSpan={3}>{typeFooterLabel(byType)}</td>
                <td className="px-3.5 py-3" colSpan={2}>게시됨 {summary.published} / {summary.total}{summary.overdue > 0 && ` · 밀림 ${summary.overdue}`}{summary.removed > 0 && ` · 내려짐 ${summary.removed}`}</td>
                <td className="px-3.5 py-3 text-right tabular-nums" colSpan={2}>비용 {formatMoneyBy(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {zoomUrl && <ImageLightbox urls={[zoomUrl]} index={0} onIndexChange={() => {}} onClose={() => setZoomUrl(null)} />}
    </section>
  );
}
