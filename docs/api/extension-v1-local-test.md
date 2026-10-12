# 확장 연동 로컬 테스트 절차 (실제 웹 화면·공통 API)

작성일: 2026-10-06 · 대상: cb-x-deck `src/app/api/extension/v1` + cb_x_extension 개발 빌드

회사 계정 로그인부터 X 대화 패널의 협찬 조회까지를 로컬에서 확인하는 순서다. 구현 내용과 계약 결정은 [API 1 / EXT 1 구현 기록](../superpowers/plans/2026-10-04-extension-api1-ext1-record.md)을 본다.

 > **현재 준비 상태 (2026-10-06)**
> 로컬 개발 서버의 `.env.local`은 공유 staging DB를 사용한다. 구현을 위해 구조를 조회한 결과 064 예약 테이블은 있고, 065 클리닉 설정·첨부 요청 테이블은 없다. 새 저장 기능은 준비 전 `SERVER_NOT_READY`로 응답하며 `/session`의 `features`는 false다.
> `migrations/070_extension_product_settings.sql` 적용 후 개발 서버에서는 새 저장 기능을 사용할 수 있다. 이 작업에서 공유 DB 적용과 테스트 실행은 하지 않았다.
>
> **staging Supabase·DB는 레포·Supabase 소유자의 자원이다.** 소유자 항목은 직접 바꾸지 않고 요청한다.

실제 화면은 `/campaigns/flow?id=<캠페인 ID>&task=<작업 ID>`, `/clients?client=<클라이언트 ID>&tab=hours`(클리닉 설정 탭), `/quick-messages`(사이드바 미노출), `/influencers`다. `/mockup/x-extension`은 디자인 참고용 샘플 화면으로 유지한다. 실제 화면은 웹 쿠키로 `/api/extension-product`를 호출하며, 익스텐션의 Bearer 요청 `/api/extension/v1`과 같은 저장·판정 처리를 사용한다.

새 API의 경로·요청 예시는 [연동 전달 문서](extension-product-local-handoff.md)를 본다. 익스텐션 화면 수정·빌드는 익스텐션 레포에서 진행한다.

## 0 역할 나누기

각 절 제목에 **🧑‍💻 나** / **🙋 소유자** 표시를 달았다. 소유자 항목은 staging Supabase·DB를 바꾸는 일이라 소유자만 한다.

| 순서 | 할 일 | 누가 | 절 | 언제 |
| --- | --- | --- | --- | --- |
| 1 | staging Redirect URL 등록 요청 | 🧑‍💻 나 → 🙋 소유자 | §2 | 테스트 시작 전, 최초 1회 |
| 2 | Redirect URL 등록 | 🙋 소유자 | §2 | 요청 받은 뒤 |
| 3 | 준비물 확인·서버 실행·확장 빌드·Chrome 로드 | 🧑‍💻 나 | §1, §3~§5 | 2번 완료 후 |
| 4 | 테스트 C1~C6, X1~X9 (064 적용 후 기준) | 🧑‍💻 나 | §6 | 3번 후 |
| 5 | 서버 단독 확인·자동 테스트 | 🧑‍💻 나 | §7, §8 | 언제든(2번과 무관) |
| 6 | 065 파일의 내용을 전달하고 staging 적용 요청 | 🧑‍💻 나 → 🙋 소유자 | §10 | 새 화면과 저장 기능 테스트 전. 로컬 파일을 전달해도 된다 |
| 7 | staging에 065 적용 | 🙋 소유자 | §10 | 요청 받은 뒤 |
| 8 | 테스트 X3 및 W1~W8 (065 적용 후 기준) | 🧑‍💻 나 | §6 | 7번 완료 후 |
| 9 | 결과 기록 | 🧑‍💻 나 | §12 | 테스트마다 |

**소유자에게 보낼 요청 예시**

> staging Supabase(`zatrinmwpqarjhkarubj`) → Authentication → URL Configuration → Redirect URLs에 아래 값을 추가해 주세요. 크롬 확장 로그인 로컬 테스트용이고, Site URL은 바꾸지 않아도 돼요.
> `https://naopbhcnpgofjmhaagpijcjcbijacacb.chromiumapp.org/**`

> 로컬에서 새 화면과 익스텐션 저장 기능을 테스트하려고 합니다. 공유 staging에 `migrations/070_extension_product_settings.sql`만 적용해 주세요. 063 동의서 저장소·064 예약 구조가 선행 조건입니다. 클리닉 설정·양식·빠른 메시지 저장 구조와 메모·단가 버전 관리를 추가하며 샘플 데이터는 넣지 않습니다.

