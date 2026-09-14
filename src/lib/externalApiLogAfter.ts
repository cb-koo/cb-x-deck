import { after } from 'next/server';
import { recordExternalCall, type ExternalLogEvent } from './externalApiLog.ts';

// 라우트가 쓰는 기록 예약 래퍼.
//
// 왜 after()인가: 예전에는 응답을 보낸 뒤 기록을 백그라운드로 던져놓고 기다리지 않았다(void async IIFE).
// 이 서버는 요청마다 뜨고 지므로, 응답을 반환한 순간 함수가 정지될 수 있고 그러면 기록이 저장되기 전에
// 사라졌다(2026-08-31에 그쪽 커서를 받아 간 호출이 기록에 없던 원인으로 추정). after()는 응답을 막지 않으면서
// 플랫폼이 이 작업이 끝날 때까지 함수를 살려 준다 — Next 문서가 로깅을 이 함수의 대표 용도로 든다.
//
// 왜 파일을 나눴나: externalApiLog.ts는 node --test가 직접 import한다. 거기에 next/server 의존을 넣으면
// 테스트가 Next 런타임에 묶인다.
export function recordExternalCallSafe(ev: ExternalLogEvent): void {
  try {
    after(() => recordExternalCall(ev));
  } catch {
    // 요청 컨텍스트 밖(스크립트·테스트)에서 불린 경우 — 예전처럼 던져놓는다
    void recordExternalCall(ev);
  }
}
