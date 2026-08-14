'use client';
import { useId, useState } from 'react';
import { Button } from '@/components/ui';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';

// 추적 등록 폼 — 붙여넣는 즉시 링크를 검증한다(AddByLinkModal과 같은 파서·같은 문구).
// 제출 자체는 페이지가 한다: 등록 결과(새로 추가/이미 추적 중/오류)의 판단은 목록 전체를 아는 쪽 몫이다.
export function TrackAddForm({ busy, onSubmit }: {
  busy: boolean;
  // 'ok' = 입력 비움(성공·이미 추적 중), 'keep' = 입력 보존(오류 — 다시 누를 수 있게)
  onSubmit: (url: string) => Promise<'ok' | 'keep'>;
}) {
  const [url, setUrl] = useState('');
  const inputId = useId();
  const helpId = useId();
  const errId = useId();

  const parsed = parseTweetLink(url);
  // 빈 칸은 오류가 아니라 아직 안 쓴 상태다 — 커서만 올려놓은 사람에게 빨간 글씨를 보이지 않는다
  const showParseErr = url.trim().length > 0 && !parsed.ok && parsed.reason !== 'empty';

  async function submit() {
    if (!parsed.ok || busy) return;
    if ((await onSubmit(url)) === 'ok') setUrl('');
  }

  return (
    <div>
      <label htmlFor={inputId} className="block text-caption text-x-muted">게시물 링크</label>
      <div className="mt-0.5 flex items-center gap-2">
        <input id={inputId} value={url} onChange={(e) => setUrl(e.target.value)}
               // 한국어 입력에서 조합을 확정하는 Enter가 제출로 새면 안 된다(저장소 관례)
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(); }}
               placeholder="https://x.com/계정/status/…"
               autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
               aria-invalid={showParseErr ? true : undefined}
               aria-describedby={showParseErr ? `${helpId} ${errId}` : helpId}
               className="w-full max-w-[520px] rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue" />
        <Button variant="primary" className="shrink-0 whitespace-nowrap"
                onClick={() => void submit()} disabled={!parsed.ok || busy}>
          {busy ? '가져오는 중…' : '추적 시작'}
        </Button>
      </div>
      <p id={helpId} className="mt-1 text-caption text-x-muted">
        X 게시물 링크를 붙여넣으면 현재 지표를 가져와 아래 목록에 추가해요
      </p>
      {/* 뜻은 색이 아니라 글자가 나른다 — 문구가 무엇이 틀렸고 어떻게 고치는지까지 말한다(tweetLink.ts) */}
      {showParseErr && (
        <p id={errId} className="mt-1 text-caption text-red-600">
          {tweetLinkParseMessage(parsed.ok ? 'invalid' : parsed.reason)}
        </p>
      )}
    </div>
  );
}
