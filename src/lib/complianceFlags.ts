// 薬機法(일본 의약품·화장품 광고 규제) 리스크 용어 힌트. 법률 자문이 아니라 담당자 확인용 표식이며,
// 매칭돼도 차단·필터링하지 않는다(카드에 ⚠️ 배지만). 오탐 위험 높은 체험담 단정형은 v1 제외.
const RISK_TERMS = [
  '効果がある', '効く', '治る', '治療', '完治', '医薬品', '副作用',
  'シミが消える', 'シワがなくなる', '美白効果', '痩せる',
];

export function flagYakkiho(text: string): string[] {
  if (!text) return [];
  return RISK_TERMS.filter((term) => text.includes(term));
}
