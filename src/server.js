require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'flock', timestamp: new Date().toISOString() });
});

// Routes (we'll add these as we build)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/venues', require('./routes/venues'));
app.use('/api/queue', require('./routes/queue'));

app.listen(PORT, () => {
  console.log(`Flock server running on port ${PORT}`);
});
