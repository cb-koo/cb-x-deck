import { useEffect, useRef } from 'react';

// 서버가 준 오류 문구를 그대로 쓴다 — 원인을 넘겨짚지 않는다(다섯 컴포넌트가 공유)
export async function errOf(r: Response): Promise<string> {
  return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`;
}

// 숨은 탭(hidden 패널) 안의 저장 실패는 보이지 않는다(스펙 §3) — 컴포넌트가 자기 오류 유무를
// 부모에 알려 탭 라벨에 표식을 띄운다. 콜백은 ref로 들어 인라인 화살표라도 effect가 매 렌더 돌지 않는다.
export function useErrorReport(hasError: boolean, onErrorChange?: (v: boolean) => void): void {
  const ref = useRef(onErrorChange);
  useEffect(() => { ref.current = onErrorChange; });
  useEffect(() => { ref.current?.(hasError); }, [hasError]);
  useEffect(() => () => { ref.current?.(false); }, []);   // 사라지면 표식도 걷는다
}
