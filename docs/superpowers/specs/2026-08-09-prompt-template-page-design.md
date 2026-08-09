# AI 지시문 편집 페이지 설계 (프롬프트 템플릿 확인·편집)

2026-08-09 · 출발점: "콘텐츠 생성 시 프롬프트가 어떻게 적용되는지 알 수 있는지?" → 템플릿 편집 페이지로 확정.
업계 패턴 조사(Agenta·Literal AI·Fluiq 등) 결과를 반영: 필드형 편집(ChatGPT custom instructions 계열) +
미리보기 + **버전 스냅샷·복원**(팀 공유 편집의 업계 기본기로 확인돼 백로그에서 승격).

## 목적

원고 생성 프롬프트의 고정 문장들을 비개발자가 화면에서 확인·수정할 수 있게 한다.
수정은 팀 전체·이후 모든 생성(생성·다시 쓰기·한 트윗 재생성)에 즉시 적용된다.

## 편집 대상 — 고정 문장 6개만

| 키 | 현재 기본값 출처 | 화면 라벨 |
|---|---|---|
| `system` | `DRAFT_SYSTEM` | 역할 지시 (AI가 어떤 사람으로서 쓰는지) |
| `modeForm` | `MODE_RULE.form` | 레퍼런스 "형식만 참고" 규칙 |
| `modeAngle` | `MODE_RULE.angle` | 레퍼런스 "앵글만 참고" 규칙 |
| `modeBoth` | `MODE_RULE.both` | 레퍼런스 "형식+앵글" 규칙 |
| `noCopy` | 표절 금지 문장 | 레퍼런스 베끼기 금지 |
| `hook` | 훅 지시 문장 | 첫 문장(훅) 지시 |

**편집 제외(코드 고정)**: 글자 수·형식(단문/스레드)·시안 수 지시·금지 표현 헤더 — 계산값이 치환되는
문장이라 편집을 열면 치환 실수로 조용히 깨질 수 있다. 클라이언트 정보·메모·방향성은 데이터라 대상 아님.
빈 값으로 저장한 필드는 기본값으로 동작(지워서 프롬프트가 망가지는 사고 방지).

## 저장 모델 — append-only 버전

- **마이그레이션 `021_prompt_template.sql`**: `prompt_template_version(id uuid pk, overrides jsonb,
  member_id uuid null references member(id) on delete set null, created_at timestamptz)`.
  RLS enable(정책 없이 — 앱은 직접 Postgres라 무영향, anon 키만 차단. 신규 테이블 관례).
- 저장할 때마다 행 1개 insert(전체 스냅샷). **현재값 = 최신 행**. 행이 없으면 전부 기본값.
- `overrides`에는 **기본값과 다른 필드만** 저장 — 기본값 그대로인 필드는 키를 넣지 않는다.
  (코드 기본값이 나중에 개선되면 편집 안 한 필드는 자동으로 새 기본값을 따라간다.)
- 복원 = 이력에서 옛 버전을 골라 폼에 불러온 뒤 사용자가 저장(새 행 insert — 이력은 항상 선형,
  초안 history와 같은 원칙).

## 적용 경로

- `generatePrompt.ts`: `PromptOverrides` 타입 도입, `buildUserPrompt(input, overrides?)` +
  `draftSystem(overrides?)` — 기본값 상수는 export해 페이지·미리보기·저장 로직이 공유.
- `generate.ts`: `generateDraft`·`rewriteDraft`·`regeneratePost`가 호출 시작 시 최신 오버라이드를
  1회 로드해 시스템 프롬프트와 buildUserPrompt에 전달. (regeneratePost는 자체 인라인 프롬프트라
  `system`만 적용.) 생성당 SELECT 1회 추가 — 무시 가능한 비용.

## API

- `GET /api/prompt-settings` → `{ overrides, defaults, versions }` (versions = 최근 20개:
  id·overrides·createdAt·memberName). `requireAllowedUser`.
- `PUT /api/prompt-settings` body `{ overrides }` → 검증(알려진 키만, 문자열, 각 2000자 이내) 후
  insert. `requireMember`로 저장자 귀속(초안 관례 — 클라이언트 body의 member 무시).

## 페이지 `/prompt` (GlobalShell)

- 제목 "AI 지시문" + 설명 "원고를 만들 때 AI에게 주는 지시문이에요. 여기서 바꾸면 팀 전체의
  이후 생성에 바로 적용돼요."
- 필드 6개: 라벨(사용자 언어) + "이 문장이 하는 일" 캡션 + textarea + 필드별 **기본값 복원** 버튼
  (기본값과 같으면 버튼 숨김 — 거짓 어포던스 방지).
- **미리보기**: 편집 중 값으로 `buildUserPrompt`(순수 함수, 클라이언트에서 직접 호출)를 샘플
  데이터(가상 클리닉·시술·레퍼런스+메모)로 렌더 — 시스템 프롬프트도 함께 표시. 편집 즉시 반영.
  샘플임을 명시("실제 생성은 그때의 클라이언트·레퍼런스가 들어가요").
- 저장: 상단 고정 아님, 폼 하단 버튼 + "저장됨 ✓"(클라이언트 페이지 패턴). 미저장 변경 상태로
  이탈 방지는 범위 밖(v1 — 설정 페이지는 체류가 짧고 항목이 적음).
- **변경 이력**(접이식): 최근 20개 — "N일 전 수정(멤버명) · 바꾼 필드: 역할 지시, 훅" + [이 버전
  불러오기] → 폼에 채움(저장은 사용자가). 이력 0개면 섹션 숨김.
- 진입점: 생성 페이지(/generate) 상단에 "AI 지시문" 링크. 사이드바엔 넣지 않는다(저빈도).

## 범위 밖 (백로그)

시험 생성 실행(비용 액션, opt-in 버튼 후보) · 워크스페이스/클라이언트별 템플릿 · A/B · 권한 분리 ·
편집 중 이탈 가드 · 형식 지시 등 계산값 포함 문장의 편집.

## 검증

- `generatePrompt` 오버라이드: 순수 함수 단독 테스트(각 필드 오버라이드가 출력에 반영, 미지정=기본값,
  빈 문자열=기본값).
- `promptSettings` 스토어: 실 DB 테스트(행 없음=빈 오버라이드, 저장→최신 반영, 이력 순서).
- 라우트·페이지: 하네스 없음 — tsc·lint(24)·build + 사용자 화면 확인.
