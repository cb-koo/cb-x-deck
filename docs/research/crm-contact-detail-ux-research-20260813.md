# CRM 레코드 상세 화면 · 활동 타임라인 UX 리서치

조사일: 2026-08-13 · 도구: exa web search/fetch · 목적: 인플루언서 로스터 우측 프로필 패널(반폭 사이드패널) 개선안 근거

범례: **[확인]** = 1차 소스(제품 문서/헬프센터/체인지로그/디자이너 본인 블로그)로 직접 확인. **[추론]** = 2차 소스(리뷰 사이트, 스크린샷 갤러리, 튜토리얼)로 정황상 유추.

---

## 1. 정보 구조 (Information Architecture)

### Attio
**[확인]** Attio는 2026-05 "Record page redesign"에서 레이아웃을 크게 바꿨다. 핵심 변경: "The detail panel is now on the left. Attributes sit where your eye lands first." — 즉 **속성(어트리뷰트) 패널을 왼쪽**, 활동/탭 콘텐츠를 오른쪽/중앙에 두는 구조로 재배치했다. 헤더(레코드명·핵심 정보·주요 액션)는 좌상단에 고정. 섹션 간 리사이즈(드래그)가 가능하고, "Activity timeline. Automation events are now collapsed by default to highlight important events and reduce noise." — 자동화 이벤트는 기본 접힘 상태로 노이즈를 줄인다.
출처: https://attio.com/changelog/2026/record-page-redesign

**[확인]** 좀 더 안정적인 표준 구조(헬프센터 기준)는: 레코드 페이지 = 좌측 "Record Details"(속성) + "Lists"(소속 리스트) 사이드바 + 상단 탭(Overview/Activity/Notes/Tasks/Emails/Files 등). Overview 탭 상단에 최대 6개 "highlight widget"(핵심 속성 스냅샷)을 노출. Activity 탭은 "리스트 추가/변경, 레코드 생성, 노트, 예정/과거 미팅" 등을 시간순으로 보여주고 View settings에서 이벤트 타입별 노출 여부를 토글할 수 있다.
출처: https://attio.com/help/reference/managing-your-data/records/create-and-view-records , https://attio.com/help/reference/attio-101/attios-data-model/understanding-records

**[확인]** 설계 근거(Attio 창업자 인터뷰): "제품이 더 정교해져도 파워가 줄지 않아야 하지만, 항상 더 찾을 수 있는 곳이 어딘지는 명확해야 한다" — progressive disclosure를 명시적 원칙으로 삼음. Hover로 "Last interaction" 속성 위에 올리면 이메일 미리보기 모달이 뜨는 식으로, "필요한 순간에만" 정보/기능을 노출.
출처: https://strategybreakdowns.com/p/how-attio-does-design , https://strategybreakdowns.com/p/10-questions-with-attio

### HubSpot
**[확인]** 3단 컬럼 구조: 좌측 사이드바(하이라이트 섹션=이름/이메일 등 대표 속성 + 액션 버튼[노트/이메일/통화/작업/미팅 로그 아이콘] + 속성 카드), 중앙 컬럼(탭: About/Activities/Catch-up/Intelligence/Revenue — Activities 탭이 활동 타임라인), 우측 사이드바(연관 레코드: 회사/딜/티켓 카드).
출처: https://knowledge.hubspot.com/records/understand-the-default-record-layout , https://knowledge.hubspot.com/records/work-with-records

### Twenty (오픈소스)
**[확인]** 레코드 페이지 = 커스터마이즈 가능한 **탭 + 위젯** 그리드. 위젯 종류: Fields(속성), Related records, Emails, Calendar, Timeline, Tasks, Notes, Files, Charts, iFrame, Rich text. 관리자가 Cmd+K → "Edit record page layout"으로 탭/위젯 배치를 직접 편집(드래그, 리사이즈)한다. 타임라인 위젯은 우측에 배치되는 것이 표준(아래 2절 참고).
출처: https://docs.twenty.com/user-guide/layout/capabilities/record-pages

