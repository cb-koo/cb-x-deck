-- 콘텐츠 성과 자동 측정 타이머(2026-10-08) — DB가 5분마다 /api/tracking/auto-measure를 부른다.
-- 마이그레이션이 아니다: 비밀키가 들어가고 환경(운영·연습용)마다 주소가 달라서, 환경별로 한 번만 손으로 돌린다.
-- 다시 돌려도 안전하다(확장은 if not exists, 비밀은 있으면 갱신, 예약은 같은 이름이면 덮어쓴다).
--
-- 실행:
--   psql "$DATABASE_URL" -v app_url='https://cb-x-deck.vercel.app' -v secret='<MEASURE_CRON_SECRET 값>' -f scripts/auto-measure-cron.sql
-- 멈추기:
--   select cron.unschedule('auto-measure');
-- 최근 실행 확인:
--   select status, return_message, start_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'auto-measure') order by start_time desc limit 5;
--   select status_code, left(content, 200), created from net._http_response order by created desc limit 5;

\set ON_ERROR_STOP on

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 비밀키는 Vault에(예약 실행 본문에 평문으로 남기지 않는다)
select case
  when exists (select 1 from vault.secrets where name = 'measure_cron_secret')
    then (select vault.update_secret((select id from vault.secrets where name = 'measure_cron_secret'), :'secret'))::text
  else (select vault.create_secret(:'secret', 'measure_cron_secret', '성과 자동 측정 호출용(MEASURE_CRON_SECRET과 같은 값)'))::text
end;

-- 5분마다 측정 호출. 응답은 pg_net이 net._http_response에 잠시 남기고 스스로 지운다.
select cron.schedule('auto-measure', '*/5 * * * *', format($job$
  select net.http_post(
    url := %L,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'measure_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$, :'app_url' || '/api/tracking/auto-measure'));

-- 예약 실행 기록은 실행마다 한 줄씩 쌓인다(하루 288줄) — 사흘 지난 것은 매일 지운다
select cron.schedule('auto-measure-cleanup', '17 3 * * *',
  $job$ delete from cron.job_run_details where end_time < now() - interval '3 days' $job$);

select jobname, schedule, active from cron.job where jobname like 'auto-measure%' order by jobname;
