'use client';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { kstMonthDayTimeKo } from '@/lib/datetime';
import { EXTERNAL_STATUS_LABEL } from '@/lib/settlementDisplay';
import { CARD, CARD_HEAD, CARD_META, ROW, ROW_KEY, DIVIDER } from './expandStyle';

// 펼침의 오른쪽 카드 — '정산팀이 보낸 결과'(10-07 koo QA 시안 A). 왼쪽 '우리가 보낸 요청'과 나란히 두어 어느 값이 누구 것인지 헷갈리지 않게.
// 지급 금액·환율은 위 요약 카드가 맡는다. 정산 상태 라벨은 settlementDisplay.ts가 유일한 출처.
export function PartnerResultBlock({ r }: { r: PaymentRequestRow }) {
  // "정산팀은 보냈다는데 우리 화면엔 없다" 조사가 시작되는 지점 — 호출 기록 링크는 결과가 없을 때도 보인다
  const logLink = (
    <a href={`/settlement?tab=log&request=${r.id}`} className="text-[14px] text-x-blue-text hover:underline">호출 기록 보기 →</a>
  );

  if (!r.externalStatus) {
    return (
      <section className={CARD}>
        <div className={CARD_HEAD}><h3 className="text-[16px] font-bold">정산팀이 보낸 결과</h3></div>
        <p className="text-content text-x-muted">정산팀이 아직 확인하지 않았어요</p>
        <div className="flex justify-end">{logLink}</div>
      </section>
    );
  }
  const paidNow = r.externalStatus === 'paid' && r.paidAt;
  return (
    <section className={CARD}>
      <div className={CARD_HEAD}>
        <h3 className="text-[16px] font-bold">정산팀이 보낸 결과</h3>
        <span className={CARD_META}>{kstMonthDayTimeKo(r.externalUpdatedAt)} 받음</span>
      </div>
      <div className="flex flex-col gap-2.5">
        <div className={ROW}>
          <span className={ROW_KEY}>정산 상태</span>
          <span><b className="font-semibold">{EXTERNAL_STATUS_LABEL[r.externalStatus]}</b>{paidNow ? ` · ${kstMonthDayTimeKo(r.paidAt)}` : ''}</span>
        </div>
        {/* 사람이 실행한 전이에만 담당자가 실려 온다(09-04). 자동 전이면 없다 — 줄을 그리지 않는다 */}
        {r.externalOperatorName && (
          <div className={ROW}><span className={ROW_KEY}>처리한 사람</span><span>{r.externalOperatorName}</span></div>
        )}
      </div>
      {r.externalNote && (
        <div className="flex flex-col gap-1 rounded-[10px] bg-amber-50 px-3.5 py-3">
          <span className="text-ui font-semibold tracking-[.02em] text-amber-800">정산팀 메모</span>
          <span className="text-content leading-normal">“{r.externalNote}”</span>
        </div>
      )}
      <div className={DIVIDER} />
      <div className="flex items-center justify-between gap-3 text-[14px]">
        <span className="min-w-0 break-all text-x-muted">{r.externalId ? `정산팀 건 번호 ${r.externalId}` : ''}</span>
        {logLink}
      </div>
    </section>
  );
}
