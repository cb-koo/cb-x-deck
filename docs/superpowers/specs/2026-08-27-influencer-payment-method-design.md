# 인플루언서 프로필: 정산 결제 수단 — 설계 스펙

- 날짜: 2026-08-27
- 브랜치: `cb-koo/influencer-profile` (이 브랜치는 **입력·관리 화면과 데이터**까지. 이 데이터를 읽어 결제 요청을 만들고 정산 프로덕트로 보내는 일은 `cb-koo/payment-data`가 이어서 한다)
- 근거: 슬랙 결제요청 3채널(PayPal·PayPay·계좌이체) 756건 분석(`~/claude-outputs/20260827_결제요청양식_슬랙3채널_필드정리.md`) — 정산 양식 11항목 중 **인플루언서별 결제 수단·수취 정보가 어디에도 없다**가 핵심 공백. koo 결정(08-27): 기본 수단 1개 + 필요 시 다른 수단 추가 / 계좌번호 등은 그대로 노출 / 초기 데이터는 파일로 제공.

## 0. 목적

인플루언서마다 협업 비용을 **어디로 보내는지**(결제 수단·수취인·계좌/이메일·통화·수수료 처리)를 프로필에서 입력·수정하고, 그중 하나를 **기본 수단**으로 둔다. 바꾼 내역은 활동 기록에 남아 정산 사고 때 "언제 누가 바꿨나"를 추적할 수 있다. 정산 요청 자동화(payment-data)가 이 값을 그대로 읽어 쓴다.

## 1. 실데이터에서 확인된 수단 3종과 필드

| 수단 | 수취인 | 식별 정보 | 관찰 |
|---|---|---|---|
| PayPal | 수취인명 | 이메일 | 일부 인플은 **실수령 보장**(총액 = 순액 ÷ 0.95) |
| PayPay | 수취인명 | 양식에 **항상 빈칸** — 식별자 미확정 | 자유 텍스트 칸 + 안내문 |
| 계좌이체 | 예금주 | 은행 / 지점(선택) / 계좌번호 | 한국 은행(지점 없음)·일본 은행(지점명+코드) 혼재. 일본 계좌 +165엔 고정 수수료 사례 |

통화는 수단마다 다를 수 있다(한국 계좌 ₩, 일본 계좌·PayPay ¥, PayPal은 둘 다).

## 2. 데이터

### 컬럼 (마이그레이션 036)

```sql
alter table influencer add column if not exists payment_methods jsonb not null default '[]';
-- influencer_log.event_type check에 'payment_method_changed' 추가 (032 관례: drop + add)
```

별도 테이블이 아니라 jsonb 배열인 이유: 인플당 1~2개, 조회는 항상 인플 단위, 협찬 단가(`pricing jsonb`)와 같은 문법, payment-data는 요청 시점 **스냅샷**을 자기 테이블에 복사하므로 참조 무결성이 필요 없다.

### 타입 (`src/lib/influencerPayment.ts` — 순수, DB 없음)

```ts
type PaymentMethodType = 'paypal' | 'paypay' | 'bank';
type Currency = 'KRW' | 'JPY';            // influencerPricing의 Currency 재사용
interface PaymentFee =
  | { mode: 'grossUp'; percent: number }  // 실수령 보장 — 총액 = 순액 ÷ (1 - percent/100)
  | { mode: 'fixed'; amount: number };    // 고정 금액 추가(통화는 수단 통화)
interface PaymentMethod {
  id: string;                 // 서버 생성 uuid
  type: PaymentMethodType;
  isDefault: boolean;         // 배열이 비어 있지 않으면 정확히 1개가 true
  holder: string;             // 수취인명/예금주 — 필수, trim, 1~80자
  currency: Currency;         // paypay는 JPY 고정
  email?: string;             // paypal 필수 — 형식 검사(간단한 a@b.c)
  identifier?: string;        // paypay 수취 식별 정보 — 선택(미확정)
  bank?: string; branch?: string; account?: string;   // bank: bank·account 필수, branch 선택
  fee?: PaymentFee;           // 부재 = 수수료 없음
  memo?: string;              // 선택 한 줄(예: "월말 정산 희망")
  updatedAt: string;          // ISO
}
```