### 공통 패턴 정리
**[확인/추론 종합]** 3사 모두 "속성(정적 정보) vs 활동(시간순 이벤트)"을 명확히 분리해서 별도 컬럼/탭으로 둔다. 다만 어느 쪽을 왼쪽에 두는지는 갈린다 — Attio는 최근 개편에서 속성을 왼쪽(먼저 보이는 자리)으로, HubSpot은 속성 좌측+활동 중앙(가장 넓은 공간), Twenty는 탭 안에 자유 배치. 근거로 명시된 원칙은 "눈이 먼저 가는 자리에 가장 자주 쓰는 정보를 둔다"(Attio), "reps가 8분씩 걸려 응대하던 문제를 줄이려 스캔 가능성을 최우선"(HubSpot).

---

## 2. 활동 타임라인 UX

### 작성창(Composer) 위치
**[확인]** Lime CRM: "Activities" 타임라인은 화면 우측에 표시되고, **Composer는 하단 고정** — 기본값은 "Quick Note" 컴포넌트로 노트/파일을 바로 추가. 관리자가 다른 워크플로용 커스텀 컴포저로 교체 가능.
출처: https://platform.docs.lime-crm.com/en/latest/configuration/webclient/activities/

**[확인]** Zendesk 티켓 뷰: 대화 순서(최신이 위/아래)와 **컴포저 위치(대화 위/아래)를 관리자가 설정** 가능. 기본은 "최신 메시지가 아래 + 컴포저가 아래" — 실시간 대화형 워크플로에 최적화된 조합. 컴포저를 기본 접힘/펼침으로도 설정 가능.
출처: https://support.zendesk.com/hc/en-us/articles/6070249202202

**[확인]** ServiceNow Horizon 디자인 시스템의 Activity Stream Compose: 입력창은 포커스 시 38px→54px로 확장(평소엔 작게 유지해 공간을 아낌), 여러 사람이 같은 레코드를 보고 있으면 "OO님이 입력 중" 표시.
출처: https://horizon.servicenow.com/workspace/components/now-activity-stream-compose-connected

**[확인]** Salesloft: 프로필 페이지 우상단 "Quick Actions"에 "Add Note" 버튼 → 클릭 시 **화면 우하단에 작은 팝업 창**으로 노트 입력창이 뜬다(페이지 전환 없음). 크롬 확장에서도 동일 패턴.
출처: https://help.salesloft.com/s/article/Log-a-Note

**[확인]** EspoCRM: Stream(활동 로그) 패널은 레코드 상세 뷰의 **하단**에 위치, 관리자가 다른 패널 아래나 별도 탭으로 옮길 수 있음.
출처: https://docs.espocrm.com/user-guide/stream/

→ 요약: "타임라인 하단 고정 작성창"이 가장 흔한 기본값(Lime, Zendesk 기본, EspoCRM)이지만, "우상단 퀵액션 버튼 → 별도 팝업/모달"(Salesloft, HubSpot 로그 아이콘) 방식도 널리 쓰인다. 후자는 "어디서나 3초 내 기록"에 최적화, 전자는 "타임라인을 보면서 맥락 있게 기록"에 최적화.

### 자동 이벤트 vs 사람이 남긴 노트의 시각적 구분
**[확인]** Attio 2026 개편: "Automation events are now collapsed by default to highlight important events and reduce noise" — 자동화(시스템) 이벤트는 기본 접힘, 사람이 만든 이벤트(노트 등)가 상대적으로 부각됨.
출처: https://attio.com/changelog/2026/record-page-redesign

**[확인]** HubSpot 리디자인 블로그(디자이너 Julia Gron 본인 작성, 매우 상세): 기존엔 활동 타입마다 제각각 아이콘(40개 활동 타입 중 23개의 고유 아이콘, 일부는 같은 placeholder 아이콘 재사용)이 있어 "아이콘이 식별 안 되면 장식으로만 작동해 노이즈가 된다"는 문제를 발견. 재설계에서:
- 모든 활동을 **기본 접힘 상태**로 전환 (본문 내용 숨김, 제목/날짜/타입만 노출)
- **아이콘과 아바타를 접힌 상태에서 제거** — "충분히 식별 가능하지 않으면 장식일 뿐"이라 판단해 과감히 제거
- 색상 사용을 줄이고, 남은 색상(완료/기한초과 표시)의 의미를 강화 — "색을 덜 쓸수록 남은 색이 더 무거운 의미를 가진다"
- 연체된 작업 체크마크만 빨간 원으로 강조해 최상단 'Upcoming' 섹션에 노출
- 사용자 피드백으로 "너무 정보가 없어졌다"는 의견이 있어, 이메일/통화/미팅 등 주요 타입에는 접힌 상태에도 약간의 미리보기 텍스트를 다시 추가하는 절충안 적용
출처: https://product.hubspot.com/blog/rethinking-hubspots-record-design-with-usability-in-mind (Julia Gron 본인 정리본: https://www.juliagron.com/record-data-density — 동일 프로젝트의 1인칭 설계 노트, 성과 지표 포함)

