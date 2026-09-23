'use client';
import { useState } from 'react';

// 원형 프로필 사진 — 인플 명부·작업 패널 공용. X CDN 주소는 만료될 수 있어 불러오기 실패 시 이니셜로 바꾼다.
export function Avatar({ url, name, size }: { url: string | null | undefined; name: string; size: number }) {
  // 실패한 URL 자체를 기억한다(불리언이면 url이 나중에 바뀌어도 깨진 상태가 안 풀린다).
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const broken = !!url && failedUrl === url;
  const style = { width: size, height: size };
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- X CDN 원본 URL
      <img src={url} alt="" style={style} onError={() => setFailedUrl(url ?? null)} className="shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <span style={style} aria-hidden
          className="flex shrink-0 items-center justify-center rounded-full bg-x-border-strong font-bold text-white">
      <span style={{ fontSize: Math.round(size * 0.42) }}>{name.replace(/^@/, '').slice(0, 1).toUpperCase()}</span>
    </span>
  );
}
