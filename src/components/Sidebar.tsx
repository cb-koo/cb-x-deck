'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useMember } from '@/lib/memberContext';
import { interceptNav } from '@/lib/navGuard';
import { createClient } from '@/lib/supabase/client';
import { apiFetch } from '@/lib/apiFetch';
import { IssueReport } from '@/components/IssueReport';
import { ColumnsIcon, DocIcon, FolderIcon, PenIcon, ClinicIcon, PromptIcon, UserIcon, ViewIcon, CampaignIcon, TrendIcon, MapPinIcon } from './XIcons';

// 리포트(막대 그래프) — 다른 XIcons는 채움(fill) 단일 path인데 막대 그래프는 선(stroke) 3개가
// 자연스러워 여기만 로컬로 둔다. props 시그니처는 XIcons의 다른 아이콘들과 동일.
const ReportIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
    <path d="M4 20V10M10 20V4M16 20v-7" strokeLinecap="round" /><path d="M3 20h18" strokeLinecap="round" />
  </svg>
);

// X 업로드 현황(달력에 체크) — ReportIcon과 같은 이유로 선(stroke) 아이콘이라 여기 둔다
const UploadCheckIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" strokeLinecap="round" />
    <path d="m9 14.5 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// SPA 이동 가드 — /clients 등이 등록한 편집 유실 방지(navGuard)에 걸리면 이동을 중단한다.
// <a> 시절엔 beforeunload가 잡았지만 Link(클라이언트 라우팅)는 우회하므로 onNavigate에 연결.
const guardedNavigate = (href: string) => (e: { preventDefault: () => void }) => {
  if (interceptNav(href)) e.preventDefault();
};