**[확인]** 같은 블로그의 정량 성과: 타임라인 검색 필드를 좌상단 별도 입력창으로 분리한 결과 "주간 검색 사용량 469% 증가", "검색 사용 리텐션 5.3% 증가". 압축 이벤트 로딩 34ms 개선.

**[추론]** Zingage(의료 코디네이터용 SaaS, CRM은 아니지만 매우 유사한 "사람+시스템 혼합 타임라인" 사례) 엔지니어링 블로그: "이벤트와 상태(state)를 시각적으로 분리"하는 원칙 제시 — 상태 전이(escalated, transferred 등)는 가로 구분선 + 라벨로 "뼈대"를 만들고, 그 사이 이벤트는 "살"로 취급. 동일 타입 이벤트가 연속으로 몰리면(예: 짧은 시간에 10명에게 메시지 발송) **같은 액터·같은 타입의 연속 이벤트를 하나의 카드로 묶고 개수 표기**("Send message (12)") + 그 안에 수신자 목록을 압축 나열. "이벤트에는 반드시 작성자(이름+아바타)가 있어야 한다"는 규칙도 명시. CRM 사례는 아니지만 우리 타임라인의 "원고 배정/전달됨" 자동 이벤트 다수 발생 시 참고할 만한 압축 패턴.
출처: https://engineering.zingage.com/the-timeline-we-owed-our-coordinators/

### 그룹핑/필터링/빈 상태
**[확인]** HubSpot: 타임라인 상단에 "Collapse all / Expand all" 토글, 활동 타입별 탭(Notes/Emails 등)으로 필터, 검색 입력창(좌상단), Actor/기간/팀별 필터. 연도>월별로 자동 그룹핑(유저 피드백으로 "월/년 단위로도 접고 싶다"는 요청이 있었으나 미지원).
출처: https://knowledge.hubspot.com/records/filter-activities-on-a-record-timeline , https://community.hubspot.com/t/collapsable-activity-section-date-filter/19509

**[확인]** Twenty: 타임라인은 역시간순(최신 위), 상단 필터 버튼으로 타입별 필터.
출처: https://twentyhq-twenty.mintlify.app/user-guide/activities

**[추론]** 빈 상태 일반 원칙(디자인 아티클 종합): 신규 유저 첫 진입 시엔 "이 화면이 무엇인지 + 무엇을 하면 채워지는지"를 설명하는 고정보 빈 상태가 적절하고, 이미 쓰던 화면이 일시적으로 비었을 때(필터 결과 0건 등)는 저정보·단순 안내가 적절 — 두 경우를 같은 문구로 처리하면 안 됨. "No activity yet"류 일반 문구 + 스켈레톤 타임라인 노드가 흔한 패턴.
출처: https://137foundry.com/articles/how-to-design-empty-states-that-earn-trust , https://horizon.servicenow.com/workspace/components/now-template-message-empty-state

---

## 3. 퀵 캡처 (터치포인트 기록 마찰 줄이기)

**[확인]** HubSpot: 좌측 사이드바 상단 "하이라이트 섹션"에 노트/이메일/통화/작업/미팅 **아이콘 5개가 상시 노출**되어 있어, 클릭 한 번으로 해당 타입의 로그 작성창이 뜬다. 커스터마이즈로 아이콘 종류·순서 변경 가능.
출처: https://knowledge.hubspot.com/records/work-with-records

**[확인]** Salesloft: "Add Note" 퀵액션 → 화면 우하단 팝업창(페이지 이동 없이, 어느 화면에서든 동일 위치에 뜸). 크롬 확장/아웃룩 애드인에서도 사이드패널 안에서 동일 UX 유지.
출처: https://help.salesloft.com/s/article/Log-a-Note

