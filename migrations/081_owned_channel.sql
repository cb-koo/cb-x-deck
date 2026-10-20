-- 081: X 업로드 현황 — 우리가 클라이언트에게 약속한 주 N회 업로드를 지키는지 본다.
-- 스펙 docs/superpowers/specs/2026-10-20-owned-channels-x-uploads-design.md §3
-- 추가만 한다(AGENTS.md 마이그레이션 규칙) — 새 테이블뿐이라 옛 코드는 모른다. 재실행 안전(멱등).

-- 클라이언트가 운영하는(우리가 운영을 맡은) 채널 계정. 지금은 X만 — 채널이 늘면 체크를 넓히고 같은 표에 줄이 는다.
create table if not exists owned_channel (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references client(id) on delete cascade,
  channel            text not null check (channel in ('x')),
  handle             text not null,                -- 표기 그대로(@ 없음)
  account_id         text not null,                -- X 숫자 id — 핸들을 다른 사람이 가져가도 같은 계정인지 가린다
  account_created_at timestamptz,                  -- 계정 개설일(그 전 주는 '—')
  weekly_target      int check (weekly_target between 1 and 14),  -- 지금 약속. null = 점검 안 함
  promise_started_on date,                         -- 약속 시작일(한국) — 그 날이 든 주부터 판정, 그 전 주는 글 수만 보인다
  last_collected_at  timestamptz,                  -- 마지막 성공
  last_error         text,                         -- 마지막 실패 사유(성공하면 null)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (client_id, channel)
);

-- 081을 고치기 전에 적용한 DB(연습용)도 맞춘다 — create table if not exists는 이미 있는 표에 칸을 더하지 않는다(리뷰 10-20)
alter table owned_channel add column if not exists promise_started_on date;

-- 읽어 온 글. 쌓이기만 한다 — X에서 지워져도 줄은 남고 deleted_at만 찍힌다. 횟수에는 그대로 들어간다(스펙 §4-3).
create table if not exists owned_post (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references owned_channel(id) on delete cascade,
  post_id     text not null,
  kind        text not null check (kind in ('original', 'quote', 'retweet', 'reply')),
  text        text not null default '',
  posted_at   timestamptz not null,
  deleted_at  timestamptz,                         -- X에서 지워진 것을 확인한 때(표시용). 다시 보이면 null
  created_at  timestamptz not null default now(),
  unique (channel_id, post_id)
);
create index if not exists owned_post_channel_time on owned_post (channel_id, posted_at desc);

-- 주마다 그 주의 약속. 주가 끝나면 손대지 않는다 — 지난 주 판정이 나중 약속 변경에 흔들리지 않게(스펙 §3).
-- target null = 그 주는 약속 없음(점검을 쉬었다) — 쉬는 동안을 못 채움으로 판정하지 않게.
create table if not exists owned_channel_week (
  channel_id  uuid not null references owned_channel(id) on delete cascade,
  week_start  date not null,                       -- 그 주 월요일(한국)
  target      int check (target between 1 and 14),
  primary key (channel_id, week_start)
);

alter table owned_channel_week alter column target drop not null;

-- 팔로워 기록. 하루 한 줄(한국 날짜) — 다시 받으면 그날 줄을 덮는다.
create table if not exists owned_channel_snapshot (
  channel_id   uuid not null references owned_channel(id) on delete cascade,
  captured_on  date not null,
  followers    int not null,
  captured_at  timestamptz not null default now(),
  primary key (channel_id, captured_on)
);
