import { GlobalShell } from '@/components/GlobalShell';
import { ToastProvider } from '@/lib/toastContext';

// 다른 최상위 화면(reports·tracking)과 같은 셸 + ToastProvider 관례 — 이게 없으면 왼쪽 메뉴 없이 화면만 뜬다(10-14 운영에서 발견).
export default function TrendsLayout({ children }: { children: React.ReactNode }) {
  return (
    <GlobalShell>
      <ToastProvider>{children}</ToastProvider>
    </GlobalShell>
  );
}
