// 콘텐츠 성과 자동 측정(2026-10-08 koo 결정) — 게시된 캠페인 게시물을 게시 시각 기준 정해진 시점마다 다시 잰다.
// 측정 시점은 '등록 시각'이 아니라 '실제 게시 시각'부터 센다 — 그래야 늦게 등록된 글의 24시간 조회수도 같은 기준이 된다.
// 등록이 늦어 이미 지난 시점은 건너뛴다(한 번 실행에 한 번만 잰다 — 밀린 시점을 몰아서 재지 않는다).
// 간격은 두 배씩(변화가 빠른 초반일수록 촘촘하게), 첫날 뒤로는 하루 한 번, 7일에서 멈춘다(7일이면 최종치의 96~99%).

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const CHECKPOINTS_MS: readonly number[] = [
  15 * MIN, 30 * MIN, 1 * HOUR, 2 * HOUR, 4 * HOUR, 8 * HOUR, 12 * HOUR, 1 * DAY,
  2 * DAY, 3 * DAY, 4 * DAY, 5 * DAY, 6 * DAY, 7 * DAY,
];
export const LAST_CHECKPOINT_MS = CHECKPOINTS_MS[CHECKPOINTS_MS.length - 1];

// 지금 재야 하는 시점(게시 후 경과 ms)을 돌려준다. 없으면 null.
// = 이미 지난 시점 중 가장 늦은 것이, 마지막 측정 뒤에 왔으면 그 시점. 수동 ↻로 그 뒤에 쟀다면 다시 재지 않는다.
export function dueCheckpoint(postedAt: Date, lastCapturedAt: Date | null, now: Date): number | null {
  const elapsed = now.getTime() - postedAt.getTime();
  let latest: number | null = null;
  for (const c of CHECKPOINTS_MS) if (c <= elapsed) latest = c;
  if (latest === null) return null;
  const pointAt = postedAt.getTime() + latest;
  if (lastCapturedAt && lastCapturedAt.getTime() >= pointAt) return null;
  return latest;
}

// X 게시물 번호(snowflake)에서 게시 시각을 꺼낸다 — tracked_post.posted_at이 비어 있을 때의 대체값.
export function tweetIdToDate(tweetId: string): Date | null {
  if (!/^\d{15,20}$/.test(tweetId)) return null;
  const ms = Number(BigInt(tweetId) >> BigInt(22)) + 1288834974657;
  return new Date(ms);
}
