'use client';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { collectIssueLocation, measureFabPosition, uploadIssueScreenshot } from '@/lib/issueClient';
import { FAB_GAP, FAB_SIZE, MAX_ISSUE_BODY, issueScreenshotError, locationLine, type IssueLocation } from '@/lib/issueReport';
import { Toast } from '@/components/Toast';

// 불편 알리기 — 모든 화면 오른쪽 아래 둥근 버튼(variant="fab")과, 바깥을 누를 수 없는 브라우저 기본 창
// (ProductDialog) 머리글에 넣는 같은 버튼(variant="inline"). 스펙 2026-10-22-issue-report-design.md §2-1·§2-2.
//
// 버튼은 숨지 않고 비켜선다(koo 10-22) — 패널에 대한 이슈일수록 패널을 띄운 채 보내야 한다. 열린 패널·창은
// 이 버튼과 보내는 창을 '바깥'으로 치지 않게 data-issue-report로 뺀다(TaskPanel의 바깥 클릭 닫기).
// 글자는 붙이지 않는다(koo 10-22) — 마우스를 올리면 말풍선만.

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
    <path d="M4 5h16v11H9l-5 4z" /><path d="M12 8.5v3.5" /><path d="M12 14.6v.1" />
  </svg>
);

export function IssueReport({ variant = 'fab' }: { variant?: 'fab' | 'inline' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState<IssueLocation | null>(null);
  const [sent, setSent] = useState<string | null>(null);   // 방금 보낸 이슈 id — 토스트 [보기]
  const [pos, setPos] = useState({ right: FAB_GAP, bottom: FAB_GAP });

  // 비켜서기 — 화면이 바뀔 때마다(패널 열고 닫기, 일괄 처리 바, 창 크기) 다시 잰다. 한 프레임에 한 번만.
  useEffect(() => {
    if (variant !== 'fab') return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = measureFabPosition();
        setPos((p) => (p.right === next.right && p.bottom === next.bottom ? p : next));
      });
    };
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'open'] });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(frame); mo.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [variant]);

  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => setSent(null), 6000);
    return () => clearTimeout(t);
  }, [sent]);

  const toggle = () => {
    if (open) return;   // 열려 있으면 그대로 — 쓰던 내용을 버튼 한 번으로 날리지 않는다
    setLocation(collectIssueLocation());   // 창을 띄우기 전에 잰다 — 이 창 자신이 '열린 패널'로 잡히지 않게
    setSent(null);
    setOpen(true);
  };

  const fab = variant === 'fab';
  const popStyle: CSSProperties = fab
    ? { right: pos.right, bottom: pos.bottom + FAB_SIZE + 12 }
    : { right: 0, top: 'calc(100% + 8px)' };

  return (
    <>
      <div data-issue-report className={fab ? 'fixed z-[60] transition-[right,bottom] duration-150' : 'relative'}
           style={fab ? { right: pos.right, bottom: pos.bottom } : undefined}>
        <button type="button" onClick={toggle} aria-label="불편 알리기" aria-expanded={open}
                className={fab
                  ? 'group relative flex h-10 w-10 items-center justify-center rounded-full border border-x-border-strong bg-white text-x-text shadow-[0_2px_8px_rgba(0,0,0,0.12)] hover:bg-x-hover'
                  : 'group relative rounded p-2 text-x-secondary hover:bg-x-hover'}>
          {ICON}
          <span role="tooltip"
                className={`pointer-events-none absolute whitespace-nowrap rounded-md bg-x-text px-2 py-1 text-caption text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${fab ? 'bottom-full right-0 mb-2' : 'right-full top-1/2 mr-2 -translate-y-1/2'}`}>
            불편 알리기
          </span>
        </button>
        {!fab && open && location && (
          <IssueForm location={location} style={popStyle} anchored="inline"
                     onClose={() => setOpen(false)} onSent={(id) => { setOpen(false); setSent(id); }} />
        )}
      </div>
      {fab && open && location && (
        <IssueForm location={location} style={popStyle} anchored="fab"
                   onClose={() => setOpen(false)} onSent={(id) => { setOpen(false); setSent(id); }} />
      )}
      {/* 브라우저 기본 창 안(inline)에서는 화면 아래 토스트가 창 뒤에 깔려 안 보인다 — 버튼 옆에 짧게 알린다 */}
      {!fab && sent && <span role="status" className="mr-1 text-ui text-x-secondary">보냈어요</span>}
      {fab && sent && (
        <div data-issue-report>
          <Toast message="보냈어요" actionLabel="보기"
                 onAction={() => { const id = sent; setSent(null); router.push(`/issues?id=${id}`); }}
                 onDismiss={() => setSent(null)} />
        </div>
      )}
    </>
  );
}

