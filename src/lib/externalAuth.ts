// 서버↔서버 공유 시크릿(Bearer). 사람이 아니라 서버가 부르는 라우트(landing-events, external/settlement)가 쓴다.
// env가 비어 있으면 '열린 API'가 아니라 '닫힌 API'다. 비교는 상수 시간.
import { timingSafeEqual } from 'node:crypto';

export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = header && header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bearerAuthorized(req: Request, envName: string): boolean {
  return bearerMatches(req.headers.get('authorization'), process.env[envName]);
}

// x-api-key 헤더(Bearer 접두어 없이 키 값 그대로). LINE 대시보드가 마케팅 비용을 폴링으로 가져갈 때 쓴다 —
// 그쪽 계약이 Authorization: Bearer가 아니라 x-api-key다(스펙 §2.2). fail-closed·상수 시간 비교는 위와 같다.
export function apiKeyMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const a = Buffer.from(header ?? ''), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function apiKeyAuthorized(req: Request, envName: string): boolean {
  return apiKeyMatches(req.headers.get('x-api-key'), process.env[envName]);
}
