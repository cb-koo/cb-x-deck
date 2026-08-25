# 인플루언서 프로필: 3구역 탭 재구성 — 설계 스펙

- 날짜: 2026-08-25 (리뷰 반영 v2)
- 브랜치: `cb-koo/influencer-profile` (협찬 단가·계정 분석·히트맵 위에 얹음)
- 배경: 프로필 패널에 섹션이 9개까지 늘어 "너무 어지럽다"는 피드백. 사용자가 정한 3구역 — ①계정 정보 ②협업 콘텐츠 성과(이번 라벨은 §1 참조) ③거래 정보 — 로 재구성한다.

## 0. 목적·범위

- 목적: 프로필을 "지금 하려는 일" 단위로 나눠 한 번에 한 구역만 보이게 한다 — 계정 파악 / 협업 콘텐츠 확인 / 거래 조건 확인.
- **이번 범위 = 3구역 프레임 + 기존 섹션 재배치.** API·스토어·데이터 변경 0. 컴포넌트 로직은 "이동"이 원칙이되, 탭 프레임이 새로 만드는 실패 모드(§3 숨은 탭의 저장 실패)를 막는 최소 배선 1건(`onErrorChange`)은 포함한다.
- 범위 밖(각각 별도 스펙): 게시물 성과 지표 연결(협업 탭에 추가, 그때 탭명 "협업 성과"로 승격), 정산·결제 정보(거래 탭에 추가).

## 1. 구조

```
헤더 (아바타·이름·@핸들·팔로워·프로필 갱신)      ← 고정
현황 스트립 (팔로업 배지 · 원고 상태 요약)         ← 고정
알림띠 (loadErr · msg — 성공/경고/오류 모두)       ← 고정 — 어느 탭에서도 보임
── 탭 바: 계정 정보 | 협업 콘텐츠 N | 거래 정보 ──
[탭 패널 3개 — 전부 마운트, 비활성은 hidden]
  계정 정보:  계정 분석 → 태그 → 고정 메모 → 주고받은 기록 → 명부에서 제거
  협업 콘텐츠: 넘긴 원고
  거래 정보:  협찬 단가
```

- 탭 라벨: 두 번째 탭은 지금 내용(원고 목록)에 맞춰 **"협업 콘텐츠"**. 성과 지표가 붙는 스펙에서 "협업 성과"로 바꾼다 — 라벨이 내용보다 크게 약속하지 않게(라벨-값 일치).
- 형태: X 프로필의 "게시물/답글/미디어"와 같은 **밑줄 탭**(X 미러링). 활성 = 굵은 글씨 + x-blue 밑줄, 비활성 = x-secondary. **시각 언어 구분**: 이 저장소의 알약형(DraftFilterBar)은 "필터", 밑줄 탭은 "구역 전환" — 섞지 않는다.
- 배지: **협업 콘텐츠에만** 원고 건수(`influencer.draftCount`, 0이면 배지 없음). 거래 정보에는 배지를 두지 않는다 — "단가 유형 수"는 원고 건수와 단위가 달라 같은 자리의 숫자가 다른 뜻이 된다(원칙 4). 배지가 생기므로 `DraftRollup` 제목의 숫자는 뺀다(같은 수가 세 곳에 뜨는 것 방지) — "최근 N건 표시" 캡션은 유지.
- 현황 스트립의 원고 요약(`draftStatusCounts`)과 배지(`draftCount`)는 같은 상세 응답에서 온다(쿼리는 둘이지만 집계 대상이 같아 값이 일치).
- 기본 탭 = 계정 정보. 섹션 순서는 사용자 확정(계정 분석이 맨 위 — "어떤 계정인가"를 먼저).

## 2. 탭 상태 = URL

- `?tab=content | deal`. 기본값(account)은 URL에서 **삭제**한다(파라미터 없음 = 계정 정보). 모르는 값 → account, 오류 없이.
- 유지 범위: 새로고침·다른 페이지에서 되돌아옴·링크 공유·**다른 인플루언서로 교체**. (`router.replace`라 탭 사이 뒤로가기는 없다 — 의도.)
- **URL 쓰기는 양쪽 다 병합 헬퍼 하나로**: `?i=` 쓰기(`page.tsx`)와 `?tab=` 쓰기 모두 `URLSearchParams` 복사 → set/delete → 빈 쿼리면 `pathname`. 선례 `src/app/w/[wsId]/library/page.tsx:34-39`. 한쪽만 고치면 다른 쪽 쓰기가 상대 파라미터를 지운다(탭 쓰기가 `i`를 지우면 프로필이 통째로 사라진다).
- `router.replace(url, { scroll: false })` — 탭 클릭마다 상단으로 튀지 않게.
- 탭 상태는 `InfluencersSplit`(`key={selected.id}` **바깥**)에서 URL을 읽어 `tab`/`onTabChange`로 내려준다 — 리마운트와 무관하게 탭이 유지되고, `useSearchParams`도 이미 있는 Suspense 경계 안이다.
- 선택 해제·삭제 시 `router.replace(pathname)`은 그대로 — 선택이 없으면 탭도 의미가 없다.

## 3. 패널 렌더 — 전부 마운트, `hidden`, 그리고 숨은 탭의 실패 표식

