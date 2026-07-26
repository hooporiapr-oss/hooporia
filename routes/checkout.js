// Creates a Stripe Checkout Session for either plan.
// The frontend calls POST /api/checkout with { plan, rosterSize, email },
// gets back a Checkout URL, and redirects the browser there. Stripe hosts
// the actual payment form — no card details ever touch this server.

const express = require('express');
const router = express.Router();
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_IDS = {
  individual: process.env.STRIPE_PRICE_INDIVIDUAL,
  team: process.env.STRIPE_PRICE_TEAM
};

router.post('/checkout', async (req, res) => {
  try {
    const { plan, rosterSize, email } = req.body || {};

    if (plan !== 'individual' && plan !== 'team') {
      return res.status(400).json({ error: 'plan must be "individual" or "team"' });
    }

    const priceId = PRICE_IDS[plan];
    if (!priceId) {
      return res.status(500).json({
        error: `Missing Stripe price ID for plan "${plan}" — check environment variables.`
      });
    }

    // Team plans bill per-player: quantity = roster size, min 1.
    // Individual plans are always a single seat.
    let quantity = 1;
    if (plan === 'team') {
      quantity = Math.max(1, parseInt(rosterSize, 10) || 1);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity }],
      customer_email: email || undefined,
      success_url: `${process.env.FRONTEND_URL}/welcome.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing.html`,
      // Metadata rides along on the Stripe objects and shows up on the
      // webhook events below — this is how we know which plan/roster size
      // this checkout was actually for, without re-guessing later.
      metadata: {
        plan,
        roster_size: String(quantity)
      },
      subscription_data: {
        metadata: {
          plan,
          roster_size: String(quantity)
        }
      }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout session creation failed:', err.message);
    res.status(500).json({ error: 'Could not create checkout session.' });
  }
});

module.exports = router;
