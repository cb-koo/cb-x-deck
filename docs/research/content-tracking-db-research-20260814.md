# 콘텐츠 트래킹 DB 설계 리서치 (2026-08-14)

Exa 웹 리서치 에이전트 2건(소셜 지표 트래킹 스키마 통례 / 인플루언서 캠페인 도구의 게시물 추적 모델) 종합.
목적: 콘텐츠 트래킹 v1 데이터 모델(`tracked_post` + `post_metric_snapshot`) 검증.

## 결론 요약

| 분류 | 항목 |
|---|---|
| 유지(통례 일치) | 2테이블 분리(대상+append-only 스냅샷) · 트윗 ID 자연키 유니크 · 본문/작성자 등록 시점 스냅샷 · 수동/자동 등록 경로 구분 |
| v1 추가 | 스냅샷 `raw jsonb`(원본 응답 보관 — 재수집 없이 재처리) · `deleted_at`(트윗 삭제 감지) |
| 자동화 단계로 미룸 | `next_poll_at`·연속 실패 카운트(대상 행 컬럼이 통례) · 체크포인트 5m/15m/1h/6h/24h · 갱신 컷오프(예: 게시 90일) · 자동 발견분 "확정 대기" 상태 |
| 불필요 | TimescaleDB · 파티셔닝 · 중복 스냅샷 제거(전부 수백만 행 규모 트리거) |

## 1. 스냅샷 축적 vs 덮어쓰기

- 조사 사례 전부 엔티티(게시물)와 지표 시계열을 분리, 지표는 append-only. 덮어쓰기 사례 없음.
  - Den Delimarsky의 트위터 분석 도구: `tweets` + `tweet_snapshots(id, retweets, likes, replies, time_of_capture)` — 스냅샷 테이블은 의도적으로 얇게. https://den.dev/blog/twitter-analytics/
  - `suenot/w-popularity`: "append-only snapshots, BRIN(ts), SQL views for KPIs". https://github.com/suenot/w-popularity
  - GitHub 지표 웨어하우스 사례: 엔티티 차원 + 스냅샷 팩트, `(entity_id, snapshot_date)` 복합 PK로 주기당 1행 강제. https://github.com/Chandan22805/github-repo-analytics-platform

## 2. 그레인·키·본문 처리

- 플랫폼 게시물 ID를 자연키/유니크로, `ON CONFLICT DO NOTHING`으로 멱등 등록. https://scrapebadger.com/blog/how-to-store-twitter-data-in-postgresql
  - (해당 글은 BIGINT 권장이지만 이 리포는 트윗 ID를 text로 다루는 관례 + JS 정밀도 문제로 text 유지)
- 본문·작성자는 수집 시점 스냅샷으로 저장, 라이브 재조회하지 않음 — 수정·삭제·API 불능 대비. `lhbelfanti/corpus-creator` ERD가 명시적으로 이렇게 설계(read-heavy 비정규화 정당화). https://github.com/lhbelfanti/corpus-creator/

## 3. 시계열 위생 (플레인 Postgres)

- 파티셔닝은 ~500만 행부터 고려, `created_at DESC` 인덱스는 규모 무관 필수. https://scrapebadger.com/blog/how-to-store-twitter-data-in-postgresql
- 소규모에서 연속 미변경 스냅샷 중복 제거를 하는 사례 없음 — "주기당 1행" 정도로 수용.
- 보존 정책(30일 삭제 배치) 사례는 무료 티어 용량 제약이 이유였음 — 성능 아님.

## 4. 폴링 주기 (자동화 단계 참고)

- 폴링 상태는 별도 스케줄 테이블이 아니라 대상 행 컬럼이 통례: `last_checked_at`, `next_check_at`, `consecutive_failures`, `last_error` + 지수 백오프. `0x2E/fusion` backend-design. https://github.com/0x2E/fusion/blob/main/docs/backend-design.md
- X 게시물 특화 체크포인트: **T+5m, 15m, 1h, 6h, 24h** — 더 촘촘하면 0만 찍히고, 더 성기면 속도 곡선을 놓침. https://twitterapi.io/blog/twitter-post-tracker-api-guide
- 재조회 시 트윗이 사라지면 `deletion_detected` 이벤트 — 조용한 실패 금지.

## 5. 인플루언서 캠페인 도구들의 연결·라이프사이클

- 연결은 하이브리드가 지배적: 수동 URL 제출 + 멘션/해시태그/브리프 링크 기반 자동 감지 → **감지와 사람 확정(assignment)을 분리**.
  - Upfluence Content tab: 해시태그·멘션·키워드 매칭, 반영까지 수시간~4일, 수동 추가 탈출구 존재. https://help.upfluence.co/en/articles/7004646-how-to-track-influencer-posts-with-the-content-tab-in-campaigns
  - Aspire: 멘션 청취 / 브리프에 링크 제출 / 브랜드 수동 업로드 3경로 → 프로젝트 자동 배정은 단일 프로젝트일 때만, 아니면 사람이 배정. https://help.aspireiq.com/en/articles/6029907-how-are-social-posts-pulled-into-the-social-dashboard
  - Modash Collaboration API: 매칭 종류(`collaboration_type`)가 1급 필드. https://docs.modash.io/products/discovery_api/openapi_doc/discovery/collaborations
- 갱신 컷오프: Upfluence는 최근 90일·최근 100개 게시물만 지표 갱신. https://help.upfluence.co/en/articles/6993032-how-to-set-up-stream-to-track-and-analyze-influencer-posts
- 라이프사이클(공통 형태): 감지/제출(미확정) → 확정/검증 → 활성 갱신 → 기간 경과 후 갱신 중단. Stormy는 검증(존재·기간·필수 링크·유형) + 수동 리뷰를 명명. https://stormy.ai/docs/post-tracking
- 조기 성과 알림은 절대 임계값이 아니라 게시 후 경과시간 × 계정 평소 대비 비교가 필요 — 시계열 전제. https://mintedbrain.com/tools/performancealert

## v1 설계 반영

- 추가: `post_metric_snapshot.raw jsonb`, `tracked_post.deleted_at`
- 유지: 2테이블·tweet_id text 유니크·본문/핸들 스냅샷·`source`(manual/auto)·`(tracked_post_id, captured_at desc)` 인덱스
- 미룸/불필요는 요약표 참조
