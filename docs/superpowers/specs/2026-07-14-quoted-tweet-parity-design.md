# 인용 트윗(QRT) X 패리티 — tweet/detail 보강 + 캐시

날짜: 2026-07-14
상태: 승인됨 (박구건 — "구현에 문제 없을지 검토 후 진행")

## 배경 / 문제

실사용 피드백: 인용 트윗 박스가 실제 X 디자인과 다름. 실제 X는 인용 박스 안에
**작은 아바타 + 이름 + @핸들 + 날짜 헤더 → 본문 → 이미지 그리드**를 렌더하지만,
현재 덱은 `@이름 + 텍스트` 한 줄뿐이다.

원인 두 겹:
1. 검색/워치리스트 응답의 `quoted_tweet`은 `id, text, user{name, screen_name}`만 제공 —
   아바타·날짜·미디어 없음.
2. **잠복 버그**: mapper가 `q.user.userName`(존재하지 않는 키)을 읽어 이름이 전량 null로
   저장돼 있었음 (DB 실측 239/239건 null).

## 결정 사항

- **`GET /twitter/tweet/detail?id=` 로 인용 트윗을 보강**한다 ($0.001/콜, 검색과 동일 단가).
  프로브 확인: 응답 `data`는 검색 raw 트윗과 **동일 구조** (author.profilePicture/name/userName,
  createdAt, media[], url, text) → `mapRawTweet` 재사용.
- **ID별 평생 1회 캐시**: `quoted_tweet` 테이블 (id PK). 비용: 백필 193콜 = $0.19 1회 +
  이후 신규 인용당 $0.001. 새로고침당 상한 40콜.
- mapper 버그 수정: `userName ← user.name`(폴백 기존 키), `screenName ← user.screen_name` 신규.

## 설계

### 1. 스키마 — `migrations/004_quoted_cache.sql` (멱등)

```sql
create table if not exists quoted_tweet (
  id text primary key,              -- 인용 트윗 ID
  status text not null default 'ok', -- 'ok' | 'missing' (삭제/비공개 tombstone)
  data jsonb,                        -- DeckTweet 형태 (status='ok'일 때)
  fetched_at timestamptz not null default now()
);
```

### 2. 데이터 계층

- `mappers.ts`: `DeckQuoted`에 `screenName: string | null` 추가, user 키 수정.
- `getxapi.ts`: `getTweetDetail(id): Promise<RawTweet | null>` — 200이면 `data`, 404/400류는 null
  (기존 재시도·백오프 재사용). **주의**: detail 엔드포인트 파라미터는 `id=` (`tweet_id` 아님).
- `quotedStore.ts` (신규): `missingQuotedIds(sql, ids)` (캐시에 없는 것만),
  `upsertQuoted(sql, id, deckTweet|null)` (null → tombstone), `getQuotedMap(sql, ids)`.
- `quotedEnrich.ts` (신규): `enrichQuoted(sql, client, quotedIds, {cap=40, concurrency=4})` —
  missing만 골라 detail 페치 → mapRawTweet → upsert. 개별 실패는 삼키고 계속(베스트 에포트).
  **refreshColumn은 수정하지 않는다** — refresh route가 refresh 후 호출.
- `tweetStore.getColumnTweets` / candidate 조회: `quoted_tweet` LEFT JOIN으로
  `quoted.enriched: DeckTweet | null`을 실어 보낸다 (`StoredTweet['quoted']` 확장).

### 3. UI — `TweetCard.tsx` 인용 박스

enriched 있을 때 (실제 X 레이아웃):
- 헤더: 아바타 20px 원형 + 이름 볼드 + `@screenName` + `· 날짜` (모두 x-secondary 계열)
- 본문: `TweetText` (링크화)
- 미디어: `MediaGrid` 재사용
- 박스 전체 클릭 → 인용 원문 새 탭 (`div` onClick — 중첩 `<a>` 회피, 내부 링크는 stopPropagation)

enriched 없을 때 (폴백): 이름(있으면 볼드)+텍스트 — 현재와 동일 수준.
`TweetText` 링크에 `stopPropagation` 추가 (박스 클릭과 충돌 방지).

### 4. 백필

`scripts/backfill-quoted.ts`: DB의 고유 인용 ID 중 캐시 미보유분 전체를 enrichQuoted로 처리
(193건 ≈ $0.19). `npm run backfill:quoted`.

### 5. 테스트 / 검증

- mapper: user.name/screen_name 추출 + 구키 폴백 (기존 fixture로)
- quotedStore: missing 판별·upsert·tombstone·getQuotedMap (실DB)
- quotedEnrich: 페이크 클라이언트로 cap·실패 삼킴·tombstone 기록
- getxapi.getTweetDetail: 페이크 fetch로 200/404
- 기존 55개 green 유지, 빌드, 브라우저 스크린샷(X 원본과 비교)

## 사전 검토에서 확인한 리스크와 대응

①새로고침 지연→cap 40·동시성 4·베스트에포트 ②삭제 인용→tombstone ③기존 테스트→enrich 분리
④중첩 a 금지→div onClick ⑤날짜 포맷→mapRawTweet 재사용 ⑥마이그레이션 멱등 ⑦429→기존 백오프
⑧mapper 버그 동시 수정. 범위 제외: 인용의 인용(1단계만), 실시간 재검증(캐시 영구).
