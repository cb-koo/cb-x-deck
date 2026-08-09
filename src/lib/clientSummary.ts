import type { ClientRow, ProcedureRow } from './clientStore';

// 좌측 목록 요약 — 금지 표현 수는 공통(클라이언트) + 시술별 합산.
// 원고 생성 시 실제 검수에 쓰이는 전체 개수와 일치시키기 위함 (generate/page.tsx의 병합 로직과 같은 기준).
export function clientSummary(client: ClientRow, procedures: ProcedureRow[]):
  { procedureCount: number; bannedTotal: number; infoMissing: boolean } {
  return {
    procedureCount: procedures.length,
    bannedTotal: client.bannedPhrases.length + procedures.reduce((n, p) => n + p.bannedPhrases.length, 0),
    infoMissing: client.info.trim() === '',
  };
}

// 시술 카드 접힘 상태의 요약 줄 — 펼치지 않아도 채움 상태가 보이게 한다.
export function procedureSummary(p: ProcedureRow): { empty: boolean; text: string } {
  const desc = p.description.trim() !== '';
  const effect = p.effectPhrases.trim() !== '';
  const banned = p.bannedPhrases.length;
  if (!desc && !effect && banned === 0) {
    return { empty: true, text: '아직 비어 있어요 — 원고에 반영할 내용이 없어요' };
  }
  const parts: string[] = [];
  if (desc === effect) parts.push(`설명·효과 표현 ${desc ? '입력됨' : '비어 있음'}`);
  else parts.push(`설명 ${desc ? '입력됨' : '비어 있음'}`, `효과 표현 ${effect ? '입력됨' : '비어 있음'}`);
  if (banned > 0) parts.push(`금지 ${banned}건`);
  return { empty: false, text: parts.join(' · ') };
}
