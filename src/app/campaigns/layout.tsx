import { GlobalShell } from '@/components/GlobalShell';
import { ToastProvider } from '@/lib/toastContext';

// 프로바이더가 없으면 useToast는 no-op 기본값으로 조용히 삼켜진다(toastContext) — 이 화면은 저장 실패·무효 링크를
// 토스트로만 알리므로, 없으면 실패가 보이지 않는다(tracking/layout.tsx와 같은 이유).
export default function CampaignsLayout({ children }: { children: React.ReactNode }) {
  return (
    <GlobalShell>
      <ToastProvider>{children}</ToastProvider>
    </GlobalShell>
  );
}
