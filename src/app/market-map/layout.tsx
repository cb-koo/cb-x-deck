import { GlobalShell } from '@/components/GlobalShell';
import { ToastProvider } from '@/lib/toastContext';

// 다른 최상위 화면(trends·reports)과 같은 셸 + ToastProvider 관례 — 이게 없으면 왼쪽 메뉴 없이 화면만 뜬다.
export default function MarketMapLayout({ children }: { children: React.ReactNode }) {
  return (
    <GlobalShell>
      <ToastProvider>{children}</ToastProvider>
    </GlobalShell>
  );
}
