-- 062: 인플루언서 블루마크(X Premium 인증) 여부 — 프로필 조회 스냅샷에 한 칸 추가(koo 2026-09-28). 추가만, 멱등.
-- 계기: 블루마크 계정은 X 글자 수 상한이 다르다(280 → 긴 글). 먼저 조회·저장·표시하고, 글자 수 기준 연결은 다음 단계.
-- null = 이 칸이 생기기 전에 조회했거나 아직 미조회(프로필 [갱신] 한 번이면 채워진다). 옛 코드는 이 칸을 모르니 무해.
alter table influencer
  add column if not exists is_blue_verified boolean;
comment on column influencer.is_blue_verified is 'X 블루마크(isBlueVerified) 스냅샷(062). null = 미조회 — profile_refreshed_at과 같은 시점 값';
