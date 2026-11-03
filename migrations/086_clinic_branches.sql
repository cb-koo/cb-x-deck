-- 086: 클리닉 지점 칸과 협찬 메모 — 벤자민 명동·신사 같이 한 클라이언트가 지점을 여럿 가질 때 쓴다.
-- 스펙: cb_x_extension docs/superpowers/specs/2026-11-02-benjamin-visit-sponsorship-design.md
-- 추가만 한다(AGENTS.md 마이그레이션 규칙) — 옛 코드는 새 칸을 모르고, 새 칸 기본값이 옛 행과 맞으므로 무해하다. 재실행 안전(멱등).
-- idx_clinic_location_client_main(본점 1곳 unique)은 일부러 남긴다. listClinics가 본점 행을 on conflict로 멱등 생성하는 데 쓰이므로,
-- 지우면 본점이 여러 번 만들어진다. 지점은 kind = 'branch'라 이 인덱스 밖이다.

-- 지점 종류 허용값을 넓힌다 — 기존 행은 전부 'main'이라 새 제약을 바로 통과한다.
alter table clinic_location drop constraint if exists clinic_location_kind_check;
alter table clinic_location add constraint clinic_location_kind_check check (kind in ('main', 'branch'));

-- 지점명·순서·사용 여부. 본점 행은 기본값(빈 이름·1번·사용)으로 그대로 맞는다.
alter table clinic_location add column if not exists name text not null default '';
alter table clinic_location add column if not exists position integer not null default 1;
alter table clinic_location add column if not exists active boolean not null default true;
create index if not exists idx_clinic_location_client_position on clinic_location (client_id, position);

-- 협찬 메모 — 클라이언트 단위 자유 기록. 기본값 ''이라 옛 행과 옛 코드 모두 무해하다.
alter table client add column if not exists sponsor_memo text not null default '';
