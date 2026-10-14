-- 검색 트렌드 자동 수집 타이머(2026-10-14, koo: 주 1회) — DB가 매주 월요일 04:23(서울)에 /api/trends/collect를 부른다.
-- 할 일(새 달 확인 → 있으면 전체 갱신, 연관 검색어 넓히기, 번역)은 앱 쪽 trendCollect.ts가 정한다. 키워드 플래너는 지난달 값을 다음 달 중순쯤 주므로 주 1회면 충분하다.
-- 마이그레이션이 아니다: 환경(운영·연습용)마다 주소가 달라서, 환경별로 한 번만 손으로 돌린다. 다시 돌려도 안전하다(같은 이름 작업은 덮어쓴다).
-- 비밀키는 성과 자동 측정이 이미 Vault에 넣은 'measure_cron_secret'을 그대로 쓴다(scripts/auto-measure-cron.sql을 먼저 돌린 환경이어야 한다).
-- 실행:
--   psql "$DATABASE_URL" -v app_url='https://cb-x-deck.vercel.app' -f scripts/search-trends-cron.sql
-- 멈추기:
--   select cron.unschedule('search-trends-collect');
-- 최근 실행 확인:
--   select kind, started_at, finished_at, latest_month, detail from trend_run order by started_at desc limit 10;

\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'measure_cron_secret') then
    raise exception 'measure_cron_secret이 없어요 — scripts/auto-measure-cron.sql을 먼저 돌려 주세요';
  end if;
end $$;

-- pg_cron은 UTC — 일요일 19:23 UTC = 월요일 04:23 서울(다른 예약 실행과 겹치지 않게). 수집은 최대 5분 — pg_net 응답 대기는 그보다 길게.
select cron.schedule('search-trends-collect', '23 19 * * 0', format($job$
  select net.http_post(
    url := %L,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'measure_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 310000)
$job$, :'app_url' || '/api/trends/collect'));

select jobname, schedule, active from cron.job where jobname = 'search-trends-collect';
