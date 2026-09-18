'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { DraftRow } from '@/lib/draftStore';
import type { CampaignRow, CampaignTaskItem } from '@/lib/campaignStore';
import { fetchCampaignDetail } from '@/lib/campaignApi';
import { TASK_TYPE_LABEL, TARGETABLE_TYPES, campaignStatus, formatDateKo, type TaskType } from '@/lib/campaignJudgment';

// 원고가 붙은 '작업' 한 칸(스펙 2026-08-28 §5) — 캠페인의 단위가 원고에서 작업(campaign_task)으로 옮겨가면서
// 옛 '캠페인: ○○ ▾' 칸을 대체한다. 원고는 캠페인에 직접 속하지 않는다: 작업에 붙으면
// 그 작업의 캠페인·예정일·비용을 따라간다(값은 하나 — 카드에 보이는 건 전부 작업에서 읽은 파생값).
//
// 그래서 이 칸이 하는 일은 딱 둘이다 — 붙이기 / 떼기. 예정일·비용은 여기서 고치지 않는다(카드의 읽기 줄이
// '작업에서 고치기 ↗'로 캠페인 화면을 가리킨다). 누르면 아무 일도 안 나는 손잡이를 만들지 않기 위해서다.
const POP_W = 360;
const POP_H = 380; // 실측 근사 — 아래 공간 판정(flip)에만 쓴다

// 붙일 수 있는 작업 유형 — RT는 별도 게시물이 없어 원고가 붙지 않는다(TARGETABLE_TYPES와 같은 세 가지).
const ATTACHABLE_TYPES = TARGETABLE_TYPES;

// 후보 캠페인 = 그 원고 클라이언트의 진행 중·예정이 기본, 종료는 접힘. 클라가 없는 원고는 전체.
// 후보 정렬 규칙(진행 중 먼저 → 시작일 내림차순)은 옛 캠페인 칸에서 그대로 옮겨 왔다.
function campaignOptionsFor(all: CampaignRow[], clientId: string | null, today: string): { open: CampaignRow[]; ended: CampaignRow[] } {
  const mine = clientId === null ? all : all.filter((c) => c.clientId === clientId);
  return {
    open: mine.filter((c) => campaignStatus(c.startsOn, c.endsOn, today) !== 'ended'),
    ended: mine.filter((c) => campaignStatus(c.startsOn, c.endsOn, today) === 'ended'),
  };
}

