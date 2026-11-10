// 빌드의 Node 버전과 구분해, 실제 서버 인스턴스가 쓰는 보안 패치 버전을 확인한다.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logRuntimeVersion } = await import('./instrumentation-node');
    logRuntimeVersion();
  }
}
