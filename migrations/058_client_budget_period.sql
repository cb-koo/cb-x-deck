-- 058: 클라이언트 예산 기간 (스펙 2026-09-22-budget-period-model-design §3)
-- 037의 월 단위 예산(monthly_budget/budget_overrides)을 완전히 대체한다. 이번 마이그레이션은 새 테이블만
-- 추가하고 037 컬럼은 건드리지 않는다(컬럼 삭제는 별도 2차 머지, §9). 겹침 방지에 daterange exclusion
-- constraint를 쓰므로 btree_gist가 필요하다. main은 057까지 — 머지 시 다른 활성 브랜치와 번호 충돌 확인.
create extension if not exists btree_gist;

create table if not exists client_budget_period (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  amount_krw int not null check (amount_krw >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_budget_period_range_check check (ends_on >= starts_on),
  constraint client_budget_period_no_overlap
    exclude using gist (client_id with =, daterange(starts_on, ends_on, '[]') with &&)
);
create index if not exists client_budget_period_client_idx on client_budget_period (client_id, starts_on desc);
