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

const { db, dbPath, makeId, nowIso } = require("./db");

function normalizeBaseUrl(rawValue, fallback) {
  const value = (rawValue || fallback || "").trim();
  return value.replace(/\/+$/, "");
}

function parseAllowedOrigins(rawValue) {
  return (rawValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

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
const controllerUrl = process.env.CS2_CONTROLLER_URL || "";
const controllerToken = process.env.CS2_CONTROLLER_TOKEN || "";
const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
const port = Number(process.env.PORT) || 4242;
const backendBaseUrl = normalizeBaseUrl(process.env.BACKEND_BASE_URL, `http://localhost:${port}`);
const appOrigin = normalizeBaseUrl(process.env.APP_ORIGIN, isProduction ? backendBaseUrl : "http://localhost:5173");
const allowedOrigins = new Set([
  appOrigin,
  ...parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
]);
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.error("Missing SESSION_SECRET in .env");
  process.exit(1);
}

const app = express();
app.set("trust proxy", 1);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
}));
app.use(express.json());

// ── Sessions ──
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    },
  })
);

// ── Passport / Steam OpenID ──
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(
  new SteamStrategy(
    {
      returnURL: `${backendBaseUrl}/auth/steam/return`,
      realm: `${backendBaseUrl}/`,
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
  passport.authenticate("steam", { failureRedirect: `${appOrigin}/` }),
  (_req, res) => {
    res.redirect(`${appOrigin}/`);
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

app.post("/auth/demo-reset", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "not authenticated" });
  }

  const steamId = req.user.steamId;
  if (steamId && integrityResults[steamId]) {
    delete integrityResults[steamId];
  }

  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true, resetIntegrity: Boolean(steamId) });
    });
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

function formatCurrency(cents) {
  return "$" + (cents / 100).toFixed(2);
}

function parseAmountToCents(amount) {
  if (typeof amount === "number") return Math.round(amount);
  if (typeof amount !== "string") return null;
  const normalized = amount.replace(/[$,\s]/g, "");
  const parsed = Number.parseFloat(normalized);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

function parseJsonSafely(raw, fallback = null) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function getDefaultMatchRules({ wagerType, matchProfile }) {
  if (wagerType === "bot_debug") {
    return {
      roundTarget: matchProfile === "fast_solo_debug" ? 1 : 3,
      startMoney: 16000,
      warmupSeconds: 15,
      botDifficulty: 2,
    };
  }

  return {
    roundTarget: 7,
    startMoney: 800,
    warmupSeconds: 5,
    botDifficulty: null,
  };
}

function normalizeMatchRules(rawRules, { wagerType, matchProfile }) {
  const defaults = getDefaultMatchRules({ wagerType, matchProfile });
  const parsed = rawRules && typeof rawRules === "object" ? rawRules : {};
  const roundTarget = Number(parsed.roundTarget);
  const startMoney = Number(parsed.startMoney);
  const warmupSeconds = Number(parsed.warmupSeconds);
  const botDifficulty = Number(parsed.botDifficulty);

  return {
    roundTarget:
      Number.isFinite(roundTarget) && roundTarget >= 1 && roundTarget <= 16
        ? Math.round(roundTarget)
        : defaults.roundTarget,
    startMoney:
      Number.isFinite(startMoney) && startMoney >= 800 && startMoney <= 16000
        ? Math.round(startMoney)
        : defaults.startMoney,
    warmupSeconds:
      Number.isFinite(warmupSeconds) && warmupSeconds >= 0 && warmupSeconds <= 300
        ? Math.round(warmupSeconds)
        : defaults.warmupSeconds,
    botDifficulty:
      wagerType === "bot_debug" && Number.isFinite(botDifficulty) && botDifficulty >= 0 && botDifficulty <= 3
        ? Math.round(botDifficulty)
        : defaults.botDifficulty,
  };
}

function serializeWager(row) {
  if (!row) return null;
  const matchSummary = row.match_id ? getMatchScoreSummary(row.match_id) : null;
  return {
    id: row.id,
    creator: row.creator_username,
    creatorSteamId: row.creator_steam_id,
    creatorAvatar: row.creator_avatar,
    opponent: row.opponent_username,
    opponentSteamId: row.opponent_steam_id,
    opponentAvatar: row.opponent_avatar,
    wagerType: row.wager_type || "pvp",
    matchProfile: row.match_profile || null,
    matchRules: parseJsonSafely(row.match_rules_json, null),
    isBotMatch: row.wager_type === "bot_debug",
    amount: formatCurrency(row.amount_cents),
    map: row.map,
    status: row.status,
    lockState: {
      playerA: Boolean(row.creator_locked_at),
      playerB: Boolean(row.opponent_locked_at),
    },
    creatorScore: matchSummary?.playerOneScore ?? null,
    opponentScore: matchSummary?.playerTwoScore ?? null,
    result:
      row.winner_name && row.loser_name
        ? { winner: row.winner_name, loser: row.loser_name }
        : null,
    timestamp: Date.parse(row.created_at),
    matchId: row.match_id,
  };
}

function serializeMatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    wagerId: row.wager_id,
    playerAName: row.player_one_name,
    playerBName: row.player_two_name,
    status: row.status,
    map: row.selected_map,
    region: row.region,
    serverSlotId: row.server_slot_id,
    serverIp: row.server_ip,
    serverPort: row.server_port,
    serverPassword: row.server_password,
    winner: row.winner_name,
    loser: row.loser_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function getMatchScoreSummary(matchId) {
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) return null;

  const events = db.prepare(`
    SELECT event_type, payload_json, created_at
    FROM server_events
    WHERE match_id = ?
    ORDER BY created_at ASC
  `).all(matchId);

  const playerTeams = {};
  let scoreCt = null;
  let scoreT = null;

  for (const event of events) {
    const payload = parseJsonSafely(event.payload_json, {});
    if (event.event_type === "player.team" && payload.playerName && payload.team) {
      playerTeams[payload.playerName] = payload.team;
    }
    if ((event.event_type === "round.win" || event.event_type === "match.score")
      && typeof payload.scoreCt === "number"
      && typeof payload.scoreT === "number") {
      scoreCt = payload.scoreCt;
      scoreT = payload.scoreT;
    }
  }

  const playerOneTeam = playerTeams[match.player_one_name];
  const playerTwoTeam = playerTeams[match.player_two_name];

  return {
    scoreCt,
    scoreT,
    playerOneScore:
      typeof scoreCt === "number" && typeof scoreT === "number"
        ? playerOneTeam === "CT"
          ? scoreCt
          : playerOneTeam === "TERRORIST"
            ? scoreT
            : null
        : null,
    playerTwoScore:
      typeof scoreCt === "number" && typeof scoreT === "number"
        ? playerTwoTeam === "CT"
          ? scoreCt
          : playerTwoTeam === "TERRORIST"
            ? scoreT
            : null
        : null,
  };
}

