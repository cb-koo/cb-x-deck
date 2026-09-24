import type { ReactNode } from 'react';
import type { InfluencerOption } from '@/lib/draftTypes';
import { Avatar } from '@/components/Avatar';

// 배정된 인플 한 줄(설계 §6) — 사진 36px + 표시 이름 / @핸들. 이름이 없으면 @핸들 한 줄. 명부 밖이면 option이 없어 이니셜 원.
// note: 이름 줄 아래 짧은 주의 한 줄(예: '명부에 없음', §9·§10) — 주황.
export function InfluencerSummary({ handle, option, muted = false, actions, note }: {
  handle: string; option: InfluencerOption | undefined; muted?: boolean; actions?: ReactNode; note?: string;
}) {
  const name = option?.name?.trim();
  return (
    <div className={`flex min-w-0 items-center gap-3 ${muted ? 'opacity-60' : ''}`}>
      <Avatar url={option?.avatarUrl} name={name || handle} size={36} />
      <div className="min-w-0">
        {name
          ? <><p className="truncate text-content font-semibold">{name}</p><p className="truncate text-ui text-x-secondary">@{handle}</p></>
          : <p className="truncate text-content font-semibold">@{handle}</p>}
        {note && <p className="text-ui text-amber-700">{note}</p>}
      </div>
      {actions && <div className="ml-auto flex shrink-0 items-center gap-3">{actions}</div>}
    </div>
  );
}
