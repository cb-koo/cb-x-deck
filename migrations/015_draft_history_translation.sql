-- 015: 초안 버전 이력 + 번역 캐시
-- history: 재생성('이 트윗만 다시') 직전의 표시본(DraftContent) 스냅샷 배열 — ‹ 1/2 › 페이저로 열람.
--          생성 원본(content) 불변 원칙은 유지되며, history는 그 사이 버전들을 보존한다.
-- translation: 표시본(edited ?? content)의 한국어 번역 캐시 { sourceHash, posts[] } —
--              원문이 바뀌면 sourceHash가 어긋나 자동 재번역된다.
alter table draft add column if not exists history jsonb not null default '[]'::jsonb;
alter table draft add column if not exists translation jsonb;