function serializeSlot(row) {
  if (!row) return null;
  return {
    id: row.id,
    slotName: row.slot_name,
    host: row.host,
    gamePort: row.game_port,
    gotvPort: row.gotv_port,
    rconPort: row.rcon_port,
    status: row.status,
    currentMatchId: row.current_match_id,
    lastHeartbeatAt: row.last_heartbeat_at,
    updatedAt: row.updated_at,
  };
}

function createServerEvent({
  matchId = null,
  slotId = null,
  eventType,
  payload = {},
  sourceEventId = null,
  createdAt = nowIso(),
}) {
  return db.prepare(`
    INSERT OR IGNORE INTO server_events (
      id, match_id, slot_id, event_type, source_event_id, payload_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(makeId("evt"), matchId, slotId, eventType, sourceEventId, JSON.stringify(payload), createdAt);
}

function hasControllerConfigured() {
  return Boolean(controllerUrl && controllerToken);
}

async function controllerRequest(method, pathname, body) {
  const response = await fetch(`${controllerUrl}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-controller-token": controllerToken,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `controller_${response.status}`);
  }
  return data;
}

// ── Balance state (in-memory) ──

const DEFAULT_DEMO_BALANCE_CENTS = 10000;
const balances = {}; // { "username": amountInCents }
const deposits = {}; // { "username": [{ piId, amount, refunded }] }

function getBalance(username) {
  return balances[username] ?? DEFAULT_DEMO_BALANCE_CENTS;
}

function addBalance(username, amountCents) {
  balances[username] = getBalance(username) + amountCents;
}

