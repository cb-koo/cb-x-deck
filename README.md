# cb-x-deck

TweetDeck식 X(트위터) 벤치마크 리서치 도구. X 콘텐츠 기획(글감·포맷 발굴) 탐색 단계 지원용.

## 실행

```bash
npm install
npm run dev   # http://localhost:3000
```

`.env` 필요 키: `PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD`(Supabase Session pooler),
`GETXAPI_KEY`, `ANTHROPIC_API_KEY`. (SUPABASE_* 키는 v2 배포용 예비)

## 명령

| 명령 | 설명 |
|---|---|
| `npm run dev` | 로컬 실행 |
| `npm test` | 단위+DB 통합 테스트 (실 Supabase, test- 접두 데이터 자가 정리) |
| `npm run migrate` | `migrations/*.sql` 적용 |
| `npm run smoke:getxapi` | GetXAPI 실호출 계약 검증 + fixtures 재채집 (~$0.003) |
| `npm run smoke:suggest` | Claude 연관 키워드 실호출 확인 |

## 비용 특성

- 자동 폴링 없음 — 새로고침 버튼을 누를 때만 GetXAPI 호출 ($0.001/페이지 × maxPages, 기본 3)
- 검색 레이트 리밋: 단시간 ~7콜 — 여러 컬럼 연속 새로고침 시 간격 두기 (429는 자동 재시도)

## 구조

- `src/lib/` — 로직 전부 (getxapi 클라이언트, 매퍼, 쿼리빌더, 스토어, refresh 파이프라인)
- `src/app/api/` — 얇은 프록시 라우트 (키는 서버에만)
- `src/components/` — X UI 재현 TweetCard, 덱 컬럼, 보관함 카드
- 스키마: deck_column / tweet(아카이브, first_seen·last_fetched·seen_at) / column_tweet / candidate / tag
- 설계 spec: `docs/superpowers/specs/2026-07-07-cb-x-deck-v1-design.md`
