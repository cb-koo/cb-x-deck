'use client';
import { useState, useRef } from 'react';
import type { CampaignTaskItem, CampaignRow } from '@/lib/campaignStore';
import {
  isOutOfRange, formatDateKo, taskStage, isTaskExcluded, matchesTaskFilter,
  TASK_STAGE_LABEL, TASK_TYPE_LABEL, type TaskStage, type StageFilter, type TaskType,
} from '@/lib/campaignJudgment';
import { taskOverdueDays, overdueSuffix, NO_SCHEDULE_LABEL } from '@/lib/campaignTableView';
import { weekRows, calendarGrid, dateAnchorLabel, type CalendarKind } from '@/lib/campaignCalendar';
import { TASK_STAGE_BAR_HEX, OVERDUE_BAR_HEX } from '@/components/DraftStatusChip';

// 달력 보기(스펙 §3-2) — "달력처럼 안 보인다"는 오너 피드백을 해부학 수준에서 고친 판(리서치 docs/research/calendar-view-ui-research-20260826.md §3, 대안 1).
// 바뀐 뼈대: ① 캠페인이 걸치는 주를 ◀ ▶ 없이 아래로 쌓는다(주 페이징 = "이번 주만 보이는 목록"처럼 읽힌다)
//   ② 요일 헤더는 격자 위에 한 번만 — 칸마다 큰 날짜 헤더를 반복하지 않는다 ③ 모든 칸을 아주 옅은 격자선으로 감싸고 높이를 고정한다
//   ④ 오늘은 칸 전체가 아니라 날짜 숫자에 파란 원 ⑤ 캠페인 기간 칸엔 옅은 틴트, 시작·끝 칸엔 상단 캡 선
//   ⑥ 기간 밖 날짜는 흐리게 + 드롭 대상 아님 ⑦ 카드는 단계 칩 대신 좌측 4px 색 바 + 아래 범례(색만으로 말하지 않게 범례를 붙인다).
//
// 달력의 단위는 작업(campaign_task)이다 — 원고가 아니라 "누구에게 맡긴 무엇"이 날짜를 갖는다.
// 방문협찬은 날짜가 둘이라 카드도 둘이다: 방문일 칸의 '방문' 카드와 게시 예정일 칸의 게시 카드(campaignCalendar.calendarGrid).
// 끌어 옮기면 그 카드가 가진 날짜만 바뀐다 — 방문 카드는 방문일, 게시 카드는 게시 예정일.
// '예정일 미정'은 8번째 요일 칸에서 빼내 격자 위 카드 섹션으로 올렸다(오너 결정) — 요일 칸과 같은 무게로 옆에 서 있으면 칸반처럼 읽힌다.
// 저장은 부모의 changeScheduledOn·changeVisitOn(PATCH, 낙관적 갱신 + 실패 시 원위치 + 토스트, §7). 새 의존성 없이 HTML5 DnD.
// 판정(밀림·기간 밖·단계)은 표와 같은 함수, 문구는 campaignTableView — 표와 달력이 다른 말을 하면 안 된다.
// 가독성: 카드 제목 15px(text-content)·보조 13px(text-ui)·날짜 앵커 13px. text-caption(11px)은 유형 칩(12px)만 예외로 둔다.
const NONE = '__none__';            // 예정일 미정 섹션의 drop 키
const MAX_CARDS = 3;                // 칸에 그대로 보여주는 카드 수 — 넘치면 '+N개'로 접는다(행 높이를 같게 유지, 리서치 §3-4)
// 격자선 = x-text(#0f1419) 9% 알파(#0f141917) — 구조는 잡되 카드와 경쟁하지 않는 선(Notion Calendar 관례).
// x-border(#eff3f4)는 카드 테두리와 같은 색이라 칸 경계가 카드에 묻힌다 → 칸 경계만 한 톤 진하게 둔다.
const GRID_LINE = 'border-[#0f141917]';
// 캠페인 기간 칸의 옅은 틴트 = x-blue 3% 알파 — 카드가 없는 날도 "이 구간이 캠페인"임을 말한다
const PERIOD_TINT = 'bg-[#1d9bf008]';
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
// 토·일은 배경이 아니라 글자색만 살짝 다르게(구글 캘린더·Ant Design 관례). x-muted 계열과 대비는 비슷한 톤으로 맞췄다.
const SAT_TEXT = 'text-[#5b7fae]';
const SUN_TEXT = 'text-[#c4576b]';
const dowText = (i: number) => (i === 5 ? SAT_TEXT : i === 6 ? SUN_TEXT : 'text-x-muted');
// 유형 칩 — 표(TaskTable)와 같은 색이라 표에서 달력으로 와도 같은 유형이 같은 색으로 읽힌다. 카드가 좁아 12px.
const TYPE_CHIP: Record<TaskType, string> = {
  post: 'bg-[#e8f0fe] text-[#1d4ed8]', quoteRt: 'bg-[#f3e8ff] text-[#7e22ce]', rt: 'bg-[#e6f6ee] text-[#15803d]', visit: 'bg-[#fff4e5] text-[#b45309]',
};
// 접힘 상태 기억 — 미정 섹션을 접어두는 건 작업 방식 선호라 기억한다([표 | 주간 달력] 저장 관례).
// 서버 렌더에서는 이 컴포넌트가 아예 안 그려진다(CampaignDetail은 로드 뒤에만 마운트) → hydration 불일치가 없다.
const COLLAPSE_KEY = 'campaign-unscheduled-collapsed';
function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}
function saveCollapsed(v: boolean) {
  try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* 저장 못 해도 화면은 동작 */ }
}
// 카드 좌측 바 색 = 단계색(밀림이면 빨강이 덮는다). 색의 단일 소스는 DraftStatusChip — 표의 칩과 갈라질 수 없다.
const barColor = (stage: TaskStage, overdue: boolean) => (overdue ? OVERDUE_BAR_HEX : TASK_STAGE_BAR_HEX[stage]);
// 범례 — 색만으로 단계를 말하지 않기 위해(색맹 접근성) 격자 아래에 점+이름을 함께 둔다.
// 작업의 단계는 원고 상태(초안·검수 대기·사용 확정·전달됨 — STATUS_LABEL)에 예정·방문 전·방문 완료·게시됨·내려짐이 더해진다(taskStage).
const LEGEND_STAGES: TaskStage[] = ['planned', 'visitPending', 'visited', 'draft', 'review', 'approved', 'delivered', 'published', 'removed'];
const LEGEND: Array<{ hex: string; label: string }> = [
  ...LEGEND_STAGES.map((s) => ({ hex: TASK_STAGE_BAR_HEX[s], label: TASK_STAGE_LABEL[s] })),
  { hex: OVERDUE_BAR_HEX, label: '밀림' },
];
// 카드 하나의 키 — 방문협찬은 같은 작업이 카드 둘이라 id만으로는 어느 카드를 끌었는지 알 수 없다
const cardKey = (id: string, kind: CalendarKind) => `${kind}:${id}`;

