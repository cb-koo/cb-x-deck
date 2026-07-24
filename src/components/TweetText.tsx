import { tokenizeTweetText } from '@/lib/tweetText';

// 본문 엔티티 링크: 멘션→프로필, 해시태그→X 검색, URL→원본 (Display Requirements)
export function TweetText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <p className={`whitespace-pre-wrap break-words ${className}`}>
      {tokenizeTweetText(text).map((tok, i) => {
        if (tok.type === 'text') return tok.value;
        const href =
          tok.type === 'url' ? tok.href
          : tok.type === 'mention' ? `https://x.com/${tok.handle}`
          : `https://x.com/search?q=${encodeURIComponent(`#${tok.tag}`)}`;
        return (
          <a key={i} href={href} target="_blank" rel="noopener" className="text-x-blue-text hover:underline"
             onClick={(e) => e.stopPropagation()}>
            {tok.value}
          </a>
        );
      })}
    </p>
  );
}
