import { NextResponse } from 'next/server';
import { ProductError } from './productCommand';
export function productWebBoundary<A extends unknown[]>(run: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try { return await run(...args); }
    catch (error) {
      if (error instanceof ProductError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      if ((error as { code?: string })?.code === '23503') return NextResponse.json({ error: '예약 기록이 연결되어 있어 삭제할 수 없어요. 연결된 작업을 확인해 주세요.' }, { status: 409 });
      if (['42P01', '42703'].includes((error as { code?: string })?.code ?? '')) return NextResponse.json({ error: '서버에 새 기능 설정이 아직 적용되지 않았어요. 관리자에게 설정 적용을 요청해 주세요.', code: 'SERVER_NOT_READY' }, { status: 503 });
      throw error;
    }
  };
}
