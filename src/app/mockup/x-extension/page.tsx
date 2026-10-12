import { notFound } from 'next/navigation';
import MockupApp from './MockupApp';
import './mockup.css';
export const metadata = { title: '방문협찬 업무 목업 · cb-x-deck' };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Keep this isolated sample UI out of production, even if the branch is built.
  if (process.env.NODE_ENV !== 'development') notFound();
  const params = await searchParams;
  return (
    <MockupApp
      initialTask={typeof params.task === 'string' ? params.task : undefined}
      initialCampaign={typeof params.campaign === 'string' ? params.campaign : undefined}
      initialView={typeof params.view === 'string' ? params.view : undefined}
    />
  );
}
