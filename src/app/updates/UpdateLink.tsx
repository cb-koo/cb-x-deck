'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LAST_WS_KEY, LAST_WS_CHANGED_EVENT } from '@/components/GlobalShell';
import { resolveHref, WS_TOKEN } from '@/lib/updates';

// 바로가기 링크. 워크스페이스 안 화면(href에 '{ws}')은 정적 페이지가 wsId를 모르므로
// 마지막 방문 워크스페이스(localStorage)로 치환한다. 값이 없으면 링크를 그리지 않는다 — 갈 곳 없는
// 링크를 보여주는 것이 거짓 어포던스(스펙 §3). 서버 렌더에서는 토큰 링크를 그리지 않고 마운트 뒤에만
// 그려서 하이드레이션 불일치를 피한다(스펙 §8). 첫 방문이 /updates면 GlobalShell이 워크스페이스를
// 아직 저장하기 전이라 값이 없을 수 있는데, LAST_WS_CHANGED_EVENT를 구독해 저장되면 다시 읽는다.
export function UpdateLink({ label, href }: { label: string; href: string }) {
  const needsWs = href.includes(WS_TOKEN);
  const [resolved, setResolved] = useState<string | null>(needsWs ? null : href);
  useEffect(() => {
    if (!needsWs) return;
    const resolve = () => setResolved(resolveHref(href, localStorage.getItem(LAST_WS_KEY)));
    resolve();
    // 첫 방문이 /updates면 GlobalShell이 워크스페이스를 아직 저장하기 전이라 값이 없다 — 저장되면 다시 읽는다
    window.addEventListener(LAST_WS_CHANGED_EVENT, resolve);
    return () => window.removeEventListener(LAST_WS_CHANGED_EVENT, resolve);
  }, [needsWs, href]);
  if (!resolved) return null;
  return (
    <Link href={resolved}
          className="mt-2.5 inline-block text-[15px] font-medium text-x-blue-text hover:underline">
      → {label}
    </Link>
  );
}
