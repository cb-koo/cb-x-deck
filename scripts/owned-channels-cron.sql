-- X 업로드 현황 자동 수집 타이머(2026-10-20) — DB가 매일 07:00(서울)에 /api/channels/collect를 부른다.
-- 스펙 docs/superpowers/specs/2026-10-20-owned-channels-x-uploads-design.md §4-1. 한 계정 하루 보통 X 호출 2번(10곳 기준 한 달 약 900원).
-- 마이그레이션이 아니다: 환경(운영·연습용)마다 주소가 달라서, 환경별로 한 번만 손으로 돌린다. 다시 돌려도 안전하다(같은 이름 작업은 덮어쓴다).
-- 비밀키는 성과 자동 측정이 이미 Vault에 넣은 'measure_cron_secret'을 그대로 쓴다(scripts/auto-measure-cron.sql을 먼저 돌린 환경이어야 한다).
-- 실행:
--   psql "$DATABASE_URL" -v app_url='https://cb-x-deck.vercel.app' -f scripts/owned-channels-cron.sql
-- 멈추기:
--   select cron.unschedule('owned-channels-collect');
-- 최근 실행 확인:
--   select handle, last_collected_at, last_error from owned_channel order by last_collected_at desc nulls last;
--   select status_code, left(content, 200), created from net._http_response order by created desc limit 5;

\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'measure_cron_secret') then
    raise exception 'measure_cron_secret이 없어요 — scripts/auto-measure-cron.sql을 먼저 돌려 주세요';
  end if;
end $$;

-- pg_cron은 UTC — 22:00 UTC = 07:00 서울. 한 번에 45초까지 돌고 남은 계정은 다음 실행이 잇는다(지금 규모는 한 번에 끝난다).
select cron.schedule('owned-channels-collect', '0 22 * * *', format($job$
  select net.http_post(
    url := %L,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'measure_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$, :'app_url' || '/api/channels/collect'));

select jobname, schedule, active from cron.job where jobname = 'owned-channels-collect';
