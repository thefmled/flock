require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: ['https://getflock.in', 'https://www.getflock.in'],
  credentials: true,
}));
// Razorpay webhook signature verification needs the raw request body.
// This must run BEFORE express.json() — otherwise json() consumes the stream
// and the HMAC is computed over the wrong bytes (every webhook fails to verify).
app.use('/api/subscription/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'flock', timestamp: new Date().toISOString() });
});

// Request logging middleware
app.use((req, res, next) => {
  const reqId = Math.random().toString(36).slice(2, 8);
  const start = Date.now();
  req.reqId = reqId;
  
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (res.statusCode >= 400) {
      console.error(`[${reqId}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    } else if (req.path.startsWith('/api')) {
      console.log(`[${reqId}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  
  next();
});

// Routes (we'll add these as we build)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/venues', require('./routes/venues'));
app.use('/api/queue', require('./routes/queue'));
app.use('/api/subscription', require('./routes/subscription'));
app.use('/api/whatsapp', require('./routes/whatsapp'));

// 404 handler for any unmatched /api/* request
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Generic error handler — catches any unhandled error
app.use((err, req, res, next) => {
  console.error(`[${req.reqId}] Unhandled error:`, err);
  res.status(500).json({ error: 'Something went wrong on our end. Please try again.', reqId: req.reqId });
});

const http = require('http');
const realtime = require('./lib/realtime');

const server = http.createServer(app);
realtime.init(server);
server.listen(PORT, () => {
  console.log(`Flock server running on port ${PORT}`);
});
