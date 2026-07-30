// 토스트 표시 규칙 (설계 2026-07-30 §D). React와 무관한 순수 전이 —
// Toast는 fixed bottom-6 left-1/2라 호스트가 둘이면 겹친다. 그래서 호스트는 하나이고,
// 여기서 "무엇을 보여줄지"를 정한다. 컴포넌트 테스트 하네스가 없어 이 규칙만 .ts로 뽑아 테스트한다.
export interface ToastSpec {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  dismissible: boolean;
}

export interface ToastState {
  transient: ToastSpec | null;    // 자동 소멸 — 복사 확인, 오류 안내
  persistent: ToastSpec | null;   // 자동 소멸 없음 — 보관함 실행취소
  seq: number;                    // 전이마다 증가 — <Toast> key로 써서 같은 문구도 다시 고지되게
}

export const initialToastState: ToastState = { transient: null, persistent: null, seq: 0 };

export type ToastAction =
  | { type: 'showTransient'; toast: ToastSpec }
  | { type: 'showPersistent'; toast: ToastSpec }
  | { type: 'expireTransient' }
  | { type: 'hidePersistent' }
  | { type: 'dismissVisible' };

export function toastReducer(state: ToastState, action: ToastAction): ToastState {
  const seq = state.seq + 1;
  switch (action.type) {
    case 'showTransient':   return { ...state, transient: action.toast, seq };
    case 'showPersistent':  return { ...state, persistent: action.toast, seq };
    case 'expireTransient': return { ...state, transient: null, seq };
    case 'hidePersistent':  return { ...state, persistent: null, seq };
    // ✕는 지금 보이는 것만 닫는다. 지속 토스트는 dismissible:false라 실질적으로 일시 토스트만 닫힌다.
    case 'dismissVisible':  return state.transient ? { ...state, transient: null, seq }
                                                  : { ...state, persistent: null, seq };
  }
}

// 일시 토스트가 지속 토스트를 가린다. 일시 토스트가 사라지면 아직 살아있는 지속 토스트가 다시 드러난다 —
// 이것이 실행취소 기회가 복사 토스트에 먹히지 않는 이유다.
export function visibleToast(state: ToastState): ToastSpec | null {
  return state.transient ?? state.persistent;
}
