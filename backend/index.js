const express = require("express");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");
const session = require("express-session");
const passport = require("passport");
const SteamStrategy = require("passport-steam").Strategy;
const { spawn } = require("child_process");
const { getTrackerStats } = require("../scraper/tracker");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const stripeSecretKey = process.env.SECRET_KEY;
if (!stripeSecretKey) {
  console.error("Missing SECRET_KEY in .env");
  process.exit(1);
}

const steamApiKey = process.env.STEAM_API_KEY;
if (!steamApiKey) {
  console.error("Missing STEAM_API_KEY in .env");
  process.exit(1);
}

const stripe = require("stripe")(stripeSecretKey);

const app = express();
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());

// ── Sessions ──
app.use(
  session({
    secret: process.env.SESSION_SECRET || "safewager-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true,
      sameSite: "lax",
      secure: false, // set true in production with HTTPS
    },
  })
);

// ── Passport / Steam OpenID ──
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(
  new SteamStrategy(
    {
      returnURL: "http://localhost:4242/auth/steam/return",
      realm: "http://localhost:4242/",
      apiKey: steamApiKey,
    },
    (_identifier, profile, done) => {
      const user = {
        steamId: profile.id,
        username: profile.displayName,
        avatar: profile.photos[2]?.value || profile.photos[0]?.value,
        profileUrl: profile._json.profileurl,
      };
      console.log("[auth] Steam login:", user.username, user.steamId);
      return done(null, user);
    }
  )
);

app.use(passport.initialize());
app.use(passport.session());

// ── Auth routes ──
app.get("/auth/steam", passport.authenticate("steam"));

app.get(
  "/auth/steam/return",
  passport.authenticate("steam", { failureRedirect: "http://localhost:5173/" }),
  (_req, res) => {
    res.redirect("http://localhost:5173/");
  }
);

app.get("/auth/user", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ user: req.user });
  } else {
    res.json({ user: null });
  }
});

app.post("/auth/logout", (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ── Balance state (in-memory) ──

const balances = {}; // { "username": amountInCents }
const deposits = {}; // { "username": [{ piId, amount, refunded }] }

function getBalance(username) {
  return balances[username] || 0;
}

function addBalance(username, amountCents) {
  balances[username] = (balances[username] || 0) + amountCents;
}

function deductBalance(username, amountCents) {
  balances[username] = (balances[username] || 0) - amountCents;
}

function trackDeposit(username, piId, amountCents) {
  if (!deposits[username]) deposits[username] = [];
  deposits[username].push({ piId, amount: amountCents, refunded: 0 });
}

// ── Customer & saved-card management ──

// Create a Stripe Customer (one per user).
app.post("/create-customer", async (req, res) => {
  try {
    const { name } = req.body || {};
    console.log("[stripe] create-customer", { name });
    const customer = await stripe.customers.create({ name: name || "Player" });
    console.log("[stripe] create-customer ok", { id: customer.id });
    res.json({ customerId: customer.id });
  } catch (err) {
    res.status(500).json({ error: err.message || "server_error" });
  }
});

// Create a SetupIntent to save a card to a customer (no charge).
app.post("/create-setup-intent", async (req, res) => {
  try {
    const { customerId } = req.body || {};
    if (!customerId) {
      return res.status(400).json({ error: "customerId is required" });
    }
    console.log("[stripe] create-setup-intent", { customerId });
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
    });
    console.log("[stripe] create-setup-intent ok", { id: setupIntent.id });
    res.json({ clientSecret: setupIntent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message || "server_error" });
  }
});

// List saved payment methods for a customer.
app.get("/payment-methods/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;
    const methods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
    });
    res.json({
      paymentMethods: methods.data.map((m) => ({
        id: m.id,
        brand: m.card.brand,
        last4: m.card.last4,
        expMonth: m.card.exp_month,
        expYear: m.card.exp_year,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "server_error" });
  }
});

