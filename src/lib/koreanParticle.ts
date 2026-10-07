// 한국어 조사 — 받침에 따라 갈리는 이/가·을/를. 순수 모듈(브라우저·서버 양쪽에서 쓴다).
// '박구건가 올림'(88272c0)·"'지급 완료'을 보냈어요"처럼 조사를 고정하면 화면에 틀린 말이 나간다.

// 마지막 글자가 받침 있는 한글 음절인가. 한글 음절이 아니면(로마자·빈 문자열·기호) 받침 없음으로 본다.
export function hasBatchim(s: string): boolean {
  const code = (s.at(-1) ?? '').charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;   // 나머지 0 = 받침 없음
}

export function subjectParticle(s: string): '이' | '가' { return hasBatchim(s) ? '이' : '가'; }
export function objectParticle(s: string): '을' | '를' { return hasBatchim(s) ? '을' : '를'; }

// 으로/로 — 받침 없음·ㄹ 받침은 '로', 그 밖의 받침은 '으로'. 한글이 아닌 끝글자(숫자·—·$)는 '로'.
export function roParticle(s: string): '으로' | '로' {
  const code = (s.at(-1) ?? '').charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return '로';
  const jong = (code - 0xac00) % 28;
  return jong === 0 || jong === 8 ? '로' : '으로';   // 8 = ㄹ
}
// 문구 + 알맞은 '으로/로' — withRo('6,000엔') → '6,000엔으로'
export function withRo(s: string): string { return `${s}${roParticle(s)}`; }
