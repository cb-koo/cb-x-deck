# 주간 달력 UI 리서치 — "캘린더처럼 느껴지지 않는" 문제

조사일 2026-08-26 · 대상: 캠페인 상세 페이지 "주간 달력" 뷰 (요일 7칸 + '예정일 미정' 1칸, ◀▶ 주 페이징)

## 1. 요약

- "캘린더처럼 느껴진다"는 것은 특정 색이나 카드 스타일의 문제가 아니라 **해부학(anatomy)의 문제**다. 진짜 달력은 (a) 요일 헤더가 그리드 전체에 딱 한 번만 있고, (b) 각 칸의 날짜 숫자가 칸을 지배하지 않는 작은 "앵커" 라벨이며, (c) 주(週) 행들이 가로 구분선으로 나란히 쌓여 하나의 표를 이루고, (d) 오늘 표시가 날짜 숫자 위에 원/링으로 얹힌다. 우리 화면은 요일+날짜가 칸마다 큰 헤더로 반복되고, 각 칸이 세로로 길게 늘어나며 가로 구분선이 없어 "칸반 컬럼"처럼 읽힌다.
- '예정일 미정' 칸이 요일 칸과 같은 시각적 무게로 8번째 컬럼에 놓여 있는 것도 칸반처럼 보이는 원인 중 하나다 — 업계 도구들은 미정 항목을 별도 트레이/사이드바로 분리한다.
- 주차 ◀▶ 페이징은 캠페인이 여러 주에 걸칠 때 "이번 주만 보이는 리스트"처럼 느껴지게 만든다. 달력 도구들은 주를 페이징하지 않고 아래로 쌓아(월 그리드처럼) 범위 전체를 한 화면에서 보여준다.
- 카드 밀도는 지금 정보량(제목 2줄+핸들+단계칩)에는 맞지만, 그 풍부한 카드가 "칸" 자체를 대체해버려 칸의 경계·격자가 사라진 게 문제다. 격자선을 살리고 카드를 격자 *안의* 항목으로 되돌리는 것이 핵심.
- 아래 §3에 구체적 비주얼 스펙과 근거를 정리했다.

## 2. Q1–Q4 조사 결과

### Q1. "캘린더처럼 느껴지는" 그리드의 해부학

