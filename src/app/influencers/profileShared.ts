import { useEffect, useRef } from 'react';

// 서버가 준 오류 문구를 그대로 쓴다 — 원인을 넘겨짚지 않는다(다섯 컴포넌트가 공유). 본체는 lib로 옮겼다(공용 결제 수단 폼도 쓴다).
export { errOf } from '@/lib/responseError';

// 숨은 탭(hidden 패널) 안의 저장 실패는 보이지 않는다(스펙 §3) — 컴포넌트가 자기 오류 유무를
// 부모에 알려 탭 라벨에 표식을 띄운다. 콜백은 ref로 들어 인라인 화살표라도 effect가 매 렌더 돌지 않는다.
export function useErrorReport(hasError: boolean, onErrorChange?: (v: boolean) => void): void {
  const ref = useRef(onErrorChange);
  useEffect(() => { ref.current = onErrorChange; });
  useEffect(() => { ref.current?.(hasError); }, [hasError]);
  useEffect(() => () => { ref.current?.(false); }, []);   // 사라지면 표식도 걷는다
}

// 프로필 오른쪽 영역의 면 문법 — 연회색 바닥(bg-x-surface, page.tsx) 위 흰 패널. 캠페인 상세(CampaignDetail.PANEL)와
// 같은 값이다: 간격·구분선만으로 나누던 섹션을 "공통 영역"으로 묶으면 처음 보는 사람도 어디까지가 한 덩어리인지
// 스크롤만으로 안다(koo 피드백: 캠페인 페이지의 이 문법이 가독성에 도움이 됐다). 패널 사이 간격은 부모의
// space-y-5 하나가 단일 출처 — 섹션이 각자 mt-7/border-t를 두지 않는다.
export const PANEL = 'rounded-xl border border-x-border bg-white p-5';
export const PANEL_TITLE = 'text-[16px] font-semibold';
