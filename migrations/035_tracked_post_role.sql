-- 035: 게시물의 역할 — 한 원고에 게시물이 여럿일 때(스레드·링크 댓글) 어느 것이 '콘텐츠 조회'인지.
-- null = 자동 판정(읽기 시점, src/lib/postRole.ts). 값이 있으면 사람이 고친 것 — 자동 판정이 덮지 않는다.
-- 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md §역할 판정
alter table tracked_post add column if not exists role text check (role in ('main','thread','link'));
