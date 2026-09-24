// 실패 응답의 오류 문구 — 서버가 준 문구를 그대로 쓴다, 원인을 넘겨짚지 않는다. 본문이 깨지면 상태코드만 남긴다.
// 인플 프로필 탭들(profileShared가 다시 내보낸다)과 공용 결제 수단 폼(PaymentMethodForm)이 같이 쓴다. 화면이 값으로 import한다.
export async function errOf(r: Response): Promise<string> {
  return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`;
}
