'use client';
import { useId, useState } from 'react';
import { Button } from '@/components/ui';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';

// 추적 등록 폼 — 붙여넣는 즉시 링크를 검증한다(AddByLinkModal과 같은 파서·같은 문구).
// 이 폼은 단건 전용이다: 여러 개는 옆의 진입점이 여는 전용 다이얼로그(TrackAddManyDialog)가 받는다.
// 한 칸에 둘 다 받으려던 시도는 "복수 입력창이라는 느낌이 들지 않는다"는 QA(08-15)로 접었다.
// 제출 자체는 페이지가 한다: 등록 결과(새로 추가/이미 추적 중/오류)의 판단은 목록 전체를 아는 쪽 몫이다.
export function TrackAddForm({ busy, onSubmit, onOpenMany }: {
  busy: boolean;
  // 'ok' = 입력 비움(성공·이미 추적 중), 'keep' = 입력 보존(오류 — 다시 누를 수 있게)
  onSubmit: (url: string) => Promise<'ok' | 'keep'>;
  onOpenMany: () => void;
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
      {/* 입력칸과 버튼 두 개를 같은 높이(h-10)로 한 줄에 — 복수 등록 진입점은 도움말 속 링크가
          아니라 정식 버튼이다(QA 08-15: 회색 문장 꼬리의 파란 글자는 각주처럼 읽혀 발견이 안 됐다).
          primary(추적 시작)/subtle(여러 개 등록)의 스타일 차이가 주·부 동작의 위계를 나른다 */}
      <div className="mt-1 flex items-center gap-2">
        <input id={inputId} value={url} onChange={(e) => setUrl(e.target.value)}
               // 한국어 입력에서 조합을 확정하는 Enter가 제출로 새면 안 된다(저장소 관례)
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(); }}
               placeholder="https://x.com/계정/status/…"
               autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
               aria-invalid={showParseErr ? true : undefined}
               aria-describedby={showParseErr ? `${helpId} ${errId}` : helpId}
               className="h-10 w-full max-w-[640px] rounded-lg border border-x-border-strong bg-white px-3 text-ui outline-none focus:border-x-blue" />
        <Button variant="primary" className="h-10 shrink-0 whitespace-nowrap px-4"
                onClick={() => void submit()} disabled={!parsed.ok || busy}>
          {busy ? '가져오는 중…' : '추적 시작'}
        </Button>
        <Button variant="subtle" className="h-10 shrink-0 whitespace-nowrap px-4" onClick={onOpenMany}>
          여러 개 등록
        </Button>
      </div>
      <p id={helpId} className="mt-1 text-caption text-x-muted">
        붙여넣으면 현재 지표를 가져와 아래 목록에 추가해요
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
