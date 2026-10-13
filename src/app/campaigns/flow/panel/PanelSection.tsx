'use client';
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui';

// 접었다 펴는 상자의 조종간(목업 x-extension shared.Section의 DisclosureControl) — 열림 여부와 토글은 부모가 쥔다
export type SectionDisclosure = { open: boolean; onToggle: () => void };

// 작업 패널의 칸 하나 = 흰 상자 하나(설계 §4, 시안 B). 기존 작업·새 작업이 같은 래퍼를 써야 한쪽만 모양이 어긋나지 않는다.
// aside: 칸 제목 줄 오른쪽 자리. 결제 수단의 '· 이 작업에만 적용'은 상자 제목이 아니라 '결제 수단' 소제목 옆에 붙는다(§10) — 지금 쓰는 곳 없음.
// disclosure(목업 x-extension Section): 있으면 제목 아래 요약 한 줄(summary)과 오른쪽 [펼치기 ⌄]/[접기 ⌃] 버튼이 생기고, 본문은 접힌 동안
// hidden으로 숨긴다(언마운트하지 않는다 — 치던 금액·링크가 접었다 펴도 남는다). actionLabel은 접혀 있을 때 버튼 글자('보기'·'관리'·'첨부' 등).
export function PanelSection({ title, aside, children, summary, disclosure, actionLabel = '보기', id }: {
  title?: string; aside?: ReactNode; children: ReactNode;
  summary?: ReactNode; disclosure?: SectionDisclosure; actionLabel?: string; id?: string;
}) {
  const contentId = useId();
  if (!disclosure) {
    return (
      <section id={id} className="rounded-xl border border-x-border bg-white px-4 py-3.5">
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
  // 접히는 상자는 위아래 여백이 조금 좁다(목업 .mock-summary-section 12px) — 접힌 상자가 줄줄이 쌓여도 패널이 길어지지 않게
  return (
    <section id={id} className="rounded-xl border border-x-border bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {title && <h3 className="text-[14px] font-semibold text-x-secondary">{title}</h3>}
          {/* 요약 줄 — 긴 글(원고 제목·메모)은 한 줄에서 자르고, 딱지는 그대로. 오류 문구는 span이 아니라 p로 둬 줄바꿈되게 한다 */}
          {summary && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-[1.5] text-x-secondary [&>span]:max-w-full [&>span]:truncate">
              {summary}
            </div>
          )}
        </div>
        {aside}
        <Button variant="ghost" aria-expanded={disclosure.open} aria-controls={contentId}
                aria-label={`${title ?? ''} ${disclosure.open ? '접기' : '펼치기'}`.trim()}
                onClick={disclosure.onToggle} className="shrink-0 whitespace-nowrap">
          {disclosure.open ? '접기' : actionLabel} <span aria-hidden>{disclosure.open ? '⌃' : '⌄'}</span>
        </Button>
      </div>
      <div id={contentId} hidden={!disclosure.open} className="mt-4">
        {children}
      </div>
    </section>
  );
}

// 요약 줄의 딱지(목업 Badge) — 회색이 기본, amber는 지금 챙겨야 하는 것('동의서 미첨부'·'결제 수단 미등록')
export function SectionBadge({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'amber' }) {
  return (
    <span className={`inline-flex shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-caption font-semibold ${tone === 'amber' ? 'bg-[#fff4dc] text-[#946100]' : 'bg-[#eef2f4] text-x-secondary'}`}>
      {children}
    </span>
  );
}
