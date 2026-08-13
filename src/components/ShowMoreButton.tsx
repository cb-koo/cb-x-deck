'use client';
import { remaining } from '@/lib/draftPaging';

// 남은 개수를 버튼에 적는 것이 이 컴포넌트의 존재 이유다(설계 §C).
// 잘렸다는 사실을 말하지 않는 목록은, 사용자가 "예전 거가 없네?"를 겪고도 원인을 알 수 없다.
// 카드·표·칸반이 같은 버튼을 쓴다 — 같은 성격의 "잘렸음"이 화면마다 다르게 보이면 안 된다.
export function ShowMoreButton({ total, shown, onMore }: {
  total: number; shown: number; onMore: () => void;
}) {
  const left = remaining(total, shown);
  if (left === 0) return null;
  return (
    <button type="button" onClick={onMore}
            className="mt-3 w-full rounded-lg border border-x-border-strong bg-white py-2 text-ui font-bold text-x-secondary hover:bg-x-hover">
      더 보기 <span className="font-normal text-x-muted">(남은 {left}건)</span>
    </button>
  );
}
