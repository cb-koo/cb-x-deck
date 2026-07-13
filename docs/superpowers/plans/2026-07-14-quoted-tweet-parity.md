# 인용 트윗 X 패리티 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인용 트윗을 tweet/detail로 보강·캐시해 실제 X 인용 카드(아바타·이름·날짜·미디어)와 동일하게 렌더한다.

**Architecture:** `quoted_tweet` 캐시 테이블 + 별도 enrich 모듈(refresh 후처리) + LEFT JOIN으로 UI에 전달. `mapRawTweet` 재사용. 스펙: `docs/superpowers/specs/2026-07-14-quoted-tweet-parity-design.md`

**Tech Stack:** 기존과 동일 (node:test, postgres.js). 테스트: `node --import tsx --env-file=.env --test <file>`

## Global Constraints

- 스펙의 사전 검토 8건 대응 준수 (cap 40·동시성 4·tombstone·enrich 분리·div onClick·멱등 마이그레이션)
- detail 파라미터는 `id=` (`tweet_id` 아님). 단가 $0.001/콜.
- 작업 브랜치 `feat/quoted-parity`, 커밋은 작업 파일만 명시 stage.
- refreshColumn.ts 시그니처 무변경.

---

### Task 1: migration 004 + mapper 픽스 (TDD)
**Files:** Create `migrations/004_quoted_cache.sql` / Modify `src/lib/types.ts`(DeckQuoted+screenName, StoredTweet quoted enriched), `src/lib/mappers.ts` / Test `src/lib/mappers.test.ts`(기존 파일에 케이스 추가)
- [ ] 스펙 §1 SQL로 004 작성, `npm run migrate` 적용
- [ ] mappers.test.ts에 실패 테스트: fixture quoted → `{userName:'三井ほし', screenName:'femfem879'}` (fixture 첫 quoted 실측값)
- [ ] mapper 수정: `userName: str(qUser?.name) ?? str(qUser?.userName)`, `screenName: str(qUser?.screen_name)` / 통과 확인 / 커밋

### Task 2: getxapi.getTweetDetail + quotedStore + quotedEnrich (TDD)
**Files:** Modify `src/lib/getxapi.ts` / Create `src/lib/quotedStore.ts`, `src/lib/quotedEnrich.ts` / Test `src/lib/quotedStore.test.ts`, `src/lib/quotedEnrich.test.ts`, getxapi.test.ts에 케이스 추가
**Interfaces:** `getTweetDetail(id: string): Promise<RawTweet | null>` (404/400→null) / `missingQuotedIds(sql, ids: string[]): Promise<string[]>` / `upsertQuoted(sql, id: string, t: DeckTweet | null)` / `getQuotedMap(sql, ids: string[]): Promise<Record<string, DeckTweet>>` (status='ok'만) / `enrichQuoted(sql, client: {getTweetDetail}, ids: string[], opts?): Promise<{fetched: number; missing: number}>`
- [ ] getTweetDetail: 페이크 fetch 200/404 테스트 → 구현(`/twitter/tweet/detail?id=`, 404는 재시도 없이 null, 기존 get() 재사용 불가 시 별도 처리)
- [ ] quotedStore: 실DB 테스트(멱등 upsert·tombstone·missing 판별) → 구현
- [ ] quotedEnrich: 페이크 클라이언트 테스트(dedupe·cap·실패 삼킴·tombstone) → 구현(동시성 4 청크) / 커밋

### Task 3: refresh 후처리 연결 + 조회 JOIN
**Files:** Modify `src/app/api/columns/[id]/refresh/route.ts`(refresh 후 kept의 quoted ids로 enrichQuoted 호출 — refreshColumn 반환에 quotedIds 없으므로 route에서 재조회 대신 `getColumnQuotedIds(sql, columnId)` quotedStore에 추가), `src/lib/tweetStore.ts` getColumnTweets에 LEFT JOIN quoted_tweet → `quoted.enriched` / Test tweetStore.test.ts 케이스 추가
- [ ] tweetStore 테스트: quoted 캐시 있는 트윗 조회 시 enriched 실림 → JOIN 구현
- [ ] refresh route에 enrich 후처리(try/catch 삼킴) / 커밋
- [ ] candidate(보관함) 경로도 동일 JOIN 확인(candidateStore가 tweet 행 재사용하면 자동)

### Task 4: UI — X식 인용 카드
**Files:** Modify `src/components/TweetCard.tsx`, `src/components/TweetText.tsx`(링크 stopPropagation), Create `src/components/QuotedCard.tsx`
- [ ] QuotedCard: enriched → 아바타20px+이름볼드+@핸들+·날짜 / TweetText / MediaGrid / div onClick 새 탭. 폴백 → 이름+텍스트
- [ ] TweetCard에서 기존 인용 블록 교체, 빌드+전체 테스트 / 커밋

### Task 5: 백필 + 검증
**Files:** Create `scripts/backfill-quoted.ts`, package.json에 `backfill:quoted`
- [ ] 스크립트: tweet에서 고유 quoted id 수집 → enrichQuoted(cap 무제한) → 결과 로그
- [ ] 실행 (193건, ~$0.19) / 전체 테스트+빌드 / 헤드리스 스크린샷으로 X 원본과 비교 / 커밋 → 머지·push
