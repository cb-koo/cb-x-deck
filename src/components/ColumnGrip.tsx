'use client';
import { GripIcon } from './XIcons';

/**
 * 컬럼 순서 변경 손잡이. hover에 숨기지 않고 상시 노출한다 — 숨기면 "끌 수 있다"를
 * 아무도 발견하지 못한다. 반대로 컬럼이 1개뿐이면 호출부에서 렌더하지 않는다(거짓 어포던스 금지).
 * 크기는 헤더의 기존 아이콘 버튼과 동일 규격(p-1.5 + 16px)을 따른다.
 */
export function ColumnGrip({ title, index, total, onPointerDown, onMove, tourAnchor }: {
  title: string;
  index: number;                       // 0-based
  total: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onMove: (delta: -1 | 1) => void;     // 키보드 한 칸 이동
  tourAnchor?: boolean;                // 첫 컬럼에만 — 투어가 이 손잡이를 가리킨다
}) {
  return (
    <span
      data-tour={tourAnchor ? 'col-reorder' : undefined}
      // "N개 중 M번째"라는 값을 화살표로 바꾸는 컨트롤 = slider가 정확한 역할이다(ARIA APG).
      // 덕분에 순서가 바뀌면 스크린리더가 aria-valuetext를 자동으로 읽어준다 — 호출부에 별도
      // 안내 장치(aria-live)를 두지 않아도 된다.
      // role="button"은 쓰지 않는다: Enter·스페이스가 먹힐 거라는 기대를 만드는데 이 손잡이는
      // 화살표로만 움직인다. 대신 roledescription으로 "슬라이더" 대신 사용자 말로 읽히게 한다.
      // role을 아예 비우는 것도 안 된다 — 역할 없는 포커스 요소는 스크린리더의 컨트롤 탐색에서
      // 아예 안 잡힌다(WCAG 4.1.2).
      role="slider"
      aria-roledescription="순서 변경 손잡이"
      tabIndex={0}
      title="끌어서 순서 변경"
      aria-label={`${title} 순서 변경 — 끌어서 옮기거나 화살표 키를 누르세요`}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={index + 1}
      aria-valuetext={`${total}개 중 ${index + 1}번째`}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        // 경계에서는 아무 일도 일어나지 않는다 — 헛도는 저장 요청을 막는다
        if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); onMove(-1); }
        if (e.key === 'ArrowRight' && index < total - 1) { e.preventDefault(); onMove(1); }
        // 포커스가 여기 있을 때 스페이스는 페이지를 스크롤한다 — 손잡이에선 아무 일도 없어야 한다.
        // (Enter는 막을 native 동작이 없어 넣지 않는다)
        if (e.key === ' ') e.preventDefault();
      }}
      className="shrink-0 cursor-grab touch-none rounded p-1.5 text-x-secondary hover:bg-x-text/5 hover:text-x-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-x-blue active:cursor-grabbing"
    >
      <GripIcon className="h-4 w-4" />
    </span>
  );
}
