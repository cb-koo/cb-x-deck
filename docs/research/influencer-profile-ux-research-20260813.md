# 인플루언서 프로필/상세 화면 UX 리서치

> 작성일 2026-08-13 · cb-x-deck 인플루언서 프로필 패널 UI/UX 개선 참고용
> 리서치 대상: Favikon, Influencer Hero, Upfluence(기존 리서치 재활용) + 신규: CreatorIQ, Modash, 범용 CRM(Pipedrive/HubSpot/Salesloft/Freshsales/Attio)
> 도구: exa 웹서치/페이지 fetch (WebSearch/WebFetch 미사용)

---

## 0. 왜 범용 CRM도 봤는가

인플루언서 마케팅 툴 3사(Favikon/Influencer Hero/Upfluence)의 "개별 프로필 화면" 자체에 대한 1차 자료(스크린샷·헬프센터)는 있지만, 레이아웃 배치·정보 위계·"협업 히스토리를 어떻게 시각화하는가" 같은 화면 설계 디테일은 오히려 성숙한 범용 CRM(HubSpot 레코드 리디자인 회고, Pipedrive 헬프센터, Salesloft, Freshsales)이 더 구체적으로 문서화되어 있었다. 이 결과는 "지금 사람이 몇 명 있고 무엇을 할 차례인가"를 다루는 화면이라는 점에서 인플루언서 CRM과 본질적으로 같은 문제이므로 함께 인용한다.

---

## 1. 개별 프로필 페이지의 구조: 섹션·순서·위계, Above the fold

### 확인됨 (Confirmed — 헬프센터 문서/스크린샷 근거)

