// 정렬 키. 덱 컬럼은 이 중 4종만 탭으로 노출하고(sortKeys.ts의 DECK_SORTS) 표 보기는 7종을 쓴다.
export type SortKey = 'views' | 'date' | 'bookmarks' | 'retweets' | 'likes' | 'replies' | 'quotes';
export type SortDir = 'asc' | 'desc';
export type ColumnKind = 'search' | 'watchlist';

export interface Workspace { id: string; name: string; position: number }
export interface Member { id: string; name: string; color: string }

export interface SearchConfig {
  keywords: string[];          // OR 조합
  minFaves?: number | null;
  minRetweets?: number | null;
  minReplies?: number | null;
  sinceDate?: string | null;   // 'YYYY-MM-DD'
  untilDate?: string | null;
  lang?: string | null;        // 기본 'ja'
  imagesOnly?: boolean;        // 기본 true
  minViews?: number | null;    // 클라이언트 재필터
  maxPages?: number | null;    // 기본 3
  sort?: SortKey;              // 기본 'views'
  dir?: SortDir;               // 정렬 방향, 기본 'desc'(높은 순/최신 순)
  width?: number | null;       // 컬럼 표시 폭(px), 드래그 리사이즈로 저장. 기본 400
}

export interface WatchlistConfig {
  handle: string;
  userId: string;              // 컬럼 생성 시 getUserInfo로 해석해 저장
  maxPages?: number | null;
  sort?: SortKey;
  dir?: SortDir;               // 정렬 방향, 기본 'desc'
  width?: number | null;
}

export interface ColumnRow {
  id: string;
  workspaceId: string;
  kind: ColumnKind;
  title: string;
  position: number;
  config: SearchConfig | WatchlistConfig;
  lastRefreshedAt: string | null; // ISO
}

export interface DeckMedia { type: string; url: string; videoUrl: string | null }
export interface DeckQuoted {
  id: string;
  text: string;
  userName: string | null;    // 표시 이름 (검색 응답 user.name)
  screenName: string | null;  // @핸들 (검색 응답 user.screen_name)
}
export interface DeckMetrics {
  views: number | null; likes: number | null; retweets: number | null;
  replies: number | null; quotes: number | null; bookmarks: number | null;
}

export interface DeckTweet {
  tweetId: string;
  authorHandle: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  authorFollowers: number | null;
  text: string;
  media: DeckMedia[];
  quoted: DeckQuoted | null;
  metrics: DeckMetrics;
  tweetUrl: string | null;
  tweetCreatedAt: string | null; // ISO
}

export interface StoredTweet extends DeckTweet {
  firstSeenAt: string;   // ISO
  lastFetchedAt: string; // ISO
  isNew: boolean;        // 직전 새로고침 이후 이 컬럼에 새로 들어온 트윗 (첫 새로고침 땐 전부 false)
  savedBy: Member[];     // 이 워크스페이스에서 이 트윗을 저장한 멤버들
  // 인용 트윗 보강: quoted_tweet 캐시(tweet/detail) 히트 시 전체 데이터가 실림
  quoted: (DeckQuoted & { enriched?: DeckTweet | null }) | null;
}

export interface CandidateRow {
  id: string;
  tweet: StoredTweet;
  memo: string;
  savedAt: string;
  sourceColumnId: string | null;
  tags: Array<{ id: string; name: string }>;
  member: Member;
  workspaceId: string;
}

// 트윗 본문(+인용) 한국어 번역 결과. 클라이언트/서버 공유.
export interface TweetTranslation {
  content: string;              // 본문 번역
  quotedContent: string | null; // 인용 트윗 본문 번역(없으면 null)
}

// 표 보기 한 행. StoredTweet을 쓰지 않는 이유: 표는 미디어·인용RT를 안 쓰는데
// CSV 저장은 최대 5,000행을 한 번에 받으므로 그 JSON이 페이로드를 크게 부풀린다.
export interface TableRow {
  tweetId: string;
  columnTitles: string[];        // 이 트윗이 걸린 열 이름들 (여러 열에 걸리면 여러 개)
  authorHandle: string;
  authorName: string | null;
  authorFollowers: number | null;
  text: string;
  tweetCreatedAt: string | null; // ISO
  metrics: DeckMetrics;
  savedBy: Member[];
  lastFetchedAt: string;         // ISO — 지표 기준 시각
}
