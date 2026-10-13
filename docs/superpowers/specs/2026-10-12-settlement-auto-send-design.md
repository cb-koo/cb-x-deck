# 정산 요청 자동 전송 — 설계

- 날짜: 2026-10-12 · 브랜치 `cb-koo/settlement-auto`(origin/main `bd5c630`에서)
- 마이그레이션 `071`(추가만) — 067·068은 미머지 chart-kit 몫, 070은 방문협찬 예약이 먼저 씀
- 시안: https://claude.ai/artifact/QYgcc6suM2tnAQJaa94chi (v3, koo 10-12 "이 방향으로 일단 가자")

## 1. 왜 (koo 10-12)

게시 확인된 작업은 정산 화면 '검토 대기'에서 사람이 골라 [요청 만들기]를 눌러야 정산팀으로 넘어간다. 실제로는 기본값 확인뿐이다(운영 126건: 전부 한 사람이 보냄·분류 126/126 기본값·마감 대부분 기본값). 검토 단계를 없애고 자동으로 넘긴다. 결제 수단 없는 인플 작업은 등록되면 그때 넘어간다.

## 2. 결정

1. **매주 월요일 07:00(서울)에 한꺼번에 보낸다.** 정산팀은 이미 월요일에 지급한다(지급 119건 중 90건 월요일, 목·금 요청도 다음 월요일 지급). 마감 = 기존 규칙(보낸 주의 다음 주 월요일) → 늘 7일. 24시간 방식의 주말 마감 문제(토 확인→일 전송→다음 날 마감)도 없다.
2. **대상 = 이번 주 월요일 07:00 이전에 게시 확인된 작업.** 5분마다 확인 — 7시에 서버가 멈춰도 복구되면 나가고, 그 뒤에 고친 작업(결제 수단 추가 등)은 다음 주를 기다리지 않고 5분 안에 나간다.
3. **자동으로 안 보내는 작업**
   - 막힘(🔴) 전부: 명부 없음·결제 수단 없음·PayPay 수취 정보 없음·클라이언트 없음·분류 없음·참고 링크 없음(RT 제외)·RT 증빙 없음
   - 첨부 없음: 방문 동의서 없음(지금은 🟡 — 자동 전송에선 막는다)
   - 내림·안 보임 → '확인이 필요해요'(사람이 [확인하고 보내기] 또는 [보내지 않기])
   - [보내지 않기] 한 작업, 요청이 취소된 적 있는 작업 → '멈춘 작업'(사람이 [보내기])
   - RT의 참고 링크 없음(🟡)은 통과 — RT는 증빙 이미지로 확인한다(koo).
4. **요청자** = 작업을 만든 사람 → 없으면 캠페인을 만든 사람 → 없으면 이름 '자동 전송'(멤버 없음). 사람이 버튼으로 보낸 건은 누른 사람.
5. **분류** = 설정의 유형별 기본값만(`defaultFor`). 자동 전송은 "요청자의 마지막 인용RT 분류"를 쓰지 않는다(요청자마다 결과가 달라지는 것 방지). 기본값이 없는 유형은 '고쳐야 보내져요'. 운영 설정(09-18)은 4유형 모두 기본값이 있다.
6. **정산팀이 받는 데이터 모양은 그대로.** 자동/수동 표식·멈춤·확인 기록은 우리 칸에만(10-07 엄격 스키마 사고).
7. **보낸 뒤 내려간 글**: 지급 전이면 요청 내역에 경고 + [그대로 두기]/[요청 취소]. 지급 후면 기록만.

## 3. 데이터 (071)

- `campaign_task.posted_confirmed_at timestamptz` — 게시 확인한 순간. **트리거**가 채운다(posted_at이 비었다가 채워지는 모든 경로: 게시 확인 버튼·날짜 편집·게시물 연결·일괄 적재·스크립트, 배포 중 옛 코드 포함). 기존 게시 행은 마이그레이션이 `updated_at`(확인 시각과 같거나 늦음)으로 채운다 — 게시일 00:00으로 대신하면 월요일에 확인된 작업이 켜자마자 나간다(운영 10-13 발견). 판정의 `coalesce(…, posted_at 서울 00:00)`는 안전장치로만 남긴다.
- `campaign_task.settle_hold_at timestamptz, settle_hold_by uuid, settle_hold_by_name text, settle_hold_reason text` — [보내지 않기].
- `payment_request.created_via text not null default 'manual'` (`check in ('manual','auto') not valid`).
- `payment_request.removal_ack_at timestamptz, removal_ack_by_name text` — 보낸 뒤 내려감 [그대로 두기].
- `payment_request.sent_removed_on date, sent_unseen_on date` — 보낼 때 이미 있던 내림·안 보임. 이것과 다를 때만 "보낸 뒤 내려감"을 알린다(내림 날짜는 과거로 적힐 수 있어 날짜 비교로는 못 가른다).
- 트리거는 posted_at이 비면 확인 시각도 비운다(다시 확인하면 새로 찍힌다).
- `settlement_auto_run(id, started_at, finished_at, sent int, failed int, detail jsonb)` — 마지막 확인 시각·실패 표시용. 7일 지난 행은 실행 때 지운다.