## 1 준비물 — 🧑‍💻 나

| 항목 | 확인 방법 |
| --- | --- |
| Chrome 114 이상 | `chrome://version` |
| 회사 Google 계정(@clinicbridge.co.kr) | 외부 계정 거부 테스트용으로 개인 Gmail 1개도 있으면 좋다 |
| staging Redirect URL 등록 완료 | §2 — 🙋 소유자가 등록(최초 1회) |
| X 계정과 1대1 DM 2개 이상 | 하나는 **등록된 인플루언서**, 하나는 **미등록 상대** |
| 등록된 상대 핸들 | 웹 `/influencers`에서 확인. 협찬 건수까지 보려면 캠페인 작업에 배정된 핸들 |

## 2 최초 1회 설정 — Supabase Redirect URL — 🙋 소유자 (나는 요청)

staging Supabase 인증 설정 변경이라 소유자가 등록한다. 나는 §0의 요청 예시로 아래 값과 위치를 전달하고, 등록됐다는 답을 받으면 §3으로 넘어간다.

1. Supabase 대시보드 → staging 프로젝트(`zatrinmwpqarjhkarubj`).
2. **Authentication → URL Configuration → Redirect URLs → Add URL**.
3. 아래 값을 넣고 저장한다.
   ```
   https://naopbhcnpgofjmhaagpijcjcbijacacb.chromiumapp.org/**
   ```
4. 같은 화면의 **Site URL은 바꾸지 않는다**(웹 로그인용).

값은 확장 설정 화면의 `개발자 정보 → 로그인 redirect URL`과 같아야 한다. 확장 ID는 `cb_x_extension/manifest.json`의 공개 key로 고정돼 있어 개발 PC가 바뀌어도 같다.

## 3 서버 실행 — 🧑‍💻 나

```sh
cd cb-x-deck
npm run dev            # 기본 3000. 이미 실행 중인 서버가 있으면 그 포트를 쓴다
```

이미 다른 터미널에서 실행 중이면 `Another next dev server is already running … Local: http://localhost:3100`처럼 실제 포트를 알려 준다. **이 포트를 확장 빌드에 그대로 써야 한다.**

서버가 확장 경로를 받는지 확인한다(로그인 없이 401이 정상):

```sh
curl -s http://127.0.0.1:3100/api/extension/v1/session
# {"error":{"code":"AUTH_REQUIRED","message":"회사 계정을 다시 연결해 주세요."},"meta":{...}}
```

## 4 확장 빌드 — 🧑‍💻 나

서버 포트와 staging 로그인 설정(공개 anon 키)을 넣어 개발 빌드한다. 값은 cb-x-deck `.env.local`의 `NEXT_PUBLIC_*`를 그대로 쓴다. **service-role 키는 넣지 않는다**(빌드가 거부한다).

```sh
cd cb_x_extension
set -a; source ../cb-x-deck/.env.local; set +a
CB_API_ORIGIN=http://127.0.0.1:3100 \
CB_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
CB_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
npm run build:extension:dev
```

- `CB_API_ORIGIN`을 빼면 `http://127.0.0.1:3000`으로 빌드된다.
- `CB_SUPABASE_*`를 빼도 빌드는 되지만 설정 화면에 "로그인 설정이 없어요"가 뜨고 연결할 수 없다.
- `npm run build:mockup`은 `dist/` 전체를 비운다. 목업을 빌드했다면 확장을 다시 빌드한다.

## 5 Chrome에 로드 / 다시 로드 — 🧑‍💻 나

1. `chrome://extensions` → 오른쪽 위 **개발자 모드** 켜기.
2. 처음이면 **압축해제된 확장 프로그램을 로드합니다** → `cb_x_extension/dist/extension` 선택.
   이미 로드돼 있으면 CB × X 카드의 **새로고침(↻)**.
3. 새 권한(Supabase 호스트)이 붙으면 확장이 꺼질 수 있다 → 스위치를 다시 켠다.
4. 카드의 **세부정보 → 확장 프로그램 옵션**으로 설정 화면을 연다(이미 열려 있었다면 닫고 다시 연다).
5. **개발자 정보**를 펼쳐 아래와 같은지 확인한다. 다르면 다시 로드가 안 된 것이다.

