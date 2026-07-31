'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { ColumnRow, SortDir, SortKey, TableRow } from '@/lib/types';
import { exportColumns, visibleColumns } from '@/lib/tableColumns';
import { toCsv } from '@/lib/tableExport';
import { TABLE_MAX, TABLE_PAGE } from '@/lib/tableLimits';
import { useToast } from '@/lib/toastContext';
import { Button } from './ui';
import { ColumnPicker } from './ColumnPicker';
import { FilterPanel } from './FilterPanel';
import { FilterChips } from './FilterChips';
import { TweetTable } from './TweetTable';
import { DownloadIcon } from './XIcons';
import { findConflicts } from '@/lib/collectionConflict';
import { csvFileName, isComplete, type FilterCondition } from '@/lib/tableFilter';

const MORE_KEY = 'table-show-more';   // 칸 더보기 상태 (개인 보기 취향이라 localStorage)

export function TweetTableView({ wsId, columns, columnsLoaded, columnsError, onRetryColumns }: {
  wsId: string;
  columns: ColumnRow[];
  columnsLoaded: boolean;   // 열 목록(/api/columns) 최초 조회가 끝났는지 — 끝나기 전엔 '아직 열이 없어요'를 보여주면 안 된다
  columnsError: boolean;    // 열 목록 조회가 실패했는지 — 실패를 빈 상태로 위장하지 않는다(설계 §G-2)
  onRetryColumns: () => void;
}) {
  const { show } = useToast();
  const [rows, setRows] = useState<TableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<SortKey>('views');
  const [dir, setDir] = useState<SortDir>('desc');
  const [columnIds, setColumnIds] = useState<string[]>([]);   // 빈 배열 = 전체
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const filterPanelRef = useRef<HTMLDetailsElement>(null);
  // 칩을 눌러 패널을 열 때 어느 조건에 초점을 줄지. n은 같은 칩을 두 번 눌러도 다시 초점이 가게 하는 카운터.
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // 워크스페이스 전체 수집 건수 — 필터·열 선택과 무관하다(A1). FilterRows의 "이미 모은 N건 중에서만
  // 걸러요"는 이 값을 써야 한다: total(아래)은 필터링 결과라 필터 후 12건을 "모은 건수"로 잘못 말하게 된다.
  const [workspaceTotal, setWorkspaceTotal] = useState(0);
  // counts 요청이 성공적으로 한 번이라도 끝났는지(A4) — 끝나기 전엔 counts에 없는 항목이
  // "정말 0건"인지 "아직 모름"인지 구분이 안 된다. 워크스페이스가 바뀌면 이전 값은 새 워크스페이스의
  // 열에 대해 무의미하므로 loadCounts 안에서 다시 false로 되돌린다.
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [loaded, setLoaded] = useState(false);   // 첫 로드 완료 — 로딩 중 빈 상태 문구를 막는다
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const reqIdRef = useRef(0);   // 응답 경합 가드 — 가장 최근 요청만 상태를 갱신한다
  const loadKeyRef = useRef<string | null>(null);   // conditions를 뺀 나머지가 마지막으로 즉시 조회를 일으켰을 때의 값

  // 표시용 파생값 — 저장된 columnIds에 지금 columns 목록에 없는 id가 섞여 있으면(워크스페이스 전환·
  // 다른 탭에서의 열 삭제로 URL의 ?view=table을 통해 컴포넌트가 유지된 채 넘어온 경우) 라벨은 '전체'인데
  // 쿼리는 없는 열을 요청해 결과가 비어버린다(라벨과 값이 어긋남). 이 파생값 하나로 라벨·쿼리·빈 상태 분기를 통일한다.
  const activeColumnIds = useMemo(
    () => columnIds.filter((id) => columns.some((c) => c.id === id)),
    [columnIds, columns],
  );

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
    if (activeColumnIds.length > 0) p.set('columnIds', activeColumnIds.join(','));
    // 미완성 조건(축만 고르고 값을 아직 안 넣은 상태)은 쿼리에 보내지 않는다 —
    // 결과가 0건으로 튀면 사용자는 자기가 뭘 잘못했다고 생각한다.
    const ready = conditions.filter(isComplete);
    if (ready.length > 0) p.set('filters', JSON.stringify(ready));
    return p.toString();
  }, [wsId, sort, dir, activeColumnIds, conditions]);

  const load = useCallback(async (append: boolean) => {
    const id = ++reqIdRef.current;   // 이 호출의 번호를 찍어두고, 응답이 오면 아직 최신인지 확인한다
    setBusy(true); setErr(false);
    try {
      const r = await apiFetch(`/api/tweet-table?${qs({
        offset: append ? String(rows.length) : '0',
        limit: String(TABLE_PAGE),
        ...(append ? { withCount: '0' } : {}),
      })}`);
      if (reqIdRef.current !== id) return;   // 그 사이 더 최신 요청이 시작됨 — 이 응답은 버린다(busy/loaded도 건드리지 않는다)
      if (!r.ok) { setErr(true); setBusy(false); setLoaded(true); return; }
      const d = await r.json() as { rows: TableRow[]; total?: number };
      if (reqIdRef.current !== id) return;   // json 파싱 중에도 최신 요청이 바뀔 수 있다
      setRows((cur) => (append ? [...cur, ...d.rows] : d.rows));
      if (d.total !== undefined) setTotal(d.total);   // 더보기 응답엔 없다 — 기존 값을 유지한다
      setBusy(false); setLoaded(true);
    } catch {
      // 폐기된 응답의 실패까지 busy를 풀면 아직 진행 중인 최신 요청의 버튼이 중간에 다시 눌리게 된다
      if (reqIdRef.current === id) { setErr(true); setBusy(false); setLoaded(true); }
    }
  }, [qs, rows.length]);

  // 정렬·필터가 바뀌면 처음부터 다시 — append=false. columnIds가 아니라 activeColumnIds를 봐야
  // 삭제된 열 id가 걸러진 것 자체(라벨 갱신)도 재조회를 유발한다. 조건이 바뀌어도 이어붙이지 않고
  // 처음부터 다시 불러온다(offset 0) — qs가 완성된 조건만 실어 보내므로 미완성 조건은 재조회를 유발하지 않는다.
  //
  // 단, conditions만 바뀐 경우(필터 값 타이핑)는 즉시 조회하지 않는다 — 숫자 축은 isComplete가
  // /^\d+$/라서 1 → 10 → 100이 매번 서로 다른 '완성된' 조건이 되고, 문자 축은 빈 값만 아니면 항상
  // 완성이라 글자 하나하나가 실 DB(싱가포르) 쿼리 + count(distinct)를 태운다(이 기능 자체가 페이지마다
  // 다시 세지 않으려고 만든 건데, 그 취지를 타이핑에서 다시 어기는 셈). wsId·sort·dir·activeColumnIds로
  // 만든 키가 지난번과 같으면(=conditions만 바뀜) 입력이 멈추고 나서(~400ms) 한 번만 부르고, 키가
  // 달라지면(워크스페이스·정렬·열 선택 변경, 최초 마운트 포함) 지연 없이 바로 부른다.
  useEffect(() => {
    const key = JSON.stringify({ wsId, sort, dir, activeColumnIds });
    const filterOnlyChange = loadKeyRef.current === key;
    loadKeyRef.current = key;

    if (filterOnlyChange) {
      const timer = setTimeout(() => { void load(false); }, 400);
      return () => clearTimeout(timer);   // 다음 키 입력이나 언마운트 시 대기 중인 조회를 취소한다
    }
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, sort, dir, activeColumnIds, conditions]);

  // 열별 건수는 워크스페이스가 바뀔 때만 — 조건·정렬이 바뀌어도 다시 부르지 않는다. 부가 정보라 실패해도 화면은 동작한다.
  // 호출 시작 시 countsLoaded를 false로 되돌린다 — 워크스페이스 전환 직후 아직 새 값이 안 왔는데
  // 이전 워크스페이스의 '로드됨' 상태가 남아 있으면 새 열들이 (아직 모르는 게 아니라) '진짜 0건'으로 보인다(A4).
  const loadCounts = useCallback(async () => {
    setCountsLoaded(false);
    try {
      const r = await apiFetch(`/api/tweet-table/counts?workspaceId=${wsId}`);
      if (!r.ok) return;
      const d = await r.json() as { counts: Array<{ columnId: string; n: number }>; total: number };
      setCounts(Object.fromEntries(d.counts.map((c) => [c.columnId, c.n])));
      setWorkspaceTotal(d.total);
      setCountsLoaded(true);
    } catch { /* 건수는 부가 정보 — 실패해도 화면은 동작한다 */ }
  }, [wsId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadCounts(); }, [wsId]);

  function onSort(k: SortKey) {
    if (k === sort) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSort(k); setDir('desc'); }   // 새 기준은 항상 많은순/최신순부터
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
      a.download = csvFileName({
        columnNames: activeColumnIds.map((id) => columns.find((c) => c.id === id)?.title ?? '').filter(Boolean),
        conditionCount: conditions.filter(isComplete).length,
        date: new Date().toISOString().slice(0, 10),
      });
      // Firefox·Safari는 문서에 붙지 않은 <a>의 클릭을 무시할 수 있다 — 붙였다 떼고,
      // revoke는 클릭 직후가 아니라 다음 틱에 한다(동기 revoke는 다운로드가 시작되기 전에 URL을 죽일 수 있다).
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      show(d.total > d.rows.length
        ? `상위 ${d.rows.length.toLocaleString('en-US')}줄만 저장했어요 — 위에서 열을 선택해 범위를 좁혀보세요`
        : `CSV ${d.rows.length.toLocaleString('en-US')}줄을 저장했어요`);
    } catch {
      show('CSV를 저장하지 못했어요 — 잠시 후 다시 시도해주세요');
    } finally { setBusy(false); }
  }

  // 칩 본문을 누르면 패널을 열고 그 조건으로 데려간다 — 어느 줄을 고치려 했는지 잃지 않게.
  function openCondition(id: string) {
    if (filterPanelRef.current) filterPanelRef.current.open = true;
    setFocusRequest((prev) => ({ id, n: (prev?.n ?? 0) + 1 }));
  }

  const cols = visibleColumns(showMore);
  // 표가 실제로 그려지는 상태인지 — 아래쪽의 스크롤 영역과 '더보기' 버튼이 이 값을 공유한다
  const showTable = loaded && !err && columnsLoaded && !columnsError && columns.length > 0 && rows.length > 0;
  // 패널(배지)과 칩 줄이 같은 경고를 봐야 한다 — 따로 계산하면 둘이 갈라질 수 있다.
  const conflicts = findConflicts(conditions.filter(isComplete), columns, activeColumnIds);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 열 선택(왼쪽) + 칸 더보기·CSV 저장(오른쪽, 구분선으로 분리) */}
      <div className="flex items-start justify-between gap-3 border-b border-x-border px-4 py-2">
        <div className="flex items-center gap-2">
          <ColumnPicker columns={columns} counts={counts} countsLoaded={countsLoaded}
                        selected={activeColumnIds} onChange={setColumnIds} />
          <FilterPanel conditions={conditions} onChange={setConditions}
                       conflicts={conflicts}
                       totalLabel={workspaceTotal.toLocaleString('en-US')}
                       countsLoaded={countsLoaded}
                       focusRequest={focusRequest}
                       panelRef={filterPanelRef} />
        </div>
        <div className="flex shrink-0 items-center gap-2 border-l border-x-border pl-3">
          <Button variant="ghost" onClick={toggleMore}
                  title={showMore ? '답글·인용·북마크·팔로워·저장·기준 칸을 접어요' : '답글·인용·북마크·팔로워·저장·기준 칸을 펼쳐요'}>
            {showMore ? '− 칸 접기' : '+ 칸 더보기'}
          </Button>
          {/* 칩과 같은 알약 모양이면 헷갈린다는 피드백 — 테두리는 남기되 모양(각진 사각)과 아이콘으로 구분한다 */}
          <button onClick={saveCsv} disabled={busy || total === 0}
                  title="조건에 맞는 전체를 CSV 파일로 저장해요"
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-x-border-strong bg-white px-3 py-1 text-ui transition-colors hover:bg-x-hover disabled:opacity-50">
            <DownloadIcon className="h-4 w-4" />
            {total > TABLE_MAX
              ? `CSV 저장 (상위 ${TABLE_MAX.toLocaleString('en-US')}건 / 전체 ${total.toLocaleString('en-US')}건)`
              : `CSV 저장 (전체 ${total.toLocaleString('en-US')}건)`}
          </button>
        </div>
      </div>

      <FilterChips conditions={conditions}
                   conflicts={conflicts}
                   columnNames={activeColumnIds.map((id) => columns.find((c) => c.id === id)?.title ?? '').filter(Boolean)}
                   onRemoveCondition={(id) => setConditions(conditions.filter((c) => c.id !== id))}
                   onClearColumns={() => setColumnIds([])}
                   onClearAll={() => { setColumnIds([]); setConditions([]); }}
                   onOpenCondition={openCondition} />

      {/* 지표 신선도 — '카드 보기에서'를 빼면 표 모드에 없는 버튼을 가리키는 죽은 안내가 된다(설계 §E) */}
      <p className="border-b border-x-border px-4 py-1 text-caption text-x-muted">
        지표는 각 글을 마지막으로 가져온 시점 기준이에요 — 카드 보기에서 열을 새로고침하면 갱신됩니다
      </p>

      {/* 가로·세로 스크롤을 담당하는 컨테이너는 이 하나뿐이다 — sticky thead는 이 div를 기준으로 고정된다.
          '더보기'는 표 스크롤과 무관하게 항상 보이도록 이 컨테이너 밖(아래)에 둔다.
          여백은 좌우(px)·아래(pb)에만 준다 — 위쪽에 pt를 주면 sticky top-0의 기준선이 padding box 상단이라
          스크롤이 시작되는 순간 그 여백만큼 머리글이 갑자기 튀어 오르는 것처럼 보인다. 좌우 여백은 세로 스크롤과
          무관하고, 가로로 스크롤해도 표 양 끝에 여백이 그대로 따라와 "가장자리에 딱 붙은" 느낌만 없앤다. */}
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {/* columnsLoaded가 끝나기 전엔 columns가 항상 []이라 '아직 열이 없어요'로 오판된다 —
            불러오는 중 상태와 합쳐서 로딩이 끝난 뒤에만 진짜 0건 갈래로 넘어가게 한다(설계 §G-2). */}
        {!loaded || !columnsLoaded ? (
          <p className="p-4 text-ui text-x-muted">불러오는 중…</p>
        ) : err ? (
          <p className="p-4 text-ui text-red-500">
            표를 불러오지 못했어요. <button onClick={() => void load(false)} className="underline">재시도</button>
          </p>
        ) : columnsError ? (
          // 열 목록 조회가 실패한 경우 — 에러를 '아직 열이 없어요'(빈 상태)로 위장하지 않는다.
          // 표 자체(트윗 행) 로딩과는 다른 요청이라 재시도도 별도로(열 목록만 다시 부른다) 건다.
          <p className="p-4 text-ui text-red-500">
            표를 불러오지 못했어요. <button onClick={onRetryColumns} className="underline">재시도</button>
          </p>
        ) : columns.length === 0 ? (
          <p className="p-4 text-ui text-x-muted">아직 열이 없어요 — 카드 보기에서 열을 만들어보세요</p>
        ) : rows.length === 0 && (activeColumnIds.length > 0 || conditions.some(isComplete)) ? (
          <p className="p-4 text-ui text-x-muted">
            조건에 맞는 글이 없어요 — <button onClick={() => { setColumnIds([]); setConditions([]); }} className="underline">필터 지우기</button>
          </p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-ui text-x-muted">아직 수집된 글이 없어요 — 카드 보기에서 열을 새로고침하면 여기에 모입니다</p>
        ) : (
          <TweetTable rows={rows} columns={cols} sort={sort} dir={dir} onSort={onSort} />
        )}
      </div>
      {showTable && rows.length < total && (
        <div className="border-t border-x-border p-4 text-center">
          <Button variant="subtle" onClick={() => void load(true)} disabled={busy}>
            {busy ? '불러오는 중…' : `더보기 (${rows.length.toLocaleString('en-US')} / ${total.toLocaleString('en-US')})`}
          </Button>
        </div>
      )}
    </div>
  );
}
