-- 클리닉 지도 자동 수집 타이머(2026-10-17) — DB가 매주 월요일 04:43(서울)에 /api/market-map/collect를 부른다.
-- clinic-sales가 지난달 매출을 언제 채우는지 정해져 있지 않아서 주 1회 전체를 다시 받는다(약 1분, 비용 없음).
-- 마이그레이션이 아니다: 환경(운영·연습용)마다 주소가 달라서, 환경별로 한 번만 손으로 돌린다. 다시 돌려도 안전하다(같은 이름 작업은 덮어쓴다).
-- 비밀키는 성과 자동 측정이 이미 Vault에 넣은 'measure_cron_secret'을 그대로 쓴다(scripts/auto-measure-cron.sql을 먼저 돌린 환경이어야 한다).
-- 앱 쪽에는 CLINIC_SALES_API_KEY 환경변수가 있어야 한다.
-- 실행:
--   psql "$DATABASE_URL" -v app_url='https://cb-x-deck.vercel.app' -f scripts/market-map-cron.sql
-- 멈추기:
--   select cron.unschedule('market-map-collect');
-- 최근 실행 확인:
--   select started_at, finished_at, months, error from market_run order by started_at desc limit 10;

\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'measure_cron_secret') then
    raise exception 'measure_cron_secret이 없어요 — scripts/auto-measure-cron.sql을 먼저 돌려 주세요';
  end if;
end $$;

-- pg_cron은 UTC — 일요일 19:43 UTC = 월요일 04:43 서울(검색 트렌드 04:23과 겹치지 않게). 수집은 최대 5분 — pg_net 응답 대기는 그보다 길게.
select cron.schedule('market-map-collect', '43 19 * * 0', format($job$
  select net.http_post(
    url := %L,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'measure_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 310000)
$job$, :'app_url' || '/api/market-map/collect'));

select jobname, schedule, active from cron.job where jobname = 'market-map-collect';
