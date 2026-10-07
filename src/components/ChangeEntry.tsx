import type { ReactNode } from 'react';
import { kstMonthDayTimeKo } from '@/lib/datetime';

// 이력 한 행(스펙 2026-10-07 §8-6·§9) — `{M월 D일 HH:mm} · {이름}` / `{전} → {후}` / 출처 문장 / `사유: {사유}`.
// 작업 금액 변경 이력(작업 패널)과 정산 요청 개정 이력이 같은 모양을 쓴다 — 같은 종류의 기록이 화면마다 다르게 보이지 않게.
export function ChangeEntry({ at, by, change, source, reason, children }: { at: string; by: string; change: ReactNode; source?: string; reason?: string | null; children?: ReactNode }) {
  return (
    <li className="py-2">
      <p className="text-[14px] text-x-muted">{kstMonthDayTimeKo(at)} · {by}</p>
      <p className="text-content tabular-nums">{change}</p>
      {source && <p className="text-[14px] text-x-secondary">{source}</p>}
      {reason && <p className="text-[14px] text-x-secondary">사유: {reason}</p>}
      {children}
    </li>
  );
}