| 항목 | 기대 값 |
| --- | --- |
| 제품 서버 | 3번에서 확인한 포트(예: `http://127.0.0.1:3100`) |
| 확장 ID | `naopbhcnpgofjmhaagpijcjcbijacacb` |
| 로그인 redirect URL | `https://naopbhcnpgofjmhaagpijcjcbijacacb.chromiumapp.org/supabase` |
| 단계 | `EXT 1` |

X 탭은 확장을 다시 로드한 뒤 **새로고침**해야 새 content script가 붙는다.

## 6 테스트 케이스 — 🧑‍💻 나

순서대로 진행한다. 결과 칸에 ✅/❌와 메모를 남긴다.

### 연결(설정 화면)

| ID | 절차 | 기대 결과 | 결과 |
| --- | --- | --- | --- |
| C1 | 설정 화면을 연다 | "아직 연결하지 않았어요" + `회사 계정 연결하기` 버튼. 빨간 오류 없음 | |
| C2 | `회사 계정 연결하기` → Google 창에서 **회사 계정** 선택 | 창이 저절로 닫히고 "○○ 님으로 연결했어요…" 표시. 상단이 "연결됨 · 이메일 · 담당자 ○○" | |
| C3 | `연결 상태 확인하기` | "연결이 정상이에요 — ○○ 님 (이메일)" | |
| C4 | `연결 해제` → 다시 `회사 계정 연결하기` → **개인 Gmail** 선택 | "회사 Google 계정(@clinicbridge.co.kr)으로 연결해 주세요." 표시. 상태는 "아직 연결하지 않았어요"로 남음(연결되지 않음) | |
| C5 | Google 창을 계정 선택 없이 닫기 | "로그인 창이 닫혔어요. 다시 연결해 주세요." | |
| C6 | 회사 계정으로 다시 연결(C2) | C2와 같음 | |

### X 대화 패널

X 탭을 새로고침한 뒤 진행한다. 패널은 화면 오른쪽 아래에 뜬다.

| ID | 절차 | 기대 결과 — 064 적용 전 | 기대 결과 — 064 적용 후 | 결과 |
| --- | --- | --- | --- | --- |
| X1 | DM이 아닌 화면(홈 등) | 패널이 보이지 않음 | 같음 | |
| X2 | **미등록** 상대와 1대1 DM | "대화 상대 @핸들" + "아직 등록되지 않은 상대예요." | 같음 | |
| X3 | **등록된** 상대와 1대1 DM | "서버에 예약 기능 준비가 끝나지 않았어요. 관리자에게 알려 주세요." + `다시 불러오기` (**정상**) | "이름 · 진행 중 협찬 N건" 또는 "진행 중인 협찬이 없어요". 최대 3건이 단계 태그·D-day와 함께 표시, 넘치면 "외 N건은 웹에서 확인해 주세요." | |
| X4 | X2 ↔ X3 대화를 빠르게 번갈아 열기 | 표시되는 핸들과 결과가 항상 현재 열린 상대의 것. 이전 상대 결과가 남거나 섞이지 않음 | 같음 | |
| X5 | 그룹 대화 열기 | "그룹 대화는 지원하지 않아요." | 같음 | |
| X6 | 설정에서 `연결 해제` → X 탭 새로고침 → 등록된 상대 DM | "회사 계정을 연결하면 이 상대의 협찬 정보를 볼 수 있어요." + `회사 계정 연결하기`(누르면 설정 화면 열림) | 같음 | |
| X7 | 다시 연결 후, 개발 서버를 끄고 X 탭 새로고침 → 등록된 상대 DM | "연결을 확인한 뒤 다시 조회해 주세요." + `다시 불러오기`. **"등록되지 않은 상대"로 표시되면 안 됨** | 같음 | |
| X8 | 서버를 다시 켜고 X7 화면에서 `다시 불러오기` | X2/X3의 결과로 회복 | 같음 | |
| X9 | Chrome을 완전히 종료 후 다시 실행 → 등록된 상대 DM | X6과 같음(연결은 브라우저 세션 동안만 유지 — 의도된 동작) | 같음 | |

### 실제 웹과 비교 확인 — 저장은 065 적용 후

웹의 실제 캠페인 화면은 `id=<캠페인 ID>&task=<작업 ID>` 링크로 작업 상세를 바로 연다. 확장 API의 `webUrl`에도 두 ID가 들어간다. 다른 캠페인의 작업이나 삭제된 작업을 가리키면 안내를 표시하며, 다른 작업으로 대체하지 않는다.

