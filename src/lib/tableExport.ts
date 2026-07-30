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

// CSV 수식 주입 가드: 셀이 = + - @ 로 시작하면 엑셀/구글시트가 그 셀을 수식으로 계산한다 —
// RFC 4180 따옴표 감싸기는 이걸 막지 못한다(따옴표 안이어도 수식으로 읽힌다). '계정' 칸은 매 행이
// @로 시작하고 본문도 기호로 시작하는 경우가 흔해, 막지 않으면 #NAME? 등이 원문을 조용히 지운다.
// 관례대로 앞에 홑따옴표를 붙여 텍스트로 고정한다.
// TSV(toTsv)에는 이 가드를 넣지 않는다 — TSV는 노션 붙여넣기 경로이고 노션은 수식을 평가하지
// 않으므로, 가드를 넣으면 필요 없는 홑따옴표가 노션 셀에 그대로 붙어 원문이 바뀐다(설계 §F).
function guardFormula(v: string): string {
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}

// CSV 셀: 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 내부 따옴표를 두 번 쓴다(RFC 4180).
function csvCell(v: string): string {
  const g = guardFormula(v);
  return /[",\r\n]/.test(g) ? `"${g.replace(/"/g, '""')}"` : g;
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
