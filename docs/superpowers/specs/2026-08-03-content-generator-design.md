# 콘텐츠 생성 (인플루언서 발송용 X 원고 초안) 설계

작성 2026-08-03 · 브레인스토밍 2026-07-29~08-03 · 브랜치 `cb-koo/content-generator`

## 배경·목적

리서치(덱·보관함·브리핑)는 "무엇이 먹히는지 찾는" 입력 발굴 단계였다. 이 기능은 그 발굴 결과를 산출물로 전환한다: **클라이언트 정보 + 보관함 레퍼런스 + 제작 방향성 → 인플루언서에게 보낼 일본어 X 원고 초안**. 인플루언서는 받은 초안을 자기 피드 스타일로 약간 수정하거나 그대로 게시한다.

- 사용자: 비개발 콘텐츠 기획 담당자 (AGENTS.md UX 원칙 적용 대상)
- 핵심 프로세스: **레퍼런스 > 초안** — 레퍼런스에서 무엇을 뽑아 초안에 옮기는가
- 3요소(클라이언트·레퍼런스·방향성)는 **각각 반영 여부를 선택**할 수 있어야 한다 (최소 1개 필수)

## 확정 워크플로우 — 진입점 3개, 수렴 프로세스 1개

```
A. 덱/보관함 트윗 카드 "이 트윗으로 초안 만들기" (기본 1장) ─┐
B. 작업대에서 "레퍼런스 추가" → 보관함 시트                 ├→ [레퍼런스 0~N + 방향성]
C. 백지 시작 (레퍼런스 없이)                                ─┘   → 생성 → 초안 카드
                                                                → 편집(X 컴포즈) → 복사 → 전달
```

- 레퍼런스는 상시 노출하지 않는다 — 초안 카드의 근거 풋터(`참고 N건`)를 눌러 그 자리 펼침
- 작업대 노출 컨트롤 4개: 방향성 입력 · 설정 요약 "바꾸기" · 원고 만들기 · 레퍼런스 추가
  (이전 설계의 12컨트롤이 "너무 복잡" 피드백을 받아 재설계된 결과. 선택 UI는 진입점 B에서만 등장)
- "바꾸기" 펼침 안의 내용(접힌 요약 한 줄 뒤에 숨는 전부): 클라이언트 선택 · 시술 0~N 선택 · 형식(단문/스레드) · 참고 모드(끔/형식만/앵글만/둘다) · 생성 제약 토글(기본 끔). 직전 값 유지

## 산출물 규격

- 일본어 X 포스트. **단문 / 스레드** 생성 시 선택 (롱포스트 제외 — 인플루언서 Premium 여부 불명)
- 글자수: 가중 280자(CJK·이모지 2자, URL 23자 고정) = 일본어 ~140자. 카운터는 자체 경량 구현(`lib/xLength.ts`) — 가이드용 근사이며 차단하지 않음
- **훅 규칙: 첫 단락 = 훅.** 프롬프트로 강제(첫 단락이 자체 완결), 카드에서 첫 단락 뒤 점선 + 라벨로 표시. 스레드는 1번 트윗이 훅
- 인플루언서 톤 반영은 범위 밖. PR 표기(ステマ규제)는 원고에 넣지 않고 **원고 밖 상시 안내**로 전달
- 이미지: v1 미포함, 확장 대비만 (아래 §1·향후 확장)

## §1 데이터 모델 — `migrations/014_content_generator.sql`

