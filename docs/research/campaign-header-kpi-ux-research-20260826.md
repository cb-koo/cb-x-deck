# 캠페인 상세 화면 UX 리서치 — 헤더 메타데이터 · KPI 카드 · 표 컬럼 설계

조사일: 2026-08-26 · 대상: 캠페인 관리 상세 화면(비개발 기획자 2~5인 대상 내부 툴)

## 1. 요약

- 헤더의 기간/종류/코드를 "항상 켜진 폼 입력"으로 두는 방식은 조사한 모든 디자인 시스템(Atlassian, Ant Design, Carbon, Polaris)과 실제 제품(Notion, Linear, Airtable, Jira, HubSpot)에서 예외 없이 피하는 패턴이다. 공통 해법은 "읽기 모드는 라벨-값 정의형 리스트, 편집은 클릭 시에만 입력으로 전환"(Atlassian Inline Edit, Ant Design Descriptions)이다.
- 메모/설명은 별도 라벨이 붙은 블록으로 분리하는 것이 표준이다(Jira의 Description/Context 필드 분리, Ant Descriptions의 Remark 항목, HubSpot의 About 카드).
- KPI 카드의 부가 텍스트는 "맥락(비교·목표·추세)"만 남기고, 방법론적 단서(통화 안 합침 등)는 툴팁/정보 아이콘으로 옮기라는 것이 다수 소스의 공통 제안이다. 0건 상태 문구는 최대한 짧게.
- 표의 셀 서브라인(콘텐츠 유형·단발/스레드)은 정렬·필터·스캔 대상이 될 경우 독립 컬럼으로 승격해야 한다는 것이 NN/g, Polaris IndexTable의 일관된 결론이다.
- 실행 의미가 없는 "✕" 아이콘은 그 자체로 반패턴이다(호버 전용 액션은 키보드/터치 접근성 결함이라는 지적이 다수). Atlassian Inline Edit의 취소(x) 아이콘은 "편집 중 상태를 취소"할 때만 등장하며, 항상 떠 있는 독립 액션이 아니다.
- 아래 각 항목에 근거 수준([인용]/[패턴]/[추측])을 표기했다.

## 2. Q1 — 레코드/상세 페이지 헤더 메타데이터 표시 패턴

**핵심 결론: 읽기 모드=정의형 리스트(label-value), 편집은 클릭 시 전환. 항상 보이는 입력 위젯을 헤더에 늘어놓지 않는다.**

