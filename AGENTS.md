<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# UX/UI 원칙 (모든 사용자 대면 기능에 적용)

이 도구의 사용자는 **비개발 콘텐츠 기획 담당자**다. UI를 만들거나 고칠 때 아래를 지킨다. (근거 사례: '밀도 확인' 버튼이 내부 개념만 노출해 무슨 기능인지 알 수 없던 문제 → 아래 원칙으로 수정함)

1. **라벨은 메커니즘이 아니라 이득을 사용자 언어로 말한다.** 내부 개념어(밀도·density·probe 등)를 버튼/라벨에 그대로 쓰지 않는다. 예: `밀도 확인` → `적정 기준 추천받기`.
2. **행동 전 기대를 설정한다.** 버튼·입력 옆에 "무엇을 하면 무엇이 나오는지" 한 줄 도움말을 둔다(progressive disclosure — 필요한 자리에서만, 상단에 몰아넣지 않는다).
3. **결과는 숫자만 던지지 말고 판단까지 서술한다.** "좋아요 53~346" 대신 "반응이 드문 편이에요(53~346) → min_faves 100 추천 [적용]"처럼 해석·다음 행동을 붙인다.
4. **라벨과 값은 항상 일치시킨다.** '활발한데 100 추천' 같은 모순이 나오면 표시가 아니라 로직을 고친다(파생값으로 통일).
5. **전문/기술 값 노출은 최소화하되, 없애기 어려우면 맥락으로 감싼다.** (min_faves 같은 X 연산자명은 유지하되 옆에 뜻을 설명)
6. **비용 유발 액션(API 콜)은 opt-in 버튼으로 두되(1~5 준수), 반복 마찰이 실사용 피드백으로 확인되면 자동화로 승격을 검토한다.**

새 UI 작업 시 이 원칙을 체크리스트로 훑고, 위반이 있으면 구현 전에 고친다.
