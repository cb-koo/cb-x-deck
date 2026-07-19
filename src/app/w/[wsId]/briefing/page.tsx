'use client';
import { useParams } from 'next/navigation';
import { BriefingSection } from '@/components/BriefingSection';

// 브리핑 전용 페이지 — 리서치(웹 발굴)와 분리된 주간 루틴 동선. 컬럼별 기간 종합 리포트 생성·열람.
export default function BriefingPage() {
  const { wsId } = useParams<{ wsId: string }>();
  return (
    <div className="h-full overflow-y-auto pb-24">
      <BriefingSection wsId={wsId} />
    </div>
  );
}
