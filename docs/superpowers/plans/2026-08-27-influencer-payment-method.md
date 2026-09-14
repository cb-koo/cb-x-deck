# 계획: 인플루언서 정산 결제 수단

스펙: `docs/superpowers/specs/2026-08-27-influencer-payment-method-design.md`. 서브에이전트 구현, 파일 소유 분리, 각 작업 리뷰 후 커밋. 원장: `$(git rev-parse --git-path sdd)/progress.md`.

## 모델 배정

| 작업 | 모델 | 이유 |
|---|---|---|
| T1 순수 라이브러리 | sonnet | 타입·검증·연산·테스트 — 입출력이 스펙에 확정된 기계적 작업 |
| T2 마이그레이션 + 스토어 | sonnet | updatePricing 복제 수준, 실 DB 테스트 관례 있음 |
| T3 라우트 + 패널 UI + DealTab | opus | 다파일·상태 갱신·폼 UX·접근성 — 판단 많음 |
| T4 타임라인 문구 | sonnet | 케이스 추가, 타입 정리 |
| T5 가져오기 스크립트 + 템플릿 | sonnet | CLI·CSV 파싱·드라이런 — 기계적 |
| 리뷰·최종 검토·updates 글 | fable(주 세션) | 오케스트레이션·통합 판단 |

## 웨이브

**W1 — T1** (`src/lib/influencerPayment.ts`, `src/lib/influencerPayment.test.ts`)
- 스펙 §2 타입·`parsePaymentMethodInput`·`applyPaymentOp`·`describeMethod`·`formatFee`·`getDefaultPaymentMethod`·`PAYMENT_TYPE_LABEL`·`PAYMENT_FIELD_LABEL`.
- 테스트: 유형별 필수 필드·이메일·수수료 범위·첫 수단 기본·기본 삭제 시 승계·setDefault 무변경·update 무변경 0건·불변식 위반 throw·유형 변경 시 옛 필드 제거.

**W2 — 병렬 (T1 머지 후)**
- T2 (`migrations/036_influencer_payment_method.sql`, `src/lib/influencerStore.ts`, `src/lib/influencerStore.test.ts`): 컬럼·constraint, `InfluencerDetail.paymentMethods`, `updatePaymentMethods`, `InfluencerAutoEvent`/`LogPayload` 확장, 실 DB 테스트(add→setDefault→remove 승계·로그 payload). 로컬 DB 적용은 `scripts/apply-migrations.sh` 관례 확인.
- T3 (`src/app/api/influencers/[id]/payment-methods/route.ts`, `src/app/influencers/PaymentSection.tsx`, `src/app/influencers/DealTab.tsx`): 스펙 §2 라우트·§3 UI 전부. T2의 `updatePaymentMethods` 시그니처는 스펙대로 가정.
- T4 (`src/app/influencers/Timeline.tsx`): `payment_method_changed` 문구·묶음 라벨·`LogPayload` 확장에 따른 캐스팅 정리. actor 없는 auto 로그의 표시(가져오기) 확인.
- T5 (`scripts/import-payment-methods.ts`, `scripts/templates/payment-methods.csv`): 드라이런 기본·`--apply`·중복 건너뜀·오류 1건이면 전체 중단. T2의 `updatePaymentMethods`를 호출.

**W3 — 통합 (fable)**: tsc·lint 24·build·`node --import tsx --test` 관련 파일·npm test, 3010 빌드 QA, 리뷰 픽스, `src/content/updates.ts` 항목(새 기능), 템플릿 CSV를 `~/claude-outputs/`에도 복사해 koo에게 전달.

## 공통 규칙(브리프에 포함)
- AGENTS.md UX 원칙 6개, `node_modules/next/dist/docs/` 확인, 기존 관례(PricingSection·updatePricing·Timeline) 답습, 주석은 "왜"만, 한국어 UI 문구, 코드 외 파일 만들지 않기, 커밋은 하지 않고(주 세션이 리뷰 후 커밋) 완료 보고서를 `$(git rev-parse --git-path sdd)/pay-task-N-report.md`에.
