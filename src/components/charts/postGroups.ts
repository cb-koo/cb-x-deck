// 게시 묶음 — 게시물 효과를 정직하게 세는 규칙(10-09 koo 질문 "같은 날 여러 게시물이면?" 반영).
// 신규 인입은 클리닉 전체의 하루 합계라 글 하나의 효과를 직접 잴 수 없다. 그래서:
// 1) 효과 창 = 게시 당일 + 다음 날. 창이 겹치는 글(게시일 차이 1일 이하)은 한 묶음으로 보고 인입 증가를 한 번만 센다.
// 2) 묶음 인입 증가 = 묶음 창(첫 게시일 ~ 마지막 게시일 다음 날) 신규 인입 합 − 평소 하루 × 창 일수.
// 3) 북마크가 minBookmarks 미만인 글은 영향이 작다고 보고 묶음 판단에서 뺀다(매일 올라오는 작은 글이 모든 날을 한 덩어리로 잇지 않게).
// 4) 묶음 안 글별 몫은 북마크 비율로 나눈 '추정'이다 — 화면에 반드시 '추정'으로 표기.

export type PostInput = { id?: string; handle: string; date: string; views: number; bookmarks: number }; // id: 누르면 글 상세를 여는 화면용(선택)
export type GroupPost = PostInput & { share: number; estLift: number };
export type PostGroup = { from: string; to: string; windowDays: number; inflow: number; lift: number; views: number; bookmarks: number; posts: GroupPost[] };

const DAY = 864e5;
const t = (d: string) => Date.parse(d + 'T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function groupPosts(posts: PostInput[], dailyByDate: Map<string, number>, typicalDay: number, minBookmarks = 50): PostGroup[] {
  const big = posts.filter((p) => p.bookmarks >= minBookmarks).sort((a, b) => t(a.date) - t(b.date));
  const groups: PostInput[][] = [];
  for (const p of big) {
    const g = groups[groups.length - 1];
    if (g && t(p.date) - t(g[g.length - 1].date) <= DAY) g.push(p); else groups.push([p]);
  }
  return groups.map((g) => {
    const from = g[0].date, last = g[g.length - 1].date;
    const end = t(last) + DAY;
    let inflow = 0, windowDays = 0;
    for (let d = t(from); d <= end; d += DAY) { inflow += dailyByDate.get(iso(d)) ?? 0; windowDays++; }
    const lift = Math.round(inflow - typicalDay * windowDays);
    const bm = g.reduce((s, p) => s + p.bookmarks, 0);
    return {
      from, to: iso(end), windowDays, inflow, lift,
      views: g.reduce((s, p) => s + p.views, 0), bookmarks: bm,
      posts: g.map((p) => ({ ...p, share: bm ? p.bookmarks / bm : 1 / g.length, estLift: Math.round(lift * (bm ? p.bookmarks / bm : 1 / g.length)) }))
        .sort((a, b) => b.bookmarks - a.bookmarks),
    };
  });
}
