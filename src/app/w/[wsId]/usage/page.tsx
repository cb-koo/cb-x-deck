import { redirect } from 'next/navigation';

// 사용량은 워크스페이스별 데이터가 아니다(전역 합산) — /usage로 이전됨 (표시 정확성 스펙 §A).
// 북마크·습관으로 남은 옛 주소를 새 위치로 보낸다.
export default function OldUsageRedirect() {
  redirect('/usage');
}
