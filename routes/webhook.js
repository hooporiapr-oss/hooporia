// Stripe webhook handler. This is the ONLY place subscription status
// actually changes in our database — never trust a client telling us
// "I'm subscribed now," always wait for Stripe to confirm it here.
//
// IMPORTANT: this route must receive the RAW request body (not JSON-parsed)
// so the signature can be verified. See server.js for how this is wired up
// — the raw-body middleware must be applied BEFORE express.json() for this
// specific path.

const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const supabaseAdmin = require('../supabaseAdmin');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function findOrCreateAccount({ email, stripeCustomerId, accountType }) {
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('accounts')
    .select('*')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle();

  if (findErr) throw findErr;
  if (existing) return existing;

  const { data: created, error: createErr } = await supabaseAdmin
    .from('accounts')
    .insert({
      email,
      account_type: accountType || 'individual',
      stripe_customer_id: stripeCustomerId
    })
    .select()
    .single();

  if (createErr) throw createErr;
  return created;
}

async function upsertSubscription({ accountId, stripeSubscription }) {
  const plan = stripeSubscription.metadata?.plan || 'individual';
  const rosterSize = parseInt(stripeSubscription.metadata?.roster_size, 10) || 1;
  const periodEnd = stripeSubscription.current_period_end
    ? new Date(stripeSubscription.current_period_end * 1000).toISOString()
    : null;

  const { error } = await supabaseAdmin
    .from('subscriptions')
    .upsert(
      {
        account_id: accountId,
        stripe_subscription_id: stripeSubscription.id,
        plan,
        status: stripeSubscription.status,
        roster_size: rosterSize,
        current_period_end: periodEnd,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'stripe_subscription_id' }
    );

  if (error) throw error;
}

router.post('/webhook', async (req, res) => {
  const signature = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body, // raw Buffer — see server.js
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const stripeCustomerId = session.customer;
        const stripeSubscriptionId = session.subscription;

        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        const accountType = subscription.metadata?.plan === 'team' ? 'coach' : 'individual';

        const account = await findOrCreateAccount({
          email: session.customer_details?.email || session.customer_email,
          stripeCustomerId,
          accountType
        });

        await upsertSubscription({ accountId: account.id, stripeSubscription: subscription });
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const account = await findOrCreateAccount({
          email: null,
          stripeCustomerId: subscription.customer,
          accountType: subscription.metadata?.plan === 'team' ? 'coach' : 'individual'
        });
        await upsertSubscription({ accountId: account.id, stripeSubscription: subscription });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const { error } = await supabaseAdmin
          .from('subscriptions')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subscription.id);
        if (error) throw error;
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const { error } = await supabaseAdmin
            .from('subscriptions')
            .update({ status: 'past_due', updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', invoice.subscription);
          if (error) throw error;
        }
        break;
      }

      default:
        // Unhandled event types are fine to ignore — Stripe sends many
        // more events than we need to act on.
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    // Return 500 so Stripe retries delivery later.
    res.status(500).json({ error: 'Webhook handler failed.' });
  }
});

module.exports = router;
