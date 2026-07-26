// Lets the Hooporia frontend ask "is this person's subscription active?"
// after they've checked out, so the app can unlock the paid training modes.
//
// NOTE — this is a deliberately simple v1, matching "just get billing
// working" scope: it checks by email with no login session behind it.
// That's fine to start with, but it does mean anyone who knows an email
// address could check whether it has an active subscription. Before a
// real public launch, this should sit behind actual user accounts
// (e.g. Supabase Auth) rather than a bare email lookup — worth returning
// to before this goes live with real customers, not required to start
// building and testing the billing flow itself.

const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../supabaseAdmin');

router.get('/subscription-status', async (req, res) => {
  try {
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'email query parameter is required' });
    }

    const { data: account, error: accountErr } = await supabaseAdmin
      .from('accounts')
      .select('id, email, account_type')
      .ilike('email', email)
      .maybeSingle();

    if (accountErr) throw accountErr;
    if (!account) {
      return res.json({ active: false, reason: 'no_account' });
    }

    const { data: subscription, error: subErr } = await supabaseAdmin
      .from('subscriptions')
      .select('plan, status, roster_size, current_period_end')
      .eq('account_id', account.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subErr) throw subErr;
    if (!subscription) {
      return res.json({ active: false, reason: 'no_subscription' });
    }

    const active = subscription.status === 'active' || subscription.status === 'trialing';

    res.json({
      active,
      plan: subscription.plan,
      status: subscription.status,
      rosterSize: subscription.roster_size,
      currentPeriodEnd: subscription.current_period_end
    });
  } catch (err) {
    console.error('Subscription status check failed:', err.message);
    res.status(500).json({ error: 'Could not check subscription status.' });
  }
});

module.exports = router;