- **Atlassian Inline Edit** — "읽기 뷰(readView)로 시작하고, 클릭해야 편집 뷰(editView)로 전환된다"는 것이 기본값이며, 접근성 가이드에서 "폼이 아닌, 폼에 속하지 않는 편집 가능 필드에 인라인 편집을 사용하라. 폼 안에서는 쓰지 말라"고 명시한다. 또 "커스텀 폰트 크기를 쓰더라도 사람들이 편집 가능하다고 인식할 만큼 충분한 시각적 어포던스를 주라"고 강조한다. [인용] https://atlassian.design/components/inline-edit/usage , https://developer.atlassian.com/platform/forge/ui-kit/components/inline-edit/
- **Ant Design Descriptions** — "여러 읽기 전용 필드를 그룹으로 표시"하는 전용 컴포넌트로, `label`+`children`(값) 쌍을 나열하며 Remark(비고)도 동일한 리스트의 한 항목으로 들어간다. Form 컴포넌트와 명확히 분리된 개념이다. [인용] https://ant.design/components/descriptions/
- **Carbon Structured list / Forms 패턴** — Structured list는 "읽기 전용 값을 그룹으로 조직해 스캔 가능한 패턴으로 보여준다"고 정의한다. 흥미롭게도 Carbon 공식 Forms 패턴 문서는 "인라인 편집에 대한 통합된 가이드가 아직 없다"고 자인한다 — 즉 업계에서도 아직 완전히 표준화되지 않았지만, 구조적으로 "표 형태의 읽기 값 목록"이라는 지향점은 뚜렷하다. [인용] https://carbondesignsystem.com/components/structured-list/usage/ , https://carbon-website-git-fork-theiliad-add-horizontal-bar-charts.carbon-design-system.vercel.app/patterns/forms-pattern
- **Polaris Description list** — "용어와 설명을 나열"하는 용도로, "실행 지향적이지 않은 정보"에 사용하라고 규정한다. 캠페인 헤더의 기간/종류/코드처럼 '설명적 속성'에 정확히 맞는 용도다. [인용] https://polaris.shopify.com/components/description-list
- **Notion 페이지 속성(Properties)** — 데이터 소스에 속한 페이지는 속성이 컬럼 스키마로 정의되고, 페이지를 열면 라벨-값 형태로 표시된다. 값 편집은 각 속성 타입(select, date 등)에 맞는 미니 위젯이 그 자리에서 뜨는 방식이라 "폼처럼 보이는 상시 입력"이 아니라 "필요할 때만 나타나는 편집기"다. [인용] https://developers.notion.com/reference/page-property-values
- **Linear 이슈 속성** — "제목/설명은 직접 클릭해 인라인으로 편집"하며, Cycle·Priority 등 속성은 아이콘+라벨의 칩(chip) 형태로 사이드바에 나열되고 클릭 시 드롭다운이 뜬다. 상시 노출되는 select 엘리먼트가 아니다. [인용] https://linear.app/docs/editing-issues
- **Airtable 레코드 상세** — 편집 모드를 Off/Inline/Form 3단계로 명시적으로 구분한다. Inline 모드에서도 "필드에 클릭해 들어가야" 값이 바뀌며, 호버 시 "…" 아이콘이 나타나 개별 필드 편집/삭제를 하게 한다. 2022년 업데이트 로그에는 "필드가 편집 가능함을 명확히 보여주도록 개선했다"는 문구가 있어, 상시 입력창이 아니라 '이건 편집 가능하다'는 시각적 신호(호버 배경 등)를 따로 설계했음을 알 수 있다. [인용] https://support.airtable.com/docs/editing-airtable-records-on-record-detail-pages , https://community.airtable.com/announcements-6/improvements-to-expand-and-edit-records-1436
- **Jira 이슈 필드 레이아웃** — 필드를 "Description fields"(좌측, 핵심)와 "Context fields"(우측, 보조 — Details/More fields로 재분류)로 명확히 나눈다. 값이 없는 필드는 자동으로 "More fields"(접힘)로 숨겨진다. [인용] https://confluence.atlassian.com/jirasoftwarecloud/configure-field-layout-in-the-work-item-961798059.html
- **HubSpot 레코드 사이드바** — 좌측 "Key information / About" 카드가 속성을 라벨-값으로 나열하며, 사용자가 카드별로 속성을 커스터마이즈한다. 즉 메타데이터는 본문 제목과 분리된 전용 카드에 산다. [인용] https://knowledge.hubspot.com/records/understand-the-default-record-layout
- **Asana 프로젝트 개요** — 반대 사례로 유용하다: 커스텀 필드가 "Edit project details" 메뉴 뒤에 숨어 있어 사용자들이 지속적으로 "Overview 탭에 Project Details 섹션을 따로 만들어달라"고 요청 중이다. 이는 "메타데이터를 숨기지도 말고, 폼처럼 노출하지도 말고, 라벨이 붙은 전용 블록으로 상시 노출"해야 한다는 결론을 반증적으로 지지한다. [인용] https://forum.asana.com/t/make-the-custom-fields-thats-added-on-portfolio-level-visible-on-te-project-overview-tab/313840

**패턴 종합 [패턴]**: (1) 읽기 모드는 정의형 리스트, (2) 편집은 클릭 유발형 전환, (3) 메모/설명은 반드시 라벨이 붙은 별도 블록, (4) "폼처럼 보이는 상시 입력 UI"를 읽기용 헤더에 두는 사례는 조사된 어떤 시스템에도 없음.

## 3. Q2 — KPI/통계 카드의 보조 텍스트

