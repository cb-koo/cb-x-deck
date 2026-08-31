'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { TASK_PROOF_BUCKET } from '@/lib/taskProof';

const EXPIRES_IN = 86400; // 24시간 — 탭을 켜둔 채 다음 날 열면 넘길 수 있다. 그때는 새로고침으로 해결한다.

// 경로 배열 → { 경로: 서명 URL }. 입력 크기와 무관하게 고정된 개수의 상태·이펙트만 쓴다(useSignedMedia.ts
// 참고: 행 수가 렌더마다 바뀌어도 훅 호출 횟수가 변하지 않아야 한다 — 아니면 React가
// "Rendered fewer hooks than expected"로 죽는다). paths 배열 자체는 호출부(부모)가 매 렌더 새로
// 만들 수 있으므로, 정렬·중복제거한 내용을 문자열 하나(key)로 접어 그걸 진짜 의존성으로 쓴다.
// unique는 key에서 다시 계산하므로 의존성과 계산 대상이 정확히 일치해 disable 없이도 정확하다.
export function useSignedTaskProofUrls(paths: string[]): Record<string, string> {
  const [signed, setSigned] = useState<Record<string, string>>({});
  const requestedRef = useRef<Set<string>>(new Set());

  const key = Array.from(new Set(paths.filter(Boolean))).sort().join('|');
  const unique = useMemo(() => (key ? key.split('|') : []), [key]);

  useEffect(() => {
    const need = unique.filter((p) => !requestedRef.current.has(p));
    if (need.length === 0) return;
    need.forEach((p) => requestedRef.current.add(p));
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.storage.from(TASK_PROOF_BUCKET).createSignedUrls(need, EXPIRES_IN);
      if (error || !data) return; // 실패하면 썸네일만 안 보인다 — 화면은 계속 쓸 수 있어야 한다
      const next: Record<string, string> = {};
      data.forEach((row, i) => { if (row.signedUrl) next[need[i]] = row.signedUrl; });
      if (Object.keys(next).length) setSigned((cur) => ({ ...cur, ...next }));
    })();
    // cleanup에서 취소하지 않는다 — useSignedMedia.ts의 함정과 같다(StrictMode 이중 실행 시 취소하면
    // 서명 요청이 영영 안 간다). 결과는 경로→URL 캐시일 뿐이라 늦게 와도 틀리지 않는다.
  }, [unique]);

  return signed;
}
