import { GlobalShell } from '@/components/GlobalShell';

export default function PromptLayout({ children }: { children: React.ReactNode }) {
  return <GlobalShell>{children}</GlobalShell>;
}