**[확인]** Pepper(세일즈허브): "Notes" 탭은 계정 전체를 가로지르는 단일 작성 화면(어느 계정이든 개별 진입 없이 바로 기록) + 개별 계정 상세에도 "Add activity note" 버튼을 별도 배치 — "이미 계정에 들어가 있을 때"와 "여러 계정을 오가며 빠르게 기록할 때" 두 경로를 분리 제공. 노트 저장 시 옵션으로 "Reminder" 추가 가능(다음 절 참고).
출처: https://help.usepepper.com/en/articles/15507044-notes

**[확인]** Veeva CRM(제약영업 특화, 채널 선택 UX가 매우 정교함): Call 리포트 헤더의 "Channel selector"는 리포트를 새로 만들 때 **채널이 선택 안 된 경우 피커가 자동으로 펼쳐짐**. 채널 선택 전 제출 시도하면 에러로 막음. 제출 후에는 회색으로 잠김(읽기 전용). 관리자가 특정 채널(이메일/문자 등)을 아예 피커에서 제거해 승인된 채널만 남기는 것도 가능. "자동 채널 추정" 옵션도 있어, 다른 필드(마지막 기기 등)로 채널을 자동 계산하는 formula 필드를 관리자가 설정하면 사용자에게 피커 자체를 안 보여줄 수 있음.
출처: https://crmhelp.veeva.com/doc/Content/CRM_topics/Activities/Call_Reporting_2/DefaultFunct/CallChannel.htm , https://crmhelp.veeva.com/doc/Content/CRM_topics/Activities/Call_Reporting_2/AdvFunct/Executing/Header/CallChannelFormula.htm

**[확인]** ServiceNow Horizon: 컴포저는 평소 38px 높이(한 줄, 최소 침해)로 있다가 포커스 시 54px로 확장 — "기본은 최소한으로 존재하다가 쓰려는 순간에만 커진다"는 원칙의 구체적 수치 사례.

**[추론]** "가장 최근 채널을 기본 선택"에 대한 직접 근거는 확인하지 못했으나, Veeva의 "자동 채널 추정 formula" 및 HubSpot의 "최근 방문 탭으로 복귀"(2절, 최초 진입은 Overview, 이후엔 마지막 방문 탭) 패턴에서 "마지막 상태 기억"이 일반적 관례임은 확인됨.
출처(마지막 탭 기억): https://knowledge.hubspot.com/records/work-with-records ("Moving forward, you'll be brought to the tab you've visited most recently")

---

## 4. 최근 연락(Recency) & 다음 행동(Next-action) 표시

**[확인]** **Pipedrive Contacts Timeline**: "Follow-up frequency"를 관리자가 톱니바�퀴 아이콘으로 켜고 슬라이더로 "며칠마다 연락해야 하는지" 기준을 설정. 그 기준을 넘겨 연락이 없는 연락처는 **타임라인 목록에서 빨간색으로 표시**되고, 화면 상단에 "몇 명에게 연락이 필요한지" 카운터 인디케이터가 상시 노출됨. 이건 우리가 논의했던 "적정 기준 추천받기"류 UX와 매우 유사한 선례 — 단순 숫자가 아니라 "기준 대비 상태"로 색칠.
출처: https://support.pipedrive.com/en/article/contacts-timeline

**[확인]** Pipedrive Deals: "Last activity date"(마지막 완료 활동일), "Next activity date"(다음 예정 활동일, 미완료), "Update time"(단계 변경 등 포함 최종 갱신 시각) 세 필드를 구분해서 관리 — 파이프라인 뷰에서 기본 정렬 기준이 "next activity date"(다음 조치가 필요한 순).
출처: https://support.pipedrive.com/en/article/activities , https://support.pipedrive.com/en/article/pipeline-view

**[확인]** HubSpot 재설계 원칙: "연체 작업 체크마크는 빨간 원으로 강조해 Upcoming 섹션 최상단에 노출" — 색상을 아끼는 대신 "정말 급한 것"에만 써서 신호 대 잡음비를 높임.
출처: https://product.hubspot.com/blog/rethinking-hubspots-record-design-with-usability-in-mind

**[추론]** 경량 CRM류(OnePageCRM Action Stream, SugarCRM InterAction 애드온 등)에서 반복 확인되는 패턴: 담당자별 "다음 액션"을 **레코드가 아니라 사람(연락 대상) 단위로 큐에 쌓고**, 마감/초과 기준으로 3색(빨강=초과, 주황=오늘/임박, 회색=미래) 뱃지를 부여. "무거운 태스크 시스템" 없이 "다음 연락 날짜 필드 하나 + 색"만으로 알림을 대체하는 것이 공통점.
출처: https://help.onepagecrm.com/article/711-action-stream , https://www.providentcrm.com/solutions/interaction/