- **입력 타입** `PaymentMethodInput` = `PaymentMethod`에서 `id·isDefault·updatedAt` 제외. `parsePaymentMethodInput(v: unknown): PaymentMethodInput | string` — 통과하면 정규화된 값, 실패하면 **사용자에게 보일 오류 문구**(라우트가 400 body로 그대로 씀). 유형별 필수 필드 검사, 유형에 없는 필드는 버린다(paypal에 bank가 와도 저장 안 함).
- **연산** `applyPaymentOp(list, op, now, newId): { list, changes }`:
  - `{ kind: 'add', input, makeDefault?: boolean }` — 첫 수단이면 무조건 기본. `makeDefault`면 기존 기본 해제.
  - `{ kind: 'update', id, input }` — 필드 교체(유형 변경 허용 — 유형에 맞지 않는 옛 필드는 제거). 없는 id는 오류.
  - `{ kind: 'remove', id }` — 기본을 지우면 **남은 것 중 첫 번째**가 기본이 된다(로그 `default_changed` 추가 발생).
  - `{ kind: 'setDefault', id }` — 이미 기본이면 변경 0건.
  - 불변식: 비어 있지 않으면 `isDefault` 정확히 1개. 연산 후 검사해 위반이면 throw(버그 방어).
- **변경 기록** `PaymentMethodChange`:
  ```ts
  { action: 'added' | 'updated' | 'removed' | 'default_changed';
    type: PaymentMethodType; label: string;               // 예: "PayPal · SAWADA KEIKO", "계좌이체 · 신한 110543468512"
    fields?: Array<{ field: string; from: string | null; to: string | null }> }  // updated일 때 바뀐 필드만
  ```
  `describeMethod(m)` → label. 값은 그대로 기록한다(노출 결정 — 마스킹 없음). `update`에서 실제로 바뀐 필드가 0개면 변경 0건(불필요한 로그 방지 — pricing 관례).
- 표시 도우미: `PAYMENT_TYPE_LABEL`(PayPal/PayPay/계좌이체), `formatFee(fee, currency)`("실수령 보장 — 수수료 5%는 우리가 부담" / "송금 수수료 165엔 추가"), `getDefaultPaymentMethod(list)`.

### 스토어 (`influencerStore.ts`)

- `InfluencerDetail.paymentMethods: PaymentMethod[]` (getInfluencerDetail의 extra 조회에 컬럼 추가).
- `updatePaymentMethods(sql, id, op, actorId): Promise<{ paymentMethods, logs }>` — `sql.begin`: `select payment_methods … for update` → `applyPaymentOp` → update → 변경 1건당 `influencer_log(kind='auto', event_type='payment_method_changed', payload=change)` insert → 삽입한 로그 반환(updatePricing과 동일 구조).
- `InfluencerAutoEvent`에 `'payment_method_changed'`, `LogPayload`에 `PaymentMethodChange` 추가.
- `listOptions`는 건드리지 않는다(캠페인 비용 셀은 단가만 필요). payment-data가 필요하면 그때 확장.

### 라우트 (`src/app/api/influencers/[id]/payment-methods/route.ts`)

- `POST` body `{ input, makeDefault? }` → add / `PATCH` body `{ id, input }` 또는 `{ id, setDefault: true }` / `DELETE` body `{ id }`.
- 공통: `requireMember`, `isUuidLike(id)` → 404, 입력 검증 실패 → 400 `{ error: 문구 }`, 없는 method id → 404 `{ error: '결제 수단을 찾을 수 없어요 — 화면을 새로고침해 주세요' }`.
- 응답: `{ paymentMethods, logs }` — **배열 전체 스냅샷**. 클라이언트는 그대로 교체한다(pricing처럼 부분 병합하지 않는 이유: 연산이 id 단위라 병행 요청이 있어도 서버가 행 잠금으로 직렬화하고, 마지막 응답이 곧 최신 상태다. 단가는 키 단위 blur 저장이 여러 개 동시에 날아가서 병합이 필요했다).

## 3. UI — 거래 정보 탭, 협찬 단가 아래 패널 "정산 결제 수단"

