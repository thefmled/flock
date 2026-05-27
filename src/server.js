require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: ['https://getflock.in', 'https://www.getflock.in'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'flock', timestamp: new Date().toISOString() });
});

// Routes (we'll add these as we build)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/venues', require('./routes/venues'));
app.use('/api/queue', require('./routes/queue'));
app.use('/api/subscription', require('./routes/subscription'));

// 404 handler for any unmatched /api/* request
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Generic error handler — catches any unhandled error
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
});

const http = require('http');
const realtime = require('./lib/realtime');

const server = http.createServer(app);
realtime.init(server);
server.listen(PORT, () => {
  console.log(`Flock server running on port ${PORT}`);
});