---

## 5. 반폭 사이드패널 제약 (HubSpot 우측 사이드바 / Attio 등)

**[확인]** HubSpot 자체 리서치 데이터(디자이너 본인 공개): "association card 링크에서 직접 통화/이메일을 거는 유저는 4% 미만" → 그 액션의 시각적 비중을 낮추고 대신 **원클릭 복사 버튼**을 추가(다른 도구에 붙여넣어 쓰는 실제 행동에 맞춤). "우측 사이드바를 접었다 폈다 하는 유저는 2%뿐" → **접기/펼치기 기능 자체를 제거**하고 그만큼 세로 공간을 확보 + 페이지 로드 속도 개선. association 카드에서도 아이콘을 제거해 노이즈를 줄임.
출처: https://product.hubspot.com/blog/rethinking-hubspots-record-design-with-usability-in-mind

**[확인]** HubSpot 2018 "Streamlined New Record Design" 발표: "작은 화면 사용 시, 타임라인에 집중하고 싶으면 우측 사이드바를 접고 펼 수 있다" — 이후 위 조사에서 실사용률이 2%임이 드러나 제거된 것으로, "만들어 놓은 유연성 기능이 실제로는 안 쓰인다"는 사례로 참고할 만함(기능 추가 전 가설 검증 필요성의 반례).
출처: https://community.hubspot.com/t/now-live-in-your-hubspot-account-a-streamlined-new-record-design/33209

**[확인]** 표준 laptop(13인치) 화면에서 유저가 한 번에 볼 수 있는 활동 수는 원래 디자인 기준 **1~3개**뿐이었다는 것이 재설계의 핵심 동기 — "화면이 좁을수록 접힌 상태(축약형)의 가치가 커진다"는 정량적 근거.
출처: https://www.juliagron.com/record-data-density

**[확인]** Twenty: "사이드패널을 리사이즈할 수 있게 됐다(navigation menu도 함께)" — 긴 콘텐츠가 있는 레코드 페이지에서 특히 유용하다고 명시. 즉 폭 자체를 유저가 조절하게 해서 "반폭"을 고정 제약이 아니라 가변으로 만드는 접근도 있음.
출처: https://twenty.com/releases

**[확인]** Attio: 좌측 Record Details 패널과 활동/탭 콘텐츠 사이의 구분선을 드래그해 리사이즈 가능 — "일부 레코드는 속성이 많아 더 넓게, 어떤 레코드는 활동을 더 깊이 보고 싶어함"을 전제로 유저에게 트레이드오프를 맡김.
출처: https://attio.com/help/reference/managing-your-data/records/create-and-view-records

---

## 우리 화면에 적용 후보 (반폭 프로필 패널 대상, 구체적 8건)

1. **자동 이벤트는 회색·아이콘 없는 한 줄로 축약, 사람이 남긴 접촉 로그만 카드로 강조.**
   Attio는 "자동화 이벤트를 기본 접힘"으로, HubSpot은 재설계에서 아예 "접힌 상태의 아이콘/아바타를 제거"했다. 우리 타임라인의 "원고 배정/전달됨"(자동)과 "DM/라인/이메일 접촉 로그"(사람이 직접 기록)를 같은 카드 스타일로 섞지 말고, 자동 이벤트는 회색 텍스트 한 줄(예: "8/10 원고 전달됨")로 축약하고 사람 노트만 카드(배경색·채널칩 유지)로 띄운다. 지금은 둘 다 동일한 타임라인 아이템 스타일이라 스캔 시 구분이 안 된다.

2. **동일 타입 자동 이벤트가 연속되면 하나로 묶어 개수 표기.** ("Send message (12)" 패턴, Zingage 사례)
   한 인플루언서에게 원고가 여러 건 연속 배정/전달되면 지금처럼 각각 줄로 늘어놓지 말고 "원고 3건 배정됨 (8/8~8/10)" 식으로 묶어, 사람 노트가 그 사이에 묻히지 않게 한다.

