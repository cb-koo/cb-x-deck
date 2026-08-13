import { draftLabel } from './draftViews.ts';

// 원고 링크 만들기 — 카드의 링크 복사 버튼과 표의 일괄 복사가 같은 규칙을 써야 한다.
// 두 벌로 두면 한쪽 주소 모양만 바뀌었을 때 조용히 갈라진다.

// 메신저에 붙였을 때 제목이 한 줄로 읽혀야 한다. 제목이 없는 원고는 라벨이 본문 첫 줄이라
// 200자짜리 일본어 문장이 그대로 올 수 있는데, 그러면 링크가 글 더미에 묻힌다.
export const SHARE_LABEL_MAX = 50;

export function draftShareUrl(origin: string, id: string): string {
  return `${origin}/generate?draft=${id}`;
}

type Labelable = Parameters<typeof draftLabel>[0];

/**
 * 고른 원고들을 "제목 줄 + 링크 줄"로 늘어놓는다. 사이는 빈 줄 — 슬랙·메신저에서 항목 경계가
 * 보이려면 줄바꿈 하나로는 부족하다(링크 미리보기가 붙으면 더 그렇다).
 *
 * 링크만 나열하지 않는 이유: 받는 사람이 열어보기 전에는 뭐가 뭔지 알 수 없다. 이름은 화면에서
 * 쓰는 라벨과 같은 것을 쓴다(draftLabel) — 보던 이름과 복사된 이름이 다르면 그게 더 헷갈린다.
 */
export function draftLinksText(rows: Array<Labelable & { id: string }>, origin: string): string {
  return rows
    .map((d) => {
      const label = draftLabel(d).text;
      const short = label.length > SHARE_LABEL_MAX ? `${label.slice(0, SHARE_LABEL_MAX)}…` : label;
      return `${short}\n${draftShareUrl(origin, d.id)}`;
    })
    .join('\n\n');
}
