import { GlobalShell } from '@/components/GlobalShell';

export default function GenerateLayout({ children }: { children: React.ReactNode }) {
  return <GlobalShell>{children}</GlobalShell>;
}
