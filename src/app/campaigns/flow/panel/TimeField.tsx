'use client';
import { useState } from 'react';

// 방문협찬의 시간 한 칸(063, koo 09-29) — 날짜 칸(ScheduledOnField) 바로 아래에 붙는다. 분 단위 자유 입력, 비우면 '시간 미정'.
// 저장은 칸을 떠날 때(블러·Enter) 한 번 — 브라우저의 시간 칸은 시·분을 고칠 때마다 change가 와서, 그때마다 저장하면
// 반쯤 고친 값(14:0_)이 서버에 여러 번 간다. 새 작업 폼(commitOnChange)은 서버를 부르지 않으니 바로 올린다.
// 부모가 key={값}으로 준다 — 서버 값이 바뀌면(날짜를 지워 시간도 비워짐 등) 이 칸의 버퍼가 새 값으로 다시 시작한다
// (이펙트에서 setState로 맞추지 않는다).
export function TimeField({ value, ariaLabel, onCommit, commitOnChange }: {
  value: string | null;              // 'HH:MM' | null
  ariaLabel: string;                 // '방문 시간' · '게시 예정 시간'
  onCommit: (next: string | null) => void;
  commitOnChange?: boolean;
}) {
  const [buf, setBuf] = useState(value ?? '');
  const commit = (v: string) => { const next = v || null; if (next !== value) onCommit(next); };
  return (
    <span className="inline-flex items-center gap-2">
      <input type="time" step={60} value={buf} aria-label={ariaLabel} title={ariaLabel}
             onChange={(e) => { setBuf(e.target.value); if (commitOnChange) commit(e.target.value); }}
             onBlur={() => { if (!commitOnChange) commit(buf); }}
             onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur(); }}
             className="h-10 w-[128px] rounded-md border border-x-border-strong bg-white px-2 text-ui tabular-nums outline-none focus:border-x-blue" />
      {/* 빈 시간 칸은 '--:--'만 보여 뜻이 안 읽힌다 — 비워 둔 게 '미정'이라는 걸 글자로 말한다 */}
      {!buf && <span className="text-ui text-x-muted">시간 미정</span>}
    </span>
  );
}
