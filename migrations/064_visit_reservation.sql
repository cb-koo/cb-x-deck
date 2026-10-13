-- 064: 방문 예약 — 웹·익스텐션이 같이 쓰는 저장 모델 (계획 docs/superpowers/plans/2026-10-04-extension-product-api-implementation.md §5)
-- 추가만, 전 문장 멱등(scripts/apply-migrations.sh가 전 파일을 재실행한다). 이 파일만으로는 아무 화면도 바뀌지 않는다 —
-- 실제 쓰기 경로는 공통 product API에 있으며 070 적용 전에는 새 저장을 비활성화한다. 추가 컬럼은 기본값으로 기존 INSERT·UPDATE와 호환된다.
--
-- 070(원래 065 — 머지 시 rename)에서 추가하는 것: 클리닉 운영시간·안내·양식 revision, 공휴일 달력(제공처 미정),
-- 빠른 메시지(채택 미정), 인플루언서 단가·메모 version, 예약 파싱 job.

-- ─────────────────────────── campaign_task 추가 ───────────────────────────
alter table campaign_task
  add column if not exists no_cost            boolean not null default false,                 -- 명시적 '비용 없음'. 금액 0·null과 다르다 — 기존 0/null을 자동 이관하지 않는다
  add column if not exists version            integer not null default 1,                     -- If-Match용. 아래 트리거가 모든 UPDATE에서 올린다
  add column if not exists visit_completed_at timestamptz,                                    -- 수동 방문 완료(당일). 날짜로 파생되는 자동 방문과 구분
  add column if not exists visit_completed_by uuid references member(id) on delete set null;
comment on column campaign_task.no_cost is '비용 없음(064). true면 게시 확인으로 완료, 정산 후보 제외. 활성 정산 요청 중 변경 금지(앱)';
comment on column campaign_task.version is '행 버전(064). campaign_task_version 트리거가 실제 변경이 있는 UPDATE마다 +1';

-- version은 스토어가 직접 올리지 않고 트리거가 올린다. 이유: 기존 쓰기 경로(PATCH·취소·복원·게시 확인·교체·원고 부착·개명)가
-- 열 곳이 넘고, 하나라도 빠뜨리면 낡은 화면의 저장이 충돌 검사를 통과해 최신 값을 덮는다. 값이 같은 UPDATE는 올리지 않는다.
create or replace function campaign_task_bump_version() returns trigger language plpgsql as $$
begin
  new.version := old.version + 1;
  return new;
end $$;
drop trigger if exists campaign_task_version on campaign_task;
create trigger campaign_task_version before update on campaign_task
  for each row when (old.* is distinct from new.*) execute function campaign_task_bump_version();

-- ─────────────────────────── 클리닉 본점 ───────────────────────────
-- client당 본점 1곳(지점 추가·접수 ON/OFF는 이번 범위 밖). 행은 설정 화면·예약 등록이 처음 필요할 때 멱등 생성한다 —
-- 샘플 주소·운영시간은 넣지 않는다. 클라이언트를 지우면 같이 지워지지만, 예약이 참조 중이면 아래 restrict가 막는다.
create table if not exists clinic_location (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references client(id) on delete cascade,
  kind       text not null default 'main' check (kind in ('main')),
  created_at timestamptz not null default now()
);
create unique index if not exists idx_clinic_location_client_main on clinic_location (client_id) where kind = 'main';

