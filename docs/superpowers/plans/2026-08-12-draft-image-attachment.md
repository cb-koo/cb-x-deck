# 초안 이미지 첨부 — 구현 계획

설계: `docs/superpowers/specs/2026-08-12-draft-image-attachment-design.md`

서브에이전트 병렬 실행. **파일 소유권을 겹치지 않게** 웨이브로 나눈다 — 같은 파일을 두 에이전트가 동시에 고치면 편집이 유실된다.

## 웨이브 1 — 기반 (5개 병렬, 서로 의존 없음)

| # | 작업 | 소유 파일 | 모델 |
| --- | --- | --- | --- |
| T1 | 버킷 마이그레이션 | `migrations/024_draft_media_bucket.sql` | Sonnet |
| T2 | 업로드·파일명·다운로드·복사 헬퍼 + 단위 테스트 | `src/lib/draftMedia.ts`, `src/lib/draftMedia.test.ts` | Sonnet |
| T3 | PATCH `media` 검증 + 테스트 | `src/app/api/drafts/[id]/route.ts`, 해당 테스트 | Sonnet |
| T4 | `renderOverlay` 슬롯 추가 | `src/components/MediaGrid.tsx` | Haiku |
| T5 | 서명 URL 훅 | `src/components/useSignedMedia.ts` | Sonnet |

T2가 가장 크다(순수 로직 + TDD). T4는 prop 하나 추가라 최소.

## 웨이브 2 — UI (2개 병렬, T2·T4·T5에 의존)

| # | 작업 | 소유 파일 | 모델 |
| --- | --- | --- | --- |
| T6 | 카드 첨부·hover 액션·전체받기·"편집됨" 수정 | `src/components/DraftCard.tsx`, `src/app/generate/page.tsx` | **Opus** |
| T7 | 모달 첨부 | `src/components/DraftEditModal.tsx` | Sonnet |

T6이 가장 위험하다 — 280줄 밀집 컴포넌트에 기존 요소 9종이 이미 있다.

## 웨이브 3 — 이월 안내 (단독, T6과 파일 충돌)

| # | 작업 | 소유 파일 | 모델 |
| --- | --- | --- | --- |
| T8 | 스레드 축소 시 이미지 소실 안내 | `src/lib/generate.ts`, `src/components/DraftCard.tsx`, `src/app/generate/page.tsx` | **Opus** |

T6과 파일이 겹쳐 반드시 순차.

## 검증 (전 웨이브 후)

1. `npx tsc --noEmit`
2. `npm run lint` — 기준선 24개 유지
3. `npm run migrate` — **024 적용 성공 여부가 여기서 갈린다**(`storage.objects` 정책 권한). 실패 시 설계 §A의 폴백.
4. `npm test` — 실 DB, 약 4분
5. 화면 확인은 OAuth 게이팅으로 사용자만 가능 — 배포 후 요청

`.env`가 이 워크트리에 없다 — 3·4를 돌리려면 `vercel link` 후 `vercel env pull`이 먼저다(대화형이라 사용자 개입 필요).
