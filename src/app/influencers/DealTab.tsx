'use client';
import { PricingSection } from './PricingSection';
import { PaymentSection } from './PaymentSection';
import type { InfluencerDetail } from '@/lib/influencerStore';

// 거래 정보 탭 — 협찬 단가 + 정산 결제 수단(얼마를 / 어디로). 로그는 부모 상태를 그대로 쓴다(스펙 §5):
// 여기서 값을 바꾸면 계정 정보 탭의 기록에도 같은 변경 이력이 곧바로 나타난다.
export function DealTab({ id, data, onChanged, setData, reportError }: {
  id: string; data: InfluencerDetail; onChanged: () => Promise<void>;
  setData: (fn: (d: InfluencerDetail | null) => InfluencerDetail | null) => void;
  reportError: (source: string, hasError: boolean) => void;
}) {
  return (
    <>
      {/* 단가 변경은 서버가 자동 로그를 남긴다 — 새 로그를 타임라인(계정 정보 탭) 맨 앞에 붙여 다시 부르지 않는다.
          patch는 그 요청이 실제로 바꾼 키만 담고 있으므로(PricingSection.save 참고) 다른 행의 병행
          PATCH 응답이 뒤섞여 도착해도 서로 다른 키끼리는 덮어쓰지 않고 병합만 된다 — 같은 키는
          busyKeys가 동시 전송 자체를 막아 직렬화한다. 다만 로그 prepend는 도착 순서대로라 병행 저장 시
          몇 ms 정도 시간순과 어긋나 보일 수 있으나(일시적 표시 문제) 감수한다. */}
      <PricingSection id={id} pricing={data.pricing} logs={data.logs}
                      onSaved={(patch, newLogs) => {
                        setData((d) => (d ? { ...d, pricing: { ...d.pricing, ...patch }, logs: [...newLogs, ...d.logs] } : d));
                        // 단가 저장은 auto 로그를 남겨 last_log_at이 바뀐다 — 명부(왼쪽)도 같이 움직여야 한다.
                        // 무변경 no-op(newLogs 0건)까지 명부를 새로고침할 필요는 없다.
                        if (newLogs.length > 0) onChanged();
                      }}
                      onErrorChange={(v) => reportError('pricing', v)} />
      {/* 응답의 paymentMethods는 배열 전체 스냅샷이라 그대로 교체한다(스펙 §2) — 단가와 달리 부분 병합이
          필요 없다: 연산이 id 단위라 서버가 행 잠금으로 직렬화하고, 마지막 응답이 곧 최신 상태다. */}
      <PaymentSection id={id} methods={data.paymentMethods}
                      onSaved={(paymentMethods, newLogs) => {
                        setData((d) => (d ? { ...d, paymentMethods, logs: [...newLogs, ...d.logs] } : d));
                        // 결제 수단 변경도 auto 로그를 남겨 last_log_at이 바뀐다 — 명부(왼쪽)도 같이 움직여야 한다.
                        if (newLogs.length > 0) onChanged();
                      }}
                      onErrorChange={(v) => reportError('payment', v)} />
    </>
  );
}
