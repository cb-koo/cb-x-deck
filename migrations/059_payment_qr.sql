-- 059: PayPay 수취 QR 이미지 (스펙 2026-09-22-paypay-qr-design.md §1)
-- 058은 클라이언트 예산 기간(058_client_budget_period.sql)이 먼저 main에 들어갔다 → 이 파일은 059로 옮겼다.
-- 운영에는 058_payment_qr.sql이라는 이름으로 이미 적용됐다 — 추가만 하는 문장들이라 재실행 안전(044 선례와 같다).
-- 칸(컬럼) 추가는 없다 — QR 경로는 influencer.payment_methods(jsonb) 안에 들어간다.
-- 이 파일은 버킷과 접근 정책만 만든다. apply-migrations.sh가 전 파일을 재실행하므로 모든 문장은 멱등.

-- 비공개 버킷. 표시·전달 모두 그때그때 서명 URL로만 접근한다(task-proof 044와 같은 방식).
-- file_size_limit은 src/lib/paymentQr.ts의 MAX_PAYMENT_QR_BYTES와 반드시 같은 값(5MB).
-- task-proof(10MB)보다 좁힌 이유: QR 스크린샷은 보통 수백 KB다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-qr', 'payment-qr', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- on conflict do nothing은 값을 바꾸지 않는다 — 이미 있던 버킷도 코드 상수와 맞춘다.
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg','image/png','image/webp'],
       public = false
 where id = 'payment-qr';

-- create policy에는 if not exists가 없다 — 재실행 안전하게 drop 후 create(024·044 관례).
-- delete 정책을 주지 않는 이유: QR을 바꿔도 옛 파일은 남긴다. 이미 나간 요청의 스냅샷이 그 경로를 가리킨다.
drop policy if exists "payment-qr read" on storage.objects;
create policy "payment-qr read" on storage.objects
  for select to authenticated using (bucket_id = 'payment-qr');

drop policy if exists "payment-qr write" on storage.objects;
create policy "payment-qr write" on storage.objects
  for insert to authenticated with check (bucket_id = 'payment-qr');
