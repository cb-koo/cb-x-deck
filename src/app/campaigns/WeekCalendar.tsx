'use client';
import { useState } from 'react';
import type { CampaignDraftItem, CampaignRow } from '@/lib/campaignStore';
import {
  isOutOfRange, formatDateKo, contentStage, matchesStageFilter, STAGE_LABEL,
  type ContentStage, type StageFilter,
} from '@/lib/campaignJudgment';
import { overdueDays, overdueSuffix, NO_SCHEDULE_LABEL } from '@/lib/campaignTableView';
import { weekColumns, weekBounds, isSingleWeek, prevWeek, nextWeek, clampWeek } from '@/lib/campaignCalendar';
import { draftLabel } from '@/lib/draftViews';
import { STATUS_STYLE, PUBLISHED_STYLE } from '@/components/DraftStatusChip';

// 주간 달력(스펙 §3-2) — 월~일 7열 + "예정일 미정"(오른쪽, 점선). 카드 = 제목(2줄 말줄임) · @핸들 · 단계 배지. 밀린 카드 빨간 막대 + "n일 지남",
// 오늘 헤더 파란 강조, 기간 밖 카드 "기간 밖" 배지. 카드를 끌어 열에 놓으면 예정일이 바뀐다(요일 ↔ 예정일 미정 포함) —
// 저장은 부모의 changeScheduledOn(PATCH scheduled_on, 낙관적 갱신 + 실패 시 원위치 + 토스트, §7). 새 의존성 없이 HTML5 DnD.
// 판정(밀림·기간 밖·단계)은 표와 같은 함수, 문구는 campaignTableView — 표와 달력이 다른 말을 하면 안 된다.
// 가독성: 날짜 헤더 18px·제목 15px(text-content)·보조 13px(text-ui)·카드 ≥48px(min-h-12)·열 간격 12px. text-caption(11px)은 쓰지 않는다.
const NONE = '__none__';   // 예정일 미정 열의 drop 키
// 단계 배지 색 — DraftStatusChip의 STATUS_STYLE/PUBLISHED_STYLE을 그대로 쓴다(표와 같은 소스, 리뷰 반영).
// 여기 배지는 '누를 수 없는' 읽기 전용이라 ⌄(펼침) 표시를 달지 않는다: 카드를 누르면 원고가 열리므로
// 칩까지 눌리는 것처럼 보이면 두 동작이 겹친다(거짓 어포던스).
const stageStyle = (stage: ContentStage) => (stage === 'published' ? PUBLISHED_STYLE : STATUS_STYLE[stage]);

