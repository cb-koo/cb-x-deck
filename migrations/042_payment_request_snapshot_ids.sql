-- 042: ID도 스냅샷(스펙 2026-08-28-payment-api-design §4-8) — client_name·influencer_handle처럼
-- influencer_id·client_id·category_option_id도 참조가 지워져도 남아야 한다. apply-migrations.sh가 전 파일을
-- 재실행하므로 모든 문장은 멱등.

-- §4-8-a FK를 떼어 평범한 uuid 컬럼으로 — 참조 행이 지워져도(on delete set null이 발동하지 않고) 이 값이 그대로 남는다.
-- task_id의 FK는 남긴다: 작업당 활성 요청 1건 부분 유니크 인덱스·작업 삭제 보호 로직이 그 FK 관계에 기대고 있다(040·campaignTaskStore).
alter table payment_request drop constraint if exists payment_request_client_id_fkey;
alter table payment_request drop constraint if exists payment_request_campaign_id_fkey;
alter table payment_request drop constraint if exists payment_request_influencer_id_fkey;

-- §4-8-b category_option_id 백필: 최신 설정 행의 categories(jsonb)에서 category(sendAs 텍스트)와 일치하는 옵션의 id를 찾고,
-- 못 찾으면(설정 행이 없거나 옛 sendAs가 지금 목록에 없는 경우) settlementSettings.ts SETTLEMENT_DEFAULTS 3종으로 폴백.
-- where절이 이미 채워진 행은 건드리지 않아 재실행해도 안전.
update payment_request r
   set category_option_id = coalesce(
     (
       select c ->> 'id'
         from settlement_setting_version v,
              jsonb_array_elements(v.settings -> 'categories') c
        where v.id = (select id from settlement_setting_version order by created_at desc, id desc limit 1)
          and c ->> 'sendAs' = r.category
        limit 1
     ),
     case r.category
       when '마케팅비 > X(트위터) 프로모션 RT·인용RT' then 'promo-rt'
       when '마케팅비 > X(트위터) 인플루언서 협찬 원고료' then 'fee'
       when '마케팅비 > X(트위터) 정보성콘텐츠 업로드 (게시물)' then 'info-post'
       else null
     end
   )
 where r.category_option_id is null;

-- §4-8-c non-null 보장 — 매치 안 된(백필 실패) 레거시 행이 있으면 그 컬럼만 조용히 nullable로 남긴다(마이그레이션 자체는 항상 성공).
do $$ begin
  if not exists (select 1 from payment_request where influencer_id is null) then
    alter table payment_request alter column influencer_id set not null;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from payment_request where client_id is null) then
    alter table payment_request alter column client_id set not null;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from payment_request where category_option_id is null) then
    alter table payment_request alter column category_option_id set not null;
  end if;
end $$;
