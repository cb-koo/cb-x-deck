import type { ReactNode } from 'react';
import type { FlowRow } from '@/lib/campaignFlowView';
import { formatDateKo, formatDateTimeKo } from '@/lib/campaignJudgment';
import { formatAmount } from '@/lib/campaignCost';
import { Button } from '@/components/ui';
import { PanelSection } from './PanelSection';

// 같은 방문의 게시물(089, ISSUE-016, koo 11-09) — 작업 패널의 세 자리.
// 방문 한 번 = 묶음 가격(예: 15,000엔에 게시물 2건)이라 금액은 원래 작업 하나에만 두고, 두 번째 게시물부터는 연결 작업이다.

const LINK = 'text-ui text-x-blue-text hover:underline';

// 원래 작업 패널 — 일정 상자 바로 아래. 연결된 게시물 작업 한 줄씩 + [게시물 하나 더](게시 여부와 상관없이, 결정 3)
export function SameVisitPostsBox({ task, linked, busy, onAdd, onOpen }: {
  task: FlowRow; linked: FlowRow[]; busy: boolean;
  onAdd: () => void; onOpen: (taskId: string) => void;
}) {
  const live = linked.filter((t) => !t.cancelledAt);
  return (
    <PanelSection title="같은 방문 게시물" aside={<Button onClick={onAdd} disabled={busy || !task.influencerHandle}>{busy ? '만드는 중…' : '게시물 하나 더'}</Button>}>
      {linked.length > 0 && (
        <ul className="mb-2 divide-y divide-x-border">
          <li className="flex h-11 items-center gap-3 text-content">
            <span className="w-[72px] shrink-0 text-x-secondary">게시물 1</span>
            <span className="min-w-0 flex-1 truncate">이 작업{task.cost ? `, ${formatAmount(task.cost.amount, task.cost.currency)}` : ''}</span>
            <span className="shrink-0 text-ui text-x-secondary">{task.postedAt ? `${formatDateKo(task.postedAt)} 게시` : '게시 전'}</span>
          </li>
          {linked.map((t, i) => (
            <li key={t.id} className="flex h-11 items-center gap-3 text-content">
              <span className="w-[72px] shrink-0 text-x-secondary">{t.cancelledAt ? '취소' : `게시물 ${live.indexOf(t) + 2}`}</span>
              <span className={`min-w-0 flex-1 truncate ${t.cancelledAt ? 'text-x-muted line-through' : ''}`}>{t.draftLabel ?? `연결 작업 ${i + 1}`}, 비용 없음</span>
              <span className="shrink-0 text-ui text-x-secondary">
                {t.cancelledAt ? '' : t.postedAt ? `${formatDateKo(t.postedAt)} 게시` : t.scheduledOn ? `${formatDateKo(t.scheduledOn)} 예정` : '예정일 미정'}
              </span>
              <button type="button" onClick={() => onOpen(t.id)} className={`shrink-0 ${LINK}`}>열기</button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-ui text-x-muted">
        {!task.influencerHandle && <>인플루언서를 먼저 배정해 주세요. </>}
        이 방문으로 게시물이 더 있으면 눌러요. 비용 없는 작업이 하나 더 생기고, 방문 수는 그대로예요.
        {live.length > 0 && task.cost ? ` 성과의 조회당 비용은 ${formatAmount(task.cost.amount, task.cost.currency)}을 게시물 ${live.length + 1}건에 나눠 계산해요.` : ''}
      </p>
    </PanelSection>
  );
}

// 연결 작업 패널의 일정 상자 — 예약 상자 대신. 방문은 원래 작업의 값을 그대로 보여 주고(정정돼도 어긋나지 않게), 게시 예정일만 고친다
export function SameVisitScheduleBox({ original, ordinal, scheduledEditor, onOpenOriginal }: {
  original: FlowRow | null; ordinal: number | null; scheduledEditor: ReactNode; onOpenOriginal: () => void;
}) {
  const visit = original?.visitOn ? formatDateTimeKo(original.visitOn, original.visitTime) : null;
  return (
    <PanelSection title="일정">
      <div className="flex items-start justify-between gap-3">
        <p className="text-content">
          같은 방문의 {ordinal ? `${ordinal}번째 ` : ''}게시물이에요.
          <br /><span className="text-ui text-x-secondary">예약과 방문은 원래 작업에서 관리해요.</span>
        </p>
        {original && <button type="button" onClick={onOpenOriginal} className={`shrink-0 ${LINK}`}>원래 작업 열기</button>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-ui text-x-muted">방문</p>
          <p className="mt-0.5 text-content">{visit ?? <span className="text-x-muted">원래 작업에 방문일 없음</span>}</p>
        </div>
        <div>
          <p className="text-ui text-x-muted">게시 예정일</p>
          <div className="mt-0.5">{scheduledEditor}</div>
        </div>
      </div>
    </PanelSection>
  );
}

// 연결 작업의 협찬 동의서 — 파일은 원래 작업에 하나만 둔다(복사하지 않는다)
export function SameVisitAgreementLine({ original }: { original: FlowRow | null }) {
  return (
    <PanelSection title="협찬 동의서">
      <p className="text-content">{original?.agreement ? '원래 작업에 있어요.' : <span className="text-x-secondary">원래 작업에 아직 없어요.</span>}</p>
    </PanelSection>
  );
}

// 연결 작업의 예산 · 정산 본문 — 비용 없음 고정(체크박스를 그리지 않는다, 바꿀 수 없는 값이라)
export function SameVisitCostLine({ original, total }: { original: FlowRow | null; total: number | null }) {
  const cost = original?.cost;
  return (
    <p className="text-content">
      비용 없음, 같은 방문의 원래 작업에서 정산해요.
      {cost && total ? <span className="text-x-secondary"> 조회당 비용은 {formatAmount(cost.amount, cost.currency)}을 게시물 {total}건에 나눠 계산해요.</span> : null}
    </p>
  );
}
