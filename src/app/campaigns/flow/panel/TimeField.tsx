'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

// 방문협찬의 시간 한 칸(063, koo 09-29) — DateTimeBox의 둘째 줄. 분 단위 자유 입력, 비우면 미정.
// 비어 있을 때 브라우저 기본 '--:-- --'를 그대로 보이지 않는다(뜻이 안 읽힌다, koo 09-29) — '🕑 시간 추가' 버튼을 두고,
// 누르면 그 자리에서 시간 칸이 열리며 선택기가 바로 뜬다. 값이 있으면 시간 칸 그대로(표시 형식은 브라우저 설정, koo 결정 유지).
// 저장은 칸을 떠날 때(블러·Enter) 한 번 — 브라우저의 시간 칸은 시·분을 고칠 때마다 change가 와서, 그때마다 저장하면
// 반쯤 고친 값(14:0_)이 서버에 여러 번 간다. 새 작업 폼(commitOnChange)은 서버를 부르지 않으니 바로 올린다.
// 부모가 key={값}으로 준다 — 서버 값이 바뀌면(날짜를 지워 시간도 비워짐 등) 이 칸의 버퍼가 새 값으로 다시 시작한다
// (이펙트에서 setState로 맞추지 않는다).
const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="h-4 w-4 shrink-0">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
);

export function TimeField({ value, ariaLabel, onCommit, commitOnChange }: {
  value: string | null;              // 'HH:MM' | null
  ariaLabel: string;                 // '방문 시간' · '게시 예정 시간'
  onCommit: (next: string | null) => void;
  commitOnChange?: boolean;
}) {
  const [buf, setBuf] = useState(value ?? '');
  const [open, setOpen] = useState(false);          // '시간 추가'를 눌러 빈 칸을 연 상태
  const inputRef = useRef<HTMLInputElement | null>(null);
  const commit = (v: string) => { const next = v || null; if (next !== value) onCommit(next); };

  // '시간 추가'를 누른 제스처가 살아 있는 동안 선택기를 연다(ScheduledOnField와 같은 방식). 미지원이면 입력칸만.
  useEffect(() => {
    if (!open) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    try { el.showPicker?.(); } catch { /* 입력칸으로 직접 고칠 수 있다 */ }
  }, [open]);

  if (!buf && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label={`${ariaLabel} 추가`}
              className="flex h-10 w-full items-center gap-2 px-3 text-left text-ui text-x-muted hover:bg-x-hover hover:text-x-secondary">
        <ClockIcon /> 시간 추가
      </button>
    );
  }
  return (
    <Row>
      <input ref={inputRef} type="time" step={60} value={buf} aria-label={ariaLabel} title={ariaLabel}
             onChange={(e) => { setBuf(e.target.value); if (commitOnChange) commit(e.target.value); }}
             onBlur={() => { if (!commitOnChange) commit(buf); if (!buf) setOpen(false); }}
             onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur(); }}
             // 초점 표시는 감싼 DateTimeBox의 파란 테두리(focus-within)가 한다 — 전역 :focus-visible 사각형이 안에 또 그려지지 않게(인라인이 레이어 밖 전역 규칙을 이긴다)
             style={{ outline: 'none' }}
             className="h-10 min-w-0 flex-1 bg-transparent text-ui tabular-nums" />
    </Row>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <span className="flex h-10 w-full items-center gap-2 px-3 text-x-secondary"><ClockIcon /><span className="flex min-w-0 flex-1 text-x-text">{children}</span></span>;
}