- **KPI 카드 해부(Kuznetsova)** — 카드 필수 요소는 기간·지표명·값·"맥락"(비교/목표)·스파크라인이며, "지표에 대한 설명은 툴팁에 넣는 걸 고려하라"고 명시한다. 즉 정의/방법론 설명은 카드 본문이 아니라 툴팁이 정석 위치다. [인용] https://nastengraph.substack.com/p/anatomy-of-the-kpi-card
- **Power BI KPI 카드 모범 사례(Tabular Editor)** — "숫자만 보여주면 독자가 추측해야 한다. 목표·추세·기준선이 있어야 실행 가능한 지표가 된다"고 하며, "라벨과 제목은 짧게 유지하라. 지표에 그렇게 많은 수식어가 필요하다면, 애초에 정의 자체가 불명확한 것"이라고 지적한다. 이는 "통화별로 따로 계산—원과 엔은 합치지 않아요" 같은 방법론적 각주가 카드 본문에 상시 노출될 이유가 약하다는 근거다. [인용] https://tabulareditor.com/blog/kpi-card-best-practices-dashboard-design
- **Appian SAIL KPI 컴포넌트** — primaryText(지표명)는 값 위, secondaryText는 "비교/추세를 라벨링"하는 용도로만 존재한다. 즉 보조 텍스트의 정해진 역할은 '비교값 설명'이며, 방법론 캐비어트는 이 자리에 들어갈 요소가 아니다. [인용] https://docs.appian.com/suite/help/26.7/sail/ux-kpi.html
- **Carbon Empty states 패턴** — "말은 최소한으로 유지해 빠르게 읽고 행동할 수 있게 하라", "데이터가 없을 때 무엇을 할 수 있는지 구체적으로 알려주라"고 규정한다. "밀린 콘텐츠가 없어요" 자체는 이 원칙에 부합하는 짧은 문구지만, 문제는 이런 문구가 카드마다 매번 다른 서술형으로 나열되며 쌓이는 것 — 원칙은 "짧게" + "일관된 형식"이지 "설명 없음"이 아니다. [인용] https://carbondesignsystem.com/patterns/empty-states-pattern/
- **PatternFly Dashboard 가이드라인** — "각 카드는 하나의 지표 또는 밀접하게 연관된 지표 그룹만 전달하도록 설계하라"고 규정, 카드 안에 서로 다른 성격의 정보(달성 카운트 + 방법론 각주 + 상태 요약)를 섞지 말라는 근거로 원용 가능. [인용] https://www.patternfly.org/patterns/dashboard/design-guidelines/
- **대시보드 설계 참고자료(비공식, 커뮤니티 스킬 문서)** — "단위 없는 숫자를 보여주지 말라", "추세 표시에는 반드시 '무엇과 비교한 것인지' 맥락이 붙어야 한다" 등 KPI 카드 규칙을 정리하고 있으나 공식 디자인 시스템은 아니므로 참고용으로만 인용. [추측, 참고용] https://github.com/adityaraj0421/naksha-studio/blob/main/skills/design/references/dashboard-architect.md

**함의 [패턴]**: (1) 보조 텍스트는 "비교/맥락 한 줄"로 역할을 한정, (2) 방법론 캐비어트(통화 분리 등)는 정보 아이콘/툴팁으로 이동, (3) 0건 상태 문구는 형식을 통일하고 길이를 줄이되 완전히 없애지는 않는다, (4) 카드 하나에 서로 다른 종류의 설명을 쌓지 않는다(밀림 여부/통화 규칙/게시·좋아요·클릭 요약을 한 카드에 나열하면 PatternFly의 "단일 지표 원칙"에 위배).

## 4. Q3 — 데이터 테이블 컬럼 설계: 전용 컬럼 vs 셀 내 서브라인

- **NN/g Data Tables** — "기본 컬럼 순서는 사용자에게 중요한 정도를 반영해야 하고, 관련 컬럼은 서로 인접해야 한다"고 명시. 사용자가 자주 참조/필터링해야 하는 속성이라면 그 자체로 컬럼이 되어야 한다는 근거. 또한 "필터는 발견 가능하고 빠르고 강력해야 한다"고 언급 — 콘텐츠 유형·단발/스레드가 필터링 대상이 될 잠재력이 있다면 컬럼화가 정당화된다. [인용] https://www.nngroup.com/articles/data-tables/
- **Polaris IndexTable 실제 구현 예시** — 상태(Active/Draft), 재고, 유형(Type), 벤더(Vendor)를 각각 독립 `IndexTable.Cell`/컬럼으로 두고 있다. 즉 카테고리성 속성(유형)은 관례적으로 제목 셀의 서브텍스트가 아니라 형제 컬럼으로 분리한다. [인용] https://polaris.shopify.com/patterns/resource-index-layout
- **Carbon Data table 해부** — 컬럼 헤더는 "1~2단어의 짧고 명확한 제목"을 권장하며, 행 높이는 테이블 전체에서 통일되어야 한다(2줄 콘텐츠가 예상될 때만 확장 행 높이 사용 허용). 이는 "제목 셀에 13px 보조행을 얹어 셀마다 높이가 들쭉날쭉해지는 것"과 반대되는 원칙이다. [인용] https://carbondesignsystem.com/components/data-table/usage/
- **Primer(GitHub) ActionList.Description** — "inline은 주 텍스트 옆에, block은 아래에 배치"하는 서브라인 컴포넌트가 명시적으로 존재하지만, 이는 리스트 아이템의 "보조 식별 정보"(예: 부제)용으로 설계된 것이며, 정렬·필터 대상 속성용은 아니다. 즉 서브라인은 "식별을 돕는 부가정보"에 적합하고, "독립적으로 스캔·정렬·필터링돼야 하는 속성"에는 부적합하다는 경계선을 보여준다. [패턴] https://primer-docs-preview.github.com/product/components/action-list/
- **UXmatters "Designing Tables 101"** — "행을 스캔해 비교하고, 열을 스캔해 집계한다"는 원론적 규칙: 콘텐츠 유형별로 몇 건인지 세거나 스레드만 걸러보는 식의 열 단위 스캔이 필요하다면 그 속성은 열이어야 한다. [인용] https://www.uxmatters.com/mt/archives/2009/09/designing-tables-101.php

