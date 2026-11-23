# 인계 — 방문 한 번에 게시물 여러 개 (ISSUE-016), 2026-11-09

## 무엇을 왜
- ISSUE-016(moeka, 11/9): "예약 추가가 안되는 이유가 뭘까요?" — 화면: 마인드스킨클리닉_10월 방문협찬의 한 방문협찬 작업(방문 9/2, 11/5 게시).
- 실제 문의(koo 확인): **방문협찬 한 번에 인플이 게시물을 2개 올리는 경우를 어떻게 처리하나.** 모에카님은 게시된 작업에 무언가를 붙이려고 꺼진 [이 작업에 예약 추가]를 눌렀다.
- 버튼이 꺼진 이유: `src/components/reservations/ReservationSection.tsx:436` `!!task.postedAt` — 게시된 작업은 예약 추가 불가. 이유 안내가 화면에 없다(인플 미배정·클리닉 미연결만 안내 있음).

## 이미 정한 규칙 (ISSUE-010, 11/5)
- **게시물 하나 = 작업 하나.** 업로드 여러 건 협찬은 업로드마다 작업, 금액은 한쪽·나머지는 '비용 없음'(no_cost). '업로드 건수' 칸은 만들지 않음.
- 같은 주 함께 보내기(settlementAuto.togetherFor)가 두 번째 게시물까지 기다렸다 함께 정산 요청을 보낸다.

## koo 결정 (11/9): 2번안 진행
게시된 방문협찬 작업 패널에 **[같은 방문의 게시물 추가]** → 같은 인플·같은 방문일·비용 없음으로 **연결된** 작업 생성.

## 메인 세션 검토 결과 (근거 파일)
1. 캠페인·작업 관리
   - 연결 없으면 새 작업이 예약 없는 방문 작업으로 보여 "예약 상세가 없는 기존 방문 작업"+[예약 추가]가 뜨고, 카드 클릭 시 예약 창이 열림(`campaignFlowView.ts:41 awaitsReservation`).
   - 단계: 게시 전 'unregistered'→대기, 게시 후 posted+noCost → 'completed'(`reservationPolicy.ts:83 visitPhase`).
   - 방문 수: 캠페인·확장(activeVisitCount 등)에서 방문 2건으로 셈 → 연결된 작업은 방문 수 제외, 게시물 수엔 포함.
   - ISSUE-011(게시일 기준 주차 캠페인 이동, 미착수)과 만나면 두 게시물이 다른 주차로 갈 수 있음 → 연결 칸이 있으면 이어 보여 줄 수 있음.
2. 데이터
   - no_cost는 정산 요청에서 빠짐(`settlementStore.ts:97`) → 이중 지급 없음. 마케팅 비용 API도 0원.
   - 연결 정보 없음 → **campaign_task에 '같은 방문의 원래 작업' 칸 추가 추천(추가만, 다음 마이그레이션 089 — 088은 기타 협찬 브랜치 cb-koo/other-task-type가 사용 중, 미머지).**
   - 원래 작업 취소·삭제 시 연결 작업 처리(추천: 함께 취소할지 묻기).
3. 성과
   - 게시물별 측정·캠페인 CPV(총비용÷총조회, `campaignFlowView.ts:232`)·리포트 게시물 수는 문제없음.
   - ⚠️ 작업별 CPV(`campaignFlowView.ts:240 taskPerfExtra`)와 인플 성과 CPV 중앙값(`influencerPerformance.ts:43 taskCpv`)은 첫 게시물이 비용 전체를 떠안아 비싸 보이고 두 번째는 빈칸 → 방문 묶음 CPV(방문 비용÷두 게시물 조회 합) 필요. **이번 범위 포함 여부 koo 결정 대기.**

## 구현 범위 (추천, koo 시안 확인 후)
1. campaign_task 연결 칸(089, 추가만·멱등·not valid 관례)
2. 게시된 방문협찬 패널 [같은 방문의 게시물 추가]
3. 연결된 작업: 예약 칸 숨김, "○○ 작업과 같은 방문(9/2)" 표시, 방문 수 제외
4. (결정 대기) 방문 묶음 CPV — 작업 표·인플 성과
5. 꺼진 [예약 추가] 아래 이유 안내 한 줄
6. 확장 API에 연결 칸 노출 + 방문 수 제외 → 태정님 공유(docs/api/extension-product-local-handoff.md)

## 지킬 것
- AGENTS.md(UX 원칙, 업데이트 소식, 마이그레이션 규칙). koo 선호: 한 행 한 줄, 14~15px, '·' 남발 금지(쉼표), 짧은 명사형 라벨, 시안 먼저.
- 예약 코드(src/components/reservations, reservationPolicy, extension*)는 태정님 영역 — 최소 변경, 바꾸면 목록으로 보고.
- 정산팀 Item(export)에 키 추가 금지(엄격 스키마).
- 테스트는 연습용 DB(.env.staging)만. 운영 DB(.env)는 읽기만.
- 스테이징 배포 시 .env를 잠시 치우고(`npm run deploy:staging`), 배포 중 DB 테스트 금지(마이그레이션 교착).
