# 인플루언서 프로필 UI/UX 개선 설계

날짜: 2026-08-13
상태: 방향 승인 (koo "이 방향으로 진행" — 리서치 기반 제안 4건 + 기본값 2건)
선행: `2026-08-13-influencer-db-design.md` (명부 v1), 리서치 `docs/research/influencer-profile-ux-research-20260813.md` · `crm-contact-detail-ux-research-20260813.md`

## 진단 (리서치 수렴점)

1. "이 사람 지금 어떤 상태인가"에 스크롤 없이 답하지 못한다 → Pipedrive Focus 블록·Influencer Hero 배지 패턴.
2. 사람이 남긴 컨택 로그가 자동 이벤트에 묻힌다 → Attio(자동 이벤트 기본 접힘)·HubSpot(접힌 행 아이콘 제거) 패턴.

## ① 현황 스트립 (헤더 바로 아래)

- **연락 배지**: 파생값 `lastContactAt` = **manual 로그 최신 created_at** (라벨-값 일치: auto 이벤트는 "연락"이 아니므로 제외 — 기존 "마지막 기록"과 다른 축이다. 라벨도 "연락 기록"으로 구분).
  - 표시: 기록 있으면 `연락 기록 N일 전`, 없으면 `연락 기록 없음`.
  - 경고 조건: `now - coalesce(lastContactAt, createdAt) > 14일` → 경고색 + `→ 팔로업 필요` (원칙 3: 판단까지 서술).
  - 기준 14일은 **상수 고정**(`FOLLOWUP_DAYS = 14`) — 설정 UI는 불편이 확인되면 승격 (보류 목록).
- **원고 요약 줄**: `게시완료 3 · 진행중 1` — 존재하는 상태만, 서버 파생 `draftStatusCounts`(전체 카운트, group by status).
  - 이로써 v1 fast-follow #7(롤업 limit 50 vs draftCount 자기모순)도 함께 해소: 요약은 전체 카운트, 원고 목록 헤더는 50건 초과 시 `최근 50건` 라벨.

## ② 타임라인 시각 위계

- **auto 이벤트**: 회색 텍스트 한 줄, 아이콘·카드 배경 없음 (HubSpot 실사용 데이터 근거).
- **manual 로그**: 카드 스타일 유지 (배경·채널칩·작성자) — 사람이 남긴 것이 스캔에서 먼저 보인다.
- **연속 동일 auto 이벤트 묶기**(표시 시점 클라이언트 그룹핑): 인접한 같은 event_type이 2건 이상이면 `원고 3건 배정 (8/8~8/10)` 한 줄로 접고, 클릭 시 개별 행(각 원고 제목 링크)으로 펼침. manual 로그가 사이에 있으면 묶지 않는다(시간 순서 왜곡 금지).

## ③ 컴포저 마찰 축소

- 입력창은 타임라인의 **최신 항목 쪽에 상시 노출** (시간 역순 목록이므로 목록 상단). 별도 진입 없음.
- **채널 기본값 = 가장 최근 manual 로그의 채널** (Veeva 패턴). manual 로그가 없으면 미선택.
- Enter 저장(IME `isComposing` 가드 유지). 기록 0건 빈 상태에서도 같은 컴포저가 그대로 보인다 — 별도 CTA 없음 (137Foundry + 원칙 2).

## ④ 갱신 넛지

- `profile_refreshed_at`이 **30일 초과**(`PROFILE_STALE_DAYS = 30`)면 "○일 전 기준" 옆에 `오래된 정보예요 — 갱신 권장` 한 줄. null(미조회)은 기존 문구 유지.

## 명부 리스트 반영

- ①의 같은 파생값으로 **기준 초과 행에 경고색 표시**(마지막 기록 컬럼과 별개 — 연락 축). 카운터·필터는 보류.

## 데이터 변경 (마이그레이션 없음 — 파생값만)

- `InfluencerRow`에 `lastContactAt: string | null` 추가 (list·find 공용 SELECT의 서브쿼리: `max(created_at) where kind='manual'`).
- `InfluencerDetail`에 `draftStatusCounts: Partial<Record<DraftStatus, number>>` 추가 (lower 조인 group by status, 전체 기준).
- 상수 `FOLLOWUP_DAYS`·`PROFILE_STALE_DAYS`는 클라이언트가 판단 문구를 만들 때 사용 — 공유 위치 `src/lib/influencerJudgment.ts`(신규, 판단 파생 함수 포함: 배지 상태·문구를 UI 밖에서 계산해 리스트/프로필이 같은 판단을 공유 — 라벨-값 일치).

## 보류 (리서치에 있으나 채택 안 함)

탭 분리(필드 적어 과함) / 패널 리사이즈(고정 그리드) / 채널 바로가기(HubSpot 4% 경고 — 인터뷰 후) / 팔로업 주기 설정 UI(고정값으로 시작) / 리스트 상단 팔로업 카운터·필터.

## 테스트

- `influencerStore`: lastContactAt 파생(auto만 있으면 null·manual 최신 반영), draftStatusCounts(상태별·lower 조인).
- `influencerJudgment`: 14일 경계(13일/14일/15일)·기록 없음+생성일 기준·30일 넛지 경계 — tsx 단위.
- UI는 하네스 없음 — tsc·lint 24 기준선·build.
