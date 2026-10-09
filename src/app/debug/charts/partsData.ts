// 기존 화면용 부품 샘플 데이터 — 2026-10-09 운영 집계값(개인정보 없음).
// 외부 리포트(미모드림 주간 7/13~9/28), 캠페인 작업(10월 2주차), 예산(더스퀘어치과 10월), 9월 작업 유형, 9월 게시물 북마크.

export const weeks = ['7/13', '7/20', '7/27', '8/3', '8/10', '8/17', '8/24', '8/31', '9/7', '9/14', '9/21', '9/28'];
export const inflow = [20, 22, 16, 22, 51, 37, 29, 42, 54, 81, 42, 64];        // 인입(기존 고객 포함)
export const newInflow = [6, 14, 11, 16, 42, 19, 12, 18, 39, 54, 21, 44];     // 신규 인입
export const consulted = [9, 7, 6, 3, 7, 12, 11, 24, 24, 25, 20, 36];
export const reservers = [0, 1, 0, 3, 7, 5, 9, 2, 6, 10, 2, 13];
export const followerChange: Array<number | null> = [null, null, null, null, null, null, null, 23, 47, 63, 25, 63]; // 8월 전 기록 없음
const total = [2, 4, 3, 6, 9, 8, 14, 5, 17, 20, 10, 20];
const cancelNoshow = [1, 2, 1, 3, 0, 1, 0, 0, 1, 2, 1, 1];
export const cancelRate = total.map((t, i) => (t >= 5 ? Math.round((cancelNoshow[i] / t) * 1000) / 10 : null)); // 예약 5건 미만 주는 비우기(표본 적음)
export const revFirst = [0, 109, 0, 109, 1033, 505, 1047, 139, 490, 1277, 369, 1929];  // 만원, 접수 기준
export const revRepeat = [0, 0, 0, 299, 0, 0, 0, 0, 0, 0, 0, 0];
export const newDiff = newInflow.slice(1).map((v, i) => v - newInflow[i]);

export const campaign = { posted: 4, assigned: 8, live: 8, spent: 360000, planned: 560000 }; // 더스퀘어치과 10월 2주차
export const budget = { total: 5000000, othersSpent: 660000, othersPending: 70000, thisSpent: 360000, thisPending: 200000 }; // 10월 기간 예산
export const campaignRows = [
  { name: '가은치유한의원_10월2주차', posted: 0, assigned: 5, live: 5 },
  { name: '더스퀘어치과_10월2주차', posted: 4, assigned: 8, live: 8 },
  { name: '미모드림_10월2주차', posted: 0, assigned: 0, live: 5 },
  { name: '백수약국_10월2주차', posted: 2, assigned: 6, live: 6 },
];
export const revenueSept = { first: 23709000, repeat: 1520000 }; // 미모드림 9월 방문일 기준

export const influencerBookmarks = [
  { label: 'Purichan_seikei', value: 3057, sub: '글 2개' },
  { label: '4nAtumilK_4HInE', value: 2661, sub: '글 1개' },
  { label: 'chingcehansuki', value: 1058, sub: '글 1개' },
  { label: 'mpchan_a', value: 734, sub: '글 1개' },
  { label: 'qni6f', value: 527, sub: '글 1개' },
  { label: 'colorcleo', value: 337, sub: '글 1개' },
];

export const taskTypes = [{ label: '인용RT', value: 88 }, { label: 'RT', value: 22 }, { label: '방문협찬', value: 2 }];

export const last7 = ['9/28', '9/29', '9/30', '10/1', '10/2', '10/3', '10/4'];
export const clientDaily = [
  { name: '미모드림', values: [6, 11, 11, 8, 5, 0, 3] },
  { name: '마인드스킨', values: [2, 4, 3, 5, 1, 3, 1] },
  { name: '닥터손유나', values: [3, 4, 1, 5, 1, 0, 0] },
];
