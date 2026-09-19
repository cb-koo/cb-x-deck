'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { CampaignRow } from '@/lib/campaignStore';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { TaskCreateRequest } from '@/lib/campaignApi';
import type { TaskCost } from '@/lib/campaignCost';
import {
  flowStage, FLOW_STAGE_LABEL, TASK_TYPE_LABEL, isOutOfRange, formatDateKo, type TaskType,
} from '@/lib/campaignJudgment';
import { taskOverdueDays, targetLabel } from '@/lib/campaignTableView';
import {
  PANEL_FIELD_ORDER, DISPLAY_TYPE_ORDER, costCell, type FlowRow, type PanelField,
} from '@/lib/campaignFlowView';
import { STATUS_LABEL } from '@/lib/draftStatus';
import { parseXHandle, handleParseMessage } from '@/lib/xHandle';
import { InfluencerField } from '@/components/InfluencerField';
import { ScheduledOnField } from '@/components/ScheduledOnField';
import { Button } from '@/components/ui';
import type { useCampaignTaskActions } from '../useCampaignTaskActions';

// 편집 패널(b-task-7-brief.md §2) — 작업 하나(edit)와 새 작업(new)을 같은 골격에서 다룬다. 칸 순서는
// PANEL_FIELD_ORDER(campaignFlowView) 하나뿐 — 여기서 다시 적지 않는다. 저장은 두 갈래:
//  - edit: 칸마다 actions(useCampaignTaskActions, PATCH 낙관적 갱신)를 바로 부른다.
//  - new: 아무것도 서버에 쓰지 않고 로컬 상태로 들고 있다가 [만들기]에서 createTasksApi 한 번으로 보낸다
//    (중간에 실패해도 빈 작업이 안 남는다, 결정 3).
// 비용·대상 칸은 Task 8·9의 컴포넌트를 부모가 slots로 채운다 — 지금은 부모가 자리 표시 텍스트를 넣는다.
// 취소된 작업(cancelledAt)의 편집기는 메모 한 칸뿐(R18) — 나머지는 값만 보여준다(거짓 어포던스 금지).
// 인플루언서 [바꾸기](교체, ADR 0005)는 확인 다이얼로그가 있는 Task 10의 몫 — 그때까진 누를 게 없는 버튼을
// 두지 않는다(같은 이유로 게시 후 잠금·방문 후 교체 불가 안내도 Task 10이 붙인다).
type PanelMode = { kind: 'edit'; task: FlowRow; index: number; total: number } | { kind: 'new' };

