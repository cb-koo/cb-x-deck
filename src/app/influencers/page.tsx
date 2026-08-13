'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { formatCount } from '@/lib/format';
import { relTime } from '@/lib/relTime';
import { judgeContact } from '@/lib/influencerJudgment';
import { AddInfluencersDialog } from './AddInfluencersDialog';
import { Avatar, InfluencerProfile } from './InfluencerProfile';
import type { InfluencerRow } from '@/lib/influencerStore';

export default function InfluencersPage() {
  // useSearchParams는 Suspense 경계 필수 (clients/page.tsx·generate/page.tsx 선례)
  return <Suspense><InfluencersSplit /></Suspense>;
}

function InfluencersSplit() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlId = searchParams.get('i');

  const [rows, setRows] = useState<InfluencerRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // setState는 전부 await 뒤에 둔다 — 동기 setState를 앞에 넣으면 set-state-in-effect에 걸린다(GlobalShell 관례)
  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/influencers');
      if (!r.ok) throw new Error(String(r.status));
      setRows((await r.json()) as InfluencerRow[]);
      setLoadErr(false);
    } catch {
      setLoadErr(true); // 실패를 빈 상태로 위장하지 않는다 (clients 관례)
    } finally {
      setLoaded(true);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(GlobalShell·clients 관례)
  useEffect(() => { load(); }, [load]);

  const selected = rows.find((r) => r.id === urlId) ?? null;
  // 삭제된 인플루언서를 가리키는 링크 — 첫 번째로 슬쩍 바꿔치기하지 않고 정직하게 알린다.
  // (effect로 URL을 고치는 clients와 달리 렌더에서 파생만 하므로 setState-in-effect가 없다)
  const deadLink = loaded && !loadErr && !!urlId && !selected;

  const allTags = useMemo(
    () => [...new Set(rows.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, 'ko')),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tag && !r.tags.includes(tag)) return false;
      if (!needle) return true;
      return r.handle.toLowerCase().includes(needle)
        || (r.displayName ?? '').toLowerCase().includes(needle)
        || r.tags.some((t) => t.toLowerCase().includes(needle));
    });
  }, [rows, q, tag]);

  // 리스트의 모든 행이 같은 순간을 기준으로 판단하도록 한 번만 계산해 공유한다.
  const now = new Date();

  const select = useCallback((id: string) => {
    router.replace(`${pathname}?i=${id}`);
  }, [router, pathname]);

  // 삭제 후: 쿼리를 비워 "고르세요" 안내로 돌아간다
  function handleDeleted() {
    router.replace(pathname);
    load();
  }

  return (
    <div className="flex">
      <aside className="sticky top-0 max-h-screen w-[300px] shrink-0 self-start overflow-y-auto border-r border-x-border px-3 py-5">
        <div className="mb-1 flex items-center justify-between px-2">
          <h2 className="text-content font-bold">
            인플루언서 {rows.length > 0 && <span className="text-ui font-normal text-x-secondary">{rows.length}</span>}
          </h2>
          <button onClick={() => setAdding(true)} className="text-ui font-medium text-x-blue-text hover:underline">
            + 추가
          </button>
        </div>
        <p className="mb-3 px-2 text-caption text-x-muted">
          함께 일하는 계정을 모아두면 주고받은 이야기와 넘긴 원고를 한자리에서 볼 수 있어요.
        </p>

        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·핸들·태그로 찾기"
               aria-label="인플루언서 검색"
               className="mb-2 w-full rounded-lg border border-x-border-strong px-2.5 py-1.5 text-ui outline-none focus:border-x-blue" />

        {allTags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1 px-0.5">
            {allTags.map((t) => (
              <button key={t} onClick={() => setTag(tag === t ? null : t)}
                      aria-pressed={tag === t}
                      className={`rounded-full border px-2 py-0.5 text-caption transition-colors ${
                        tag === t
                          ? 'border-x-blue bg-x-blue/10 text-x-blue-text'
                          : 'border-x-border-strong text-x-secondary hover:bg-x-hover'
                      }`}>
                {t}
              </button>
            ))}
            {tag && (
              <button onClick={() => setTag(null)} className="px-1 text-caption text-x-muted hover:text-x-secondary">
                태그 해제
              </button>
            )}
          </div>
        )}

        {!loaded && <p className="px-2 py-4 text-ui text-x-muted">불러오는 중…</p>}
        {loaded && loadErr && (
          <div className="px-2 py-4">
            <p className="mb-2 text-ui text-x-secondary">명부를 불러오지 못했습니다</p>
            <Button onClick={load}>다시 시도</Button>
          </div>
        )}
        {loaded && !loadErr && rows.length > 0 && filtered.length === 0 && (
          <p className="px-2 py-4 text-ui text-x-muted">조건에 맞는 인플루언서가 없어요</p>
        )}
        {loaded && !loadErr && filtered.map((r) => (
          <RosterRow key={r.id} row={r} active={r.id === urlId} onSelect={() => select(r.id)} now={now} />
        ))}
      </aside>

      <main className="min-w-0 flex-1">
        {deadLink && (
          <p className="mx-6 mt-4 rounded-lg bg-x-surface px-3 py-2 text-ui text-x-secondary">
            링크가 가리키는 인플루언서를 찾을 수 없어요 — 명부에서 지워졌거나 링크가 잘못됐어요.
          </p>
        )}
        {loaded && !loadErr && rows.length === 0 && (
          <div className="px-6 py-16 text-center">
            <p className="mb-1 text-content font-bold">아직 등록된 인플루언서가 없어요 — 협업 중인 계정을 추가해 보세요</p>
            <p className="mb-4 text-ui text-x-secondary">
              @핸들이나 프로필 링크만 있으면 돼요. 이름·팔로워는 X에서 한 번 조회해 채워둘게요.
            </p>
            <Button variant="primary" onClick={() => setAdding(true)}>+ 인플루언서 추가</Button>
          </div>
        )}
        {loaded && !loadErr && rows.length > 0 && !selected && !deadLink && (
          <p className="px-6 py-16 text-center text-ui text-x-muted">
            왼쪽 명부에서 한 명을 고르면 프로필과 주고받은 기록이 여기 나와요.
          </p>
        )}
        {selected && (
          <InfluencerProfile key={selected.id} id={selected.id} onChanged={load} onDeleted={handleDeleted} />
        )}
      </main>

      {adding && (
        <AddInfluencersDialog
          onClose={() => setAdding(false)}
          onFinished={async (ids) => { await load(); if (ids[0]) select(ids[0]); }} />
      )}
    </div>
  );
}

