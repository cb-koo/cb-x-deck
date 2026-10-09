// 차트 키트 샘플 데이터 — 2026-10-08~09 운영 데이터에서 뽑은 미모드림 집계값(개인정보 없음).
// 출처: 외부 리포트 일·주·월 스냅샷(신규 인입·상담·예약자), 우리 게시물 측정(조회·북마크), LINE 대시보드 일회성 분석(코호트).
import type { DayEvent, DayNote } from '@/components/charts/DayBarsChart';
import type { Bubble } from '@/components/charts/BubbleScatter';
import type { CohortRow } from '@/components/charts/CohortGrid';
import { groupPosts, type PostGroup } from '@/components/charts/postGroups';
import { typical } from '@/components/charts/normal';

const START = Date.UTC(2026, 7, 10); // 8/10 월
export const days = Array.from({ length: 56 }, (_, i) => new Date(START + i * 864e5).toISOString().slice(0, 10));
export const dailyInflow = [2,7,2,14,8,5,4,1,1,3,4,5,1,4,2,1,4,3,1,0,1,2,0,4,2,7,2,1,6,5,1,14,5,4,4,3,3,3,17,19,3,6,2,7,4,2,0,3,3,6,11,11,8,5,0,3];
export const recordsFrom = '2026-08-31'; // 우리 게시 기록이 있는 첫 주

type Post = [string, string, number, number, number]; // 계정, 게시일, 조회, 좋아요, 북마크
const P: Post[] = [
  ['mpchan_a','2026-09-01',1055849,876,734], ['mtn4j','2026-09-02',36443,185,137], ['hinachan___','2026-09-02',4253,9,3],
  ['qni6f','2026-09-02',314035,1142,527], ['nasu_seikei','2026-09-03',6485,21,6], ['nasu_seikei','2026-09-08',5952,6,5],
  ['ddb6q6','2026-09-08',7207,24,14], ['taibanchan','2026-09-09',7510,6,10], ['chingcehansuki','2026-09-09',141845,1504,1058],
  ['Kity_0315','2026-09-16',14607,25,22], ['2024_0406','2026-09-16',21270,216,148], ['4nAtumilK_4HInE','2026-09-17',868970,5375,2661],
  ['dpsnll','2026-09-18',6699,22,18], ['mtn4j','2026-09-25',5036,22,5], ['omoochichi','2026-09-25',5233,30,10],
  ['akumachan_biyo','2026-09-26',3005,1,0], ['colorcleo','2026-09-27',94548,657,337], ['titin_and_co20_','2026-09-27',46,0,0],
  ['nako_beauty','2026-09-27',1857,12,2], ['minchannell','2026-09-28',9939,78,18], ['Purichan_seikei','2026-09-28',1006143,4955,2438],
  ['aik_ooooo','2026-09-29',3511,24,14], ['17dsy_','2026-09-29',4969,19,21], ['Purichan_seikei','2026-09-30',137674,1245,619],
];
const fmt = (n: number) => n.toLocaleString('ko-KR');
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const shortName = (h: string) => h.replace(/_4HInE$/, '').replace(/_seikei$/, '').replace(/hansuki$/, '');

// 같은 날 글은 한 원으로 — 크기 = 북마크 합. 이름표는 북마크 1,000 이상인 날에만(핵심 숫자 포함).
const byDay = new Map<string, Post[]>();
P.forEach((p) => byDay.set(p[1], [...(byDay.get(p[1]) ?? []), p]));
export const postEvents: DayEvent[] = [...byDay.entries()].map(([date, ps]) => {
  const top = [...ps].sort((a, b) => b[4] - a[4])[0];
  const bm = ps.reduce((s, p) => s + p[4], 0);
  return {
    date, weight: bm, count: ps.length,
    label: bm >= 1000 ? `${shortName(top[0])} 북마크 ${fmt(top[4])}` : undefined,
    tip: ps.map((p) => `@${p[0]} · 북마크 ${fmt(p[4])} · 조회 ${fmt(p[2])}`),
  };
});
export const dayNotes: DayNote[] = [
  { date: '2026-09-18', text: '이틀간 36명' },
  { date: '2026-09-29', text: '이틀간 17명' },
];

