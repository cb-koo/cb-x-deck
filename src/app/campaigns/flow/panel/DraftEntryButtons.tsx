import type { DraftTab } from '../draft/DraftMode';

// 원고가 비어 있을 때 세 입구(설계 §7·§10) — 글자 링크 대신 버튼 셋, AI로 만들기만 강조. 보조 글·도움말 없음.
export function DraftEntryButtons({ pickCount, onPick }: { pickCount: number | null; onPick: (tab: DraftTab) => void }) {
  const base = 'rounded-lg border px-2 py-2.5 text-content transition-colors';
  return (
    <div className="grid grid-cols-3 gap-2">
      <button type="button" onClick={() => onPick('generate')} className={`${base} border-x-blue bg-[#f0f8fe] font-semibold text-x-blue-text hover:bg-[#e3f2fd]`}>AI로 만들기</button>
      <button type="button" onClick={() => onPick('write')} className={`${base} border-x-border-strong hover:bg-x-hover`}>직접 쓰기</button>
      <button type="button" onClick={() => onPick('pick')} className={`${base} border-x-border-strong hover:bg-x-hover`}>
        있는 원고{pickCount !== null ? ` ${pickCount}` : ''}
      </button>
    </div>
  );
}