export function Sidebar({ wsId, wsError = false, onRetryWs }: {
  wsId: string | null; // null = 목록 실패(wsError=true) 또는 워크스페이스 0개 — 전역 메뉴만 렌더
  wsError?: boolean;
  onRetryWs?: () => void;
}) {
  const pathname = usePathname();
  const { member } = useMember();
  // '이슈' 옆 숫자 — 답이 달렸는데 아직 안 본 내 이슈 수(스펙 2026-10-22 §2-4). 화면을 옮길 때와 이슈가 바뀔 때 다시 센다.
  const [unseenIssues, setUnseenIssues] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => apiFetch('/api/issues/unseen').then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setUnseenIssues(j.unseen); }).catch(() => {});
    load();
    window.addEventListener('cbx-issues-changed', load);
    return () => { alive = false; window.removeEventListener('cbx-issues-changed', load); };
  }, [pathname]);
  // 로그아웃 — /denied와 동일 패턴. signOut 후 하드 이동. 편집 유실 가드는 못 태운다
  // (가드 모달의 '이동'이 인증된 상태를 전제) — 알려진 한계, 후속 과제.
  const signOut = async () => {
    await createClient().auth.signOut();
    window.location.href = '/login';
  };

  // 사이드바 묶음(koo 10-17): 시장 조사 → 캠페인 운영 → 설정 → 보관.
  // 위에서 아래로 '시장을 보고 → 캠페인을 돌리는' 순서로 읽힌다.

  // 시장 조사 — 검색 트렌드(일본 수요) + 클리닉 지도(병원 공급) + X 게시물(덱·브리핑·보관함)
  const marketNav = [
    // 검색 트렌드 — 일본에서 시술을 얼마나 찾는지(수요·트렌드)(스펙 2026-10-13 §5)
    { href: '/trends', label: '검색 트렌드', Ic: TrendIcon },
    // 클리닉 지도 — 어느 병원이 외국인 매출을 얼마나 내는지(공급)(스펙 2026-10-17 §2)
    { href: '/market-map', label: '클리닉 지도', Ic: MapPinIcon },
  ];

  // X 게시물 — 워크스페이스에 묶인 건 이 셋뿐이다(덱 칼럼·후보·브리핑·보관함). 워크스페이스 선택은 사이드바가 아니라
  // 이 화면들 맨 위(WorkspaceBar)에서 한다 — 사이드바 맨 위에 있을 땐 아래 메뉴 전체에 걸리는 것처럼 보였다(koo 10-17).
  // 캠페인·원고·인플루언서·정산은 워크스페이스를 쓰지 않는다(콘텐츠 생성이 레퍼런스를 고를 때만 보관함을 읽는다).
  // 링크는 마지막에 본 워크스페이스로 간다(GlobalShell이 정한 wsId).
  // '리서치'(키워드로 X 검색)는 지금 쓰지 않아 메뉴에서 숨겼다(koo 10-17) — 화면(/w/[wsId]/research)은 그대로 있다.
  const nav = wsId === null ? [] : [
    { href: `/w/${wsId}`, label: '덱', Ic: ColumnsIcon, tour: 'nav-deck' as string | undefined },
    { href: `/w/${wsId}/briefing`, label: '브리핑', Ic: DocIcon, tour: 'nav-briefing' },
    { href: `/w/${wsId}/library`, label: '보관함', Ic: FolderIcon, tour: undefined },
  ];

  // 캠페인 운영 — 워크스페이스 무관(스펙 §4 — 콘텐츠 생성은 /w/[wsId] 밖)
  // 캠페인이 맨 위 — 콘텐츠 생성·인플루언서·트래킹 셋을 묶는 상위 개념이다(캠페인 스펙 §3-1).
  // 인플루언서 명부도 워크스페이스 밖 — 원고를 누구에게 줄지는 워크스페이스와 무관한 사람 정보다(스펙 §3)
  const globalNav = [
    // 캠페인 v2(ADR 0003)가 '캠페인' 자리를 이어받았다(koo 09-27) — 주소는 /campaigns/flow 그대로, 옛 화면(/campaigns)은 아래 '보관'
    { href: '/campaigns/flow', label: '캠페인', Ic: CampaignIcon },
    // 정산은 캠페인 바로 아래 — 만든 것(작업) → 돈 보내는 것(요청) 순으로 읽힌다(정산 스펙 §4)
    { href: '/settlement', label: '정산', Ic: CampaignIcon },
    { href: '/generate', label: '콘텐츠 생성', Ic: PenIcon },
    { href: '/influencers', label: '인플루언서', Ic: UserIcon },
    // 인플루언서 성과 — 명부(한 명씩 관리)와 달리 여럿을 성과로 줄 세워 섭외할 인플을 고르는 곳(스펙 2026-09-30 §6)
    { href: '/influencers/performance', label: '인플루언서 성과', Ic: TrendIcon },
    // X 업로드 현황 — 우리가 운영을 맡은 클라이언트 X 계정이 약속한 주 N회를 지키는지(스펙 2026-10-20 §2-1)
    { href: '/channels', label: 'X 업로드 현황', Ic: UploadCheckIcon },
    // 트래킹도 워크스페이스 밖 — 게시된 게시물의 반응은 리서치 덱이 아니라 우리가 낸 원고에 딸린 결과다.
    // 인플루언서 다음: 원고를 누구에게 줬는지 → 그게 어떻게 됐는지 순서로 읽힌다.
    { href: '/tracking', label: '트래킹', Ic: ViewIcon },
    // 성과는 트래킹 다음 — 등록·갱신(작업)한 것이 어떤 결과를 냈는지(회고)로 읽힌다. B단계(퍼널 통합)의 자리.
    { href: '/performance', label: '콘텐츠 성과', Ic: TrendIcon },
    // 캠페인 성과 리포트 — 트래킹(개별 게시물) 다음, 전체 성과로 시야가 넓어지는 순서
    { href: '/reports', label: '리포트', Ic: ReportIcon },
  ];

  // 리포트 — 캠페인 운영 다음 묶음(koo 10-26). 월간 리포트는 별도 앱(monthly-report)이라 새 탭으로 연다.
  const reportNav = [
    { href: 'https://monthly-report-tan.vercel.app/', label: '월간 리포트', Ic: ReportIcon },
  ];

  // 설정 성격 화면(가끔 들어가 재료·규칙을 손보는 곳) — 매일 쓰는 작업 메뉴와 분리 (사이드바 개선 스펙)
  const settingsNav = [
    { href: '/clients', label: '클라이언트', Ic: ClinicIcon },
    // 빠른 메시지 — 익스텐션(X 대화창)에서 꺼내 쓰는 팀 공용 안내 문구. 클라이언트 설정처럼 가끔 손보는 재료라 설정 묶음.
    { href: '/quick-messages', label: '빠른 메시지', Ic: DocIcon },
    { href: '/prompt', label: '프롬프트', Ic: PromptIcon },
    // 워크스페이스 관리 — 가끔 들어가는 관리 화면이라 맨 위에서 설정으로 옮겼다(koo 10-17)
    { href: '/workspaces', label: '워크스페이스 관리', Ic: FolderIcon },
  ];

  // 보관 — 새 화면으로 대체돼 매일 쓰지 않지만 아직 지우지 않은 옛 화면(koo 09-27). 설정 아래, 맨 끝.
  const archivedNav = [
    { href: '/campaigns', label: '캠페인 (이전)', Ic: CampaignIcon },
  ];

  const link = (n: { href: string; label: string; Ic: (p: { className?: string }) => React.ReactNode; tour?: string }) => (
    <Link key={n.href} href={n.href} data-tour={n.tour} onNavigate={guardedNavigate(n.href)}
          aria-current={pathname === n.href ? 'page' : undefined}
          className={`flex items-center gap-2.5 rounded-full px-3 py-2 text-ui hover:bg-x-text/5 ${pathname === n.href ? 'font-bold text-x-text' : 'text-x-secondary'}`}>
      <n.Ic className="h-[18px] w-[18px]" />{n.label}
    </Link>
  );
  // 바깥 앱 링크 — 앱 안 이동이 아니라 새 탭(이동 가드·aria-current 불필요). ↗로 밖으로 나간다는 걸 미리 알린다.
  const externalLink = (n: { href: string; label: string; Ic: (p: { className?: string }) => React.ReactNode }) => (
    <a key={n.href} href={n.href} target="_blank" rel="noopener noreferrer"
       className="flex items-center gap-2.5 rounded-full px-3 py-2 text-ui text-x-secondary hover:bg-x-text/5">
      <n.Ic className="h-[18px] w-[18px]" />{n.label}
      <span aria-hidden className="text-caption text-x-muted">↗</span>
      <span className="sr-only">(새 탭)</span>
    </a>
  );
  const groupTitle = (t: string) => <p className="mb-1 px-1 text-caption text-x-muted">{t}</p>;
  const divider = <div className="my-2 border-t border-x-border" />;

  return (
    <aside data-tour="sidebar" className="flex h-screen w-52 shrink-0 flex-col border-r border-x-border bg-x-surface p-3">
      {/* 불편 알리기 둥근 버튼 — 화면 오른쪽 아래에 고정(fixed)으로 뜬다. 사이드바가 있는 모든 화면에 붙이려고 여기 둔다 */}
      <IssueReport />
      {/* 회사 로고 — clinicbridge.co.kr의 /images/cb-logo-black.svg를 줄여(svgo, 250KB → 4KB) 그대로 쓴다. 누르면 첫 화면 */}
      <Link href="/" onNavigate={guardedNavigate('/')} aria-label="Clinic Bridge 첫 화면" className="mb-4 mt-1 block px-1">
        <Image src="/brand/clinicbridge-logo.svg" alt="Clinic Bridge" width={130} height={28} priority className="h-[22px] w-auto" />
      </Link>
      <nav className="flex-1 overflow-y-auto">
        {groupTitle('시장 조사')}
        {marketNav.map(link)}
        {nav.map(link)}
        {wsId === null && (
          <div className="px-3 py-1.5">
            {wsError ? (
              <>
                <p className="text-caption text-x-secondary">덱 · 브리핑 · 보관함을 불러오지 못했어요</p>
                <button onClick={onRetryWs}
                        className="mt-1 rounded-full border border-x-border-strong bg-white px-2.5 py-0.5 text-caption hover:bg-x-hover">
                  다시 시도
                </button>
              </>
            ) : (
              <p className="text-caption text-x-secondary">덱 · 브리핑 · 보관함은 워크스페이스를 만들면 생겨요 — 설정의 워크스페이스 관리</p>
            )}
          </div>
        )}
        {divider}

        {groupTitle('캠페인 운영')}
        {globalNav.map(link)}
        {divider}

        {groupTitle('리포트')}
        {reportNav.map(externalLink)}
        {divider}

        {groupTitle('설정')}
        {settingsNav.map(link)}
        {divider}

        {groupTitle('보관')}
        {archivedNav.map(link)}
      </nav>

      <div className="mb-2 border-t border-x-border pt-2">
        {/* 업데이트 소식 — 가끔 들어와 읽는 곳이라 매일 쓰는 메뉴·설정과 분리해 하단에 (업데이트 피드 스펙 §4) */}
        <Link href="/updates" onNavigate={guardedNavigate('/updates')}
              aria-current={pathname === '/updates' ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-full px-3 py-1.5 text-caption hover:bg-x-text/5 ${pathname === '/updates' ? 'text-x-text' : 'text-x-muted'}`}>
          업데이트 소식
        </Link>
        {/* 불편 알리기로 보낸 것과 그 처리 — 보낸 것(오른쪽 아래 버튼)과 고친 것(업데이트 소식)이 한곳에 모이게 바로 아래(스펙 2026-10-22 §2-4) */}
        <Link href="/issues" onNavigate={guardedNavigate('/issues')}
              aria-current={pathname === '/issues' ? 'page' : undefined}
              className={`flex items-center justify-between gap-2.5 rounded-full px-3 py-1.5 text-caption hover:bg-x-text/5 ${pathname === '/issues' ? 'text-x-text' : 'text-x-muted'}`}>
          이슈
          {unseenIssues > 0 && (
            <span aria-label={`새 답 ${unseenIssues}건`} className="rounded-full bg-x-blue px-1.5 text-[11px] leading-4 text-white">{unseenIssues}</span>
          )}
        </Link>
        <Link href="/usage" onNavigate={guardedNavigate('/usage')}
              aria-current={pathname === '/usage' ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-full px-3 py-1.5 text-caption hover:bg-x-text/5 ${pathname === '/usage' ? 'text-x-text' : 'text-x-muted'}`}>
          API 사용량
        </Link>
      </div>

      <div className="border-t border-x-border pt-2">
        <p className="mb-1 px-1 text-caption text-x-muted">나</p>
        {member ? (
          <div className="flex items-center gap-2 px-1 py-1 text-sm">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: member.color }} />
            <span className="min-w-0 truncate">{member.name}</span>
            <button onClick={signOut} className="ml-auto shrink-0 px-1 py-1 -my-1 text-caption text-x-muted hover:text-x-secondary">로그아웃</button>
          </div>
        ) : (
          <p className="px-1 text-caption text-x-muted">불러오는 중…</p>
        )}
      </div>
    </aside>
  );
}
