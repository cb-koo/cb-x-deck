import { Fragment } from 'react';

export interface MapTooltipData {
  title: string;
  lines: string[];
  status?: string;
  branch?: string;
}

// 병원·행정구역·역·CRM에서 받은 값은 모두 텍스트로 렌더링한다.
export function MapTooltipContent({ title, lines, status, branch }: MapTooltipData) {
  return <>
    {status && <>{status}<br /></>}
    <b>{title}</b>{branch ? ` · ${branch}` : ''}
    {lines.map((line, i) => <Fragment key={i}><br />{line}</Fragment>)}
  </>;
}
