'use client';
import { useRef, useState } from 'react';
import type { TaskAgreement, TaskAgreementInput } from '@/lib/taskAgreementGuard';
import { agreementLine } from '@/lib/taskAgreementGuard';
import { uploadTaskAgreement, openTaskAgreement, taskAgreementValidationError, TASK_AGREEMENT_ACCEPT } from '@/lib/taskAgreement';

// 방문협찬 협찬 동의서 칸(063, koo 09-29) — 작업 하나에 파일 하나. 없어도 아무것도 막지 않는다(결정 4): 없으면 '동의서 없음'을
// 알리고 [파일 첨부]만 둔다. 정산 검토 대기에도 🟡 '협찬 동의서가 없어요'가 뜨지만 요청은 만들 수 있다.
// 파일을 고르는 순간 바로 올라가고, 저장(PATCH)은 부모(onChange = actions.setAgreement)가 한다 — TaskProofField와 같은 나눔.
// PDF가 주라 미리보기 대신 파일명·올린 사람·날짜 한 줄로 알아보고, [보기]는 새 탭에서 연다.
// 붙여넣기·끌어다 놓기는 두지 않는다(브리프 — 동의서는 스크린샷이 아니라 받은 파일이다).
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
  const blocked = disabled || busy;
  const btn = 'text-ui hover:underline disabled:cursor-not-allowed disabled:text-x-muted disabled:no-underline';

  return (
    <div>
      {busy ? (
        <p className="text-content text-x-muted">올리는 중…</p>
      ) : value ? (
        <div className="flex items-center gap-3">
          {/* 올린 직후(낙관값)는 올린 사람 이름이 아직 비어 있다 — agreementLine이 빈 이름을 빼고 그린다 */}
          <p className="min-w-0 flex-1 truncate text-content" title={value.name}>{agreementLine(value)}</p>
          <span className="flex shrink-0 items-center gap-3">
            <button type="button" onClick={() => void view(value.url)} className={`${btn} text-x-blue-text`}>보기</button>
            {!disabled && <button type="button" onClick={pick} disabled={blocked} className={`${btn} text-x-secondary`}>바꾸기</button>}
            {!disabled && <button type="button" onClick={remove} disabled={blocked} className={`${btn} text-x-muted hover:text-red-600`}>지우기</button>}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className={`flex-1 text-content ${disabled ? 'text-x-muted' : 'text-amber-700'}`}>동의서 없음</p>
          {!disabled && (
            <button type="button" onClick={pick} disabled={blocked}
                    className="h-9 shrink-0 rounded-full border border-x-border-strong px-3.5 text-ui text-x-text hover:bg-x-hover disabled:cursor-not-allowed disabled:opacity-50">
              파일 첨부
            </button>
          )}
        </div>
      )}
      {/* 행동 전 기대(UX 원칙 2) — 어떤 파일을 받는지와 없어도 된다는 것, 한 줄로(koo 문구 규칙: 평소엔 짧게) */}
      {!value && !disabled && !busy && <p className="mt-1 text-ui text-x-muted">PDF·JPG·PNG, 10MB까지 · 없어도 정산은 돼요</p>}
      {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
      <input ref={inputRef} type="file" accept={TASK_AGREEMENT_ACCEPT} className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void put(f); }} />
    </div>
  );
}
