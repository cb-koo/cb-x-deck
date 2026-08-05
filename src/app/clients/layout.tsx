import { GlobalShell } from '@/components/GlobalShell';

export default function ClientsLayout({ children }: { children: React.ReactNode }) {
  return <GlobalShell>{children}</GlobalShell>;
}
