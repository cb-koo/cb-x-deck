'use client';
import { Button } from '@/components/ui';
import { formatFull } from '@/lib/format';
import { relTime } from '@/lib/relTime';
import { kstMonthDayKo } from '@/lib/datetime';
import { tweetPermalink } from '@/lib/tweetLink';
import type { TrackedPostRow } from '@/lib/trackingStore';
import type { PostMetrics } from '@/lib/postMetrics';

// 표는 숫자를 나란히 놓고 비교하는 화면이라 축약(23.7M)하지 않는다 — format.ts의 formatFull 주석 참조.
// 열 이름은 X 화면과 같은 말로 둔다: 'RT' 같은 줄임말 대신 우리 사용자가 X에서 보는 단어(리트윗).
const METRICS: Array<{ key: keyof PostMetrics; label: string }> = [
  { key: 'views', label: '조회' },
  { key: 'likes', label: '좋아요' },
  { key: 'retweets', label: '리트윗' },
  { key: 'replies', label: '답글' },
  { key: 'bookmarks', label: '북마크' },
  { key: 'quotes', label: '인용' },
];

export interface DraftOption { id: string; label: string }
export type DraftsState = 'idle' | 'loading' | 'ready' | 'error';

export function TrackingTable({
  rows, highlightId, refreshingIds,
  drafts, draftsState, onLoadDrafts,
  pickerFor, onOpenPicker, onLinkDraft,
  onRefresh, onRemove,
}: {
  rows: TrackedPostRow[];          // 이미 정렬(최신 등록순)·숨김 처리가 끝난 배열 — 여기서 순서를 바꾸지 않는다
  highlightId: string | null;      // 방금 등록/이미 추적 중이던 행 — 2초 강조(페이지가 타이머를 소유)
  refreshingIds: ReadonlySet<string>;
  drafts: DraftOption[];
  draftsState: DraftsState;
  onLoadDrafts: () => void;
  pickerFor: string | null;
  onOpenPicker: (id: string | null) => void;
  onLinkDraft: (row: TrackedPostRow, draftId: string | null) => void;
  onRefresh: (row: TrackedPostRow) => void;
  onRemove: (row: TrackedPostRow) => void;
}) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-ui">
        <thead>
          <tr className="border-b border-x-border text-left text-caption text-x-muted">
            <th className="px-3 py-2 font-normal">게시물</th>
            <th className="whitespace-nowrap px-3 py-2 font-normal">게시</th>
            {METRICS.map((m) => (
              <th key={m.key} className="whitespace-nowrap px-3 py-2 text-right font-normal">{m.label}</th>
            ))}
            <th className="whitespace-nowrap px-3 py-2 font-normal">측정</th>
            <th className="whitespace-nowrap px-3 py-2 font-normal">원고</th>
            <th className="whitespace-nowrap px-3 py-2 font-normal">동작</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const busy = refreshingIds.has(r.id);
            const gone = r.unavailableAt !== null;
            const line = (r.text.split('\n')[0] ?? '').trim();
            return (
              // id: 등록 직후 그 행으로 스크롤하기 위한 손잡이(페이지의 flash) — 행 자체는 클릭 대상이 아니다.
              // 이 표의 행에는 '열기'가 없다: 게시물은 X로, 원고는 연결 UI로 각각 자기 셀에서 간다.
              <tr key={r.id} id={`tracked-${r.id}`}
                  className={`border-b border-x-border transition-colors ${
                    r.id === highlightId ? 'bg-x-blue/10' : 'hover:bg-x-hover'
                  }`}>
                <td className="max-w-[320px] px-3 py-2">
                  <a href={tweetPermalink(r.authorHandle, r.tweetId)} target="_blank" rel="noreferrer"
                     className="block min-w-0 hover:underline">
                    <span className="block text-caption text-x-muted">
                      {r.authorHandle ? `@${r.authorHandle}` : '작성자 미확인'}
                    </span>
                    <span className="block truncate">{line || '(본문 없음)'}</span>
                  </a>
                  {/* 볼 수 없음은 색이 아니라 글자로 말한다 — 왜(삭제·비공개)와 언제 확인했는지까지 (I축) */}
                  {gone && (
                    <span className="mt-1 inline-block rounded-full bg-x-surface px-2 py-0.5 text-caption text-x-secondary">
                      볼 수 없음(삭제·비공개 등) · {kstMonthDayKo(r.unavailableAt)} 확인
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-caption text-x-muted">
                  {r.postedAt ? relTime(r.postedAt, '게시') : '–'}
                </td>
                {/* 볼 수 없는 게시물의 지표는 지우지 않고 마지막 측정값을 흐리게 남긴다 — 지운 값이 0으로 보이면 거짓말이 된다 */}
                {METRICS.map((m) => (
                  <td key={m.key}
                      className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${gone ? 'text-x-muted opacity-60' : 'text-x-text'}`}>
                    {formatFull(r.metrics?.[m.key] ?? null)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-caption text-x-muted">
                  {r.capturedAt ? relTime(r.capturedAt, '측정') : '–'}
                </td>
                <td className="px-3 py-2">
                  <DraftCell row={r} open={pickerFor === r.id} drafts={drafts} draftsState={draftsState}
                             onLoadDrafts={onLoadDrafts} onOpenPicker={onOpenPicker} onLinkDraft={onLinkDraft} />
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <div className="flex items-center gap-1">
                    <Button onClick={() => onRefresh(r)} disabled={busy} className="whitespace-nowrap"
                            title="지금 지표를 다시 가져와요 (API 호출 1회)">
                      {busy ? '가져오는 중…' : '새로고침'}
                    </Button>
                    <Button variant="ghost" onClick={() => onRemove(r)} className="whitespace-nowrap"
                            title="목록에서 빼고 쌓인 측정 기록도 지워요">
                      추적 중단
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 원고 연결 — 이 앱에서 '목록에서 하나 고르기'의 가장 단순한 관례는 select다(AddByLinkModal의 워크스페이스 칸).
// 목록은 열 때 처음 한 번만 불러온다(onLoadDrafts) — 표를 그릴 때마다 원고 전량을 받아오지 않기 위해서다.
function DraftCell({ row, open, drafts, draftsState, onLoadDrafts, onOpenPicker, onLinkDraft }: {
  row: TrackedPostRow; open: boolean;
  drafts: DraftOption[]; draftsState: DraftsState; onLoadDrafts: () => void;
  onOpenPicker: (id: string | null) => void;
  onLinkDraft: (row: TrackedPostRow, draftId: string | null) => void;
}) {
  if (open) {
    return (
      <div className="flex items-center gap-1.5">
        {/* idle도 '불러오는 중'으로 — 여는 순간 페이지가 조회를 시작하므로 사용자에게 둘은 같은 시점이다 */}
        {(draftsState === 'idle' || draftsState === 'loading') && (
          <span className="text-caption text-x-muted">원고 목록 불러오는 중…</span>
        )}
        {draftsState === 'error' && (
          <>
            <span className="text-caption text-red-600">원고 목록을 불러오지 못했어요</span>
            <button onClick={onLoadDrafts} className="text-caption text-x-blue-text hover:underline">다시 시도</button>
          </>
        )}
        {draftsState === 'ready' && (
          <select autoFocus value={row.draftId ?? ''}
                  onChange={(e) => onLinkDraft(row, e.target.value || null)}
                  aria-label="이 게시물의 원고 고르기"
                  className="max-w-[220px] rounded-md border border-x-border-strong bg-white px-2 py-1 text-ui outline-none focus:border-x-blue">
            <option value="">고르지 않음</option>
            {drafts.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        )}
        <button onClick={() => onOpenPicker(null)} className="text-caption text-x-muted hover:text-x-secondary">취소</button>
      </div>
    );
  }
  if (row.draftId) {
    return (
      <div className="flex items-center gap-1.5">
        <button onClick={() => onOpenPicker(row.id)} title="다른 원고로 바꾸기"
                className="max-w-[180px] truncate text-x-blue-text hover:underline">
          {row.draftLabel ?? '제목 없는 원고'}
        </button>
        <button onClick={() => onLinkDraft(row, null)} className="shrink-0 text-caption text-x-muted hover:text-x-secondary">
          해제
        </button>
      </div>
    );
  }
  // '연결 안 됨'은 상태라서 그것만으로는 눌러도 되는지 알 수 없다 — 상태(글자)와 행동(버튼)을 나눠 둔다
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-x-muted">연결 안 됨</span>
      <button onClick={() => onOpenPicker(row.id)} className="text-x-blue-text hover:underline">연결</button>
    </div>
  );
}
