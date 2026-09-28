'use client';
import type { ReactNode } from 'react';
import type { InfluencerOption } from '@/lib/draftTypes';
import { Avatar } from '@/components/Avatar';
import { xDmTarget, openXDmWindow } from '@/lib/xDm';

// 배정된 인플 한 줄(설계 §6) — 사진 36px + 표시 이름 / @핸들. 이름이 없으면 @핸들 한 줄. 명부 밖이면 option이 없어 이니셜 원.
// note: 이름 줄 아래 짧은 주의 한 줄(예: '명부에 없음', §9·§10) — 주황.
// [DM](koo 09-28): 오른쪽에 붙는 작은 X 창으로 그 인플과의 대화를 연다(xDm.ts). 흐린 줄(취소된 작업 등)엔 두지 않는다.
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
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {!muted && <DmButton handle={handle} xUserId={option?.xUserId} />}
        {actions}
      </div>
    </div>
  );
}

function DmButton({ handle, xUserId }: { handle: string; xUserId?: string }) {
  const t = xDmTarget(handle, xUserId);
  const title = t.kind === 'dm'
    ? `X에서 @${handle}에게 DM — 화면 오른쪽 작은 창으로 열려요(창 크기는 끌어서 바꿀 수 있어요)`
    : 'X 숫자 ID가 명부에 없어 프로필을 열어요 — 프로필의 [메시지]를 눌러 주세요';
  return (
    <a href={t.url} target="_blank" rel="noreferrer" title={title}
       onClick={(e) => { e.preventDefault(); openXDmWindow(t.url); }}
       className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full border border-x-border-strong px-3 text-ui font-semibold text-x-text hover:bg-x-hover">
      {t.kind === 'dm' ? 'DM' : 'X 프로필'} <span aria-hidden className="text-x-muted">↗</span>
    </a>
  );
}
