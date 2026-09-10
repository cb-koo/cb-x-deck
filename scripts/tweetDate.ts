// 게시물 URL → 게시 시각. 트윗 ID(스노플레이크)의 상위 41비트가 밀리초 타임스탬프다.
// 슬랙에는 게시일이 없고 답글 시각은 모에카가 기록한 시점일 뿐이라(백수약국 3건은 답글 09-03·실제 게시 09-07~09-09)
// URL 자체에서 파생시킨다 — 값을 따로 적어두지 않으므로 표와 DB가 갈릴 수 없다.
//
// 검증(2026-09-10): getxapi `get_tweet_detail` 과 2건 대조해 분 단위까지 일치했다.
//   2096910045032362141 → 계산 09-07 19:34 / API "Mon Sep 07 10:34:48 +0000 2026"(UTC) = 서울 19:34 ✓
//   2097611408397787336 → 계산 09-09 18:01 / API "Wed Sep 09 09:01:46 +0000 2026"(UTC) = 서울 18:01 ✓

const TWITTER_EPOCH_MS = BigInt('1288834974657');

/** 게시물 URL에서 트윗 ID를 뽑는다. tweetPermalink 정규형(https://x.com/{handle}/status/{id})만 받는다. */
export function tweetId(postUrl: string): string | null {
  const m = /^https:\/\/x\.com\/[^/]+\/status\/(\d+)$/.exec(postUrl);
  return m ? m[1] : null;
}

/** 트윗 ID → 게시 시각(ms epoch). */
export function tweetPostedMs(id: string): number {
  return Number((BigInt(id) >> BigInt(22)) + TWITTER_EPOCH_MS);
}

/** 게시물 URL → 서울 기준 날짜 'YYYY-MM-DD'. campaign_task.posted_at 은 date 라 날짜만 쓴다. */
export function postedOnSeoul(postUrl: string): string | null {
  const id = tweetId(postUrl);
  if (id === null) return null;
  // sv-SE 로케일이 'YYYY-MM-DD HH:mm' 형태를 준다 — 직접 산술하지 않아 시간대 시프트가 없다
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(tweetPostedMs(id)));
  return s.slice(0, 10);
}

/** 화면 확인용 — 서울 기준 'YYYY-MM-DD HH:mm'. */
export function postedAtSeoul(postUrl: string): string | null {
  const id = tweetId(postUrl);
  if (id === null) return null;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(tweetPostedMs(id)));
}
