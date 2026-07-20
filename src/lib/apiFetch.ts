// 클라이언트 전용. 세션 만료 등으로 API가 401을 주면 로그인 화면으로 유도한다.
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('unauthorized');
  }
  return res;
}
