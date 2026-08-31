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
      <p className="mt-1 text-ui text-x-muted">호출자는 프로그램 이름으로 추정한 값이에요 — 정확한 값은 행을 눌러 펼쳐서 확인해요.</p>
      <h2 className="mt-4 text-[16px] font-semibold">연동 기록 {rows.length}</h2>
      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-x-border p-8 text-center text-ui text-x-muted">
          아직 정산 프로덕트가 호출한 기록이 없어요.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-ui">
            <thead className="text-left text-x-secondary">
              <tr>
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
                return (
                  <Fragment key={row.id}>
                    <tr className="border-t border-x-border">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : row.id)} className="hover:underline">
                          {kstDateTime(row.at)}
                        </button>
                      </td>
                      <td className="py-2 pr-3 text-x-secondary" title={METHOD_TITLE[row.method] ?? row.method}>{row.method}</td>
                      <td className={`py-2 pr-3 ${caller.kind === 'partner' ? '' : 'text-x-muted'}`}>{caller.label}</td>
                      <td className={`py-2 pr-3 ${TONE_CLASS[d.tone]}`}>{d.line}</td>
                      <td className={`py-2 pr-3 text-x-secondary ${target === '찾을 수 없는 요청' ? 'text-amber-700' : ''}`}>{target}</td>
                      <td className="py-2 pr-3 text-x-muted tabular-nums">{row.statusCode}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-x-border bg-x-surface">
                        <td colSpan={6} className="p-4">
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
