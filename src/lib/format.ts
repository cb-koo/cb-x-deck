export function formatCount(n: number | null): string {
  if (n === null || n === undefined) return '–';
  if (n < 10000) return n.toLocaleString('en-US');
  const man = n / 10000;
  const s = man >= 100 ? Math.round(man).toLocaleString('en-US') : (Math.round(man * 10) / 10).toString();
  return `${s}万`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `'${String(d.getUTCFullYear()).slice(2)}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
}