// 명부 한 줄 — "누구인지(아바타·이름·핸들)"와 "지금 어떤 상태인지(마지막 기록·원고 수)"를 한눈에.
// 프로필을 아직 조회하지 않은 계정도 1급 시민이다: 이름 자리에 핸들을 세우고 미조회임을 메타에 적는다.
function RosterRow({ row, active, onSelect, now }: { row: InfluencerRow; active: boolean; onSelect: () => void; now: Date }) {
  const meta: string[] = [];
  if (row.followersCount !== null) meta.push(`팔로워 ${formatCount(row.followersCount)}`);
  else if (row.profileRefreshedAt === null) meta.push('프로필 미조회');
  meta.push(row.lastLogAt ? relTime(row.lastLogAt, '기록') : '기록 없음');
  if (row.draftCount > 0) meta.push(`원고 ${row.draftCount}`);
  // 프로필과 같은 판단 함수를 쓴다 — 명부와 프로필이 서로 다른 말을 하면 안 된다.
  // 점은 거들 뿐이고 뜻은 글자가 나른다(색·모양만으로 전달 금지).
  const { needsFollowup, daysSince } = judgeContact(row.lastContactAt, row.createdAt, now);

  return (
    <button onClick={onSelect}
            className={`mb-0.5 flex w-full gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
              active ? 'bg-[#e3f1fb]' : 'hover:bg-x-hover'
            }`}>
      <Avatar url={row.avatarUrl} name={row.displayName ?? row.handle} size={32} />
      <span className="min-w-0 flex-1">
        <span className={`flex items-baseline gap-1.5 text-ui font-semibold ${active ? 'text-x-blue-text' : ''}`}>
          <span className="min-w-0 truncate">{row.displayName ?? `@${row.handle}`}</span>
          {row.displayName && <span className="min-w-0 shrink truncate text-caption font-normal text-x-muted">@{row.handle}</span>}
        </span>
        <span className="block text-caption text-x-muted">
          {meta.join(' · ')}
          {needsFollowup && (
            <span className="ml-1.5 whitespace-nowrap font-medium text-red-600">
              <span aria-hidden>●</span>{' '}
              {daysSince !== null ? `연락 ${daysSince}일째 없음` : '연락 기록 없음'} — 팔로업 필요
            </span>
          )}
        </span>
        {row.tags.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {row.tags.map((t) => (
              <span key={t} className="rounded-full bg-x-border/50 px-1.5 py-0.5 text-caption text-x-secondary">{t}</span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}