- **Google Calendar**: 안드로이드/크로미움 소스 기준, 오늘 날짜는 숫자 위에 반경 20px의 **채워진 원**으로 표시되고(`kTodayRoundedRadius`), 이벤트가 있으면 숫자 근처에 작은 도트가 찍히며, 토·일요일 숫자는 별도 색상을 쓴다. 다른 달 날짜는 옅은 회색으로 렌더링된다. 격자는 가로/세로 얇은 선으로 그려진다. **[인용]** https://chromium.googlesource.com/chromium/src/+/68d0813078c692ace1988ed91051839b12697079/ash/system/time/calendar_month_view.cc , https://android.googlesource.com/platform/packages/apps/Calendar/+/69ab334/src/com/android/calendar/MonthView.java
- 2025년 리디자인은 각 날짜를 둥근 사각형 카드로 감싸 "카드형" 느낌을 강화했지만, 얇은 선들이 교차점에서 광학적 잔상(Hermann grid illusion)을 만든다는 부작용도 보고됨 — 즉 **선을 너무 많이 겹치면 오히려 노이즈**가 된다는 반례. **[인용]** https://www.androidpolice.com/google-calendar-redesign-enable/
- **Ant Design Calendar**: 오늘 = 날짜 숫자 둘레에 **테두리 링**(채우기 아님), 선택된 날짜 = 채워진 원(`colorPrimary`), 주말 숫자 = 빨간 계열(`colorError`), 다른 달/범위 밖 날짜는 opacity 0.4로 흐리게. 셀 호버는 옅은 배경. **[인용]** https://ant.design/components/calendar/ , https://github.com/ant-design/ant-design/blob/master/components/calendar/index.en-US.md
- **Carbon Design System**: 날짜 피커의 day 셀은 40×40px 고정, 오늘 표시는 숫자 아래 4×4px의 작은 점. 즉 "오늘"을 셀 전체가 아니라 숫자 옆의 미세한 신호로 처리. **[인용]** https://carbondesignsystem.com/components/date-picker/style/
- **Notion Calendar(옛 Cron) 디자인 분석**: 그리드 선은 1px, 불투명도 9%(`rgba(0,0,0,0.09)`)로 매우 옅게 처리되어 "구조는 잡아주지만 콘텐츠와 경쟁하지 않는다." 이벤트는 파스텔 색 채움 + 진한 텍스트. **[인용]** https://blakecrosley.com/guides/design/notion-calendar
- **"Notion 스타일 달력은 CSS 그리드 하나다" 튜토리얼**: 이전/다음 달의 흐린 회색 padding 날짜가 "이게 전문적으로 보이는 이유의 90%"라고 명시 — 즉 범위 밖 날짜 처리 자체가 "달력처럼 보임"의 핵심 신호. **[인용]** https://dev.to/dev48v/a-notion-style-calendar-is-just-one-css-grid-3ddi
- **SAP Fiori Single Planning Calendar**: 월 뷰의 모든 약속(appointment)은 같은 너비·높이를 갖고, 셀당 3~4개까지 보이고 나머지는 "# More" 링크로 접는다. **[인용]** https://www.sap.com/design-system/fiori-design-web/v1-108/ui-elements/single-planning-calendar/usage
- **Bryntum Calendar(엔터프라이즈 스케줄러)**: 월 뷰 주(週) 행은 기본적으로 **동일한 높이로 flex**하며(칸반처럼 내용에 따라 늘어나지 않음), 셀이 좁아지면 이벤트 바 높이를 20px→14px까지 반응적으로 줄이는 옵션을 제공. **[패턴]** https://bryntum.com/products/calendar/docs-llm/api/Calendar/widget/MonthView.md
- **콘텐츠 캘린더(Viraly, thefrontkit 등 소셜 스케줄러)**: 월 뷰는 7열×4~6행, 칩(pill)에 시간 표시, 하루 3개 초과 시 "더보기" — 우리 도메인(콘텐츠 캠페인)에 가장 가까운 참조. **[패턴]** https://viraly.io/docs/calendar-views-toggle , https://thefrontkit.com/docs/social-media-dashboard-kit/calendar
- **칸반 vs 캘린더 정의 비교표**: 캘린더 UI의 필수 요소로 "보이는 날짜 범위, 모드 전환, 오늘 마커, 요일/시간축 라벨, 선택된 날짜, 시작·끝·상태가 있는 이벤트 블록"을 명시하고, 반례로 "이벤트 제목도 없고 더보기 카운트도 없는 장식적 월 그리드"를 든다. **[인용]** https://uxpatternsguide.com/compare/kanban-board-vs-table-vs-calendar-view-vs-list-view/

### Q2. 셀 안 이벤트/카드 스타일 & '미정' 항목의 위치