export function WeekCalendar({ rows, campaign, today, filter, onOpenDraft, onChangeScheduledOn, onChangeVisitOn }: {
  rows: CampaignTaskItem[];
  campaign: CampaignRow; today: string;          // today = 서버 detail.today(서울)
  filter: StageFilter;                            // 상위 툴바의 단계 필터 — 표와 같은 값·같은 판정 함수(칩이 두 보기에서 같은 뜻이어야 한다)
  onOpenDraft: (draftId: string) => void;
  onChangeScheduledOn: (t: CampaignTaskItem, next: string | null) => void;
  onChangeVisitOn: (t: CampaignTaskItem, next: string | null) => void;
}) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  // 드래그 진행 중 여부 — 드롭으로 카드가 다른 칸(다른 부모)으로 옮겨지면 원본 노드가 재마운트되어 dragend가 오지 않으므로
  // drop에서 직접 끝을 알린다. dragstart의 지연 setState는 이 ref가 켜져 있을 때만 반영한다(빠른 드래그에서 순서가 뒤집히지 않게).
  const draggingRef = useRef(false);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);          // '+N개'를 눌러 다 펼친 날짜들
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed());

  // 격자 뼈대는 전체 작업으로 계산한다 — 필터를 바꿀 때마다 주 행이 생겼다 사라지면 같은 캠페인인데 달력 크기가 달라 보인다.
  // 방문일도 넣는다: 기간 밖 방문일이어도 그 카드가 격자 어딘가에 있어야 손이 닿는다.
  const weeks = weekRows(campaign.startsOn, campaign.endsOn,
    rows.flatMap((r) => [r.scheduledOn, r.type === 'visit' ? r.visitOn : null]));
  const grid = calendarGrid(rows.filter((t) => matchesTaskFilter(t, filter, today)).filter((t) => !isTaskExcluded(t)), weeks, today);
  // 끌고 있는 카드(작업 + 무슨 날짜로 섰는지) — 미정 섹션을 내보일지 판단하는 데 쓴다
  const dragged = (() => {
    if (!dragKey) return null;
    const [kind, id] = [dragKey.slice(0, dragKey.indexOf(':')) as CalendarKind, dragKey.slice(dragKey.indexOf(':') + 1)];
    const task = rows.find((x) => x.id === id);
    return task ? { task, kind } : null;
  })();
  // 날짜가 붙은 카드를 끌고 있으면 미정 섹션이 비어 있어도 띠를 내보인다 — 놓을 곳이 없으면 '날짜 지우기'가 불가능해진다
  const showUnscheduled = grid.unscheduled.length > 0
    || (dragged !== null && (dragged.kind === 'visit' ? dragged.task.visitOn !== null : dragged.task.scheduledOn !== null));
  const inPeriod = (date: string) => !isOutOfRange(date, campaign.startsOn, campaign.endsOn);

  // drop 대상 — 날짜 문자열 또는 null(미정). 끈 카드가 가진 날짜만 바뀐다(방문 카드=방문일, 게시 카드=게시 예정일).
  // 같은 곳에 놓으면 PATCH하지 않는다.
  function drop(e: React.DragEvent, target: string | null) {
    e.preventDefault();
    const key = e.dataTransfer.getData('text/plain') || dragKey;
    setDragKey(null); setOverKey(null);
    if (!key) return;
    const kind = key.slice(0, key.indexOf(':')) as CalendarKind;
    const t = rows.find((x) => x.id === key.slice(key.indexOf(':') + 1));
    if (!t) return;
    if (kind === 'visit') {
      if (t.visitOn === target) return;
      onChangeVisitOn(t, target);
      return;
    }
    if (t.scheduledOn === target) return;
    onChangeScheduledOn(t, target);
  }
  const dropProps = (key: string, target: string | null) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overKey !== key) setOverKey(key); },
    // 안의 카드로 옮겨간 것뿐인데 강조가 꺼지면 깜빡인다 — 영역 밖으로 나갔을 때만 끈다
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverKey((k) => (k === key ? null : k)); },
    // ref 정리는 핸들러 안에서만(react-hooks/refs) — drop()은 렌더에서 만들어지는 함수라 ref를 건드리지 않는다
    onDrop: (e: React.DragEvent) => { draggingRef.current = false; drop(e, target); },
  });

  // 카드 — 흰 카드 + 좌측 4px 단계색 바. 단계 칩은 넣지 않는다(색 바 + 범례가 같은 말을 하고, 2줄 제목의 가독성을 지킨다).
  // 첫 줄: 유형 칩 + 원고 제목(없으면 @핸들). 둘째 줄: @핸들 · 방문 · 밀림 · 기간 밖.
  const card = (t: CampaignTaskItem, kind: CalendarKind, fixedWidth = false) => {
    // 밀림은 게시 예정일로만 판정한다(koo 결정) — 방문일 카드는 밀림을 말하지 않는다. taskOverdueDays가 보는 건
    // scheduledOn이라 방문 칸에 그대로 쓰면 '방문이 밀렸다'로 읽히는 빨간 카드가 된다. 색·테두리도 od에서 따라온다.
    const od = kind === 'visit' ? null : taskOverdueDays(t, today);
    const overdue = od !== null;
    const key = cardKey(t.id, kind);
    const who = t.influencerHandle ? `@${t.influencerHandle}` : '미배정';
    const date = kind === 'visit' ? t.visitOn : t.scheduledOn;
    const openable = t.draftId !== null;
    const dragTip = kind === 'visit' ? '끌어서 다른 날에 놓으면 방문일이 바뀌어요' : '끌어서 다른 날에 놓으면 게시 예정일이 바뀌어요';
    return (
      // div(role=button)이 draggable — <button draggable>은 실제 마우스로는 브라우저가 드래그를 시작하지 않아(koo QA 08-26,
      // 이벤트를 프로그램으로 쏘면 동작) 프로덕션 칸반(DraftKanban)과 같은 div 방식으로 둔다.
      // 누르면 원고가 열리는 건 원고가 붙은 작업뿐 — 없으면 role·hover도 주지 않는다(거짓 어포던스 방지).
      <div key={key} role={openable ? 'button' : undefined} tabIndex={openable ? 0 : undefined} draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', key); e.dataTransfer.effectAllowed = 'move';
                // dragstart 틱 안에서 상태를 바꾸면 리렌더로 원본 카드가 바뀌고(opacity·미정 띠 삽입으로 레이아웃 이동)
                // Chrome이 네이티브 드래그를 취소한다 — 칸반(DraftKanban)은 dragstart에서 상태를 안 바꾼다. 다음 틱으로 미룬다.
                draggingRef.current = true;
                window.setTimeout(() => { if (draggingRef.current) setDragKey(key); }, 0);
              }}
              onDragEnd={() => { draggingRef.current = false; setDragKey(null); setOverKey(null); }}
              onClick={openable ? () => onOpenDraft(t.draftId as string) : undefined}
              onKeyDown={openable
                ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDraft(t.draftId as string); } }
                : undefined}
              title={openable ? `누르면 원고가 열려요 · ${dragTip}` : dragTip}
              style={{ borderLeftColor: barColor(taskStage(t, today), overdue) }}
              className={`block cursor-grab rounded-md border border-l-4 px-2 py-1.5 text-left active:cursor-grabbing ${
                fixedWidth ? 'w-[220px] shrink-0' : 'w-full'} ${
                overdue ? 'border-y-red-200 border-r-red-200 bg-red-50' : 'border-y-x-border border-r-x-border bg-white'} ${
                openable ? (overdue ? 'hover:bg-red-100/60' : 'hover:bg-x-hover') : ''} ${
                dragKey === key ? 'opacity-40' : ''}`}>
        <span className="flex items-start gap-1.5">
          <span className={`mt-px shrink-0 rounded px-1.5 py-0.5 text-[12px] font-bold ${TYPE_CHIP[t.type]}`}>{TASK_TYPE_LABEL[t.type]}</span>
          <span className="line-clamp-2 text-content">{t.draftLabel ?? who}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-ui text-x-muted">
          {t.draftLabel && <span>{who}</span>}
          {kind === 'visit' && <span className="text-amber-800">· 방문</span>}
          {overdue && <span className="font-bold text-red-700">· {overdueSuffix(od)}</span>}
          {isOutOfRange(date, campaign.startsOn, campaign.endsOn) && (
            <span className="rounded bg-amber-100 px-1 text-amber-800" title="캠페인 기간 밖 날짜예요 — 저장은 되지만 표시로 알려요">기간 밖</span>
          )}
        </span>
      </div>
    );
  };

  if (rows.length === 0) {
    return (
      <section className="mt-3">
        <p className="rounded-xl bg-x-surface px-4 py-6 text-center text-content text-x-secondary">
          아직 이 캠페인에 작업이 없어요 — 위의 [+ 작업 추가]로 올려요.
        </p>
      </section>
    );
  }

  return (
    // mt-3 = 상위 툴바(세그먼트·칩)와의 간격만 — 섹션 간 간격은 CampaignDetail의 패널 사이 space-y-5가 쥔다(QA 7라운드)
    <section className="mt-3">
      {/* 예정일 미정 — 격자 위 카드 섹션(오너 결정). 요일 칸과 다른 모양(점선·가로 흐름)이라 "날짜 없는 것들의 자리"로 읽힌다.
          접어두면 다음에도 접힌 채로 열린다. 접혀 있어도 이 영역에 놓으면 날짜가 지워진다(제목 줄이 그대로 drop 대상). */}
      {showUnscheduled && (
        <div {...dropProps(NONE, null)}
             className={`mb-3 rounded-xl border border-dashed p-3 transition-colors ${
               overKey === NONE ? 'border-x-blue bg-x-blue/5' : 'border-x-border-strong bg-x-surface'}`}>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { const next = !collapsed; setCollapsed(next); saveCollapsed(next); }}
                    aria-expanded={!collapsed}
                    title={collapsed ? '펼쳐서 미정 카드를 봐요' : '접어서 달력에 집중해요'}
                    className="flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-[15px] font-semibold text-x-secondary hover:bg-x-hover">
              <span aria-hidden className="text-ui text-x-muted">{collapsed ? '▸' : '▾'}</span>
              {NO_SCHEDULE_LABEL} <span className="tabular-nums">· {grid.unscheduled.length}건</span>
            </button>
            <span className="text-ui text-x-muted">아래 달력의 날짜 칸으로 끌어다 놓으면 게시 예정일이 정해져요 · 방문 카드는 방문일이 정해져요</span>
          </div>
          {!collapsed && (
            grid.unscheduled.length > 0 ? (
              // 여기 카드는 '게시 예정일이 없는 작업'이다 — 끌어 놓으면 게시 예정일이 정해진다(방문일은 방문 카드가 쥔다)
              <div className="mt-2.5 flex flex-wrap gap-2">{grid.unscheduled.map((t) => card(t, 'post', true))}</div>
            ) : (
              // 끌고 있을 때만 나오는 빈 띠 — 여기 놓으면 그 카드의 날짜가 지워진다
              <p className="mt-2.5 rounded-lg border border-dashed border-x-border-strong bg-white px-3 py-4 text-center text-ui text-x-secondary">
                여기에 놓으면 날짜가 지워져요
              </p>
            )
          )}
        </div>
      )}

      <div className="w-full overflow-x-auto">
        <div className="min-w-[980px]">
          {/* 요일 헤더는 격자 전체에 한 번 — 칸마다 반복하지 않는 것이 "달력처럼 보임"의 첫 조건(리서치 §3-2) */}
          <div className={`grid grid-cols-7 rounded-t-lg border ${GRID_LINE} bg-x-surface`}>
            {WEEKDAYS.map((w, i) => (
              <div key={w} className={`border-r px-2.5 py-1.5 text-ui last:border-r-0 ${GRID_LINE} ${dowText(i)}`}>{w}</div>
            ))}
          </div>
          <div className={`grid grid-cols-7 rounded-b-lg border border-t-0 ${GRID_LINE} overflow-hidden`}>
            {grid.weeks.flatMap((week, wi) => week.map((cell, di) => {
              const isToday = cell.date === today;
              const period = inPeriod(cell.date);
              const isStart = cell.date === campaign.startsOn;
              const isEnd = cell.date === campaign.endsOn;
              const cap = isStart && isEnd ? '시작·끝' : isStart ? '시작' : isEnd ? '끝' : null;
              // 날짜 앵커 — 격자 첫 칸과 달이 바뀌는 칸만 '9/1'처럼 달을 붙인다(직전 칸은 읽는 순서상 바로 앞)
              const prev = di > 0 ? week[di - 1] : wi > 0 ? grid.weeks[wi - 1][6] : null;
              const anchor = dateAnchorLabel(cell.date, prev ? prev.date : null);
              const open = expanded.includes(cell.date);
              const shown = open ? cell.items : cell.items.slice(0, MAX_CARDS);
              const hidden = cell.items.length - shown.length;
              // 기간 밖 칸은 드롭 대상이 아니다 — hover 강조도 주지 않는다(놓을 수 없는데 반응하면 거짓 어포던스)
              const drops = period ? dropProps(cell.date, cell.date) : {};
              return (
                <div key={cell.date} {...drops}
                     aria-label={`${formatDateKo(cell.date)}${cap ? ` · 캠페인 ${cap}` : ''}${period ? '' : ' · 캠페인 기간 밖'}`}
                     className={`flex min-h-[150px] flex-col gap-1.5 p-2 transition-colors ${GRID_LINE} ${
                       di === 6 ? '' : 'border-r'} ${wi === grid.weeks.length - 1 ? '' : 'border-b'} ${
                       // 시작·끝 캡은 테두리가 아니라 inset 그림자다 — border-t를 더하면 그 행만 2px 높아져 '행 높이 동일'이 깨진다
                       cap ? 'shadow-[inset_0_2px_0_0_#1d9bf0]' : ''} ${
                       overKey === cell.date ? 'bg-x-blue/10' : period ? PERIOD_TINT : 'bg-white'}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-ui tabular-nums ${
                      isToday ? 'bg-x-blue font-bold text-white'
                        : period ? dowText(di) : 'text-x-muted/70'}`}>{anchor}</span>
                    {cap && <span className="ml-auto text-ui font-bold text-x-blue-text">{cap}</span>}
                  </div>
                  {shown.map((c) => card(c.task, c.kind))}
                  {hidden > 0 && (
                    <button type="button" onClick={() => setExpanded((cur) => [...cur, cell.date])}
                            className="rounded px-1 py-0.5 text-left text-ui text-x-secondary underline decoration-dotted hover:bg-x-hover">
                      +{hidden}개
                    </button>
                  )}
                  {open && cell.items.length > MAX_CARDS && (
                    <button type="button" onClick={() => setExpanded((cur) => cur.filter((x) => x !== cell.date))}
                            className="rounded px-1 py-0.5 text-left text-ui text-x-secondary underline decoration-dotted hover:bg-x-hover">
                      접기
                    </button>
                  )}
                </div>
              );
            }))}
          </div>
          {/* 범례 — 카드에서 단계 칩을 뺀 대신 색이 무슨 뜻인지 여기 한 줄로 말한다 */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-x-border pt-2.5">
            {LEGEND.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-ui text-x-secondary">
                <span aria-hidden style={{ background: l.hex }} className="h-2 w-2 shrink-0 rounded-full" />{l.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
