'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { CampaignRow } from '@/lib/campaignStore';
import type { DraftRow } from '@/lib/draftStore';
import { fetchCandidateDrafts, bulkCampaignApi } from '@/lib/campaignApi';
import { draftLabel, searchDrafts } from '@/lib/draftViews';
import { variantLabel } from '@/lib/draftUi';
import { toggleId, siblingWarning } from '@/lib/draftSelection';
import { kstShort } from '@/lib/datetime';
import { Button } from '@/components/ui';

// [+ 원고 추가] → 분기(스펙 §4-1): 새로 만들기(/generate?campaign= — 클라 자동 선택·만든 원고 자동 소속)와
// 기존 원고 고르기(트래킹 '원고 연결' 모달 골격 — 검색 + 목록 + 체크). 후보 = 그 클라이언트의 캠페인 미소속 원고(§7).
// 넣기는 bulk PATCH 한 문장(50건 = 커넥션 1개). 예정일은 비워두고 표에서 채운다.
// 형제 시안(A/B/C)은 하나만 넣는 게 기본 — 전부 넣으면 비용이 중복 집계된다(도움말에 명시, 막지는 않는다).
export function AddDraftsModal({ campaign, onClose, onAdded }: {
  campaign: CampaignRow; onClose: () => void; onAdded: (count: number) => void;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // setState는 전부 await 뒤 — 동기 setState가 앞에 있으면 set-state-in-effect에 걸린다(InfluencerProfile.load 관례)
  const load = useCallback(async () => {
    const r = await fetchCandidateDrafts(campaign.id);
    if (r.ok) { setRows(r.data); setState('ready'); } else { setErr(r.error); setState('error'); }
  }, [campaign.id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(GlobalShell·clients 관례)
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const filtered = useMemo(() => searchDrafts(rows, query), [rows, query]);
  const ids = [...selected];

  async function submit() {
    if (ids.length === 0 || busy) return;
    // 형제 시안이 둘 이상 골라졌으면 한 번 더 묻는다 — 막지는 않는다(결정은 사람 몫, /generate 일괄 배정과 같은 태도)
    const siblings = siblingWarning(rows, selected);
    if (siblings >= 2 && !window.confirm(
      `같은 조건에서 나온 시안 ${siblings}개가 함께 선택돼 있어요.\n전부 넣으면 비용이 ${siblings}번 집계돼요. 그래도 넣을까요?`)) return;
    setBusy(true); setErr('');
    const r = await bulkCampaignApi(ids, campaign.id);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onAdded(ids.length);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div className="flex max-h-[80vh] w-full max-w-[560px] flex-col rounded-2xl bg-white p-4" role="dialog" aria-modal="true"
           aria-label="원고 추가" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="text-content font-bold">원고 추가 <span className="text-ui font-normal text-x-muted">— {campaign.name}</span></h2>
          <button onClick={onClose} disabled={busy} aria-label="닫기" className="ml-auto rounded px-1.5 text-x-secondary hover:bg-x-border disabled:opacity-40">✕</button>
        </div>

        {/* 분기 1 — 새로 만들기. 링크라 모달 상태와 무관하게 이동한다; 캠페인 화면으로 돌아오면 목록이 다시 로드된다 */}
        <Link href={`/generate?campaign=${campaign.id}`}
              className="mt-3 flex items-center justify-between rounded-xl border border-x-border-strong px-4 py-3 hover:bg-x-hover">
          <span>
            <span className="block text-content font-bold">새로 만들기 →</span>
            <span className="block text-ui text-x-muted">콘텐츠 생성으로 가요 — 클라이언트가 자동으로 잡히고, 거기서 만든 원고(생성·직접 쓰기)는 이 캠페인에 바로 들어와요</span>
          </span>
        </Link>

        <p className="mt-4 text-content font-bold">또는 기존 원고 고르기</p>
        <p className="text-ui text-x-muted">
          {campaign.clientName ?? '클라이언트 없음'}의 원고 중 아직 캠페인에 속하지 않은 것만 보여요.
          같은 조건의 시안(A/B/C)은 <b>하나만</b> 넣는 게 기본이에요 — 전부 넣으면 비용이 중복 집계돼요.
        </p>

        {state === 'loading' && <p className="py-6 text-center text-content text-x-muted">원고 목록 불러오는 중…</p>}
        {state === 'error' && (
          <p className="py-6 text-center text-content text-x-secondary">
            {err || '원고 목록을 불러오지 못했어요'}{' '}
            <button onClick={() => { setState('loading'); void load(); }} className="text-x-blue-text hover:underline">다시 시도</button>
          </p>
        )}
        {state === 'ready' && (
          <>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder="제목·내용·방향성으로 찾기" aria-label="원고 검색"
                   className="mt-2 h-10 w-full rounded-md border border-x-border-strong px-3 text-content outline-none focus:border-x-blue" />
            <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
              {rows.length === 0 && <p className="py-6 text-center text-content text-x-muted">넣을 수 있는 원고가 없어요 — 전부 이미 캠페인에 속해 있거나, 아직 만든 원고가 없어요.</p>}
              {rows.length > 0 && filtered.length === 0 && <p className="py-6 text-center text-content text-x-muted">검색과 일치하는 원고가 없어요</p>}
              {filtered.map((d) => {
                const on = selected.has(d.id);
                return (
                  <label key={d.id} className={`flex cursor-pointer items-start gap-2.5 rounded-md px-3 py-2 hover:bg-x-hover ${on ? 'bg-x-blue/5' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => setSelected((cur) => toggleId(cur, d.id))}
                           className="mt-1 h-4 w-4 cursor-pointer accent-x-blue" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-content">{draftLabel(d).text}</span>
                      {/* 보조줄: 생성일 · 배정 핸들 · 시안 라벨 — 동명 원고와 형제 시안을 사람이 가려볼 맥락 */}
                      <span className="block truncate text-ui text-x-muted">
                        {kstShort(d.createdAt)}
                        {d.influencerHandle ? ` · @${d.influencerHandle}` : ''}
                        {d.batchId !== null && d.variantIndex !== null ? ` · 시안 ${variantLabel(d.variantIndex)}` : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {err && <p role="alert" className="mt-2 text-ui text-red-600">{err}</p>}
            <div className="mt-3 flex items-center gap-3 border-t border-x-border pt-3">
              <span className="text-ui text-x-secondary">{ids.length > 0 ? `${ids.length}개 선택` : '넣을 원고를 골라 주세요'}</span>
              <Button type="button" variant="subtle" onClick={onClose} disabled={busy} className="ml-auto flex h-10 items-center text-x-secondary">취소</Button>
              <Button variant="primary" onClick={() => void submit()} disabled={ids.length === 0 || busy} className="h-10 px-4 text-content">
                {busy ? '넣는 중…' : ids.length === 0 ? '원고 넣기' : `${ids.length}개 넣기`}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
