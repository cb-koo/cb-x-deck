// 지점 순수 부분 — 서버 전용 모듈(clinicStore → node:crypto)을 끌어오지 않아 클라이언트 컴포넌트에서도 쓴다.
export type ClinicSummary = { id: string; clientId: string; name: string; configured: boolean;
  branchName: string; kind: 'main' | 'branch'; position: number; active: boolean;
  clientActive: boolean };   // 클라이언트 활성 여부(087, ISSUE-013) — 확장 프로그램이 이 값으로 비활성 클라이언트를 걸러 보여 준다(태정님 11-06). 지점의 active와 다르다

// 대표 지점 = 사용 중인 지점 가운데 순서가 가장 앞. 순서가 같으면 목록에서 앞선 것.
export function representativeLocation<T extends Pick<ClinicSummary, 'active' | 'position'>>(list: T[]): T | null {
  let best: T | null = null;
  for (const l of list) if (l.active && (!best || l.position < best.position)) best = l;
  return best;
}
// 지점이 하나뿐이라 지점명이 비면 '본점'으로 읽는다.
export function locationLabel(l: Pick<ClinicSummary, 'name' | 'branchName'>) { return `${l.name} · ${l.branchName || '본점'}`; }
