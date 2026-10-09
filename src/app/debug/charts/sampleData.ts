// 차트 키트 샘플 데이터 — 2026-10-08~09 운영 데이터에서 뽑은 미모드림 집계값(개인정보 없음).
// 출처: 외부 리포트 일·주·월 스냅샷(신규 인입·상담·예약자), 우리 게시물 측정(조회·북마크), LINE 대시보드 일회성 분석(코호트).
import type { DayEvent, DayNote } from '@/components/charts/DayBarsChart';
import type { Bubble } from '@/components/charts/BubbleScatter';
import type { CohortRow } from '@/components/charts/CohortGrid';

const START = Date.UTC(2026, 7, 10); // 8/10 월
export const days = Array.from({ length: 56 }, (_, i) => new Date(START + i * 864e5).toISOString().slice(0, 10));
export const dailyInflow = [2,7,2,14,8,5,4,1,1,3,4,5,1,4,2,1,4,3,1,0,1,2,0,4,2,7,2,1,6,5,1,14,5,4,4,3,3,3,17,19,3,6,2,7,4,2,0,3,3,6,11,11,8,5,0,3];
export const dailyBand: [number, number] = [2, 5]; // 8주 하루값의 가운데 절반(25~75%)
export const dailySpike = 10; // 8주 하루값 상위 10% 경계 — 이보다 많은 날만 강조

const P: Array<[string, string, number, number, number]> = [ // 계정, 게시일, 조회, 좋아요, 북마크
  ['mpchan_a','2026-09-01',1055849,876,734], ['mtn4j','2026-09-02',36443,185,137], ['hinachan___','2026-09-02',4253,9,3],
  ['qni6f','2026-09-02',314035,1142,527], ['nasu_seikei','2026-09-03',6485,21,6], ['nasu_seikei','2026-09-08',5952,6,5],
  ['ddb6q6','2026-09-08',7207,24,14], ['taibanchan','2026-09-09',7510,6,10], ['chingcehansuki','2026-09-09',141845,1504,1058],
  ['Kity_0315','2026-09-16',14607,25,22], ['2024_0406','2026-09-16',21270,216,148], ['4nAtumilK_4HInE','2026-09-17',868970,5375,2661],
  ['dpsnll','2026-09-18',6699,22,18], ['mtn4j','2026-09-25',5036,22,5], ['omoochichi','2026-09-25',5233,30,10],
  ['akumachan_biyo','2026-09-26',3005,1,0], ['colorcleo','2026-09-27',94548,657,337], ['titin_and_co20_','2026-09-27',46,0,0],
  ['nako_beauty','2026-09-27',1857,12,2], ['minchannell','2026-09-28',9939,78,18], ['Purichan_seikei','2026-09-28',1006143,4955,2438],
  ['aik_ooooo','2026-09-29',3511,24,14], ['17dsy_','2026-09-29',4969,19,21], ['Purichan_seikei','2026-09-30',137674,1245,619],
];
const LABEL: Record<string, string> = { 'mpchan_a': 'mpchan_a · 인입 변화 없음', 'chingcehansuki': 'chingce', '4nAtumilK_4HInE': '4nAtumilK', 'Purichan_seikei|2026-09-28': 'Purichan' };
export const postEvents: DayEvent[] = P.map(([h, d, v, l, b]) => ({
  date: d, size: v, intensity: v ? Math.min(1, (b / v) / 0.0075) : 0,
  label: LABEL[`${h}|${d}`] ?? (v > 100000 && h !== 'Purichan_seikei' ? LABEL[h] : undefined),
  tip: [`@${h}`, `조회 ${v.toLocaleString('ko-KR')}`, `북마크 ${b.toLocaleString('ko-KR')}`, `좋아요 ${l.toLocaleString('ko-KR')}`],
}));
export const dayNotes: DayNote[] = [
  { date: '2026-09-18', text: '이틀간 36명', tone: 'up' },
  { date: '2026-09-29', text: '이틀간 17명', tone: 'up' },
];

