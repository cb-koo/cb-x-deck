'use client';
import { Fragment, useEffect, useState } from 'react';
import { fetchExternalLog } from '@/lib/settlementApi';
import { kstDateTime } from '@/lib/datetime';
import { describeExternalCall, describeCaller, describeTarget, type ExternalLogRow } from '@/lib/externalLogCopy';

const TONE_CLASS: Record<'ok' | 'warn' | 'bad', string> = { ok: '', warn: 'text-amber-700', bad: 'text-red-700' };
const METHOD_TITLE: Record<string, string> = { GET: '가져가기', POST: '보내기' };

export function ExternalLogTab() {
  const [rows, setRows] = useState<ExternalLogRow[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);   // 펼친 행 id

  useEffect(() => { (async () => {
    const r = await fetchExternalLog();
    if (!r.ok) { setErr(r.error); return; }
    setRows(r.data.rows);
  })(); }, []);

  if (err) return <p role="alert" className="text-ui text-red-700">{err}</p>;
  if (!rows) return <p className="text-ui text-x-muted">불러오는 중…</p>;

  return (
    <section>
      <p className="text-ui text-x-muted">정산 프로덕트가 우리 서버를 호출한 기록이에요. &quot;보냈는데 안 보인다&quot;는 상황이 생기면 여기서 확인해요.</p>
      <p className="mt-1 text-ui text-x-muted">호출자는 프로그램 이름으로 추정한 값이에요 — <strong className="font-semibold">행을 누르면</strong> 호출 경로·IP·프로그램 이름 전문이 펼쳐져요.</p>
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
                          <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1.5">
                            <Item k="시각" v={`${new Date(row.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (UTC ${row.at})`} />
                            <Item k="호출" v={`${row.method} ${row.path}`} />
                            <Item k="쿼리" v={row.query ?? '—'} />
                            <Item k="대상 요청 번호" v={row.requestId ?? '—'} className="break-all" />
                            <Item k="보낸 상태값" v={row.sentStatus ?? '—'} />
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
