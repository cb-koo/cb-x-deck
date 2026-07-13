// 트윗 본문을 링크 가능한 토큰으로 분해 — X Display Requirements의 엔티티 링크화용.
// 엔티티 메타데이터(t.co→표시 URL)는 저장하지 않으므로 정규식 기반. 스펙 §2 참조.
export type TweetTextToken =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string; handle: string }
  | { type: 'hashtag'; value: string; tag: string }
  | { type: 'url'; value: string; href: string };

// URL | @멘션(직전이 단어문자/@면 이메일 등으로 보고 제외) | #해시태그(글자·숫자·_ 연속, 일한영 지원)
const TOKEN_RE =
  /(https?:\/\/[^\s]+)|((?<![\w@＠])[@＠][A-Za-z0-9_]{1,15})|((?<![\p{L}\p{N}_])[#＃][\p{L}\p{N}_]+)/gu;

// URL 꼬리에 붙은 문장부호(일본어 구두점·닫는 괄호 포함)는 본문으로 돌려보낸다
const TRAILING_PUNCT_RE = /[)\]}>.,、。」』】！？!?;:]+$/;

export function tokenizeTweetText(text: string): TweetTextToken[] {
  const out: TweetTextToken[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const idx = m.index;
    if (idx > last) out.push({ type: 'text', value: text.slice(last, idx) });
    const [, url, mention, hashtag] = m;
    if (url) {
      const trail = url.match(TRAILING_PUNCT_RE)?.[0] ?? '';
      const clean = trail ? url.slice(0, -trail.length) : url;
      out.push({ type: 'url', value: clean, href: clean });
      if (trail) out.push({ type: 'text', value: trail });
    } else if (mention) {
      out.push({ type: 'mention', value: mention, handle: mention.slice(1) });
    } else if (hashtag) {
      out.push({ type: 'hashtag', value: hashtag, tag: hashtag.slice(1) });
    }
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}
