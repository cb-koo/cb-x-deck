# 해시태그 패널 줄 수 제한 + 더보기

작성일: 2026-07-21

## 배경

search 컬럼 상단 `CooccurrencePanel`(src/components/CooccurrencePanel.tsx)은 컬럼과 함께 나온 해시태그를 pill로 보여준다(상위 12개, 클라이언트 계산). 태그가 많으면 `flex flex-wrap`으로 여러 줄이 되어 컬럼 상단을 과하게 가린다.

## 목표

기본적으로 상위 일부만(약 2줄 분량) 보여주고, 나머지는 `더보기 (+N)`로 펼치고 `접기`로 다시 접는다.

비목표: 태그 계산 로직/번역/클릭(새 컬럼 생성) 동작 변경, config 영속화.

## 대상 사용자

비개발 콘텐츠 기획 담당자. AGENTS.md UX 원칙 — 라벨은 사람말(`더보기`/`접기`), `+N`으로 몇 개가 숨겨졌는지 명시.

## 설계

변경은 `CooccurrencePanel.tsx` **한 파일에 한정**.

- 접힘 기준: 가변폭 pill이라 정확한 줄 수는 JS 측정이 필요하므로 개수 임계값으로 근사. `COLLAPSED = 6`(≈2줄).
- 상태: `const [expanded, setExpanded] = useState(false)` — **비영속**(TweetExpansion의 `restOpen`과 동일 관행). 새로고침·재마운트 시 다시 접힘.
- 표시: `const visible = expanded ? tags : tags.slice(0, COLLAPSED)`. pill 목록은 `visible.map(...)`으로 렌더.
- 토글: `tags.length > COLLAPSED`일 때만 pill 목록 아래에 텍스트 버튼 렌더.
  - 접힘: `더보기 (+{tags.length - COLLAPSED})`
  - 펼침: `접기`
  - 스타일: 앱 관행의 파란 텍스트 버튼(`text-caption text-x-blue`), TweetExpansion 토글과 일관.
- 엣지: 태그 0개면 기존대로 패널 미표시(`if (tags.length === 0) return null`). 태그 ≤ COLLAPSED면 토글 버튼 미표시(전부 보임). 태그 상한은 기존 12개 그대로 → 펼침 최대 12개, `+N` 최대 +6.

## 검증

컴포넌트 단위 테스트 인프라 없음 → `npm run lint` + `npm run build` + 라이브 수동 확인:
- 태그 7개 이상인 search 컬럼에서 기본 6개 + `더보기 (+N)` 표시.
- `더보기` 클릭 시 전체 표시 + `접기`로 전환, `접기` 클릭 시 다시 6개.
- 태그 6개 이하 컬럼에서는 토글 버튼이 없다.
- pill 클릭(새 컬럼 생성)·번역 라벨은 기존과 동일 동작.

## 파급 파일

- `src/components/CooccurrencePanel.tsx` — `expanded` 상태, `visible` slice, 토글 버튼.
