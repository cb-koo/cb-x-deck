# 레퍼런스 칩 클릭 미리보기 (설계)

2026-08-15 · 브랜치 `cb-koo/reference-with-link` (링크로 추가 기능에 이어 두 번째)

**의도**: 생성 패널에서 고른 레퍼런스가 어떤 트윗이었는지, 시트를 다시 열지 않고 칩 클릭으로 바로 확인한다.
확인 후 자연스러운 다음 행동(빼기·원문 보기)까지 그 자리에서.

## 원칙

- **조회 0회**: 칩을 그리는 `refRows`(ReferenceRow)에 본문·이미지·지표·메모·태그가 이미 전부 있다 — 즉시 표시.
- **카드는 단일 표면**: RefPickerSheet의 트윗 카드 마크업을 `RefTweetCard`로 추출해 시트·미리보기가 공유
  (DraftCard 선례 — 복제하면 이후 카드 수정이 한쪽만 반영된다).
- **오버레이 선택 근거**: 패널 폭이 260~480px라 인라인 펼침은 최소 폭에서 카드가 찌그러진다.
  AddByLinkModal과 같은 480px 오버레이 패턴을 따른다. (사용자 확정: 미리보기 오버레이)

## A. `RefTweetCard` (신규, `src/components/RefTweetCard.tsx`)

- RefPickerSheet 카드의 내용부(아바타·헤더·본문·MediaGrid·지표 행·번역 블록·메모/태그 도구층)를 그대로 추출.
- props: `{ row: ReferenceRow; translation?: string }`. 번역 블록은 `translation`이 있을 때만.
- 선택 체크 원(absolute)은 시트 전용이라 카드에 넣지 않는다 — 시트가 버튼의 직계 자식으로 유지
  (absolute 기준이 버튼(relative)이므로 위치 변화 없음).
- 전부 `<span>`: 시트에서 `<button>` 안에 들어가므로 block 요소 불가 — 기존 마크업 그대로.
- **순수 추출**: 시각·동작 변화 0. 시트의 MediaGrid·formatCount·아이콘 임포트는 카드로 이동.

## B. `RefPreviewModal` (신규, `src/components/RefPreviewModal.tsx`)

- AddByLinkModal 패턴: z-50, `bg-black/40` 오버레이, max-w-[480px], 바깥 클릭·Esc 닫기(IME 조합 중 무시).
- props: `{ row: ReferenceRow | null; onClose; onRemove(tweetId) }` — row가 null이면 렌더 안 함(peeked 파생 선례).
- 내용: 헤더("참고할 레퍼런스" + ✕) → RefTweetCard →
  풋터: `이 레퍼런스 빼기`(onRemove 후 닫힘) · `🌐 한국어로 번역` · `X에서 원문 보기 ↗`(tweetPermalink, 새 탭).
- **번역 버튼** (koo QA 요청으로 승격, 08-15): useTranslations 재사용 — 열 때 `loadCached([tweetId])`로
  기번역분 무과금 로드, 버튼은 `translateOne` opt-in(UX 원칙 6, 시트의 🌐과 같은 캐시라 상호 재사용).
  번역 있으면 버튼이 보기/숨기기 토글, 번역문은 RefTweetCard의 translation prop으로 표시.
- 시트(z-40)와 동시 오픈 불가 — 시트가 열리면 패널이 오버레이에 덮여 칩을 누를 수 없다.

## C. DraftComposer — 칩을 진입점으로

- prop `onPreviewRef: (tweetId: string) => void` 추가.
- 칩의 `@handle` 텍스트를 버튼으로: 클릭=미리보기, 호버 밑줄, `title="클릭해서 내용 보기"`.
  ✕는 지금처럼 빼기 전용(한 칩에 두 타깃 — 링크+닫기 조합은 관례적).
- **칩 라벨 = `@핸들 · 본문 앞 12자…`** (koo QA 확정, 08-15): 핸들만으로는 같은 작성자 트윗 2개가
  구분 불가. 본문은 코드포인트 단위로 자른다 — `slice`는 이모지 서로게이트를 반토막 낸다
  (브리핑 502 사고와 같은 부류).

## D. `generate/page.tsx` — 배선

- 상태 `previewRefId: string | null`. row는 저장하지 않고 `refRows.find`로 파생(peeked 선례) —
  원본이 빠지면 모달도 자연 소멸.
- 피크 Esc 가드에 `previewRefId` 추가(링크 모달 때와 같은 충돌 예방). 빼기 경로는 모달 onClose로 id도 비운다.
- `<RefPreviewModal row={파생 row} onClose={id 비우기} onRemove={기존 setRefRows filter} />`.

## 검증

- 서버 로직 무변경 — `npx tsc --noEmit` + `npm run build` + lint 기준선(24개) 유지.
- 시트 회귀 확인 포인트: 추출 후 카드 시각 동일(체크 원 위치 포함), 번역 표시 동작 유지. 화면은 koo QA.

## 하지 않는 것

- 칩 호버 미리보기,
  미리보기에서 메모 편집·태그 편집(시트·보관함의 역할), 서버·API 변경.
