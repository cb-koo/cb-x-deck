'use client';
import Link from 'next/link';
import { InfoTip } from '@/components/InfoTip';
import { relTime } from '@/lib/relTime';
import { STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import type { DraftRollupItem } from '@/lib/influencerStore';

// 읽기 전용 상태 뱃지. 라벨·키는 lib(draftStatus)에서 오고 색만 여기서 정한다 — 색 규칙은
// DraftStatusChip과 같은 계열을 쓰되, 이 화면의 원고는 "고르는 것"이 아니라 "지나간 사실"이라
// 누를 수 있는 칩(select)으로 만들지 않는다(거짓 어포던스 방지).
const STATUS_BADGE: Record<DraftStatus, string> = {
  draft: 'border-x-border-strong bg-white text-x-secondary',
  review: 'border-amber-300 bg-amber-100 text-amber-800',
  approved: 'border-x-blue/40 bg-x-blue/10 text-x-blue-text',
  delivered: 'border-green-300 bg-green-100 text-green-800',
  unused: 'border-x-border-strong bg-x-border/40 text-x-muted',
};

// 전체 배정 수(draftCount)는 탭 배지가 말하고, 여기 목록은 최근 것만 온다 — 두 수가 다르면 그 사실을 적는다.
// (v1에서 "넘긴 원고 62"라 써놓고 50건만 나오던 자기모순을 여기서 해소한다)
export function ContentTab({ drafts, draftCount }: { drafts: DraftRollupItem[]; draftCount: number }) {
  return (
    <section className="mt-7 pt-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 className="text-content font-bold">넘긴 원고</h2>
        <InfoTip text="이 계정으로 배정한 원고를 모아 보여줘요. 원고를 누르면 콘텐츠 생성 화면에서 그 원고가 열려요." />
        {draftCount > drafts.length && (
          <span className="text-caption text-x-muted">· 최근 {drafts.length}건 표시</span>
        )}
      </div>
      {drafts.length === 0 ? (
        <p className="mt-1 text-ui leading-relaxed text-x-muted">아직 배정한 원고가 없어요 — 콘텐츠 생성에서 원고를 만들고 이 계정을 배정하면 여기 모여요.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {drafts.map((d) => (
            <li key={d.id}>
              <Link href={`/generate?draft=${d.id}`}
                    className="flex items-center gap-2 rounded-lg border border-x-border px-3 py-2 hover:bg-x-hover">
                <span className="min-w-0 flex-1 truncate text-ui">{d.title || '제목 없는 원고'}</span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-caption font-bold ${STATUS_BADGE[d.status]}`}>
                  {STATUS_LABEL[d.status]}
                </span>
                <span className="shrink-0 text-caption text-x-muted">{relTime(d.createdAt, '생성')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
