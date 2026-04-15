import { useState } from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import "./App.css";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
const API_URL = "http://localhost:4242";

const STRIPE_APPEARANCE = {
  theme: "night",
  variables: {
    colorPrimary: "#ff7a1a",
    colorBackground: "#151c25",
    colorText: "#e5e7eb",
    colorDanger: "#ff4d4d",
    borderRadius: "10px",
    fontFamily: "Space Grotesk, system-ui, sans-serif",
  },
  rules: {
    ".Input": {
      border: "1px solid rgba(255,255,255,0.1)",
      boxShadow: "none",
    },
    ".Input:focus": {
      border: "1px solid #ff7a1a",
      boxShadow: "0 0 0 1px #ff7a1a",
    },
  },
};

/* ─── Demo users ─── */
const USERS = [
  {
    id: "u1",
    name: "s1mple_god_12",
    initials: "s1",
    rank: "LEVEL 10 FACEIT",
  },
  {
    id: "u2",
    name: "ZywOo_Fan_99",
    initials: "ZW",
    rank: "GLOBAL ELITE",
  },
];

const MAPS = [
  "DE_DUST2",
  "DE_MIRAGE",
  "DE_INFERNO",
  "DE_NUKE",
  "DE_OVERPASS",
  "DE_ANUBIS",
  "AIM_MAP_PRO_V2",
];

/* ─── Setup form for saving a card (inside SetupIntent Elements) ─── */
function SetupForm({ onSaved }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setLoading(true);
    setError(null);

    const { error: setupError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });

    if (setupError) {
      setError(setupError.message);
      setLoading(false);
    } else if (setupIntent && setupIntent.status === "succeeded") {
      onSaved(setupIntent.payment_method);
    } else {
      setError("Unexpected status: " + setupIntent?.status);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="checkout-form">
      <PaymentElement />
      {error && <p className="payment-error">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || loading}
        className="step-btn primary"
      >
        {loading ? "Saving..." : "Save Card"}
      </button>
    </form>
  );
}