function deductBalance(username, amountCents) {
  balances[username] = getBalance(username) - amountCents;
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

app.post("/wagers/:wagerId/lock", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "not authenticated" });
  }

  const wager = db.prepare("SELECT * FROM wagers WHERE id = ?").get(req.params.wagerId);
  if (!wager) {
    return res.status(404).json({ error: "wager not found" });
  }
  if (!["open", "allocating_server", "server_ready", "awaiting_players", "live"].includes(wager.status)) {
    return res.status(400).json({ error: "wager is not lockable" });
  }

  const userSteamId = req.user.steamId;
  const userName = req.user.username;
  const amount = wager.amount_cents;
  const isCreator = wager.creator_steam_id === userSteamId;
  const isOpponent = wager.opponent_steam_id === userSteamId;

  if (!isCreator && !isOpponent) {
    return res.status(403).json({ error: "not authorized for this wager" });
  }

  const alreadyLocked = isCreator ? Boolean(wager.creator_locked_at) : Boolean(wager.opponent_locked_at);
  if (alreadyLocked) {
    return res.json({
      balance: getBalance(userName),
      wager: serializeWager(wager),
    });
  }

  const balance = getBalance(userName);
  if (balance < amount) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  deductBalance(userName, amount);
  const lockedAt = nowIso();
  db.prepare(`
    UPDATE wagers
    SET creator_locked_at = COALESCE(creator_locked_at, ?),
        opponent_locked_at = COALESCE(opponent_locked_at, ?),
        updated_at = ?
    WHERE id = ?
  `).run(
    isCreator ? lockedAt : null,
    isOpponent ? lockedAt : null,
    lockedAt,
    wager.id
  );

  const updatedWager = db.prepare("SELECT * FROM wagers WHERE id = ?").get(wager.id);
  console.log("[wager] locked", {
    wagerId: wager.id,
    username: userName,
    role: isCreator ? "creator" : "opponent",
    amount,
    balance: getBalance(userName),
  });
  res.json({
    balance: getBalance(userName),
    wager: serializeWager(updatedWager),
  });
});

// ── Match server management ──

let activeMatchId = null;
let latestMatchResult = null;
let skipRequested = false;
let mockServerProcess = null;
const matchLifecycleTimers = new Map();