```
┌ 정산 결제 수단 ───────────────────────────────────────┐
│ 협업 비용을 보낼 곳이에요. 기본 수단으로 결제 요청이       │
│ 만들어지고, 바꾸면 계정 정보 탭 기록에 남아요.             │
│                                                        │
│ ▣ 계좌이체 [기본]                     기본으로 · 수정 · 삭제│
│   예금주 オオクボナナ · ¥                                 │
│   三菱UFJ / 赤坂見附支店(064) / 0441321        [복사]     │
│   송금 수수료 165엔 추가                                  │
│ ▣ PayPal                              기본으로 · 수정 · 삭제│
│   수취인 SAWADA KEIKO · ¥                                 │
│   ucymk.ucymkk@gmail.com                        [복사]     │
│   실수령 보장 — 수수료 5%는 우리가 부담                   │
│                                                        │
│ + 결제 수단 추가                                        │
└────────────────────────────────────────────────────────┘
```

- **목록**: 수단마다 카드 1장(패널 안 연회색 바닥 `bg-x-bg`/테두리 — 캠페인 카드 문법). 첫 줄: 유형 라벨 + `기본` 배지(파란 채움, 텍스트로) + 오른쪽 동작. 둘째 줄: 수취인 · 통화 기호. 셋째 줄: 식별 정보 + `복사` 버튼(정산 담당이 그대로 붙여 쓰는 값). 넷째 줄(있을 때): 수수료 처리·메모. PayPay 식별 정보가 비어 있으면 `수취 정보 미입력 — PayPay 식별자는 정산 쪽 확인 후 적어 두세요`(회색).
- **동작**: `기본으로`는 기본이 아닌 카드에만(기본 카드에는 배지만 — 거짓 어포던스 회피). `삭제`는 2단계 인라인(`삭제` → `정말 삭제 · 취소`), `window.confirm` 금지. 기본 수단을 지우면 다음 수단이 기본이 된다는 안내를 확인 단계에 한 줄.
- **추가/수정 폼**(인라인, 카드 자리에서 펼침, 한 번에 하나만): 유형 select(먼저) → 유형별 칸: 공통 `수취인명`(계좌이체는 `예금주`), `통화`(PayPay면 ¥ 고정·비활성), PayPal `이메일`, PayPay `수취 식별 정보(선택)`, 계좌이체 `은행`·`지점(선택)`·`계좌번호`. `송금 수수료 처리` select: `없음` / `실수령 보장 — 수수료를 우리가 부담` (+ 비율 % 입력, 기본 5) / `고정 금액 추가` (+ 금액). `메모(선택)`. 추가 폼에는 `기본 수단으로` 체크(첫 수단이면 체크 고정·비활성 + "첫 수단은 기본이 돼요"). `저장`/`취소`. 저장 중 버튼 비활성·`저장 중…`.
- **검증 문구**(클라이언트 먼저, 서버 동일 규칙): "수취인명을 입력해 주세요", "이메일 형식을 확인해 주세요", "은행과 계좌번호를 입력해 주세요", "수수료 비율은 0보다 크고 100보다 작아야 해요", "금액은 0 이상 정수예요". 서버 400 문구는 폼 위 `role="alert"`에 그대로.
- **빈 상태**: `등록된 결제 수단이 없어요 — 추가하면 정산 요청에 자동으로 들어가요` + 추가 버튼.
- **오류 전달**: 저장 실패 시 `reportError('payment', true)` → 탭 라벨 표식(탭 스펙 관례). 성공하면 해제.
- **상태 갱신**: 응답의 `paymentMethods`로 `data.paymentMethods` 교체, `logs`는 `data.logs` 앞에 prepend(DealTab의 pricing 관례), 로그 1건 이상이면 `onChanged()`(명부 마지막 기록 갱신).
- **타임라인**(`Timeline.tsx`): `payment_method_changed` 문구 —
  - added: `결제 수단 추가 — {label}`
  - removed: `결제 수단 삭제 — {label}`
  - default_changed: `기본 결제 수단 → {label}`
  - updated: `결제 수단 수정 — {label}: {필드라벨} {from} → {to}`(필드 2개 이상이면 `외 N건`)
  - 묶음 라벨: `결제 수단 변경 N건`. 필드 라벨 사전은 lib(`PAYMENT_FIELD_LABEL`)에.
- 명부(왼쪽 목록)는 바꾸지 않는다. "결제 수단 없음" 필터는 백로그(전체 입력이 끝난 뒤 필요해지면).

## 4. 초기 데이터 가져오기

koo가 파일로 제공한다(형식 미정). 우리가 요구하는 **표준 CSV 템플릿**을 먼저 건네고, 도착한 파일이 다르면 어댑터 단계에서 맞춘다.

