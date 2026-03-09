export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatMoney(paise) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format((paise || 0) / 100);
}

export function formatRelativeStamp(timestamp, now = Date.now()) {
  if (!timestamp) return 'just now';
  const diffMs = Math.max(0, now - Number(timestamp));
  const diffSeconds = Math.round(diffMs / 1000);
  if (diffSeconds < 5) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  return `${diffHours}h ago`;
}

export function renderStatusBadge(status) {
  if (status === 'WAITING') return '<span class="badge badge-waiting">Waiting</span>';
  if (status === 'NOTIFIED') return '<span class="badge badge-ready">Notified</span>';
  if (status === 'SEATED') return '<span class="badge badge-seated">Seated</span>';
  return `<span class="badge badge-neutral">${escapeHtml(status)}</span>`;
}
