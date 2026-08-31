'use client';
import { useEffect, useRef, useState } from 'react';
import { uploadTaskProof, taskProofValidationError, downloadTaskProof, taskProofFilename } from '@/lib/taskProof';
import { ImageLightbox } from '@/components/ImageLightbox';

// RT 증빙 첨부 칸 — 붙여넣기가 주 경로다(스크린샷은 거의 항상 클립보드에 있다). 파일을 고르거나
// 붙여넣는 순간 바로 올라가고, 저장(부모의 onChange가 하는 PATCH 등 실제 반영)은 부모가 판단한다.
// 팝오버(게시 확인)와 정산 화면 양쪽에서 그대로 재사용한다(스펙 §8) — 두 화면 다 이 칸만 꽂으면 된다.
export function TaskProofField({
  taskId, value, signedUrl, postedAt, influencerHandle, required, canRemove, disabled, onChange,
}: {
  taskId: string;
  value: string | null; // 저장된 스토리지 경로
  signedUrl: string | null; // 부모가 useSignedTaskProofUrls로 배치 서명해 넘긴 표시용 URL(없으면 미리보기만)
  postedAt: string | null; // 파일명용
  influencerHandle: string | null; // 파일명용
  required: boolean; // true면 '필수' 표시 + 안내 문구
  canRemove: boolean; // false면 [지우기] 없음(게시됨인 RT — 비우지 못하고 바꾸기만)
  disabled: boolean;
  onChange: (path: string | null) => void; // 업로드 완료·지우기 시
}) {
  const [preview, setPreview] = useState<string | null>(null); // 방금 올린 파일의 objectURL — 서명을 기다리지 않는다
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // preview가 바뀌거나(새로 올려 교체) 컴포넌트가 사라질 때 이전 objectURL을 걷는다 — 누수 방지.
  // 만드는 자리(put)에서 직접 걷지 않고 여기 한 곳에서만 걷어 두 번 걷거나 빠뜨릴 일이 없게 한다:
  // preview가 바뀌면 React가 "이전 렌더의" 이 이펙트를 정리(cleanup)하면서 옛 objectURL을 걷고,
  // 그 후 새 값으로 이펙트가 다시 붙는다. 언마운트 때도 같은 cleanup이 마지막 값을 걷는다.
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  async function put(file: File) {
    if (busy) return; // 업로드 중 다시 눌리는 것(붙여넣기 연타 등)에 대한 방어 — disabled 속성과 별개로 한 번 더 막는다
    const v = taskProofValidationError(file);
    if (v) { setErr(v); return; }
    setErr('');
    setBusy(true);
    try {
      const path = await uploadTaskProof(taskId, file);
      setPreview(URL.createObjectURL(file));
      onChange(path);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '올리지 못했어요 — 다시 시도해주세요');
    } finally {
      setBusy(false);
    }
  }

  const shown = preview ?? signedUrl;
  const blocked = disabled || busy;

  return (
    <div className="mt-2">
      <p className="text-ui text-x-secondary">
        증빙 스크린샷 {required && <span className="text-red-600">필수</span>}
      </p>
      {shown ? (
        <div className="mt-1 flex items-start gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown} alt="증빙 스크린샷" onClick={() => setZoom(true)}
               className="h-16 w-16 shrink-0 cursor-zoom-in rounded-md border border-x-border object-cover" />
          <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-ui">
            <button type="button" onClick={() => setZoom(true)} className="text-x-blue-text hover:underline">크게 보기</button>
            <button type="button" disabled={blocked} onClick={() => inputRef.current?.click()}
                    className="text-x-blue-text hover:underline disabled:opacity-50">바꾸기</button>
            {canRemove && (
              <button type="button" disabled={blocked} onClick={() => { setPreview(null); onChange(null); }}
                      className="text-x-muted hover:text-red-600 hover:underline disabled:opacity-50">지우기</button>
            )}
            {value && (
              <button type="button"
                      onClick={() => void downloadTaskProof(value, taskProofFilename({ postedAt, influencerHandle, url: value }))}
                      className="text-x-blue-text hover:underline">받기</button>
            )}
          </div>
        </div>
      ) : (
        // 상자 자체가 버튼이다 — 포커스가 여기 있을 때만 붙여넣기(Ctrl+V)를 받는다. 문서 전역에 리스너를
        // 달면 다른 입력 칸의 붙여넣기를 훔치게 된다. div+role="button"이 아니라 실제 <button>을 써서
        // Enter·스페이스로도 파일 고르기가 열리게 한다(이 저장소는 role="button"을 키보드 조작 없이 쓰지 않는다).
        <button type="button" disabled={blocked} onClick={() => inputRef.current?.click()}
                onPaste={(e) => {
                  const file = Array.from(e.clipboardData.files)[0];
                  if (!file) return;
                  e.preventDefault();
                  void put(file);
                }}
                className="mt-1 block w-full rounded-lg border border-dashed border-x-border-strong px-3 py-4 text-center text-ui text-x-secondary hover:bg-x-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-blue disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? '올리는 중…' : '여기를 누르거나 Ctrl+V로 붙여넣기'}
        </button>
      )}
      {required && !shown && (
        <p className="mt-1 text-ui text-x-muted">인플루언서 피드에서 RT가 보이는 화면을 찍어주세요 — 계정 이름과 RT 표시가 함께 보이면 좋아요</p>
      )}
      {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void put(f); }} />
      {zoom && shown && <ImageLightbox urls={[shown]} index={0} onIndexChange={() => {}} onClose={() => setZoom(false)} />}
    </div>
  );
}
