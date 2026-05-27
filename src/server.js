require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
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

const http = require('http');
const realtime = require('./lib/realtime');

const server = http.createServer(app);
realtime.init(server);
server.listen(PORT, () => {
  console.log(`Flock server running on port ${PORT}`);
});
