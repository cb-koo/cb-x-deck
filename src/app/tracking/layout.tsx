import { GlobalShell } from '@/components/GlobalShell';
import { ToastProvider } from '@/lib/toastContext';

// influencers/layout.tsx와 같은 셸 + ToastProvider.
// 프로바이더가 없으면 useToast는 no-op 기본값으로 조용히 삼켜진다(toastContext) — 이 페이지는
// '실행취소' 토스트로 추적 중단을 되돌리므로, 토스트가 안 뜨면 되돌릴 길이 사라진다.
export default function TrackingLayout({ children }: { children: React.ReactNode }) {
  return (
    <GlobalShell>
      <ToastProvider>{children}</ToastProvider>
    </GlobalShell>
  );
}
