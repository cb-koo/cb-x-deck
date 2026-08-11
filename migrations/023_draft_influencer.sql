-- 023: 원고에 인플루언서 배정 — X 핸들이 식별자(전역 유일한 자연키).
-- 이름 컬럼을 따로 두지 않는 이유: 담당자마다 표기가 갈라져 나중에 사람이 눈으로 짝지어야 한다.
-- null = 미배정. 향후 influencer 테이블이 생기면 이 값이 조인 키이자 스냅샷으로 남는다
-- (client_id + client_name 선례 — 엔티티가 지워져도 지난 원고의 배정 이력이 재현된다).
alter table draft add column if not exists influencer_handle text;
create index if not exists idx_draft_influencer on draft (influencer_handle);
