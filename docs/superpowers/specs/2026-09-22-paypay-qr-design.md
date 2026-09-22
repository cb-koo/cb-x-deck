# PayPay 수취 정보에 QR 이미지 — 설계 (2026-09-22)

## 한 줄

PayPay로 송금할 때 수취 식별 정보 대신 **QR 이미지만 있는 경우**가 있다. 그 QR을 인플루언서 명부에 등록하고, 정산 프로덕트에 함께 보내고, 정산 쪽이 고치면 우리 쪽에도 돌아오게 한다.

## 왜

지금 PayPay 수단에는 `identifier`(수취 식별 정보) 한 칸뿐이고, 그나마 "아직 무엇으로 받는지 확정되지 않았다"는 안내가 붙어 있다. 실무에서는 인플루언서가 PayPay **QR 스크린샷**만 주는 경우가 있는데 그걸 담을 자리가 없다. 담당자가 슬랙·메모로 따로 들고 다니게 되고, 정산 프로덕트에는 전달되지 않는다.

## koo 결정 (2026-09-22)

1. **식별 정보·QR 둘 다 선택.** 아무것도 없이도 수단을 등록할 수 있다(지금과 같음). "둘 중 하나 필수"로 막지 않는다 — 나중에 채우는 실무 흐름을 끊지 않기 위해.
2. **요청에는 스냅샷으로 싣는다.** 계좌번호와 같은 취급. `proof`(최신값 예외)와 다르다.
3. **정산 쪽도 QR을 고칠 수 있다.** 고치면 글자 항목과 똑같이 요청과 명부에 반영된다.
4. **주 경로는 우리 명부.** 정산 쪽 교체는 "정산 과정에서 필요하다고 판단될 때"의 보조 경로.
5. **화면은 두 칸을 한 묶음으로** 감싸고 "둘 중 하나만 있어도 돼요"를 위에 적는다.

## 1. 데이터

### 명부 (원본)

`influencer.payment_methods[]`의 PayPay 항목에 키 하나를 더한다.

```
{ type: 'paypay', holder, currency: 'JPY',
  identifier?: string,   // 있던 것
  qr?: string }          // 추가 — 저장소 경로. 절대 URL이 아니다
```

`payment_methods`가 `jsonb`라 **칸(컬럼) 추가가 없다.** 마이그레이션 파일은 버킷 생성용으로 하나 필요하다(`024_draft_media_bucket.sql`·`044_task_proof.sql`과 같은 방식). 추가만 하므로 ADR 0007의 "추가 1번 머지"에 해당한다.

### 이미지 저장

새 비공개 버킷 **`payment-qr`**. `task-proof`와 같은 규격을 쓴다.

| | 값 | 근거 |
|---|---|---|
| 공개 | 비공개 | 수취 정보다. 표시·전달 모두 그때그때 서명 URL |
| 크기 | 5MB | QR 스크린샷은 보통 수백 KB. `task-proof`(10MB)보다 좁혀도 충분 |
| 형식 | `image/jpeg`, `image/png`, `image/webp` | `task-proof`와 동일. GIF는 뺀다(QR이 움직일 이유가 없다) |
| 경로 | `{influencerId}/{uuid}.{ext}` | 인플루언서별로 묶어 정리·삭제가 쉽다 |

**옛 파일은 지우지 않는다.** QR을 바꾸면 새 경로를 쓰고 옛 파일은 남긴다 — 이미 나간 요청의 스냅샷이 그 경로를 가리키고 있기 때문이다. 버킷 정리는 별도 작업(범위 밖).

### 요청 스냅샷

`payment_request.payment_method`에 `qr` 경로가 그대로 복사된다. 기존 스냅샷 로직(`toMethodSnapshot`)에 키를 더하는 것뿐이다.

## 2. 화면 — 인플루언서 프로필 · 결제 수단

### 입력 (PayPay를 골랐을 때)

