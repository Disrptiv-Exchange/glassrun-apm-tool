/** Format a Date as YYYY-MM-DDTHH:mm:ss (no Z suffix — matches backend SP expectation). */
export function toLocalISOString(date: Date): string {
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/** Return a new Date set to 23:59:59.999 on the same calendar day. */
export function getEndOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Relative freshness label ("5s ago", "3m ago", "2h ago"). */
export function formatAgo(date: Date | null): string {
  if (!date) return '—';
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60)   return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
