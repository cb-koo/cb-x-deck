-- 016: 초안 상태 축 — "결정 진행도" 라벨 (스펙 2026-08-06-draft-trust-status-design.md §2)
-- 전이 제약 없음(워크플로 엔진이 아니라 자유 라벨): 검수 생략·담당자 직접 사용 등 모든 경로 수용.
-- draft=결정 없음(기본) · review=검수 대기 · approved=사용 확정 · delivered=인플루언서 전달됨 · unused=안 쓰기로 결정
alter table draft add column if not exists status text not null default 'draft'
  check (status in ('draft', 'review', 'approved', 'delivered', 'unused'));