작업 상세의 일정·예약 정보에서 예약 추가·수정·확정·동의서·종료를 처리한다. 클리닉 설정은 클라이언트 상세의 운영시간·방문 안내·양식 탭에서, 빠른 메시지는 `/quick-messages` 주소로 연다(포함 여부 결정 전이라 사이드바에 없다). 예약 기능이 꺼져 있으면(065 적용 전·운영 비활성) 작업 상세는 기존 일정 칸만 보인다. 아래 W5~W8은 065 적용 후 실제 저장 데이터를 바꾸므로 테스트에 사용할 작업을 먼저 정한다.

| ID | 절차 | 기대 결과 | 결과 |
| --- | --- | --- | --- |
| W1 | X3 상대를 웹 `/influencers`·캠페인 흐름 화면에서 확인 | 패널의 진행 중 건수 = 웹에서 취소·완료가 아닌 작업 수 | |
| W2 | 웹에서 그 상대의 작업 하나를 취소 → 패널 `다시 불러오기`(또는 대화 재진입) | 진행 중 건수가 1 줄어듦 | |
| W3 | 게시 예정일이 있는 작업 | D-day가 웹의 예정일 기준과 일치(오늘 = `D-day`, 지남 = `D+n`) | |
| W4 | 확장에서 협찬의 웹 링크 열기 → 작업 상세 확인. 주소의 `task`를 다른 캠페인의 작업 ID로 바꿔 열기 | 첫 링크는 선택한 작업 상세가 열림. 잘못된 링크는 찾을 수 없다는 안내가 보이고 다른 작업을 열지 않음 | |

| W5 | 웹 작업 상세에서 예약 추가 → 확장에서 같은 task의 예약 조회 → 수정 후 웹 최신 내용 불러오기 | 원문·최종 시트·날짜·단계가 같은 예약을 가리킴 | |
| W6 | 웹 클라이언트 상세의 운영시간·방문 안내·양식 탭에서 운영시간·지도·언어별 안내·양식 저장 → 확장 조회 | 저장된 본점 설정·양식 버전이 같음. 공휴일 자료 없는 연도는 확인 필요 표시 | |
| W7 | 웹 `/quick-messages`에서 메시지 저장·미사용 전환 → 확장 목록 조회 | 사용 메시지만 기본 목록에 노출. 한국어·일본어·영어 구분 유지 | |
| W8 | 같은 예약을 웹·확장에서 연 뒤 한쪽 먼저 수정 → 다른 쪽 저장 | 409 VERSION_CONFLICT. 이전 입력 유지, 최신 저장 내용과 비교 가능 | |

## 7 서버 단독 확인 (선택) — 🧑‍💻 나

로그인 없이 확인할 수 있는 항목이다. 모두 JSON envelope(`{"error":…,"meta":{"requestId":…}}`)로 답해야 한다.

```sh
B=http://127.0.0.1:3100/api/extension/v1
Z=00000000-0000-0000-0000-000000000000
curl -s -w ' [%{http_code}]\n' $B/session                                       # 401 AUTH_REQUIRED
curl -s -w ' [%{http_code}]\n' -H 'Authorization: Bearer a.b.c' $B/session        # 401 AUTH_REQUIRED
curl -s -w ' [%{http_code}]\n' -X POST -d '{}' $B/people/badges                    # 401
curl -s -w ' [%{http_code}]\n' "$B/people/$Z/tasks?bucket=active"                 # 401
curl -s -w ' [%{http_code}]\n' $B/tasks/$Z                                         # 401
curl -s -i -X OPTIONS -H 'Origin: chrome-extension://naopbhcnpgofjmhaagpijcjcbijacacb' $B/session | grep -i '^access-control-allow-origin'   # 있어야 함
curl -s -i -X OPTIONS -H 'Origin: https://evil.example' $B/session | grep -ci '^access-control'                                         # 0
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/extension/v1x   # 404 (경계 밖)
```

## 8 자동 테스트 — 🧑‍💻 나

```sh
# cb-x-deck — 순수 판정(인증 claims·작업 분류·cursor·입력) + 예약 정책
node --import tsx --test src/lib/extensionApi.test.ts src/lib/reservationPolicy.test.ts src/lib/reservationSheet.test.ts src/lib/clinicHours.test.ts
npx tsc --noEmit

# cb_x_extension — 로그인(PKCE·갱신)·메시지 경계·패널 조회·API client
npm test
npx tsc -b
```

전체 `npm test`(cb-x-deck DB 통합)는 `.env.staging`이 있어야 실행된다.

## 9 문제 해결 — 🧑‍💻 나

