// 표를 파일용 CSV로 직렬화(설계 2026-07-30 §F). 트윗 본문은 여러 줄이 흔해 줄바꿈을 그대로
// 담아야 하므로 RFC 4180 따옴표 감싸기를 쓴다.
import { cellExport, type TableColumn } from './tableColumns.ts';
import type { TableRow } from './types.ts';

// 엑셀은 BOM 없는 UTF-8 CSV를 깨서 읽는다. 본문이 대부분 일본어라 특히 중요하다.
export const CSV_BOM = '﻿';

// CSV 수식 주입 가드: 셀이 = + - @ 로 시작하면 엑셀/구글시트가 그 셀을 수식으로 계산한다 —
// RFC 4180 따옴표 감싸기는 이걸 막지 못한다(따옴표 안이어도 수식으로 읽힌다). '계정' 칸은 매 행이
// @로 시작하고 본문도 기호로 시작하는 경우가 흔해, 막지 않으면 #NAME? 등이 원문을 조용히 지운다.
// 관례대로 앞에 홑따옴표를 붙여 텍스트로 고정한다.
function guardFormula(v: string): string {
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}

// CSV 셀: 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 내부 따옴표를 두 번 쓴다(RFC 4180).
function csvCell(v: string): string {
  const g = guardFormula(v);
  return /[",\r\n]/.test(g) ? `"${g.replace(/"/g, '""')}"` : g;
}

export function toCsv(rows: TableRow[], cols: TableColumn[]): string {
  const lines = [cols.map((c) => csvCell(c.label)).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(cellExport(r, c))).join(','));
  return CSV_BOM + lines.join('\r\n');
}