- 템플릿 `scripts/templates/payment-methods.csv` (헤더만 + 예시 2행 주석): `handle,type,holder,currency,email,identifier,bank,branch,account,fee_mode,fee_value,memo,is_default`
  - `type`: paypal | paypay | bank / `currency`: KRW | JPY / `fee_mode`: 빈칸 | grossUp | fixed / `is_default`: Y 또는 빈칸(인플당 Y 0~1개, 없으면 첫 행)
- 스크립트 `scripts/import-payment-methods.ts <csv> [--apply]`:
  - 기본은 **드라이런** — 행마다 `@handle → 계좌이체 · 신한 …  [추가]` / `[건너뜀: 같은 수단 있음]` / `[오류: 핸들 없음]`을 출력하고 요약(추가 n·건너뜀 n·오류 n). 오류가 1건이라도 있으면 `--apply`여도 전체 중단(부분 적용 방지).
  - `--apply`: 인플마다 `updatePaymentMethods(sql, id, {kind:'add', input, makeDefault}, null)` — actorId null이라 기록에 "가져오기"로 남는다(Timeline은 actor 없는 auto를 이미 처리하는지 확인, 아니면 `authorName ?? '가져오기'`).
  - 중복 판정: 같은 type이고 (bank→account, paypal→email, paypay→holder)가 같으면 건너뜀 — 재실행 안전.
  - `.env`는 `--env-file-if-exists=.env` (기존 스크립트 관례).

## 5. payment-data로 넘기는 계약

- 읽기: `getInfluencerDetail(...).paymentMethods` 또는 `getDefaultPaymentMethod(list)`. 결제 요청은 요청 시점 값을 **스냅샷**으로 자기 테이블에 복사한다 — 이후 인플이 계좌를 바꿔도 지난 요청은 그대로.
- 수수료 계산은 `PaymentFee`를 해석해 payment-data가 한다(`grossUp`: 총액 = 순액 ÷ (1 − p/100), 정수 올림 규칙은 그쪽 스펙). 이 스펙은 값만 보존한다.

## 6. 검토 — 목적 부합·시스템 관점

- **목적**: 정산에 필요한 수취 정보를 인플 단위로 한 곳에, 기본 수단 1개, 변경 추적 — ①~③ 모두 충족. 결제 요청 자동화의 선행 조건(필드정리 §"핵심 공백") 해소.
- **UX 원칙**: ① 라벨은 사용자 말(결제 수단·수취인·실수령 보장·송금 수수료 추가 — `grossUp` 같은 내부어 노출 없음) ② 패널 도움말 1줄 + 폼 안 힌트(첫 수단은 기본이 돼요) ③ 판단 서술은 해당 없음(입력 화면) ④ `기본` 배지는 서버 `isDefault`에서만 파생 ⑤ 통화 기호 옆에 뜻 없음이 자연스러움 ⑥ 비용 유발 없음.
- **동시성**: 연산은 행 잠금 안에서 배열 전체를 다시 쓰므로 두 사람이 다른 수단을 동시에 고쳐도 잃지 않는다. 같은 수단을 동시에 고치면 나중 커밋이 이김(필드 단위 병합 안 함 — 인플 결제 정보를 두 사람이 동시에 편집하는 일은 드물고, 기록에 둘 다 남는다).
- **보안**: 접근은 기존 `requireMember`(전 워크스페이스 공유 모델 — 의도된 설계). 새 외부 서비스·비용 없음. 계좌번호 평문 저장은 기존 메모 컬럼과 같은 수준 — 노출 결정에 부합.
- **마이그레이션**: 036(033~035는 다른 브랜치가 소모). 멱등(`if not exists`, constraint drop+add). 프로덕션 적용은 배포 전 `apply-migrations.sh` 관례.
- **회귀 위험**: `LogPayload` 유니언 확장 — Timeline의 `l.payload?.from` 접근(handle_changed)은 유니언에 `from`이 없는 멤버가 늘어 타입 오류 가능 → 캐스팅 정리 필요(tsc가 잡는다).
- **범위 밖**(백로그): 명부 "결제 수단 없음" 필터·표시, 계좌 마스킹, 수단별 지급 이력, 정산 프로덕트 송신(payment-data).