지금은 `수취 식별 정보 (선택)` 한 칸과 안내문 한 줄이다. 이것을 한 묶음으로 바꾼다.

```
받을 정보 (둘 중 하나만 있어도 돼요)

  수취 식별 정보
  [                              ]

  QR 이미지
  [ 이미지 선택 ]   또는 붙여넣기
  (등록했으면 작은 미리보기 + [바꾸기] [지우기])

· 아직 못 받았으면 비워두셔도 돼요 — 정산 쪽에서 확인되면 그때 채우면 됩니다
```

**지금 안내문("PayPay는 아직 무엇으로 받는지 확정되지 않았어요")은 지운다.** QR이 생기면 사실이 아니게 된다.

붙여넣기는 `TaskProofField.tsx`의 방식을 그대로 쓴다(`paste` 이벤트에서 `clipboardData.files` 첫 장). PayPay QR은 대개 폰 스크린샷이라 파일 저장 없이 바로 붙이는 쪽이 빠르다.

### 표시 (읽기)

`PaymentSection.tsx`의 행 목록에 QR 행을 더한다. 기존 `수취 식별 정보` 행 바로 아래.

- QR 있음 → 작은 미리보기. 누르면 `ImageLightbox`로 확대(정산 화면이 증빙에 쓰는 것과 같은 것)
- QR 없음 → 행을 만들지 않는다. `identifier`처럼 "미입력" 문구를 넣지 않는다 — 둘 다 선택이라 둘 다 "미입력"이 뜨면 잔소리가 된다
- 둘 다 없음 → `수취 식별 정보` 행에만 지금처럼 "미입력 — 정산 쪽에서 확인되면 적어 두세요"

### 정산 요청 내역

`RequestRow`의 결제수단 줄에 QR이 있으면 미리보기 한 장. 확대는 같은 `ImageLightbox`.

## 3. 정산 프로덕트 연동

### 내보내기 — Item에 고정 주소

`payment_method`에 `qr_url`을 더한다.

```
payment_method: { type: "paypay", holder: "...", currency: "JPY",
                  identifier: "...",
                  qr_url: "{origin}/api/external/settlement/requests/{id}/payment-qr" }
```

QR이 없으면 키를 넣지 않는다(`payment_method`는 `Record<string, string>`이라 null을 담지 않는 기존 규칙을 따른다).

**서명 URL을 직접 넣지 않는 이유는 `proof`와 같다**(계약 §4-1) — 서명 URL은 만료되므로 목록을 캐시해 두면 죽은 링크가 된다. 고정 주소를 열 때마다 우리가 새로 서명한다.

### 내보내기 — 이미지 창구

```
GET /api/external/settlement/requests/{request_id}/payment-qr
Authorization: Bearer <SETTLEMENT_API_KEY>
→ 200, Content-Type: image/*, 본문은 이미지 바이트
```

`proof` 라우트(`.../[id]/proof/route.ts`)를 그대로 본뜬다. 리다이렉트가 아니라 **우리 서버가 저장소에서 받아 본문으로 흘려보낸다** — 그쪽 코드는 "GET 한 번"으로 끝난다.

404를 돌려주는 경우 셋(전부 `proof`와 같은 구조): 요청이 없음 / 요청에 QR이 없음(`no-qr`) / 경로는 있는데 저장소에 파일이 없음(`storage-miss`).

### 받기 — 기존 정정 API에 키 하나

```
POST /api/external/settlement/requests/{request_id}/payment-info
{ correction_id, base_source_revision, reason, operator,
  payment_method: { qr: "data:image/png;base64,iVBOR..." } }
```

`ALLOWED_BY_TYPE.paypay`가 `['holder','identifier']` → `['holder','identifier','qr']`.