3. **접촉 로그 작성창을 패널 하단 고정("Quick Note" 스타일)으로 옮기고, 채널칩 기본값을 "가장 최근 사용 채널"로 미리 선택.**
   Lime CRM의 Composer(하단 고정, 기본 컴포넌트가 Quick Note)와 Veeva의 "채널 미선택 시 피커 자동 펼침" 패턴을 결합 — 지금처럼 별도 위치에 있는 게 아니라 타임라인 맨 아래에 상시 노출된 입력창을 두고, dm/라인/이메일 중 지난번에 쓴 채널이 이미 선택돼 있어 클릭 한 번(또는 엔터)으로 기록 완료되게 한다.

4. **"마지막 연락"에 Pipedrive식 기준 대비 색상(정상/지연/초과)을 적용하고, 상단에 몇 명이 기준을 넘겼는지 카운터를 둔다.**
   Pipedrive Contacts Timeline의 "follow-up frequency" 기능처럼, 단순히 "N일 전 연락함"이라는 텍스트 대신 "설정한 주기(예: 2주) 대비 초과 → 빨간색"으로 표시한다. 이는 CLAUDE.md 원칙 3(판단까지 서술)과도 부합 — "23일째 연락 없음(기준 2주 초과) → 지금 연락하기" 식으로.

5. **좌측 사이드바의 '더 이상 안 쓰는 기능'을 실사용률 데이터로 과감히 제거하라(HubSpot 2% 사례).**
   HubSpot은 "우측 사이드바 접기/펼치기 기능을 쓰는 유저가 2%뿐"이라는 걸 확인하고 그 기능 자체를 없앴다. 우리 패널이 반폭이라 공간이 늘 부족하므로, 새 기능(필터, 접기 등)을 넣기 전에 "정말 쓰이는지"부터 의심하고, 이미 있는 기능 중 안 쓰이는 게 있으면 먼저 제거해 공간을 확보하는 순서를 권한다.

6. **채널 링크(예: DM 바로가기) 옆에는 원클릭 복사 버튼을 두고, 클릭률 낮은 액션의 시각적 비중은 낮춘다.**
   HubSpot의 "association 링크에서 직접 통화/이메일 거는 유저 4% 미만 → 아이콘 비중 낮추고 복사 버튼 추가" 사례. 우리도 "DM 채널로 바로 이동" 같은 액션보다 "핸들 복사" 같은 실제로 반복되는 행동에 더 쉬운 동선을 줘야 할 수 있다(직접 사용 데이터 확인 필요 — 2~5명 규모라 인터뷰로 검증 가능).

7. **패널 폭 자체를 드래그로 리사이즈 가능하게 하는 대신, 지금은 "반폭 고정" 제약을 인정하고 접힌 밀도를 높이는 데 집중.**
   Attio/Twenty는 유저가 패널·구분선을 드래그해 폭을 조절하게 해 반폭 제약을 완화하지만, 우리는 2단 그리드가 고정 레이아웃이라 이 옵션이 당장은 크지 않다. 대신 HubSpot 사례("13인치 화면에서 원래 1~3개 활동만 보이던 것"과 우리 반폭 패널이 유사한 제약)처럼, 접힌 상태 밀도를 높여 한 번에 보이는 접촉 로그 개수를 늘리는 쪽이 더 즉각적 효과가 있다.

8. **빈 상태(접촉 이력 없음)는 "이 인플루언서와 아직 접촉 기록이 없어요" + 바로 아래 기록 입력창을 노출 — 별도 CTA 버튼/일러스트 없이.**
   137Foundry 원칙("첫 진입 빈 상태는 화면 이름 + 무엇을 하면 채워지는지 + 단일 행동")과 우리 원칙 2(행동 전 기대 설정)를 결합. 지금 3번 항목의 하단 고정 컴포저가 있다면, 빈 상태에서도 그 컴포저가 그대로 보이므로 별도의 "추가하기" 버튼이 필요 없어진다 — 클릭 수를 하나 줄이는 효과.

---

## 참고 자료 전체 목록 (신뢰도 순 아님, 등장 순)

