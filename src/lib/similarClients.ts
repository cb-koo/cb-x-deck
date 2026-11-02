// 클라이언트 [+ 추가] 중복 방지 — 이름을 쓰는 동안 비슷한 기존 클라이언트를 보여준다.
// 계기: 같은 병원이 '벤자민클리닉'(10-26)·'벤자민피부과'(10-29)로 두 번 만들어져 캠페인이 갈라짐(11-02 정리).
// 업종 꼬리말(클리닉·피부과·의원…)을 떼고 남은 '병원 고유 이름'끼리 비교한다.

// 긴 것부터 — '피부과의원'을 '의원'보다 먼저 떼야 '피부과'가 남지 않는다
const SUFFIXES = [
  '피부과의원', '성형외과의원', '성형외과', '피부과', '한의원', '클리닉', '의원', '치과', '병원', '약국',
  'clinic', 'dermatology',
];

export function clientNameCore(name: string): string {
  let s = name.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  const full = s;
  for (let changed = true; changed;) {
    changed = false;
    for (const suf of SUFFIXES) {
      if (s.length > suf.length && s.endsWith(suf)) { s = s.slice(0, -suf.length); changed = true; break; }
    }
  }
  return s || full;
}

type Named = { name: string; nameEn?: string };

/** 입력한 이름과 고유 이름이 같거나 한쪽이 다른 쪽을 포함하는 클라이언트. 고유 이름 2글자 미만 입력은 비교하지 않는다. */
export function findSimilarClients<T extends Named>(input: string, clients: T[]): T[] {
  const q = clientNameCore(input);
  if (q.length < 2) return [];
  const hit = (other: string) => {
    if (!other.trim()) return false;
    const c = clientNameCore(other);
    if (c.length < 2) return false;
    return c === q || c.includes(q) || q.includes(c);
  };
  return clients.filter((c) => hit(c.name) || hit(c.nameEn ?? ''));
}
