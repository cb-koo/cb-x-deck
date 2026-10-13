import type { ReservationDeleteSummary } from '@/lib/taskDeletionStore';

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

// 예약 기록이 있는 작업을 지울 때의 확인 창(koo 10-13) — 무엇이 함께 지워지는지 적고, 되돌릴 수 없다는 것과 기록이 남는 곳을 알린다.
export function reservationDeleteMessage(s: ReservationDeleteSummary): string {
  const when = s.visitOn
    ? (() => {
        const [y, m, d] = s.visitOn.split('-').map(Number);
        const day = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
        return `${m}/${d}(${day})${s.visitTime ? ` ${s.visitTime}` : ''}`;
      })()
    : '방문일 미정';
  const lines = [
    `· 예약 ${when} · ${s.ended ? '종료됨' : s.confirmed ? '확정' : '대기 중'}`,
    ...(s.changes > 0 ? [`· 예약 변경 내역 ${s.changes}건`] : []),
    ...(s.ended ? ['· 예약 종료(취소·노쇼) 기록'] : []),
    ...(s.uploads > 0 ? [`· 예약에 올린 동의서 파일 ${s.uploads}개`] : []),
  ];
  return `이 작업에는 방문 예약 기록이 있어요. 작업을 지우면 아래 기록도 함께 지워져요.\n\n${lines.join('\n')}\n\n`
    + `지운 사람과 시각은 캠페인 아래 '삭제한 작업'에 남아요. 지우면 되돌릴 수 없어요 — 함께 지울까요?`;
}

export const confirmReservationDelete = (s: ReservationDeleteSummary): boolean => window.confirm(reservationDeleteMessage(s));