**행 내 액션(✕ 버튼)에 대한 근거**:

- **UX StackExchange 분석** — 호버 시에만 노출할지 여부는 "그 액션이 반복적 상태 표시인가, 아니면 목록 전체에 공통적으로 적용 가능한 부차적 액션인가"로 갈린다. 삭제류의 부차적 액션은 호버 전용이 합리적이라고 결론짓지만, 전제는 "그 액션이 실제로 무언가를 한다"는 것이다. [인용] https://ux.stackexchange.com/questions/49894/
- **Setproduct 데이터 테이블 가이드(2026)** — "호버 전용 액션은 키보드/터치 사용자에게 보이지 않는다. 이는 공간을 아끼는 꾀가 아니라 접근성 결함이다"라고 명확히 반패턴으로 규정한다. [인용] https://www.setproduct.com/blog/data-table-ui-design
- **Atlassian Dynamic table** — 행 강조(`isHighlighted`)는 "선택을 나타내는 용도가 아니라 주의를 끄는 용도"로만 쓰라고 규정하듯, Atlassian 계열 컴포넌트들은 "의미가 분명한 액션만 노출"을 일관되게 강조한다. [인용] https://developer.atlassian.com/platform/forge/ui-kit/components/dynamic-table/

**함의 [패턴]**: (1) 콘텐츠 유형·단발/스레드처럼 향후 필터/정렬 대상이 될 수 있는 속성은 독립 컬럼으로 승격, (2) 날짜 셀의 ✕는 "실행 결과가 불분명한 상시 아이콘"이라는 점에서 그 자체가 안티패턴 — 제거하거나 실제 동작(값 지우기)이 분명한 편집 흐름 안으로 통합해야 한다.

## 5. Q4 — 인라인 편집 어포던스

- **Atlassian Inline Edit** — 컴포넌트 자체가 "읽기 뷰↔편집 뷰를 오가는 커스텀 입력의 래퍼"로 정의되며, `onEdit`(읽기 뷰 클릭 시 발동), `onConfirm`(값 저장 후 읽기 뷰로 복귀), `onCancel`(x 아이콘 클릭 시 편집 취소) 세 개의 훅으로 커밋/취소 시맨틱을 명확히 규정한다. 큰 텍스트 영역엔 `keepEditViewOpenOnBlur`를 켜서 블러 시 실수로 편집을 잃지 않게 하라고 권고한다. [인용] https://developer.atlassian.com/platform/forge/ui-kit/components/inline-edit/
- **Airtable Inline 모드** — 호버 시 "…" 아이콘으로 개별 필드 편집/삭제 진입점을 드러내고, 필드 자체를 클릭하면 그 자리에서 값이 바뀐다. "편집 가능함을 명확히 보여주는" 시각적 개선(호버 배경 등)을 제품 업데이트로 명시했다. [인용] https://community.airtable.com/announcements-6/improvements-to-expand-and-edit-records-1436
- **Linear** — 제목/설명은 클릭 즉시 인라인 편집으로 전환되고, 나머지 속성(사이클·우선순위 등)은 아이콘+텍스트 칩으로 표시되다가 클릭 시에만 드롭다운이 뜬다 — "항상 열려 있는 select"가 아니다. [인용] https://linear.app/docs/editing-issues

