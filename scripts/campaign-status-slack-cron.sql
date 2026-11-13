-- 캠페인 현황 슬랙 공유 타이머(스펙 2026-11-13) — DB가 정해진 시각에 /api/campaigns/overview/slack을 부른다.
-- 월요일 18:00, 수·목·금요일 10:30(서울). cron은 UTC라 월 09:00, 수목금 01:30으로 적는다. 공휴일 건너뛰기는 앱 쪽(koreanHolidays.ts)이 판단한다.
-- 마이그레이션이 아니다: **운영에서만** 한 번 손으로 돌린다(스테이징은 예약 없이 손으로 부를 때만 테스트 채널로 보낸다). 다시 돌려도 안전하다.
-- 비밀키는 성과 자동 측정이 이미 Vault에 넣은 'measure_cron_secret'을 그대로 쓴다. 보낼 채널은 앱 환경 변수 SLACK_STATUS_CHANNEL.
--
-- 켜기 전에: 운영 라우트를 테스트 채널로 한 번 불러 실제 숫자로 확인한다(본문 {"channel":"C0CGWSFBDPV"}).
-- 실행:
--   psql "$DATABASE_URL" -v app_url='https://cb-x-deck.vercel.app' -f scripts/campaign-status-slack-cron.sql
-- 멈추기:
--   select cron.unschedule('campaign-status-slack-mon'); select cron.unschedule('campaign-status-slack-wtf');
-- 최근 실행 확인(응답 본문에 sent/skipped/withImage가 있다):
--   select id, status_code, content::text, created from net._http_response order by created desc limit 5;

\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'measure_cron_secret') then
    raise exception 'measure_cron_secret이 없어요 — scripts/auto-measure-cron.sql을 먼저 돌려 주세요';
  end if;
end $$;

-- 같은 이름이 있으면 지우고 다시 건다(다시 돌려도 항목이 하나씩만 남는다)
select cron.unschedule(jobname) from cron.job where jobname in ('campaign-status-slack-mon', 'campaign-status-slack-wtf');

select cron.schedule('campaign-status-slack-mon', '0 9 * * 1', format($job$
  select net.http_post(
    url := %L,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'measure_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$, :'app_url' || '/api/campaigns/overview/slack'));

select cron.schedule('campaign-status-slack-wtf', '30 1 * * 3,4,5', format($job$
  select net.http_post(
    url := %L,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'measure_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$, :'app_url' || '/api/campaigns/overview/slack'));

select jobname, schedule, active from cron.job where jobname like 'campaign-status-slack-%' order by jobname;