-- ─────────────────────────── 예약 ───────────────────────────
-- visit 작업당 예약 최대 1개. 캠페인·상대는 task에서 결정(여기 중복 저장하지 않음).
-- 삭제 보호: task·location을 restrict로 참조한다 — 캠페인 삭제(campaign_task cascade)·작업 삭제·클라이언트 삭제가
-- 예약 기록을 조용히 지우는 대신 FK 위반(23503)으로 실패한다. 화면 안내 문구는 쓰기 경로 작업(WEB 6)에서 붙인다.
create table if not exists visit_reservation (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references campaign_task(id) on delete restrict,
  location_id         uuid not null references clinic_location(id) on delete restrict,
  source_text         text not null default '',                                -- 고객 응답 원문. 날짜 수정으로 바꾸지 않는다
  sheet_text          text not null,                                           -- 담당자가 저장한 최종 기재 시트(원형 보존)
  fields              jsonb not null default '{}'::jsonb,                      -- 서버가 시트에서 검증한 조회용 값. 시트와 따로 편집하는 API 없음
  confirmed_at        timestamptz,                                             -- 확정 행동의 감사 시각(별도 방문 일시가 아니다). null = 대기
  confirmed_by        uuid references member(id) on delete set null,
  deadline_mode       text not null default 'default' check (deadline_mode in ('default', 'manual')),
  create_operation_id text,                                                    -- 생성 요청 ID — idempotency 보관 기한이 지나도 같은 생성이 두 번 되지 않게 영구 unique
  version             integer not null default 1,                              -- 스토어가 저장마다 +1 (모든 쓰기가 reservation command를 거친다)
  created_by          uuid references member(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_by          uuid references member(id) on delete set null,
  updated_at          timestamptz not null default now()
);
create unique index if not exists idx_visit_reservation_task on visit_reservation (task_id);
create unique index if not exists idx_visit_reservation_create_op on visit_reservation (create_operation_id) where create_operation_id is not null;
create index if not exists idx_visit_reservation_location on visit_reservation (location_id);

-- 저장 1건 = 이력 1행(여러 항목을 바꿔도 1행). 무변경·닫기·PDF 변경은 행을 만들지 않는다.
-- request_no = 확정 후 customer_request의 누적 회차. 3회 한도의 최후 방어: (예약, 회차) unique + 1~4 범위
-- (4 = 명시적 중단 기록). 두 담당자가 동시에 3회째를 저장해도 한쪽은 unique 위반으로 실패한다.
create table if not exists reservation_change (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references visit_reservation(id) on delete restrict,
  event          text not null default 'edit' check (event in ('create', 'edit', 'confirm', 'stop')),
  reason         text not null check (reason in ('waiting_edit', 'customer_request', 'correction')),
  request_no     integer check (request_no is null or request_no between 1 and 4),
  differences    jsonb not null default '[]'::jsonb,                           -- [{field,label,before,after}] — 과거 전후 값이 없으면 null 그대로
  sheet_before   text,
  sheet_after    text,
  actor_id       uuid references member(id) on delete set null,
  actor_name     text not null,
  operation_id   text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_reservation_change_reservation on reservation_change (reservation_id, created_at desc);
create unique index if not exists idx_reservation_change_request_no on reservation_change (reservation_id, request_no) where request_no is not null;
create unique index if not exists idx_reservation_change_operation on reservation_change (operation_id) where operation_id is not null;

-- ─────────────────────────── 종료 ───────────────────────────
-- 종료는 삭제가 아니다 — 예약·시트·이력·동의서·원고는 그대로 둔다. 예약 없는 기존 visit 작업의 종료도 여기 남긴다(reservation_id null).
-- task의 cancelled_at도 함께 찍어 기존 집계(취소 제외)·게시 상호배제(055 check)가 그대로 동작하게 한다. 이때 task.cancel_reason은
-- 기존 제약(declined/no_response/other)을 넓히지 않고 'other'로 두며, 종료 종류의 정본은 이 테이블의 kind다.
-- 기존 cancelTask(원고 떼기)는 호출하지 않는다 — 예약 종료는 원고 연결을 보존하는 별도 분기다.
create table if not exists reservation_end (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references campaign_task(id) on delete restrict,
  reservation_id uuid references visit_reservation(id) on delete restrict,
  kind           text not null check (kind in ('cancelled', 'visit_no_show', 'upload_no_show', 'change_limit')),
  reason         text not null check (length(btrim(reason)) > 0),
  snapshot       jsonb not null default '{}'::jsonb,                            -- 종료 당시 단계·방문 일시·기한·비용
  ended_by       uuid references member(id) on delete set null,
  ended_by_name  text not null,
  ended_at       timestamptz not null default now(),
  revoked_at     timestamptz                                                    -- 종료 복원(결정 전 — 아직 쓰는 경로 없음)
);
create unique index if not exists idx_reservation_end_active on reservation_end (task_id) where revoked_at is null;

-- ─────────────────────────── 협찬 동의서 ───────────────────────────
-- 새로 만들지 않는다. 063의 작업 단위 동의서(campaign_task.agreement + 'task-agreement' 버킷, PDF·이미지)를 그대로 쓴다
-- (2026-10-06 결정). 방문 작업당 예약은 최대 1개(idx_visit_reservation_task)라 작업 단위 동의서가 곧 예약의 동의서다.
-- 예약 화면의 동의서 첨부·교체·제거는 기존 taskAgreement 경로를 호출한다 — 두 번째 저장소를 두면 동의서가 둘로 갈린다.

-- ─────────────────────────── 요청 중복 방지 ───────────────────────────
-- 같은 사용자·operation·key: body가 같으면 최초 결과를 돌려주고, 다르면 409. 보관 7일(만료 행 정리는 별도 작업).
-- 로그·감사 식별자에 body 전문을 남기지 않는다 — request_hash만 저장한다.
create table if not exists api_idempotency (
  subject      text not null,                                                   -- 인증 subject(Supabase user id)
  operation    text not null,
  key          text not null,
  request_hash text not null,
  status       text not null default 'processing' check (status in ('processing', 'succeeded')),
  http_status  integer,
  response     jsonb,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  primary key (subject, operation, key)
);
create index if not exists idx_api_idempotency_expires on api_idempotency (expires_at);