**함의 [인용]**: 읽기 상태에서 편집 가능함을 알리는 신호는 (a) 호버 시 배경/밑줄 변화, (b) 클릭 시에만 나타나는 입력 위젯, (c) 취소(x)/저장 커밋을 명확히 구분하는 것 세 가지로 수렴한다. "폼처럼 보이는" 상시 `<input>`/`<select>`는 그 자체로 이 패턴에서 벗어난다.

## 6. 현 화면에 대한 함의

### (1) 헤더의 기간/종류/코드가 상시 폼 입력으로 노출됨

- **옵션 A — 정의형 리스트 + 클릭 편집(권장)**: Ant Design Descriptions처럼 라벨-값 쌍으로 읽기 모드를 렌더링하고, 각 값을 Atlassian Inline Edit 패턴(클릭 시에만 입력 전환, 저장/취소 명확화)으로 편집 가능하게 한다. 코드는 값+복사 아이콘 조합(현재 방식과 유사하되, 텍스트박스처럼 보이는 테두리는 제거)으로 유지. 근거: [인용] Atlassian, Ant Design, Airtable, Linear 다수 소스가 동일 결론.
- **옵션 B — 별도 "속성" 패널로 분리**: Jira의 Description/Context 필드 분리, HubSpot의 About 카드처럼 제목·상태와 메타데이터(기간/종류/코드)를 시각적으로 다른 블록에 둔다. 더 큰 리디자인이 필요하지만 위계가 가장 뚜렷해진다. 근거: [인용] Jira, HubSpot.
- **옵션 C — 최소 변경**: 지금의 필드 배치는 유지하되 입력 크롬(테두리·배경·placeholder)만 제거하고 텍스트로 표시, hover 시에만 편집 아이콘 노출. 리소스가 제한적일 때 임시 개선안.
- **비고(메모)**는 세 옵션 모두에서 "메모" 라벨 + 구분되는 배경/여백을 가진 전용 블록으로 승격 — Ant Descriptions의 Remark 항목, Jira의 Description 필드처럼 다뤄야 한다. 근거 수준: [인용].
- **추천**: 옵션 A. 근거가 가장 두텁고(4개 이상의 1차 소스 직접 인용), 현재 컴포넌트 구조에서 "표시=Descriptions, 편집=Inline Edit"으로 치환하는 정도의 리팩터라 구현 비용도 상대적으로 낮다.

### (2) KPI 카드 보조 설명이 조잡함

- **옵션 A — 캐비어트를 툴팁/정보 아이콘으로 이동(권장)**: "통화별로 따로 계산" 같은 방법론 문장은 값 옆 (i) 아이콘 안으로 옮긴다. 근거: [패턴] Kuznetsova, Tabular Editor 가이드 공통.
- **옵션 B — 보조 텍스트를 "판단이 담긴 한 줄"로 통일**: 현재 원칙(§7)의 "숫자만 던지지 말고 판단까지 서술"과 정합하게, 남기는 한 줄은 항상 형식이 같은 비교/맥락 문장이어야 한다(값+지난 기간 대비, 또는 값+기준 대비 상태어). 근거: [패턴] Appian SAIL, PatternFly.
- **옵션 C — 0건/미존재 상태는 짧은 상태어로 축약**: "밀린 콘텐츠가 없어요" 류의 완결문을 유지할지, "밀림 없음"처럼 축약할지는 Carbon의 "말은 최소한으로" 원칙에 따라 문구 길이를 줄이는 쪽을 권장하되, 완전 제거(빈칸)는 지양. 근거: [인용] Carbon empty states.
- **추천**: A+B 동시 적용, C는 문구 리라이팅 수준의 후속 작업. 근거 수준 [패턴](복수 소스 정성적 일치, 공식 디자인 시스템의 KPI 카드 스펙 자체가 희소해 완전한 [인용]은 아님).

### (3) 표의 ✕ 클리어 버튼과 13px 서브라인

