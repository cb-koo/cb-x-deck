export type SortKey = 'views' | 'date' | 'bookmarks' | 'retweets';
export type ColumnKind = 'search' | 'watchlist';
export type ViewMode = 'new' | 'all';

export interface SearchConfig {
  keywords: string[];          // OR 조합
  minFaves?: number | null;
  sinceDate?: string | null;   // 'YYYY-MM-DD'
  untilDate?: string | null;
  lang?: string | null;        // 기본 'ja'
  imagesOnly?: boolean;        // 기본 true
  minViews?: number | null;    // 클라이언트 재필터
  maxPages?: number | null;    // 기본 3
  sort?: SortKey;              // 기본 'views'
}

export interface WatchlistConfig {
  handle: string;
  userId: string;              // 컬럼 생성 시 getUserInfo로 해석해 저장
  maxPages?: number | null;
  sort?: SortKey;
}

export interface ColumnRow {
  id: string;
  kind: ColumnKind;
  title: string;
  position: number;
  config: SearchConfig | WatchlistConfig;
  lastRefreshedAt: string | null; // ISO
}

export interface DeckMedia { type: string; url: string; videoUrl: string | null }
export interface DeckQuoted { id: string; text: string; userName: string | null }
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
  seenAt: string | null;
  isCandidate: boolean;
}

export interface CandidateRow {
  id: string;
  tweet: StoredTweet;
  memo: string;
  savedAt: string;
  sourceColumnId: string | null;
  tags: Array<{ id: string; name: string }>;
}
