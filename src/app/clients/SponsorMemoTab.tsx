'use client';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button, PANEL } from '@/components/ui';
import { EDIT_INPUT as INPUT } from '@/components/product/EditorParts';
import type { Register } from './ClientDetail';

const MAX = 4000;

// 클라이언트 상세의 '협찬 항목' 탭 — 지점과 무관한 클라이언트 공통 자유 메모. 여기서만 쓰고, 익스텐션은 읽기 전용으로 본다.
// 미저장 메모는 ClientDetail 레지스트리에 올린다 — 클라이언트 전환·이동 확인과 '저장하고 이동'이 다른 편집기와 같은 길을 탄다.
export function SponsorMemoTab({ clientId, register }: { clientId: string; register: Register }) {
  const [saved, setSaved] = useState<string | null>(null);   // 서버에 저장된 값(null = 불러오는 중)
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await apiFetch(`/api/clients/${clientId}`);
      if (!alive) return;
      if (!r.ok) { setError('협찬 항목을 불러오지 못했어요. 새로고침해 주세요.'); return; }
      const memo = ((await r.json()) as { client: { sponsorMemo: string } }).client.sponsorMemo;
      setSaved(memo); setText(memo);
    })();
    return () => { alive = false; };
  }, [clientId]);

  async function save(): Promise<boolean> {
    setState('saving'); setError('');
    try {
      const r = await apiFetch(`/api/clients/${clientId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sponsorMemo: text }),
      });
      if (!r.ok) {
        const msg = ((await r.json().catch(() => ({}))) as { error?: string }).error;
        setError(msg ?? `저장하지 못했어요 (오류 ${r.status})`); setState('idle'); return false;
      }
      setSaved(text); setState('done'); return true;
    } catch { setError('저장하지 못했어요. 네트워크를 확인해 주세요.'); setState('idle'); return false; }
  }

  const dirty = saved !== null && text !== saved;
  // 레지스트리는 등록 시점의 함수를 들고 있으므로 최신 상태는 ref로 읽는다.
  const dirtyRef = useRef(false), saveRef = useRef(save);
  useEffect(() => { dirtyRef.current = dirty || state === 'saving'; saveRef.current = save; });
  useEffect(() => register('sponsor', { isDirty: () => dirtyRef.current, save: () => saveRef.current() }), [register]);
  return (
    <section className={`${PANEL} space-y-3`}>
      <label htmlFor="sponsor-memo" className="block text-content font-semibold">협찬 항목</label>
      <p className="text-ui text-x-secondary">
        시술·단가 등 이 클리닉이 협찬할 수 있는 항목을 자유롭게 적어 두세요. 지점과 상관없이 클리닉 전체에 같게 적용되고, 익스텐션에서 인플루언서와 대화할 때 읽기 전용으로 보여요.
      </p>
      <textarea id="sponsor-memo" rows={10} className={INPUT} value={text} disabled={saved === null && !error}
                placeholder="예) 리쥬란 2cc — 협찬가 15만" maxLength={MAX}
                onChange={(e) => { setText(e.target.value); setState('idle'); }} />
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={() => void save()} disabled={saved === null || !dirty || state === 'saving'}>
          {state === 'saving' ? '저장 중…' : '저장'}
        </Button>
        {state === 'done' && !dirty && <span className="text-ui text-x-secondary" role="status">저장했어요. 익스텐션의 협찬 항목 탭에서 바로 볼 수 있어요.</span>}
        {error && <span className="text-ui text-red-500" role="alert">{error}</span>}
        <span className="ml-auto text-ui text-x-secondary">{text.length}/{MAX}</span>
      </div>
    </section>
  );
}