// ── Deposit & Withdrawal ──

// One-click deposit using a saved card (server-side confirm + auto-capture).
app.post("/deposit-with-saved-card", async (req, res) => {
  try {
    const { username, customerId, paymentMethodId, amount } = req.body || {};
    if (!username || !customerId || !paymentMethodId || !amount) {
      return res
        .status(400)
        .json({ error: "username, customerId, paymentMethodId, and amount are required" });
    }

    console.log("[deposit] saved-card", { username, amount });

    const pi = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      payment_method_types: ["card"],
      confirm: true,
      off_session: true,
    });

    if (pi.status === "succeeded") {
      addBalance(username, amount);
      trackDeposit(username, pi.id, amount);
      console.log("[deposit] ok", { username, amount, balance: getBalance(username) });
      res.json({ balance: getBalance(username) });
    } else {
      res.status(400).json({ error: "Payment did not succeed: " + pi.status });
    }
  } catch (err) {
    res.status(500).json({ error: err.message || "server_error" });
  }
});

// Create a deposit PaymentIntent for new card entry (frontend confirms).
app.post("/deposit", async (req, res) => {
  try {
    const { username, amount } = req.body || {};
    if (!username || !amount) {
      return res.status(400).json({ error: "username and amount are required" });
    }

    console.log("[deposit] create PI", { username, amount });
    const pi = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      payment_method_types: ["card"],
      metadata: { username, type: "deposit" },
    });

    res.json({ clientSecret: pi.client_secret, paymentIntentId: pi.id });
  } catch (err) {
    res.status(500).json({ error: err.message || "server_error" });
  }
});

// Called after frontend confirms a deposit PaymentIntent.
app.post("/confirm-deposit", async (req, res) => {
  try {
    const { username, paymentIntentId, amount } = req.body || {};
    if (!username || !paymentIntentId || !amount) {
      return res
        .status(400)
        .json({ error: "username, paymentIntentId, and amount are required" });
    }

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== "succeeded") {
      return res.status(400).json({ error: "Payment not yet succeeded: " + pi.status });
    }

    addBalance(username, amount);
    trackDeposit(username, pi.id, amount);
    console.log("[deposit] confirmed", { username, amount, balance: getBalance(username) });
    res.json({ balance: getBalance(username) });
  } catch (err) {
    res.status(500).json({ error: err.message || "server_error" });
  }
});

