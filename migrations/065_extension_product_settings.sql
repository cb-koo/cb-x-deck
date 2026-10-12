-- 웹과 확장이 함께 읽는 운영 설정. 샘플 데이터는 넣지 않는다.
alter table influencer add column if not exists note_version integer not null default 1;
alter table influencer add column if not exists pricing_version integer not null default 1;
create or replace function influencer_bump_product_versions() returns trigger language plpgsql as $$
begin
  new.note_version := old.note_version + case when old.note is distinct from new.note then 1 else 0 end;
  new.pricing_version := old.pricing_version + case when old.pricing is distinct from new.pricing then 1 else 0 end;
  return new;
end $$;
drop trigger if exists influencer_product_versions on influencer;
create trigger influencer_product_versions before update on influencer
  for each row execute function influencer_bump_product_versions();

create table if not exists clinic_settings (
  location_id uuid primary key references clinic_location(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_by uuid references member(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists clinic_template_revision (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references clinic_location(id) on delete cascade,
  kind text not null check (kind in ('form', 'sheet')),
  body text not null,
  revision integer not null,
  parser_compatible boolean not null default false,
  created_by uuid references member(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (location_id, kind, revision)
);
create table if not exists holiday_calendar_year (
  year integer primary key check (year between 2000 and 2200),
  names jsonb not null default '{}'::jsonb,
  source text not null,
  fetched_at timestamptz not null default now()
);
create table if not exists quick_message (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  language text not null check (language in ('KO', 'JA', 'EN')),
  body text not null,
  position integer not null default 0,
  active boolean not null default true,
  version integer not null default 1,
  updated_by uuid references member(id) on delete set null,
  updated_at timestamptz not null default now()
);
-- 업로드 요청도 예약과 같은 중복 방지·버전 계약을 쓴다. 파일은 기존 063 버킷에 저장한다.
create table if not exists reservation_agreement_upload (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references visit_reservation(id) on delete restrict,
  path text not null unique,
  name text not null,
  mime text not null,
  size integer not null check (size between 1 and 10485760),
  actor_id uuid not null references member(id),
  finalized_at timestamptz,
  created_at timestamptz not null default now()
);
alter table visit_reservation add column if not exists template_revision_id uuid references clinic_template_revision(id);

alter table visit_reservation enable row level security;
alter table reservation_change enable row level security;
alter table reservation_end enable row level security;
alter table clinic_location enable row level security;
alter table api_idempotency enable row level security;
alter table clinic_settings enable row level security;
alter table clinic_template_revision enable row level security;
alter table holiday_calendar_year enable row level security;
alter table quick_message enable row level security;
alter table reservation_agreement_upload enable row level security;
create table if not exists reservation_extraction_job (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references member(id),
  result jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour'
);
alter table reservation_extraction_job enable row level security;
