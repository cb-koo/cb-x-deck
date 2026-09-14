'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { formatKoCount } from '@/lib/formatKo';
import { relTime } from '@/lib/relTime';
import { isProfileStale, judgeContact, summarizeDraftStatuses } from '@/lib/influencerJudgment';
import type { TabKey } from '@/lib/profileTabs';
import { ProfileTabs } from './ProfileTabs';
import { AccountTab } from './AccountTab';
import { ContentTab } from './ContentTab';
import { DealTab } from './DealTab';
import { CampaignSection } from './CampaignSection';
import { PANEL } from './profileShared';
import type { InfluencerDetail } from '@/lib/influencerStore';

// 아바타 — 없으면 이니셜 원. 프로필 사진은 X CDN 원본이라 next/image 최적화 대상이 아니다.
export function Avatar({ url, name, size }: { url: string | null; name: string; size: number }) {
  const style = { width: size, height: size };
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- X CDN 원본 URL
      <img src={url} alt="" style={style} className="shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <span style={style} aria-hidden
          className="flex shrink-0 items-center justify-center rounded-full bg-x-border-strong font-bold text-white">
      <span style={{ fontSize: Math.round(size * 0.42) }}>{name.replace(/^@/, '').slice(0, 1).toUpperCase()}</span>
    </span>
  );
}

type Msg = { tone: 'ok' | 'warn' | 'err'; text: string };
const MSG_STYLE: Record<Msg['tone'], string> = {
  ok: 'bg-green-50 text-green-800',
  warn: 'bg-amber-50 text-amber-800',
  err: 'bg-red-50 text-red-700',
};