- Attio 체인지로그 "Record page redesign": https://attio.com/changelog/2026/record-page-redesign
- Attio 헬프센터 "Create and view records": https://attio.com/help/reference/managing-your-data/records/create-and-view-records
- Attio 헬프센터 "Configure record pages": https://attio.com/help/reference/managing-your-data/records/configure-record-pages
- Attio 헬프센터 "Understanding records": https://attio.com/help/reference/attio-101/attios-data-model/understanding-records
- Attio 헬프센터 "Introduction to navigating Attio": https://attio.com/help/reference/attio-101/introduction-to-navigating-attio
- Attio 디자인 전략 분석(Strategy Breakdowns): https://strategybreakdowns.com/p/how-attio-does-design , https://strategybreakdowns.com/p/10-questions-with-attio
- Twenty 공식 문서 "Record Pages": https://docs.twenty.com/user-guide/layout/capabilities/record-pages
- Twenty 공식 문서 "Activities and Timeline"(미러): https://twentyhq-twenty.mintlify.app/user-guide/activities
- Twenty Releases: https://twenty.com/releases
- HubSpot 헬프센터 "Use the updated record default layout": https://knowledge.hubspot.com/records/understand-the-default-record-layout
- HubSpot 헬프센터 "Understand and use the record page layout": https://knowledge.hubspot.com/records/work-with-records
- HubSpot 헬프센터 "Filter activity index pages and record timelines": https://knowledge.hubspot.com/records/filter-activities-on-a-record-timeline
- HubSpot 헬프센터 "Customize records": https://knowledge.hubspot.com/object-settings/customize-records
- HubSpot 디자인 블로그(1차, 디자이너 본인) "Rethinking HubSpot's Record Design With Usability in Mind": https://product.hubspot.com/blog/rethinking-hubspots-record-design-with-usability-in-mind
- 위 프로젝트의 디자이너 개인 포트폴리오 노트(동일 프로젝트, 더 상세): https://www.juliagron.com/record-data-density
- HubSpot 커뮤니티 "Streamlined New Record Design" (2018): https://community.hubspot.com/t/now-live-in-your-hubspot-account-a-streamlined-new-record-design/33209
- HubSpot 커뮤니티 "Collapsable Activity Section & Date Filter": https://community.hubspot.com/t/collapsable-activity-section-date-filter/19509
- Pipedrive 헬프센터 "Deal detail view": https://support.pipedrive.com/en/article/deal-detail-view
- Pipedrive 헬프센터 "Activities": https://support.pipedrive.com/en/article/activities
- Pipedrive 헬프센터 "Contacts timeline": https://support.pipedrive.com/en/article/contacts-timeline
- Pipedrive 헬프센터 "Pipeline view": https://support.pipedrive.com/en/article/pipeline-view
- Lime CRM 문서 "Activities" (Composer): https://platform.docs.lime-crm.com/en/latest/configuration/webclient/activities/
- ServiceNow Horizon 디자인 시스템 "Activity Stream Compose": https://horizon.servicenow.com/workspace/components/now-activity-stream-compose-connected
- ServiceNow Horizon "Empty state": https://horizon.servicenow.com/workspace/components/now-template-message-empty-state
- Zendesk 헬프센터 "Configuring the conversation order and composer location": https://support.zendesk.com/hc/en-us/articles/6070249202202
- Salesloft 헬프센터 "Log a Note": https://help.salesloft.com/s/article/Log-a-Note
- Pepper 헬프센터 "Notes": https://help.usepepper.com/en/articles/15507044-notes
- EspoCRM 문서 "Stream": https://docs.espocrm.com/user-guide/stream/
- Veeva CRM 헬프 "Selecting a Call Channel": https://crmhelp.veeva.com/doc/Content/CRM_topics/Activities/Call_Reporting_2/DefaultFunct/CallChannel.htm
- Veeva CRM 헬프 "Auto-Populating the Call Channel": https://crmhelp.veeva.com/doc/Content/CRM_topics/Activities/Call_Reporting_2/AdvFunct/Executing/Header/CallChannelFormula.htm
- OnePageCRM 헬프 "Action Stream": https://help.onepagecrm.com/article/711-action-stream
- Provident CRM "InterAction" (SugarAI 애드온): https://www.providentcrm.com/solutions/interaction/
- Zingage 엔지니어링 블로그 "The Timeline We Owed Our Coordinators" (CRM 아님, 유사 도메인 참고): https://engineering.zingage.com/the-timeline-we-owed-our-coordinators/
- 137Foundry "How to Design Empty States That Earn Trust": https://137foundry.com/articles/how-to-design-empty-states-that-earn-trust
- Eleken "Timeline UI Design: Patterns, Examples & UX Tips"(일반 원칙, 추론 보조): https://www.eleken.co/blog-posts/timeline-ui-design
