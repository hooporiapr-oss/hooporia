require('dotenv').config();

const express = require('express');
const cors = require('cors');

const checkoutRoutes = require('./routes/checkout');
const webhookRoutes = require('./routes/webhook');
const statusRoutes = require('./routes/status');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

// IMPORTANT: the webhook route needs the RAW request body to verify Stripe's
// signature, so it's mounted here with express.raw() BEFORE express.json()
// is applied globally below. If this order were reversed, signature
// verification would fail for every webhook delivery.
app.use('/api', express.raw({ type: 'application/json' }), webhookRoutes);

// Every other route gets normal JSON body parsing.
app.use(express.json());
app.use('/api', checkoutRoutes);
app.use('/api', statusRoutes);

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'hooporia-backend' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Hooporia backend listening on port ${PORT}`);
});
