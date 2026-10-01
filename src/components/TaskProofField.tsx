'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadTaskProof, taskProofValidationError, downloadTaskProof, taskProofFilename } from '@/lib/taskProof';
import { ImageLightbox } from '@/components/ImageLightbox';
import { pasteBlockedByModal } from '@/components/pasteModalGuard';
import { FILE_BTN_PRIMARY, FILE_BTN_LIGHT, FILE_BTN_TRASH, TRASH_ICON_PATH } from '@/components/fileFieldButtons';

// RT 증빙 첨부 칸 — 붙여넣기가 주 경로다(스크린샷은 거의 항상 클립보드에 있다). 파일을 고르거나
// 붙여넣는 순간 바로 올라가고, 저장(부모의 onChange가 하는 PATCH 등 실제 반영)은 부모가 판단한다.
// 팝오버(게시 확인)와 정산 화면 양쪽에서 그대로 재사용한다(스펙 §8) — 두 화면 다 이 칸만 꽂으면 된다.
// 캠페인 v2 작업 패널의 게시된 RT도 이 칸을 쓴다(koo 10-01 proof-agreement-paste) — 거기서 '지우고 다시 올리기'는
// [바꾸기] 한 동작이다: 누르면 '교체 대기' 상자가 열리고, 그 상태에서만 붙여넣기(⌘V)·고르기를 받는다. 새 파일이 올라가
// 저장되는 순간 바뀌고, 그 전까지(실패 포함) 원래 증빙이 그대로 남는다. 옛 화면(PostedCell)도 같은 동작이다(화면마다 갈라지지 않게).
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
  // 업로드 완료·지우기 시. 저장(PATCH)까지 하는 부모는 그 결과(true/false)를 돌려준다 — false면 '원래 증빙 그대로'를
  // 알리고 교체 상자를 열어 둔다(다시 붙여넣을 수 있게). 아직 저장 전인 폼 값만 바꾸는 부모는 아무것도 돌려주지 않아도 된다.
  onChange: (path: string | null) => void | Promise<boolean>;
}) {
  // 미리보기는 "어느 경로의 것인지"를 함께 들고 있는다 — 부모(key 없이 쓴다)가 낙관 갱신으로 value를
  // 새 경로로 바꾸면 preview.path === value가 돼 미리보기가 그대로 이어지고, 실패로 롤백돼 value가
  // 옛 경로로 돌아가면 preview.path !== value가 돼 옛 이미지(signedUrl)로 정직하게 되돌아간다.
  const [preview, setPreview] = useState<{ path: string; url: string } | null>(null); // 방금 올린 파일 — 서명을 기다리지 않는다
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState(false);
  // 교체 대기·짧은 확인은 어느 작업 것인지 함께 든다 — key 없이 쓰는 부모가 다른 작업으로 바꿔 그려도 옛 작업의 상자가 남지 않게
  const [replacingFor, setReplacingFor] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ taskId: string; text: string } | null>(null);
  const replacing = replacingFor === taskId && !!value;   // 바꿀 것이 있을 때만 의미가 있다
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const replaceBoxRef = useRef<HTMLButtonElement | null>(null);
  const changeBtnRef = useRef<HTMLButtonElement | null>(null);

  // preview가 바뀌거나(새로 올려 교체) 컴포넌트가 사라질 때 이전 objectURL을 걷는다 — 누수 방지.
  // 만드는 자리(put)에서 직접 걷지 않고 여기 한 곳에서만 걷어 두 번 걷거나 빠뜨릴 일이 없게 한다:
  // preview가 바뀌면 React가 "이전 렌더의" 이 이펙트를 정리(cleanup)하면서 옛 objectURL을 걷고,
  // 그 후 새 값으로 이펙트가 다시 붙는다. 언마운트 때도 같은 cleanup이 마지막 값을 걷는다.
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview.url); };
  }, [preview]);

  // 짧은 확인('증빙을 바꿨어요')은 잠깐 보이고 사라진다
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const put = useCallback(async (file: File) => {
    if (busy) return; // 업로드 중 다시 눌리는 것(붙여넣기 연타 등)에 대한 방어 — disabled 속성과 별개로 한 번 더 막는다
    const v = taskProofValidationError(file);
    if (v) { setErr(v); return; }
    const isReplace = !!value;   // 이미 있는 증빙을 바꾸는 중 — 실패해도 원래 증빙이 남는다는 것을 말해 준다
    setErr(''); setFlash(null);
    setBusy(true);
    try {
      const path = await uploadTaskProof(taskId, file);
      setPreview({ path, url: URL.createObjectURL(file) });
      // 저장까지 기다린다 — 그동안 상자는 '올리는 중…'(버튼 비활성). 실패면 부모가 값을 되돌리고(미리보기도 위 규칙으로
      // 옛 이미지로 돌아간다) 여기선 이유를 적고 상자를 열어 둔다.
      const saved = await onChange(path);
      if (saved === false) {
        setErr(isReplace ? '바꾸지 못했어요 — 원래 증빙은 그대로예요. 다시 붙여넣거나 골라 주세요' : '저장하지 못했어요 — 다시 시도해주세요');
        return;
      }
      setReplacingFor(null);
      if (isReplace) setFlash({ taskId, text: '증빙을 바꿨어요' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '올리지 못했어요 — 다시 시도해주세요';
      setErr(isReplace ? `${msg} · 원래 증빙은 그대로예요` : msg);
    } finally {
      setBusy(false);
    }
  }, [busy, value, taskId, onChange]);

  // 붙여넣기는 document에서 받는다. 상자에 포커스가 있을 때만 받게 만들었다가 실사용에서 실패했다(koo 확인):
  // <button>은 편집 요소가 아니라 브라우저가 paste 이벤트를 보내주지 않고, 상자를 누르면 파일 창이 열려
  // 포커스도 남지 않는다. 그래서 이 칸이 화면에 있는 동안 문서 붙여넣기를 듣되, 편집 칸(팝오버의 날짜·
  // 게시물 링크 등)으로 향한 붙여넣기는 건드리지 않는다 — 그 칸의 붙여넣기를 훔치면 안 된다.
  // 이미 증빙이 있는 칸에서는 평소엔 붙여넣기를 받지 않는다 — 엉뚱한 이미지 하나로 원래 증빙이 덮이면
  // 교체 이력이 없어 되찾을 수 없다. [바꾸기]로 교체 대기 상자를 연 동안에만 받는다(명시적으로 바꾸겠다고 한 뒤).
  // 다른 칸(동의서·결제 QR)도 문서 붙여넣기를 듣는다 — 받을 수 있는 상태일 때만 듣고, 먼저 받은 칸이
  // preventDefault한 붙여넣기는 건너뛰어(defaultPrevented) 한 이미지가 두 칸에 올라가지 않게 한다.
  useEffect(() => {
    if (disabled || (value && !replacing)) return;
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      // 이 칸 위에 다른 모달이 떠 있으면 그 모달 몫이다(pasteModalGuard 주석)
      if (pasteBlockedByModal(rootRef.current)) return;
      const file = Array.from(e.clipboardData?.files ?? [])[0];
      if (!file) return;   // 텍스트 붙여넣기는 그냥 흘려보낸다
      e.preventDefault();
      void put(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [disabled, value, replacing, put]);

  const cancelReplace = useCallback(() => {
    setReplacingFor(null); setErr('');
    // [바꾸기]는 상자가 닫힌 뒤에 다시 그려진다 — 다음 프레임에 포커스를 돌려준다(키보드 사용자가 제자리로)
    requestAnimationFrame(() => changeBtnRef.current?.focus());
  }, []);

  // 교체 대기 상자를 열면 상자로 포커스(Enter로 바로 고르기), Esc로 취소. Esc는 capture로 먼저 받아 패널까지 닫히지 않게
  // 막는다(패널은 document 버블에서 Esc를 듣는다 — ImageLightbox와 같은 방식). 위에 다른 모달(크게 보기 등)이 떠 있으면 그쪽 몫.
  useEffect(() => {
    if (!replacing) return;
    replaceBoxRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      if (pasteBlockedByModal(rootRef.current)) return;
      e.stopPropagation();          // 올리는 중에도 삼킨다 — 패널이 닫히면 올리던 것이 어디로 갔는지 안 보인다
      if (!busy) cancelReplace();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [replacing, busy, cancelReplace]);

  const shown = (preview && preview.path === value ? preview.url : null) ?? signedUrl;
  const blocked = disabled || busy;
  const startReplace = () => { setErr(''); setFlash(null); setReplacingFor(taskId); };
  const download = () => { if (value) void downloadTaskProof(value, taskProofFilename({ postedAt, influencerHandle, url: value })); };

  // 버튼 줄 — 크게 보기(주, 테두리) · 바꾸기 · 받기(보조, 옅은) · 지우기(휴지통). 교체 대기 중엔 [바꾸기]를 숨긴다(상자의 [취소]가 대신한다).
  const buttons = (canZoom: boolean) => (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {canZoom && <button type="button" onClick={() => setZoom(true)} className={FILE_BTN_PRIMARY}>크게 보기</button>}
      {!replacing && (
        <button ref={changeBtnRef} type="button" disabled={blocked} onClick={startReplace}
                title="새 스크린샷으로 바꿔요 — 다 올라가기 전까지 지금 증빙은 그대로예요" className={FILE_BTN_LIGHT}>바꾸기</button>
      )}
      {value && <button type="button" onClick={download} title="증빙 스크린샷 내려받기" className={FILE_BTN_LIGHT}>받기</button>}
      {canRemove && !replacing && (
        <button type="button" disabled={blocked} onClick={() => { setPreview(null); void onChange(null); }}
                aria-label="증빙 지우기" title="증빙 지우기" className={FILE_BTN_TRASH}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4">
            <path d={TRASH_ICON_PATH} />
          </svg>
        </button>
      )}
    </div>
  );

  return (
    <div ref={rootRef} className="mt-2">
      <p className="text-ui text-x-secondary">
        증빙 스크린샷 {required && <span className="text-red-600">필수</span>}
      </p>
      {shown ? (
        <div className="mt-1 flex items-center gap-3">
          {/* 썸네일도 눌러서 크게 본다 — 키보드는 옆의 [크게 보기]가 맡는다(같은 동작이 Tab에 두 번 걸리지 않게) */}
          <button type="button" tabIndex={-1} onClick={() => setZoom(true)} aria-hidden
                  className="h-16 w-16 shrink-0 cursor-zoom-in overflow-hidden rounded-md border border-x-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown} alt="" className="h-full w-full object-cover" />
          </button>
          {buttons(true)}
        </div>
      ) : value ? (
        // value(저장된 경로)는 있는데 보여줄 이미지가 아직(또는 영구히) 없는 상태 — 서명 URL이 늦거나
        // useSignedTaskProofUrls가 실패를 삼켜 조용히 비어 있을 수 있다. 이때 붙여넣기 상자를 그리면
        // "증빙이 없다"고 거짓말하는 셈이라(이 화면 바로 아래 캡션은 "있다"고 말한다), 있다는 사실을
        // 정직하게 말하고 바꾸기·받기만 계속 쓸 수 있게 둔다(받기는 value만 있으면 원본을 내려받는다).
        <div className="mt-1 flex items-center gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-x-border bg-x-surface text-center text-[11px] leading-tight text-x-muted">
            불러오는 중…
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-ui text-x-secondary">증빙 스크린샷이 있어요 — 미리보기를 불러오는 중이에요</p>
            {buttons(false)}
          </div>
        </div>
      ) : (
        // 붙여넣기는 위 이펙트가 문서에서 받는다(포커스와 무관) — 이 버튼은 파일 고르기 담당이다.
        // div+role="button"이 아니라 실제 <button>을 써서 Enter·스페이스로도 열리게 한다(이 저장소는
        // role="button"을 키보드 조작 없이 쓰지 않는다).
        <button type="button" disabled={blocked} onClick={() => inputRef.current?.click()}
                className="mt-1 block w-full rounded-lg border border-dashed border-x-border-strong px-3 py-4 text-center text-ui text-x-secondary hover:bg-x-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-blue disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? '올리는 중…' : '붙여넣기(⌘V) 또는 눌러서 파일 고르기'}
        </button>
      )}
      {replacing && (
        // 교체 대기 — '지금 붙여넣으면 바뀐다'가 보이게 파란 점선 상자. 상자 자체가 <button>(눌러서 고르기), 옆에 [취소].
        <div className="mt-2 flex items-stretch gap-2">
          <button ref={replaceBoxRef} type="button" disabled={blocked} onClick={() => inputRef.current?.click()}
                  className="min-w-0 flex-1 rounded-lg border-2 border-dashed border-x-blue bg-[#f0f8fe] px-3 py-3 text-center text-ui font-semibold text-x-blue-text hover:bg-[#e3f2fd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-x-blue focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-70">
            {busy ? '올리는 중…' : '새 스크린샷을 붙여넣기(⌘V) 또는 눌러서 고르기'}
            {!busy && <span className="mt-0.5 block text-[12px] font-normal text-x-secondary">다 올라가기 전까지 지금 증빙은 그대로예요 · Esc로 취소</span>}
          </button>
          <button type="button" disabled={busy} onClick={cancelReplace} className={`${FILE_BTN_LIGHT} self-center`}>취소</button>
        </div>
      )}
      {flash && flash.taskId === taskId && (
        <p role="status" className="mt-1 text-ui font-semibold text-green-700">✓ {flash.text}</p>
      )}
      {required && !value && (
        <p className="mt-1 text-ui text-x-muted">인플루언서 피드에서 RT가 보이는 화면을 찍어주세요 — 계정 이름과 RT 표시가 함께 보이면 좋아요</p>
      )}
      {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void put(f); }} />
      {zoom && shown && <ImageLightbox urls={[shown]} index={0} onIndexChange={() => {}} onClose={() => setZoom(false)} />}
    </div>
  );
}
