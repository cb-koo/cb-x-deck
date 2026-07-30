'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { Toast } from '@/components/Toast';
import { initialToastState, toastReducer, visibleToast, type ToastSpec } from './toastState';

export interface ShowToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  duration?: number | null;   // 기본 6000ms. null = 지속(자동 소멸 없음)
  dismissible?: boolean;      // 기본 true (✕ 노출)
}

interface ToastCtx {
  show: (message: string, opts?: ShowToastOptions) => void;
  hide: () => void;           // 지속 토스트를 내린다 (일시 토스트는 스스로 만료)
}

// 기본값 no-op — 프로바이더 밖(예: /debug 페이지)에서 카드가 렌더돼도 터지지 않는다. memberContext와 같은 방식.
const Ctx = createContext<ToastCtx>({ show: () => {}, hide: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(toastReducer, initialToastState);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, opts?: ShowToastOptions) => {
    const toast: ToastSpec = {
      message,
      actionLabel: opts?.actionLabel,
      onAction: opts?.onAction,
      dismissible: opts?.dismissible ?? true,
    };
    if (opts?.duration === null) { dispatch({ type: 'showPersistent', toast }); return; }
    if (timer.current) clearTimeout(timer.current);
    dispatch({ type: 'showTransient', toast });
    timer.current = setTimeout(() => dispatch({ type: 'expireTransient' }), opts?.duration ?? 6000);
  }, []);

  const hide = useCallback(() => dispatch({ type: 'hidePersistent' }), []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const value = useMemo(() => ({ show, hide }), [show, hide]);
  const visible = visibleToast(state);
  return (
    <Ctx.Provider value={value}>
      {children}
      {/* 화면 전체에서 토스트 호스트는 여기 하나뿐이다 — 겹침 방지 (설계 §D) */}
      {visible && (
        <Toast key={state.seq}
               message={visible.message}
               actionLabel={visible.actionLabel}
               onAction={visible.onAction}
               onDismiss={visible.dismissible ? () => dispatch({ type: 'dismissVisible' }) : undefined} />
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
