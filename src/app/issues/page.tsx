// 이슈 — 불편 알리기로 보낸 것과 그 처리. 스펙 2026-10-22-issue-report-design.md §2-4, 시안 ⑤(koo 10-22)
// 행 하나 = 한 줄(koo 표 선호). 행을 누르면 오른쪽 상세 패널. 상태·해결 답은 처리 담당자(koo·태정님)만 바꾼다.
'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { PANEL_SPLIT, Button } from '@/components/ui';
import { HEAD, CELL } from '@/app/settlement/tableStyle';
import { relativeDay } from '@/lib/ownedChannels';
import {
  ISSUE_TABS, ISSUE_TAB_LABEL, ISSUE_STATUS_LABEL, hasUnseenReply, issueLabel,
  type IssueReport, type IssueTab,
} from '@/lib/issueReport';
import { IssueDetailPanel, ISSUE_STATUS_CHIP } from './IssueDetailPanel';

type Payload = {
  items: IssueReport[]; counts: Record<IssueTab, number>; unseen: number;
  tab: IssueTab; canHandle: boolean; memberId: string;
};

const EMPTY: Record<IssueTab, string> = {
  todo: '남은 이슈가 없어요',
  resolved: '아직 해결한 이슈가 없어요',
  mine: '보낸 이슈가 없어요. 화면 오른쪽 아래 둥근 버튼으로 보낼 수 있어요',
};

export default function IssuesPage() {
  // useSearchParams는 Suspense 경계 필수(settlement·clients 선례)
  return <Suspense fallback={null}><Issues /></Suspense>;
}

function Issues() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [tab, setTabState] = useState<IssueTab | null>(
    (ISSUE_TABS as readonly string[]).includes(urlTab ?? '') ? (urlTab as IssueTab) : null,   // null = 처음 열기(안 본 답이 있으면 '내가 보낸 것')
  );
  const [openId, setOpenId] = useState<string | null>(searchParams.get('id'));
  const [data, setData] = useState<Payload | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  // 오늘 기준 '(2일 전)' — 렌더마다 시계를 읽지 않는다(react-hooks/purity)
  const [now] = useState(() => Date.now());
  const firstLoad = useRef(true);

  // 주소는 네이티브 History API로만 바꾼다 — Next 라우터의 서버 왕복을 기다리지 않는다(settlement·campaigns/flow 관례)
  const writeUrl = useCallback((t: IssueTab | null, id: string | null) => {
    const p = new URLSearchParams();
    if (t && t !== 'todo') p.set('tab', t);
    if (id) p.set('id', id);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  }, [pathname]);

  const load = useCallback(async (t: IssueTab | null) => {
    try {
      const r = await apiFetch(`/api/issues?tab=${t ?? 'todo'}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as Payload;
      // 처음 열 때 안 본 답이 있으면 '내가 보낸 것'으로 — 답을 보러 온 사람이 탭을 찾지 않게(스펙 §2-4)
      if (t === null && firstLoad.current && j.unseen > 0) {
        firstLoad.current = false;
        setTabState('mine');
        return;
      }
      firstLoad.current = false;
      setData(j);
      setLoadErr(false);
    } catch {
      setLoadErr(true);   // 실패를 빈 목록으로 위장하지 않는다
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 탭이 바뀔 때 로드, setState는 전부 await 뒤(channels 관례)
  useEffect(() => { void load(tab); }, [load, tab]);
  useEffect(() => {
    const reload = () => void load(tab);
    window.addEventListener('cbx-issues-changed', reload);
    return () => window.removeEventListener('cbx-issues-changed', reload);
  }, [load, tab]);

  const shownTab: IssueTab = tab ?? 'todo';
  const pickTab = (t: IssueTab) => { setTabState(t); writeUrl(t, openId); };
  const open = (id: string | null) => { setOpenId(id); writeUrl(tab, id); };

  return (
    <main className="min-h-full bg-x-surface px-6 py-8">
      <div className="max-w-[1040px]">
        <h1 className="mb-1 text-[20px] font-bold">이슈</h1>
        <p className="mb-5 text-[14px] text-x-secondary">팀원이 보낸 불편과 처리 상황이에요. 화면 오른쪽 아래 둥근 버튼으로 보낼 수 있어요.</p>

        <div className="mb-3.5 flex gap-1.5" role="tablist">
          {ISSUE_TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={shownTab === t} onClick={() => pickTab(t)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-ui font-semibold ${shownTab === t ? 'border-x-text bg-x-text text-white' : 'border-x-border-strong bg-white text-x-secondary hover:bg-x-hover'}`}>
              {ISSUE_TAB_LABEL[t]}
              {data && <span className="font-normal opacity-80">{data.counts[t]}</span>}
            </button>
          ))}
        </div>

        {!data && !loadErr && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
        {loadErr && (
          <div className="py-8 text-center">
            <p className="mb-2 text-ui text-x-secondary">불러오지 못했어요</p>
            <Button onClick={() => { setLoadErr(false); void load(tab); }}>다시 시도</Button>
          </div>
        )}
        {data && !loadErr && (
          <section className={`${PANEL_SPLIT} overflow-hidden`}>
            {data.items.length === 0 ? (
              <p className="px-5 py-10 text-center text-ui text-x-muted">{EMPTY[data.tab]}</p>
            ) : (
              <table className="w-full table-fixed border-collapse">
                <colgroup><col className="w-[112px]" /><col className="w-[96px]" /><col /><col className="w-[150px]" /><col className="w-[110px]" /><col className="w-[130px]" /></colgroup>
                <thead>
                  <tr>
                    <th className={`${HEAD} pl-5`}>번호</th><th className={HEAD}>상태</th><th className={HEAD}>내용</th><th className={HEAD}>화면</th>
                    <th className={HEAD}>보낸 사람</th><th className={`${HEAD} pr-5`}>보낸 날</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((i) => {
                    const unseen = i.reporterId === data.memberId && hasUnseenReply(i);
                    return (
                      <tr key={i.id} onClick={() => open(i.id)} aria-selected={openId === i.id}
                          className={`cursor-pointer text-[14px] ${openId === i.id ? 'bg-[#f2f9fe]' : 'hover:bg-x-hover'}`}>
                        <td className={`${CELL} pl-5 tabular-nums text-x-secondary`}>{issueLabel(i.no)}</td>
                        <td className={CELL}>
                          <span className={`inline-block rounded-full px-2 py-0.5 text-ui ${ISSUE_STATUS_CHIP[i.status]}`}>{ISSUE_STATUS_LABEL[i.status]}</span>
                        </td>
                        <td className={`${CELL} truncate`}>
                          {unseen && <span className="mr-1.5 inline-block rounded-full bg-x-blue px-1.5 text-[11px] leading-4 text-white">새 답</span>}
                          {i.body.replace(/\s+/g, ' ')}
                        </td>
                        <td className={`${CELL} truncate text-x-muted`}>{i.location.screen}</td>
                        <td className={`${CELL} truncate`}>{i.reporterName}</td>
                        <td className={`${CELL} pr-5 text-x-muted`}>{relativeDay(i.createdAt, now)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>

      {openId && data && (
        <IssueDetailPanel key={openId} id={openId} canHandle={data.canHandle} memberId={data.memberId}
                          onClose={() => open(null)} />
      )}
    </main>
  );
}
