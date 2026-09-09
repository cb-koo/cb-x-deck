// 자동 테스트가 운영 DB에 만드는 결제 요청 픽스처를 그쪽(정산 프로덕트) API에서 감춘다.
//
// 2026-09-09 사고: npm test(실 DB)가 만든 픽스처 요청 11건이 그쪽 5분 폴링에 잡혀 접수·지급 예정까지 처리됐고,
// 테스트 종료와 함께 삭제돼 그쪽 미러에만 남았다(CBX-260909-001~010). 픽스처 핸들은 테스트 파일의 접두어(P)+pid로 시작하므로
// 그 모양을 외부 목록·단건 조회에서 걸러낸다. 테스트 프로세스 안(node --test가 심는 NODE_TEST_CONTEXT)에서는 걸러내지 않는다 —
// 내보내기 테스트가 픽스처를 봐야 하기 때문. 배포된 서버에는 그 env가 없어 항상 걸러진다.
//
// 요청을 만드는 테스트 파일의 접두어만 나열한다(settlementStore.test 'tstl', proof 라우트 테스트 'tstpf', campaignStore.test 'tcmp').
// 새 테스트 파일이 요청을 만들면 여기에 접두어를 추가한다 — settlementTestFixture.test.ts가 실제 P 정의와 대조한다.
export const TEST_FIXTURE_HANDLE_RE = /^(tstl|tstpf|tcmp)\d+_/;
// postgres 정규식(!~)에 그대로 쓰는 문자열 — 위 RE와 같은 뜻이어야 한다
export const TEST_FIXTURE_HANDLE_PG = '^(tstl|tstpf|tcmp)[0-9]+_';

export const isTestFixtureHandle = (handle: string): boolean => TEST_FIXTURE_HANDLE_RE.test(handle);

// 테스트 프로세스 안이면 픽스처를 내보낸다(내보내기 테스트용). 운영·스테이징 서버는 false.
export function exportIncludesTestFixtures(): boolean {
  return !!process.env.NODE_TEST_CONTEXT || process.env.SETTLEMENT_EXPORT_INCLUDE_TEST === 'on';
}
