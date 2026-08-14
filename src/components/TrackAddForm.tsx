'use client';
import { useId, useState } from 'react';
import { Button } from '@/components/ui';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';

// 추적 등록 폼 — 붙여넣는 즉시 링크를 검증한다(AddByLinkModal과 같은 파서·같은 문구).
// 여러 개는 한 줄에 하나씩(인플루언서 등록과 같은 규칙) — 서버 계약이 한 요청 = 링크 하나라
// 여러 줄은 페이지가 순차로 보낸다. 제출 결과 판단도 페이지 몫: 목록 전체를 아는 쪽이 한다.
export function TrackAddForm({ progress, onSubmit }: {
  // null = 대기, {done,total} = 순차 등록 진행 중 (버튼 라벨이 진행률을 말한다)
  progress: { done: number; total: number } | null;
  // ok = 입력 비움 / keep = 실패한 링크만 남겨 되돌려줌(다시 누를 수 있게)
  onSubmit: (urls: string[]) => Promise<{ ok: true } | { ok: false; keep: string }>;
}) {
  const [text, setText] = useState('');
  const inputId = useId();
  const helpId = useId();
  const errId = useId();

  // 줄·공백 어느 쪽으로 나눠 붙여도 받는다 — URL에는 공백이 없다. 같은 링크 중복은 조용히 한 번으로.
  const tokens = [...new Set(text.split(/\s+/).map((s) => s.trim()).filter(Boolean))];
  const parsedAll = tokens.map((t) => ({ token: t, parsed: parseTweetLink(t) }));
  const invalid = parsedAll.filter((p) => !p.parsed.ok);
  const canSubmit = tokens.length > 0 && invalid.length === 0 && !progress;
  // 빈 칸은 오류가 아니라 아직 안 쓴 상태다 — 커서만 올려놓은 사람에게 빨간 글씨를 보이지 않는다
  const showParseErr = tokens.length > 0 && invalid.length > 0;

  async function submit() {
    if (!canSubmit) return;
    const result = await onSubmit(tokens);
    setText(result.ok ? '' : result.keep);
  }

  const busyLabel = progress && progress.total > 1
    ? `가져오는 중… ${progress.done}/${progress.total}`
    : '가져오는 중…';

  return (
    <div>
      <label htmlFor={inputId} className="block text-caption text-x-muted">게시물 링크</label>
      <div className="mt-0.5 flex items-start gap-2">
        {/* textarea: 여러 링크는 줄로 나눠 붙는 게 자연스럽다. Enter는 줄바꿈 — 제출은 버튼으로만
            (한 줄 입력이던 시절의 Enter 제출을 유지하면 두 번째 링크를 붙이려던 Enter가 제출로 샌다).
            기본 2줄 + 예시 두 줄 자리표시: 한 줄짜리 칸은 '하나만 넣는 곳'으로 읽힌다(QA 08-15) —
            여러 개를 받는다는 사실은 설명이 아니라 생김새가 먼저 말해야 한다. */}
        <textarea id={inputId} value={text} onChange={(e) => setText(e.target.value)}
                  rows={Math.min(Math.max(text.split('\n').length + 1, 2), 8)}
                  placeholder={'https://x.com/계정/status/…\nhttps://x.com/계정/status/…  ← 여러 개는 한 줄에 하나씩'}
                  autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  aria-invalid={showParseErr ? true : undefined}
                  aria-describedby={showParseErr ? `${helpId} ${errId}` : helpId}
                  className="w-full max-w-[520px] resize-none rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue" />
        {/* 비용 유발 액션은 버튼에 값을 적어 opt-in으로(UX 원칙 6) — 몇 건이면 몇 번 호출인지 라벨이 말한다 */}
        <Button variant="primary" className="shrink-0 whitespace-nowrap"
                onClick={() => void submit()} disabled={!canSubmit}>
          {progress ? busyLabel
            : tokens.length > 1 ? `추적 시작 (${tokens.length}건 — API 호출 ${tokens.length}회)` : '추적 시작'}
        </Button>
      </div>
      <p id={helpId} className="mt-1 text-caption text-x-muted">
        X 게시물 링크를 붙여넣으면 현재 지표를 가져와 아래 목록에 추가해요 — 여러 개는 한 줄에 하나씩
      </p>
      {/* 여러 개를 붙였을 때 즉시 응답: 몇 개로 읽었는지 칸이 말해준다 — 버튼 라벨(N건)과 같은 수 */}
      {tokens.length > 1 && invalid.length === 0 && (
        <p className="mt-1 text-caption text-x-secondary" aria-live="polite">
          링크 {tokens.length}개 인식됨 — 위에서부터 순서대로 등록해요
        </p>
      )}
      {/* 뜻은 색이 아니라 글자가 나른다 — 몇 개가 왜 걸렸고 어떻게 고치는지까지 말한다(tweetLink.ts) */}
      {showParseErr && (
        <p id={errId} className="mt-1 text-caption text-red-600">
          {tokens.length === 1
            ? tweetLinkParseMessage(invalid[0].parsed.ok ? 'invalid' : invalid[0].parsed.reason)
            : `${tokens.length}개 중 ${invalid.length}개가 트윗 주소가 아니에요 — ${
                tweetLinkParseMessage(invalid[0].parsed.ok ? 'invalid' : invalid[0].parsed.reason)}`}
        </p>
      )}
    </div>
  );
}