```sql
create table client (             -- 최상위 엔티티. 워크스페이스에 속하지 않음
  id uuid primary key default gen_random_uuid(),
  name text not null,
  info text not null default '',            -- 클리닉·의사 자유 서술 (문서 붙여넣기 가능)
  banned_phrases jsonb not null default '[]', -- text[] — 검수 기준으로도 사용
  position int not null default 0,
  created_at timestamptz not null default now()
);
create table client_procedure (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id) on delete cascade,
  name text not null,
  description text not null default '',
  effect_phrases text not null default '',   -- 효과·결과로 쓸 수 있는 표현 (자유 서술)
  banned_phrases jsonb not null default '[]',
  position int not null default 0,
  created_at timestamptz not null default now()
);
create table draft (              -- 초안. 최상위(워크스페이스 FK 없음), 클라이언트로 필터
  id uuid primary key default gen_random_uuid(),
  client_id uuid references client(id) on delete set null,
  client_name text,                          -- 스냅샷 — 클라 수정·삭제 후에도 근거 풋터 재현
  procedure_names jsonb not null default '[]',
  direction text not null default '',        -- 방향성 (선택 사항)
  format text not null check (format in ('single','thread')),
  reference_mode text not null check (reference_mode in ('off','form','angle','both')),
  refs jsonb not null default '[]',          -- 스냅샷: [{tweetId, handle, name, excerpt, memos:[{member,text}]}]
  content jsonb not null,                    -- {posts:[{text, media:[]}]} 생성 원본. 불변
  edited jsonb,                              -- 편집본(동일 모양). null=미편집
  dismissed_flags jsonb not null default '[]',
  model text,
  created_by uuid references member(id) on delete set null,
  created_at timestamptz not null default now()
);
create index draft_created on draft (created_at desc);
```

설계 근거:
- `content.posts[]` — 단문(1개)·스레드(N개)·추후 이미지(post별 `media: DeckMedia[]`)가 한 모양. 스레드는 트윗마다 이미지가 따로 붙으므로 미디어는 반드시 포스트 단위
- 스냅샷(`client_name`·`procedure_names`·`refs`) — `briefing.content`의 "저장 시점 렌더링 전부 포함(재현성)" 선례. 메모는 이후 수정될 수 있으므로 생성에 쓴 것을 고정
- 원본(`content`) 불변 + 편집본(`edited`) 분리 — "무엇을 고쳤는지"는 한번 잃으면 복구 불가. 이 계열 제품의 공통 약점("사용자 수정이 학습되지 않음")에 대한 최소 대비
- 삭제 = hard delete + 5초 실행취소 토스트(보관함 "팀에서 빼기" 패턴 재사용)

## §2 API — 얇은 프록시 (레포 패턴)

| 라우트 | 동작 |
|---|---|
| `GET·POST /api/clients` / `PATCH·DELETE /api/clients/[id]` | 클라이언트 CRUD |
| `POST /api/clients/[id]/procedures` / `PATCH·DELETE /api/procedures/[id]` | 시술 CRUD |
| `GET /api/references?scope=all\|<wsId>&tag=…` | 보관함 전역 읽기 — 트윗 dedup + 전 워크스페이스 메모·태그 병합 |
| `POST /api/drafts` | 생성+저장. 검증: **클라이언트·레퍼런스·방향성 중 최소 1개** (전부 비면 400 + 평문 안내) |
| `GET /api/drafts?clientId=` / `PATCH·DELETE /api/drafts/[id]` | 목록 / 편집·무시 저장 / 삭제 |

- "다른 각도로" = `POST /api/drafts` 재호출(같은 입력 + 각도 지시) → 새 row. 이전 안 유지
- 스레드 "이 트윗만 다시" = 해당 post만 재생성해 **`edited`에 반영** (`content`는 불변)
- 레퍼런스 상한 **8건** 서버 검증 (few-shot 실무 가이드 "총 8개 미만" + over-copying 방지)

## §3 생성 파이프라인 — `lib/generate.ts` · `lib/draftStore.ts` · `lib/clientStore.ts`

프롬프트 조립 순서 (프롬프트 캐시 최적화 — 고정 앞, 가변 뒤):

```
1. [클라이언트 info + 선택된 시술 블록]   ← 같은 클라 반복 생성 시 캐시 읽기 (Opus 5 최소 512tok)
2. [레퍼런스 본문 + 메모(teaching note) + 참고 모드 지시(형식만/앵글만/둘다)]
3. [방향성 + 형식(단문/스레드) + 글자수·첫단락훅 규칙 + (생성 제약 켬 시) 금지어 목록]
```

