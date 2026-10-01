'use client';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { PanelSection } from './PanelSection';
import type { TaskAgreement, TaskAgreementInput } from '@/lib/taskAgreementGuard';
import { agreementMeta, agreementKind } from '@/lib/taskAgreementGuard';
import { uploadTaskAgreement, openTaskAgreement, taskAgreementValidationError, agreementPasteName, TASK_AGREEMENT_ACCEPT } from '@/lib/taskAgreement';
import { kstToday } from '@/lib/datetime';
import { pasteBlockedByModal } from '@/components/pasteModalGuard';
import { FILE_BTN_PRIMARY, FILE_BTN_LIGHT, FILE_BTN_TRASH, TRASH_ICON_PATH } from '@/components/fileFieldButtons';

// 방문협찬 협찬 동의서 칸(063, koo 09-29) — 작업 하나에 파일 하나. 없어도 아무것도 막지 않는다(결정 4): 없으면 '동의서 없음'을
// 알리고 [파일 첨부]만 둔다. 정산 검토 대기에도 🟡 '협찬 동의서가 없어요'가 뜨지만 요청은 만들 수 있다.
// 파일을 고르는 순간 바로 올라가고, 저장(PATCH)은 부모(onChange = actions.setAgreement)가 한다 — TaskProofField와 같은 나눔.
// PDF가 주라 미리보기 대신 파일명·올린 사람·날짜 한 줄로 알아보고, [보기]는 새 탭에서 연다.
// 끌어다 놓기(koo 09-29): '협찬 동의서' 상자 전체가 놓는 자리 — 파일을 끌고 들어오면 상자가 파랗게 바뀌고 '여기에 놓으면 올려요'.
// 이미 동의서가 있으면 바꿀지 한 번 묻는다(잘못 끌어다 놓아 바뀌는 것을 막는다).
// 붙여넣기(koo 10-01): 동의서는 대부분 이미지(카톡·라인으로 받은 사진)라 ⌘V로도 받는다 — 이 칸이 화면에 있는 동안 문서 붙여넣기를 듣는다
// (TaskProofField와 같은 방식·같은 가드). 붙여 넣은 파일은 브라우저가 'image.png'로 이름을 줘서 '동의서_@핸들_YYYYMMDD'로 지어 올린다.
// 붙여넣기는 이미지(jpg·png)만 받는다 — PDF는 끌어다 놓거나 파일 고르기로. macOS Finder에서 PDF를 복사(⌘C)하면
// 클립보드에 진짜 파일이 아니라 아이콘 그림(image/png)만 오는 경우가 있어, 그걸 진짜 스크린샷인 양 받으면 안
// 열리는 '동의서.png'가 올라간다(리뷰 수정 2). 'Files' 종류와 함께 .pdf로 끝나는 파일 경로가 실려 있으면
// 그 신호로 보고 안내만 한다.
// 이 칸이 상자(PanelSection)까지 그린다 — 놓는 자리가 상자 전체여야 하는데 상자는 부모 쪽에 있으면 이벤트를 받을 수 없다.
export function AgreementField({ taskId, influencerHandle, value, disabled, onChange }: {
  taskId: string;
  influencerHandle: string | null;   // 붙여 넣은 파일의 이름용
  value: TaskAgreement | null;
  disabled: boolean;   // 취소된 작업 — 값만 보여준다(거짓 어포던스 금지)
  onChange: (next: TaskAgreementInput | null) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  async function put(file: File) {
    if (busy) return;
    const v = taskAgreementValidationError(file);
    if (v) { setErr(v); return; }
    setErr(''); setBusy(true);
    try {
      const input = await uploadTaskAgreement(taskId, file);
      await onChange(input);   // 실패하면 부모가 서버 문구를 토스트로 띄우고 값을 되돌린다
    } catch (e) {
      setErr(e instanceof Error ? e.message : '올리지 못했어요 — 다시 시도해주세요');
    } finally {
      setBusy(false);
    }
  }
  async function view(path: string) {
    setErr('');
    try { await openTaskAgreement(path); } catch (e) { setErr(e instanceof Error ? e.message : '파일을 열지 못했어요 — 다시 시도해주세요'); }
  }
  function remove() {
    if (!window.confirm('협찬 동의서를 뗄까요?\n\n다시 올리기 전까지 정산 검토에 "동의서 없음"으로 보여요.')) return;
    void onChange(null);
  }
  const pick = () => inputRef.current?.click();
  // 끌기 상태 — 자식 요소를 지날 때마다 enter/leave가 번갈아 와서 깜빡이지 않게 깊이로 센다(핸들러 안에서만 ref를 읽는다)
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  // 상자를 살짝 빗나가 놓으면 브라우저가 그 파일을 열어 화면을 떠난다(끌던 동의서·패널이 사라진다) — 이 칸이 떠 있는 동안
  // 상자 밖에 떨어진 파일은 무시한다. 상자 안은 위 onDrop이 먼저 처리한다(React 이벤트가 문서 리스너보다 앞선다).
  useEffect(() => {
    const block = (e: globalThis.DragEvent) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault(); };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => { window.removeEventListener('dragover', block); window.removeEventListener('drop', block); };
  }, []);
  const canDrop = !disabled && !busy;
  // 붙여넣기 — 받을 수 있을 때만 듣는다. 입력 칸·편집 영역(메모·원고 등)으로 향한 붙여넣기는 건드리지 않고, 위에 다른 모달이 떠 있으면
  // 그 모달 몫(pasteModalGuard). 다른 칸이 먼저 받은 붙여넣기(defaultPrevented)는 건너뛴다 — 한 이미지가 두 칸에 올라가지 않게.
  // put·value는 렌더마다 새로 잡히므로 ref로 최신 것을 읽는다(리스너를 매 렌더 붙였다 떼지 않게).
  const latest = useRef({ put, value, influencerHandle });
  useEffect(() => { latest.current = { put, value, influencerHandle }; });
  useEffect(() => {
    if (!canDrop) return;
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (pasteBlockedByModal(rootRef.current)) return;
      const dt = e.clipboardData;
      const file = Array.from(dt?.files ?? [])[0];
      if (!file) return;   // 텍스트 붙여넣기는 그냥 흘려보낸다
      // macOS Finder에서 PDF를 복사하면 진짜 파일 대신 아이콘 그림(image/png)이 오기도 한다 — 'Files' 종류와
      // 함께 .pdf로 끝나는 파일 경로(text/uri-list·text/plain)가 실려 있으면 그 신호로 보고 안내만 한다(리뷰 수정 2).
      const fileRef = (dt?.getData('text/uri-list') || dt?.getData('text/plain') || '').trim();
      const looksLikePdf = file.type === 'application/pdf' || (Array.from(dt?.types ?? []).includes('Files') && /\.pdf$/i.test(fileRef));
      if (looksLikePdf) {
        e.preventDefault();
        setErr('PDF는 끌어다 놓거나 눌러서 골라 주세요');
        return;
      }
      if (!file.type.startsWith('image/')) return;   // 이미지가 아니면 흘려보낸다(다른 칸 몫일 수 있다) — webp 등 허용 밖 이미지는 올려서 형식 안내를 보여준다
      e.preventDefault();
      const { put: upload, value: cur, influencerHandle: handle } = latest.current;
      if (cur && !window.confirm(`지금 동의서(${cur.name})를 새 이미지로 바꿀까요?`)) return;
      const named = taskAgreementValidationError(file) ? file : new File([file], agreementPasteName(handle, kstToday(), file.type), { type: file.type });
      void upload(named);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [canDrop]);
  const dropProps = canDrop ? {
    onDragEnter: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current += 1; setOver(true); },
    onDragOver: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
    onDragLeave: (e: DragEvent) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setOver(false); },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth.current = 0; setOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      if (files.length > 1) { setErr('동의서는 한 장만 올릴 수 있어요 — 파일 하나만 끌어다 놓아 주세요'); return; }
      if (value && !window.confirm(`지금 동의서(${value.name})를 새 파일로 바꿀까요?`)) return;
      void put(files[0]);
    },
  } : {};
  const blocked = disabled || busy;

  return (
    <div ref={rootRef} className="relative" {...dropProps}>
      <PanelSection title="협찬 동의서">
      {busy ? (
        <div className="flex h-[62px] items-center gap-3 rounded-lg border border-x-border bg-x-surface/60 px-3">
          <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-x-border-strong border-t-x-blue" />
          <span className="text-content text-x-secondary">올리는 중…</span>
        </div>
      ) : value ? (
        // 파일 카드(koo 09-29) — 형식 딱지 | 파일명(굵게) / 올린 사람·날짜·크기(회색 둘째 줄) | 버튼. 버튼은 모양으로 무게를 나눈다:
        // [보기]가 주 동작(테두리), [바꾸기]는 옅은 버튼, 지우기는 휴지통 아이콘(되돌릴 수 없는 쪽이라 가장 작게, 누르면 확인).
        <div className="flex items-center gap-3 rounded-lg border border-x-border bg-x-surface/60 px-3 py-2.5">
          <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-ui font-bold ${agreementKind(value.mime) === 'PDF' ? 'bg-red-50 text-red-600' : 'bg-x-blue/10 text-x-blue-text'}`}>
            {agreementKind(value.mime)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-content font-semibold" title={value.name}>{value.name}</span>
            <span className="block truncate text-ui text-x-muted">{agreementMeta(value)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => void view(value.url)}
                    className={FILE_BTN_PRIMARY}>보기 ↗</button>
            {!disabled && (
              <button type="button" onClick={pick} disabled={blocked}
                      className={FILE_BTN_LIGHT}>바꾸기</button>
            )}
            {!disabled && (
              <button type="button" onClick={remove} disabled={blocked} aria-label="동의서 지우기" title="동의서 지우기"
                      className={FILE_BTN_TRASH}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4">
                  <path d={TRASH_ICON_PATH} />
                </svg>
              </button>
            )}
          </span>
        </div>
      ) : (
        // 빈 상태도 같은 카드 자리·크기(점선) — 올리기 전·후가 같은 모양이라 어디에 무엇이 들어갈지 보인다. 점선 = 끌어다 놓는 자리.
        <div className={`flex items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 ${disabled ? 'border-x-border' : 'border-x-border-strong'}`}>
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-x-surface text-x-muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block text-content font-semibold ${disabled ? 'text-x-muted' : 'text-amber-700'}`}>
              동의서 없음{!disabled && <span className="font-normal text-x-muted"> · 없어도 정산은 돼요</span>}
            </span>
            {/* 행동 전 기대(UX 원칙 2) — 어떻게 올리는지·어떤 파일인지 */}
            {!disabled && (
              <>
                <span className="block text-ui text-x-secondary">이미지 붙여넣기(⌘V) · 끌어다 놓기 · 눌러서 고르기</span>
                <span className="block text-ui text-x-muted">PDF·JPG·PNG, 10MB까지</span>
              </>
            )}
          </span>
          {!disabled && (
            <button type="button" onClick={pick} disabled={blocked} className={FILE_BTN_PRIMARY}>
              파일 첨부
            </button>
          )}
        </div>
      )}
      {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
      <input ref={inputRef} type="file" accept={TASK_AGREEMENT_ACCEPT} className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void put(f); }} />
      </PanelSection>
      {over && (
        // 놓는 자리 표시 — 상자 전체를 덮는다(pointer-events-none: 표시가 drop 이벤트를 가로채지 않게)
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl border-2 border-dashed border-x-blue bg-[#f0f8fe] text-content font-semibold text-x-blue-text">
          여기에 놓으면 {value ? '새 파일로 바꿔요' : '올려요'}
        </div>
      )}
    </div>
  );
}
