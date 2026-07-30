'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { ColumnRow, SortDir, SortKey, TableRow } from '@/lib/types';
import { exportColumns, visibleColumns } from '@/lib/tableColumns';
import { toCsv, toTsv } from '@/lib/tableExport';
import { TABLE_MAX, TABLE_PAGE } from '@/lib/tableLimits';
import { useToast } from '@/lib/toastContext';
import { Button } from './ui';
import { TweetTable } from './TweetTable';

const MORE_KEY = 'table-show-more';   // 칸 더보기 상태 (개인 보기 취향이라 localStorage)

export function TweetTableView({ wsId, columns }: { wsId: string; columns: ColumnRow[] }) {
  const { show } = useToast();
  const [rows, setRows] = useState<TableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<SortKey>('views');
  const [dir, setDir] = useState<SortDir>('desc');
  const [columnId, setColumnId] = useState<string | null>(null);   // null = 전체
  const [showMore, setShowMore] = useState(false);
  const [loaded, setLoaded] = useState(false);   // 첫 로드 완료 — 로딩 중 빈 상태 문구를 막는다
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { setShowMore(localStorage.getItem(MORE_KEY) === '1'); } catch { /* 접근 거부 시 기본값 */ }
  }, []);
  function toggleMore() {
    const next = !showMore;
    setShowMore(next);
    try { localStorage.setItem(MORE_KEY, next ? '1' : '0'); } catch { /* 저장 못 해도 화면은 동작 */ }
  }

  const qs = useCallback((extra: Record<string, string>) => {
    const p = new URLSearchParams({ workspaceId: wsId, sort, dir, ...extra });
    if (columnId) p.set('columnId', columnId);
    return p.toString();
  }, [wsId, sort, dir, columnId]);

  const load = useCallback(async (append: boolean) => {
    setBusy(true); setErr(false);
    try {
      const r = await apiFetch(`/api/tweet-table?${qs({ offset: append ? String(rows.length) : '0', limit: String(TABLE_PAGE) })}`);
      if (!r.ok) { setErr(true); return; }
      const d = await r.json() as { rows: TableRow[]; total: number };
      setRows((cur) => (append ? [...cur, ...d.rows] : d.rows));
      setTotal(d.total);
    } catch { setErr(true); } finally { setBusy(false); setLoaded(true); }
  }, [qs, rows.length]);

  // 정렬·필터가 바뀌면 처음부터 다시 — append=false
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(false); }, [wsId, sort, dir, columnId]);

  function onSort(k: SortKey) {
    if (k === sort) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSort(k); setDir('desc'); }   // 새 기준은 항상 많은순/최신순부터
  }

  async function copyTable() {
    const text = toTsv(rows, exportColumns(showMore));
    try {
      await navigator.clipboard.writeText(text);
      show(`표 ${rows.length.toLocaleString('en-US')}줄을 복사했어요`, { duration: 2500 });
    } catch {
      show('표를 복사하지 못했어요 — 브라우저 권한을 확인해 주세요');
    }
  }

  async function saveCsv() {
    setBusy(true);
    try {
      // 파일은 '이 데이터 전체'가 자연스러운 기대다(설계 §F) — 화면에 로드된 행이 아니라 전체를 다시 받는다.
      const r = await apiFetch(`/api/tweet-table?${qs({ offset: '0', limit: String(TABLE_MAX) })}`);
      if (!r.ok) { show('CSV를 저장하지 못했어요 — 잠시 후 다시 시도해주세요'); return; }
      const d = await r.json() as { rows: TableRow[]; total: number };
      const csv = toCsv(d.rows, exportColumns(showMore));
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `x-deck-table-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      show(d.total > d.rows.length
        ? `상위 ${d.rows.length.toLocaleString('en-US')}줄만 저장했어요 — 열 칩으로 범위를 좁혀보세요`
        : `CSV ${d.rows.length.toLocaleString('en-US')}줄을 저장했어요`);
    } catch {
      show('CSV를 저장하지 못했어요 — 잠시 후 다시 시도해주세요');
    } finally { setBusy(false); }
  }

  const chip = 'rounded-full border px-2 py-0.5 text-ui hover:bg-x-hover';
  const on = 'border-x-text font-bold text-x-text';
  const off = 'border-x-border-strong text-x-secondary';
  const cols = visibleColumns(showMore);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 열 칩 + 칸 더보기 + 내보내기 */}
      <div className="flex flex-wrap items-center gap-1 border-b border-x-border px-4 py-2">
        <span className="mr-1 text-caption text-x-muted">열</span>
        <button onClick={() => setColumnId(null)} aria-pressed={columnId === null} className={`${chip} ${columnId === null ? on : off}`}>전체</button>
        {columns.map((c) => (
          <button key={c.id} onClick={() => setColumnId(c.id)} aria-pressed={columnId === c.id} className={`${chip} ${columnId === c.id ? on : off}`}>
            {c.title}
          </button>
        ))}
        <Button variant="subtle" onClick={toggleMore} className="ml-auto"
                title={showMore ? '답글·인용·북마크·팔로워·저장·기준 칸을 접어요' : '답글·인용·북마크·팔로워·저장·기준 칸을 펼쳐요'}>
          {showMore ? '− 칸 접기' : '+ 칸 더보기'}
        </Button>
        <Button variant="subtle" onClick={copyTable} disabled={rows.length === 0}
                title="지금 표에 보이는 줄을 탭 구분으로 복사해요 — 노션·엑셀에 붙이면 칸이 갈라집니다">
          표 복사 ({rows.length.toLocaleString('en-US')}줄)
        </Button>
        <Button variant="subtle" onClick={saveCsv} disabled={busy || total === 0}
                title="조건에 맞는 전체를 CSV 파일로 저장해요">
          CSV 저장 (전체 {total.toLocaleString('en-US')}건)
        </Button>
      </div>

      {/* 지표 신선도 — '카드 보기에서'를 빼면 표 모드에 없는 버튼을 가리키는 죽은 안내가 된다(설계 §E) */}
      <p className="border-b border-x-border px-4 py-1 text-caption text-x-muted">
        지표는 각 글을 마지막으로 가져온 시점 기준이에요 — 카드 보기에서 열을 새로고침하면 갱신됩니다
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!loaded ? (
          <p className="p-4 text-ui text-x-muted">불러오는 중…</p>
        ) : err ? (
          <p className="p-4 text-ui text-red-500">
            표를 불러오지 못했어요. <button onClick={() => void load(false)} className="underline">재시도</button>
          </p>
        ) : columns.length === 0 ? (
          <p className="p-4 text-ui text-x-muted">아직 열이 없어요 — 카드 보기에서 열을 만들어보세요</p>
        ) : rows.length === 0 && columnId ? (
          <p className="p-4 text-ui text-x-muted">
            이 열에는 글이 없어요 — <button onClick={() => setColumnId(null)} className="underline">전체 보기</button>
          </p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-ui text-x-muted">아직 수집된 글이 없어요 — 카드 보기에서 열을 새로고침하면 여기에 모입니다</p>
        ) : (
          <>
            <TweetTable rows={rows} columns={cols} sort={sort} dir={dir} onSort={onSort} />
            {rows.length < total && (
              <div className="p-4 text-center">
                <Button variant="subtle" onClick={() => void load(true)} disabled={busy}>
                  {busy ? '불러오는 중…' : `더보기 (${rows.length.toLocaleString('en-US')} / ${total.toLocaleString('en-US')})`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