- **Notion 데이터베이스 캘린더**: 카드는 표시할 속성을 선택해서 보여주고, 가로 드래그로 카드를 늘려 여러 날에 걸치게 할 수 있음. **[인용]** https://www.notion.com/help/calendars
- **Airtable**: 오른쪽 **사이드바**에 전체/예약됨/미예약 레코드를 필터로 전환해서 보여주고, 카드를 사이드바→달력으로 드래그하면 예약, 달력→사이드바로 드래그하면 "미예약(unscheduling)"됨. 설계 배경 글에서 Andrew Ofstad는 카드가 "레코드는 낱개의 실체"라는 개념을 시각적으로 가르치기 위한 장치라고 설명. **[인용]** https://support.airtable.com/docs/en/getting-started-with-airtable-calendar-views , https://medium.com/@aofstad/making-and-breaking-the-grid-ee0741f86dc
- **Asana Timeline**: 날짜 없는 작업은 타임라인 **오른쪽의 "Unscheduled tasks" 패널**에 쌓이고, 토글로 숨길 수 있으며, 패널에서 캘린더로 드래그하면 날짜가 부여됨. **[인용]** https://help.asana.com/s/article/timeline
- **Planable**: 날짜/시간이 없는 포스트는 캘린더 **왼쪽의 "Saved" 컬럼**에 있고 "Show saved" 토글로 노출 여부를 조절, 준비되면 드래그해서 배치. **[인용]** https://help.planable.io/hc/en-us/articles/21715383136924-Calendar-view , https://help.planable.io/en/articles/9076171-how-can-i-find-my-draft-posts
- 세 도구(Airtable/Asana/Planable) 모두 미정 항목을 **요일 칸과 다른 시각적 영역**(사이드바/패널/별도 컬럼+토글)에 두는 것이 **패턴**으로 일관됨 — 요일 칸과 동일한 폭·헤더 스타일의 8번째 칸으로 두지 않음.
- **색상 사용**: monday.com/Calendar Plus는 색상을 5~7개로 제한하고 "색만으로 구분하지 말고 항상 텍스트/아이콘과 병행"하라고 권고(색맹 접근성). **[인용]** https://automagical.work/calendar-plus/posts/how-to-change-color-of-calendar-items-on-monday.com
- 콘텐츠 캘린더 도구(OwlStack, thefrontkit)는 플랫폼/캠페인별 색상 칩 + 상태(초안/예약/발행/실패) 뱃지를 셀 안에서 동시에 표시. **[패턴]** https://owlstack.app/features/calendar , https://thefrontkit.com/docs/social-media-dashboard-kit/calendar

### Q3. 페이징 없이 여러 주를 보여주는 법

- **Google Calendar / Ant Design / SAP Fiori 월 뷰**는 원래부터 여러 주를 **행으로 쌓아** 보여주는 구조다. 페이징은 "월"과 "월" 사이에만 있고, 한 달 안의 여러 주는 페이징하지 않는다 — 이게 우리가 벤치마크할 기본 골격이다.
- **Teamup "Multi-Week" 뷰**: 관리자가 기본 주 수를 설정할 수 있고, "현재 주가 항상 위쪽에 오도록" 구성 가능한 **롤링 다주(多週) 개요** 뷰를 명명된 패턴으로 제공 — "캠페인이 걸쳐 있는 주만큼만 보여주는 범위 뷰"에 대한 직접적 선례. **[인용]** https://www.teamup.com/learn/product-tips/choose-the-best-calendar-view/
- **Sprinklr Editorial Calendar의 "Campaigns"**: 캠페인은 월/주/일 그리드 위에 "활성 기간 동안 걸쳐서(span across the time when it is active)" 표시된다 — 즉 페이징이 아니라 그리드 위에 **기간 밴드를 얹는 방식**. **[인용]** https://www.sprinklr.com/help/articles/content-creation/campaigns-in-the-editorial-calendar/63f5dfd8e02459133724aa18
- **Atida(프로모션 캘린더)**: 행=콘텐츠 항목, 가로축=시간인 **간트차트형** 뷰로 캠페인 시작~종료를 막대로 표현, 겹침/충돌을 빨간 표시로 경고. **[인용]** https://atida.mintlify.app/docs/editor/calendar
- **범위 선택 캘린더 컴포넌트(3개 이상 독립 구현)**: 시작/끝 날짜는 **꽉 찬 색 + 둥근 끝단**으로, 중간 날짜들은 **옅은 워시(wash) + 각진 모서리**로 구분하는 것이 공통 관례 — 시작·끝을 시각적으로 "캡(cap)"처럼 강조. **[패턴]** https://github.com/BatthewZ/response-ui-react-components/blob/main/docs/components/range-calendar.md , https://tailgrids.com/docs/components/range-calendar , https://reactspectrum.blob.core.windows.net/reactspectrum/bd373679b49e80342a8ff8ad917532496d811230/docs/react-aria/RangeCalendar.html

### Q4. 밀도와 가독성

