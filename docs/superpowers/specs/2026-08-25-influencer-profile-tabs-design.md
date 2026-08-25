# 인플루언서 프로필: 3구역 탭 재구성 — 설계 스펙

- 날짜: 2026-08-25
- 브랜치: `cb-koo/influencer-profile` (협찬 단가·계정 분석·히트맵 위에 얹음)
- 배경: 프로필 패널에 섹션이 9개까지 늘어 "너무 어지럽다"는 피드백. 사용자가 정한 3구역 — ①계정 정보 ②협업 콘텐츠 성과 ③거래 정보 — 로 재구성한다.

## 0. 목적·범위

- 목적: 프로필을 "지금 하려는 일" 단위로 나눠 한 번에 한 구역만 보이게 한다 — 계정 파악 / 협업 콘텐츠 확인 / 거래 조건 확인.
- **이번 범위 = 3구역 프레임 + 기존 섹션 재배치만.** API·스토어·데이터 변경 0.
- 범위 밖(각각 별도 스펙): 게시물 성과 지표 연결(협업 탭에 추가 예정), 정산·결제 정보(거래 탭에 추가 예정).

## 1. 구조

```
헤더 (아바타·이름·@핸들·팔로워·프로필 갱신)      ← 고정
현황 스트립 (팔로업 배지 · 원고 상태 요약)         ← 고정
오류 안내띠 (loadErr · msg)                       ← 고정 — 어느 탭에서도 보임
── 탭 바: 계정 정보 | 협업 콘텐츠 | 거래 정보 ──
[탭 패널 3개 — 전부 마운트, 비활성은 hidden]
  계정 정보:  계정 분석 → 태그 → 고정 메모 → 주고받은 기록 → 명부에서 제거
  협업 콘텐츠: 넘긴 원고
  거래 정보:  협찬 단가
```

- 탭 라벨 결정: 두 번째 탭은 지금 내용(원고 목록)에 맞춰 **"협업 콘텐츠"**. 성과 지표가 붙는 스펙에서 "협업 성과"로 바꾼다 — 라벨이 내용보다 크게 약속하지 않게(라벨-값 일치).
- 형태: X 프로필의 "게시물/답글/미디어"와 같은 **밑줄 탭**(X 미러링 방향). 활성 탭은 굵은 글씨 + x-blue 밑줄, 비활성은 x-secondary.
- 탭 라벨 옆 **개수 배지**(있을 때만): 협업 콘텐츠 `N`(= `influencer.draftCount`, 현황 스트립의 원고 요약과 같은 출처), 거래 정보 `N`(= 단가가 입력된 유형 수, `PRICE_TYPES` 중 null 아닌 것). 0이면 배지 없음 — 빈 탭을 있는 척하지 않는다.
- 기본 탭 = 계정 정보.

## 2. 탭 상태 = URL

- `?tab=account | content | deal`. 명부 선택 `?i=`와 같은 방식 — 새로고침·뒤로가기·링크 공유에 유지되고, **다른 인플루언서로 바꿔도 같은 탭이 유지**된다(거래 조건을 여러 명 비교하며 넘길 때).
- 모르는 값·부재 → `account`. URL 갱신은 `router.replace`(히스토리 오염 없음, `?i=`와 같은 관례).
- **page.tsx 수정 필요**: 현재 `router.replace(`${pathname}?i=${id}`)`가 파라미터를 통째로 덮어써 `tab`이 사라진다. `URLSearchParams`로 기존 파라미터를 병합해 `i`만 바꾸도록 고친다. 선택 해제(`router.replace(pathname)`)는 그대로(탭은 다음 선택 때 기본값으로).
- `useSearchParams`는 이미 있는 Suspense 경계(`page.tsx`) 안에서 읽는다.

## 3. 패널 렌더 방식 — 전부 마운트, `hidden`

선택된 패널만 렌더하면 (a) 고정 메모의 blur 저장이 탭 클릭과 경합해 실패 문구를 잃고 (b) 태그 입력 중 텍스트, 단가 입력 중 값, 분석 오류 안내가 사라진다. 세 패널을 모두 마운트하고 비활성 패널은 `hidden` 속성으로 숨긴다 — React 상태가 보존되고 DOM 비용은 무시할 수준. 진행 중 계정 분석 표시도 탭과 무관하게 이어진다(이미 모듈 레지스트리).

## 4. 컴포넌트 분해 (595줄 파일 정리 겸 — 이동만, 로직 변경 0)

- `src/app/influencers/ProfileTabs.tsx` — 탭 바. `role="tablist"`, 각 탭 `role="tab"` + `aria-selected` + `aria-controls`, 패널 `role="tabpanel"` + `aria-labelledby`, 좌우 방향키로 이동. 순수 함수 `parseTab(v: string | null): TabKey`, `dealBadge(pricing: Pricing): number` 는 `src/lib/profileTabs.ts`에 두고 단위 테스트.
- `src/app/influencers/AccountTab.tsx` — 계정 분석·태그·메모·기록·제거 조립.
- `src/app/influencers/ContentTab.tsx` — 넘긴 원고(`DraftRollup` 이동).
- `src/app/influencers/DealTab.tsx` — 협찬 단가(`PricingSection` 배치).
- `src/app/influencers/Timeline.tsx` — Timeline·AutoLine·AutoGroup·LogItem·autoText·groupText 이동(파일 비대의 주원인).
- `InfluencerProfile.tsx` — 데이터 로드·헤더·현황·안내띠·탭 컨테이너만 남김. **`Avatar` export는 이 파일에 그대로 둔다**(page.tsx가 import) — 옮기면 re-export.
- TagEditor·NoteEditor·DangerZone은 AccountTab이 쓰므로 함께 이동해도 되고 남겨도 된다 — 파일 크기 기준으로 구현 시 판단, 어느 쪽이든 export 경로는 내부용.

## 5. 데이터·상태

- `InfluencerDetail` 한 번 로드 → 탭에 나눠 그림. 탭 전환에 네트워크 없음.
- 콜백 배선(onChanged·onDeleted·onSaved·onAnalyzed·onAdded/onRemoved)은 기존 그대로 부모에서 각 탭으로 내려준다.
- 현황 스트립의 원고 요약(`draftStatusCounts`)과 협업 탭 배지(`draftCount`)는 같은 상세 응답에서 온다.

## 6. 엣지

| 상황 | 동작 |
|---|---|
| `?tab=` 값이 이상함 | account로, 오류 없이 |
| 인플루언서 삭제 후 | onDeleted가 선택 해제 → `?tab` 포함 파라미터 정리(기존 `router.replace(pathname)`) |
| 탭 전환 중 입력 상태 | hidden 마운트라 보존(§3) |
| 좁은 패널 폭 | 탭 3개 + 배지는 한 줄에 들어감(라벨 4~5자). 넘치면 가로 스크롤 없이 줄바꿈 허용 |

## 7. 검증

- 단위 테스트: `parseTab`, `dealBadge`.
- 이동만이라 기존 스토어·판단·분석 테스트 전부 통과, tsc 0, lint 기준선 24, build.
- 화면 QA(koo): 탭 전환·URL 유지·인플루언서 교체 시 탭 유지·입력 상태 보존·배지 수치 일치.

## 8. 범위 밖 재확인

- 성과 지표 연결(협업 탭 확장, 탭명 "협업 성과"로 승격) — 별도 스펙.
- 정산·결제 정보(거래 탭 확장) — 별도 스펙, 입력 항목 정의 필요.
- 탭 순서·구성 사용자 편집 — 요구 없음(YAGNI).
