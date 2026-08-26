import { GlobalShell } from '@/components/GlobalShell';

// tracking/layout.tsx와 같은 전역 셸(사이드바). ToastProvider는 두지 않는다 — 이 화면은 읽기 전용이라 토스트를 쓰지 않는다.
export default function PerformanceLayout({ children }: { children: React.ReactNode }) {
  return <GlobalShell>{children}</GlobalShell>;
}