function updateMatchStatus(matchId, status, extra = {}) {
  const current = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!current || ["completed", "cancelled", "abandoned", "failed"].includes(current.status)) {
    return;
  }

  const next = {
    player_one_name: current.player_one_name,
    player_one_steam_id: current.player_one_steam_id,
    player_two_name: current.player_two_name,
    player_two_steam_id: current.player_two_steam_id,
    wager_id: current.wager_id,
    selected_map: current.selected_map,
    region: current.region,
    server_slot_id: current.server_slot_id,
    server_ip: current.server_ip,
    server_port: current.server_port,
    server_password: current.server_password,
    winner_name: current.winner_name,
    loser_name: current.loser_name,
    started_at: current.started_at,
    completed_at: current.completed_at,
    ...extra,
  };

  db.prepare(`
    UPDATE matches
    SET status = ?, wager_id = ?, player_one_name = ?, player_one_steam_id = ?, player_two_name = ?,
        player_two_steam_id = ?, selected_map = ?, region = ?, server_slot_id = ?, server_ip = ?,
        server_port = ?, server_password = ?, winner_name = ?, loser_name = ?, started_at = ?,
        completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    status,
    next.wager_id,
    next.player_one_name,
    next.player_one_steam_id,
    next.player_two_name,
    next.player_two_steam_id,
    next.selected_map,
    next.region,
    next.server_slot_id,
    next.server_ip,
    next.server_port,
    next.server_password,
    next.winner_name,
    next.loser_name,
    next.started_at,
    next.completed_at,
    nowIso(),
    matchId
  );
}

function updateSlotStatus(slotId, status, currentMatchId = null) {
  db.prepare(`
    UPDATE server_slots
    SET status = ?, current_match_id = ?, updated_at = ?, last_heartbeat_at = ?
    WHERE id = ?
  `).run(status, currentMatchId, nowIso(), nowIso(), slotId);
}

function reconcileServerSlots() {
  db.prepare(`
    UPDATE server_slots
    SET status = 'available', current_match_id = NULL, updated_at = ?, last_heartbeat_at = ?
    WHERE status = 'allocated'
      AND (
        current_match_id IS NULL
        OR current_match_id NOT IN (
          SELECT id FROM matches
          WHERE status IN ('allocating_server', 'server_ready', 'awaiting_players', 'live')
        )
      )
  `).run(nowIso(), nowIso());
}

function scheduleMatchLifecycle(matchId, slotId) {
  const steps = [
    { delay: 1500, status: "server_ready", eventType: "server.ready" },
    { delay: 3500, status: "awaiting_players", eventType: "players.awaiting" },
    {
      delay: 6000,
      status: "live",
      eventType: "match.live",
      extra: { started_at: nowIso() },
    },
  ];

  const timers = steps.map(({ delay, status, eventType, extra }) =>
    setTimeout(() => {
      updateMatchStatus(matchId, status, extra);
      createServerEvent({
        matchId,
        slotId,
        eventType,
        payload: { status },
      });
    }, delay)
  );

  matchLifecycleTimers.set(matchId, timers);
}

function clearMatchLifecycle(matchId) {
  const timers = matchLifecycleTimers.get(matchId) || [];
  timers.forEach(clearTimeout);
  matchLifecycleTimers.delete(matchId);
}

function completeMatch(matchId, winnerName, loserName, source = "controller") {
  const activeMatch = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!activeMatch || activeMatch.status === "completed") {
    return latestMatchResult;
  }

  const wager = activeMatch.wager_id
    ? db.prepare("SELECT amount_cents, wager_type FROM wagers WHERE id = ?").get(activeMatch.wager_id)
    : null;
  const wagerAmount = wager?.amount_cents || 0;
  const isBotDebug = wager?.wager_type === "bot_debug";
  const pot = isBotDebug ? 0 : wagerAmount * 2;

  if (!isBotDebug) {
    addBalance(winnerName, pot);
  }

  clearMatchLifecycle(matchId);
  updateMatchStatus(matchId, "completed", {
    winner_name: winnerName,
    loser_name: loserName,
    completed_at: nowIso(),
  });
  if (activeMatch.server_slot_id) {
    updateSlotStatus(activeMatch.server_slot_id, "available", null);
  }
  createServerEvent({
    matchId,
    slotId: activeMatch.server_slot_id,
    eventType: "match.completed",
    payload: { winner: winnerName, loser: loserName, source },
  });

  if (activeMatch.wager_id) {
    db.prepare(`
      UPDATE wagers
      SET status = ?, winner_name = ?, loser_name = ?, updated_at = ?
      WHERE id = ?
    `).run("completed", winnerName, loserName, nowIso(), activeMatch.wager_id);
  }

  latestMatchResult = {
    matchId,
    winner: winnerName,
    loser: loserName,
    wagerAmount,
    debugMatch: isBotDebug,
    winnerBalance: getBalance(winnerName),
    loserBalance: getBalance(loserName),
  };

  if (activeMatchId === matchId) {
    activeMatchId = null;
    skipRequested = false;
  }

  console.log("[match] completed", {
    matchId,
    winner: winnerName,
    loser: loserName,
    source,
    pot,
  });

  return latestMatchResult;
}

function applyControllerEvent(match, event) {
  const payload = event.payload || {};
  const inserted = createServerEvent({
    matchId: match.id,
    slotId: match.server_slot_id,
    eventType: event.eventType,
    payload,
    sourceEventId: event.id,
    createdAt: event.createdAt || nowIso(),
  });

  if (!inserted.changes) {
    return;
  }

  switch (event.eventType) {
    case "server.ready":
      updateMatchStatus(match.id, "server_ready");
      break;
    case "player.connected":
    case "player.validated":
    case "player.joined":
    case "player.team":
      updateMatchStatus(
        match.id,
        match.started_at || match.status === "live" ? "live" : "awaiting_players",
        match.started_at || match.status === "live"
          ? { started_at: match.started_at || nowIso() }
          : {}
      );
      break;
    case "round.start":
    case "player.kill":
    case "round.win":
    case "match.score":
      updateMatchStatus(match.id, "live", {
        started_at: match.started_at || nowIso(),
      });
      break;
    case "match.completed":
      completeMatch(match.id, payload.winnerName, payload.loserName, "controller");
      break;
    default:
      break;
  }
}

async function syncControllerMatch(matchId) {
  if (!hasControllerConfigured()) {
    return null;
  }

  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match || !match.server_slot_id) {
    return match;
  }

  const data = await controllerRequest("GET", `/matches/${matchId}`);
  if (Array.isArray(data.events)) {
    for (const event of data.events) {
      applyControllerEvent(match, event);
    }
  }
  return db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
}

async function syncControllerSlots() {
  if (!hasControllerConfigured()) {
    return [];
  }

  const data = await controllerRequest("GET", "/slots");
  const slots = Array.isArray(data.slots) ? data.slots : [];

  for (const slot of slots) {
    db.prepare(`
      UPDATE server_slots
      SET host = ?, game_port = ?, gotv_port = ?, rcon_port = ?, status = ?,
          current_match_id = ?, last_heartbeat_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      slot.host || null,
      slot.gamePort || null,
      slot.gotvPort || null,
      slot.rconPort || null,
      slot.status || "available",
      slot.currentMatchId || null,
      slot.lastHeartbeatAt || nowIso(),
      nowIso(),
      slot.id
    );
  }

  return slots;
}