export function WeekCalendar({ rows, campaign, today, filter, weekStart, onWeekChange, onOpenDraft, onChangeScheduledOn }: {
  rows: CampaignDraftItem[];
  campaign: CampaignRow; today: string;          // today = 서버 detail.today(서울)
  filter: StageFilter;                            // 상위 툴바의 단계 필터 — 표와 같은 값·같은 판정 함수(칩이 두 보기에서 같은 뜻이어야 한다)
  weekStart: string;                              // 보고 있는 주의 월요일 — 부모가 쥔다(initialWeekStart로 시작)
  onWeekChange: (weekStart: string) => void;
  onOpenDraft: (id: string) => void;
  onChangeScheduledOn: (d: CampaignDraftItem, next: string | null) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const bounds = weekBounds(campaign.startsOn, campaign.endsOn, rows.map((r) => r.scheduledOn));
  // 예정일을 지워 범위가 줄면 보고 있던 주가 밖으로 나갈 수 있다 — 가장 가까운 경계 주로 붙여 빈 달력에 갇히지 않게 한다
  const ws = clampWeek(weekStart, bounds);
  // 필터는 열에 담기는 카드에만 건다 — 넘김 범위(bounds)는 전체 원고로 계산한다.
  // 필터를 바꿀 때마다 ◀ ▶가 생겼다 사라지면 같은 캠페인인데 달력의 크기가 달라 보인다.
  const cols = weekColumns(rows.filter((d) => matchesStageFilter(d, filter)), ws, today);
  const prev = prevWeek(ws, bounds);
  const next = nextWeek(ws, bounds);

  // drop 대상 열 — 날짜 문자열 또는 null(예정일 미정). 같은 열에 놓으면 PATCH하지 않는다.
  function drop(e: React.DragEvent, target: string | null) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragId;
    setDragId(null); setOverKey(null);
    const d = rows.find((x) => x.id === id);
    if (!d || d.scheduledOn === target) return;
    onChangeScheduledOn(d, target);
  }
  const columnProps = (key: string, target: string | null) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overKey !== key) setOverKey(key); },
    // 열 안의 카드로 옮겨간 것뿐인데 강조가 꺼지면 깜빡인다 — 열 밖으로 나갔을 때만 끈다
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverKey((k) => (k === key ? null : k)); },
    onDrop: (e: React.DragEvent) => drop(e, target),
  });

  const card = (d: CampaignDraftItem) => {
    const od = overdueDays(d, today);
    const stage = contentStage(d);
    const unused = d.status === 'unused';
    return (
      // button이 draggable — 클릭은 원고 열기, 끌기는 예정일 변경. 텍스트 선택은 draggable이 막아 표의 opensCard 판정이 필요 없다.
      <button key={d.id} type="button" draggable
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', d.id); e.dataTransfer.effectAllowed = 'move'; setDragId(d.id); }}
              onDragEnd={() => { setDragId(null); setOverKey(null); }}
              onClick={() => onOpenDraft(d.id)}
              title="누르면 원고가 열려요 · 끌어서 다른 요일에 놓으면 예정일이 바뀌어요"
              className={`block w-full min-h-12 cursor-grab rounded-lg border px-3 py-2 text-left active:cursor-grabbing ${
                od !== null ? 'border-red-200 bg-red-50 shadow-[inset_3px_0_0_0_#dc2626]' : 'border-x-border bg-white hover:bg-x-hover'} ${
                unused ? 'opacity-60' : ''} ${dragId === d.id ? 'opacity-40' : ''}`}>
        <span className="line-clamp-2 text-content font-medium">{draftLabel(d).text}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-ui text-x-muted">
          <span>{d.influencerHandle ? `@${d.influencerHandle}` : '미배정'}</span>
          <span className={`rounded-full border px-2 py-0.5 font-bold ${stageStyle(stage)}`}>{STAGE_LABEL[stage]}</span>
          {od !== null && <span className="font-bold text-red-700">{overdueSuffix(od)}</span>}
          {isOutOfRange(d.scheduledOn, campaign.startsOn, campaign.endsOn) && (
            <span className="rounded bg-amber-100 px-1 text-amber-800" title="캠페인 기간 밖 날짜예요 — 저장은 되지만 표시로 알려요">기간 밖</span>
          )}
        </span>
      </button>
    );
  };
  const columnBox = (key: string, dashed = false) =>
    `flex min-h-[220px] flex-col gap-2 rounded-xl border p-2 transition-colors ${dashed ? 'border-dashed' : ''} ${
      overKey === key ? 'border-x-blue bg-x-blue/5' : 'border-x-border bg-x-surface/60'}`;
  const count = (n: number) => (n > 0 ? <span className="ml-1.5 text-ui font-normal text-x-muted tabular-nums">{n}</span> : null);

  return (
    <section className="mt-8">
      {/* 주 라벨('8/31~9/6 주')은 뺐다(QA 4라운드) — 아래 요일 헤더가 이미 날짜를 보여주므로 같은 정보가 두 번 나왔다.
          한 주에 다 들어가는 캠페인엔 ◀ ▶도 그리지 않는다 — 눌러도 갈 데가 없는 버튼은 거짓 어포던스다.
          라벨이 없어진 만큼 화살표의 이름은 aria-label·title로 남겨 무엇으로 넘기는지 알 수 있게 한다. */}
      {!isSingleWeek(bounds) && (
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => prev && onWeekChange(prev)} disabled={!prev} aria-label="이전 주" title="이전 주"
                  className="h-8 w-8 rounded-full border border-x-border-strong text-ui hover:bg-x-hover disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent">◀</button>
          <button type="button" onClick={() => next && onWeekChange(next)} disabled={!next} aria-label="다음 주" title="다음 주"
                  className="h-8 w-8 rounded-full border border-x-border-strong text-ui hover:bg-x-hover disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent">▶</button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="mt-4 rounded-xl border border-x-border bg-x-surface px-4 py-6 text-center text-content text-x-secondary">
          아직 이 캠페인에 원고가 없어요 — 위의 [+ 원고 추가]로 기존 원고를 넣거나 새로 만들어요.
        </p>
      ) : (
        <div className="mt-3 w-full overflow-x-auto">
          {/* 8열: 요일 7 + 예정일 미정. 최소 폭을 두어 좁은 창에서는 가로 스크롤 — 카드 글자를 줄이지 않는다(가독성 기준) */}
          <div className="grid min-w-[1080px] grid-cols-[repeat(7,minmax(0,1fr))_minmax(150px,0.9fr)] gap-3">
            {cols.days.map((col) => {
              const isToday = col.date === today;
              // formatDateKo가 '8/26 수' 한 덩어리라 날짜(18px)와 요일(13px)로 나눠 그린다 — 표기의 출처는 그대로 한 함수
              const [monthDay, dow] = formatDateKo(col.date).split(' ');
              return (
                <div key={col.date}>
                  <p className={`mb-2 flex items-baseline gap-1.5 px-1 ${isToday ? 'text-x-blue-text' : 'text-x-secondary'}`}>
                    <span className={`text-[18px] tabular-nums ${isToday ? 'font-bold' : 'font-semibold'}`}>{monthDay}</span>
                    <span className="text-ui">{dow}</span>
                    {isToday && <span className="rounded bg-x-blue/10 px-1.5 text-ui font-bold">오늘</span>}
                    {count(col.items.length)}
                  </p>
                  <div {...columnProps(col.date, col.date)} className={columnBox(col.date)} aria-label={`${formatDateKo(col.date)} 예정`}>
                    {col.items.map(card)}
                  </div>
                </div>
              );
            })}
            <div>
              <p className="mb-2 flex items-baseline px-1 text-content font-semibold text-x-secondary">
                {NO_SCHEDULE_LABEL}{count(cols.unscheduled.length)}
              </p>
              <div {...columnProps(NONE, null)} className={columnBox(NONE, true)} aria-label={NO_SCHEDULE_LABEL}>
                {cols.unscheduled.map(card)}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
