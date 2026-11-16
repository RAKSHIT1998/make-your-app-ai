export function money(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

export function ago(iso: string, now = Date.now()) {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

export function dateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** "in 2 days" / "3 h left" style countdown for deadlines. */
export function until(iso: string, now = Date.now()) {
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  if (s <= 0) return 'closed';
  const h = Math.floor(s / 3600);
  if (h < 1) return `${Math.max(1, Math.round(s / 60))} min left`;
  if (h < 48) return `${h} h left`;
  return `${Math.round(h / 24)} days left`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
export const initials = (s: string) => s.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
