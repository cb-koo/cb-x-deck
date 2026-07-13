# cb-x-deck

TweetDeck식 X(트위터) 벤치마크 리서치 도구. X 콘텐츠 기획(글감·포맷 발굴) 탐색 단계 지원용.

## 실행

```bash
npm install
npm run dev   # http://localhost:3000
```

`.env` 필요 키: `PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD`(Supabase Session pooler),
`GETXAPI_KEY`, `ANTHROPIC_API_KEY`, `EXA_API_KEY`(리서치). (SUPABASE_* 키는 v2 배포용 예비)

## URL 체계 및 워크스페이스·멤버

- `/` — 기본 워크스페이스 덱으로 자동 리다이렉트
- `/w/[wsId]` — 워크스페이스 진입점 (사이드바로 전환·추가)
  - `/w/[wsId]/deck` — 덱 (기본)
  - `/w/[wsId]/library` — 보관함 (저장됨)
  - `/w/[wsId]/research` — 리서치 (exa 웹 기사 검색 → 덱 키워드 발굴)

각 워크스페이스는 독립적인 컬럼 집합을 유지. 멤버는 사이드바에서 등록·전환(팀 협업용).

## NEW 배지 및 멤버별 저장

- **NEW 배지**: 직전 새로고침 이후 컬럼에 새로 들어온 트윗에 파란 NEW 표시. 컬럼의 "전체 ↔ NEW만" 토글로 신규만 필터 가능. 신규가 없으면 그것 자체가 시그널. (개인별 읽음 추적 없음 — 첫 새로고침 땐 전부 신규라 배지 생략)
- **보관함 = 공유 코멘트 뷰**: 콘텐츠당 카드 1장, 멤버별 코멘트(=각자의 메모·태그)가 나란히 표시. 내 코멘트만 편집, 미저장 멤버도 "코멘트 달기"로 참여(저장으로 계산). 내 코멘트 제거 시 타인 코멘트가 남아 있으면 카드 유지
- **보관함 필터**: 멤버 필터(그 멤버가 저장한 콘텐츠 선별) + 태그 필터(그룹 내 누구든 매칭) 조합 가능

## 마이그레이션

```bash
npm run migrate
```

DB 스키마 초기화 (`migrations/*.sql`). 로컬 개발·배포 전 최초 1회 실행.

## 명령

| 명령 | 설명 |
|---|---|
| `npm run dev` | 로컬 실행 |
| `npm test` | 단위+DB 통합 테스트 (실 Supabase, test- 접두 데이터 자가 정리) |
| `npm run migrate` | `migrations/*.sql` 적용 |
| `npm run smoke:getxapi` | GetXAPI 실호출 계약 검증 + fixtures 재채집 (~$0.003) |
| `npm run smoke:suggest` | Claude 연관 키워드 실호출 확인 |
| `npm run smoke:exa` | exa 검색 실호출 계약 검증 (~$0.005) |

## 비용 특성

- 자동 폴링 없음 — 새로고침 버튼을 누를 때만 GetXAPI 호출 ($0.001/페이지 × maxPages, 기본 3)
- 검색 레이트 리밋: 단시간 ~7콜 — 여러 컬럼 연속 새로고침 시 간격 두기 (429는 자동 재시도)
- 리서치: exa 검색 1회 ≈ $0.005 + 기사별 키워드 추출(Haiku) 소액. 버튼 누를 때만 호출

## 구조

- `src/lib/` — 로직 전부 (getxapi·exa 클라이언트, 매퍼, 쿼리빌더, 스토어, refresh 파이프라인, 리서치 추출)
- `src/app/api/` — 얇은 프록시 라우트 (키는 서버에만)
- `src/components/` — X UI 재현 TweetCard, 덱 컬럼, 보관함 카드
- 스키마: workspace(클라이언트) / member(팀원) / deck_column(prev_refreshed_at로 NEW 판정) / tweet(아카이브, first_seen·last_fetched) / column_tweet(first_appeared_at) / candidate(멤버별 저장) / tag — tweet_seen은 폐기된 봤음 추적의 잔여 테이블(미사용)
- 설계 spec: `docs/superpowers/specs/2026-07-07-cb-x-deck-v1-design.md`
