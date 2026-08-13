-- 025: draft.influencer_handle에 lower() 표현식 인덱스 — 명부 기능의 세 술어가 공유
-- (influencerStore의 draft_count 서브쿼리·getInfluencerDetail 롤업·renameInfluencer 벌크 UPDATE가
--  전부 lower(influencer_handle) = lower(...) 조인이라, draft가 커지면 풀스캔이 목록 화면 N배로 곱해진다).
-- 023의 일반 인덱스는 대소문자 구분이라 이 술어에 쓰이지 않는다. 재실행 안전.
create index if not exists idx_draft_influencer_handle_lower on draft (lower(influencer_handle));
