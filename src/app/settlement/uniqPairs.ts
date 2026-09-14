// [id, label] 쌍을 id 기준으로 중복 제거하며 처음 값을 유지한다(필터 셀렉트 옵션 만들 때 사용)
export function uniqPairs<T extends readonly [string, string]>(pairs: T[]): T[] {
  const m = new Map<string, T>(); for (const p of pairs) if (!m.has(p[0])) m.set(p[0], p); return [...m.values()];
}
