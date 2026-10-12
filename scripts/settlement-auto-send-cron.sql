-- 정산 요청 자동 전송 타이머(2026-10-12) — DB가 5분마다 /api/settlement/auto-send를 부른다.
-- 실제로 보내는 건 매주 월요일 07:00(서울) 이후 첫 실행과, 그 뒤에 고쳐진 건뿐이다(판정은 앱 쪽 settlementAuto.ts).
-- 마이그레이션이 아니다: 환경(운영·연습용)마다 주소가 달라서, 환경별로 한 번만 손으로 돌린다. 다시 돌려도 안전하다.
-- 비밀키는 성과 자동 측정이 이미 Vault에 넣은 'measure_cron_secret'을 그대로 쓴다(scripts/auto-measure-cron.sql을 먼저 돌린 환경이어야 한다).
--
-- 실행:
--   psql "$DATABASE_URL" -v app_url='https://cb-x-deck.vercel.app' -f scripts/settlement-auto-send-cron.sql
-- 멈추기(자동 전송 끄기 — 화면의 [지금 보내기]는 계속 된다):
--   select cron.unschedule('settlement-auto-send');
-- 최근 실행 확인:
--   select started_at, finished_at, sent, failed, detail from settlement_auto_run order by started_at desc limit 5;

\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'measure_cron_secret') then
    raise exception 'measure_cron_secret이 없어요 — scripts/auto-measure-cron.sql을 먼저 돌려 주세요';
  end if;
end $$;

select cron.schedule('settlement-auto-send', '*/5 * * * *', format($job$
  select net.http_post(
    url := %L,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'measure_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$, :'app_url' || '/api/settlement/auto-send'));

select jobname, schedule, active from cron.job where jobname = 'settlement-auto-send';