처리 기록 칸 쓰기(멈춤·확인)는 `payment_request.updated_at`을 바꾸지 않는다 → 정산팀 폴링에 흐르지 않는다.

## 4. 판정 (순수 함수, `settlementAuto.ts`)

- `lastMondaySeven(now)` / `nextMondaySeven(now)` — 서울 기준.
- `classifyPending(cand, ctx)` → `attention | blocked | waiting | due | stopped`
  - stopped: 멈춤 있음 또는 취소 이력(활성 요청 없음)
  - attention: removed·unseen
  - blocked: 🔴 하나라도, 또는 no-agreement
  - due: 확인 시각 < lastMondaySeven(now) / waiting: 그 외(보내는 때 = nextMondaySeven)
- 화면 묶음: 확인이 필요해요(attention) · 고쳐야 보내져요(blocked) · 다음 월요일에 보내요(waiting + due — due는 "곧 보내요") · 멈춘 작업(stopped).

## 5. 보내기 (`settlementStore`)

- `sendTask(sql, taskId, { via, requester, allowAttention, allowStopped })` — **한 건 = 한 트랜잭션**. 작업 행 `for update`로 잠근 뒤 후보 재계산 → 검증(기존 createRequests 검증부 공유) → insert. 23505(활성 요청 유니크)는 "이미 나감". [보내기]는 멈춤을 지운다.
- `runAutoSend(sql, now)` — due 목록을 한 건씩 `sendTask(via:'auto')`. 한 건 실패는 기록하고 다음 건. 실행 기록 1행.
- 기존 `createRequests`(스토어)는 테스트·제자리 수정과 공유하는 검증 때문에 남기고, 화면이 쓰던 `POST /api/settlement/requests`·`GET /api/settlement/candidates`는 없앤다(규칙을 우회한 일괄 생성 입구를 남기지 않는다).
- 테스트 픽스처 핸들은 스윕 대상에서 뺀다(`TEST_FIXTURE_HANDLE_PG`).

## 6. 라우트

- `POST /api/settlement/auto-send` — 예약 실행 전용. `MEASURE_CRON_SECRET`(성과 자동 측정과 같은 시크릿) Bearer, 미설정이면 401.
- `GET /api/settlement/pending?campaignId=` — 묶음별 목록 + 요약(확인 필요 수·대기 수·다음 보내는 때·마지막 확인 시각·오늘 보낸 수).
- `POST /api/settlement/pending/[taskId]` — `{ action: 'send' | 'hold' | 'release' }`(+사유). send는 상황별 허용(attention·stopped 포함), 요청자 = 누른 사람.
- `POST /api/settlement/requests/[id]/removal-ack` — [그대로 두기].
- 예약 실행: `scripts/settlement-auto-send-cron.sql`(마이그레이션 아님, 환경별 1회, 기존 `measure_cron_secret` 재사용).

## 7. 화면

- 정산 탭 '검토 대기' → **'정산 요청 대기'**(탭 키 `candidates` 유지 → 기존 딥링크 그대로). 체크·분류·마감 칸·[요청 만들기] 없음.
- 맨 위 한 줄: "오늘 자동으로 보낸 작업 N건 · 요청 내역에서 보기 → · 마지막 확인 HH:MM". 15분 넘게 확인 없으면 빨간 줄.
- 묶음 4개 + 행 버튼(시안 그대로). 빈 화면 문구.
- 요청 내역: 요청자 "자동 전송 · 작업 만든 사람 X", 보낸 뒤 내려감 경고 줄.
- 요청 취소 창 문구: "자동으로 다시 보내지 않아요 — '정산 요청 대기' 탭 '멈춘 작업'에서 [보내기]".
- 캠페인 필터 줄: 확인 필요(attention+blocked) > 0 → 주황 "정산 확인 필요 N건 · 정산에서 보기 →", 아니면 대기 > 0 → 회색 "정산 자동 진행 N건 · M/D 월 7시에 보내요", 아니면 "정산 대기 없음".
- 설정 탭: "기본 분류가 없는 유형은 자동으로 못 보내고 '고쳐야 보내져요'에 남아요".
- 업데이트 소식 1건(개선 — 쓰던 방식이 바뀜).

## 8. 배포 순서

1. 머지 → 운영 빌드가 071 적용 → 코드 배포. 이 시점엔 예약 실행이 없어 자동 전송은 안 일어난다(화면은 바뀜, [지금 보내기]로 수동 가능).
2. **켜기 전 미리보기:** 배포 뒤 '정산 요청 대기' 화면의 '다음 월요일에 보내요(곧 보내요)' 묶음이 곧 켜질 때 나갈 목록이다. 071 이전에 게시 확인된 작업은 마지막 수정 시각으로 판정된다 — 다른 곳에서 이미 지급한 건이 섞여 있으면 [다른 곳에서 정산함]이나 [보내지 않기]로 먼저 뺀다(운영 10-12 기준 후보 0건).
3. koo 확인 후 운영 DB에 `settlement-auto-send-cron.sql` 1회 실행 → 그 뒤 첫 실행부터 자동(이미 지난 월요일 기준으로 판정).
4. 연습용 DB는 스테이징 주소로 같은 스크립트(QA용).
