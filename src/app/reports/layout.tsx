import { GlobalShell } from '@/components/GlobalShell';
import { ToastProvider } from '@/lib/toastContext';

// tracking/layout.tsx와 같은 셸 + ToastProvider 관례.
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <GlobalShell>
      <ToastProvider>{children}</ToastProvider>
    </GlobalShell>
  );
}