**Favikon Creator Profile** (출처: https://help.favikon.com/en/articles/14061092-creator-profile)
탭 구조, 순서 고정:
`Overview → Performance → Content → Authenticity → Audience → Collaborations`
- **Overview 탭이 항상 첫 화면(above the fold)**: AI 생성 요약문 + 전체 플랫폼 합산 팔로워 + 니치 내 랭킹 + 브랜드 적합도(Brand fit) + "Score/Followers/Growth/Last Activity/Activity/Engagement Rate" 6개 지표를 표(aggregated metrics)로 배치.
- 협업 이력은 맨 마지막 탭(Collaborations)에 위치 — "이 크리에이터가 적합한가"를 먼저 보여주고, "누구와 일했었나"는 검증 단계로 뒤로 미룸. 즉 **발굴/스코어링 툴답게 "평가 → 이력" 순서**.
- Authenticity/Audience 탭은 Trial 플랜에서 비공개 — 유료 기능 게이팅이 탭 자체를 숨기는 방식.

**Influencer Hero Deal Page** (출처: https://help.influencer-hero.com/en/articles/9775949-influencer-s-deal-page)
탭 구조: `Home → Posts → Affiliate → Analytics → Payouts → Details → Custom Fields`
- **Home 탭이 곧 "대시보드"**: 한 화면 안에 ①캠페인 보드/현재 스테이지 ②인적정보+어필리에이트 요약 ③열린/보류 태스크 ④활동 타임라인 ⑤이메일 히스토리 ⑥특수 액션(제품발송 등 버튼)이 전부 들어있다. 즉 우리 식으로 말하면 "헤더+상태+할일+기록+액션"이 탭 전환 없이 스크롤 한 화면에 있다.
- 태스크 배지(`Todo/Waiting/Overdue/Follow Up`)가 홈 탭 상단부에 위치 — "지금 뭘 해야 하는가"가 프로필 진입 직후 최상단.
- 메모/특이사항은 **Details 탭**(맨 뒤에서 두 번째)으로 분리 — 활동 이력(Home)과 정적 메모(Details)를 의도적으로 분리한 설계.

**Modash Profile Report** (출처: https://help.modash.io/en/articles/13715024-profile-reports-and-summaries)
"오버뷰 + 탭"구조. 클릭 즉시 여는 게 아니라 검색결과에서 **사이드 패널 요약(summary)** → "Open full report" 클릭 시 전체 리포트로 확장되는 2단계 노출(요약 먼저, 전체는 opt-in). 이는 우리 좌목록/우패널 구조와 유사 — "목록에서 클릭 = 요약 패널, 더 필요하면 전체화면"의 점진적 공개 패턴.

**CreatorIQ Community 프로필** (출처: https://www.creatoriq.com/whats-new-in-creatoriq/community-management)
"Rich creator profiles"를 "complete social presence + recent content + full relationship history with your brand" 3요소로 명시. 개별 크리에이터 화면보다 상위의 "Community" 뷰(전체 리스트에 Retained/New/Lost/Potential 토글)가 더 강조되어 있어, 이 문서만으로는 개별 프로필 레이아웃의 섹션 순서까지는 확인 불가(추정만 가능).

### 추정 (Inferred — 마케팅 카피/개요 수준, 화면 캡처 미확인)

- Upfluence Community 사이드 패널(기존 리서치 문서 인용, 출처: help.upfluence.co/en/articles/5361498): 연락처 → 상태 → 태그 → 평점/커스텀값 → 캠페인 참여 이력 → 어필리에이트 커미션 → 연락 이력 순으로 보이나, 정확한 시각적 순서·above-the-fold 경계는 스크린샷으로 검증되지 않음(문서 자체가 이렇게 명시).

### 범용 CRM 참고 패턴 (확인됨 — CRM 벤더 공식 문서)

- **Pipedrive 연락처 상세** (https://support.pipedrive.com/en/article/contact-detail-view): 사이드바가 `Summary(항상 고정 4항목: 라벨/이메일/전화/소속) → Details(커스텀 필드) → Overview(활동 요약)` 순, 별도로 **Focus 섹션**이 있어 "예정 활동 + 이메일 초안 + 고정된 메모(pinned notes)"만 최상단에 별도로 뽑아 보여줌. → "곧 해야 할 일 + 고정 메모"를 프로필 최상단 전용 구역으로 격리하는 패턴이 우리 "고정 메모"와 직접적으로 겹친다.
- **Salesloft Person Profile** (https://help.salesloft.com/s/article/Person-Profile-Page): 화면을 3열로 나눔 — 좌(기본정보+통계+퀵액션+태그), 중앙(활동 피드), 우(시퀀스+연동). "패널 순서/on-off를 사용자가 직접 편집(Edit Layout)"할 수 있게 함 — 고정 레이아웃이 아니라 팀마다 다른 우선순위를 인정.
- **Freshsales Contacts** (https://crmsupport.freshworks.com/support/solutions/articles/50000009663-overview-of-contacts): Overview(하이라이트 카드, 관리자가 커스터마이즈) → Details(활동 타임라인/메모/태스크 탭). **"Notes 컬럼은 고정이며 끌 수 없다"**는 명시 — 메모는 최소 보장 요소로 취급.

---

## 2. 아이덴티티 헤더 처리 — 어떤 지표를 승격/축소하는가

### 확인됨

- **Favikon Overview 탭**: 아바타·이름 옆에 "Score / Followers / Growth / Last Activity / Activity / Engagement Rate" 6개를 **가로 스탯 스트립**(aggregated metrics)으로 즉시 노출. 플랫폼별 세부(팔로워 성장 그래프, 팔로워당 참여 등)는 별도 Performance 탭으로 분리 — **"전체 합산 핵심 6개만 헤더 급으로, 플랫폼별 디테일은 접는다"**는 위계가 명확.
- **Modash**: 검색 결과 카드에서 이미 "팔로워 범위·참여율(engagement rate)"을 노출, 클릭 시 사이드 패널에서 "가짜 팔로워%·위치/성별/연령 상위 5"까지 확장, "전체 리포트"는 별도 클릭(팔로워 성장 그래프·오디언스 상세·과거 협찬 게시물 등)으로 한 번 더 미룸. 3단계 점진적 공개(카드 요약 → 사이드패널 → 전체 리포트).
- **Influencer Hero Deal Page Home**: "Main personal details and affiliate/performance info"를 헤더 바로 아래 요약 블록으로, 상세 수치(클릭/전환/커미션 등)는 Affiliate 탭으로 위임.
- **HubSpot 레코드 리디자인 회고** (https://product.hubspot.com/blog/rethinking-hubspots-record-design-with-usability-in-mind): 실사용 데이터 기준 **"연락 카드 링크로 전화/이메일을 거는 사용자는 4% 미만"**이라 그 액션의 시각적 비중을 낮추고 대신 "빠른 복사(quick-copy)" 버튼을 넣음. **"우측 사이드바를 접고 펴는 기능을 쓰는 사용자가 2% 미만"**이라 그 토글 자체를 제거하고 화면 로드 속도·세로 공간을 확보. → "쓰지 않는 어포던스는 제거하거나 축소"를 실측 데이터로 증명한 사례.

### 추정

- Upfluence Community 사이드패널의 "응답 점수(response score)"(과거 응답여부·평균 응답시간을 하나의 파생 지표로 압축) — 원자료(이메일 스레드 수)를 그대로 안 보여주고 판단이 담긴 파생 숫자로 승격한 것으로 보이나, 시각적 배치(헤더 급인지 하위인지)는 미확인.

---

## 3. 관계/협업 히스토리 표현 — 타임라인 vs 테이블 vs 카드, 자동·수동 혼합

### 확인됨

- **Influencer Hero Home 탭**: "활동 타임라인(Activity timeline)"과 "이메일 히스토리(Email history)"를 **별도 블록**으로 나눔 — 시스템 자동 이벤트(스테이지 이동 등으로 추정)와 사람이 주고받은 이메일 스레드를 같은 타임라인에 합치지 않고 분리 노출.
- **Upfluence 관계 상태 이원 체계**(기존 리서치, 출처: help.upfluence.co/en/articles/9795200): `Lead(자동) → Contacted(자동, 메일 발송 시) → Engaged(자동, 캠페인 상황별)` vs **사용자 정의 수동 상태**. 수동이 자동보다 우선순위가 높아 자동으로 되돌아가지 않고, 수동 상태를 지우면 자동 규칙으로 복귀. → **"자동 판정 상태"와 "사람이 얹은 판단"을 같은 필드에 섞되 우선순위 규칙으로 충돌을 해소**하는 설계.
- **Pipedrive Overview 섹션**: "활동 생성 + 어떤 사용자가 상호작용했는지"를 한 스트림에, 그리고 **Changelog(변경 이력)**를 별도 탭으로 분리 — "누가 무엇을 했다(활동)"와 "무엇이 바뀌었다(감사 로그)"를 구분.
- **HubSpot 타임라인 리디자인**: 40여 종 활동 타입을 감사한 결과 아이콘 23종 중복/혼란 확인 → **"접힌 상태(collapsed)를 기본값으로, 확장은 개별/전체 토글"**로 전환, 연체 항목만 빨간 원으로 강조해 색상 사용을 줄이고 신뢰도를 높임. 이는 "자동 이벤트 다수 + 수동 메모 소수"가 섞인 타임라인에서 밀도를 관리하는 구체적 해법.
- **gummble CRM UI 비교글**(https://gummble.com/blog/crm-app-ui-design-examples): Pipedrive Deal 레코드는 "**주 콘텐츠 = 활동 타임라인, 사이드바 = 속성**" 구조를 채택 — "거래는 근본적으로 일어난 일과 앞으로 할 일의 연속이지 그냥 데이터베이스 행이 아니다"라는 설계 철학을 명시. Attio는 "관계를 UI 요소로 표면화"(회사·거래·리스트 소속을 클릭 가능한 카드로) — 링크 텍스트가 아니라 미리보기 카드로 관계를 보여줌.

### 추정

- Favikon Collaborations 탭이 "브랜드/크리에이터 협업 게시물 목록 + 정렬(최신/인기 등)"이라는 점에서 카드/피드형으로 추정되나, 정확한 시각 형태(테이블인지 카드 그리드인지)는 스크린샷 미확보로 단정 불가.
- Influencer Hero의 "활동 타임라인"이 시간순 세로 리스트인지, 요약 카드인지 형태 자체는 스크린샷(로그인 필요 영역이라 exa로 열람 불가)으로 확인 못함 — 문서 텍스트 근거만.

---

## 4. 메모/태그 배치 — 활동과의 상대적 위치

### 확인됨

- **Influencer Hero**: 메모(Special notes)는 활동(Home 탭)과 물리적으로 다른 탭(Details)에 존재. 즉 "정적 프로필 정보"와 "시간순 활동"을 같은 화면 스크롤에 안 두고 탭으로 완전히 분리.
- **Pipedrive**: 반대로 "고정 메모(pinned notes)"를 **Focus 섹션**(예정 활동·이메일 초안과 함께)에 넣어, 메모 중에서도 "지금 봐야 할 것"만 콜아웃하고 나머지 메모는 History 하위로 내림 — 메모를 통째로 한 곳에 두지 않고 **중요도로 다시 쪼갬**.
- **Freshsales**: "가장 최근 메모(most recent note)"를 Overview 섹션에 미리보기로 노출하고, 전체 메모 목록은 Details의 Notes 탭. → 목록 화면(overview)엔 최신 1건만 티저로, 상세는 별도 탭.
- **Upfluence**: 태그(Tags)는 팀 전체 공유·다중 필터링 가능한 독립 필드로, 평점(Rating)은 "Custom values" 박스 안 하위 항목 — 태그와 평점을 같은 그룹으로 안 묶고 태그는 1급 필드, 평점은 확장 필드 그룹의 일부로 격을 다르게 둠.

### 추정

- 명시적으로 "태그를 헤더 바로 아래 vs 활동 위 vs 활동 아래 중 어디에 두는가"를 픽셀 단위로 확인한 자료는 없음 — 다만 조사된 모든 사례에서 **태그/메모류는 "정적 프로필 블록"으로 묶이고, 활동/이메일/타임라인류는 별도 블록·탭으로 분리**된다는 공통 패턴은 확인됨(Influencer Hero, Freshsales, Pipedrive 3사 일치).

---

## 5. "다음 행동" 어포던스 — 팔로업 리마인더, 퀵로그, 마지막 연락일 강조

### 확인됨

- **Influencer Hero 태스크 배지**(To Do/Waiting/Overdue/Follow Up): 카드·보드 레벨에서 즉시 보이는 배지로 "지금 누구부터 봐야 하는지"를 알려주는 핵심 UX 장치라고 공식 문서가 명시. Overdue 기본 기준은 48시간.
- **Pipedrive Focus 섹션**: "예정 활동 + 이메일 초안 + 고정 메모"를 상단에 모아, 곧 할 일이 없으면 이 섹션이 비어 보이는 방식으로 "다음 행동 없음"도 시각적으로 드러남.
- **gummble 정리(Pipedrive 딜 레코드)**: "**next-activity nudge**" — 다음 예정 활동을 보여주거나, 없으면 "예정된 활동 없음" 경고를 persistent하게 표시. "데이터 나열이 아니라 행동 유도가 먼저"라는 원칙을 명시적으로 제시.
- **HubSpot**: 연체(overdue) 표시만 빨간 원으로 남기고 나머지 색상을 줄여 "지금 급한 것"의 시각적 우선순위를 높임.
- **Upfluence Contacted 자동 상태**: "누군가 메일을 보내면" 자동으로 상태 전환 — 사람이 "연락했음"을 별도로 체크하지 않아도 되는 자동 로깅.

### 추정

- Favikon/Modash류(발굴 중심 툴)에는 이런 "다음 행동" 넛지가 상대적으로 약해 보인다(문서에서 확인되지 않음) — 이는 "이미 관계가 있는 소수 인플루언서를 계속 운영"하는 우리 케이스보다 "발굴·평가"가 우선순위인 툴의 특성상 팔로업 어포던스에 투자를 덜 한 것으로 추정된다(직접 근거는 없음, 정황적 추정).

---

## 6. 우리 화면에 적용 후보

현재 우리 패널: 헤더(아바타·이름·핸들·팔로워·"○일 전 기준"·새로고침) → 태그 → 고정 메모 → 주고받은 기록(자동+수동 혼합 타임라인) → 넘긴 원고 → 제거.

1. **헤더는 "핵심 지표 스트립"으로 압축하고, 나머지는 접어둔다.** Favikon Overview가 6개 지표(팔로워/성장/최근활동/참여율 등)를 한 줄로 뽑고 세부는 별도 탭(Performance)으로 미루듯, 우리도 헤더엔 "팔로워 수 + 새로고침 시점"만 남기고(현재도 그렇게 하고 있음) 추가 지표(참여율 등)가 늘어나도 헤더에 계속 얹지 말고 별도 접는 섹션으로 분리할 원칙을 미리 정해둔다.

2. **"고정 메모"를 Pipedrive의 Focus 섹션처럼 "지금 봐야 할 것" 전용 구역으로 재정의한다.** 지금은 "고정 메모"가 자유 텍스트 한 덩어리인데, Pipedrive/Freshsales 패턴을 빌리면 "가장 최근 활동 요약 1줄 + 고정 메모"를 헤더 바로 아래 한 곳에 티저로 보여주고, 전체 기록은 스크롤 아래로 내리는 구조가 "이 사람 지금 상태가 뭐였지"를 스크롤 없이 알게 해준다.

3. **"주고받은 기록" 타임라인에 HubSpot식 "기본 접힘(collapsed) + 연체만 색상 강조"를 적용한다.** 현재 자동 이벤트(배정/전달)와 수동 컨택 로그가 섞여 나열되는데, 항목 수가 늘어나면 HubSpot이 겪은 문제(1~3개만 화면에 보이고 스크롤 과다)를 그대로 겪게 된다. 각 항목을 1줄 요약으로 접어두고 클릭 시 펼치는 방식, 그리고 색상은 "다음 팔로업이 필요함" 같은 진짜 급한 신호에만 아껴 쓰는 게 맞다.

4. **Influencer Hero의 Todo/Waiting/Overdue/Follow Up 배지를 "다음 연락 필요" 단일 배지로 축소 적용한다.** 우리는 2~5명이 쓰는 도구라 4종 배지까지는 과하지만, "마지막 컨택 후 N일 경과 → 팔로업 필요" 같은 단일 파생 배지 하나를 프로필 헤더나 목록 카드에 얹으면 "누구부터 봐야 하는가"라는 핵심 문제(현재 우리 화면엔 없음)를 해결한다. 이는 AGENTS.md 원칙 3(판단까지 서술)과도 맞다 — "5일째 연락 없음 → 지금 컨택 로그 남기기"처럼.

5. **자동 이벤트와 수동 컨택 로그를 같은 타임라인에 두되, Upfluence식 "수동이 항상 우선 표시"규칙을 적용한다.** 지금 우리도 이미 하나의 타임라인에 섞고 있는데(설계상 맞는 방향), 정렬/강조 규칙이 없으면 자동 이벤트(원고 배정됨 등)가 사람이 남긴 컨택 로그를 시각적으로 묻히게 할 수 있다 — 수동 로그에는 살짝 다른 배경색/아이콘을 주어 "사람이 직접 남긴 것"이 스캔 시 먼저 눈에 띄게 한다.

6. **"넘긴 원고" 섹션 앞에 상태 요약 1줄을 붙인다.** Favikon의 "컨택 프로필에 캠페인 참여 이력이 롤업되어 보인다"는 철학과 Influencer Hero Home 탭의 "캠페인 보드+현재 스테이지"를 참고하면, 원고 리스트를 펼치기 전에 "게시완료 3건 · 진행중 1건" 같은 한 줄 요약이 먼저 오는 게, 목록을 스캔하지 않고도 상태를 파악하게 해준다.

7. **메모와 활동을 물리적으로 분리할지 여부를 재검토한다.** Influencer Hero는 메모(Details)와 활동(Home)을 탭으로 완전히 분리했지만, Pipedrive/Freshsales는 "최신 메모 1건만 상단 티저"로 절충했다. 우리는 좌우 2단 패널(스크롤 세로 배치)이라 탭 분리보다는 Pipedrive/Freshsales 절충안이 더 맞다 — 지금처럼 고정 메모를 활동 위에 계속 두되, 항목이 길어지면 "더보기" 접기를 적용한다.

8. **"○일 전 기준" 새로고침 표시 옆에, 새로고침 자체를 "언제 하면 좋은지"에 대한 판단을 붙인다.** Modash가 "팔로워 수는 최소 주 1회, 오디언스 분석은 월 1회 자동 갱신"이라고 명시하듯, 우리도 새로고침 버튼 옆에 "N일 지나면 오래된 데이터일 수 있어요" 같은 판단 문구를 붙이면 AGENTS.md 원칙 3(숫자만 던지지 않기)에 부합한다.

9. **태그는 필터링 가능한 1급 필드로 유지하고, 나중에 "평점/신뢰도" 같은 확장 필드가 생기면 태그와 같은 급으로 묶지 않는다.** Upfluence가 태그(1급, 팀 공유·필터용)와 평점(Custom values 하위)을 의도적으로 다른 급으로 둔 것처럼, 태그 칩 UI를 나중에 확장할 때 "평점 별점" 같은 걸 태그 옆에 나란히 붙이기보다 별도 영역으로 두는 게 향후 확장에 안전하다.

10. **제거(삭제) 액션의 위치와 위험도 표시를 재검토한다.** 리서치 대상 어디에도 "삭제/제거" 버튼이 프로필 하단에 노출된 사례는 확인되지 않았다(대부분 별도 메뉴/설정 경로) — 우리 화면처럼 프로필 스크롤 맨 끝에 "제거" 버튼이 항상 노출되는 구조는 소규모 팀(오조작 리스크가 실질적으로 낮음)에는 맞지만, 만약 사용자가 늘어나면 이 배치를 재검토할 후보로 남겨둔다(지금 당장 바꿀 필요는 없음, 참고용).

---

## 출처 목록

**Favikon**
- https://help.favikon.com/en/articles/14061092-creator-profile
- https://help.favikon.com/en/articles/10200323-what-is-audience-analysis
- https://help.favikon.com/en/articles/12710185-discover-top-creators-with-rankings

**Influencer Hero**
- https://help.influencer-hero.com/en/articles/9775949-influencer-s-deal-page
- https://www.influencer-hero.com/blogs/influencer-hero-crm
- https://help.influencer-hero.com/en/articles/9776106-relationship-management-and-affiliate-marketing
- https://help.influencer-hero.com/en/articles/9775937-how-to-track-influencer-s-commission
- https://help.influencer-hero.com/en/articles/9778262-the-payout-manager

**Upfluence** (기존 리서치 문서 인용: /Users/koo_clinicbridge/orca/workspaces/cb-x-deck/influencer-db/docs/research/upfluence-crm-campaign-research-20260812.md)
- https://help.upfluence.co/en/articles/9795200-how-to-manage-influencer-statuses-in-upfluence
- https://help.upfluence.co/en/articles/5361498-how-to-understand-data-on-the-creator-side-panel
- https://help.upfluence.co/en/articles/7017109-how-to-add-tags-to-influencers-profiles
- https://help.upfluence.co/en/articles/4130922-how-to-add-ratings-to-influencers-profiles

**CreatorIQ**
- https://www.creatoriq.com/whats-new-in-creatoriq/community-management
- https://www.creatoriq.com/influencer-marketing-solution/creator-management
- https://www.youtube.com/watch?v=vc0e8nPxG4U

**Modash**
- https://help.modash.io/en/articles/13715024-profile-reports-and-summaries
- https://www.modash.io/blog/how-to-check-influencer-audience-demographics
- https://www.modash.io/blog/how-to-check-influencer-growth-rate

**범용 CRM (레이아웃/타임라인/메모 배치 참고)**
- https://help.salesloft.com/s/article/Person-Profile-Page?language=en_US
- https://product.hubspot.com/blog/rethinking-hubspots-record-design-with-usability-in-mind
- https://support.pipedrive.com/en/article/contact-detail-view
- https://crmsupport.freshworks.com/support/solutions/articles/50000009663-overview-of-contacts
- https://gummble.com/blog/crm-app-ui-design-examples
- https://help.pipelinecrm.com/article/199-person-profile-overview

**주의사항**
- CreatorIQ 개별 프로필의 정확한 섹션 순서/above-the-fold 경계는 로그인 필요 화면이라 1차 스크린샷으로 검증하지 못했다 — 위 절 1의 CreatorIQ 항목은 "추정"으로 표시.
- Favikon Collaborations 탭, Influencer Hero Posts/Analytics 탭의 정확한 시각적 형태(테이블 vs 카드)는 스크린샷이 로그인 게이트 뒤에 있어 텍스트 문서 근거로만 판단했다.