- 꺼진 요소의 블록은 **프롬프트에 부재** — 이것이 반영 토글의 계약이며 테스트 대상
- 메모가 곧 teaching note: 예시마다 "이 레퍼런스의 무엇이 좋은지"를 앞세우는 방식(리서치 최고 성능). `candidate.memo`는 Jasper·Copy.ai에 없는 이 서비스 고유 자산

모델·`callLLM` 보완 (기존 호출부 무영향, 옵셔널 확장):
- `CONTENT_MODEL ?? MODEL()` — 이 기능만 `claude-opus-5` (초안당 ~$0.07, 브리핑 "$0.1 이하"와 동급). 나머지 기능은 haiku 유지
- `max_tokens: 16000` — Opus 5는 thinking 기본 ON이고 `max_tokens`가 thinking+응답 합산
- `output_config`·`betas` 파라미터 허용 → 구조화 출력(`{posts:[{text}]}` json_schema)으로 `extractJson` 정규식 불필요
- `stop_reason === 'refusal'` 감지 → 정규화된 에러 (현재 `callLLM`은 빈 응답을 정상 취급)
- **프로바이더 교체 대비**: Anthropic 전용 요소(구조화 출력 문법·refusal·betas)는 `llm.ts`·`generate.ts`에만 격리. `draft` 스키마·API 응답·UI로 새지 않음. OpenRouter 전환 시 이 한 층의 매핑 + `usagePricing` 프로바이더별 단가(백로그의 haiku-fallback 버그 수정 동반)로 닫힘

검수 (렌더 시 재계산 + `dismissed_flags`만 영속):
- 기존 `flagYakkiho`(약기법) + 클라이언트·시술 `banned_phrases` 포함 매칭 + 신규 `flagMedicalAd` — 체험담 힌트(`してみた` `行ってきた` `受けてみた` `体験` 등)·비포애프터 힌트(`ビフォー` `アフター` `before/after` `←…→` 등)를 시드로 시작해 운영하며 보강. "법률 자문 아닌 담당자 확인용 표식, 차단·필터링 없음" 기존 원칙 동일
- 표식 3요소: 무엇(구절 하이라이트) · 왜(규정 근거 평문) · 무시 버튼. 대안 제시는 v1 제외(인지용 표식). 색은 앰버 — "불안이 놓침보다 나쁘다"
- PR 표기: 검사가 아니라 도구층 상시 안내 문구

## §4 라우팅·화면·컴포넌트

- **`/generate`**(작업대) · **`/clients`**(클라이언트 관리) — 최상위 라우트. 신규 레이아웃: `MemberProvider` + 사이드바(마지막 방문 wsId를 localStorage로, 없으면 첫 워크스페이스). 사이드바 nav에 두 항목 추가
- 진입점 A: 덱 `TweetCard` 풋터·보관함 `CandidateCard`에 "초안 만들기" 액션 → `/generate?ref=<tweetId>`
- 진입점 B: 작업대 "레퍼런스 추가" → `RefPickerSheet` 인라인 시트 — 전체/워크스페이스 세그먼트 + 태그 필터 + **메모 있는 것 우선 정렬** + 상한 8 안내(이유 병기). 같은 트윗이 여러 워크스페이스에 있으면 1행으로 합치고 메모 전부 + 출처 표기
- 클라이언트 페이지: 단순 CRUD 폼(클리닉 서술·금지 표현 / 시술 목록·시술별 필드). 시안 없이 진행(사용자 합의)

초안 카드 = X 실측 (spec 고정값):

| 항목 | 값 |
|---|---|
| 카드 폭 / radius / 그림자 | 600px / 16px / 없음(테두리만) |
| 패딩 / 아바타 | 12px 16px / 40px 원형(멤버 색 + 이니셜) |
| 이름 줄 / 본문 | 15px·lh20px(이름 700 + `· 초안 · 방금`) / 15px·lh20px |
| 액션 행 | 19px 아이콘 + 13px — 편집 · 다른 각도로 · 복사 · 글자수 |
| 넣지 않는 것 | 인증 배지 · 지표 바 · 이미지 플레이스홀더 (없는 데이터는 자리도 안 만듦) |

