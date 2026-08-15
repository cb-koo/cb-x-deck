# 생성 패널에서 링크로 레퍼런스 추가 (설계)

2026-08-15 · 브랜치 `cb-koo/reference-with-link`

**의도**: 콘텐츠 기획자가 X에서 방금 본 트윗을 원고 생성의 레퍼런스로 쓰고 싶을 때,
'보관함에서 고르기' 시트를 거치지 않고 생성 패널에서 바로 링크를 붙여넣는다.
저장은 반드시 팀 보관함을 경유한다 — 레퍼런스가 일회성으로 흩어지지 않고 팀 자산으로 쌓인다.

## 원칙

- **신규 서버 코드 0**: `POST /api/library/from-link`(addByLink.ts)와 `GET /api/references`를 그대로 쓴다.
  보관함 저장이 endpoint에 내장돼 있어 "레퍼런스로만 쓰고 보관함엔 안 남는" 우회 경로가 생길 수 없다.
- **기존 UI 재사용**: `AddByLinkModal` 공용 모달(링크 검증·메모·워크스페이스 선택 내장)을 세 번째 진입점으로 연결.
  RefPickerSheet 하단의 '🔗 링크로 추가'(08-10 배포)와 같은 동작 규칙을 따른다.

## 확정 판단 (코드로 검증한 사실)

- `addTweetByLink` → `ensureLibraryItem`이 `library_item`에 쓰고, `listReferences`가 `library_item`에서 읽는다
  → 저장 직후 `/api/references?scope=all` 조회에 즉시 잡힌다 (RefPickerSheet의 재조회 패턴이 이미 프로덕션에서 증명).
- `/generate?ref=<tweetId>` 딥링크가 같은 "전량 조회 → tweetId로 찾기 → refRows 추가" 패턴을 쓴다 (page.tsx 186-199행)
  → 단건 조회 API를 새로 만들지 않는다.
- **충돌 1건 발견**: page.tsx의 피크 닫기 Esc 리스너(146-151행)는 `editing`만 가드한다.
  피크가 열린 채 링크 모달을 열고 Esc를 누르면 모달과 피크가 함께 닫힌다.
  → 가드에 `addLinkOpen`을 추가한다 (편집 모달 선례와 동일한 해법).

## A. `DraftComposer.tsx` — 진입점

- prop `onOpenAddLink: () => void` 추가.
- '참고할 레퍼런스' 섹션의 **두 상태 모두**에서(사용자 확정: 항상 표시), 기존 버튼
  ('보관함에서 고르기' / '＋ 레퍼런스 더 고르기') 바로 아래에 `🔗 링크로 추가` 버튼.
- 톤: 보조 — 흰 배경 + `border-x-border-strong`, `text-x-blue-text` ('더 고르기' 버튼과 동급).
  빈 상태의 주 진입점('보관함에서 고르기', 파란 강조)보다 낮은 위계.
- 패널에 도움말 문장은 추가하지 않는다 — 모달 안에 이미 "X에서 공유 → 링크 복사한 주소를
  붙여넣으면 팀 보관함에 저장돼요"가 있다 (progressive disclosure, UX 원칙 2·5).

## B. `generate/page.tsx` — 배선

- 상태 `addLinkOpen` 추가. `<AddByLinkModal open={addLinkOpen} onClose={…} defaultWsId={lastWsId} onAdded={…} />`
  (fixedWsId 없음 → 워크스페이스 드롭다운 노출, lastWsId 기본값).
- `onAdded(r)`:
  1. `/api/references?scope=all` 조회 → `r.tweetId`로 row를 찾는다.
  2. 이미 refRows에 있으면 → 토스트 "이미 보관함에 있어요 — 이미 레퍼런스로 선택돼 있어요".
  3. refRows가 `MAX_REFS_UI`(8)건이면 → 저장만 하고 자동 선택 안 함(RefPickerSheet 규칙과 동일),
     토스트로 사유 서술 (UX 원칙 3). 문구는 "위 레퍼런스 목록에서 조정해주세요" —
     이 분기에선 패널 버튼 라벨이 '더 고르기'라 '보관함에서 고르기'를 콕 집으면 화면에 없는
     버튼을 가리킨다(리뷰 Important 반영, UX 원칙 4).
  4. 아니면 refRows에 추가 + 토스트 "보관함에 추가하고 레퍼런스로 선택했어요".
  5. 조회 실패·row 미발견(비정상) → "보관함엔 저장됐어요 — 레퍼런스 고르기에서 선택해주세요" 폴백
     (특정 버튼 라벨 대신 두 상태 모두에서 참인 표현).
- 피크 Esc 리스너 가드에 `addLinkOpen` 추가 (위 충돌 해소).
- 레퍼런스가 생기면 '무엇을 가져올까요(형식/앵글)' UI는 기존 로직대로 자동 노출 — 변경 없음.

## 검증

- 컴포넌트 하네스가 없는 코드베이스 — 서버 로직 무변경이므로 `npm run build` + lint 기준선(24개) 유지로 검증.
- 화면: 로컬 build+start(-p 3001, 127.0.0.1)로 확인 후 koo 최종 QA.

## 하지 않는 것

- 신규 API·단건 레퍼런스 조회 엔드포인트 (전량 조회 재사용이 배포된 패턴).
- 패널 내 인라인 입력폼 (모달 재사용이 보관함·시트와 UX 일관).
- RefPickerSheet·AddByLinkModal 내부 변경 (기존 두 진입점 동작 그대로).
