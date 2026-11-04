// 링크 없이 게시 확인(ISSUE-009, koo 11-04) — 투고·인용RT·방문협찬인데 게시물이 지워져 링크를 남길 수 없을 때.
// 새 칸 없이 기존 칸으로 나타낸다: 게시일(posted_at) + 링크 없음(post_url null) + 내림(removed_at = 확인한 날) + 지워진 이유(removed_reason, 필수).
// 그래서 "링크 없는 게시"는 늘 "이유가 있는 내림"과 함께 있다 — 근거 없는 게시 확인을 만들지 않는다(서버 linklessGateError가 지킨다).
// 정산에서는 링크 대신 이 이유를 요청 메모(note)로 정산팀에 보낸다(정산 API 칸 추가 없음).
// 화면·서버 공용 — 서버 import를 두지 않는다.
import type { TaskType } from './campaignJudgment.ts';

export const LINKLESS_REASON_REQUIRED_MESSAGE = '지워진 이유를 적어 주세요 — 정산 때 게시물 링크 대신 정산팀에 전달돼요';
export const LINKLESS_KEEP_REMOVED_MESSAGE = '링크 없이 게시 확인한 작업이에요 — 내림을 취소하거나 지워진 이유를 비울 수 없어요';

type TaskLike = { type: TaskType; postedAt: string | null; postUrl: string | null; removedAt: string | null; removedReason: string | null };

/** 링크 없이 게시 확인된 작업인가 — RT는 원래 자기 게시물이 없어 해당하지 않는다. */
export const isLinklessPosted = (t: TaskLike): boolean =>
  t.type !== 'rt' && !!t.postedAt && !t.postUrl && !!t.removedAt && !!(t.removedReason ?? '').trim();

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

/** 정산 요청 메모 — 링크 대신 정산팀이 읽는 한 줄. 링크 없는 게시가 아니면 null. */
export function linklessNote(t: TaskLike): string | null {
  if (!isLinklessPosted(t)) return null;
  return `[게시물 삭제] ${(t.removedReason ?? '').trim()} (게시 ${md(t.postedAt!)}, 지워짐 확인 ${md(t.removedAt!)})`;
}

/**
 * 게시 확인 패치의 링크 없는 경로 판정(라우트용 순수 함수) — "패치 후 상태"로 본다(proofGateError와 같은 이유).
 *  ① 링크 없이 게시 확인하려면 같은 요청에 내림 날짜와 이유가 있어야 한다.
 *  ② 이미 링크 없이 게시된 작업은 내림을 풀거나 이유를 비울 수 없다(링크를 붙이는 요청이면 괜찮다).
 * 링크가 있는 경로·RT·게시 확인과 무관한 패치는 null.
 */
export function linklessGateError(
  cur: TaskLike,
  patch: { postedAt?: string; postUrl?: string | null; removedAt?: string | null; removedReason?: string },
): string | null {
  if (cur.type === 'rt') return null;
  const after: TaskLike = {
    type: cur.type,
    postedAt: patch.postedAt !== undefined ? patch.postedAt : cur.postedAt,
    postUrl: patch.postUrl !== undefined ? patch.postUrl : cur.postUrl,
    removedAt: patch.removedAt !== undefined ? patch.removedAt : cur.removedAt,
    removedReason: patch.removedReason !== undefined ? patch.removedReason : cur.removedReason,
  };
  if (after.postUrl || !after.postedAt) return null;
  if (isLinklessPosted(after)) return null;
  // 여기부터는 링크 없는 게시가 이유 있는 내림 없이 남게 되는 패치
  if (isLinklessPosted(cur)) return LINKLESS_KEEP_REMOVED_MESSAGE;
  if (patch.postedAt !== undefined && !cur.postedAt) return LINKLESS_REASON_REQUIRED_MESSAGE;
  return null;   // 옛 데이터(게시됐는데 링크 없음)의 무관한 수정은 막지 않는다
}