// 게시 묶음(postGroups.ts) — 효과 창(당일+다음 날)이 겹치는 글은 한 묶음, 인입 증가는 묶음마다 한 번. 북마크 50 미만 글은 제외.
export const typicalDay = typical(dailyInflow); // 3명
export const MIN_BOOKMARKS = 50;
const dailyMap = new Map(days.map((d, i) => [d, dailyInflow[i]]));
export const postGroupsData: PostGroup[] = groupPosts(P.map((p) => ({ handle: p[0], date: p[1], views: p[2], bookmarks: p[4] })), dailyMap, typicalDay, MIN_BOOKMARKS);
export const smallPostCount = P.filter((p) => p[4] < MIN_BOOKMARKS).length;
export const bubbles: Bubble[] = postGroupsData.flatMap((g) => g.posts.map((p) => ({
  id: p.handle + p.date, x: p.views, y: p.estLift, size: p.bookmarks, strong: p.estLift >= 9,
  label: p.bookmarks >= 1000 || p.views > 900000 ? `${shortName(p.handle)} · 북마크 ${fmt(p.bookmarks)}` : undefined,
  tip: [`@${p.handle} · ${md(p.date)}`, `조회 ${fmt(p.views)} · 북마크 ${fmt(p.bookmarks)}`,
    g.posts.length > 1 ? `인입 증가 추정 ${p.estLift > 0 ? '+' : ''}${p.estLift}명 (묶음 ${g.lift > 0 ? '+' : ''}${g.lift}명 중 북마크 ${Math.round(p.share * 100)}%)` : `인입 증가 ${p.estLift > 0 ? '+' : ''}${p.estLift}명`],
})));

export const weeks = ['8/10', '8/17', '8/24', '8/31', '9/7', '9/14', '9/21', '9/28'];
export const weeklyInflow = [42, 19, 12, 18, 39, 54, 21, 44];

export const weeklyX = {
  labels: ['8/31', '9/7', '9/14', '9/21', '9/28'],
  bookmarks: [1407, 1087, 2849, 354, 3110],
  costPerBookmark: [313, 515, 86, 989, 100],
};

export const funnel = [ // 9월 vs 8월(월 스냅샷, 접수일 기준)
  { name: '신규 인입', count: 158, prevCount: 97, sub: 'LINE에 처음 말을 건 사람' },
  { name: '상담', count: 115, prevCount: 39, sub: 'CS가 문의·예약 상담으로 표시' },
  { name: '예약', count: 26, prevCount: 24, sub: 'LINE 계정 기준 · 9월 실주 23건' },
  { name: '방문', count: 9, prevCount: 22, sub: '10/7 기준 · 19명은 아직 방문 전', inProgress: true },
];

export const cohortColumns = ['1일 안', '3일 안', '7일 안', '30일 안'];
export const cohortRows: CohortRow[] = [
  { label: '8/10 주', n: 42, cells: [19, 28.6, 35.7, 40.5] },
  { label: '8/17 주', n: 19, cells: [15.8, 15.8, 15.8, 21.1] },
  { label: '8/24 주', n: 12, cells: [41.7, 41.7, 41.7, 41.7] },
  { label: '8/31 주', n: 18, cells: [27.8, 27.8, 44.4, 44.4] },
  { label: '9/7 주', n: 39, cells: [35.9, 43.6, 48.7, null] },
  { label: '9/14 주', n: 54, cells: [20.4, 27.8, 27.8, null] },
  { label: '9/21 주', n: 21, cells: [14.3, 19, 38.1, null] },
  { label: '9/28 주', n: 44, cells: [27.3, 29.5, null, null] },
];

export const overview = [
  { name: '미모드림', weekly: [42, 19, 12, 18, 39, 54, 21, 44] },
  { name: '마인드스킨', weekly: [14, 23, 25, 16, 18, 13, 9, 19] },
  { name: '닥터손유나', weekly: [10, 10, 18, 8, 3, 6, 3, 14], note: '예약은 5주째 0건' },
];
