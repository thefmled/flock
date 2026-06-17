// Fire-and-forget operational alert. POSTs to OPS_ALERT_WEBHOOK_URL (a Pipedream
// HTTP-trigger workflow, or any webhook) so you get a real-time ping when a money/
// billing/notification path fails. Never throws and never blocks the request, if the
// URL is unset or the POST fails, it silently does nothing. Requires Node 18+ (global fetch).
const OPS_URL = process.env.OPS_ALERT_WEBHOOK_URL;

function notifyOps(event, detail, severity = 'error') {
  if (!OPS_URL) return;
  try {
    fetch(OPS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'flock',
        event,
        severity,
        detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
        at: new Date().toISOString(),
      }),
    }).catch(() => {});
  } catch (_) { /* never let alerting affect the request path */ }
}

module.exports = { notifyOps };
