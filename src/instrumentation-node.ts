export function logRuntimeVersion() {
  console.info('[runtime]', JSON.stringify({
    phase: 'server-start',
    node: process.version,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  }));
}