/* ─── Main App ─── */
export default function App() {
  // Auth / user switching
  const [currentUser, setCurrentUser] = useState(USERS[1]); // default ZywOo

  // Per-user wallets: { "username": { customerId, savedCard } }
  const [wallets, setWallets] = useState({});

  // Per-user balances (in cents): { "username": amountCents }
  const [balances, setBalances] = useState({});

  // Dynamic wager list (starts empty for demo)
  const [wagers, setWagers] = useState([]);

  // Create wager modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createMap, setCreateMap] = useState(MAPS[0]);
  const [createAmount, setCreateAmount] = useState("5.00");

  // Wager modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeWagerId, setActiveWagerId] = useState(null);
  const [lockState, setLockState] = useState({
    playerA: false,
    playerB: false,
  });
  const [matchPlayers, setMatchPlayers] = useState({ a: null, b: null });
  const [matchError, setMatchError] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);
  const [matchResult, setMatchResult] = useState(null);
  const [resultPolling, setResultPolling] = useState(false);

  // Wallet modal
  const [walletOpen, setWalletOpen] = useState(false);
  const [setupSecret, setSetupSecret] = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [depositAmount, setDepositAmount] = useState("20.00");
  const [depositLoading, setDepositLoading] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [walletError, setWalletError] = useState(null);

  const activeWager = wagers.find((w) => w.id === activeWagerId) || null;
  const bothLocked = lockState.playerA && lockState.playerB;

  // Current user's wallet & balance
  const myWallet = wallets[currentUser.name] || {};
  const mySavedCard = myWallet.savedCard || null;
  const myCustomerId = myWallet.customerId || null;
  const myBalance = balances[currentUser.name] || 0;

  // Which role does the current user have in the active match?
  const isPlayerA = currentUser.name === matchPlayers.a;
  const isPlayerB = currentUser.name === matchPlayers.b;

  /* ── Wallet helpers ── */
  const updateWallet = (username, updates) => {
    setWallets((prev) => ({
      ...prev,
      [username]: { ...(prev[username] || {}), ...updates },
    }));
  };

  const updateBalance = (username, newBalanceCents) => {
    setBalances((prev) => ({ ...prev, [username]: newBalanceCents }));
  };

  const fetchBalance = async (username) => {
    try {
      const res = await fetch(`${API_URL}/balance/${username}`);
      const data = await res.json();
      updateBalance(username, data.balance);
    } catch {
      // ignore
    }
  };

  const switchUser = (user) => {
    setCurrentUser(user);
    setSetupSecret(null);
    setWalletOpen(false);
    setWalletError(null);
    fetchBalance(user.name);
  };

  /* ── Wallet: create customer + setup intent ── */
  const openWallet = async () => {
    setWalletOpen(true);
    setWalletError(null);
    setWithdrawAmount("");
    if (mySavedCard) return;
    if (setupSecret) return;

    setWalletLoading(true);
    try {
      let custId = myCustomerId;
      if (!custId) {
        const custRes = await fetch(`${API_URL}/create-customer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: currentUser.name }),
        });
        const custData = await custRes.json();
        custId = custData.customerId;
        updateWallet(currentUser.name, { customerId: custId });
      }

      const setupRes = await fetch(`${API_URL}/create-setup-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: custId }),
      });
      const setupData = await setupRes.json();
      setSetupSecret(setupData.clientSecret);
    } catch (err) {
      console.error("Wallet setup failed:", err);
    }
    setWalletLoading(false);
  };

  const handleCardSaved = async (paymentMethodId) => {
    const custId = wallets[currentUser.name]?.customerId;
    try {
      const res = await fetch(`${API_URL}/payment-methods/${custId}`);
      const data = await res.json();
      const card = data.paymentMethods.find((m) => m.id === paymentMethodId);
      if (card) {
        updateWallet(currentUser.name, { savedCard: card });
        setSetupSecret(null);
      }
    } catch (err) {
      console.error("Failed to fetch saved card:", err);
    }
  };

  const removeCard = () => {
    updateWallet(currentUser.name, { savedCard: null });
    setSetupSecret(null);
  };

  /* ── Deposit with saved card ── */
  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) return;
    if (!mySavedCard || !myCustomerId) return;

    setDepositLoading(true);
    setWalletError(null);
    try {
      const res = await fetch(`${API_URL}/deposit-with-saved-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: currentUser.name,
          customerId: myCustomerId,
          paymentMethodId: mySavedCard.id,
          amount: Math.round(amount * 100),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Deposit failed");
      updateBalance(currentUser.name, data.balance);
    } catch (err) {
      setWalletError(err.message);
    }
    setDepositLoading(false);
  };

  /* ── Withdraw ── */
  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) return;
    const amountCents = Math.round(amount * 100);
    if (amountCents > myBalance) return;

    setWithdrawLoading(true);
    setWalletError(null);
    try {
      const res = await fetch(`${API_URL}/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: currentUser.name,
          amount: amountCents,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Withdrawal failed");
      updateBalance(currentUser.name, data.balance);
      setWithdrawAmount("");
    } catch (err) {
      setWalletError(err.message);
    }
    setWithdrawLoading(false);
  };

  /* ── Open wager modal ── */
  const openWagerModal = async (wager) => {
    // If reopening the same wager as the same user, just show it
    if (wager.id === activeWagerId && matchPlayers.a && (isPlayerA || isPlayerB)) {
      setIsModalOpen(true);
      return;
    }

    const isCreator = wager.user === currentUser.name;

    setActiveWagerId(wager.id);
    setIsModalOpen(true);
    setMatchError(null);
    setServerInfo(null);
    setMatchResult(null);
    setLockState({ playerA: false, playerB: false });

    if (isCreator) {
      // Creator viewing their own wager — no opponent yet
      setMatchPlayers({ a: wager.user, b: null });
      return;
    }

    // Another user is joining
    setMatchPlayers({ a: wager.user, b: currentUser.name });
  };

  /* ── Lock in wager (balance-based) ── */
  const handleLockIn = async (slot) => {
    const isA = slot === "A";
    const playerName = isA ? matchPlayers.a : matchPlayers.b;
    const amountCents = Math.round(
      parseFloat(activeWager.amount.replace("$", "")) * 100
    );

    try {
      const res = await fetch(`${API_URL}/lock-wager`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: playerName, amount: amountCents }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lock-in failed");

      updateBalance(playerName, data.balance);
      setLockState((prev) => ({
        ...prev,
        [isA ? "playerA" : "playerB"]: true,
      }));
    } catch (err) {
      setMatchError(err.message);
    }
  };

  /* ── Provision server + poll for match result ── */
  const finalizeMatch = async () => {
    if (!activeWager) return;
    setServerInfo({ loading: true });
    setMatchResult(null);

    const amountCents = Math.round(
      parseFloat(activeWager.amount.replace("$", "")) * 100
    );

    try {
      const res = await fetch(`${API_URL}/start-match-server`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerAName: matchPlayers.a,
          playerBName: matchPlayers.b,
          wagerAmount: amountCents,
          map: activeWager?.map || "de_dust2",
        }),
      });
      if (!res.ok) throw new Error("Failed to start match server");

      setServerInfo({
        name: "sw-1v1-NA-042",
        status: "Match in progress",
        map: activeWager?.map || "de_dust2",
      });

      // Start polling for match result
      setResultPolling(true);
      const poll = setInterval(async () => {
        try {
          const r = await fetch(`${API_URL}/match-result`);
          const data = await r.json();
          if (data.resolved) {
            clearInterval(poll);
            setResultPolling(false);
            setMatchResult(data);
            // Update both players' balances from result
            updateBalance(data.winner, data.winnerBalance);
            updateBalance(data.loser, data.loserBalance);
          }
        } catch {
          // ignore polling errors
        }
      }, 3000);
    } catch (err) {
      setServerInfo(null);
      setMatchError(err.message);
    }
  };

  /* ── Create wager ── */
  const createWager = () => {
    const amount = parseFloat(createAmount);
    if (isNaN(amount) || amount <= 0) return;

    const wager = {
      id: "w" + Date.now(),
      user: currentUser.name,
      level: currentUser.rank,
      ping: Math.floor(Math.random() * 30 + 8) + "ms",
      map: createMap,
      amount: "$" + amount.toFixed(2),
      status: "ACTIVE CHALLENGE",
      cta: "JOIN WAGER",
      accent: "active",
    };

    setWagers((prev) => [wager, ...prev]);
    setCreateOpen(false);
    setCreateAmount("5.00");
    setCreateMap(MAPS[0]);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    // Keep lockState, matchPlayers, etc. so reopening preserves state
  };

  const abandonMatch = () => {
    setIsModalOpen(false);
    setActiveWagerId(null);
    setMatchPlayers({ a: null, b: null });
    setMatchError(null);
    setServerInfo(null);
    setMatchResult(null);
    setResultPolling(false);
    setLockState({ playerA: false, playerB: false });
  };

  /* ── Format cents to dollars ── */
  const fmt = (cents) => "$" + (cents / 100).toFixed(2);

  /* ── Render a player slot in the wager modal ── */
  const renderPlayerSlot = (slot) => {
    const isA = slot === "A";
    const playerName = isA ? matchPlayers.a : matchPlayers.b;
    const locked = isA ? lockState.playerA : lockState.playerB;
    const isMe = isA ? isPlayerA : isPlayerB;
    const playerBalance = balances[playerName] || 0;
    const amountCents = activeWager
      ? Math.round(parseFloat(activeWager.amount.replace("$", "")) * 100)
      : 0;

    // Already locked — show badge
    if (locked) {
      return (
        <div className="locked-badge">
          <span className="locked-icon">&#10003;</span> Locked In
        </div>
      );
    }

    // This is MY slot — show lock-in button
    if (isMe) {
      const canAfford = playerBalance >= amountCents;
      return (
        <div className="balance-lockin">
          <div className="balance-lockin-info">
            <span className="balance-label">Balance:</span>
            <span className={`balance-value ${canAfford ? "" : "insufficient"}`}>
              {fmt(playerBalance)}
            </span>
          </div>
          {canAfford ? (
            <button
              className="step-btn primary"
              onClick={() => handleLockIn(slot)}
            >
              Lock In {activeWager?.amount}
            </button>
          ) : (
            <div className="insufficient-msg">
              Insufficient balance — deposit funds in your wallet
            </div>
          )}
        </div>
      );
    }

    // NOT my slot — show waiting
    return (
      <div className="waiting-badge">
        Waiting for {playerName} to lock in...
      </div>
    );
  };

  return (
    <div className="shell">
      {/* ──── Rail ──── */}
      <aside className="rail">
        <div className="logo">sw</div>
        <div className="rail-icons">
          <button className="rail-btn active">#</button>
          <button className="rail-btn">&#127919;</button>
          <button className="rail-btn">&#128172;</button>
          <button className="rail-btn">&#127942;</button>
        </div>
        <div className="rail-footer">
          <div className="presence" />
        </div>
      </aside>

      {/* ──── Sidebar ──── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-title">GLOBAL HUB</span>
          <span className="sidebar-dot" />
        </div>
        <div className="sidebar-section">
          <p className="sidebar-label">INFORMATION</p>
          <button className="sidebar-link">rules-and-faq</button>
          <button className="sidebar-link">announcements</button>
        </div>
        <div className="sidebar-section">
          <p className="sidebar-label">MATCHMAKING</p>
          <button className="sidebar-link active">find-a-match</button>
          <button className="sidebar-link">wager-feed</button>
        </div>
        <div className="sidebar-section">
          <p className="sidebar-label">SUPPORT</p>
          <button className="sidebar-link">ticket-support</button>
        </div>

        {/* User switcher */}
        <div className="user-switcher">
          <p className="sidebar-label">SWITCH PLAYER</p>
          {USERS.map((user) => (
            <button
              key={user.id}
              className={`user-switch-btn ${
                currentUser.id === user.id ? "active" : ""
              }`}
              onClick={() => switchUser(user)}
            >
              <div className="avatar">{user.initials}</div>
              <div>
                <p className="profile-name">{user.name}</p>
                <p className="profile-rank">{user.rank}</p>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* ──── Main ──── */}
      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <span className="topbar-hash">#</span>
            <span className="topbar-title">FIND-A-MATCH</span>
            <span className="topbar-user">
              Playing as <strong>{currentUser.name}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <button
              className={`pill wallet-pill ${mySavedCard ? "has-card" : ""}`}
              onClick={openWallet}
            >
              {mySavedCard
                ? `${mySavedCard.brand.toUpperCase()} •••• ${mySavedCard.last4}`
                : "Add Payment"}
            </button>
            <div className="pill balance-pill" onClick={openWallet}>
              {fmt(myBalance)}
            </div>
            <div className="icon-btn">&#128276;</div>
            <div className="icon-btn">?</div>
          </div>
        </header>

        {/* ── Active wager banner ── */}
        {activeWagerId && (isPlayerA || isPlayerB) && !matchResult && (() => {
          const myLock = isPlayerA ? lockState.playerA : lockState.playerB;
          const theirLock = isPlayerA ? lockState.playerB : lockState.playerA;
          const opponentName = isPlayerA ? matchPlayers.b : matchPlayers.a;

          let bannerClass = "wager-banner";
          let label = "";

          if (!matchPlayers.b) {
            bannerClass += " waiting";
            label = `Your wager is live — waiting for a challenger`;
          } else if (theirLock && !myLock) {
            bannerClass += " urgent";
            label = `${opponentName} locked in — your turn!`;
          } else if (bothLocked && serverInfo && !serverInfo.loading) {
            bannerClass += " live";
            label = "Match is live";
          } else if (bothLocked) {
            bannerClass += " ready";
            label = "Both locked in — match ready";
          } else if (myLock && !theirLock) {
            bannerClass += " waiting";
            label = `Waiting for ${opponentName} to lock in...`;
          } else {
            bannerClass += " active";
            label = `Active wager — ${activeWager?.amount} on ${activeWager?.map}`;
          }

          return (
            <button className={bannerClass} onClick={() => setIsModalOpen(true)}>
              <span className="banner-dot" />
              <span className="banner-label">{label}</span>
              <span className="banner-action">View</span>
            </button>
          );
        })()}

        <section className="content">
          <div className="content-header">
            <div>
              <h1>PUBLIC WAGERS</h1>
              <p>Live matches waiting for challengers.</p>
            </div>
            <button className="cta-primary" onClick={() => setCreateOpen(true)}>+ Create Wager</button>
          </div>

          <div className="filters">
            <button className="filter active">ALL MODES</button>
            <button className="filter">1V1 AIM MAP</button>
            <button className="filter">2V2 WINGMAN</button>
            <button className="filter">NA WEST</button>
          </div>

          <div className="wager-list">
            {wagers.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">&#9876;</div>
                <h3>No active wagers</h3>
                <p>Create a wager to get started.</p>
                <button className="cta-primary" onClick={() => setCreateOpen(true)}>+ Create Wager</button>
              </div>
            )}
            {wagers.map((wager) => (
              <article
                key={wager.id}
                className={`wager-card ${
                  activeWagerId === wager.id ? "selected" : ""
                }`}
              >
                <div className="wager-top">
                  <div className="wager-user">
                    <div className="avatar large">
                      {wager.user.slice(0, 2)}
                    </div>
                    <div>
                      <p className="wager-name">{wager.user}</p>
                      <p className="wager-meta">
                        {wager.level} | PING: {wager.ping}
                      </p>
                    </div>
                  </div>
                  <div className={`wager-amount ${wager.accent}`}>
                    <span>{wager.amount}</span>
                    <small>{wager.status}</small>
                  </div>
                </div>
                <div className="wager-map">
                  <div>
                    <p className="label">SELECTED MAP</p>
                    <p className="map-name">{wager.map}</p>
                  </div>
                  <div className="map-thumb">MAP</div>
                </div>
                <div className="wager-actions">
                  <button
                    className="cta-join"
                    onClick={() => openWagerModal(wager)}
                  >
                    {activeWagerId === wager.id
                      ? "VIEW WAGER"
                      : wager.user === currentUser.name
                        ? "YOUR WAGER"
                        : wager.cta}
                  </button>
                  <button className="ghost-btn">&#128065;</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>

      {/* ──── Right bar ──── */}
      <aside className="rightbar">
        <div className="rightbar-header">ONLINE PLAYERS — 2,842</div>
        <div className="panel">
          <p className="panel-title">FRIENDS</p>
          <div className="friend">
            <div className="avatar">RM</div>
            <div>
              <p>RainMaker</p>
              <span className="status online">IN-GAME</span>
            </div>
          </div>
          <div className="friend">
            <div className="avatar">AP</div>
            <div>
              <p>ApexPredator</p>
              <span className="status away">AWAY</span>
            </div>
          </div>
        </div>

        <div className="panel">
          <p className="panel-title">TOP EARNERS (TODAY)</p>
          <div className="earner">
            <span className="rank">1</span>
            <span>zywoo_god</span>
            <span className="gain">+$245.00</span>
          </div>
          <div className="earner">
            <span className="rank">2</span>
            <span>m0nesy_1</span>
            <span className="gain">+$180.50</span>
          </div>
        </div>

        <div className="panel callout">
          <p className="panel-title">HIGHLIGHT</p>
          <h3>Weekend Ladder</h3>
          <p>Short, high-signal ladder to keep sessions spicy.</p>
          <button className="cta-secondary">Join Ladder</button>
        </div>
      </aside>

      {/* ──── Wallet Modal ──── */}
      {walletOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setWalletOpen(false)}
        >
          <div
            className="modal-card wallet-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="label">WALLET</p>
                <h3>{currentUser.name}</h3>
                <p className="modal-sub">
                  Manage your balance and payment method.
                </p>
              </div>
              <button
                className="ghost-btn"
                onClick={() => setWalletOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="modal-body">
              {/* Balance display */}
              <div className="wallet-balance-section">
                <p className="label">CURRENT BALANCE</p>
                <div className="wallet-balance-amount">{fmt(myBalance)}</div>
              </div>

              {walletError && (
                <div className="match-error">{walletError}</div>
              )}

              {/* Saved card or setup */}
              {mySavedCard ? (
                <>
                  <div className="wallet-saved">
                    <div className="wallet-card-display">
                      <div className="wallet-card-icon">&#128179;</div>
                      <div>
                        <p className="wallet-card-brand">
                          {mySavedCard.brand.toUpperCase()}
                        </p>
                        <p className="wallet-card-number">
                          &#8226;&#8226;&#8226;&#8226;{" "}
                          &#8226;&#8226;&#8226;&#8226;{" "}
                          &#8226;&#8226;&#8226;&#8226; {mySavedCard.last4}
                        </p>
                        <p className="wallet-card-exp">
                          Expires {mySavedCard.expMonth}/{mySavedCard.expYear}
                        </p>
                      </div>
                    </div>
                    <button className="step-btn" onClick={removeCard}>
                      Remove Card
                    </button>
                  </div>

                  {/* Deposit */}
                  <div className="wallet-action-section">
                    <p className="label">DEPOSIT</p>
                    <div className="create-amount-row">
                      <span className="create-dollar">$</span>
                      <input
                        type="number"
                        className="create-input"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        min="1"
                        step="1"
                        placeholder="20.00"
                      />
                    </div>
                    <button
                      className="step-btn primary"
                      onClick={handleDeposit}
                      disabled={depositLoading || !depositAmount || parseFloat(depositAmount) <= 0}
                    >
                      {depositLoading ? "Processing..." : `Deposit $${parseFloat(depositAmount || 0).toFixed(2)}`}
                    </button>
                  </div>

                  {/* Withdraw */}
                  {myBalance > 0 && (
                    <div className="wallet-action-section">
                      <p className="label">WITHDRAW</p>
                      <div className="create-amount-row">
                        <span className="create-dollar">$</span>
                        <input
                          type="number"
                          className="create-input"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          min="1"
                          max={(myBalance / 100).toFixed(2)}
                          step="1"
                          placeholder={(myBalance / 100).toFixed(2)}
                        />
                      </div>
                      <button
                        className="step-btn"
                        onClick={handleWithdraw}
                        disabled={
                          withdrawLoading ||
                          !withdrawAmount ||
                          parseFloat(withdrawAmount) <= 0 ||
                          Math.round(parseFloat(withdrawAmount) * 100) > myBalance
                        }
                      >
                        {withdrawLoading ? "Processing..." : `Withdraw $${parseFloat(withdrawAmount || 0).toFixed(2)}`}
                      </button>
                      <p className="wallet-withdraw-note">
                        Withdrawals are refunded to your card via Stripe.
                      </p>
                    </div>
                  )}
                </>
              ) : walletLoading ? (
                <div className="payment-loading">Setting up wallet...</div>
              ) : setupSecret ? (
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret: setupSecret,
                    appearance: STRIPE_APPEARANCE,
                  }}
                  key={setupSecret}
                >
                  <SetupForm onSaved={handleCardSaved} />
                </Elements>
              ) : (
                <div className="payment-loading">Preparing...</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ──── Create Wager Modal ──── */}
      {createOpen && (
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="modal-card create-wager-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="label">NEW WAGER</p>
                <h3>Create a Wager</h3>
                <p className="modal-sub">Post a public challenge for anyone to accept.</p>
              </div>
              <button className="ghost-btn" onClick={() => setCreateOpen(false)}>
                Close
              </button>
            </div>

            <div className="modal-body">
              <div className="create-field">
                <label className="create-label">MAP</label>
                <select
                  className="create-select"
                  value={createMap}
                  onChange={(e) => setCreateMap(e.target.value)}
                >
                  {MAPS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div className="create-field">
                <label className="create-label">WAGER AMOUNT (USD)</label>
                <div className="create-amount-row">
                  <span className="create-dollar">$</span>
                  <input
                    type="number"
                    className="create-input"
                    value={createAmount}
                    onChange={(e) => setCreateAmount(e.target.value)}
                    min="1"
                    step="0.50"
                    placeholder="5.00"
                  />
                </div>
              </div>

              <div className="create-preview">
                <div className="create-preview-row">
                  <span className="label">PLAYER</span>
                  <span>{currentUser.name}</span>
                </div>
                <div className="create-preview-row">
                  <span className="label">RANK</span>
                  <span>{currentUser.rank}</span>
                </div>
                <div className="create-preview-row">
                  <span className="label">MAP</span>
                  <span>{createMap}</span>
                </div>
                <div className="create-preview-row">
                  <span className="label">AMOUNT</span>
                  <span className="create-amount-display">${parseFloat(createAmount || 0).toFixed(2)}</span>
                </div>
              </div>

              <button
                className="step-btn primary"
                onClick={createWager}
                disabled={!createAmount || parseFloat(createAmount) <= 0}
              >
                Post Wager
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ──── Wager Modal ──── */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="label">WAGER MATCH</p>
                <h3>
                  {matchPlayers.b
                    ? `${matchPlayers.a} vs ${matchPlayers.b}`
                    : `${matchPlayers.a}'s Wager`}
                </h3>
                <p className="modal-sub">
                  {activeWager
                    ? `${activeWager.amount} • ${activeWager.map}`
                    : "Select a wager from the list."}
                </p>
              </div>
              <div className="modal-header-actions">
                <button className="ghost-btn" onClick={closeModal}>
                  Close
                </button>
                <button className="ghost-btn danger" onClick={abandonMatch}>
                  Reset
                </button>
              </div>
            </div>

            <div className="modal-body">
              {matchError && (
                <div className="match-error">
                  {matchError}
                </div>
              )}

              {/* Waiting for challenger (creator view, no opponent yet) */}
              {!matchPlayers.b && (
                <div className="waiting-challenger">
                  <div className="waiting-challenger-icon">&#9876;</div>
                  <h3>Waiting for a challenger</h3>
                  <p>Your wager is live on the public board. Switch to another player and click "Join Wager" to start the match.</p>
                </div>
              )}

              {/* Lock-in panel (only when both players are set) */}
              {matchPlayers.b && <div className="lock-panel compact">
                <div className="lock-steps">
                  {/* Player A */}
                  <div
                    className={`step step-col ${lockState.playerA ? "done" : ""}`}
                  >
                    <div className="step-row">
                      <div className="step-dot">A</div>
                      <div>
                        <p className="step-label">
                          {matchPlayers.a || "Player A"} — lock-in
                          {isPlayerA && (
                            <span className="you-tag">YOU</span>
                          )}
                        </p>
                      </div>
                    </div>
                    {renderPlayerSlot("A")}
                  </div>

                  {/* Player B */}
                  <div
                    className={`step step-col ${lockState.playerB ? "done" : ""}`}
                  >
                    <div className="step-row">
                      <div className="step-dot">B</div>
                      <div>
                        <p className="step-label">
                          {matchPlayers.b || "Player B"} — lock-in
                          {isPlayerB && (
                            <span className="you-tag">YOU</span>
                          )}
                        </p>
                      </div>
                    </div>
                    {renderPlayerSlot("B")}
                  </div>

                  {/* Match confirmed */}
                  {bothLocked && (
                    <div className="match-confirmed">
                      <div className="step-dot confirm-dot">&#10003;</div>
                      <div>
                        <h3 className="confirmed-title">Match Confirmed</h3>
                        <p className="confirmed-sub">
                          Both players' wagers are locked in from their balance.
                        </p>
                        {!serverInfo && (
                          <button
                            className="step-btn primary"
                            onClick={finalizeMatch}
                          >
                            Provision Server
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Server card */}
                {serverInfo && !serverInfo.loading && !matchResult && (
                  <div className="server-card show">
                    <div>
                      <p className="label">SERVER</p>
                      <h3>{serverInfo.name}</h3>
                    </div>
                    <div>
                      <p className="label">STATUS</p>
                      <h3>{serverInfo.status}</h3>
                    </div>
                    <div>
                      <p className="label">MAP</p>
                      <h3>{serverInfo.map}</h3>
                    </div>
                  </div>
                )}
                {serverInfo?.loading && (
                  <div className="payment-loading">
                    Starting match server...
                  </div>
                )}
                {resultPolling && !matchResult && serverInfo && !serverInfo.loading && (
                  <div className="match-in-progress">
                    <div className="progress-text">
                      <span className="progress-dot" />
                      Match in progress — check backend terminal for server logs
                    </div>
                    <button
                      className="step-btn"
                      onClick={async () => {
                        await fetch(`${API_URL}/skip-match`, { method: "POST" });
                      }}
                    >
                      Skip to End
                    </button>
                  </div>
                )}

                {/* Match result */}
                {matchResult && (
                  <div className="match-result-banner">
                    <div className="result-header">
                      <div className="step-dot result-dot">&#127942;</div>
                      <div>
                        <h3 className="result-title">Match Complete</h3>
                        <p className="result-sub">
                          {activeWager?.map} &bull; {activeWager?.amount} wager
                        </p>
                      </div>
                    </div>
                    <div className="result-players">
                      <div className={`result-player ${matchResult.winner === currentUser.name ? "winner" : "loser"}`}>
                        <span className="result-tag winner-tag">WINNER</span>
                        <span className="result-name">{matchResult.winner}</span>
                        <span className="result-action">
                          +{fmt(matchResult.wagerAmount)} &rarr; {fmt(matchResult.winnerBalance)}
                        </span>
                      </div>
                      <div className={`result-player ${matchResult.loser === currentUser.name ? "loser" : "winner"}`}>
                        <span className="result-tag loser-tag">LOSER</span>
                        <span className="result-name">{matchResult.loser}</span>
                        <span className="result-action">
                          -{fmt(matchResult.wagerAmount)} &rarr; {fmt(matchResult.loserBalance)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