- Carbon: 날짜 피커 셀 40×40px(피커용, 카드 없음). Figma 가이드는 **최소 36–40px**, WCAG 2.5.8 터치 타깃 최소 24×24px, 모바일은 44–48px 권장. **[인용]** https://carbondesignsystem.com/components/date-picker/style/ , https://justfigma.com/designing-date-pickers-and-calendar-ui-in-figma/
- Bryntum: 이벤트 바 기본 높이 20px, 셀이 좁아져도 가독성 하한 14–16px, "임계값 3개까지는 유지, 그 이후부터 줄임" 같은 반응형 규칙. **[패턴]** https://bryntum.com/products/calendar/docs-llm/api/Calendar/widget/MonthView.md
- Notion Calendar: 격자선 9% 불투명도 — "장식이 콘텐츠와 경쟁하지 않게" 하는 원칙. **[인용]** https://blakecrosley.com/guides/design/notion-calendar
- uxpatterns.dev 캘린더 패턴: "데이터와 경쟁하는 장식적 크롬을 쓰지 말 것", "우선순위가 다른데 모든 행/카드가 같은 무게로 보이게 하지 말 것", "데스크톱/모바일 밀도를 의도적으로 설계할 것." **[인용]** https://uxpatterns.dev/patterns/data-display/calendar
- 참고(반례, 다른 방향 사례): 한 워크플로우 도구 리디자인 사례는 사용자가 "시간"이 아니라 "상태"로 생각하고 있었기 때문에 캘린더를 더 예쁘게 다듬는 대신 **칸반으로 전환한 것이 정답**이었다고 보고한다. 우리 케이스는 담당자가 명시적으로 "캘린더처럼 보이길" 원한다고 밝혔으므로 이 사례는 반대 방향 참고용 — 다만 "시각적 손질만으로 못 고치는 문제도 있다"는 점은 유의. **[추측]** https://composedesign.ila.cegid.com/blog/time-was-never-the-point-the-truth-about-task-board-ux/

## 3. 우리 화면에 대한 함의 — 비주얼 스펙 초안

현재 구조(요일 7칸+미정 1칸을 가로로 나열한 "칼럼", ◀▶ 페이징)를 유지한 채 아래 요소를 바꾸면 "칸반 컬럼"에서 "달력"으로 인상이 바뀐다.

1. **주 스택(멀티위크) — 페이징 제거**: ◀▶ 대신, 캠페인이 걸치는 주(1~3주)를 세로로 쌓아 한 화면에 모두 보여준다. 각 주는 하나의 "행"이고, 행과 행 사이에 가로 구분선을 둔다. **[패턴]** (Google Calendar/Ant Design/SAP Fiori의 월 그리드, Teamup Multi-Week). 캠페인이 1주뿐이면 행이 1개뿐이라 지금과 시각적으로 큰 차이는 없지만, 2~3주부터 체감 차이가 커진다.
2. **요일 헤더는 그리드 전체에 1번만**: "월 화 수 목 금 토 일"을 그리드 맨 위에 한 번 고정하고, 각 주 행에는 반복하지 않는다. 날짜("8/31")는 각 셀 안의 작은 앵커 라벨로 축소한다(좌상단, 12~13px, 보조색). **[인용]** (Notion 스타일 캘린더 튜토리얼, Ant Design dateCell 구조 — 날짜 숫자는 셀을 지배하지 않는 작은 텍스트).
3. **가로/세로 격자선을 살린다**: 1px, 아주 옅은 명도(라이트 모드 기준 9% 전후 불투명도)의 선으로 모든 셀을 감싼다. 지금처럼 카드 테두리만 있고 칸 자체의 경계가 약하면 "카드 더미"로 보인다. **[인용]** (Notion Calendar 9% 라인). 단, 너무 진하거나 이중으로 겹치면 노이즈가 되므로(Google Calendar 리디자인 부작용 사례) 색은 최소 대비만 준다.
4. **행 높이는 동일하게, 내용에 따라 늘어나지 않게**: 지금의 "위아래로 긴 칸"을 셀당 고정 높이(예: 카드 2~3개 분량)로 제한하고 초과분은 "+N개 더보기"로 접는다. **[패턴]** (SAP Fiori 3~4개+More, Bryntum 동일 높이 flex, Viraly 3개 제한+더보기). 우리 데이터가 캠페인당 5~20건/1~3주라 하루 평균 1~3건 수준이므로 셀당 3개 노출은 여유 있다.
5. **오늘 표시는 날짜 숫자에, 셀 전체가 아니라**: 날짜 숫자 위에 원형 배지(Google Calendar 방식) 또는 링(Ant Design 방식)을 얹는다. 국내 사용자 대부분이 구글 캘린더에 익숙하므로 **채워진 원**을 1순위로 추천하고, 셀 배경에 아주 옅은 틴트를 추가로 줘도 좋다(칸 수가 7~8개뿐이라 배경 틴트를 더해도 노이즈가 크지 않음). **[패턴]**
6. **주말(토/일) 숫자는 옅게 구분 색**을 준다(배경이 아니라 텍스트 색). **[패턴]** (Google Calendar Android 소스, Ant Design weekend 스타일).
7. **카드 스타일 — 2안 비교**:
   - **A안(컬러 칩)**: 카드 전체를 단계 색으로 옅게 채움. 장점: 단계를 가장 빠르게 스캔. 단점: 지금 카드엔 제목 2줄+핸들+단계칩까지 정보가 3종류라, 배경을 통째로 칠하면 텍스트 대비가 떨어질 위험. **[추측]**(우리 카드의 정보 밀도에 대해 직접 검증한 소스는 없음)
   - **B안(테두리 카드 + 좌측 색상바)**: 카드 배경은 중립(흰색/아주 옅은 회색)으로 두고, 왼쪽에 4px 정도의 단계색 바만 얹는다. 기존 "단계 칩" 텍스트 라벨은 그대로 유지. 장점: 기존 칩 의미를 보존하면서 색 스캔성을 더함, 2줄 제목 가독성 유지. **[패턴]**(월간뷰/스케줄러 다수가 이벤트 바·좌측 라인을 상태색으로 쓰는 관례 — monday.com 색상-바이-상태, OwlStack 캠페인별 색)
   - **추천: B안.** 이미 단계 칩이 텍스트로 상태를 말해주고 있어 카드 전체 채색은 같은 정보의 중복 인코딩이 되고, 대비 저하 리스크가 더 크다.