| 증상 | 원인 | 조치 |
| --- | --- | --- |
| 설정 화면에 빨간 "지원하지 않는 확장 요청이에요." / 개발자 정보가 `EXT 0`·3000 | Chrome이 예전 확장을 실행 중(설정 화면만 새 버전) | `chrome://extensions`에서 ↻ 다시 로드 → 설정 화면 다시 열기 |
| 개발자 정보의 제품 서버 포트가 실제 서버와 다름 | 빌드 때 `CB_API_ORIGIN`이 다름 | 4번을 맞는 포트로 다시 빌드 → ↻ |
| "이 개발 빌드에는 로그인 설정이 없어요" | `CB_SUPABASE_URL`·`CB_SUPABASE_ANON_KEY` 없이 빌드 | 4번 명령으로 다시 빌드 |
| Google 로그인 후 창이 닫히지 않고 staging 웹 화면이 보임 | Redirect URL 미등록(Supabase는 오류 대신 Site URL로 보낸다) | 🙋 소유자에게 §2 등록(또는 값 오타) 확인 요청 → 등록되면 창을 닫고 다시 연결 |
| "로그인 창이 닫혔어요" (창을 닫지 않았는데) | 위와 같은 원인으로 사용자가 창을 닫았거나 팝업 차단 | 🙋 소유자에게 §2 등록 확인 요청, 팝업 허용 |
| "회사 Google 계정(@clinicbridge.co.kr)으로 연결해 주세요." | 회사 외 계정 또는 Google이 아닌 로그인 | 회사 Google 계정으로 다시 연결 |
| "제품 서버에 연결하지 못했어요…" (설정) / "연결을 확인한 뒤 다시 조회해 주세요." (패널) | 개발 서버 꺼짐 또는 포트 불일치 | 3번 curl로 서버 확인, 포트 맞추기 |
| 등록된 상대인데 "서버에 예약 기능 준비가 끝나지 않았어요" | staging에 064 미적용(정상) | 협찬 건수까지 보려면 🙋 소유자에게 §10 요청 |
| 패널이 아예 안 뜸 | X 탭이 확장 로드 전 상태 / DM이 아님 | X 탭 새로고침, 1대1 DM 열기 |
| "같은 핸들로 등록된 계정과 X 계정이 달라요." | 저장된 X 숫자 ID와 현재 대화 상대 ID가 다름(핸들 이전 가능성) | 웹 인플루언서 화면에서 계정 확인. 자동으로 고치지 않는 것이 의도 |

## 10 065 적용 — 🙋 소유자 (나는 요청)

공유 DB에 설정을 추가하는 작업이다. 이 체크아웃에는 이미 적용된 058~063 파일이 없을 수 있으므로 전체 migration 스크립트를 재실행하지 않고, 선행 063·064가 있는 대상에 **065만** 적용한다. 프로덕션 기본 env를 사용하지 않는다.

```sh
cd cb-x-deck
set -a
source .env.local
set +a
psql -v ON_ERROR_STOP=1 --single-transaction -f migrations/070_extension_product_settings.sql
```

065는 저장 테이블·첨부 요청 관리·예약 양식 연결과 메모·단가 버전 트리거를 추가한다. 새 테이블에는 클라이언트 직접 접근 대신 인증된 서버 API를 사용한다. 기존 `task-agreement` 비공개 버킷을 사용하며 새 버킷·샘플 설정·공휴일 데이터는 만들지 않는다.

## 11 테스트가 staging에 남기는 것

로컬 주소로 접속해도 데이터는 공유 staging에 남는다.

- 회사 계정 연결: 담당자(member) 목록에 없으면 추가된다.
- 개인 계정 로그인 거부 테스트: staging 인증 사용자 목록에 해당 계정이 생길 수 있다.
- 예약·클리닉 설정·양식·메시지·메모·단가를 저장하면 실제 공유 데이터가 바뀐다. AI 응답 정리·프로필 등록은 명시적으로 버튼을 누를 때 외부 사용 비용이 발생한다.
- 예약 종료는 기록을 지우지 않는다. 예약이 연결된 작업·캠페인·클라이언트·인물은 실수로 삭제되지 않도록 보호한다.

## 12 결과 기록 — 🧑‍💻 나

| 날짜 | 테스트한 사람 | 065 적용 | 확장 빌드 포트 | 통과 | 실패·메모 |
| --- | --- | --- | --- | --- | --- |
| | | 전 / 후 | | C _/6 · X _/9 · W _/8 | |
