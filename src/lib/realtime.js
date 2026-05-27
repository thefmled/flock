const { WebSocketServer } = require('ws');

// Map of subscriptionKey -> Set<WebSocket>
const subscribers = new Map();

function getSet(key) {
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  return subscribers.get(key);
}

function init(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.subscriptions = new Set();

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'subscribe' && msg.key) {
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
}

function broadcast(key, message) {
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
