'use client';
import { Fragment, useEffect, useState } from 'react';
import { fetchExternalLog } from '@/lib/settlementApi';
import { kstDateTime } from '@/lib/datetime';
import { describeExternalCall, describeCaller, describeTarget, type ExternalLogRow } from '@/lib/externalLogCopy';

const TONE_CLASS: Record<'ok' | 'warn' | 'bad', string> = { ok: '', warn: 'text-amber-700', bad: 'text-red-700' };
const METHOD_TITLE: Record<string, string> = { GET: '가져가기', POST: '보내기' };
const SEL = 'rounded-lg border border-x-border bg-white px-2.5 py-1.5 text-ui';

type LogFilter = { method?: 'GET' | 'POST'; rejectedOnly?: boolean; request?: string };

// 본문은 원문 문자열이다(깨진 JSON도 그대로 저장한다) — 읽히면 줄을 맞추고, 아니면 원문 그대로 보여준다
function prettyBody(body: string): string {
  try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
}

export function ExternalLogTab({ focusRequestId }: { focusRequestId: string | null }) {
  const [rows, setRows] = useState<ExternalLogRow[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);   // 펼친 행 id
  const [f, setF] = useState<LogFilter>({ request: focusRequestId ?? undefined });

  useEffect(() => { (async () => {
    const r = await fetchExternalLog(f);
    if (!r.ok) { setErr(r.error); return; }
    setRows(r.data.rows);
  })(); }, [f]);

  if (err) return <p role="alert" className="text-ui text-red-700">{err}</p>;
  if (!rows) return <p className="text-ui text-x-muted">불러오는 중…</p>;

  return (
    <section>
      <p className="text-ui text-x-muted">정산 프로덕트가 우리 서버를 호출한 기록이에요. &quot;보냈는데 안 보인다&quot;는 상황이 생기면 여기서 확인해요.</p>
      <p className="mt-1 text-ui text-x-muted">호출자는 프로그램 이름으로 추정한 값이에요 — <strong className="font-semibold">행을 누르면</strong> 호출 경로·IP·프로그램 이름 전문이 펼쳐져요.</p>
      <p className="mt-1 text-ui text-x-muted">8/31 이전 호출은 기록 기능 배포 전이라 남아 있지 않아요.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className={SEL} value={f.method ?? ''} onChange={(e) => setF({ ...f, method: (e.target.value || undefined) as 'GET' | 'POST' | undefined })} aria-label="방식">
          <option value="">방식 전체</option>
          <option value="POST">상태 전송만</option>
          <option value="GET">가져가기만</option>
        </select>
        <label className="flex items-center gap-1 text-ui text-x-secondary">
          <input type="checkbox" checked={!!f.rejectedOnly} onChange={(e) => setF({ ...f, rejectedOnly: e.target.checked })} />
          거부된 것만
        </label>
        {f.request && <button type="button" className="text-ui underline" onClick={() => setF({ ...f, request: undefined })}>요청 하나만 보는 중 — 전체 보기</button>}
      </div>
      <h2 className="mt-4 text-[16px] font-semibold">호출 기록 {rows.length}</h2>
      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-x-border p-8 text-center text-ui text-x-muted">
          아직 정산 프로덕트가 호출한 기록이 없어요.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-ui">
            <thead className="text-left text-x-secondary">
              <tr>
                <th className="w-6 py-2 pr-2"><span className="sr-only">펼치기</span></th>
                <th className="py-2 pr-3">시각</th>
                <th className="py-2 pr-3">방식</th>
                <th className="py-2 pr-3">호출자</th>
                <th className="py-2 pr-3">내용</th>
                <th className="py-2 pr-3">대상 요청</th>
                <th className="py-2 pr-3">응답</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isOpen = open === row.id;
                const d = describeExternalCall(row);
                const caller = describeCaller(row);
                const target = describeTarget(row);
                const detailId = `log-detail-${row.id}`;
                const toggle = () => setOpen(isOpen ? null : row.id);
                return (
                  <Fragment key={row.id}>
                    {/* 행 전체가 클릭 지점 — 시각 칸만 눌러야 펼쳐지는 건 직관적이지 않았다(koo 08-31).
                        키보드·스크린 리더용 조작 지점은 왼쪽 ▸ 버튼(aria-expanded/controls)이고, 마우스는 행 어디나 누르면 된다. */}
                    <tr onClick={toggle}
                        className={`border-t border-x-border cursor-pointer hover:bg-x-surface ${isOpen ? 'bg-x-surface' : ''}`}>
                      <td className="w-6 py-2 pr-2 align-middle">
                        <button type="button" aria-expanded={isOpen} aria-controls={detailId}
                                aria-label={isOpen ? '접기' : '자세히 보기'}
                                onClick={(e) => { e.stopPropagation(); toggle(); }}
                                className="text-x-muted hover:text-x-text">
                          <span aria-hidden className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                        </button>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{kstDateTime(row.at)}</td>
                      <td className="py-2 pr-3 text-x-secondary" title={METHOD_TITLE[row.method] ?? row.method}>{row.method}</td>
                      <td className={`py-2 pr-3 ${caller.kind === 'partner' ? '' : 'text-x-muted'}`}>{caller.label}</td>
                      <td className={`py-2 pr-3 ${TONE_CLASS[d.tone]}`}>{d.line}</td>
                      <td className={`py-2 pr-3 text-x-secondary ${target === '찾을 수 없는 요청' ? 'text-amber-700' : ''}`}>{target}</td>
                      <td className="py-2 pr-3 text-x-muted tabular-nums">{row.statusCode}</td>
                    </tr>
                    {isOpen && (
                      // 펼침 행에는 onClick을 두지 않는다 — 안의 요청 번호·User-Agent를 드래그해 복사할 때 접히면 안 된다
                      <tr id={detailId} className="border-t border-x-border bg-x-surface">
                        <td colSpan={7} className="p-4">
                          <dl className="grid grid-cols-[176px_1fr] gap-x-4 gap-y-1.5">
                            <Item k="시각" v={`${new Date(row.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (UTC ${row.at})`} />
                            <Item k="호출" v={`${row.method} ${row.path}`} />
                            <Item k="쿼리" v={row.query ?? '—'} />
                            <Item k="대상 요청 번호" v={row.requestId ?? '—'} className="break-all" />
                            <Item k="정산 프로덕트가 보낸 상태" v={row.sentStatus ?? '—'} />
                            <Item k="정산 프로덕트가 보낸 내용" v={row.body
                              ? <pre className="overflow-x-auto whitespace-pre-wrap break-all text-ui">{prettyBody(row.body)}</pre>
                              : '—'} />
                            <Item k="응답" v={`${row.statusCode} · ${row.outcome}`} />
                            <Item k="부가 정보" v={row.detail ?? '—'} />
                            <Item k="호출자 IP" v={row.ip ?? '—'} />
                            <Item k="프로그램(User-Agent)" v={row.userAgent ?? '—'} className="break-all" />
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Item({ k, v, className }: { k: string; v: React.ReactNode; className?: string }) {
  return (<><dt className="text-x-secondary">{k}</dt><dd className={`min-w-0 ${className ?? ''}`}>{v}</dd></>);
}
