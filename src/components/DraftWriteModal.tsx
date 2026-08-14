'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { DraftRow } from '@/lib/draftStore';
import { xWeightedLength, X_MAX_WEIGHTED } from '@/lib/xLength';
import { addSlot, removeSlot } from '@/lib/draftFormat';

// 직접 쓰기 — LLM 없는 두 번째 입구 (설계 §B).
// 겉모습은 DraftEditModal을 그대로 따른다(600px·rounded-2xl·아바타 40·본문 20px/lh24·하단 저장 바):
// 같은 일(원고를 쓴다)에 두 벌의 시각 관례를 만들면, 사용자는 두 화면을 서로 다른 기능으로 읽는다.
//
// 편집 모달과 갈리는 지점은 하나뿐이다 — **저장 전엔 서버를 부르지 않는다**.
// 편집 모달의 칸 추가·삭제·이미지는 전부 기존 draft.id로 즉시 PATCH하는 구조인데, 여기엔 아직
// 초안이 없다. 그래서 칸 구조는 순수 로컬 상태이고(addSlot/removeSlot 재사용), 이미지는 아예 없다
// (업로드가 draft.id를 요구한다 — 저장 후 카드에서 붙인다). 닫으면 아무것도 남지 않는다.
export function DraftWriteModal({ clientId, clientName, procedureNames, procedureIds, onClose, onSaved }: {
  clientId: string | null;
  clientName: string | null;      // 표시용 — 모달이 clients 배열을 뒤지지 않게 이름만 받는다
  procedureNames: string[];       // 표시용
  procedureIds: string[];         // 저장용
  onClose: () => void;
  onSaved: (created: DraftRow) => void;
}) {
  const [texts, setTexts] = useState<string[]>(['']);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const empty = texts.some((t) => !t.trim());
  // 저장된 적이 없으므로 dirty = "무언가 쓰여 있다". 빈 칸만 늘린 상태는 잃을 것이 없어 확인하지 않는다.
  const dirty = texts.some((t) => t.trim().length > 0) || title.trim().length > 0;
  // 컴포저에서 승계한 조건 — 어디 소속으로 저장되는지 저장 전에 보여야 한다(설계 §B, AGENTS 원칙 2).
  // 클라이언트가 없으면 아무것도 그리지 않는다: '연결 없음'을 말해봐야 지금 할 일이 달라지지 않는다.
  const scope = clientName ? [clientName, ...procedureNames].join(' · ') : null;

  // 편집 모달과 같은 관례(✕·Esc·배경 클릭 모두 확인 대상)지만 문구는 다르다 —
  // 여기서 닫으면 '저장 안 된 수정'이 아니라 원고 자체가 사라진다.
  function requestClose() {
    if (!dirty || window.confirm('작성 중인 원고가 있어요. 닫으면 저장되지 않고 사라져요. 닫을까요?')) onClose();
  }

  // IME 조합 중 Esc는 무시 — 한글 입력을 취소하려는 Esc가 모달을 닫으면 쓰던 글이 통째로 날아간다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      if (!dirty || window.confirm('작성 중인 원고가 있어요. 닫으면 저장되지 않고 사라져요. 닫을까요?')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dirty, onClose]);

  async function save() {
    if (saving || empty) return;
    setErr(''); setSaving(true);
    const r = await apiFetch('/api/drafts/manual', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        posts: texts,
        // 빈 제목은 아예 싣지 않는다 — 목록 라벨은 본문 첫 줄로 폴백한다(draftLabel)
        ...(title.trim() ? { title: title.trim() } : {}),
        clientId, procedureIds,
      }),
    });
    setSaving(false);
    if (!r.ok) { setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`); return; }
    // 생성 POST와 같은 모양(한 건짜리 배열)이라 페이지의 삽입 배선을 그대로 쓴다.
    const rows = (await r.json().catch(() => null)) as Array<DraftRow | null> | null;
    const created = Array.isArray(rows) ? rows[0] : null;
    // 저장은 성공했는데 본문을 못 읽는 경우(응답 파손) — 여기서 조용히 닫으면 사용자는 "저장이 안 됐다"고
    // 읽고 같은 원고를 다시 쓴다. 실제로는 목록에 들어가 있으므로 그 사실을 말한다.
    if (!created) { setErr('저장은 됐는데 결과를 읽지 못했어요 — 새로고침하면 목록에 있어요'); return; }
    onSaved(created);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-x-text/40 p-6" onClick={requestClose}>
      <div className="w-full max-w-[600px] rounded-2xl bg-white" role="dialog" aria-label="원고 직접 쓰기"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-2.5">
          <button onClick={requestClose} aria-label="닫기" className="rounded-full px-2 py-1 text-[19px] hover:bg-x-text/5">✕</button>
          <h2 className="text-[15px] font-bold">직접 쓰기</h2>
        </div>

        {/* 승계한 조건 — 조용한 한 줄. 저장 버튼을 누르기 전에 '어디 소속으로 들어가는지'가 읽혀야 한다. */}
        {scope && (
          <p className="border-t border-x-border bg-x-surface px-4 py-1.5 text-caption text-x-secondary">
            {scope} 원고로 저장돼요
          </p>
        )}

        {/* 제목 — 편집 모달과 같은 자리·같은 톤. 여기엔 아직 초안이 없어 '지금 목록에 나오는 라벨'을
            placeholder로 보여줄 수 없으므로, 비웠을 때 무엇이 대신 쓰이는지를 도움말로 말한다. */}
        <div className="border-y border-x-border px-4 py-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
                 placeholder="원고 제목 (선택)"
                 aria-label="원고 제목"
                 className="w-full text-[17px] font-bold outline-none placeholder:font-normal placeholder:text-x-muted" />
          <p className="text-caption text-x-muted">
            목록과 보드에서 이 원고를 부를 이름이에요 — 비워두면 본문 첫 줄이 쓰여요
          </p>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-4 pb-2">
          {texts.map((t, i) => {
            const len = xWeightedLength(t);
            return (
              <div key={i} className="flex gap-3 py-2">
                {/* 아바타는 편집 모달의 폴백과 같은 모양 — 저장 전이라 작성자 색을 알 수 없다 */}
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-x-blue text-[15px] font-bold text-white">
                  초
                </span>
                <div className="min-w-0 flex-1">
                  {texts.length > 1 && <p className="text-caption font-bold text-x-muted">{i + 1} / {texts.length}</p>}
                  <textarea value={t} rows={Math.max(3, t.split('\n').length + 1)}
                            onChange={(e) => setTexts(texts.map((x, j) => (j === i ? e.target.value : x)))}
                            className="w-full resize-y text-[20px] leading-6 outline-none placeholder:text-x-muted"
                            placeholder="본문을 입력하세요" autoFocus={i === 0}
                            aria-label={texts.length > 1 ? `본문 ${i + 1}번째 칸` : '본문'} />
                  <div className="mt-1 flex items-center gap-2">
                    {/* 칸이 1개면 지우기를 숨긴다 — 0칸 원고는 저장할 수 없다(서버도 400으로 막는다) */}
                    {texts.length > 1 && (
                      <button type="button" disabled={saving}
                              onClick={() => setTexts(removeSlot(texts, i))}
                              className="text-caption text-x-muted hover:text-red-600 disabled:opacity-40">
                        칸 지우기
                      </button>
                    )}
                    <span className={`ml-auto shrink-0 text-caption tabular-nums ${len > X_MAX_WEIGHTED ? 'font-bold text-amber-700' : 'text-x-muted'}`}>
                      X 기준 {len} / {X_MAX_WEIGHTED}{len > X_MAX_WEIGHTED && ` — ${len - X_MAX_WEIGHTED} 줄여야 해요`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* 편집 모달의 칸 추가와 같은 문구·같은 모양. 다만 여기선 저장이 따라붙지 않으므로
              "함께 저장돼요" 안내도 없다 — 실제로 아무 일도 일어나지 않는 게 맞다. */}
          <div className="mt-2">
            <button type="button" disabled={saving}
                    onClick={() => setTexts(addSlot(texts, ''))}
                    className="w-full rounded-lg border border-dashed border-x-border-strong py-2 text-ui font-bold text-x-secondary hover:bg-x-hover disabled:opacity-40">
              + 칸 추가 {texts.length === 1 && <span className="font-normal text-x-muted">— 스레드로 이어 쓸 수 있어요</span>}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-x-border px-4 py-2.5">
          {/* 이미지가 없는 이유를 여기서 한 줄로 갚아둔다 — 첨부 버튼을 찾다 못 찾고 포기하는 것보다
              "저장한 뒤 붙인다"는 다음 행동을 미리 아는 편이 낫다(AGENTS 원칙 2). 오류가 나면 그 자리를 오류가 쓴다. */}
          <span className={err ? 'text-ui text-red-500' : 'text-caption text-x-muted'}>
            {err || '이미지는 저장한 뒤 카드에서 붙일 수 있어요'}
          </span>
          <button onClick={save} disabled={saving || empty}
                  className="ml-auto h-9 shrink-0 rounded-full bg-x-blue px-[17px] text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
