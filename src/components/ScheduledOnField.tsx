'use client';
import { useEffect, useRef, useState } from 'react';
import { formatDateKo } from '@/lib/campaignJudgment';
import { NO_SCHEDULE_LABEL, overdueSuffix } from '@/lib/campaignTableView';

// 예정일 한 칸 — 읽기 상태는 '8/26 수 · 1일 지남' 글자뿐이고, 누르면 그 자리에서 편집 상태(달력 + '지우기')로 바뀐다.
// Atlassian Inline Edit 골격(읽기 뷰 클릭 → 편집 뷰, 커밋하면 다시 읽기 뷰) — 상시 ✕는 없앴다(QA 1라운드):
// 뜻이 안 보이는 아이콘이 모든 행에 떠 있었고, 지움은 편집 상태 안의 '지우기' 라벨 버튼(null 저장, §2-3 null=지움)으로 옮겼다.
// 밀림(overdueDays)·기간 밖(outOfRange) 판정은 호출부가 campaignJudgment로 계산해 넘긴다 — 이 칸은 게시됨 여부를 모른다.
export function ScheduledOnField({ value, overdueDays, outOfRange, onChange, compact, emptyLabel }: {
  value: string | null;          // 'YYYY-MM-DD' | null
  overdueDays: number | null;    // isOverdue면 daysBetweenDates(value, today), 아니면 null
  outOfRange: boolean;           // 캠페인 기간 밖 — 경고 표시만, 저장 차단 없음(§2-4)
  onChange: (next: string | null) => void;
  compact?: boolean;             // 표 셀 = 글자(15px), 카드 도구층 = 칩(32px, 13px)
  // 값이 없을 때 compact 자리에 쓰는 문구. 기본은 NO_SCHEDULE_LABEL('예정일 미정') — 방문협찬 칸처럼
  // 앞에 이미 '방문'·'게시'가 붙는 자리에서만 '미정'처럼 짧게 넘긴다(안 넘기면 '방문 예정일 미정 · 게시 예정일 미정'이 된다).
  emptyLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tone = overdueDays !== null ? 'font-bold text-red-700' : value ? 'text-x-text' : 'text-x-muted';

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // 클릭 한 번에 달력까지 — 읽기 뷰를 누른 제스처가 아직 살아 있는 동안 연다.
    // 미지원 브라우저(showPicker 없음)나 사용자 제스처 밖이면 그냥 입력칸만 열린 채로 둔다.
    try { el.showPicker?.(); } catch { /* 입력칸으로 직접 고칠 수 있으니 실패는 조용히 넘긴다 */ }
  }, [editing]);

  if (editing) {
    return (
      // 포커스가 이 묶음(입력 ↔ '지우기') 밖으로 나갈 때만 편집을 닫는다 — 입력에서 버튼으로 옮기다 닫히면 지우기를 못 누른다
      // compact(표 셀)는 py-1로 여유를 둬 h-10 입력이 들어가도 행이 48px 밑을 유지한다(표 자체 높이는 여기서 손대지 않는다)
      <span className={`inline-flex items-center gap-1.5 ${compact ? 'py-1' : ''}`}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEditing(false); }}>
        <input ref={inputRef} type="date" value={value ?? ''} aria-label="게시 예정일"
               onChange={(e) => { onChange(e.target.value || null); setEditing(false); }}
               onKeyDown={(e) => {
                 if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.stopPropagation(); setEditing(false); }   // 취소 — 모달까지 닫지 않는다
                 if (e.key === 'Enter' && !e.nativeEvent.isComposing) setEditing(false);
               }}
               className="h-10 rounded-md border border-x-border-strong bg-white px-2 text-ui outline-none focus:border-x-blue" />
        {value && (
          // mouseDown 기본동작(포커스 이동)을 막아야 blur → 편집 닫힘이 클릭보다 먼저 일어나지 않는다
          <button type="button" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange(null); setEditing(false); }}
                  title={`예정일을 지우면 달력의 '${NO_SCHEDULE_LABEL}' 열로 가요`}
                  className="flex h-10 shrink-0 items-center justify-center rounded-full px-3 text-content text-x-secondary hover:bg-red-50 hover:text-red-700">지우기</button>
        )}
      </span>
    );
  }

  // 읽기 상태 — hover 배경 + 클릭이 곧 편집(이건 '동작'이라 hover 신호를 둔다). 표 셀 안(compact)의 트리거는
  // 행 높이 48px가 이미 터치 타깃을 보장하므로 h-10 규칙에서 예외로 둔다 — 나머지(카드 도구층 등)는 h-10.
  const box = compact
    ? `rounded-md px-1.5 py-1 text-content ${tone}`
    : `h-10 rounded-lg border px-2.5 text-ui ${value ? 'border-x-border-strong bg-white' : 'border-dashed border-x-border-strong'} ${tone}`;
  return (
    <button type="button" onClick={() => setEditing(true)}
            title={value ? '게시 예정일 — 눌러서 바꾸기' : '게시 예정일을 정하면 밀림 여부를 알려줘요'}
            className={`inline-flex cursor-pointer items-center gap-1 text-left hover:bg-x-hover ${box}`}>
      <span className="tabular-nums">{value ? formatDateKo(value) : (compact ? (emptyLabel ?? NO_SCHEDULE_LABEL) : '+ 예정일')}</span>
      {overdueDays !== null ? <span className="font-normal">· {overdueSuffix(overdueDays)}</span> : null}
      {outOfRange && <span className="rounded bg-amber-100 px-1 text-ui font-normal text-amber-800" title="캠페인 기간 밖 날짜예요 — 저장은 되지만 표시로 알려요">기간 밖</span>}
    </button>
  );
}