- 도구층(회색 #f7f9f9): 검수 표식 행 + 근거 풋터(`참고 N건 · 형식+앵글` 펼침 / 우측 `클라 · 시술 · 모델`) — 표면 2층 문법(회색=도구, 흰색=X 콘텐츠) 유지
- 편집: X 컴포즈 모달 구조 — ✕ / "원본과 비교" / 아바타 40 / 입력 **20px·lh24px** / 하단 표식·참고 요약 바 / 원형 카운터 + 저장 36px
- 복사: 단문=본문 그대로. 스레드=트윗별 개별 복사 + 전체 복사(`---` 구분)
- `MediaGrid` 재사용 — `media` 0건이면 null 반환으로 아무것도 안 그려짐. `TweetCard`(13 props, `StoredTweet` 결합)는 재사용하지 않고 `DraftCard` 신규, 규격은 토큰 공유
- 다크모드 없음(라이트 고정). 시안: `.superpowers/brainstorm/*/content/workbench.html` (gitignore)

## §5 상태·에러 (체크리스트 G·N축)

- 생성 대기: 카드 모양 스켈레톤 + "원고 작성 중… 보통 15~30초"(12초 임계 사전 고지) + 취소. **취소 = 대기 해제** — 비스트리밍이라 서버 호출은 완료되고 초안은 저장됨("취소해도 완성되면 목록에 저장됩니다" 고지)
- refusal·과부하·429: 평문 원인 + 재시도 버튼. 스택트레이스 노출 금지
- 빈 상태: 클라이언트 0 → "클라이언트를 먼저 등록하세요 → 등록하러 가기" / 레퍼런스 0 = 백지 생성 허용 / 초안 0 → 기능 설명 + CTA
- 생성 버튼에 비용 표기: "원고 만들기 (약 $0.1 이하)" — 브리핑 관례

## §6 테스트·검증 (레포 관례: 실 DB, test- 접두 자가 정리)

- `xLength` — 가중 카운트(CJK 2·이모지 2·URL 23)
- 프롬프트 조립 — **토글 끈 요소의 블록 부재** 검증(반영 계약의 핵심), 참고 모드별 지시 차이, 최소 1요소 검증
- `flagMedicalAd` + banned_phrases 매칭
- `clientStore`·`draftStore` CRUD, 스냅샷 저장, edited/content 분리
- refusal 처리 — fake client 주입(`callLLM`의 client 파라미터 기존 지원)
- `smoke:generate` — 실호출 1회(~$0.07), 기존 smoke 패턴
- 린트 기준선 24 유지

## 범위 밖 (이번에 하지 않음)

인플루언서 톤 반영 · 이미지 첨부/생성 · 롱포스트 · LLM 레퍼런스 추천 · 보관함 다중 체크 진입 · OpenRouter 어댑터·모델 선택 UI · 표식 대안 문구 제시 · 공용 포맷 라이브러리(당분간 `#형식` 태그 규약 + 전체 범위로 대체) · 보관함 페이지 "전체" 보기 · Reading 타이포 스케일 전역 상향(별도 커밋) · `workspace.client_id` 연결

## 향후 확장 지점 (이번 설계가 열어두는 것)

- **이미지**: `posts[].media` 채우면 `MediaGrid`가 코드 변경 0으로 렌더. 확장 시 X 구조 그대로(그리드·radius 16)
- **프로바이더**: `llm.ts` 한 층의 어댑터로 닫힘 (§3)
- **수정 학습**: `content` vs `edited` 차이가 데이터로 축적 — 추후 프롬프트 개선 재료
- **공용 포맷 라이브러리**: `#형식` 태그 실사용이 확인되면 정식 엔티티로 승격 (원칙 6)
