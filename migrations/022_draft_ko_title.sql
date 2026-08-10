-- 원고 제목(한국어 라벨) — 테이블·칸반 식별용. hash는 제목이 만들어진 버전의 draftVersionHash
--   (최신 버전과 불일치하면 표시하지 않는다 — 편집 후 낡은 제목 방지, koLatest와 동일 패턴)
-- 브리프는 파일명을 016_draft_ko_title.sql로 지정했으나, 저장소에 이미 016_draft_status.sql이
-- 존재해(021까지 진행됨) 번호가 겹친다 — 다음 번호(022)로 채번해 순번 유일성 관례를 지킨다.
alter table draft add column if not exists ko_title text;
alter table draft add column if not exists ko_title_hash text;
