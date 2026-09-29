import type { ReactNode } from 'react';

// 날짜 + 시간을 한 상자 두 줄로(koo 09-29 '입력 필드가 깔끔하지 않다') — 따로 떨어진 날짜 알약·시간 칸·'시간 미정' 글자가
// 폭·높이가 제각각이라 한 쌍으로 안 읽혔다. 위 줄 날짜, 아래 줄 시간(날짜가 있을 때만 — 서버도 날짜 없는 시간은 받지 않는다).
// 가로로 붙이지 않는 이유: 날짜를 고칠 때의 입력칸 + [지우기]가 패널 반 폭(약 240px)을 넘는다.
export function DateTimeBox({ date, time, empty }: { date: ReactNode; time: ReactNode | null; empty: boolean }) {
  return (
    <div className={`overflow-hidden rounded-lg border bg-white focus-within:border-x-blue ${empty ? 'border-dashed border-x-border-strong' : 'border-x-border-strong'}`}>
      <div className="flex">{date}</div>
      {time && <div className="flex border-t border-x-border">{time}</div>}
    </div>
  );
}