// Store match data and either call the VM controller or fall back to the local mock server.
app.post("/start-match-server", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "not authenticated" });
  }

  const { playerAName, playerBName, wagerAmount, map, wagerId, matchProfile, matchRules } = req.body || {};
  const wagerRecord = wagerId ? db.prepare("SELECT * FROM wagers WHERE id = ?").get(wagerId) : null;
  if (!wagerRecord) {
    return res.status(404).json({ error: "wager not found" });
  }
  if (wagerRecord.creator_steam_id !== req.user.steamId) {
    return res.status(403).json({ error: "only the wager creator can provision the server" });
  }

  const existingMatch = wagerRecord.match_id
    ? db.prepare("SELECT * FROM matches WHERE id = ?").get(wagerRecord.match_id)
    : null;
  if (existingMatch) {
    return res.json({
      ok: true,
      matchId: existingMatch.id,
      status: existingMatch.completed_at
        ? "completed"
        : existingMatch.started_at
          ? "live"
          : existingMatch.status || "allocating_server",
      map: existingMatch.selected_map,
      serverIp: existingMatch.server_ip,
      serverPort: existingMatch.server_port,
      serverPassword: existingMatch.server_password,
      slotId: existingMatch.server_slot_id,
    });
  }

  const wagerProfile = wagerRecord?.match_profile || null;
  const wagerType = wagerRecord?.wager_type || "pvp";
  const storedMatchRules = parseJsonSafely(wagerRecord?.match_rules_json, null);
  let allocatedSlotId = null;
  let pendingMatchId = null;
  const resolvedMatchProfile =
    matchProfile === "solo_debug" || matchProfile === "fast_solo_debug"
      ? matchProfile
      : wagerProfile === "solo_debug" || wagerProfile === "fast_solo_debug"
        ? wagerProfile
        : "duo_match";
  const resolvedPlayerBName =
    resolvedMatchProfile === "duo_match"
      ? playerBName
      : playerBName || wagerRecord?.opponent_username || "BotOpponent";
  const resolvedCreatorSteamId = wagerRecord?.creator_steam_id || req.user?.steamId || null;
  const resolvedOpponentSteamId =
    wagerType === "bot_debug" ? null : wagerRecord?.opponent_steam_id || null;
  const resolvedOpponentAvatar =
    wagerType === "bot_debug" ? null : wagerRecord?.opponent_avatar || null;
  const resolvedMatchRules = normalizeMatchRules(matchRules || storedMatchRules, {
    wagerType,
    matchProfile: resolvedMatchProfile,
  });

  if (!playerAName || !resolvedPlayerBName || !wagerAmount) {
    return res.status(400).json({ error: "player names and wager amount are required" });
  }

  try {
    await syncControllerSlots();
    reconcileServerSlots();

    const availableSlot = db
      .prepare("SELECT * FROM server_slots WHERE status = 'available' ORDER BY slot_name LIMIT 1")
      .get();
    if (!availableSlot) {
      return res.status(409).json({ error: "No available server slots" });
    }

    const matchId = makeId("match");
    pendingMatchId = matchId;
    const validWagerId = wagerRecord?.id || null;
    const password = Math.random().toString(36).slice(2, 8);
    const createdAt = nowIso();

    db.prepare(`
      INSERT INTO matches (
        id, wager_id, player_one_name, player_one_steam_id, player_two_name, player_two_steam_id,
        status, selected_map, region, server_slot_id, server_ip, server_port, server_password,
        winner_name, loser_name, started_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      matchId,
      validWagerId,
      playerAName,
      resolvedCreatorSteamId,
      resolvedPlayerBName,
      resolvedOpponentSteamId,
      "allocating_server",
      map || "de_dust2",
      "NA",
      availableSlot.id,
      availableSlot.host,
      availableSlot.game_port,
      password,
      null,
      null,
      null,
      null,
      createdAt,
      createdAt
    );

    allocatedSlotId = availableSlot.id;
    updateSlotStatus(availableSlot.id, "allocated", matchId);
    createServerEvent({
      matchId,
      slotId: availableSlot.id,
      eventType: "slot.allocated",
      payload: { slotId: availableSlot.id, host: availableSlot.host, gamePort: availableSlot.game_port },
    });

    if (validWagerId) {
      db.prepare(`
        UPDATE wagers
        SET opponent_username = ?, opponent_steam_id = ?, opponent_avatar = ?, status = ?, match_id = ?, updated_at = ?
        WHERE id = ?
      `).run(
        resolvedPlayerBName,
        resolvedOpponentSteamId,
        resolvedOpponentAvatar,
        "allocating_server",
        matchId,
        nowIso(),
        validWagerId
      );
    }

    const activeMatch = {
      matchId,
      playerAName,
      playerBName: resolvedPlayerBName,
      wagerAmount,
      map: map || "de_dust2",
      matchProfile: resolvedMatchProfile,
      matchRules: resolvedMatchRules,
      status: "allocating_server",
      serverIp: availableSlot.host,
      serverPort: availableSlot.game_port,
      serverPassword: password,
      slotId: availableSlot.id,
    };
    activeMatchId = matchId;
    latestMatchResult = null;
    skipRequested = false;

    if (hasControllerConfigured()) {
      const controllerResponse = await controllerRequest(
        "POST",
        `/slots/${availableSlot.id}/start-match`,
        {
          matchId,
          playerAName,
          playerBName: resolvedPlayerBName,
          map: activeMatch.map,
          serverPassword: activeMatch.serverPassword,
          hostname: `SafeWager ${playerAName} vs ${resolvedPlayerBName}`,
          matchProfile: resolvedMatchProfile,
          matchRules: resolvedMatchRules,
        }
      );

      db.prepare(`
        UPDATE matches
        SET server_ip = ?, server_port = ?, server_password = ?, updated_at = ?
        WHERE id = ?
      `).run(
        controllerResponse.host || activeMatch.serverIp,
        controllerResponse.gamePort || activeMatch.serverPort,
        controllerResponse.serverPassword || activeMatch.serverPassword,
        nowIso(),
        matchId
      );

      console.log("[match] start-match-server — controller request sent", {
        matchId,
        playerA: playerAName,
        playerB: resolvedPlayerBName,
        matchProfile: resolvedMatchProfile,
        slotId: availableSlot.id,
      });

      return res.json({
        ok: true,
        matchId,
        status: controllerResponse.status || "allocating_server",
        map: activeMatch.map,
        serverIp: controllerResponse.host || activeMatch.serverIp,
        serverPort: controllerResponse.gamePort || activeMatch.serverPort,
        serverPassword: controllerResponse.serverPassword || activeMatch.serverPassword,
        slotId: availableSlot.id,
      });
    }

    clearMatchLifecycle(matchId);
    scheduleMatchLifecycle(matchId, availableSlot.id);

    if (mockServerProcess) {
      mockServerProcess.kill();
      mockServerProcess = null;
    }

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
      matchId,
      map: activeMatch.map,
      playerA: playerAName,
      playerB: resolvedPlayerBName,
      matchProfile: resolvedMatchProfile,
      wagerAmount,
      slotId: availableSlot.id,
    });

    return res.json({
      ok: true,
      matchId,
      status: "allocating_server",
      map: activeMatch.map,
      serverIp: activeMatch.serverIp,
      serverPort: activeMatch.serverPort,
      serverPassword: activeMatch.serverPassword,
      slotId: activeMatch.slotId,
    });
  } catch (err) {
    if (pendingMatchId) {
      updateMatchStatus(pendingMatchId, "failed");
    }
    if (allocatedSlotId) {
      updateSlotStatus(allocatedSlotId, "available", null);
    }
    console.error("[match] start-match-server error", err.message);
    return res.status(500).json({ error: err.message || "server_error" });
  }
});

// Mock server fetches this to know who's playing.
app.get("/active-match", (_req, res) => {
  if (!activeMatchId) {
    return res.status(404).json({ error: "no active match" });
  }
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(activeMatchId);
  if (!match) {
    return res.status(404).json({ error: "no active match" });
  }
  res.json({
    matchId: match.id,
    playerAName: match.player_one_name,
    playerBName: match.player_two_name,
    wagerAmount: match.wager_id
      ? db.prepare("SELECT amount_cents FROM wagers WHERE id = ?").get(match.wager_id)?.amount_cents || 0
      : 0,
    map: match.selected_map,
    status: match.status,
    serverIp: match.server_ip,
    serverPort: match.server_port,
    serverPassword: match.server_password,
  });
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
    if (!activeMatchId) {
      return res.status(400).json({ error: "no active match to resolve" });
    }
    if (!winner || (winner !== "A" && winner !== "B")) {
      return res.status(400).json({ error: "winner must be 'A' or 'B'" });
    }

    const activeMatch = db.prepare("SELECT * FROM matches WHERE id = ?").get(activeMatchId);
    if (!activeMatch) {
      return res.status(400).json({ error: "active match record not found" });
    }

    const winnerName = winner === "A" ? activeMatch.player_one_name : activeMatch.player_two_name;
    const loserName = winner === "A" ? activeMatch.player_two_name : activeMatch.player_one_name;
    res.json(completeMatch(activeMatchId, winnerName, loserName, "mock-server"));
  } catch (err) {
    console.error("[match] resolve error", err.message);
    res.status(500).json({ error: err.message || "server_error" });
  }
});

// Frontend polls this to check if the match has been resolved.
app.get("/match-result", async (_req, res) => {
  if (activeMatchId && hasControllerConfigured()) {
    try {
      await syncControllerMatch(activeMatchId);
    } catch (err) {
      console.error("[match] controller sync error", err.message);
    }
  }
  if (!latestMatchResult) {
    return res.json({ resolved: false });
  }
  res.json({ resolved: true, ...latestMatchResult });
});

// ── Integrity check state ──

const integrityResults = {}; // { steamId: { stats, timestamp, passed } }

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

  const { amount, map, opponentType, matchProfile, matchRules } = req.body || {};
  if (!amount || !map) {
    return res.status(400).json({ error: "amount and map are required" });
  }

  const wagerType = opponentType === "bot" ? "bot_debug" : "pvp";
  const resolvedMatchProfile =
    wagerType === "bot_debug"
      ? matchProfile === "fast_solo_debug"
        ? "fast_solo_debug"
        : "solo_debug"
      : null;
  const resolvedMatchRules = normalizeMatchRules(matchRules, {
    wagerType,
    matchProfile: resolvedMatchProfile,
  });

  // Check integrity
  const integrity = getIntegrity(req.user.steamId);
  if (!integrity || integrity.expired) {
    return res.status(403).json({ error: "Integrity check required (expired or missing)" });
  }
  if (!integrity.passed) {
    return res.status(403).json({ error: "Integrity check failed — cheating percentage too high" });
  }

  const amountCents = parseAmountToCents(amount);
  if (!amountCents) {
    return res.status(400).json({ error: "amount must be a positive currency value" });
  }

  const wagerId = makeId("wager");
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO wagers (
      id, creator_username, creator_steam_id, creator_avatar, opponent_username,
      opponent_steam_id, opponent_avatar, wager_type, match_profile, match_rules_json, amount_cents, map, status, match_id, winner_name, loser_name,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    wagerId,
    req.user.username,
    req.user.steamId,
    req.user.avatar || null,
    wagerType === "bot_debug" ? "BotOpponent" : null,
    null,
    null,
    wagerType,
    resolvedMatchProfile,
    JSON.stringify(resolvedMatchRules),
    amountCents,
    map,
    "open",
    null,
    null,
    null,
    createdAt,
    createdAt
  );

  const wager = db.prepare("SELECT * FROM wagers WHERE id = ?").get(wagerId);
  console.log("[wager] created", {
    id: wagerId,
    creator: req.user.username,
    amount: amountCents,
    map,
    wagerType,
    matchProfile: resolvedMatchProfile,
    matchRules: resolvedMatchRules,
  });
  res.json(serializeWager(wager));
});

// List all open wagers.
app.get("/wagers", (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM wagers
    WHERE status IN ('open', 'allocating_server', 'server_ready', 'awaiting_players', 'live')
      AND (
        wager_type = 'pvp'
        OR (wager_type = 'bot_debug' AND creator_steam_id = ?)
      )
    ORDER BY created_at DESC
  `).all(req.user?.steamId || "");
  res.json(rows.map(serializeWager));
});

