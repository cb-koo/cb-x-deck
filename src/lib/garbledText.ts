// 깨진 글자(U+FFFD, �) 가드 — getxapi가 가끔 일본어 본문을 �로 깨뜨려 보낸다(10-06 확인: 운영 tracked_post 129개 중 7개).
// 같은 글을 다시 조회하면 정상으로 오기도 해서, 상세 조회는 깨졌으면 한 번만 더 부른다(스펙 2026-10-06-self-replies-design.md §10).
// 화면 번들에서도 쓸 수 있게 타입 import만 둔다.
import type { GetxapiClient, RawTweet } from './getxapi.ts';

export function hasReplacementChar(s: string | null | undefined): boolean {
  return typeof s === 'string' && s.includes('�');
}

// 리포스트 래퍼면 원본 본문을 본다(fetchPost가 원본으로 갈아타는 것과 같은 기준)
function bodyOf(raw: RawTweet): unknown {
  return ((raw.retweeted_tweet as RawTweet | undefined) ?? raw).text;
}

// 상세 조회 — 본문이 깨졌으면 한 번 더 부르고, 정상으로 왔을 때만 그걸 쓴다. 다시 조회가 실패·없음·또 깨짐이면
// 첫 응답 그대로(깨진 본문이라도 지표는 맞다 — 실패로 바꾸지 않는다). 첫 조회의 예외는 그대로 던진다(호출자 계약 유지).
export async function getTweetDetailUngarbled(
  client: Pick<GetxapiClient, 'getTweetDetail'>, tweetId: string,
): Promise<RawTweet | null> {
  const first = await client.getTweetDetail(tweetId);
  if (!first || !hasReplacementChar(bodyOf(first) as string)) return first;
  try {
    const again = await client.getTweetDetail(tweetId);
    if (again && typeof bodyOf(again) === 'string' && !hasReplacementChar(bodyOf(again) as string)) return again;
  } catch (e) {
    console.error(`getTweetDetailUngarbled(${tweetId}) retry failed:`, e);
  }
  return first;
}
