import { GlobalShell } from '@/components/GlobalShell';

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return <GlobalShell>{children}</GlobalShell>;
}