**`qr`만 특별 취급한다.** 다른 키는 값이 그대로 저장되지만 `qr`은 받는 즉시 이미지를 디코드해 `payment-qr` 버킷에 저장하고, **이후 모든 처리에는 저장소 경로를 쓴다.** 그래서 정정 이력(`payment_request_payment_correction.patch`·`before`·`after`)에는 base64가 아니라 경로만 남는다 — 기록 테이블이 붓지 않는다.

그 뒤는 **기존 흐름을 그대로 탄다.** 멱등(`correction_id`) → 취소·지급완료·판 불일치 판정 → 요청 반영 → 명부 자동 반영(057) → 활동 기록. 새 판정 로직이 없다.

`qr`은 `REMOVABLE`에 넣는다 — `null`로 보내 지울 수 있다. QR을 잘못 올렸을 때 되돌릴 길이 필요하다.

### 계약 문서

`docs/api/settlement-external-api.md`에 §5 `payment_method` 설명 보강, §4-2로 `GET .../payment-qr` 신설, §6-1(정정)에 `qr` 키 추가. 그쪽 전달 문안은 `docs/api/settlement-handoff/`에 새 번호로.

## 4. 검사와 오류

| 상황 | 처리 |
|---|---|
| 형식이 허용 밖 | 400 `payment_method.qr` — "QR 이미지는 JPG·PNG·WebP만 돼요" |
| 5MB 초과 | 400 — 크기를 말해준다 |
| base64가 깨짐 | 400 — 값 해석 실패 |
| 저장소 쓰기 실패 | 500. 정정 자체를 적용하지 않는다(트랜잭션 밖이라 **이미지 저장을 먼저 하고 DB 트랜잭션을 연다**) |
| 요청에 QR 없음 + `GET .../payment-qr` | 404 `no-qr` (저장소에 파일이 없으면 `storage-miss`) |
| PayPal·계좌 수단에 `qr` 정정이 옴 | 400 — 기존 "수단 종류에 없는 항목" 규칙이 그대로 잡는다 |

**순서 주의:** 이미지 저장 → DB 트랜잭션. 트랜잭션 안에서 외부 저장소를 만지면 실패 시 롤백이 어긋난다. 저장은 됐는데 DB가 롤백되면 고아 파일이 남지만, 비공개 버킷의 고아 파일은 무해하다(반대는 위험하다 — DB가 가리키는 파일이 없는 상태).

## 5. 테스트

**순수 로직** (DB 없이)
- `payment-qr` 형식·크기 검사
- base64 디코드 실패 처리
- `ALLOWED_BY_TYPE`에 `qr` 추가 후 PayPal·계좌에서 거절되는지
- `toExternalItem`이 QR 있을 때만 `qr_url`을 넣는지
- `planRosterOverwrite`가 `qr`을 병합할 때 `fee`·`memo`·`isDefault`를 보존하는지

**DB 연동** (연습용 DB)
- 정정으로 QR이 오면 요청 스냅샷과 명부가 함께 바뀌는지
- `qr: null`로 지워지는지
- 멱등 — 같은 `correction_id` 재전송에 쓰기가 없는지
- `GET .../payment-qr` 404 / 정상

**화면**은 자동 테스트가 없다(이 저장소에 `.test.tsx`가 0개). 타입 검사·린트 + 로컬에서 띄워 확인 + koo 확인.

## 6. 범위 밖

- **QR 이미지의 내용을 읽지 않는다.** 디코드해서 계정을 알아내거나 검증하지 않는다. 사람이 보고 판단한다.
- **옛 QR 파일 정리.** 바꿔도 지우지 않는다. 버킷 정리는 별도.
- **QR 필수화.** koo 결정 1에 따라 둘 다 선택으로 둔다. 나중에 실사용에서 "빈 수단으로 요청이 나가 곤란하다"가 확인되면 그때 다시 본다.
- **PayPal·계좌의 QR.** PayPay만이다.

## 7. 열린 질문

없음. 남은 결정은 구현 중에 기존 패턴을 따르면 되는 것들이다.
