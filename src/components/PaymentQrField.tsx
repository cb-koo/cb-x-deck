'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadPaymentQr, signPaymentQrUrl, paymentQrValidationError, ALLOWED_PAYMENT_QR_MIME } from '@/lib/paymentQr';
import { ImageLightbox } from '@/components/ImageLightbox';
import { pasteBlockedByModal } from '@/components/pasteModalGuard';

// PayPay 수취 QR 첨부 칸 — src/components/TaskProofField.tsx(RT 증빙)를 그대로 본떴다. 다른 점은
// influencerId를 쓰고 버킷이 payment-qr이라는 것, 그리고 값이 string(빈 문자열=없음)이라는 것뿐이다
// (TaskProofField는 string | null). 여기는 아직 저장 전인 폼 값(draft.qr)을 다루므로 부모가 서명
// URL을 배치로 내려주지 않는다 — 필드가 스스로 signPaymentQrUrl을 불러 미리보기를 만든다.
export function PaymentQrField({ influencerId, value, disabled, onChange }: {
  influencerId: string;
  value: string;                    // 저장소 경로. 빈 문자열 = 없음
  disabled?: boolean;
  onChange: (path: string) => void; // 업로드 완료 시 경로, 지우기 시 ''
}) {
  // 방금 올린 파일의 로컬 미리보기 — 서명을 기다리지 않고 바로 보여준다(TaskProofField와 같은 이유).
  const [preview, setPreview] = useState<{ path: string; url: string } | null>(null);
  // 이미 저장된 값(예: 수정 폼을 열었을 때의 m.qr)을 보여주기 위한 서명 URL.
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview.url); };
  }, [preview]);

  // value가 preview로 이미 설명되면(방금 올린 그 파일) 다시 서명할 필요 없다.
  useEffect(() => {
    if (!value || (preview && preview.path === value) || (signed && signed.path === value)) return;
    let cancelled = false;
    signPaymentQrUrl(value)
      .then((url) => { if (!cancelled) setSigned({ path: value, url }); })
      .catch(() => { if (!cancelled) setErr('미리보기를 불러오지 못했어요'); });
    return () => { cancelled = true; };
  }, [value, preview, signed]);

  const put = useCallback(async (file: File) => {
    if (busy) return;
    const v = paymentQrValidationError(file);
    if (v) { setErr(v); return; }
    setErr('');
    setBusy(true);
    try {
      const path = await uploadPaymentQr(influencerId, file);
      setPreview({ path, url: URL.createObjectURL(file) });
      onChange(path);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '올리지 못했어요 — 다시 시도해주세요');
    } finally {
      setBusy(false);
    }
  }, [busy, influencerId, onChange]);

  // 붙여넣기는 문서에서 받는다(TaskProofField와 같은 이유 — 버튼은 paste 이벤트를 못 받는다).
  // 값이 이미 있으면 받지 않는다 — 엉뚱한 이미지로 조용히 덮이면 안 된다. 교체는 [바꾸기]로만.
  useEffect(() => {
    if (disabled || value) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (pasteBlockedByModal(rootRef.current)) return;   // 위에 다른 모달이 떠 있으면 그 모달 몫(TaskProofField와 대칭)
      const file = Array.from(e.clipboardData?.files ?? [])[0];
      if (!file) return;
      e.preventDefault();
      void put(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [disabled, value, put]);

  const shown = (preview && preview.path === value ? preview.url : null) ?? (signed && signed.path === value ? signed.url : null);
  const blocked = !!disabled || busy;

  return (
    <div ref={rootRef} className="mt-1">
      {value ? (
        shown ? (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown} alt="QR 이미지" onClick={() => setZoom(true)}
                 className="h-[72px] w-[72px] shrink-0 cursor-zoom-in rounded-md border border-x-border bg-white object-contain" />
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-ui">
              <button type="button" onClick={() => setZoom(true)} className="text-x-blue-text hover:underline">크게 보기</button>
              <button type="button" disabled={blocked} onClick={() => inputRef.current?.click()}
                      className="text-x-blue-text hover:underline disabled:opacity-50">바꾸기</button>
              <button type="button" disabled={blocked} onClick={() => { setPreview(null); setSigned(null); onChange(''); }}
                      className="text-x-muted hover:text-red-600 hover:underline disabled:opacity-50">지우기</button>
              {busy && <span className="text-x-muted">올리는 중…</span>}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-md border border-x-border bg-x-surface text-center text-[11px] leading-tight text-x-muted">
              불러오는 중…
            </div>
            <button type="button" disabled={blocked} onClick={() => inputRef.current?.click()}
                    className="text-x-blue-text hover:underline disabled:opacity-50">바꾸기</button>
          </div>
        )
      ) : (
        <button type="button" disabled={blocked} onClick={() => inputRef.current?.click()}
                className="block w-full rounded-lg border border-dashed border-x-border-strong px-3 py-4 text-center text-ui text-x-secondary hover:bg-x-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-blue disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? '올리는 중…' : '붙여넣기(⌘V) 또는 눌러서 파일 고르기'}
        </button>
      )}
      {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
      <input ref={inputRef} type="file" accept={ALLOWED_PAYMENT_QR_MIME.join(',')} className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void put(f); }} />
      {zoom && shown && <ImageLightbox urls={[shown]} index={0} onIndexChange={() => {}} onClose={() => setZoom(false)} />}
    </div>
  );
}
