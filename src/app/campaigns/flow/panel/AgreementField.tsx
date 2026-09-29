'use client';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { PanelSection } from './PanelSection';
import type { TaskAgreement, TaskAgreementInput } from '@/lib/taskAgreementGuard';
import { agreementMeta, agreementKind } from '@/lib/taskAgreementGuard';
import { uploadTaskAgreement, openTaskAgreement, taskAgreementValidationError, TASK_AGREEMENT_ACCEPT } from '@/lib/taskAgreement';

// 방문협찬 협찬 동의서 칸(063, koo 09-29) — 작업 하나에 파일 하나. 없어도 아무것도 막지 않는다(결정 4): 없으면 '동의서 없음'을
// 알리고 [파일 첨부]만 둔다. 정산 검토 대기에도 🟡 '협찬 동의서가 없어요'가 뜨지만 요청은 만들 수 있다.
// 파일을 고르는 순간 바로 올라가고, 저장(PATCH)은 부모(onChange = actions.setAgreement)가 한다 — TaskProofField와 같은 나눔.
// PDF가 주라 미리보기 대신 파일명·올린 사람·날짜 한 줄로 알아보고, [보기]는 새 탭에서 연다.
// 끌어다 놓기(koo 09-29): '협찬 동의서' 상자 전체가 놓는 자리 — 파일을 끌고 들어오면 상자가 파랗게 바뀌고 '여기에 놓으면 올려요'.
// 이미 동의서가 있으면 바꿀지 한 번 묻는다(잘못 끌어다 놓아 바뀌는 것을 막는다). 붙여넣기는 두지 않는다(받은 파일이지 스크린샷이 아니다).
// 이 칸이 상자(PanelSection)까지 그린다 — 놓는 자리가 상자 전체여야 하는데 상자는 부모 쪽에 있으면 이벤트를 받을 수 없다.
export function AgreementField({ taskId, value, disabled, onChange }: {
  taskId: string;
  value: TaskAgreement | null;
  disabled: boolean;   // 취소된 작업 — 값만 보여준다(거짓 어포던스 금지)
  onChange: (next: TaskAgreementInput | null) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

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
    <div className="relative" {...dropProps}>
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
                    className="h-8 rounded-full border border-x-border-strong bg-white px-3 text-ui font-semibold text-x-text hover:bg-x-hover">보기 ↗</button>
            {!disabled && (
              <button type="button" onClick={pick} disabled={blocked}
                      className="h-8 rounded-full px-3 text-ui text-x-secondary hover:bg-x-hover disabled:cursor-not-allowed disabled:opacity-50">바꾸기</button>
            )}
            {!disabled && (
              <button type="button" onClick={remove} disabled={blocked} aria-label="동의서 지우기" title="동의서 지우기"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-x-muted hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4">
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
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
            {!disabled && <span className="block text-ui text-x-muted">끌어다 놓거나 눌러서 올려요 · PDF·JPG·PNG, 10MB까지</span>}
          </span>
          {!disabled && (
            <button type="button" onClick={pick} disabled={blocked}
                    className="h-8 shrink-0 rounded-full border border-x-border-strong bg-white px-3 text-ui font-semibold text-x-text hover:bg-x-hover disabled:cursor-not-allowed disabled:opacity-50">
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