8. **'예정일 미정'을 8번째 요일 칸에서 분리**: 요일 그리드와 동일한 헤더 스타일(요일+날짜)을 주지 않고, 그리드 옆(오른쪽 권장 — Asana 방식)에 폭이 다른 사이드 트레이로 배치한다. 헤더 대신 "예정일 미정 (N)"처럼 개수 라벨을 붙이고, 접기/펼치기 토글을 둔다(Asana의 "Unscheduled 토글", Planable의 "Show saved" 토글). 점선 테두리는 유지해도 되지만, 요일 칸과 같은 폭·같은 헤더 톤을 쓰지 않는 것이 핵심이다. **[패턴]** (Airtable 사이드바, Asana 우측 패널, Planable 좌측 별도 컬럼+토글 — 3개 독립 도구 공통).
9. **캠페인 시작/종료 마커**: 주가 페이징 없이 쌓이므로, 캠페인 시작일 셀과 종료일 셀에 작은 시작/종료 표식(예: 상단에 짙은 색 캡 라인 또는 깃발 아이콘)을 주고, 캠페인 기간에 포함된 모든 날짜 셀에는 카드가 없어도 아주 옅은 배경 틴트를 깔아 "이 구간이 캠페인 기간"임을 알린다. **[패턴]** (범위 선택 캘린더의 시작/끝 캡 + 중간 옅은 워시 관례, Sprinklr/Atida의 기간 밴드 오버레이).
10. **범위 밖 날짜(캠페인 시작 전/종료 후, 주의 앞뒤 여백일)**: 텍스트를 흐리게(연회색) 하고 카드/드래그 드롭을 비활성화한다. **[패턴]** (Notion/Google Calendar/Ant Design 공통 관례이며, 다른 달 padding-day를 흐리게 하는 것이 "전문적으로 보이는 이유의 90%"라는 진단도 있음).

**대안 방향(근거가 갈리는 경우)**

