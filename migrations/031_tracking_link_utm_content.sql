-- 031: utm_content를 별도 컬럼으로 — {핸들}-{콘텐츠 구분}(koo 확정 08-25). 링크 주소(code)는 클릭하는 사람 눈에
-- 보이는 값이라 짧고 무의미하게, utm_content는 분석하는 사람 눈에 보이는 값이라 의미 있게 — 둘을 분리한다.
-- 중복 판정(같은 값이면 -2)을 위해 조회 가능해야 하므로 long_url 안에 묻어두지 않고 컬럼으로 둔다.
-- null = 분리 이전(코드=utm_content였던 링크).
alter table tracking_link add column if not exists utm_content text;
create index if not exists idx_tracking_link_utm_content on tracking_link (utm_content);
