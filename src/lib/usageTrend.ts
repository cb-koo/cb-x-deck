export function trend(current: number, previous: number): { pct: number | null; direction: 'up' | 'down' | 'flat' } {
  if (previous === 0) {
    return { pct: null, direction: current > 0 ? 'up' : 'flat' };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}
