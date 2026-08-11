'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { DraftRow } from '@/lib/draftStore';
import type { DraftContent, InfluencerOption } from '@/lib/draftTypes';
import { xWeightedLength, X_MAX_WEIGHTED } from '@/lib/xLength';
import { textsChanged } from '@/lib/draftUi';
import { InfluencerField } from './InfluencerField';
import { parseXHandle, handleParseMessage } from '@/lib/xHandle';

// X 컴포즈 모달 구조: ✕ / 원본과 비교 / 아바타 40 / 입력 20px·lh24 / 하단 바 + 저장 36px (스펙 §4)
export function DraftEditModal({ draft, options, onClose, onSaved }: {
  draft: DraftRow; options: InfluencerOption[]; onClose: () => void; onSaved: (updated: DraftRow) => void;
}) {
  const base = draft.edited ?? draft.content;
  const baseHandle = draft.influencerHandle ?? ''; // '' = 미배정
  const [texts, setTexts] = useState(base.posts.map((p) => p.text));
  const [handle, setHandle] = useState(baseHandle);
  const [handleErr, setHandleErr] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const empty = texts.some((t) => !t.trim());
  // 저장되는 값은 앞뒤 공백을 뗀 것이라 공백만 다른 건 변경이 아니다.
  const handleDirty = handle.trim() !== baseHandle;
  // 배정 변경도 dirty에 포함한다 — 배정만 바꾸고 ✕·Esc·배경 클릭으로 닫으면 경고 없이 조용히 날아간다 (스펙 §E)
  const dirty = textsChanged(base.posts.map((p) => p.text), texts) || handleDirty;
  // 이 모달엔 별도 '취소' 버튼이 없어 ✕·Esc·배경 클릭 모두 확인 대상 (스펙 3-3)
  function requestClose() {
    if (!dirty || window.confirm('저장하지 않은 수정이 있어요. 닫을까요?')) onClose();
  }

  // Esc로 모달 닫기 — ColumnSettings 선례와 동일한 방식. IME 조합 중 Esc는 무시.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      if (!dirty || window.confirm('저장하지 않은 수정이 있어요. 닫을까요?')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dirty, onClose]);

  async function save() {
    // 빈 칸은 오류가 아니라 '배정 해제'다 — parseXHandle('')은 'empty' 오류를 돌려주므로 파서를 부르기 전에 null로 확정한다.
    const typed = handle.trim();
    let influencerHandle: string | null = null;
    if (typed) {
      const parsed = parseXHandle(typed);
      // 형식이 틀리면 저장을 막는다(거짓 성공 방지). 문구는 서버 검증과 같은 함수가 소유한다.
      if (!parsed.ok) { setHandleErr(handleParseMessage(parsed.reason)); return; }
      influencerHandle = parsed.handle;
    }
    setErr(''); setHandleErr(null); setSaving(true);
    const edited: DraftContent = {
      posts: base.posts.map((p, i) => ({ text: texts[i], media: p.media })),
    };
    const r = await apiFetch(`/api/drafts/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // 배정이 안 바뀌었으면 키 자체를 싣지 않는다 — 서버는 undefined를 '건드리지 않음'으로 읽는다.
      body: JSON.stringify(handleDirty ? { edited, influencerHandle } : { edited }),
    });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? `오류 ${r.status}`); return; }
    onSaved((await r.json()) as DraftRow);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-x-text/40 p-6" onClick={requestClose}>
      <div className="w-full max-w-[600px] rounded-2xl bg-white" role="dialog" aria-label="초안 편집"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <button onClick={requestClose} aria-label="닫기" className="rounded-full px-2 py-1 text-[19px] hover:bg-x-text/5">✕</button>
          <button onClick={() => setCompare(!compare)} className="text-[15px] font-bold text-x-blue-text hover:underline">
            {compare ? '편집으로 돌아가기' : '원본과 비교'}
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-4 pb-2">
          {base.posts.map((p, i) => {
            const len = xWeightedLength(texts[i]);
            return (
              <div key={i} className="flex gap-3 py-2">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
                      style={{ background: draft.member?.color ?? '#1d9bf0' }}>
                  {(draft.member?.name ?? '초').slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  {base.posts.length > 1 && <p className="text-caption font-bold text-x-muted">{i + 1} / {base.posts.length}</p>}
                  {compare ? (
                    <div className="space-y-4">
                      <div>
                        <p className="mb-1 text-[13px] font-bold text-x-muted">생성 원본</p>
                        <p className="whitespace-pre-wrap rounded-lg bg-x-surface p-3 text-[17px] leading-normal text-x-secondary">{draft.content.posts[i]?.text}</p>
                      </div>
                      <div>
                        <p className="mb-1 text-[13px] font-bold text-x-blue-text">현재 편집본</p>
                        <p className="whitespace-pre-wrap rounded-lg border border-x-border-strong p-3 text-[17px] leading-normal">{texts[i]}</p>
                      </div>
                    </div>
                  ) : (
                    <textarea value={texts[i]} rows={Math.max(3, texts[i].split('\n').length + 1)}
                              onChange={(e) => setTexts(texts.map((t, j) => (j === i ? e.target.value : t)))}
                              className="w-full resize-y text-[20px] leading-6 outline-none placeholder:text-x-muted"
                              placeholder="본문을 입력하세요" autoFocus={i === 0} />
                  )}
                  <p className={`text-caption tabular-nums ${len > X_MAX_WEIGHTED ? 'font-bold text-amber-700' : 'text-x-muted'}`}>
                    X 기준 {len} / {X_MAX_WEIGHTED}{len > X_MAX_WEIGHTED && ` — ${len - X_MAX_WEIGHTED} 줄여야 해요`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* 배정 칸은 본문 아래·PR 안내 위 — 바로 다음 줄이 "인플루언서가 자기 계정으로 게시합니다"라 문맥이 이어진다.
            필드는 자체 여백·구분선이 없으므로 컨테이너는 여기서 준다. */}
        <div className="border-t border-x-border px-4 py-2.5">
          <InfluencerField value={handle} options={options} error={handleErr}
                           // 고치는 중에도 빨간 문구가 붙어 있으면 "고쳤는데 여전히 틀렸다"로 읽힌다 — 타이핑 시작과 함께 지운다.
                           onChange={(v) => { setHandle(v); setHandleErr(null); }} />
        </div>

        <p className="border-t border-x-border px-4 py-2 text-[14px] font-bold text-x-blue-text">
          🌐 인플루언서가 자기 계정으로 게시합니다 — PR 표기 안내를 함께 전달하세요
        </p>
        <div className="flex items-center gap-3 border-t border-x-border px-4 py-2.5">
          {err && <span className="text-ui text-red-500">{err}</span>}
          <button onClick={save} disabled={saving || empty || compare}
                  className="ml-auto h-9 rounded-full bg-x-blue px-[17px] text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
