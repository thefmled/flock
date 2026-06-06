const { WebSocketServer } = require('ws');

// Map of subscriptionKey -> Set<WebSocket>
const subscribers = new Map();

function getSet(key) {
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  return subscribers.get(key);
}

function init(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const jwt = require('jsonwebtoken');
  const prisma = require('./prisma');

  // Verify the subscriber can access a given channel.
  // - venue:<id> requires a valid JWT and ownership of the venue
  // - entry:<id> is open (the random ID is the access credential)
  // - anything else is rejected
  async function canSubscribe(key, token) {
    if (typeof key !== 'string') return false;
    if (key.startsWith('entry:')) return true;
    // PII-free per-venue ping channel for guest status pages — carries only a bare
    // "queue changed" signal (never guest data), so it's open like entry: (no auth).
    if (key.startsWith('venue-public:')) return true;
    if (key.startsWith('venue:')) {
      if (!token) return false;
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const venueId = key.slice(6);
        const venue = await prisma.venue.findUnique({ where: { id: venueId } });
        return !!(venue && venue.ownerId === decoded.ownerId);
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  wss.on('connection', (ws) => {
    ws.subscriptions = new Set();
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'subscribe' && msg.key) {
          const ok = await canSubscribe(msg.key, msg.token);
          if (!ok) {
            try { ws.send(JSON.stringify({ type: 'subscribe_denied', key: msg.key })); } catch(e) {}
            return;
          }
          ws.subscriptions.add(msg.key);
          getSet(msg.key).add(ws);
        } else if (msg.type === 'unsubscribe' && msg.key) {
          ws.subscriptions.delete(msg.key);
          getSet(msg.key).delete(ws);
        } else if (msg.type === 'ping') {
          try { ws.send(JSON.stringify({ type: 'pong' })); } catch(e) {}
        }
      } catch (e) {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      ws.subscriptions.forEach(k => {
        const set = subscribers.get(k);
        if (set) {
          set.delete(ws);
          if (set.size === 0) subscribers.delete(k);
        }
      });
    });

    ws.on('error', () => {
      try { ws.close(); } catch(e) {}
    });
  });

  console.log('WebSocket server initialized on /ws');
  // Periodic cleanup — remove dead sockets every minute
  setInterval(() => {
    subscribers.forEach((set, key) => {
      const dead = [];
      set.forEach(ws => {
        if (ws.readyState !== 1) dead.push(ws);
      });
      dead.forEach(ws => set.delete(ws));
      if (set.size === 0) subscribers.delete(key);
    });
  }, 60 * 1000);

  // Heartbeat
  setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch(e) {}
        return;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch(e) {}
    });
  }, 30 * 1000);
}

function broadcast(key, message) {
  // Mirror any venue:<id> broadcast to the PII-free venue-public:<id> channel as a bare
  // "queue changed" ping, so guest status pages can refetch their own position in real time
  // without ever receiving owner-facing payloads. Runs before the early-return below so it
  // fires even when no owner dashboard is currently subscribed to the venue channel.
  if (typeof key === 'string' && key.startsWith('venue:')) {
    const publicSet = subscribers.get('venue-public:' + key.slice(6));
    if (publicSet && publicSet.size) {
      const ping = JSON.stringify({ type: 'queue_changed' });
      publicSet.forEach(ws => {
        try { if (ws.readyState === 1) ws.send(ping); } catch (e) {}
      });
    }
  }

  const set = subscribers.get(key);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify(message);
  set.forEach(ws => {
    try {
      if (ws.readyState === 1) ws.send(payload);
    } catch (e) {
      // ignore
    }
  });
}

module.exports = { init, broadcast };
