# /generate 한국어 대역 설계 (2026-08-10, 워크벤치 4차)

## 배경

원고는 일본어로 생성되는데 검수·관리하는 한국인 팀원 다수가 일본어를 모른다. 현재는 카드의 "🌐 번역 보기"(버전 원문 해시 키 캐시, 재과금 없음)가 유일한 경로 — 테이블·칸반 미리보기는 일본어 원문뿐이고, 새 원고마다 버튼을 눌러야 한다.

**확정 방향 (사용자 선택 A+B)**:
- **A. 캐시 번역을 미리보기에 활용** — 무비용, 프론트 변경
- **B. 생성·다시쓰기 시 한국어 대역을 자동 생성해 캐시에 저장** — 근본 해결, 서버 변경

## 핵심 설계 결정

### 번역 생성은 기존 `translateDraftPosts` 재사용 (별도 싸구려 호출, 같은 톤·용어집)
콘텐츠 모델의 출력 스키마에 한국어를 끼워 넣는 방식(같은 호출)은 채택하지 않는다:
- 프롬프트·출력 스키마 변경이 /prompt 오버라이드·기존 프롬프트 테스트와 얽히고, 일본어 본문 품질에 다중 과업 간섭 위험
- 콘텐츠 모델(비싼 토큰)로 번역까지 하는 것보다, 기존 번역 경로(경량 모델, 호출당 1원 미만·주석 실측)가 더 싸다
- 기존 "번역 보기"와 완전히 같은 용어집·톤 → 표시 일관성

### 캐시 키는 현행 그대로(원문 해시), 조회는 서버가 대신
`draft.translation`은 `hashSource(JSON.stringify(texts))` 키 맵(기존 translate 라우트와 동일). `hashSource`가 node:crypto 동기 해시라 클라이언트 재현이 부적합하므로, **`DraftRow`에 서버 계산 파생 필드 `koLatest: string[] | null`을 추가** — 목록/단건 조회 시 최신 버전(edited ?? content) 텍스트의 해시로 캐시를 찾아 실어 보낸다. 클라이언트는 필드만 읽는다.

## B — 서버 변경

- **generateDraft**: 구조화 출력 파싱 후, 시안별로 `translateDraftPosts(texts, client)`를 병렬 호출(요청의 mock client를 그대로 전달 — 테스트 가능성). 성공한 시안은 insert 시 `translation: { [hash]: posts }`로 저장. **실패(null)·예외는 조용히 생략** — 대역은 부가물이며 생성을 절대 막지 않는다. 캐시가 없으면 기존 번역 버튼 경로가 그대로 커버.
- **rewriteDraft / regeneratePost**: 새 버전(edited) 확정 후 같은 방식으로 번역해 기존 `updateDraft` 호출의 translation에 병합(`{...draft.translation, [hash]: posts}`).
- **insertDraft**: 입력에 `translation?: DraftTranslation | null` 추가(컬럼은 기존 존재 — 마이그레이션 불필요).
- 사용량 집계는 `callLLM('anthropic.draftTranslate')` 채널 그대로 — 기존 '원고 번역' 집계에 합산.
- 기존 translate 라우트는 무변경 — B가 실패한 원고·과거 원고의 소급 경로로 그대로 동작(같은 해시 키라 중복 과금 없음).

### 테스트 정합
- `generate.test.ts`의 기존 fake LLM은 번역 호출에도 draft 형태 JSON을 반환 → `translateDraftPosts`가 null을 반환하고 조용히 생략되므로 **기존 테스트는 무변경 통과**해야 한다(이것이 침묵 실패 설계의 검증이기도 함).
- 신규 테스트: 프롬프트 내용으로 분기하는 fake(원고 요청→posts JSON, 번역 요청→{"1":"..."} JSON)로 ① 생성 직후 translation에 해시 키 저장 ② listDrafts의 koLatest에 노출 ③ 번역 실패 시에도 생성 성공 + translation null을 검증.

## A — 프론트 변경

- **DraftRow.koLatest** 사용: 테이블 '원고' 셀과 칸반 미니 카드 미리보기에서 `koLatest[0]`의 첫 줄이 있으면 우선 표시, 없으면 일본어 원문(`draftPreviewLine`).
- **번역본임을 표시**: 한국어 표시 시 앞에 🌐 마커(+ `title="한국어 번역으로 표시 중 — 원문은 카드에서"`). 번역본을 원문인 척 보여주면 라벨-값 불일치(원칙 4).
- `draftViews.ts`에 `draftKoLine(d): string | null`(koLatest 첫 포스트 첫 줄, 없으면 null) 추가 + 단위 테스트.
- 피크·카드 뷰의 DraftCard는 무변경(번역 보기 버튼 현행 유지 — 전문 확인용).

## 경계 조건

- 편집(DraftEditModal)으로 원문이 바뀌면 해시가 달라져 koLatest가 자연히 null → 원문 표시로 복귀(스테일 번역이 붙지 않음 — 해시 키 설계의 이점).
- count>1 배치: 시안별 독립 번역, 일부 실패 허용(성공한 것만 저장).
- 생성 응답(POST /api/drafts)이 반환하는 rows에도 koLatest 포함(같은 toRow 경유) — 생성 직후 목록에서 바로 한국어 미리보기.
- 번역 추가로 생성 체감 시간 소폭 증가(경량 모델 1호출) — 스켈레톤 문구 변경 없음(15~30초 범위 내).

## 검증
- 신규·기존 단위 테스트(실 DB) + tsc 0 + lint 24 기준선. 화면은 사용자 dev 검수.

## 범위 제외 (백로그)
- 과거 원고 일괄 소급 번역(C안) — B 배포 후 요구 확인 시
- DraftCard가 koLatest로 번역을 자동 표시(현행 버튼 유지)
- 테이블/칸반에서 원문↔번역 토글
