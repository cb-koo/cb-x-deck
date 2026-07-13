-- v1.6: 봤음(멤버별 seen) 추적 제거 → NEW 배지로 대체.
-- NEW = 직전 새로고침(prev_refreshed_at) 이후 컬럼에 새로 들어온 트윗(column_tweet.first_appeared_at 기준).
-- tweet_seen 테이블은 비파괴 원칙에 따라 유지하되 더 이상 사용하지 않음(추후 정리 가능).
alter table deck_column add column if not exists prev_refreshed_at timestamptz;