// Withdraw by refunding against deposit PaymentIntents.
app.post("/withdraw", async (req, res) => {
  try {
    const { username, amount } = req.body || {};
    if (!username || !amount) {
      return res.status(400).json({ error: "username and amount are required" });
    }

    const currentBalance = getBalance(username);
    if (currentBalance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const userDeposits = deposits[username] || [];
    let remaining = amount;
    const refunds = [];

    // Refund against deposits (oldest first) for real Stripe refund visibility
    for (const dep of userDeposits) {
      if (remaining <= 0) break;
      const available = dep.amount - dep.refunded;
      if (available <= 0) continue;

      const refundAmount = Math.min(remaining, available);
      const refund = await stripe.refunds.create({
        payment_intent: dep.piId,
        amount: refundAmount,
      });

      dep.refunded += refundAmount;
      remaining -= refundAmount;
      refunds.push({ piId: dep.piId, amount: refundAmount, refundId: refund.id });
      console.log("[withdraw] refund", { piId: dep.piId, refundAmount, refundId: refund.id });
    }

    deductBalance(username, amount);
    console.log("[withdraw] ok", { username, amount, balance: getBalance(username) });
    res.json({ balance: getBalance(username), refunds });
  } catch (err) {
    res.status(500).json({ error: err.message || "server_error" });
  }
});

// Get user balance.
app.get("/balance/:username", (req, res) => {
  const { username } = req.params;
  res.json({ balance: getBalance(username) });
});

// ── Wager lock-in (balance-based escrow) ──

app.post("/lock-wager", (req, res) => {
  const { username, amount } = req.body || {};
  if (!username || !amount) {
    return res.status(400).json({ error: "username and amount are required" });
  }

  const balance = getBalance(username);
  if (balance < amount) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  deductBalance(username, amount);
  console.log("[wager] locked", { username, amount, balance: getBalance(username) });
  res.json({ balance: getBalance(username) });
});

// ── Match server management ──

let activeMatch = null;
let matchResult = null;
let skipRequested = false;
let mockServerProcess = null;

// Store match data and auto-spawn mock server.
app.post("/start-match-server", (req, res) => {
  const { playerAName, playerBName, wagerAmount, map } = req.body || {};

  if (!playerAName || !playerBName || !wagerAmount) {
    return res.status(400).json({ error: "player names and wager amount are required" });
  }

  activeMatch = {
    playerAName,
    playerBName,
    wagerAmount,
    map: map || "de_dust2",
    status: "waiting",
  };
  matchResult = null;
  skipRequested = false;

  // Kill any existing mock server
  if (mockServerProcess) {
    mockServerProcess.kill();
    mockServerProcess = null;
  }

  // Spawn mock server as child process
  const scriptPath = path.join(__dirname, "..", "mock-server", "index.js");
  mockServerProcess = spawn("node", [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  mockServerProcess.stdout.on("data", (data) => {
    process.stdout.write(`[cs2] ${data}`);
  });

  mockServerProcess.stderr.on("data", (data) => {
    process.stderr.write(`[cs2 err] ${data}`);
  });

  mockServerProcess.on("close", (code) => {
    console.log(`[cs2] mock server exited with code ${code}`);
    mockServerProcess = null;
  });

  console.log("[match] start-match-server — mock server spawned", {
    map: activeMatch.map,
    playerA: playerAName,
    playerB: playerBName,
    wagerAmount,
  });

  res.json({ status: "running", map: activeMatch.map });
});

// Mock server fetches this to know who's playing.
app.get("/active-match", (_req, res) => {
  if (!activeMatch) {
    return res.status(404).json({ error: "no active match" });
  }
  res.json(activeMatch);
});

// Frontend calls this to skip to end.
app.post("/skip-match", (_req, res) => {
  skipRequested = true;
  console.log("[match] skip requested");
  res.json({ ok: true });
});

// Mock server polls this to check if it should skip.
app.get("/should-skip", (_req, res) => {
  res.json({ skip: skipRequested });
});

// Mock server calls this when the match ends — credit winner with pot.
app.post("/resolve-match", (req, res) => {
  try {
    const { winner } = req.body || {};
    if (!activeMatch) {
      return res.status(400).json({ error: "no active match to resolve" });
    }
    if (!winner || (winner !== "A" && winner !== "B")) {
      return res.status(400).json({ error: "winner must be 'A' or 'B'" });
    }

    const winnerName = winner === "A" ? activeMatch.playerAName : activeMatch.playerBName;
    const loserName = winner === "A" ? activeMatch.playerBName : activeMatch.playerAName;
    const pot = activeMatch.wagerAmount * 2;

    // Credit winner with full pot (their own wager + loser's wager)
    addBalance(winnerName, pot);

    console.log("[match] resolved", {
      winner: winnerName,
      loser: loserName,
      pot,
      winnerBalance: getBalance(winnerName),
      loserBalance: getBalance(loserName),
    });

    matchResult = {
      winner: winnerName,
      loser: loserName,
      wagerAmount: activeMatch.wagerAmount,
      winnerBalance: getBalance(winnerName),
      loserBalance: getBalance(loserName),
    };

    activeMatch = null;
    skipRequested = false;
    res.json(matchResult);
  } catch (err) {
    console.error("[match] resolve error", err.message);
    res.status(500).json({ error: err.message || "server_error" });
  }
});

// Frontend polls this to check if the match has been resolved.
app.get("/match-result", (_req, res) => {
  if (!matchResult) {
    return res.json({ resolved: false });
  }
  res.json({ resolved: true, ...matchResult });
});

// ── Integrity check state ──

const integrityResults = {}; // { steamId: { stats, timestamp, passed } }
const wagerHistory = []; // [{ id, creator, creatorSteamId, opponent, opponentSteamId, amount, map, result, timestamp }]

const INTEGRITY_TTL = 24 * 60 * 60 * 1000; // 24 hours
const CHEAT_THRESHOLD = 50; // percentage

function getIntegrity(steamId) {
  const entry = integrityResults[steamId];
  if (!entry) return null;
  const expired = Date.now() - entry.timestamp > INTEGRITY_TTL;
  return { ...entry, expired };
}

// Run integrity check for the logged-in user.
app.post("/integrity-check", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "not authenticated" });
  }

  const steamId = req.user.steamId;
  console.log("[integrity] running check for", steamId);

  try {
    const stats = await getTrackerStats(steamId);
    const cheatPct = parseInt(stats.cheating?.percentage) || 0;
    const passed = cheatPct < CHEAT_THRESHOLD;

    integrityResults[steamId] = {
      stats,
      timestamp: Date.now(),
      passed,
      cheatPct,
    };

    console.log("[integrity] done", { steamId, cheatPct, passed });
    res.json({ stats, passed, cheatPct, timestamp: integrityResults[steamId].timestamp });
  } catch (err) {
    console.error("[integrity] error", err.message);
    res.status(500).json({ error: "Integrity check failed: " + err.message });
  }
});

