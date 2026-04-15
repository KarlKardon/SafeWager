# SafeWager - Design Document

Counter-Strike wager platform where players bet on 1v1 and 2v2 matches with Stripe-escrowed funds.

---

## 1. System Overview

SafeWager is a web application that lets CS2 players create and accept cash wagers on private matches. Stripe's manual-capture payment intent flow acts as escrow: funds are authorized (held) on each player's card when they lock in, and only captured from the loser (or released from both) once the match resolves.

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   React UI  │──────▶│  Express API │──────▶│   Stripe    │
│  (Vite SPA) │◀──────│  (Node.js)  │◀──────│   (escrow)  │
└─────────────┘       └──────┬──────┘       └─────────────┘
                             │
                     ┌───────┴───────┐
                     │   Database    │
                     │  (not yet)    │
                     └───────────────┘
```

**Current state:** The frontend shell (dark gaming UI, wager feed, join/lock-in modal) and the Stripe payment intent backend are functional. Authentication, database, server provisioning, and match resolution are stubbed or mocked.

---

## 2. Tech Stack

| Layer       | Technology                        |
|-------------|-----------------------------------|
| Frontend    | React 19, Vite 7, Stripe Elements |
| Backend     | Express.js 5, Stripe SDK 20       |
| Payments    | Stripe (manual-capture intents)    |
| Auth        | Planned: Steam OpenID             |
| Database    | Planned: PostgreSQL or MongoDB     |
| Real-time   | Planned: WebSockets / SSE         |
| Game servers| Planned: CS2 dedicated servers     |

---

## 3. Architecture

### 3.1 Frontend

Single-page React app bootstrapped with Vite. The Stripe publishable key is loaded via `VITE_STRIPE_PUBLISHABLE_KEY` and wrapped in `<Elements>` at the root.

**Key areas of the UI:**

- **Rail** (72px) -- logo and icon navigation
- **Sidebar** (240px) -- nav links (rules, announcements, find-a-match, wager-feed, support), user profile card
- **Main content** -- public wager feed with filter bar and wager cards
- **Right bar** (260px) -- friends list, top earners, promotions

**Wager card** displays: player name, FACEIT level, ping, map, wager amount, and a "JOIN WAGER" CTA.

**Join modal** walks through:
1. Player A lock-in (payment authorization)
2. Player B lock-in (payment authorization)
3. Confirm & provision server
4. Server details card (name, password, region)

State is managed with React hooks (`useState`). Lock-in and server provisioning are currently simulated with timeouts.

**Styling:** CSS variables, dark theme (navy/black), orange accent (#ff7a1a), Space Grotesk + Rajdhani fonts. Responsive breakpoints at 1200px and 900px.

### 3.2 Backend

Minimal Express server (`backend/index.js`) on port 4242. CORS allows `localhost:5173`.

**Endpoints:**

| Route                      | Method | Purpose                                      |
|----------------------------|--------|----------------------------------------------|
| `/health`                  | GET    | Health check                                 |
| `/create-payment-intent`   | POST   | Authorize a single payment (hold on card)    |
| `/create-match`            | POST   | Authorize two payments (one per player)      |
| `/capture-payment-intent`  | POST   | Charge an authorized payment (loser pays)    |
| `/cancel-payment-intent`   | POST   | Release an authorized hold (winner/cancelled)|

All payment intents use `capture_method: "manual"` so funds are held but not charged until explicitly captured.

### 3.3 Stripe Escrow Flow

```
Player A creates wager ($10)
  └─▶ POST /create-match
       ├─▶ Stripe: PaymentIntent A (manual-capture, $10)
       └─▶ Stripe: PaymentIntent B (manual-capture, $10)

Both players provide payment method via Stripe Elements
  └─▶ Stripe confirms → funds HELD on both cards

Match plays out on CS2 server

