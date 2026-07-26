# Hooporia Backend

Handles Stripe billing (Individual + Team plans) and keeps subscription
status in sync in a dedicated Supabase project. This is a separate,
standalone backend from Ritnome's — it does not touch Ritnome's Supabase
project or school licensing data at all.

Player stats stay in local browser storage for now (per current scope) —
this backend only handles accounts and billing status.

---

## What you need before deploying

1. A **Stripe account** (you already have one).
2. A **new, separate Supabase project** just for Hooporia — do not reuse
   Ritnome's project. Free tier is fine to start.
3. A **Render account** to host this server.

---

## Step 1 — Create the two Stripe Products/Prices

In the Stripe Dashboard → **Product catalog** → **Add product**:

**Individual plan**
- Name: `Hooporia Individual`
- Pricing model: `Recurring`
- Price: `$9.99` / `Monthly`
- After saving, copy the **Price ID** (starts with `price_...`) —
  this goes in `STRIPE_PRICE_INDIVIDUAL`.

**Team plan**
- Name: `Hooporia Team (per player)`
- Pricing model: `Recurring`
- Price: `$4.99` / `Monthly`
- Copy this **Price ID** too — this goes in `STRIPE_PRICE_TEAM`.
  (The checkout code multiplies this by roster size using Stripe's
  `quantity` field — you don't need a separate price per roster size.)

Keep **Test mode** on in Stripe until you've fully tested checkout and
webhooks end to end. Switch to live keys only once that's confirmed working.

---

## Step 2 — Set up the Supabase project

1. Create a new Supabase project (separate from Ritnome's).
2. Open the **SQL Editor** and run everything in `supabase-schema.sql`
   from this folder. This creates the `accounts`, `subscriptions`, and
   `roster_players` tables.
3. Go to **Project Settings → API** and copy:
   - The **Project URL** → `SUPABASE_URL`
   - The **service_role** key (NOT the `anon` key — this one bypasses
     Row Level Security and must stay secret) → `SUPABASE_SERVICE_ROLE_KEY`

---

## Step 3 — Deploy to Render

1. Push this folder to its own GitHub repo.
2. In Render, create a **New Web Service**, connect that repo.
3. Runtime: **Node**. Build command: `npm install`. Start command: `npm start`.
4. Under **Environment**, add every variable from `.env.example` with your
   real values (Stripe keys, price IDs, Supabase URL/key, and
   `FRONTEND_URL` set to `https://hooporia.com`).
5. Deploy. Once live, note your Render URL
   (e.g. `https://hooporia-backend.onrender.com`) — you'll need it next.

---

## Step 4 — Connect the Stripe webhook

1. In Stripe Dashboard → **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://<your-render-url>/api/webhook`
3. Select these events to send:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. After creating it, Stripe shows a **Signing secret** (`whsec_...`) —
   copy this into Render's `STRIPE_WEBHOOK_SECRET` environment variable
   and redeploy.

---

## Step 5 — Wire up the frontend

From hooporia.com, when someone picks a plan:

```js
const res = await fetch('https://<your-render-url>/api/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    plan: 'individual',       // or 'team'
    rosterSize: 1,             // only matters for 'team'
    email: 'parent@example.com' // optional, pre-fills Stripe Checkout
  })
});
const { url } = await res.json();
window.location.href = url; // sends them to Stripe's hosted checkout page
```

After payment, Stripe redirects back to
`FRONTEND_URL/welcome.html?session_id=...` — build that page whenever
you're ready.

To check if someone's subscription is currently active (e.g. before
unlocking the paid training modes):

```js
const res = await fetch(
  `https://<your-render-url>/api/subscription-status?email=parent@example.com`
);
const data = await res.json();
// data.active === true/false
```

---

## Honest limitations of this v1, worth knowing

- **No real user login yet.** The status check works by email address
  alone, with no password or session behind it. That's fine for testing
  the billing flow, but before real customers rely on it, this should
  sit behind actual accounts (Supabase Auth is a natural fit, since it's
  already in this same project).
- **Player stats are not synced here.** This backend only tracks
  accounts and subscription status — profiles and career stats still
  live in each browser's local storage, exactly as they do today.
- **Test mode first.** Don't switch Stripe to live keys until a full
  test-mode checkout → webhook → status-check cycle has actually been
  verified working end to end.
