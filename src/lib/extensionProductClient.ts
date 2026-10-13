'use client';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './apiFetch';
export class ProductClientError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}
export async function productFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`/api/extension-product/${path}`, { ...init, cache: 'no-store' });
  const envelope = await response.json().catch(() => null) as { data?: T; error?: { message?: string; code?: string } } | null;
  if (!response.ok || !envelope || !('data' in envelope)) throw new ProductClientError(envelope?.error?.message ?? '불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.', response.status, envelope?.error?.code ?? 'NETWORK_ERROR');
  return envelope.data as T;
}
// 응답 유실 재시도는 같은 번호, 입력·버전 변경은 새 번호를 사용한다.
export function useProductSave() {
  const pending = useRef<{ signature: string; key: string } | null>(null);
  return async <T>(path: string, body: unknown, version?: number, method = 'POST'): Promise<T> => {
    const signature = JSON.stringify({ path, body, version, method });
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    try {
      const result = await productFetch<T>(path, { method,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key, ...(version !== undefined ? { 'If-Match': `"${version}"` } : {}) },
        ...(method !== 'DELETE' ? { body: JSON.stringify(body) } : {}) });
      pending.current = null; return result;
    } catch (error) {
      if (error instanceof ProductClientError && error.status < 500) pending.current = null;
      throw error;
    }
  };
}

// 예약·클리닉 설정·비용 없음 같은 새 기능을 화면에 열지 — 설정(065) 적용 전이거나 운영 비활성이면 false.
// 페이지 하나에서 여러 곳이 묻기 때문에 한 번만 읽고 나눠 쓴다. 읽기 실패는 '꺼짐'으로 본다(기존 화면 그대로).
export type ProductFeatures = { writes: boolean; reservations: boolean; consents: boolean };
const FEATURES_OFF: ProductFeatures = { writes: false, reservations: false, consents: false };
let featuresOnce: Promise<ProductFeatures> | null = null;
let featuresValue: ProductFeatures | null = null;   // 한 번 읽은 값 — 다음 마운트는 첫 렌더부터 안다(기능에 따라 모양이 갈리는 칸이 깜빡이지 않게)
export function loadProductFeatures(): Promise<ProductFeatures> {
  featuresOnce ??= productFetch<ProductFeatures>('features').then((f) => { featuresValue = f; return f; }).catch(() => { featuresOnce = null; return FEATURES_OFF; });
  return featuresOnce;
}
export function useProductFeatures(): ProductFeatures | null {
  const [value, setValue] = useState<ProductFeatures | null>(() => featuresValue);
  useEffect(() => { let alive = true; void loadProductFeatures().then((f) => { if (alive) setValue(f); }); return () => { alive = false; }; }, []);
  return value;
}