// 게시물별: 게시 당일~다음 날 신규 인입 − 직전 14일 하루 평균 × 2
export const bubbles: Bubble[] = [
  { id: 'mp', x: 1055849, y: -0.6, size: 734, label: 'mpchan_a · 북마크 734', tip: ['@mpchan_a · 9/1', '조회 105.6만 · 북마크 734 (0.07%)', '인입 증가 −0.6명'] },
  { id: 'qn', x: 314035, y: 1.6, size: 527, tip: ['@qni6f · 9/2', '조회 31.4만 · 북마크 527', '인입 증가 +1.6명 (같은 날 mtn4j와 나눔)'] },
  { id: 'mt', x: 36443, y: 1.6, size: 137, tip: ['@mtn4j · 9/2', '조회 3.6만 · 북마크 137', '인입 증가 +1.6명 (같은 날 qni6f와 나눔)'] },
  { id: 'ch', x: 141845, y: 9.6, size: 1058, label: 'chingcehansuki · 북마크 1,058', strong: true, tip: ['@chingcehansuki · 9/9', '조회 14.2만 · 북마크 1,058 (0.75%)', '인입 증가 +9.6명'] },
  { id: '4n', x: 868970, y: 27.4, size: 2661, label: '4nAtumilK · 북마크 2,661', strong: true, tip: ['@4nAtumilK_4HInE · 9/17', '조회 86.9만 · 북마크 2,661 (0.31%)', '인입 증가 +27.4명'] },
  { id: 'cc', x: 94548, y: -1.9, size: 337, tip: ['@colorcleo · 9/27', '조회 9.5만 · 북마크 337', '인입 증가 −1.9명'] },
  { id: 'p1', x: 1006143, y: 6.3, size: 2438, label: 'Purichan 9/28 · 북마크 2,438', strong: true, tip: ['@Purichan_seikei · 9/28', '조회 100.6만 · 북마크 2,438 (0.24%)', '인입 증가 +6.3명'] },
  { id: 'p2', x: 137674, y: 6.7, size: 619, tip: ['@Purichan_seikei · 9/30', '조회 13.8만 · 북마크 619', '인입 증가 +6.7명'] },
];

export const weekCompare = {
  labels: ['월', '화', '수', '목', '금', '토', '일'],
  current: [6, 11, 11, 8, 5, 0, 3],   // 9/28~10/4 = 44명
  previous: [2, 7, 4, 2, 0, 3, 3],    // 9/21~9/27 = 21명
};

export const weeklyX = {
  labels: ['8/31', '9/7', '9/14', '9/21', '9/28'],
  bookmarks: [1407, 1087, 2849, 354, 3110],
  costPerBookmark: [313, 515, 86, 989, 100],
};

export const funnel = [ // 9월 vs 8월(월 스냅샷, 접수일 기준)
  { name: '신규 인입', count: 158, prevCount: 97, sub: 'LINE에 처음 말을 건 사람' },
  { name: '상담', count: 115, prevCount: 39, sub: 'CS가 문의·예약 상담으로 표시' },
  { name: '예약자', count: 26, prevCount: 24, sub: 'LINE 계정 기준' },
  { name: '방문', count: 9, prevCount: null, sub: '10/7 기준 · 19명은 방문 예정이라 8월과 비교하지 않음' },
];

export const cohortColumns = ['1일 안', '3일 안', '7일 안', '14일 안', '30일 안'];
export const cohortRows: CohortRow[] = [
  { label: '8/10 주', n: 42, cells: [19, 28.6, 35.7, 40.5, 40.5] },
  { label: '8/17 주', n: 19, cells: [15.8, 15.8, 15.8, 15.8, 21.1] },
  { label: '8/24 주', n: 12, cells: [41.7, 41.7, 41.7, 41.7, 41.7] },
  { label: '8/31 주', n: 18, cells: [27.8, 27.8, 44.4, 44.4, 44.4] },
  { label: '9/7 주', n: 39, cells: [35.9, 43.6, 48.7, 48.7, null] },
  { label: '9/14 주', n: 54, cells: [20.4, 27.8, 27.8, 29.6, null] },
  { label: '9/21 주', n: 21, cells: [14.3, 19, 38.1, null, null] },
  { label: '9/28 주', n: 44, cells: [27.3, 29.5, null, null, null] },
];

export const overview = [
  { name: '미모드림', weekly: [42, 19, 12, 18, 39, 54, 21, 44], band: [19, 42] as [number, number] },
  { name: '마인드스킨', weekly: [14, 23, 25, 16, 18, 13, 9, 19], band: [14, 20] as [number, number] },
  { name: '닥터손유나', weekly: [10, 10, 18, 8, 3, 6, 3, 14], band: [5, 11] as [number, number] },
];
