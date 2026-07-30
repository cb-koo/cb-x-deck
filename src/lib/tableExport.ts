// 표를 붙여넣기용 TSV와 파일용 CSV로 직렬화. 두 형식의 차이는 셀 안 줄바꿈을 담을 수 있는지다 —
// 트윗 본문은 여러 줄이 흔하다(설계 2026-07-30 §F).
import { cellExport, type TableColumn } from './tableColumns.ts';
import type { TableRow } from './types.ts';

// 엑셀은 BOM 없는 UTF-8 CSV를 깨서 읽는다. 본문이 대부분 일본어라 특히 중요하다.
export const CSV_BOM = '﻿';

// TSV 셀: 탭·줄바꿈을 공백으로. 탭 구분 형식은 셀 안에 그 둘을 담을 방법이 없다 —
// 그대로 두면 행·칸 경계가 어긋나 붙여넣은 표가 밀린다.
function tsvCell(v: string): string {
  return v.replace(/[\t\r\n]+/g, ' ').trim();
}

// CSV 셀: 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 내부 따옴표를 두 번 쓴다(RFC 4180).
function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function serialize(
  rows: TableRow[], cols: TableColumn[],
  cell: (v: string) => string, sep: string, eol: string,
): string {
  const lines = [cols.map((c) => cell(c.label)).join(sep)];
  for (const r of rows) lines.push(cols.map((c) => cell(cellExport(r, c))).join(sep));
  return lines.join(eol);
}

export function toTsv(rows: TableRow[], cols: TableColumn[]): string {
  return serialize(rows, cols, tsvCell, '\t', '\n');
}

export function toCsv(rows: TableRow[], cols: TableColumn[]): string {
  return CSV_BOM + serialize(rows, cols, csvCell, ',', '\r\n');
}