Player A wins:
  ├─▶ POST /capture-payment-intent (Player B's intent) → B charged $10
  └─▶ POST /cancel-payment-intent  (Player A's intent) → A's hold released

Player A loses:
  ├─▶ POST /capture-payment-intent (Player A's intent) → A charged $10
  └─▶ POST /cancel-payment-intent  (Player B's intent) → B's hold released
```

Manual-capture holds typically expire after 7 days if not captured. Matches must resolve within that window.

---

## 4. Wager Lifecycle

```
CREATED ──▶ OPEN ──▶ LOCKED ──▶ IN_PROGRESS ──▶ RESOLVED
  │                     │             │              │
  │  creator posts      │  both pay   │  CS2 match   │  capture loser /
  │  wager to feed      │  authorized │  in progress  │  release winner
  │                     │             │              │
  └──── CANCELLED ◀─────┘             └── DISPUTED ──┘
         (hold released)                 (manual review)
```

1. **CREATED** -- Creator selects amount, map, mode, region.
2. **OPEN** -- Wager appears in public feed for others to join.
3. **LOCKED** -- Both players lock in; Stripe holds funds on both cards.
4. **IN_PROGRESS** -- Server provisioned; players join and play.
5. **RESOLVED** -- Result determined; loser's funds captured, winner's hold released.
6. **CANCELLED** -- Either player backs out before lock-in; holds released.
7. **DISPUTED** -- Player contests result; requires admin review.

---

## 5. Data Model (Planned)

### Users
| Field      | Type        | Notes                        |
|------------|-------------|------------------------------|
| id         | UUID / PK   |                              |
| steam_id   | string      | unique, from Steam OpenID    |
| username   | string      |                              |
| avatar_url | string      |                              |
| rank       | string      | MM rank or FACEIT level       |
| balance    | integer     | cents, for wallet/withdrawals|
| created_at | timestamp   |                              |

### Wagers
| Field      | Type        | Notes                            |
|------------|-------------|----------------------------------|
| id         | UUID / PK   |                                  |
| creator_id | FK → Users  |                                  |
| amount     | integer     | cents                            |
| currency   | string      | default "usd"                    |
| map        | string      | e.g. "AIM_MAP_PRO_V2"           |
| mode       | enum        | 1v1_aim, 2v2_wingman             |
| region     | string      | NA-WEST, EU-WEST, etc.           |
| status     | enum        | open, locked, in_progress, resolved, cancelled, disputed |
| created_at | timestamp   |                                  |

### Matches
| Field               | Type        | Notes                          |
|---------------------|-------------|--------------------------------|
| id                  | UUID / PK   |                                |
| wager_id            | FK → Wagers |                                |
| player_a_id         | FK → Users  |                                |
| player_b_id         | FK → Users  |                                |
| winner_id           | FK → Users  | null until resolved            |
| server_ip           | string      |                                |
| server_password     | string      |                                |
| demo_url            | string      | for dispute evidence           |
| resolved_at         | timestamp   |                                |

### Payment Intents
| Field                   | Type        | Notes                      |
|-------------------------|-------------|----------------------------|
| id                      | UUID / PK   |                            |
| match_id                | FK → Matches|                            |
| user_id                 | FK → Users  |                            |
| stripe_intent_id        | string      | Stripe PaymentIntent ID    |
| stripe_client_secret    | string      |                            |
| amount                  | integer     | cents                      |
| status                  | enum        | authorized, captured, cancelled |

---

## 6. Components Not Yet Implemented

### 6.1 Authentication (Steam OpenID)

Users authenticate via Steam. The flow:
1. Redirect to Steam OpenID login
2. Steam redirects back with `steam_id`
3. Backend creates or fetches user record
4. Issue session token (JWT or cookie)

Libraries: `passport-steam` or direct OpenID 2.0 implementation.

### 6.2 Database & ORM

No database is wired up yet. Recommended path:
- **PostgreSQL** for relational integrity (wagers, matches, payments are highly relational)
- **Prisma** or **Drizzle** as the ORM for type-safe queries
- Migrations managed via the ORM's migration tooling

### 6.3 CS2 Server Provisioning

Currently mocked with a 900ms timeout returning hardcoded server info. Real implementation needs:
- Integration with a game server provider (dathost, etc.) or self-hosted instances
- API to spin up / tear down servers on demand
- Health checks and timeout handling (auto-cancel if players don't connect)
- Demo recording and upload for dispute resolution

### 6.4 Match Result Determination

Options for determining who won:
- **Manual reporting** -- both players submit result; if they agree, auto-resolve. If they disagree, flag as disputed.
- **Game server log parsing** -- parse server logs or RCON output for round/match results.
- **FACEIT/third-party API** -- if matches are played on FACEIT, use their API.

### 6.5 Stripe Webhooks

The backend should listen for Stripe webhook events to stay in sync:
- `payment_intent.amount_capturable_updated` -- confirm hold is active
- `payment_intent.succeeded` -- confirm capture went through
- `payment_intent.canceled` -- confirm release
- `charge.dispute.created` -- handle chargebacks

Webhook signature verification via `stripe.webhooks.constructEvent()` is critical.

### 6.6 Real-time Updates

The wager feed, lock-in status, and match progress should update live. Options:
- **WebSockets** (via `ws` or `socket.io`) for bidirectional communication
- **Server-Sent Events** for simpler one-way push (wager feed updates)

### 6.7 Withdrawal / Payout

Winners need a way to cash out. Options:
- **Stripe Connect** -- onboard users as connected accounts, transfer funds directly
- **Internal wallet** -- track balance in DB, allow withdrawal requests processed manually or via Stripe payouts

---

## 7. Security Considerations

| Area                  | Current State        | Required                                    |
|-----------------------|----------------------|---------------------------------------------|
| Authentication        | None                 | Steam OpenID + session tokens               |
| Input validation      | None                 | Validate all request bodies server-side      |
| Rate limiting         | None                 | Per-IP and per-user rate limits              |
| Stripe webhook auth   | Not implemented      | Verify signatures on all webhook events      |
| HTTPS                 | Dev only (HTTP)      | TLS everywhere in production                 |
| CORS                  | localhost only       | Lock to production domain                    |
| Idempotency           | None                 | Idempotency keys on Stripe calls             |
| Anti-fraud            | None                 | Velocity checks, device fingerprinting       |
| Disputes              | Not implemented      | Demo review process, admin tooling           |

---

## 8. API Contract (Current)

### POST /create-match
**Request:**
```json
{
  "amount": 1000,
  "currency": "usd",
  "playerAName": "s1mple_god_12",
  "playerBName": "ZywOo_Fan_99"
}
```

**Response:**
```json
{
  "playerA": {
    "clientSecret": "pi_xxx_secret_xxx",
    "paymentIntentId": "pi_xxx"
  },
  "playerB": {
    "clientSecret": "pi_yyy_secret_yyy",
    "paymentIntentId": "pi_yyy"
  }
}
```

### POST /capture-payment-intent
**Request:**
```json
{ "paymentIntentId": "pi_xxx" }
```

### POST /cancel-payment-intent
**Request:**
```json
{ "paymentIntentId": "pi_xxx" }
```

---

## 9. Development Setup

```bash
# Backend (port 4242)
cd backend && npm install && npm run dev

# Frontend (port 5173)
cd frontend && npm install && npm run dev
```

Environment variables:
- Root `.env`: `SECRET_KEY` (Stripe secret), `PUB_KEY` (Stripe publishable)
- `frontend/.env`: `VITE_STRIPE_PUBLISHABLE_KEY`

Currently using Stripe **test mode** keys.

---

## 10. Implementation Priorities

**Phase 1 -- Core MVP:**
- Steam authentication
- PostgreSQL + ORM setup
- Wager CRUD API
- End-to-end Stripe payment flow (create, authorize, capture/cancel)
- Manual match result reporting
- Basic dispute flagging

**Phase 2 -- Playable Product:**
- Game server provisioning (dathost or similar)
- Real-time wager feed (WebSockets)
- Match result auto-detection (server log parsing)
- Stripe webhooks for payment state sync
- User profiles and match history

**Phase 3 -- Growth:**
- Stripe Connect for payouts / withdrawals
- Leaderboards and statistics
- 2v2 wingman support
- Tournament mode
- Admin dashboard (disputes, moderation, analytics)

**Phase 4 -- Scale:**
- Microservice decomposition (auth, payments, matchmaking, servers)
- Redis caching layer
- CDN for frontend
- Mobile client (React Native)
- Streaming integration (Twitch)
