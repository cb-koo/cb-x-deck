// 표 보기가 쓰는 크기 상수. 서버(tweetStore)·API 라우트·클라이언트가 모두 여기서 가져온다 —
// 페이지 크기는 이미 tweetStore.PAGE_SIZE와 Column.tsx의 PAGE에 두 벌 있어(설계 §G),
// 표에서 사본을 더 만들지 않기 위해 한 곳에 둔다.
// tweetStore.ts를 클라이언트에서 import하면 서버 전용 모듈이 클라이언트 번들로 끌려오므로 상수만 분리한다.
export const TABLE_PAGE = 200;   // 한 번에 받는 행 수 (더보기 단위)
export const TABLE_MAX = 5000;   // CSV 저장이 한 번에 받는 상한 — 넘으면 잘렸다고 말한다