- **옵션 A — 콘텐츠 유형·단발/스레드를 독립 컬럼으로 승격(권장)**: NN/g "관련 컬럼은 인접, 중요도에 따라 배치"와 Polaris IndexTable의 실제 관례(유형을 별도 셀로) 그대로 적용. 근거: [패턴] 다수 소스.
- **옵션 B — ✕ 버튼 제거, 날짜 셀 자체를 Inline Edit화**: 클릭하면 편집 뷰(날짜 피커)로 바뀌고, 그 안에 "지우기"를 확실한 액션으로 포함(Atlassian Inline Edit의 onCancel/onConfirm 구조 재사용). 근거: [인용] Atlassian Inline Edit, [인용] Setproduct(호버 전용 액션은 접근성 결함).
- **옵션 C — 액션을 유지해야 한다면 호버가 아니라 항상 보이되 텍스트 라벨을 붙임**: 터치 기기 대응이 필요하면 호버 의존은 피하라는 지적(Setproduct, UX StackExchange)에 따라, 아이콘 단독 대신 라벨이 있는 명확한 버튼으로 대체.
- **추천**: A(서브라인→컬럼)는 근거가 매우 강하므로 즉시 반영. B(✕ 제거/재설계)도 "실행 의미 불명확한 상시 아이콘"이라는 지적 자체가 이미 접근성/사용성 상 반패턴이라는 다수 소스의 결론과 일치하므로 함께 권장. 근거 수준: [패턴]~[인용] 혼합.

## 7. 출처 목록

1. Atlassian — Inline edit (Usage) https://atlassian.design/components/inline-edit/usage
2. Atlassian Forge — Inline edit https://developer.atlassian.com/platform/forge/ui-kit/components/inline-edit/
3. Ant Design — Descriptions https://ant.design/components/descriptions/
4. Carbon Design System — Structured list (Usage) https://carbondesignsystem.com/components/structured-list/usage/
5. Carbon — Forms pattern (inline editing 인정 문구) https://carbon-website-git-fork-theiliad-add-horizontal-bar-charts.carbon-design-system.vercel.app/patterns/forms-pattern
6. Shopify Polaris — Description list https://polaris.shopify.com/components/description-list
7. Notion Developers — Page property values https://developers.notion.com/reference/page-property-values
8. Linear Docs — Edit issues https://linear.app/docs/editing-issues
9. Airtable Support — Editing records on record detail pages https://support.airtable.com/docs/editing-airtable-records-on-record-detail-pages
10. Airtable Community — Improvements to expand and edit records https://community.airtable.com/announcements-6/improvements-to-expand-and-edit-records-1436
11. Atlassian Confluence — Configure field layout in the work item (Jira) https://confluence.atlassian.com/jirasoftwarecloud/configure-field-layout-in-the-work-item-961798059.html
12. HubSpot Knowledge Base — Use the updated record default layout https://knowledge.hubspot.com/records/understand-the-default-record-layout
13. Asana Forum — Make custom fields visible on the project overview tab https://forum.asana.com/t/make-the-custom-fields-thats-added-on-portfolio-level-visible-on-te-project-overview-tab/313840
14. Anastasiya Kuznetsova — Anatomy of the KPI Card https://nastengraph.substack.com/p/anatomy-of-the-kpi-card
15. Tabular Editor Blog — KPI card best practices for Power BI https://tabulareditor.com/blog/kpi-card-best-practices-dashboard-design
16. Appian SAIL Design System — KPIs https://docs.appian.com/suite/help/26.7/sail/ux-kpi.html
17. Carbon Design System — Empty states pattern https://carbondesignsystem.com/patterns/empty-states-pattern/
18. PatternFly — Dashboard design guidelines https://www.patternfly.org/patterns/dashboard/design-guidelines/
19. NN/g — Data Tables: Four Major User Tasks https://www.nngroup.com/articles/data-tables/
20. NN/g — Comparison Tables for Products, Services, and Features https://www.nngroup.com/articles/comparison-tables/
21. Shopify Polaris — Resource index layout (IndexTable 실사용 예) https://polaris.shopify.com/patterns/resource-index-layout
22. Carbon Design System — Data table (Usage) https://carbondesignsystem.com/components/data-table/usage/
23. GitHub Primer — ActionList (inline/block Description) https://primer-docs-preview.github.com/product/components/action-list/
24. UXmatters — Designing Tables 101 https://www.uxmatters.com/mt/archives/2009/09/designing-tables-101.php
25. UX StackExchange — Should list item actions be hidden on hover or always shown? https://ux.stackexchange.com/questions/49894/
26. Setproduct Blog — Data table UI design reference guide (2026) https://www.setproduct.com/blog/data-table-ui-design
27. Atlassian Forge — Dynamic table https://developer.atlassian.com/platform/forge/ui-kit/components/dynamic-table/
28. (참고용, 비공식) dashboard-architect.md — KPI card anatomy 참고자료 https://github.com/adityaraj0421/naksha-studio/blob/main/skills/design/references/dashboard-architect.md