- **대안 1 — 저비용 보수(권장 1차 적용)**: 위 1~10을 적용하되 카드 크기·정보량은 지금과 동일하게 유지. 셀 높이는 카드 2~3개 기준으로 고정하고 넘치면 "+N개." 리스크가 적고 지금 컴포넌트 구조를 크게 바꾸지 않는다.
- **대안 2 — 진짜 월간 그리드(2차/스트레치)**: Google Calendar/Ant Design 스타일로 셀을 더 작게(예: 90~120px 행), 카드는 1줄 요약(제목 일부+단계 도트)만 보이게 압축하고, 날짜를 클릭하면 사이드/하단에 그날의 카드 전체(제목 2줄+핸들+단계칩)를 펼쳐 보여준다(Airtable의 확장 뷰, thefrontkit의 Day Detail Sheet 패턴). "달력처럼 보임"은 최대화되지만, 카드 세부정보를 보려면 한 번 더 클릭해야 하고 리팩터링 범위도 크다.

두 대안 모두 §3의 1~10 규칙(요일 헤더 단일화, 격자선, 동일 행 높이, 오늘=숫자 배지, 미정 트레이 분리, 시작/종료 마커)은 공유한다 — 차이는 카드 자체를 얼마나 압축하느냐뿐이다.

## 4. 출처 목록

1. https://www.androidpolice.com/google-calendar-redesign-enable/
2. https://chromium.googlesource.com/chromium/src/+/68d0813078c692ace1988ed91051839b12697079/ash/system/time/calendar_month_view.cc
3. https://android.googlesource.com/platform/packages/apps/Calendar/+/69ab334/src/com/android/calendar/MonthView.java
4. https://ant.design/components/calendar/
5. https://github.com/ant-design/ant-design/blob/master/components/calendar/index.en-US.md
6. https://carbondesignsystem.com/components/date-picker/usage/
7. https://carbondesignsystem.com/components/date-picker/style/
8. https://blakecrosley.com/guides/design/notion-calendar
9. https://dev.to/dev48v/a-notion-style-calendar-is-just-one-css-grid-3ddi
10. https://uxpatternsguide.com/compare/kanban-board-vs-table-vs-calendar-view-vs-list-view/
11. https://www.sap.com/design-system/fiori-design-web/v1-108/ui-elements/single-planning-calendar/usage
12. https://bryntum.com/products/calendar/docs-llm/api/Calendar/widget/MonthView.md
13. https://viraly.io/docs/calendar-views-toggle
14. https://www.notion.com/help/calendars
15. https://support.airtable.com/docs/en/getting-started-with-airtable-calendar-views
16. https://medium.com/@aofstad/making-and-breaking-the-grid-ee0741f86dc
17. https://help.asana.com/s/article/timeline
18. https://help.planable.io/hc/en-us/articles/21715383136924-Calendar-view
19. https://help.planable.io/en/articles/9076171-how-can-i-find-my-draft-posts
20. https://automagical.work/calendar-plus/posts/how-to-change-color-of-calendar-items-on-monday.com
21. https://thefrontkit.com/docs/social-media-dashboard-kit/calendar
22. https://owlstack.app/features/calendar
23. https://www.teamup.com/learn/product-tips/choose-the-best-calendar-view/
24. https://www.sprinklr.com/help/articles/content-creation/campaigns-in-the-editorial-calendar/63f5dfd8e02459133724aa18
25. https://atida.mintlify.app/docs/editor/calendar
26. https://github.com/BatthewZ/response-ui-react-components/blob/main/docs/components/range-calendar.md
27. https://tailgrids.com/docs/components/range-calendar
28. https://reactspectrum.blob.core.windows.net/reactspectrum/bd373679b49e80342a8ff8ad917532496d811230/docs/react-aria/RangeCalendar.html
29. https://justfigma.com/designing-date-pickers-and-calendar-ui-in-figma/
30. https://uxpatterns.dev/patterns/data-display/calendar
31. https://composedesign.ila.cegid.com/blog/time-was-never-the-point-the-truth-about-task-board-ux/
32. https://support.atlassian.com/trello/docs/using-the-calendar-power-up/
33. https://community.atlassian.com/forums/Trello-questions/Did-you-changed-the-look-of-the-kalender-power-up/qaq-p/3142692