- 세 패널을 모두 마운트하고 비활성은 `hidden` 속성(Tailwind preflight가 display 유틸보다 우선 — 확인됨). 입력 중 텍스트·단가 초안·분석 진행/오류 표시가 보존된다. 탭 클릭은 mousedown에서 blur가 먼저 일어나 blur 저장이 `hidden` 전에 시작된다.
- **hidden은 보존하지만 보여주지는 않는다** — 단가·메모 blur 저장이 실패하면 오류 문구가 숨은 패널 안에 그려져 사용자는 저장된 줄 안다(거짓 성공). 대책: 저장 오류를 가진 컴포넌트가 `onErrorChange(hasError)`로 부모에 알리고, 부모가 탭별 오류 상태를 모아 **해당 탭 라벨에 표식**(빨간 점 + `sr-only` "저장되지 않은 항목 있음"(저장 실패와 검증에 걸려 저장되지 않은 입력을 모두 덮는 말 — 어느 쪽이든 숨은 패널에서 조용히 사라지면 거짓 성공이다), 색만으로 전하지 않음)을 띄운다. 대상: NoteEditor·PricingSection(blur 저장 — 주 경로), TagEditor·Timeline 입력(같은 prop, 일관성). 오류가 해소되면 표식도 사라진다.
- 포털 오버레이(히트맵 툴팁·InfoTip)는 `hidden`을 빠져나간다: 키보드·링크로 탭이 바뀌면 열린 채 남을 수 있고, InfoTip은 숨은 앵커의 0 rect를 읽어 좌상단으로 튄다. 대책: 두 곳의 배치 함수에서 **rect가 0이면 닫기**(InfoTip.tsx 공용 수정 1줄 포함), 히트맵은 탭 변경 시에도 닫는다.

## 4. 컴포넌트 분해 (595줄 파일 정리 겸 — 이동만)

- `src/app/influencers/ProfileTabs.tsx` — 탭 바. `role="tablist"`, 탭 `role="tab"` + `aria-selected` + `aria-controls`, 패널 `role="tabpanel"` + `aria-labelledby`. **롤링 tabindex**(활성 0 / 비활성 -1), 좌우 방향키는 포커스만 이동하고 **Enter/Space로 활성화**(수동 — URL 내비게이션이 키 한 번마다 일어나지 않게). 순수 함수는 `src/lib/profileTabs.ts`: `parseTab(v: string | null): TabKey`, `tabHref`류 병합 헬퍼(`mergeQuery`), 단위 테스트.
- `src/app/influencers/AccountTab.tsx` — 계정 분석·태그·메모·기록·제거 조립.
- `src/app/influencers/ContentTab.tsx` — 넘긴 원고(`DraftRollup` + `STATUS_BADGE` 이동).
- `src/app/influencers/DealTab.tsx` — 협찬 단가(`PricingSection` 배치, `logs` 필수 전달 — §5).
- `src/app/influencers/Timeline.tsx` — Timeline·AutoLine·AutoGroup·LogItem·autoText·groupText·**groupAuto·groupRange·CHANNEL_LABEL** 이동.
- `src/app/influencers/profileShared.ts` — 다섯 컴포넌트가 쓰는 `errOf` 공유 모듈로.
- `InfluencerProfile.tsx` — 데이터 로드·헤더·현황·알림띠(`Msg`/`MSG_STYLE` 잔류)·탭 컨테이너·탭별 오류 상태. **`Avatar` export는 이 파일에 그대로**(page.tsx가 import).
- TagEditor·NoteEditor·DangerZone은 AccountTab이 쓴다 — 파일 크기 기준으로 함께 이동 여부 판단(어느 쪽이든 내부 export).

## 5. 데이터·상태

- `InfluencerDetail` 한 번 로드 → 탭에 나눠 그림. 탭 전환에 네트워크 없음.
- 콜백 배선(onChanged·onDeleted·onSaved·onAnalyzed·onAdded/onRemoved)은 부모(InfluencerProfile)가 소유하고 각 탭으로 내려준다.
- **`logs`는 두 탭에 걸친다**: 거래 탭의 PricingSection이 `logs`로 유형별 이력을 만들고, `onSaved`가 새 로그를 부모 `data.logs` 앞에 붙여 계정 탭 Timeline에 나타난다. `logs`·`onSaved`는 반드시 부모 상태로 유지(탭 로컬로 내리면 이력이 깨진다).
- 진행 중 계정 분석은 모듈 레지스트리 + 미언마운트로 이중 안전.

## 6. 엣지

| 상황 | 동작 |
|---|---|
| `?tab=` 값이 이상함/부재 | account, 오류 없이 |
| 인플루언서 교체 | 탭 유지(§2), `?i=`만 바뀜 |
| 삭제·선택 해제 | `router.replace(pathname)` — 탭 파라미터도 정리 |
| 탭 전환 중 입력 상태 | hidden 마운트라 보존; 저장 실패는 탭 표식(§3) |
| 열린 툴팁 | 탭 전환·0 rect에 닫힘(§3) |
| 브라우저 찾기(Ctrl+F) | 숨은 탭 내용은 검색되지 않음 — 감수(한 화면이던 때와 다른 점) |
| 좁은 패널 폭 | 탭 3개 + 배지 한 줄. 넘치면 줄바꿈 허용 |

## 7. 검증

- 단위 테스트: `parseTab`, `mergeQuery`(i·tab 병합, 기본값 삭제, 빈 쿼리→pathname).
- 이동이라 기존 스토어·판단·분석 테스트 전부 통과, tsc 0, lint 기준선 24, build.
- 화면 QA(koo): 탭 전환 지연·스크롤 튐 없음, URL 유지, 인플루언서 교체 시 탭 유지, 입력 상태 보존, 배지=현황 요약 합계, 숨은 탭 저장 실패 시 표식.

## 8. 범위 밖 재확인

- 성과 지표 연결(협업 탭 확장, "협업 성과"로 승격) — 별도 스펙.
- 정산·결제 정보(거래 탭 확장) — 별도 스펙.
- 탭 순서·구성 편집, 기본 탭 섹션 순서 재검토 — 요구 없음.
