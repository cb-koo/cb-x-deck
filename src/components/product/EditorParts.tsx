'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { setNavGuard } from '@/lib/navGuard';
import { IssueReport } from '@/components/IssueReport';
export const EDIT_INPUT = 'w-full rounded-md border border-x-border-strong bg-white px-3 py-2 text-ui outline-none focus:border-x-blue';
export function ProductDialog({ title, onClose, children, side = false }: { title: string; onClose: () => void; children: ReactNode; side?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => { const node = ref.current, trigger = document.activeElement; node?.showModal();
    return () => { node?.close(); if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); }; }, []);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }} className={`${side ? 'fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-full max-w-lg' : 'm-auto w-[calc(100%_-_2rem)] max-w-xl rounded-xl'} border border-x-border bg-white p-0 shadow-xl backdrop:bg-black/25`}>
    <div className="flex items-center justify-between border-b border-x-border px-5 py-4"><h2 id={titleId} className="text-content font-semibold">{title}</h2>
      {/* showModal 창은 바깥(오른쪽 아래 둥근 버튼)을 누를 수 없다 — 같은 버튼을 머리글에 둔다(이슈 리포트 스펙 §2-1) */}
      <div className="flex items-center gap-1"><IssueReport variant="inline" /><button aria-label="닫기" onClick={onClose} className="rounded p-2 hover:bg-x-hover">✕</button></div></div><div className="max-h-[85vh] overflow-y-auto p-5">{children}</div>
  </dialog>;
}
export function useProductUnsaved(dirty: boolean) {
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    const cleanup = setNavGuard(() => dirty && !window.confirm('저장하지 않은 입력이 있어요. 입력을 버리고 이동할까요?'));
    window.addEventListener('beforeunload', unload); return () => { cleanup(); window.removeEventListener('beforeunload', unload); };
  }, [dirty]);
}
