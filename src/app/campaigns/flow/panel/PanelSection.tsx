import type { ReactNode } from 'react';

// 작업 패널의 칸 하나 = 흰 상자 하나(설계 §4, 시안 B). 기존 작업·새 작업이 같은 래퍼를 써야 한쪽만 모양이 어긋나지 않는다.
// aside: 2단계용 — 소제목 옆 '· 이 작업에만 적용'(결제 수단 선택이 들어오면 붙인다). 1단계엔 쓰는 곳이 없다.
export function PanelSection({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-x-border bg-white px-4 py-3.5">
      {(title || aside) && (
        <div className="mb-2.5 flex items-center justify-between gap-2">
          {title && <h3 className="text-[14px] font-semibold text-x-secondary">{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