export function TaskPanel({
  mode, campaign, today, influencerOptions, actions, onClose, onPrev, onNext, onCreate,
  menu, onOpenDraft, onAttachDraft, onGenerateHref, onDetachDraft, slots, overlayOpen,
}: {
  mode: PanelMode;
  campaign: CampaignRow;
  today: string;
  influencerOptions: InfluencerOption[];
  actions: ReturnType<typeof useCampaignTaskActions>;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onCreate: (body: TaskCreateRequest, more: boolean) => Promise<boolean>;
  menu: ReactNode;   // 헤더 ··· — edit 모드에만 채워진다(Task 10)
  onOpenDraft: (draftId: string) => void;
  onAttachDraft: (t: FlowRow) => void;
  onGenerateHref: (t: FlowRow) => string;
  onDetachDraft: (t: FlowRow) => void;
  slots: { cost: ReactNode; target: ReactNode };
  // 패널 위에 뜬 다른 오버레이(원고 카드·편집 모달·원고 고르기·한 번에 만들기)가 있는 동안은 패널의 Esc를 끈다 —
  // 안 그러면 [열기]로 연 원고 카드에서 Esc 한 번에 카드와 패널이 같이 닫힌다(generate 관례: 겹친 레이어는 위부터 하나씩).
  overlayOpen: boolean;
}) {
  const task = mode.kind === 'edit' ? mode.task : null;
  const index = mode.kind === 'edit' ? mode.index : -1;
  const total = mode.kind === 'edit' ? mode.total : 0;
  const validIndex = index >= 0;

  // ── 새 작업 로컬 상태 — 만들기 전까지 서버에 쓰지 않는다 ──
  const [newType, setNewType] = useState<TaskType | null>(null);
  const [handleInput, setHandleInput] = useState('');
  const [handle, setHandle] = useState('');
  const [handleErr, setHandleErr] = useState<string | null>(null);
  // Task 8·9가 채울 자리 — 지금은 편집기가 없어 늘 값이 없다(그 자리엔 slots만 보인다)
  const cost: TaskCost | null = null;
  const target: { taskId: string } | { url: string } | null = null;
  const [scheduledOn, setScheduledOn] = useState<string | null>(null);
  const [visitOn, setVisitOn] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // ── 편집 모드 로컬 상태 — 미배정 인플 입력 버퍼, 메모 입력 버퍼(값이 바뀌었을 때만 저장) ──
  const [editHandleInput, setEditHandleInput] = useState('');
  const [editHandleErr, setEditHandleErr] = useState<string | null>(null);
  const [noteBuf, setNoteBuf] = useState(task?.note ?? '');

  // Esc는 패널만 닫는다 — 안에서 열린 팝오버(예정일 달력 등)는 capture에서 stopPropagation하므로 그쪽이 먼저 먹는다.
  // 패널 위의 오버레이(원고 카드·모달)가 떠 있으면 이 리스너 자체를 끈다 — 안 그러면 그 오버레이를 닫는 Esc가
  // 패널까지 같이 닫혀 버린다(FlowDetail의 peek Esc 관례와 같다: `if (!peekId || editing) return;`).
  useEffect(() => {
    if (overlayOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, overlayOpen]);

  function resetNewFields() {
    setHandleInput(''); setHandle(''); setHandleErr(null);
    setScheduledOn(null); setVisitOn(null); setNote('');
  }
  function commitNewHandle(raw: string) {
    const v = raw.trim();
    if (!v) { setHandle(''); setHandleInput(''); setHandleErr(null); return; }
    const p = parseXHandle(v);
    if (!p.ok) { setHandleErr(handleParseMessage(p.reason)); return; }
    setHandle(p.handle); setHandleInput(p.handle); setHandleErr(null);
  }
  async function submitNew(more: boolean) {
    if (!newType || busy) return;
    setBusy(true);
    const body: TaskCreateRequest = {
      type: newType,
      influencers: handle ? [{ handle, cost }] : [],
      ...(handle ? {} : { cost: cost ?? undefined }),
      scheduledOn, visitOn: newType === 'visit' ? visitOn : null,
      note,
      ...(target && 'taskId' in target ? { targetTaskId: target.taskId } : {}),
      ...(target && 'url' in target ? { targetTweetUrl: target.url } : {}),
    };
    const ok = await onCreate(body, more);
    setBusy(false);
    if (ok && more) resetNewFields();   // 유형은 유지 — 같은 유형을 연달아 만드는 게 실제 사용 패턴(결정 4)
  }

  async function commitEditHandle(t: FlowRow, raw: string) {
    const v = raw.trim();
    if (!v) return;
    const p = parseXHandle(v);
    if (!p.ok) { setEditHandleErr(handleParseMessage(p.reason)); return; }
    setEditHandleErr(null);
    const ok = await actions.assignInfluencer(t, p.handle);
    if (ok) setEditHandleInput('');
  }

  function fieldLabel(field: PanelField, type: TaskType): string {
    switch (field) {
      case 'influencer': return '인플루언서';
      case 'cost': return type === 'visit' ? '예산' : '비용';
      case 'draft': return '원고';
      case 'target': return `${TASK_TYPE_LABEL[type]} 대상`;
      case 'scheduled': return '게시 예정일';
      case 'dates': return '일정';
      case 'note': return '메모';
    }
  }

  // ── 편집 모드 칸 ──
  function renderEditField(field: PanelField, t: FlowRow): ReactNode {
    const cancelled = t.cancelledAt !== null;
    switch (field) {
      case 'influencer':
        if (cancelled) return <span className="text-content text-x-muted">{t.influencerHandle ? `@${t.influencerHandle}` : '미정'}</span>;
        if (t.influencerHandle) return <span className="text-content">@{t.influencerHandle}</span>;
        return (
          <InfluencerField value={editHandleInput} options={influencerOptions} hideLabel hideHelp
                           onChange={(v) => { setEditHandleInput(v); setEditHandleErr(null); }} error={editHandleErr}
                           onEnter={(v) => void commitEditHandle(t, v)} onBlur={(v) => void commitEditHandle(t, v)} />
        );
      case 'cost': {
        if (!cancelled) return <>{slots.cost}</>;
        const cc = costCell(t, null);
        return <span className={`text-content ${cc.tone === 'muted' ? 'text-x-muted' : cc.tone === 'struck' ? 'text-x-muted line-through' : ''}`}>{cc.text}</span>;
      }
      case 'draft': {
        if (cancelled) return <span className="text-content text-x-muted">{t.cancelledDraftTitle ? `원고 있었음: ${t.cancelledDraftTitle}` : '—'}</span>;
        if (t.draftId) {
          return (
            <div className="flex flex-wrap items-center justify-between gap-2 text-content">
              <span className="min-w-0 truncate" title={t.draftLabel ?? ''}>
                {t.draftLabel ?? '(제목 없음)'}{t.draftStatus && <span className="text-ui text-x-muted"> · {STATUS_LABEL[t.draftStatus]}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-3 text-ui">
                <button type="button" onClick={() => onOpenDraft(t.draftId as string)} className="text-x-blue-text hover:underline">열기</button>
                <button type="button" onClick={() => onDetachDraft(t)} className="text-x-secondary hover:underline">떼기</button>
              </span>
            </div>
          );
        }
        return (
          <div>
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-content text-x-muted">
              <Link href={onGenerateHref(t)} className="whitespace-nowrap text-x-blue-text hover:underline">새로 만들기</Link>
              <span aria-hidden>·</span>
              <button type="button" onClick={() => onAttachDraft(t)} className="whitespace-nowrap hover:text-x-secondary hover:underline">있는 원고 고르기</button>
            </span>
            <p className="mt-1 text-caption text-x-muted">인플루언서가 직접 쓰면 비워 둬요</p>
          </div>
        );
      }
      case 'target': {
        if (!cancelled) return <>{slots.target}</>;
        const tgt = targetLabel(t, campaign.id);
        return <span className={`text-content ${tgt.muted ? 'text-x-muted' : ''}`}>{tgt.text}{tgt.sub && ` · ${tgt.sub}`}</span>;
      }
      case 'scheduled':
        if (cancelled) return <span className="text-content text-x-muted">{t.scheduledOn ? formatDateKo(t.scheduledOn) : '미정'}</span>;
        return (
          <ScheduledOnField value={t.scheduledOn} overdueDays={taskOverdueDays(t, today)}
                           outOfRange={isOutOfRange(t.scheduledOn, campaign.startsOn, campaign.endsOn)}
                           emptyLabel="미정" onChange={(next) => void actions.changeScheduledOn(t, next)} />
        );
      case 'dates':
        if (cancelled) {
          return (
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-caption text-x-muted">방문일</p><p className="mt-0.5 text-content text-x-muted">{t.visitOn ? formatDateKo(t.visitOn) : '미정'}</p></div>
              <div><p className="text-caption text-x-muted">게시 예정일</p><p className="mt-0.5 text-content text-x-muted">{t.scheduledOn ? formatDateKo(t.scheduledOn) : '미정'}</p></div>
            </div>
          );
        }
        return (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-caption text-x-muted">방문일 — 지나면 인플루언서를 바꿀 수 없어요</p>
              <div className="mt-0.5">
                <ScheduledOnField value={t.visitOn} overdueDays={null}
                                 outOfRange={isOutOfRange(t.visitOn, campaign.startsOn, campaign.endsOn)}
                                 ariaLabel="방문일" onChange={(next) => void actions.changeVisitOn(t, next)} />
              </div>
            </div>
            <div>
              <p className="text-caption text-x-muted">게시 예정일</p>
              <div className="mt-0.5">
                <ScheduledOnField value={t.scheduledOn} overdueDays={taskOverdueDays(t, today)}
                                 outOfRange={isOutOfRange(t.scheduledOn, campaign.startsOn, campaign.endsOn)}
                                 emptyLabel="미정" onChange={(next) => void actions.changeScheduledOn(t, next)} />
              </div>
            </div>
          </div>
        );
      case 'note':
        return (
          <input value={noteBuf} onChange={(e) => setNoteBuf(e.target.value)}
                 onBlur={() => { if (noteBuf !== t.note) void actions.setNote(t, noteBuf); }}
                 onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur(); }}
                 placeholder="한 줄"
                 className="h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue" />
        );
    }
  }

  // ── 새 작업 칸 — PANEL_FIELD_ORDER에서 'draft'만 뺀다(만들 때는 원고를 못 붙인다, 붙이기는 만든 뒤 편집 패널에서) ──
  const newFieldOrder: PanelField[] = newType ? PANEL_FIELD_ORDER[newType].filter((f) => f !== 'draft') : [];
  function renderNewField(field: PanelField): ReactNode {
    switch (field) {
      case 'influencer':
        return (
          <InfluencerField value={handleInput} options={influencerOptions} hideLabel hideHelp
                           onChange={(v) => { setHandleInput(v); setHandleErr(null); }} error={handleErr}
                           onEnter={commitNewHandle} onBlur={commitNewHandle} />
        );
      case 'cost':
        return <>{slots.cost}</>;
      case 'target':
        return <>{slots.target}</>;
      case 'scheduled':
        return (
          <ScheduledOnField value={scheduledOn} overdueDays={null}
                           outOfRange={isOutOfRange(scheduledOn, campaign.startsOn, campaign.endsOn)}
                           emptyLabel="미정" onChange={setScheduledOn} />
        );
      case 'dates':
        return (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-caption text-x-muted">방문일</p>
              <div className="mt-0.5">
                <ScheduledOnField value={visitOn} overdueDays={null}
                                 outOfRange={isOutOfRange(visitOn, campaign.startsOn, campaign.endsOn)}
                                 ariaLabel="방문일" onChange={setVisitOn} />
              </div>
            </div>
            <div>
              <p className="text-caption text-x-muted">게시 예정일</p>
              <div className="mt-0.5">
                <ScheduledOnField value={scheduledOn} overdueDays={null}
                                 outOfRange={isOutOfRange(scheduledOn, campaign.startsOn, campaign.endsOn)}
                                 emptyLabel="미정" onChange={setScheduledOn} />
              </div>
            </div>
          </div>
        );
      case 'note':
        return (
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="한 줄"
                 className="h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue" />
        );
      case 'draft':
        return null;
    }
  }

  const crumb = task ? `${FLOW_STAGE_LABEL[flowStage(task, task.settlement)]} · ${TASK_TYPE_LABEL[task.type]}` : '새 작업';
  const title: ReactNode = task
    ? (task.influencerHandle ? `@${task.influencerHandle}` : <span className="text-x-muted">인플루언서 미정</span>)
    : (newType ? `새 ${TASK_TYPE_LABEL[newType]} 작업` : '어떤 작업인가요?');

  return (
    <aside role="dialog" aria-label="작업 편집" className="fixed inset-y-0 right-0 z-40 flex w-[560px] flex-col border-l border-x-border bg-white shadow-xl">
      <div className="flex items-start justify-between border-b border-x-border px-6 pt-5 pb-4">
        <div className="min-w-0">
          <p className="text-ui text-x-secondary">{crumb}</p>
          <h2 className="mt-0.5 truncate text-[20px]">{title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {task && menu}
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full p-1.5 text-x-secondary hover:bg-x-hover">✕</button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
        {task ? (
          <>
            {task.cancelledAt && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-ui text-slate-600">취소된 작업이에요 — ··· 메뉴의 [되돌리기]로 살릴 수 있어요</p>
            )}
            {PANEL_FIELD_ORDER[task.type].map((field) => (
              <div key={field}>
                <p className="text-ui text-x-secondary">{fieldLabel(field, task.type)}</p>
                <div className="mt-1">{renderEditField(field, task)}</div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div>
              <p className="text-ui text-x-secondary">유형</p>
              <div role="group" aria-label="작업 유형" className="mt-1 inline-flex overflow-hidden rounded-lg border border-x-border-strong">
                {DISPLAY_TYPE_ORDER.map((k) => (
                  <button key={k} type="button" aria-pressed={newType === k} onClick={() => setNewType(k)}
                          className={`border-r border-x-border-strong px-3.5 py-2 text-content last:border-r-0 ${newType === k ? 'bg-x-text text-white' : 'text-x-secondary hover:bg-x-hover'}`}>
                    {TASK_TYPE_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            {newFieldOrder.map((field) => (
              <div key={field}>
                <p className="text-ui text-x-secondary">{fieldLabel(field, newType as TaskType)}</p>
                <div className="mt-1">{renderNewField(field)}</div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-x-border px-6 py-3">
        {task ? (
          <div className="ml-auto flex items-center gap-3">
            <Button onClick={onPrev} disabled={!validIndex || index <= 0} className="h-9 px-3 text-ui">← 이전</Button>
            {validIndex
              ? <span className="text-ui text-x-muted tabular-nums">{index + 1} / {total}</span>
              : <span className="text-ui text-x-muted">지금 필터에 없는 작업이에요</span>}
            <Button onClick={onNext} disabled={!validIndex || index >= total - 1} className="h-9 px-3 text-ui">다음 →</Button>
          </div>
        ) : (
          <>
            <p className="text-ui text-x-muted">{newType ? '비어 있는 칸은 나중에 채워도 돼요' : '유형을 먼저 골라요'}</p>
            <div className="ml-auto flex items-center gap-2">
              <Button onClick={() => void submitNew(true)} disabled={!newType || busy} className="h-9 px-3.5 text-ui">만들고 하나 더</Button>
              <Button variant="primary" onClick={() => void submitNew(false)} disabled={!newType || busy} className="h-9 px-3.5 text-ui">
                {busy ? '만드는 중…' : '만들기'}
              </Button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