export function DraftTaskField({ draft, campaigns, today, onAttach, onDetach, onCreateTask }: {
  draft: DraftRow;
  campaigns: CampaignRow[];
  today: string;                 // 진행 중·종료 판정 기준(서울) — 호스트가 서버 today 또는 kstToday()를 준다
  onAttach: (taskId: string) => void;
  onDetach: () => void;
  // 성공하면 true, 실패하면 false(호스트가 이미 토스트로 사유를 말한다) — 작업 만들기+원고 붙이기를
  // 호스트가 한 트랜잭션으로 처리하므로(리뷰 발견: 따로 하면 붙임 실패 시 원고 없는 고아 작업이 남는다),
  // 여기서는 만든 작업 id를 몰라도 된다(붙이는 것도 이미 끝난 뒤이므로).
  onCreateTask: (campaignId: string, type: TaskType) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [campaignId, setCampaignId] = useState('');
  const [showEnded, setShowEnded] = useState(false);
  // 원고 없는 작업 후보(=붙일 수 있는 기존 작업) 목록에서 지금 붙이는 중인 것 — 완료 신호가 없는
  // fire-and-forget(onAttach는 void)이라 다음 틱에 닫아 '붙이는 중' 표시가 최소 한 프레임은 보이게 한다.
  const [busyId, setBusyId] = useState<string | null>(null);
  // 불러온 작업 목록은 '어느 캠페인 것인지'와 한 벌로 들고 있는다 — 캠페인을 바꾼 직후 옛 목록이
  // 새 캠페인의 것인 척 남아 있으면 남의 작업에 원고를 붙일 수 있다. 셋을 따로 두고 이펙트에서 지우면
  // 렌더 도중 setState가 되므로(연쇄 렌더) 한 값으로 묶어 '캠페인이 다르면 아직 없는 것'으로 읽는다.
  const [loaded, setLoaded] = useState<{ campaignId: string; tasks: CampaignTaskItem[]; error: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const { open: openCampaigns, ended } = useMemo(
    () => campaignOptionsFor(campaigns, draft.clientId, today), [campaigns, draft.clientId, today]);

  // 앵커의 화면 좌표에 고정 + 경계 클램프 + 아래 공간이 없으면 위로 (CostPopover.place와 같은 계산)
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - POP_W - 8));
    const below = r.bottom + 4;
    const flip = below + POP_H > window.innerHeight && r.top - POP_H - 4 > 0;
    setPos({ top: flip ? r.top - POP_H - 4 : below, left });
  }, []);
  const close = useCallback(() => {
    if (popRef.current?.contains(document.activeElement)) btnRef.current?.focus();
    setOpen(false);
  }, []);

  function openPop() {
    // 캠페인 하나뿐이면 고르는 단계가 사족이다 — 바로 그 캠페인의 작업 목록으로 시작한다.
    setCampaignId((cur) => cur || (openCampaigns.length === 1 ? openCampaigns[0].id : ''));
    setLoaded(null);   // 닫혀 있는 동안 다른 사람이 작업을 붙였을 수 있다 — 열 때마다 새로 읽는다
    setBusyId(null);
    place(); setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    // capture로 받아 전파를 끊는다 — 카드 peek 오버레이의 Esc까지 한 번에 닫히지 않게(CostPopover 관례)
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

  // 고른 캠페인의 작업 목록 — 상세 API 재사용(원고 없는 작업만 쓰려고 라우트를 새로 내지 않는다).
  useEffect(() => {
    if (!open || !campaignId) return;
    let alive = true;
    void fetchCampaignDetail(campaignId).then((r) => {
      if (!alive) return;
      // 실패를 빈 목록으로 위장하지 않는다 — 사유를 그 자리에 남긴다
      setLoaded(r.ok ? { campaignId, tasks: r.data.tasks, error: '' } : { campaignId, tasks: [], error: r.error });
    });
    return () => { alive = false; };
  }, [open, campaignId]);
  const shown = loaded?.campaignId === campaignId ? loaded : null;   // 다른 캠페인의 응답이면 아직 불러오는 중이다

  // 붙일 수 있는 작업 = 원고가 아직 없고 RT가 아닌 것. 이미 다른 원고가 붙은 작업은 후보가 아니다(원고 1 : 작업 1).
  const free = useMemo(
    // 취소된 작업은 후보가 아니다(R18) — 원고를 붙일 수 없다
    () => (shown?.tasks ?? []).filter((t) => t.draftId === null && t.cancelledAt === null && ATTACHABLE_TYPES.includes(t.type)),
    [shown]);

  async function createAndAttach(type: TaskType) {
    if (!campaignId || creating) return;
    setCreating(true);
    // 작업 만들기 + 이 원고 붙이기를 호스트가 한 트랜잭션으로 처리한다(리뷰 발견 — 따로 하면 작업은
    // 만들어졌는데 붙임에 실패해 원고 없는 고아 작업이 남을 수 있었다). 그래서 여기서 onAttach를
    // 따로 부르지 않는다 — 성공이면 이미 붙어 있다.
    const ok = await onCreateTask(campaignId, type);
    setCreating(false);
    if (!ok) return;   // 실패 문구는 호스트가 토스트로 말한다 — 팝오버는 열어 둬 재시도할 수 있게 한다
    close();
  }

  // 이미 있는(원고 없는) 작업에 붙이기 — onAttach는 완료 신호를 안 주는 fire-and-forget이라, 다음 틱에
  // 닫아 '붙이는 중' 표시가 최소 한 프레임은 보이게 한다.
  function attachExisting(taskId: string) {
    if (busyId) return;
    setBusyId(taskId);
    onAttach(taskId);
    setTimeout(close, 0);
  }

  // ── 붙어 있을 때 — 칩 하나로 "어느 캠페인의 무슨 작업인지" ──
  if (draft.taskId) {
    const typeLabel = draft.taskType ? TASK_TYPE_LABEL[draft.taskType] : '작업';
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-x-border-strong bg-white px-2.5 text-ui">
        <span className="text-x-secondary">작업:</span>
        {/* 캠페인 화면으로 — 예정일·비용·게시 확인은 전부 그쪽이 고치는 자리다 */}
        <Link href={`/campaigns?id=${draft.campaignId ?? ''}`}
              title="이 작업이 있는 캠페인 화면으로 — 예정일·비용은 거기서 고쳐요"
              className="font-bold text-x-blue-text hover:underline">
          {draft.campaignName ?? '캠페인'} · {typeLabel}{draft.influencerHandle ? ` @${draft.influencerHandle}` : ''} ↗
        </Link>
        <button type="button" onClick={onDetach}
                title="이 원고를 작업에서 떼요 — 작업도 원고도 지워지지 않아요"
                className="text-x-muted hover:text-red-600 hover:underline">떼기</button>
      </span>
    );
  }

  // ── 안 붙어 있을 때 — 붙이기 팝오버 ──
  return (
    <>
      <button ref={btnRef} type="button" onClick={() => (open ? close() : openPop())}
              aria-haspopup="dialog" aria-expanded={open}
              title="이 원고를 캠페인의 작업에 붙여요 — 붙이면 예정일·비용이 그 작업을 따라가요"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-x-border-strong bg-white px-2.5 text-ui text-x-muted hover:bg-x-hover hover:text-x-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-blue">
        작업에 붙이기 <span aria-hidden className="text-x-muted">⌄</span>
      </button>
      {open && createPortal(
        <div ref={popRef} role="dialog" aria-label="작업에 붙이기" style={{ top: pos.top, left: pos.left, width: POP_W }}
             onClick={(e) => e.stopPropagation()}
             className="fixed z-50 max-h-[80vh] overflow-y-auto rounded-xl border border-x-border-strong bg-white p-3 shadow-lg">
          <p className="text-ui font-bold">작업에 붙이기</p>
          <p className="mt-0.5 text-ui text-x-muted">캠페인의 작업 하나에 이 원고를 붙여요 — 예정일·비용은 그 작업에서 관리돼요</p>

          <label className="mt-2 block text-ui text-x-secondary">캠페인
            <select value={campaignId} autoFocus onChange={(e) => { setCampaignId(e.target.value); }}
                    className="mt-0.5 h-10 w-full rounded-md border border-x-border-strong bg-white px-2 text-content outline-none focus:border-x-blue">
              <option value="">고르세요</option>
              {openCampaigns.length > 0 && (
                <optgroup label="진행 중 · 예정">
                  {openCampaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              )}
              {showEnded && ended.length > 0 && (
                <optgroup label="종료">
                  {ended.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          {ended.length > 0 && !showEnded && (
            <button type="button" onClick={() => setShowEnded(true)}
                    className="mt-1 text-ui text-x-muted hover:text-x-secondary hover:underline">종료된 캠페인도 목록에 넣기</button>
          )}
          {openCampaigns.length === 0 && ended.length === 0 && (
            <p className="mt-1 text-ui text-x-muted">
              {draft.clientId === null
                ? '캠페인이 아직 없어요 — 캠페인 화면에서 먼저 만들어 주세요'
                : '이 클라이언트의 캠페인이 아직 없어요 — 캠페인 화면에서 먼저 만들어 주세요'}
            </p>
          )}

          {campaignId && (
            <div className="mt-2 border-t border-x-border pt-2">
              {shown === null ? (
                <p className="text-ui text-x-muted">작업을 불러오는 중…</p>
              ) : shown.error ? (
                <p role="alert" className="text-ui text-red-600">{shown.error}</p>
              ) : free.length === 0 ? (
                <p className="text-ui text-x-muted">원고 없는 작업이 없어요 — 아래에서 새 작업을 만들어요</p>
              ) : (
                <ul className="max-h-52 overflow-y-auto">
                  {free.map((t) => {
                    const busy = busyId === t.id;
                    return (
                      <li key={t.id}>
                        <button type="button" disabled={busyId !== null} onClick={() => attachExisting(t.id)}
                                className="flex w-full items-center gap-2 rounded-md px-1.5 py-2 text-left text-ui hover:bg-x-hover disabled:cursor-not-allowed disabled:opacity-50">
                          <span className="shrink-0 rounded-full border border-x-border-strong px-1.5 text-caption text-x-secondary">
                            {TASK_TYPE_LABEL[t.type]}
                          </span>
                          {busy ? (
                            <span className="flex-1 text-x-muted">붙이는 중…</span>
                          ) : (
                            <>
                              <span className="min-w-0 flex-1 truncate">
                                {t.influencerHandle ? `@${t.influencerHandle}` : <span className="text-x-muted">미배정</span>}
                              </span>
                              <span className="shrink-0 tabular-nums text-x-muted">
                                {t.scheduledOn ? formatDateKo(t.scheduledOn) : '예정일 미정'}
                              </span>
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-2 border-t border-x-border pt-2">
                <p className="text-ui text-x-secondary">새 작업 만들기</p>
                <p className="mt-0.5 text-ui text-x-muted">유형을 고르면 작업을 만들고 이 원고를 바로 붙여요</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {ATTACHABLE_TYPES.map((type) => (
                    <button key={type} type="button" disabled={creating} onClick={() => void createAndAttach(type)}
                            className="h-8 rounded-full border border-x-border-strong px-3 text-ui hover:bg-x-hover disabled:opacity-50">
                      {TASK_TYPE_LABEL[type]}
                    </button>
                  ))}
                  {creating && <span className="self-center text-ui text-x-muted">만드는 중…</span>}
                </div>
              </div>
            </div>
          )}
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={close} className="rounded-full px-3 py-1 text-ui text-x-secondary hover:bg-x-text/5">닫기</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
