'use client';
import { GripIcon } from './XIcons';

/**
 * 컬럼 순서 변경 손잡이. hover에 숨기지 않고 상시 노출한다 — 숨기면 "끌 수 있다"를
 * 아무도 발견하지 못한다. 반대로 컬럼이 1개뿐이면 호출부에서 렌더하지 않는다(거짓 어포던스 금지).
 * 크기는 헤더의 기존 아이콘 버튼과 동일 규격(p-1.5 + 16px)을 따른다.
 */
export function ColumnGrip({ title, index, total, onPointerDown, onMove }: {
  title: string;
  index: number;                       // 0-based
  total: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onMove: (delta: -1 | 1) => void;     // 키보드 한 칸 이동
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      title="끌어서 순서 변경"
      aria-label={`${title} 순서 변경 — 끌어서 옮기거나 화살표 키를 누르세요. ${total}개 중 ${index + 1}번째`}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        // 경계에서는 아무 일도 일어나지 않는다 — 헛도는 저장 요청을 막는다
        if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); onMove(-1); }
        if (e.key === 'ArrowRight' && index < total - 1) { e.preventDefault(); onMove(1); }
      }}
      className="shrink-0 cursor-grab touch-none rounded p-1.5 text-x-secondary hover:bg-x-text/5 hover:text-x-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-x-blue active:cursor-grabbing"
    >
      <GripIcon className="h-4 w-4" />
    </span>
  );
}