// Get current integrity status for the logged-in user.
app.get("/integrity-status", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "not authenticated" });
  }
  const entry = getIntegrity(req.user.steamId);
  if (!entry) {
    return res.json({ checked: false });
  }
  res.json({ checked: true, ...entry });
});

// ── Wager storage (server-side) ──

app.post("/create-wager", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "not authenticated" });
  }

  const { amount, map } = req.body || {};
  if (!amount || !map) {
    return res.status(400).json({ error: "amount and map are required" });
  }

  // Check integrity
  const integrity = getIntegrity(req.user.steamId);
  if (!integrity || integrity.expired) {
    return res.status(403).json({ error: "Integrity check required (expired or missing)" });
  }
  if (!integrity.passed) {
    return res.status(403).json({ error: "Integrity check failed — cheating percentage too high" });
  }

  const wager = {
    id: "w" + Date.now(),
    creator: req.user.username,
    creatorSteamId: req.user.steamId,
    creatorAvatar: req.user.avatar,
    amount,
    map,
    status: "open",
    opponent: null,
    opponentSteamId: null,
    result: null,
    timestamp: Date.now(),
  };

  wagerHistory.push(wager);
  console.log("[wager] created", { id: wager.id, creator: wager.creator, amount, map });
  res.json(wager);
});

// List all open wagers.
app.get("/wagers", (_req, res) => {
  res.json(wagerHistory.filter((w) => w.status === "open" || w.status === "in_progress"));
});

// Update wager result after match resolves.
app.post("/wager-result", (req, res) => {
  const { wagerId, winner, loser } = req.body || {};
  const wager = wagerHistory.find((w) => w.id === wagerId);
  if (!wager) return res.status(404).json({ error: "wager not found" });
  wager.result = { winner, loser };
  wager.status = "resolved";
  res.json(wager);
});

// Get profile data for a user (integrity + wager history).
app.get("/profile/:steamId", (req, res) => {
  const { steamId } = req.params;
  const integrity = getIntegrity(steamId);
  const userWagers = wagerHistory.filter(
    (w) => w.creatorSteamId === steamId || w.opponentSteamId === steamId
  );
  res.json({ integrity, wagers: userWagers });
});

const port = process.env.PORT || 4242;
app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