export function InfluencerProfile({ id, onChanged, onDeleted, tab, onTabChange }: {
  id: string;
  onChanged: () => Promise<void>;   // 명부(왼쪽) 새로고침 — 태그·마지막 기록이 바뀌면 목록도 같이 움직여야 한다
  onDeleted: () => void;
  // 탭 상태는 부모(page)가 URL에서 준다 — 화면이 아니라 주소가 단일 출처(스펙 §2)
  tab: TabKey;
  onTabChange: (t: TabKey) => void;
}) {
  const [data, setData] = useState<InfluencerDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  // 숨은 탭의 저장 실패를 탭 라벨에 표식으로(스펙 §3). 키 = '탭:출처'. 멤버십이 안 바뀌면 같은 Set을 돌려
  // 재렌더·effect 연쇄를 끊는다 — 없으면 useErrorReport → setState → 재렌더 → 새 콜백 … 무한 루프.
  const [errorKeys, setErrorKeys] = useState<Set<string>>(() => new Set());
  const reportError = useCallback((t: TabKey) => (source: string, hasError: boolean) => {
    const k = `${t}:${source}`;
    setErrorKeys((prev) => {
      if (prev.has(k) === hasError) return prev;
      const n = new Set(prev); if (hasError) n.add(k); else n.delete(k); return n;
    });
  }, []);
  const errorTabs = useMemo(() => new Set([...errorKeys].map((k) => k.split(':')[0] as TabKey)), [errorKeys]);

  // setState는 전부 await 뒤 — 동기 setState가 앞에 있으면 set-state-in-effect에 걸린다(GlobalShell 관례)
  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/influencers/${id}`);
      if (!r.ok) throw new Error(String(r.status));
      setData((await r.json()) as InfluencerDetail);
      setLoadErr(false);
    } catch {
      setLoadErr(true);
    } finally {
      setLoaded(true);
    }
  }, [id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(GlobalShell·clients 관례)
  useEffect(() => { load(); }, [load]);

  // 프로필 조회는 X API를 1회 부르는 비용 액션 — 자동으로 부르지 않고 버튼으로만 (AGENTS.md 원칙 6)
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setMsg(null);
    try {
      const r = await apiFetch(`/api/influencers/${id}/refresh`, { method: 'POST' });
      const body = (await r.json().catch(() => ({}))) as {
        status?: string; duplicateOf?: string | null; error?: string;
      };
      // 502(상류 조회 실패·X에 없는 핸들 포함)는 서버 문구를 그대로 쓴다 — 원인을 넘겨짚지 않는다
      if (!r.ok) { setMsg({ tone: 'err', text: body.error ?? `가져오지 못했어요 (오류 ${r.status})` }); return; }

      if (body.status === 'handle_taken') {
        setMsg({ tone: 'warn', text: '이 핸들은 현재 다른 계정이 쓰고 있어요 — 기존 정보는 남겨뒀어요' });
        return;
      }
      if (body.status === 'not_found') {
        setMsg({ tone: 'warn', text: 'X에서 이 핸들을 찾을 수 없어요 — 개명했다면 새 핸들로 추가하면 이 기록에 이어져요' });
        return;
      }
      setMsg(body.duplicateOf
        ? { tone: 'warn', text: `같은 계정이 @${body.duplicateOf}로도 등록돼 있어요 — 한쪽을 지워 정리할 수 있어요` }
        : { tone: 'ok', text: 'X에서 프로필을 새로 가져왔어요' });
      await load();
      await onChanged();
    } catch {
      setMsg({ tone: 'err', text: '가져오지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요' });
    } finally {
      setRefreshing(false);
    }
  }

  if (!loaded) return <p className="px-6 py-6 text-ui text-x-muted">불러오는 중…</p>;
  // 전체 오류 화면은 "한 번도 못 받아온" 경우에만 — 이미 좋은 데이터가 있는데 재조회만 실패했다면
  // 화면을 지우지 말고 얇은 안내띠로만 알린다(아래 loadErr strip).
  if (loadErr && !data) {
    return (
      <div className="px-6 py-6">
        <p className="mb-2 text-ui text-x-secondary" role="alert">프로필을 불러오지 못했습니다</p>
        <Button onClick={load}>다시 시도</Button>
      </div>
    );
  }
  if (!data) return null; // 위 분기가 모든 "data 없음"을 처리하므로 이론상 도달하지 않음 — 타입 좁히기용

  const inf = data.influencer;
  const unfetched = inf.profileRefreshedAt === null; // 아직 X에서 한 번도 프로필을 받아오지 않은 상태
  // 판단은 리스트와 같은 함수로 한 번만 — 프로필과 명부가 서로 다른 말을 하지 않게(라벨-값 일치)
  const contact = judgeContact(inf.lastContactAt, inf.createdAt);
  const draftLine = summarizeDraftStatuses(data.draftStatusCounts);
  const stale = isProfileStale(inf.profileRefreshedAt);

  return (
    // 연회색 바닥(page.tsx의 bg-x-surface) 위 흰 패널 — 패널 사이 간격은 이 space-y-5 하나가 단일 출처다.
    <div className="min-w-0 space-y-5 px-6 py-6">
      {/* 패널 1 = 누구인가(헤더) + 지금 어떤 상태인가(현황 스트립) + 방금 무슨 일이 있었나(알림띠).
          셋은 탭과 무관하게 이 사람 전체에 대한 말이라 한 장으로 묶는다. */}
      <div className={PANEL}>
        {loadErr && (
          <div role="alert" className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-ui text-red-700">
            <span>새로고침에 실패했어요 — 표시된 정보가 최신이 아닐 수 있어요</span>
            <Button variant="subtle" className="ml-auto shrink-0 bg-white" onClick={load}>다시 시도</Button>
          </div>
        )}
        <div className="flex items-start gap-3">
          <Avatar url={inf.avatarUrl} name={inf.displayName ?? inf.handle} size={48} />
          <div className="min-w-0 flex-1">
            <h1 className="min-w-0 truncate text-[20px] font-bold">{inf.displayName ?? `@${inf.handle}`}</h1>
            <p className="flex flex-wrap items-baseline gap-x-2 text-ui text-x-secondary">
              <a href={`https://x.com/${inf.handle}`} target="_blank" rel="noopener noreferrer"
                 className="text-x-blue-text hover:underline">@{inf.handle} ↗</a>
              {inf.followersCount !== null && <span>팔로워 {formatKoCount(inf.followersCount)}</span>}
              <span className="text-caption text-x-muted">
                {inf.profileRefreshedAt ? relTime(inf.profileRefreshedAt, '기준') : '프로필 미조회'}
              </span>
              {/* 갱신 넛지(스펙 §④) — 경고색을 쓰지 않는다. 비용 유발 액션(X 1회 조회)을 재촉하는 것처럼
                  읽히면 안 되고, 지금 보이는 값이 언제 것인지만 알려주면 된다. */}
              {stale && <span className="text-caption text-x-secondary">오래된 정보예요 — 갱신 권장</span>}
            </p>
            {inf.bio && <p className="mt-1 whitespace-pre-wrap text-ui leading-relaxed text-x-secondary">{inf.bio}</p>}
          </div>
          <div className="shrink-0 text-right">
            <Button variant={unfetched ? 'primary' : 'subtle'} onClick={refresh} disabled={refreshing}>
              {refreshing ? '가져오는 중…' : unfetched ? '프로필 가져오기' : '프로필 갱신'}
            </Button>
            <p className="mt-1 max-w-[180px] text-caption text-x-muted">
              누를 때만 X에 1번 물어 이름·프로필 사진·팔로워를 새로 받아와요.
            </p>
          </div>
        </div>

        {/* 현황 스트립(스펙 §①) — "이 사람 지금 어떤 상태인가"를 스크롤 없이 답한다.
            경고를 색으로만 전하지 않는다: 넘겼으면 '팔로업 필요'라는 말이 항상 함께 붙는다. */}
        <div className="mt-3">
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-ui ${
            contact.needsFollowup ? 'bg-red-50 font-medium text-red-700' : 'bg-x-surface text-x-secondary'
          }`}>
            {contact.label}{contact.needsFollowup && ' → 팔로업 필요'}
          </span>
          {/* 원고 상태 요약은 전체 카운트 기준 — '협업 콘텐츠' 탭의 목록(최근 50건)과 세는 범위가 다르다 */}
          {draftLine && <p className="mt-1 text-ui text-x-secondary">원고 {draftLine}</p>}
        </div>

        {/* 알림띠는 탭 바 위에 — 프로필 갱신 결과는 어느 탭을 보고 있든 이 사람 전체에 대한 말이다 */}
        {msg && <p role="alert" className={`mt-3 rounded-lg px-3 py-2 text-ui ${MSG_STYLE[msg.tone]}`}>{msg.text}</p>}
      </div>

      {/* 탭 바는 패널 밖 바닥 위 — 아래 패널들이 이 탭에 속한다는 걸 면 대신 위치로 말한다 */}
      <ProfileTabs active={tab} onChange={onTabChange}
                   badges={{ content: inf.draftCount }}
                   errorTabs={errorTabs}
                   panels={{
                     account: (
                       <AccountTab id={id} data={data} onChanged={onChanged} onDeleted={onDeleted}
                                   setData={setData} reportError={reportError('account')} />
                     ),
                     // 참여 캠페인이 넘긴 원고 위 — 캠페인은 넘긴 콘텐츠의 묶음이라 큰 단위부터(캠페인 스펙 §5).
                     // 패널 사이 간격은 ProfileTabs의 tabpanel space-y-5가 준다 — 여기서 따로 여백을 두지 않는다.
                     content: (
                       <>
                         <CampaignSection campaigns={data.campaigns} />
                         <ContentTab drafts={data.drafts} draftCount={inf.draftCount} />
                       </>
                     ),
                     deal: (
                       <DealTab id={id} data={data} onChanged={onChanged}
                                setData={setData} reportError={reportError('deal')} />
                     ),
                   }} />
    </div>
  );
}