app.post("/wagers/:wagerId/join", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "not authenticated" });
  }

  const wager = db.prepare("SELECT * FROM wagers WHERE id = ?").get(req.params.wagerId);
  if (!wager) {
    return res.status(404).json({ error: "wager not found" });
  }
  if (wager.wager_type === "bot_debug") {
    return res.status(400).json({ error: "bot debug wagers cannot be joined" });
  }
  if (!["open", "allocating_server", "server_ready", "awaiting_players", "live"].includes(wager.status)) {
    return res.status(400).json({ error: "wager is not joinable" });
  }
  if (wager.creator_steam_id === req.user.steamId) {
    return res.json(serializeWager(wager));
  }
  if (wager.opponent_steam_id && wager.opponent_steam_id !== req.user.steamId) {
    return res.status(409).json({ error: "wager already has a challenger" });
  }

  db.prepare(`
    UPDATE wagers
    SET opponent_username = ?, opponent_steam_id = ?, opponent_avatar = ?, updated_at = ?
    WHERE id = ?
  `).run(
    req.user.username,
    req.user.steamId,
    req.user.avatar || null,
    nowIso(),
    wager.id
  );

  res.json(serializeWager(db.prepare("SELECT * FROM wagers WHERE id = ?").get(wager.id)));
});

app.delete("/wagers/:wagerId", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "not authenticated" });
  }

  const wager = db.prepare("SELECT * FROM wagers WHERE id = ?").get(req.params.wagerId);
  if (!wager) {
    return res.status(404).json({ error: "wager not found" });
  }
  if (wager.creator_steam_id !== req.user.steamId) {
    return res.status(403).json({ error: "not authorized" });
  }
  if (!["open", "allocating_server", "server_ready", "awaiting_players", "live"].includes(wager.status)) {
    return res.status(400).json({ error: "wager is not deletable" });
  }

  const linkedMatch = wager.match_id
    ? db.prepare("SELECT * FROM matches WHERE id = ?").get(wager.match_id)
    : null;

  try {
    if (linkedMatch?.server_slot_id && hasControllerConfigured()) {
      try {
        await controllerRequest("POST", `/slots/${linkedMatch.server_slot_id}/stop-match`, {});
      } catch (err) {
        console.error("[wager] controller stop-match failed", {
          wagerId: wager.id,
          matchId: linkedMatch.id,
          slotId: linkedMatch.server_slot_id,
          error: err.message,
        });
      }
    }

    if (linkedMatch) {
      clearMatchLifecycle(linkedMatch.id);
      updateMatchStatus(linkedMatch.id, "cancelled", {
        completed_at: nowIso(),
      });

      if (linkedMatch.server_slot_id) {
        updateSlotStatus(linkedMatch.server_slot_id, "available", null);
      }

      createServerEvent({
        matchId: linkedMatch.id,
        slotId: linkedMatch.server_slot_id,
        eventType: "match.cancelled",
        payload: {
          reason: "wager_deleted",
          wagerId: wager.id,
        },
      });

      if (activeMatchId === linkedMatch.id) {
        activeMatchId = null;
        skipRequested = false;
      }
    }

    db.prepare(`
      UPDATE wagers
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run("cancelled", nowIso(), wager.id);

    console.log("[wager] deleted", {
      wagerId: wager.id,
      creator: req.user.username,
      linkedMatchId: linkedMatch?.id || null,
    });

    res.json({ ok: true, wagerId: wager.id, matchId: linkedMatch?.id || null });
  } catch (err) {
    console.error("[wager] delete failed", err);
    res.status(500).json({ error: "failed to delete wager" });
  }
});

// Update wager result after match resolves.
app.post("/wager-result", (req, res) => {
  const { wagerId, winner, loser } = req.body || {};
  const wager = db.prepare("SELECT * FROM wagers WHERE id = ?").get(wagerId);
  if (!wager) {
    return res.status(404).json({ error: "wager not found" });
  }
  db.prepare(`
    UPDATE wagers
    SET status = ?, winner_name = ?, loser_name = ?, updated_at = ?
    WHERE id = ?
  `).run("completed", winner || null, loser || null, nowIso(), wagerId);
  res.json(serializeWager(db.prepare("SELECT * FROM wagers WHERE id = ?").get(wagerId)));
});

// Get profile data for a user (integrity + wager history).
app.get("/profile/:steamId", (req, res) => {
  const { steamId } = req.params;
  const integrity = getIntegrity(steamId);
  const userWagers = db.prepare(`
    SELECT * FROM wagers
    WHERE creator_steam_id = ? OR opponent_steam_id = ?
    ORDER BY created_at DESC
  `).all(steamId, steamId);
  res.json({ integrity, wagers: userWagers.map(serializeWager) });
});

// ── Pre-VM server orchestration scaffolding ──

app.get("/server-slots", (_req, res) => {
  const rows = db.prepare("SELECT * FROM server_slots ORDER BY slot_name").all();
  res.json(rows.map(serializeSlot));
});

app.get("/matches/:matchId", async (req, res) => {
  try {
    if (hasControllerConfigured()) {
      await syncControllerMatch(req.params.matchId);
    }
  } catch (err) {
    console.error("[match] controller sync error", err.message);
  }

  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(req.params.matchId);
  if (!match) {
    return res.status(404).json({ error: "match not found" });
  }
  const events = db.prepare(`
    SELECT * FROM server_events
    WHERE match_id = ?
    ORDER BY created_at ASC
  `).all(req.params.matchId);

  res.json({
    match: serializeMatch(match),
    events: events.map((event) => ({
      id: event.id,
      eventType: event.event_type,
      payload: JSON.parse(event.payload_json),
      createdAt: event.created_at,
    })),
  });
});

app.post("/internal/server-events", (req, res) => {
  const { matchId, slotId, eventType, payload } = req.body || {};
  if (!eventType) {
    return res.status(400).json({ error: "eventType is required" });
  }
  createServerEvent({
    matchId: matchId || null,
    slotId: slotId || null,
    eventType,
    payload: payload || {},
  });
  res.json({ ok: true });
});

app.post("/internal/slot-heartbeat", (req, res) => {
  const { slotId, status } = req.body || {};
  if (!slotId) {
    return res.status(400).json({ error: "slotId is required" });
  }

  const slot = db.prepare("SELECT * FROM server_slots WHERE id = ?").get(slotId);
  if (!slot) {
    return res.status(404).json({ error: "slot not found" });
  }

  updateSlotStatus(slotId, status || slot.status, slot.current_match_id || null);
  createServerEvent({
    matchId: slot.current_match_id,
    slotId,
    eventType: "slot.heartbeat",
    payload: { status: status || slot.status },
  });
  res.json({ ok: true });
});

app.post("/internal/match-result", (req, res) => {
  const { matchId, winnerName, loserName } = req.body || {};
  if (!matchId || !winnerName || !loserName) {
    return res.status(400).json({ error: "matchId, winnerName, and loserName are required" });
  }

  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) {
    return res.status(404).json({ error: "match not found" });
  }

  completeMatch(matchId, winnerName, loserName, "controller-callback");
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Backend running on ${backendBaseUrl || `http://localhost:${port}`}`);
  console.log(`[config] app origin ${appOrigin}`);
  console.log(`[db] SQLite ready at ${dbPath}`);
});
