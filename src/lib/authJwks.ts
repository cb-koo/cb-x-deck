// auth-js가 아니라 supabase-js에서 가져온다 — auth-js는 전이 의존성이라 package.json에 없다.
// supabase-js(직접 의존성)가 `export * from '@supabase/auth-js'`로 그대로 재수출한다.
import type { JWK } from '@supabase/supabase-js';

export interface Jwks { keys: JWK[] }

// JWKS를 모듈 레벨에 들고 있는 이유: supabase-js의 JWKS 캐시는 클라이언트 인스턴스에 붙어 있는데
// (GoTrueClient의 this.jwks), 이 저장소는 요청 쿠키에 묶이므로 요청마다 클라이언트를 새로 만든다.
// 그래서 그냥 두면 요청마다 /.well-known/jwks.json을 다시 받는다(실측 13ms).
// 모듈 스코프는 워밍된 서버리스 인스턴스 안에서 요청 간에 살아남으므로, 여기 담아 두고
// getClaims(jwt, { jwks })로 넘기면 그 왕복이 사라진다.
const TTL_MS = 10 * 60 * 1000;

let cached: Jwks | null = null;
let cachedAt = 0;
// 진행 중인 조회. 콜드 스타트 직후 요청이 여러 개면 같은 fetch가 N번 나가는 것을 막는다.
let inFlight: Promise<Jwks | null> | null = null;

function jwksUrl(): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return `${base}/auth/v1/.well-known/jwks.json`;
}

/**
 * 지금 쓸 수 있는 JWKS. 없거나 받아오지 못하면 null —
 * 호출부는 그때 jwks 없이 getClaims를 불러 라이브러리가 직접 받아오게 한다.
 * 즉 이 캐시는 최적화일 뿐이고, 실패해도 인증이 죽지 않는다.
 */
export async function getCachedJwks(fetchImpl: typeof fetch = fetch): Promise<Jwks | null> {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<Jwks | null> => {
    try {
      const res = await fetchImpl(jwksUrl());
      if (!res.ok) return null;
      const body = await res.json() as Jwks;
      if (!body?.keys?.length) return null;   // 쓸 수 없는 응답은 캐시하지 않는다
      cached = body;
      cachedAt = Date.now();
      return cached;
    } catch {
      return null;   // 실패는 캐시하지 않는다 — 다음 요청에서 다시 시도한다
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** 키 회전으로 우리가 든 키가 쓸모없어졌을 때. 다음 호출에서 다시 받아온다. */
export function invalidateJwks(): void {
  cached = null;
  cachedAt = 0;
}

/** 테스트 전용 — 모듈 상태를 초기화한다. */
export function __resetForTest(): void {
  cached = null;
  cachedAt = 0;
  inFlight = null;
}
