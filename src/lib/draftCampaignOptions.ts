// DraftCard 캠페인 칸의 후보(스펙 §4-2) — 그 원고 클라이언트의 진행 중·예정 캠페인이 기본, 종료는 접힘("종료 캠페인 보기").
// 클라이언트 없는 원고는 전체 캠페인. 현재 소속 캠페인은 클라가 달라도 목록에 남긴다 — 값이 있는데 목록에 없으면 칩이 '없음'을 보인다.
import { campaignStatus } from './campaignJudgment.ts';

export function campaignOptionsFor<T extends { id: string; clientId: string | null; startsOn: string; endsOn: string }>(
  all: T[], clientId: string | null, today: string, currentId: string | null,
): { open: T[]; ended: T[] } {
  const mine = clientId === null ? all : all.filter((c) => c.clientId === clientId || c.id === currentId);
  return {
    open: mine.filter((c) => campaignStatus(c.startsOn, c.endsOn, today) !== 'ended'),
    ended: mine.filter((c) => campaignStatus(c.startsOn, c.endsOn, today) === 'ended'),
  };
}
