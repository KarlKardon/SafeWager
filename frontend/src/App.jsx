import { useState, useEffect } from "react";
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
    ".Input": { border: "1px solid rgba(255,255,255,0.1)", boxShadow: "none" },
    ".Input:focus": { border: "1px solid #ff7a1a", boxShadow: "0 0 0 1px #ff7a1a" },
  },
};

const MAPS = ["DE_DUST2", "DE_MIRAGE", "DE_INFERNO", "DE_NUKE", "DE_OVERPASS", "DE_ANUBIS", "AIM_MAP_PRO_V2"];

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
    const { error: setupError, setupIntent } = await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (setupError) { setError(setupError.message); setLoading(false); }
    else if (setupIntent?.status === "succeeded") onSaved(setupIntent.payment_method);
    else { setError("Unexpected status: " + setupIntent?.status); setLoading(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="checkout-form">
      <PaymentElement />
      {error && <p className="payment-error">{error}</p>}
      <button type="submit" disabled={!stripe || loading} className="btn primary">
        {loading ? "Saving..." : "Save Card"}
      </button>
    </form>
  );
}

export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/auth/user`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => { setAuthUser(data.user); setAuthLoading(false); })
      .catch(() => setAuthLoading(false));
  }, []);

  const handleLogout = async () => {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
    setAuthUser(null);
  };

  if (authLoading) {
    return <div className="app"><div className="login-page"><div className="muted">Loading...</div></div></div>;
  }

  if (!authUser) {
    return (
      <div className="app">
        <div className="login-page">
          <div className="login-card">
            <div className="logo large">SW</div>
            <h1>SafeWager</h1>
            <p className="muted">CS2 wager platform. Sign in with your Steam account to get started.</p>
            <a href={`${API_URL}/auth/steam`} className="btn steam-btn">Sign in with Steam</a>
          </div>
        </div>
      </div>
    );
  }

  return <Dashboard user={authUser} onLogout={handleLogout} />;
}

function Dashboard({ user, onLogout }) {
  const currentUser = { name: user.username, avatar: user.avatar, steamId: user.steamId };

  // Page state: "feed" or "profile"
  const [page, setPage] = useState("feed");

  // Integrity
  const [integrity, setIntegrity] = useState(null); // { checked, passed, stats, cheatPct, timestamp, expired }
  const [integrityLoading, setIntegrityLoading] = useState(false);

  // Wagers (from server)
  const [wagers, setWagers] = useState([]);

  // Profile data
  const [profileData, setProfileData] = useState(null);

  const [wallets, setWallets] = useState({});
  const [balances, setBalances] = useState({});

  const [createOpen, setCreateOpen] = useState(false);
  const [createMap, setCreateMap] = useState(MAPS[0]);
  const [createAmount, setCreateAmount] = useState("5.00");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeWagerId, setActiveWagerId] = useState(null);
  const [lockState, setLockState] = useState({ playerA: false, playerB: false });
  const [matchPlayers, setMatchPlayers] = useState({ a: null, b: null });
  const [matchError, setMatchError] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);
  const [matchResult, setMatchResult] = useState(null);
  const [resultPolling, setResultPolling] = useState(false);

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
  const myWallet = wallets[currentUser.name] || {};
  const mySavedCard = myWallet.savedCard || null;
  const myCustomerId = myWallet.customerId || null;
  const myBalance = balances[currentUser.name] || 0;
  const isPlayerA = currentUser.name === matchPlayers.a;
  const isPlayerB = currentUser.name === matchPlayers.b;
  const fmt = (cents) => "$" + (cents / 100).toFixed(2);

  // Can create wagers?
  const canWager = integrity?.checked && !integrity?.expired && integrity?.passed;

  // Load integrity status + wagers on mount
  useEffect(() => {
    fetch(`${API_URL}/integrity-status`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setIntegrity(data))
      .catch(() => {});
    fetchWagers();
    fetch(`${API_URL}/balance/${currentUser.name}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setBalances((prev) => ({ ...prev, [currentUser.name]: data.balance })))
      .catch(() => {});
  }, [currentUser.name]);

  const fetchWagers = () => {
    fetch(`${API_URL}/wagers`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setWagers(data))
      .catch(() => {});
  };

  // Run integrity check
  const runIntegrityCheck = async () => {
    setIntegrityLoading(true);
    try {
      const res = await fetch(`${API_URL}/integrity-check`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIntegrity({ checked: true, ...data, expired: false });
    } catch (err) {
      console.error("Integrity check failed:", err);
    }
    setIntegrityLoading(false);
  };

  // Load profile
  const openProfile = () => {
    setPage("profile");
    fetch(`${API_URL}/profile/${currentUser.steamId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setProfileData(data))
      .catch(() => {});
  };

  // Wallet helpers
  const updateWallet = (username, updates) => {
    setWallets((prev) => ({ ...prev, [username]: { ...(prev[username] || {}), ...updates } }));
  };
  const updateBalance = (username, val) => {
    setBalances((prev) => ({ ...prev, [username]: val }));
  };

  const openWallet = async () => {
    setWalletOpen(true);
    setWalletError(null);
    setWithdrawAmount("");
    if (mySavedCard || setupSecret) return;
    setWalletLoading(true);
    try {
      let custId = myCustomerId;
      if (!custId) {
        const r = await fetch(`${API_URL}/create-customer`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: currentUser.name }) });
        custId = (await r.json()).customerId;
        updateWallet(currentUser.name, { customerId: custId });
      }
      const r2 = await fetch(`${API_URL}/create-setup-intent`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ customerId: custId }) });
      setSetupSecret((await r2.json()).clientSecret);
    } catch (err) { console.error("Wallet setup failed:", err); }
    setWalletLoading(false);
  };

  const handleCardSaved = async (pmId) => {
    const custId = wallets[currentUser.name]?.customerId;
    try {
      const r = await fetch(`${API_URL}/payment-methods/${custId}`, { credentials: "include" });
      const card = (await r.json()).paymentMethods.find((m) => m.id === pmId);
      if (card) { updateWallet(currentUser.name, { savedCard: card }); setSetupSecret(null); }
    } catch (err) { console.error(err); }
  };

  const removeCard = () => { updateWallet(currentUser.name, { savedCard: null }); setSetupSecret(null); };

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0 || !mySavedCard || !myCustomerId) return;
    setDepositLoading(true); setWalletError(null);
    try {
      const r = await fetch(`${API_URL}/deposit-with-saved-card`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ username: currentUser.name, customerId: myCustomerId, paymentMethodId: mySavedCard.id, amount: Math.round(amount * 100) }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      updateBalance(currentUser.name, data.balance);
    } catch (err) { setWalletError(err.message); }
    setDepositLoading(false);
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) return;
    const amountCents = Math.round(amount * 100);
    if (amountCents > myBalance) return;
    setWithdrawLoading(true); setWalletError(null);
    try {
      const r = await fetch(`${API_URL}/withdraw`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ username: currentUser.name, amount: amountCents }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      updateBalance(currentUser.name, data.balance);
      setWithdrawAmount("");
    } catch (err) { setWalletError(err.message); }
    setWithdrawLoading(false);
  };

  // Wager actions
  const createWager = async () => {
    const amount = parseFloat(createAmount);
    if (isNaN(amount) || amount <= 0) return;
    try {
      const r = await fetch(`${API_URL}/create-wager`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ amount: "$" + amount.toFixed(2), map: createMap }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setWagers((prev) => [data, ...prev]);
      setCreateOpen(false);
      setCreateAmount("5.00");
      setCreateMap(MAPS[0]);
    } catch (err) {
      alert(err.message);
    }
  };

  const openWagerModal = (wager) => {
    if (wager.id === activeWagerId && matchPlayers.a && (isPlayerA || isPlayerB)) { setIsModalOpen(true); return; }
    const isCreator = wager.creator === currentUser.name;
    setActiveWagerId(wager.id);
    setIsModalOpen(true);
    setMatchError(null); setServerInfo(null); setMatchResult(null);
    setLockState({ playerA: false, playerB: false });
    setMatchPlayers(isCreator ? { a: wager.creator, b: null } : { a: wager.creator, b: currentUser.name });
  };

  const handleLockIn = async (slot) => {
    const isA = slot === "A";
    const playerName = isA ? matchPlayers.a : matchPlayers.b;
    const amountCents = Math.round(parseFloat(activeWager.amount.replace("$", "")) * 100);
    try {
      const r = await fetch(`${API_URL}/lock-wager`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ username: playerName, amount: amountCents }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      updateBalance(playerName, data.balance);
      setLockState((prev) => ({ ...prev, [isA ? "playerA" : "playerB"]: true }));
    } catch (err) { setMatchError(err.message); }
  };

  const finalizeMatch = async () => {
    if (!activeWager) return;
    setServerInfo({ loading: true }); setMatchResult(null);
    const amountCents = Math.round(parseFloat(activeWager.amount.replace("$", "")) * 100);
    try {
      const r = await fetch(`${API_URL}/start-match-server`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ wagerId: activeWagerId, playerAName: matchPlayers.a, playerBName: matchPlayers.b, wagerAmount: amountCents, map: activeWager?.map || "de_dust2" }) });
      const data = await r.json();
      if (!r.ok) throw new Error("Failed to start match server");
      setServerInfo({
        name: data.slotId || "sw-na-slot-1",
        status: data.status || "allocating_server",
        map: activeWager?.map || "de_dust2",
        serverIp: data.serverIp,
        serverPort: data.serverPort,
        serverPassword: data.serverPassword,
      });
      setResultPolling(true);
      const poll = setInterval(async () => {
        try {
          const r2 = await fetch(`${API_URL}/match-result`, { credentials: "include" });
          const data = await r2.json();
          if (data.resolved) {
            clearInterval(poll); setResultPolling(false); setMatchResult(data);
            updateBalance(data.winner, data.winnerBalance);
            updateBalance(data.loser, data.loserBalance);
            // Record result
            fetch(`${API_URL}/wager-result`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ wagerId: activeWagerId, winner: data.winner, loser: data.loser }) });
          }
        } catch {}
      }, 3000);
    } catch (err) { setServerInfo(null); setMatchError(err.message); }
  };

  const abandonMatch = () => {
    setIsModalOpen(false); setActiveWagerId(null); setMatchPlayers({ a: null, b: null });
    setMatchError(null); setServerInfo(null); setMatchResult(null); setResultPolling(false);
    setLockState({ playerA: false, playerB: false });
  };

  const renderPlayerSlot = (slot) => {
    const isA = slot === "A";
    const playerName = isA ? matchPlayers.a : matchPlayers.b;
    const locked = isA ? lockState.playerA : lockState.playerB;
    const isMe = isA ? isPlayerA : isPlayerB;
    const playerBalance = balances[playerName] || 0;
    const amountCents = activeWager ? Math.round(parseFloat(activeWager.amount.replace("$", "")) * 100) : 0;

    if (locked) return <div className="locked-badge"><span>&#10003;</span> Locked In</div>;
    if (isMe) {
      const canAfford = playerBalance >= amountCents;
      return (
        <div className="balance-lockin">
          <div className="balance-lockin-info">
            <span className="muted">Balance:</span>
            <span className={canAfford ? "text-success" : "text-danger"}>{fmt(playerBalance)}</span>
          </div>
          {canAfford
            ? <button className="btn primary" onClick={() => handleLockIn(slot)}>Lock In {activeWager?.amount}</button>
            : <div className="insufficient-msg">Insufficient balance — deposit funds in your wallet</div>}
        </div>
      );
    }
    return <div className="waiting-badge">Waiting for {playerName} to lock in...</div>;
  };

  // Integrity badge for header
  const renderIntegrityBadge = () => {
    if (integrityLoading) {
      return <div className="integrity-badge loading"><div className="spinner" /></div>;
    }
    if (integrity?.checked && !integrity?.expired) {
      return (
        <div className={`integrity-badge ${integrity.passed ? "pass" : "fail"}`}>
          {integrity.passed ? "\u2713" : "\u2717"}
        </div>
      );
    }
    return null;
  };

  // ── Profile page ──
  if (page === "profile") {
    const audit = profileData?.integrity;
    const pWagers = profileData?.wagers || [];
    return (
      <div className="app">
        <header className="header">
          <div className="header-left">
            <div className="logo">SW</div>
            <span className="logo-text">SafeWager</span>
          </div>
          <div className="header-right">
            <button className="btn ghost" onClick={() => setPage("feed")}>Back to Feed</button>
          </div>
        </header>
        <main className="main">
          <div className="profile-header">
            <img src={currentUser.avatar} alt="" className="profile-avatar" />
            <div>
              <h1>{currentUser.name}</h1>
              <p className="muted">Steam ID: {currentUser.steamId}</p>
            </div>
          </div>

          <div className="profile-section">
            <h2>Integrity Audit</h2>
            {audit ? (
              <div className="audit-grid">
                <div className={`audit-card ${audit.passed ? "pass" : "fail"}`}>
                  <p className="muted small">CHEATING</p>
                  <div className="audit-value">{audit.stats?.cheating?.percentage || "N/A"}</div>
                  <div className={`audit-label ${audit.passed ? "text-success" : "text-danger"}`}>
                    {audit.stats?.cheating?.risk || "UNKNOWN"}
                  </div>
                  <p className="muted small">{audit.stats?.cheating?.detail}</p>
                </div>
                <div className="audit-card">
                  <p className="muted small">TIME TO DAMAGE</p>
                  <div className="audit-value">{audit.stats?.timeToDamage?.value || "N/A"}</div>
                  <div className="audit-label">{audit.stats?.timeToDamage?.speed || "UNKNOWN"}</div>
                  <p className="muted small">{audit.stats?.timeToDamage?.detail}</p>
                </div>
                <div className="audit-card">
                  <p className="muted small">WIN RATE</p>
                  <div className="audit-value">{audit.stats?.winRate?.percentage || "N/A"}</div>
                  <div className="audit-label">{audit.stats?.winRate?.rating || "UNKNOWN"}</div>
                  <p className="muted small">{audit.stats?.winRate?.detail}</p>
                </div>
              </div>
            ) : (
              <div className="muted">No audit on record. Run an integrity check from the main page.</div>
            )}
            {audit && (
              <p className="muted small" style={{ marginTop: 8 }}>
                Last checked: {new Date(audit.timestamp).toLocaleString()}
                {audit.expired && <span className="text-danger"> (EXPIRED)</span>}
              </p>
            )}
          </div>

          <div className="profile-section">
            <h2>Wager History</h2>
            {pWagers.length === 0 ? (
              <div className="muted">No wagers yet.</div>
            ) : (
              <div className="wager-history">
                {pWagers.map((w) => (
                  <div key={w.id} className="history-row">
                    <div>
                      <span className="wager-name">{w.creator}</span>
                      {w.opponent && <span className="muted"> vs {w.opponent}</span>}
                    </div>
                    <div className="muted">{w.map}</div>
                    <div className="text-accent">{w.amount}</div>
                    <div>
                      {w.status === "resolved" && w.result ? (
                        w.result.winner === currentUser.name
                          ? <span className="text-success">WON</span>
                          : <span className="text-danger">LOST</span>
                      ) : (
                        <span className="muted">{w.status.toUpperCase()}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ── Feed page ──
  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">SW</div>
          <span className="logo-text">SafeWager</span>
        </div>
        <div className="header-right">
          <button className={`pill wallet-pill ${mySavedCard ? "has-card" : ""}`} onClick={openWallet}>
            {mySavedCard ? `${mySavedCard.brand.toUpperCase()} \u2022\u2022\u2022\u2022 ${mySavedCard.last4}` : "Add Payment"}
          </button>
          <div className="pill balance-pill" onClick={openWallet}>{fmt(myBalance)}</div>
          <div className="user-info">
            <button className="integrity-btn" onClick={runIntegrityCheck} disabled={integrityLoading} title="Run Integrity Check">
              {integrityLoading
                ? <div className="spinner" />
                : integrity?.checked && !integrity?.expired
                  ? <span className={integrity.passed ? "text-success" : "text-danger"}>{integrity.passed ? "\u2713" : "\u2717"}</span>
                  : <span className="muted">?</span>}
            </button>
            <img src={currentUser.avatar} alt="" className="user-avatar" onClick={openProfile} style={{ cursor: "pointer" }} />
            <span className="user-name" onClick={openProfile} style={{ cursor: "pointer" }}>{currentUser.name}</span>
            <button className="btn ghost small-btn" onClick={onLogout}>Logout</button>
          </div>
        </div>
      </header>

      {activeWagerId && (isPlayerA || isPlayerB) && !matchResult && (() => {
        const myLock = isPlayerA ? lockState.playerA : lockState.playerB;
        const theirLock = isPlayerA ? lockState.playerB : lockState.playerA;
        const opponentName = isPlayerA ? matchPlayers.b : matchPlayers.a;
        let bannerClass = "banner", label = "";
        if (!matchPlayers.b) { bannerClass += " waiting"; label = "Your wager is live \u2014 waiting for a challenger"; }
        else if (theirLock && !myLock) { bannerClass += " urgent"; label = `${opponentName} locked in \u2014 your turn!`; }
        else if (bothLocked && serverInfo && !serverInfo.loading) { bannerClass += " live"; label = "Match is live"; }
        else if (bothLocked) { bannerClass += " ready"; label = "Both locked in \u2014 match ready"; }
        else if (myLock && !theirLock) { bannerClass += " waiting"; label = `Waiting for ${opponentName} to lock in...`; }
        else { bannerClass += " active"; label = `Active wager \u2014 ${activeWager?.amount} on ${activeWager?.map}`; }
        return (
          <button className={bannerClass} onClick={() => setIsModalOpen(true)}>
            <span className="banner-dot" /><span className="banner-label">{label}</span><span className="banner-action">View</span>
          </button>
        );
      })()}

      <main className="main">
        <div className="content-header">
          <div>
            <h1>Public Wagers</h1>
            <p className="muted">Live matches waiting for challengers</p>
          </div>
          {canWager ? (
            <button className="btn primary" onClick={() => setCreateOpen(true)}>+ Create Wager</button>
          ) : (
            <div className="integrity-hint">
              {integrity?.checked && !integrity?.expired && !integrity?.passed
                ? <span className="text-danger">Integrity check failed — cannot create wagers</span>
                : <span className="muted">Run an integrity check to create wagers</span>}
            </div>
          )}
        </div>

        <div className="wager-list">
          {wagers.length === 0 && (
            <div className="empty-state">
              <h3>No active wagers</h3>
              <p className="muted">Create a wager to get started.</p>
              {canWager && <button className="btn primary" onClick={() => setCreateOpen(true)}>+ Create Wager</button>}
            </div>
          )}
          {wagers.map((wager) => (
            <article key={wager.id} className={`wager-card ${activeWagerId === wager.id ? "selected" : ""}`}>
              <div className="wager-top">
                <div className="wager-user">
                  {wager.creatorAvatar
                    ? <img src={wager.creatorAvatar} alt="" className="avatar-img" />
                    : <div className="avatar">{wager.creator.slice(0, 2)}</div>}
                  <div><p className="wager-name">{wager.creator}</p></div>
                </div>
                <div className="wager-amount">
                  <span>{wager.amount}</span>
                  <small className="text-accent">ACTIVE</small>
                </div>
              </div>
              <div className="wager-map">
                <div><p className="muted small">MAP</p><p className="map-name">{wager.map}</p></div>
              </div>
              <button className="btn accent full-width" onClick={() => openWagerModal(wager)}>
                {activeWagerId === wager.id ? "VIEW WAGER" : wager.creator === currentUser.name ? "YOUR WAGER" : "JOIN WAGER"}
              </button>
            </article>
          ))}
        </div>
      </main>

      {/* Create Wager Modal */}
      {createOpen && (
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="modal-card small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div><p className="muted small">NEW WAGER</p><h3>Create a Wager</h3></div>
              <button className="btn ghost" onClick={() => setCreateOpen(false)}>Close</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label className="field-label">MAP</label>
                <select className="select" value={createMap} onChange={(e) => setCreateMap(e.target.value)}>
                  {MAPS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">WAGER AMOUNT (USD)</label>
                <div className="amount-input"><span className="muted">$</span><input type="number" value={createAmount} onChange={(e) => setCreateAmount(e.target.value)} min="1" step="0.50" placeholder="5.00" /></div>
              </div>
              <div className="preview">
                <div className="preview-row"><span className="muted">Player</span><span>{currentUser.name}</span></div>
                <div className="preview-row"><span className="muted">Map</span><span>{createMap}</span></div>
                <div className="preview-row"><span className="muted">Amount</span><span className="text-accent">${parseFloat(createAmount || 0).toFixed(2)}</span></div>
              </div>
              <button className="btn primary" onClick={createWager} disabled={!createAmount || parseFloat(createAmount) <= 0}>Post Wager</button>
            </div>
          </div>
        </div>
      )}

      {/* Wager Modal */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="muted small">WAGER MATCH</p>
                <h3>{matchPlayers.b ? `${matchPlayers.a} vs ${matchPlayers.b}` : `${matchPlayers.a}'s Wager`}</h3>
                {activeWager && <p className="muted">{activeWager.amount} &bull; {activeWager.map}</p>}
              </div>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setIsModalOpen(false)}>Close</button>
                <button className="btn ghost danger" onClick={abandonMatch}>Reset</button>
              </div>
            </div>
            <div className="modal-body">
              {matchError && <div className="error-msg">{matchError}</div>}
              {!matchPlayers.b && (
                <div className="empty-state"><h3>Waiting for a challenger</h3><p className="muted">Your wager is live on the public board.</p></div>
              )}
              {matchPlayers.b && (
                <div className="lock-panel">
                  <div className={`step ${lockState.playerA ? "done" : ""}`}>
                    <div className="step-header"><div className="step-dot">A</div><p className="step-label">{matchPlayers.a}{isPlayerA && <span className="you-tag">YOU</span>}</p></div>
                    {renderPlayerSlot("A")}
                  </div>
                  <div className={`step ${lockState.playerB ? "done" : ""}`}>
                    <div className="step-header"><div className="step-dot">B</div><p className="step-label">{matchPlayers.b}{isPlayerB && <span className="you-tag">YOU</span>}</p></div>
                    {renderPlayerSlot("B")}
                  </div>
                  {bothLocked && (
                    <div className="match-confirmed">
                      <div className="step-dot confirm-dot">&#10003;</div>
                      <div>
                        <h3 className="text-success">Match Confirmed</h3>
                        <p className="muted">Both players' wagers are locked.</p>
                        {!serverInfo && <button className="btn primary" onClick={finalizeMatch}>Provision Server</button>}
                      </div>
                    </div>
                  )}
                  {serverInfo && !serverInfo.loading && !matchResult && (
                    <div className="server-card">
                      <div><p className="muted small">SERVER</p><h4>{serverInfo.name}</h4></div>
                      <div><p className="muted small">STATUS</p><h4>{serverInfo.status}</h4></div>
                      <div><p className="muted small">MAP</p><h4>{serverInfo.map}</h4></div>
                      {serverInfo.serverIp && <div><p className="muted small">CONNECT</p><h4>{serverInfo.serverIp}:{serverInfo.serverPort}</h4></div>}
                      {serverInfo.serverPassword && <div><p className="muted small">PASSWORD</p><h4>{serverInfo.serverPassword}</h4></div>}
                    </div>
                  )}
                  {serverInfo?.loading && <div className="muted center">Starting match server...</div>}
                  {resultPolling && !matchResult && serverInfo && !serverInfo.loading && (
                    <div className="match-in-progress">
                      <div className="progress-text"><span className="progress-dot" />Match in progress</div>
                      <button className="btn ghost" onClick={() => fetch(`${API_URL}/skip-match`, { method: "POST", credentials: "include" })}>Skip to End</button>
                    </div>
                  )}
                  {matchResult && (
                    <div className="match-result">
                      <h3 className="text-accent">Match Complete</h3>
                      <p className="muted">{activeWager?.map} &bull; {activeWager?.amount} wager</p>
                      <div className="result-players">
                        <div className="result-player winner">
                          <span className="result-tag winner-tag">WINNER</span><span className="result-name">{matchResult.winner}</span>
                          <span className="muted">+{fmt(matchResult.wagerAmount)} &rarr; {fmt(matchResult.winnerBalance)}</span>
                        </div>
                        <div className="result-player loser">
                          <span className="result-tag loser-tag">LOSER</span><span className="result-name">{matchResult.loser}</span>
                          <span className="muted">-{fmt(matchResult.wagerAmount)} &rarr; {fmt(matchResult.loserBalance)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Wallet Modal */}
      {walletOpen && (
        <div className="modal-backdrop" onClick={() => setWalletOpen(false)}>
          <div className="modal-card small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div><p className="muted small">WALLET</p><h3>{currentUser.name}</h3></div>
              <button className="btn ghost" onClick={() => setWalletOpen(false)}>Close</button>
            </div>
            <div className="modal-body">
              <div className="wallet-balance"><p className="muted small">CURRENT BALANCE</p><div className="wallet-balance-amount">{fmt(myBalance)}</div></div>
              {walletError && <div className="error-msg">{walletError}</div>}
              {mySavedCard ? (
                <>
                  <div className="wallet-card-display">
                    <div>
                      <p className="wallet-card-brand">{mySavedCard.brand.toUpperCase()}</p>
                      <p className="muted">&#8226;&#8226;&#8226;&#8226; {mySavedCard.last4} &bull; Expires {mySavedCard.expMonth}/{mySavedCard.expYear}</p>
                    </div>
                    <button className="btn ghost" onClick={removeCard}>Remove</button>
                  </div>
                  <div className="wallet-section">
                    <p className="muted small">DEPOSIT</p>
                    <div className="amount-input"><span className="muted">$</span><input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} min="1" step="1" placeholder="20.00" /></div>
                    <button className="btn primary" onClick={handleDeposit} disabled={depositLoading || !depositAmount || parseFloat(depositAmount) <= 0}>
                      {depositLoading ? "Processing..." : `Deposit $${parseFloat(depositAmount || 0).toFixed(2)}`}
                    </button>
                  </div>
                  {myBalance > 0 && (
                    <div className="wallet-section">
                      <p className="muted small">WITHDRAW</p>
                      <div className="amount-input"><span className="muted">$</span><input type="number" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} min="1" max={(myBalance / 100).toFixed(2)} step="1" placeholder={(myBalance / 100).toFixed(2)} /></div>
                      <button className="btn ghost" onClick={handleWithdraw} disabled={withdrawLoading || !withdrawAmount || parseFloat(withdrawAmount) <= 0 || Math.round(parseFloat(withdrawAmount) * 100) > myBalance}>
                        {withdrawLoading ? "Processing..." : `Withdraw $${parseFloat(withdrawAmount || 0).toFixed(2)}`}
                      </button>
                      <p className="muted small">Withdrawals are refunded to your card via Stripe.</p>
                    </div>
                  )}
                </>
              ) : walletLoading ? (
                <div className="muted center">Setting up wallet...</div>
              ) : setupSecret ? (
                <Elements stripe={stripePromise} options={{ clientSecret: setupSecret, appearance: STRIPE_APPEARANCE }} key={setupSecret}>
                  <SetupForm onSaved={handleCardSaved} />
                </Elements>
              ) : (
                <div className="muted center">Preparing...</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
