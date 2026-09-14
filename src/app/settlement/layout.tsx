'use client';
import { GlobalShell } from '@/components/GlobalShell';
import { ToastProvider } from '@/lib/toastContext';
// 토스트 프로바이더 필수 — 이 화면은 만들기·취소 결과를 토스트로만 알린다(campaigns/layout.tsx와 같은 이유)
export default function SettlementLayout({ children }: { children: React.ReactNode }) {
  return <GlobalShell><ToastProvider>{children}</ToastProvider></GlobalShell>;
}