function IssueForm({ location, style, anchored, onClose, onSent }: {
  location: IssueLocation;
  style: CSSProperties;
  anchored: 'fab' | 'inline';
  onClose: () => void;
  onSent: (id: string) => void;
}) {
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { textRef.current?.focus(); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const dirty = body.trim() !== '' || !!file;
  const close = useCallback(() => {
    if (busy) return;
    if (dirty && !window.confirm('쓴 내용이 사라져요. 닫을까요?')) return;
    onClose();
  }, [busy, dirty, onClose]);

  const take = useCallback((f: File) => {
    const v = issueScreenshotError(f);
    if (v) { setErr(v); return; }
    setErr('');
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }, []);

  // 붙여넣기 — 창이 열려 있는 동안은 글 칸에 포커스가 있어도 이미지를 이 창이 받는다(스펙 §2-2).
  // 캡처 단계에서 먼저 받고 preventDefault한다 — 뒤의 증빙 칸(TaskProofField 등)이 같은 이미지를 또 올리지 않게
  // (그쪽은 defaultPrevented면 건너뛴다). 텍스트 붙여넣기는 그대로 흘려보낸다.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'));
      if (!f) return;
      e.preventDefault();
      e.stopPropagation();
      take(f);
    };
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, [take]);

  // Esc — 이 창만 닫는다. 아래 패널의 Esc(닫기)까지 가지 않게 캡처 단계에서 멈춘다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const send = async () => {
    if (!body.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const screenshotPath = file ? await uploadIssueScreenshot(file) : null;
      const r = await apiFetch('/api/issues', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body, screenshotPath, location }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '보내지 못했어요 — 다시 시도해주세요');
      window.dispatchEvent(new Event('cbx-issues-changed'));
      onSent(j.id);
    } catch (e) {
      // 창을 닫지 않는다 — 쓴 내용은 그대로 두고 다시 보낼 수 있게
      setErr(e instanceof Error ? e.message : '보내지 못했어요 — 다시 시도해주세요');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} data-issue-report role="dialog" aria-label="불편 알리기"
         className={`${anchored === 'fab' ? 'fixed z-[70]' : 'absolute z-10'} w-[400px] max-w-[calc(100vw-32px)] rounded-2xl border border-x-border-strong bg-white px-5 pb-4 pt-[18px] text-left shadow-[0_8px_32px_rgba(0,0,0,0.18)]`}
         style={style}
         onDragOver={(e) => e.preventDefault()}
         onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) take(f); }}>
      <div className="flex items-center justify-between">
        <h2 className="text-content font-bold">불편 알리기</h2>
        <button type="button" onClick={close} aria-label="닫기" className="rounded-full p-1 text-x-secondary hover:bg-x-hover">✕</button>
      </div>
      <p className="mt-2.5 rounded-lg bg-x-surface px-2.5 py-2 text-ui leading-relaxed text-x-secondary">
        📍 <b className="font-semibold text-x-text">{locationLine(location)}</b>에서 보내요
      </p>
      <textarea ref={textRef} value={body} onChange={(e) => setBody(e.target.value)} maxLength={MAX_ISSUE_BODY}
                placeholder={'무엇이 불편했나요?\n예: 게시일을 바꿨는데 표에는 예전 날짜가 그대로예요'}
                className="mt-3 h-28 w-full resize-none rounded-[10px] border border-x-border-strong px-3 py-2.5 text-content leading-snug outline-none placeholder:text-x-muted focus:border-x-blue" />
      {file && preview ? (
        <div className="mt-2.5 flex items-center gap-2.5 rounded-[10px] border border-x-border p-2 text-ui">
          {/* eslint-disable-next-line @next/next/no-img-element -- 붙여 넣은 파일의 objectURL 미리보기 */}
          <img src={preview} alt="붙여 넣은 스크린샷" className="h-11 w-[72px] shrink-0 rounded-md object-cover" />
          스크린샷 1장
          <button type="button" onClick={() => { setFile(null); setPreview(null); }} className="ml-auto text-x-muted hover:text-x-secondary">✕ 빼기</button>
        </div>
      ) : (
        <button type="button" onClick={() => fileRef.current?.click()}
                className="mt-2.5 w-full rounded-[10px] border-[1.5px] border-dashed border-x-border-strong p-3 text-center text-ui leading-relaxed text-x-secondary hover:bg-x-hover">
          스크린샷 붙여넣기 (⌘V)
          <span className="block text-caption text-x-muted">⌘⇧⌃4로 찍으면 바로 붙여 넣을 수 있어요</span>
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; if (f) take(f); e.target.value = ''; }} />
      {err && <p role="alert" className="mt-2 text-ui text-red-600">{err}</p>}
      <div className="mt-3.5 flex justify-end gap-2">
        <button type="button" onClick={close} disabled={busy}
                className="h-8 rounded-full border border-x-border-strong bg-white px-3.5 text-ui font-bold hover:bg-x-hover disabled:opacity-50">취소</button>
        <button type="button" onClick={() => void send()} disabled={!body.trim() || busy}
                className="h-8 rounded-full bg-x-text px-3.5 text-ui font-bold text-white hover:bg-x-text/90 disabled:opacity-40">
          {busy ? '보내는 중…' : '보내기'}
        </button>
      </div>
    </div>
  );
}
