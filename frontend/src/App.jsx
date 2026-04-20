import { useState, useEffect, useRef, useCallback } from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import "./App.css";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
const API_URL = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:4242" : "")).replace(/\/+$/, "");

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
const ROUND_TARGET_OPTIONS = [1, 3, 5, 7, 13, 16];
const START_MONEY_OPTIONS = [800, 16000];
const WARMUP_OPTIONS = [0, 15, 30, 60];
const BOT_DIFFICULTY_OPTIONS = [
  { value: 0, label: "Easy" },
  { value: 1, label: "Normal" },
  { value: 2, label: "Hard" },
  { value: 3, label: "Expert" },
];
const MOCK_WAGERS = [
  {
    id: "mock_onyx",
    creator: "Onyx",
    creatorSteamId: "mock_onyx",
    creatorAvatar: "https://i.pravatar.cc/80?img=12",
    creatorScore: 6,
    opponent: "Hex",
    opponentSteamId: "mock_hex",
    opponentAvatar: "https://i.pravatar.cc/80?img=33",
    opponentScore: 4,
    amount: "$25.00",
    map: "DE_MIRAGE",
    status: "live",
  },
  {
    id: "mock_vex",
    creator: "Vex",
    creatorSteamId: "mock_vex",
    creatorAvatar: "https://i.pravatar.cc/80?img=58",
    creatorScore: 2,
    opponent: "Riot",
    opponentSteamId: "mock_riot",
    opponentAvatar: "https://i.pravatar.cc/80?img=49",
    opponentScore: 2,
    amount: "$10.00",
    map: "DE_INFERNO",
    status: "live",
  },
  {
    id: "mock_ace",
    creator: "AceNova",
    creatorSteamId: "mock_acenova",
    creatorAvatar: "https://i.pravatar.cc/80?img=15",
    creatorScore: 11,
    opponent: "GhostTap",
    opponentSteamId: "mock_ghosttap",
    opponentAvatar: "https://i.pravatar.cc/80?img=25",
    opponentScore: 9,
    amount: "$50.00",
    map: "DE_ANUBIS",
    status: "live",
  },
];
const MOCK_AUDITS = {
  mock_onyx: {
    integrity: {
      checked: true,
      passed: true,
      expired: false,
      timestamp: "2026-04-16T14:12:00.000Z",
      stats: {
        cheating: {
          percentage: "3%",
          risk: "LOW RISK",
          detail: "Clean aim variance and recoil patterns across recent demos.",
        },
        timeToDamage: {
          value: "412ms",
          speed: "NORMAL",
          detail: "Healthy opener timing with no suspicious snap-to-shot behavior.",
        },
        winRate: {
          percentage: "54%",
          rating: "STABLE",
          detail: "Strong but believable recent form against mixed competition.",
        },
      },
    },
    wagers: [],
  },
  mock_hex: {
    integrity: {
      checked: true,
      passed: true,
      expired: false,
      timestamp: "2026-04-15T21:40:00.000Z",
      stats: {
        cheating: {
          percentage: "5%",
          risk: "LOW RISK",
          detail: "Crosshair placement and target switching remain within expected ranges.",
        },
        timeToDamage: {
          value: "438ms",
          speed: "NORMAL",
          detail: "Slightly above average reactions, still consistent with legit play.",
        },
        winRate: {
          percentage: "51%",
          rating: "BALANCED",
          detail: "Even split of wins and losses without outlier streaks.",
        },
      },
    },
    wagers: [],
  },
  mock_vex: {
    integrity: {
      checked: true,
      passed: true,
      expired: false,
      timestamp: "2026-04-16T10:05:00.000Z",
      stats: {
        cheating: {
          percentage: "2%",
          risk: "LOW RISK",
          detail: "Very clean sample with stable mouse movement and utility usage.",
        },
        timeToDamage: {
          value: "427ms",
          speed: "NORMAL",
          detail: "Consistent engagement timing without impossible first bullets.",
        },
        winRate: {
          percentage: "49%",
          rating: "BALANCED",
          detail: "Results fit an average grinder rather than a boosted account.",
        },
      },
    },
    wagers: [],
  },
  mock_riot: {
    integrity: {
      checked: true,
      passed: true,
      expired: false,
      timestamp: "2026-04-16T08:55:00.000Z",
      stats: {
        cheating: {
          percentage: "6%",
          risk: "LOW RISK",
          detail: "Occasional sharp entries, but nothing outside normal confidence swings.",
        },
        timeToDamage: {
          value: "401ms",
          speed: "NORMAL",
          detail: "Fast rifler profile with realistic follow-up accuracy.",
        },
        winRate: {
          percentage: "56%",
          rating: "SOLID",
          detail: "Good current stretch without suspicious domination.",
        },
      },
    },
    wagers: [],
  },
  mock_acenova: {
    integrity: {
      checked: true,
      passed: true,
      expired: false,
      timestamp: "2026-04-16T13:22:00.000Z",
      stats: {
        cheating: {
          percentage: "4%",
          risk: "LOW RISK",
          detail: "Smooth tracking and positioning with no repeated impossible peeks.",
        },
        timeToDamage: {
          value: "389ms",
          speed: "FAST",
          detail: "Quick openings, but still in range for a strong experienced player.",
        },
        winRate: {
          percentage: "58%",
          rating: "STRONG",
          detail: "Winning consistently while keeping believable damage distribution.",
        },
      },
    },
    wagers: [],
  },
  mock_ghosttap: {
    integrity: {
      checked: true,
      passed: true,
      expired: false,
      timestamp: "2026-04-15T19:08:00.000Z",
      stats: {
        cheating: {
          percentage: "7%",
          risk: "LOW RISK",
          detail: "Some aggressive flicks, but demo review still lands comfortably clean.",
        },
        timeToDamage: {
          value: "446ms",
          speed: "NORMAL",
          detail: "Slower peek-to-damage profile typical of a utility-heavy player.",
        },
        winRate: {
          percentage: "52%",
          rating: "BALANCED",
          detail: "Recent match history shows normal variance and recoveries.",
        },
      },
    },
    wagers: [],
  },
};

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

  const handleDemoReset = async () => {
    await fetch(`${API_URL}/auth/demo-reset`, { method: "POST", credentials: "include" });
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

  return <Dashboard user={authUser} onLogout={handleLogout} onDemoReset={handleDemoReset} />;
}

function Dashboard({ user, onLogout, onDemoReset }) {
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
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditProfile, setAuditProfile] = useState(null);
  const [auditProfileLoading, setAuditProfileLoading] = useState(false);

  const [wallets, setWallets] = useState({});
  const [balances, setBalances] = useState({});

  const [createOpen, setCreateOpen] = useState(false);
  const [createMap, setCreateMap] = useState(MAPS[0]);
  const [createAmount, setCreateAmount] = useState("5.00");
  const [createOpponentType, setCreateOpponentType] = useState("human");
  const [createBotProfile, setCreateBotProfile] = useState("solo_debug");
  const [createRoundTarget, setCreateRoundTarget] = useState(7);
  const [createStartMoney, setCreateStartMoney] = useState(800);
  const [createWarmupSeconds, setCreateWarmupSeconds] = useState(5);
  const [createBotDifficulty, setCreateBotDifficulty] = useState(2);
  const [deletingWagerId, setDeletingWagerId] = useState(null);
  const [activeWagerDetails, setActiveWagerDetails] = useState(null);
  const [copiedJoinCommand, setCopiedJoinCommand] = useState(false);
  const matchPollRef = useRef(null);

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

  const activeWager = wagers.find((w) => w.id === activeWagerId) || activeWagerDetails || null;
  const bothLocked = lockState.playerA && lockState.playerB;
  const myWallet = wallets[currentUser.name] || {};
  const mySavedCard = myWallet.savedCard || null;
  const myCustomerId = myWallet.customerId || null;
  const myBalance = balances[currentUser.name] || 0;
  const isPlayerA = currentUser.name === matchPlayers.a;
  const isPlayerB = currentUser.name === matchPlayers.b;
  const fmt = (cents) => "$" + (cents / 100).toFixed(2);
  const isServerStatusActive = Boolean(
    serverInfo &&
    !serverInfo.loading &&
    !matchResult &&
    ["allocating_server", "server_ready", "awaiting_players", "live"].includes(serverInfo.status)
  );

  const formatMatchStatusLabel = (status) => {
    switch (status) {
      case "allocating_server":
        return "Allocating Server";
      case "server_ready":
        return "Server Ready";
      case "awaiting_players":
        return "Awaiting Players";
      case "live":
        return "Live";
      case "completed":
        return "Completed";
      default:
        return status ? status.replace(/_/g, " ") : "Unknown";
    }
  };

  const formatRulesSummary = (rules, isBotMatch) => {
    if (!rules) return "Default rules";
    const parts = [`FT${rules.roundTarget}`, `$${rules.startMoney} start`];
    if (typeof rules.warmupSeconds === "number") {
      parts.push(`${rules.warmupSeconds}s warmup`);
    }
    if (isBotMatch && typeof rules.botDifficulty === "number") {
      const difficulty = BOT_DIFFICULTY_OPTIONS.find((option) => option.value === rules.botDifficulty)?.label || `Bot ${rules.botDifficulty}`;
      parts.push(difficulty);
    }
    return parts.join(" • ");
  };

  const renderAuditSummary = (audit) => {
    if (!audit) {
      return <div className="muted">No audit on record.</div>;
    }

    return (
      <>
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
        {audit.timestamp && (
          <p className="muted small" style={{ marginTop: 8 }}>
            Last checked: {new Date(audit.timestamp).toLocaleString()}
            {audit.expired && <span className="text-danger"> (EXPIRED)</span>}
          </p>
        )}
      </>
    );
  };

  const openAuditProfile = async ({ name, avatar, steamId }) => {
    if (!steamId) return;

    setAuditModalOpen(true);
    setAuditProfileLoading(true);
    setAuditProfile({
      steamId,
      avatar: avatar || null,
      personaname: name || "Unknown Player",
      integrity: null,
      wagers: [],
    });

    if (steamId.startsWith("mock_")) {
      const mockAudit = MOCK_AUDITS[steamId];
      setAuditProfile({
        steamId,
        avatar: avatar || null,
        personaname: name || "Showcase Player",
        integrity: mockAudit?.integrity || null,
        wagers: mockAudit?.wagers || [],
      });
      setAuditProfileLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/profile/${steamId}`, { credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "failed to load profile audit");
      setAuditProfile({
        steamId,
        avatar: avatar || null,
        personaname: name || "Player",
        integrity: data.integrity || null,
        wagers: data.wagers || [],
      });
    } catch (err) {
      console.error("audit profile fetch failed", err);
      setAuditProfile((prev) => prev ? { ...prev, integrity: null, wagers: [] } : prev);
    }
    setAuditProfileLoading(false);
  };

  const renderFeedPlayer = (name, avatar, score, align = "left", steamId = null) => (
    <div className={`feed-player ${align}`}>
      <button
        type="button"
        className={`feed-player-button ${steamId ? "clickable" : ""}`}
        onClick={() => steamId && openAuditProfile({ name, avatar, steamId })}
        disabled={!steamId}
        title={steamId ? `View ${name}'s audit` : undefined}
      >
        {avatar
          ? <img src={avatar} alt="" className="avatar-img" />
          : <div className="avatar">{(name || "?").slice(0, 2)}</div>}
        <div className="feed-player-meta">
          <p className="wager-name">{name || (align === "left" ? "Creator" : "Waiting...")}</p>
          <p className="feed-player-score">{typeof score === "number" ? score : "—"}</p>
        </div>
      </button>
    </div>
  );

  const deriveMatchTelemetry = (events, playerAName, playerBName) => {
    const telemetry = {
      scoreCt: null,
      scoreT: null,
      playerTeams: {},
      playerAScore: null,
      playerBScore: null,
    };

    for (const event of events || []) {
      if (event.eventType === "player.team" && event.payload?.playerName && event.payload?.team) {
        telemetry.playerTeams[event.payload.playerName] = event.payload.team;
      }

      if (event.eventType === "round.win") {
        if (typeof event.payload?.scoreCt === "number" && typeof event.payload?.scoreT === "number") {
          telemetry.scoreCt = event.payload.scoreCt;
          telemetry.scoreT = event.payload.scoreT;
        }
      }

      if (event.eventType === "match.score") {
        if (typeof event.payload?.scoreCt === "number" && typeof event.payload?.scoreT === "number") {
          telemetry.scoreCt = event.payload.scoreCt;
          telemetry.scoreT = event.payload.scoreT;
        }
      }
    }

    if (typeof telemetry.scoreCt === "number" && typeof telemetry.scoreT === "number") {
      const playerATeam = telemetry.playerTeams[playerAName];
      const playerBTeam = telemetry.playerTeams[playerBName];

      if (playerATeam === "CT") telemetry.playerAScore = telemetry.scoreCt;
      if (playerATeam === "TERRORIST") telemetry.playerAScore = telemetry.scoreT;
      if (playerBTeam === "CT") telemetry.playerBScore = telemetry.scoreCt;
      if (playerBTeam === "TERRORIST") telemetry.playerBScore = telemetry.scoreT;
    }

    return telemetry;
  };

  const clearMatchPolling = () => {
    if (matchPollRef.current) {
      clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
  };

  const syncMatchState = useCallback(async (matchId, fallback = {}) => {
    if (!matchId) {
      return;
    }

    const matchResponse = await fetch(`${API_URL}/matches/${matchId}`, { credentials: "include" });
    if (matchResponse.ok) {
      const matchPayload = await matchResponse.json();
      const remoteMatch = matchPayload.match;
      const telemetry = deriveMatchTelemetry(matchPayload.events, matchPlayers.a, matchPlayers.b);
      if (remoteMatch) {
        setServerInfo((prev) => ({
          ...(prev || {}),
          matchId: remoteMatch.id,
          name: remoteMatch.serverSlotId || fallback.slotId || prev?.name || "sw-na-slot-1",
          status: remoteMatch.completedAt
            ? "completed"
            : remoteMatch.startedAt
              ? "live"
              : remoteMatch.status || fallback.status || prev?.status || "allocating_server",
          map: remoteMatch.map || fallback.map || prev?.map || activeWager?.map || "de_dust2",
          matchProfile: fallback.matchProfile || prev?.matchProfile || activeWager?.matchProfile || "duo_match",
          serverIp: remoteMatch.serverIp || fallback.serverIp || prev?.serverIp || null,
          serverPort: remoteMatch.serverPort || fallback.serverPort || prev?.serverPort || null,
          serverPassword: remoteMatch.serverPassword || fallback.serverPassword || prev?.serverPassword || null,
          joinCommand:
            (remoteMatch.serverIp || fallback.serverIp || prev?.serverIp) &&
            (remoteMatch.serverPort || fallback.serverPort || prev?.serverPort) &&
            (remoteMatch.serverPassword || fallback.serverPassword || prev?.serverPassword)
              ? `connect ${remoteMatch.serverIp || fallback.serverIp || prev?.serverIp}:${remoteMatch.serverPort || fallback.serverPort || prev?.serverPort}; password ${remoteMatch.serverPassword || fallback.serverPassword || prev?.serverPassword}`
              : null,
          scoreCt: telemetry.scoreCt,
          scoreT: telemetry.scoreT,
          playerAScore: telemetry.playerAScore,
          playerBScore: telemetry.playerBScore,
        }));
      }
    }

    const resultResponse = await fetch(`${API_URL}/match-result`, { credentials: "include" });
    const resultData = await resultResponse.json();
    if (resultData.resolved && resultData.matchId === matchId) {
      clearMatchPolling();
      setResultPolling(false);
      setMatchResult(resultData);
      setServerInfo((prev) => prev ? { ...prev, status: "completed" } : prev);
      updateBalance(resultData.winner, resultData.winnerBalance);
      updateBalance(resultData.loser, resultData.loserBalance);
      fetch(`${API_URL}/wager-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ wagerId: activeWagerId, winner: resultData.winner, loser: resultData.loser }),
      })
        .then((response) => response.ok ? fetch(`${API_URL}/wagers`, { credentials: "include" }) : null)
        .then((response) => response ? response.json() : null)
        .then((wagerData) => {
          if (wagerData) {
            setWagers(wagerData);
          } else {
            setWagers((prev) => prev.filter((wager) => wager.id !== activeWagerId));
          }
        })
        .catch(() => {
          setWagers((prev) => prev.filter((wager) => wager.id !== activeWagerId));
        });
    }
  }, [activeWager?.map, activeWager?.matchProfile, activeWagerId, matchPlayers.a, matchPlayers.b]);

  const beginMatchPolling = useCallback((matchId, fallback = {}) => {
    if (!matchId) {
      return;
    }
    clearMatchPolling();
    setResultPolling(true);
    syncMatchState(matchId, fallback).catch((err) => {
      console.error("match sync failed", err);
    });
    matchPollRef.current = setInterval(() => {
      syncMatchState(matchId, fallback).catch((err) => {
        console.error("match result polling failed", err);
      });
    }, 3000);
  }, [syncMatchState]);

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

  useEffect(() => () => clearMatchPolling(), []);

  useEffect(() => {
    if (!isModalOpen || !activeWagerId || serverInfo || matchResult) {
      return undefined;
    }

    const pollId = setInterval(() => {
      fetchWagers();
    }, 3000);

    return () => clearInterval(pollId);
  }, [isModalOpen, activeWagerId, serverInfo, matchResult]);

  useEffect(() => {
    if (!activeWager || activeWager.isBotMatch) {
      return;
    }

    setMatchPlayers((prev) => ({
      a: activeWager.creator,
      b: activeWager.opponent || prev.b || (activeWager.creator === currentUser.name ? null : currentUser.name),
    }));
  }, [activeWager, currentUser.name]);

  useEffect(() => {
    if (!activeWager) {
      return;
    }

    setLockState({
      playerA: Boolean(activeWager.lockState?.playerA),
      playerB: activeWager.isBotMatch ? true : Boolean(activeWager.lockState?.playerB),
    });
  }, [activeWager]);

  useEffect(() => {
    if (!activeWagerId) {
      return;
    }

    const latestWager = wagers.find((wager) => wager.id === activeWagerId);
    if (latestWager) {
      setActiveWagerDetails(latestWager);
    }
  }, [wagers, activeWagerId]);

  useEffect(() => {
    if (!isModalOpen || !activeWager?.matchId || matchResult) {
      return;
    }

    setServerInfo((prev) => prev || {
      matchId: activeWager.matchId,
      name: "sw-na-slot-1",
      status: activeWager.status || "allocating_server",
      map: activeWager.map,
      matchProfile: activeWager.matchProfile || "duo_match",
      serverIp: null,
      serverPort: null,
      serverPassword: null,
      joinCommand: null,
      scoreCt: null,
      scoreT: null,
      playerAScore: activeWager.creatorScore,
      playerBScore: activeWager.opponentScore,
    });
    beginMatchPolling(activeWager.matchId, {
      status: activeWager.status || "allocating_server",
      map: activeWager.map,
      matchProfile: activeWager.matchProfile || "duo_match",
    });

    return () => clearMatchPolling();
  }, [isModalOpen, activeWager?.matchId, activeWager?.status, activeWager?.map, activeWager?.matchProfile, activeWager?.creatorScore, activeWager?.opponentScore, matchResult, beginMatchPolling]);

  useEffect(() => {
    if (createOpponentType === "bot") {
      setCreateRoundTarget(createBotProfile === "fast_solo_debug" ? 1 : 3);
      setCreateStartMoney(16000);
      setCreateWarmupSeconds(15);
      setCreateBotDifficulty(2);
      return;
    }

    setCreateRoundTarget(7);
    setCreateStartMoney(800);
    setCreateWarmupSeconds(5);
    setCreateBotDifficulty(2);
  }, [createOpponentType, createBotProfile]);

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
        body: JSON.stringify({
          amount: "$" + amount.toFixed(2),
          map: createMap,
          opponentType: createOpponentType,
          matchProfile: createOpponentType === "bot" ? createBotProfile : null,
          matchRules: {
            roundTarget: createRoundTarget,
            startMoney: createStartMoney,
            warmupSeconds: createOpponentType === "bot" ? createWarmupSeconds : 5,
            botDifficulty: createOpponentType === "bot" ? createBotDifficulty : null,
          },
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setWagers((prev) => [data, ...prev]);
      setCreateOpen(false);
      setCreateAmount("5.00");
      setCreateMap(MAPS[0]);
      setCreateOpponentType("human");
      setCreateBotProfile("solo_debug");
      setCreateRoundTarget(7);
      setCreateStartMoney(800);
      setCreateWarmupSeconds(5);
      setCreateBotDifficulty(2);
      if (data.isBotMatch) {
        openWagerModal(data);
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const openWagerModal = async (wager) => {
    if (wager.id === activeWagerId && matchPlayers.a && (isPlayerA || isPlayerB)) { setIsModalOpen(true); return; }
    let resolvedWager = wager;
    const isCreator = wager.creator === currentUser.name;

    if (!wager.isBotMatch && !isCreator) {
      try {
        const response = await fetch(`${API_URL}/wagers/${wager.id}/join`, {
          method: "POST",
          credentials: "include",
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "failed to join wager");
        resolvedWager = data;
        setWagers((prev) => prev.map((entry) => entry.id === data.id ? data : entry));
      } catch (err) {
        setMatchError(err.message);
        return;
      }
    }

    setActiveWagerId(resolvedWager.id);
    setIsModalOpen(true);
    setMatchError(null); setServerInfo(null); setMatchResult(null);
    setCopiedJoinCommand(false);
    const botMatch = Boolean(resolvedWager.isBotMatch);
    setLockState({
      playerA: Boolean(resolvedWager.lockState?.playerA),
      playerB: botMatch ? true : Boolean(resolvedWager.lockState?.playerB),
    });
    setMatchPlayers(
      botMatch
        ? { a: resolvedWager.creator, b: resolvedWager.opponent || "BotOpponent" }
        : isCreator
          ? { a: resolvedWager.creator, b: resolvedWager.opponent || null }
          : { a: resolvedWager.creator, b: resolvedWager.opponent || currentUser.name }
    );
    setActiveWagerDetails(resolvedWager);
  };

  const handleLockIn = async () => {
    if (!activeWagerId) {
      return;
    }

    try {
      const r = await fetch(`${API_URL}/wagers/${activeWagerId}/lock`, {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to lock wager");
      updateBalance(currentUser.name, data.balance);
      if (data.wager) {
        setWagers((prev) => prev.map((entry) => entry.id === data.wager.id ? data.wager : entry));
        setActiveWagerDetails(data.wager);
        setLockState({
          playerA: Boolean(data.wager.lockState?.playerA),
          playerB: data.wager.isBotMatch ? true : Boolean(data.wager.lockState?.playerB),
        });
      }
    } catch (err) {
      setMatchError(err.message);
    }
  };

  const finalizeMatch = async () => {
    if (!activeWager) return;
    clearMatchPolling();
    setServerInfo({ loading: true }); setMatchResult(null);
    setCopiedJoinCommand(false);
    const amountCents = Math.round(parseFloat(activeWager.amount.replace("$", "")) * 100);
    try {
      const r = await fetch(`${API_URL}/start-match-server`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          wagerId: activeWagerId,
          playerAName: matchPlayers.a,
          playerBName: matchPlayers.b,
          wagerAmount: amountCents,
          map: activeWager?.map || "de_dust2",
          matchProfile: activeWager?.matchProfile || undefined,
          matchRules: activeWager?.matchRules || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error("Failed to start match server");
      setServerInfo({
        matchId: data.matchId,
        name: data.slotId || "sw-na-slot-1",
        status: data.status || "allocating_server",
        map: activeWager?.map || "de_dust2",
        matchProfile: activeWager?.matchProfile || "duo_match",
        serverIp: data.serverIp,
        serverPort: data.serverPort,
        serverPassword: data.serverPassword,
        joinCommand:
          data.serverIp && data.serverPort && data.serverPassword
            ? `connect ${data.serverIp}:${data.serverPort}; password ${data.serverPassword}`
            : null,
        scoreCt: null,
        scoreT: null,
        playerAScore: null,
        playerBScore: null,
      });
      beginMatchPolling(data.matchId, {
        slotId: data.slotId || "sw-na-slot-1",
        status: data.status || "allocating_server",
        map: activeWager?.map || "de_dust2",
        matchProfile: activeWager?.matchProfile || "duo_match",
        serverIp: data.serverIp,
        serverPort: data.serverPort,
        serverPassword: data.serverPassword,
      });
    } catch (err) {
      clearMatchPolling();
      setServerInfo(null);
      setMatchError(err.message);
    }
  };

  const abandonMatch = () => {
    clearMatchPolling();
    setIsModalOpen(false); setActiveWagerId(null); setMatchPlayers({ a: null, b: null });
    setMatchError(null); setServerInfo(null); setMatchResult(null); setResultPolling(false);
    setLockState({ playerA: false, playerB: false });
    setActiveWagerDetails(null);
    setCopiedJoinCommand(false);
  };

  const deleteWager = async (wagerId) => {
    setDeletingWagerId(wagerId);
    try {
      const r = await fetch(`${API_URL}/wagers/${wagerId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "failed to delete wager");
      setWagers((prev) => prev.filter((wager) => wager.id !== wagerId));
      if (activeWagerId === wagerId) {
        abandonMatch();
      }
    } catch (err) {
      alert(err.message);
    }
    setDeletingWagerId(null);
  };

  const copyJoinCommand = async () => {
    if (!serverInfo?.joinCommand) return;
    try {
      await navigator.clipboard.writeText(serverInfo.joinCommand);
      setCopiedJoinCommand(true);
      setTimeout(() => setCopiedJoinCommand(false), 1500);
    } catch (err) {
      console.error("copy join command failed", err);
    }
  };

  const renderPlayerSlot = (slot) => {
    const isA = slot === "A";
    const playerName = isA ? matchPlayers.a : matchPlayers.b;
    const locked = isA ? lockState.playerA : lockState.playerB;
    const isMe = isA ? isPlayerA : isPlayerB;
    const isBotSlot = !isA && activeWager?.isBotMatch;
    const playerBalance = balances[playerName] || 0;
    const amountCents = activeWager ? Math.round(parseFloat(activeWager.amount.replace("$", "")) * 100) : 0;

    if (isBotSlot) return <div className="locked-badge"><span>&#10003;</span> Debug Bot Ready</div>;
    if (locked) return <div className="locked-badge"><span>&#10003;</span> Locked In</div>;
    if (activeWager?.isBotMatch && isA && isMe) {
      return (
        <div className="balance-lockin">
          <div className="balance-lockin-info">
            <span className="muted">Mode:</span>
            <span className="text-accent">Debug Bot Match</span>
          </div>
          <button className="btn primary" onClick={() => handleLockIn(slot)}>Ready Up</button>
        </div>
      );
    }
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
            {audit ? renderAuditSummary(audit) : (
              <div className="muted">No audit on record. Run an integrity check from the main page.</div>
            )}
          </div>

          <div className="profile-section">
            <h2>Wager History</h2>
            {pWagers.length === 0 ? (
              <div className="muted">No wagers yet.</div>
            ) : (
              <div className="wager-history">
                {pWagers.map((w) => {
                  const isCompleted = w.status === "completed" && w.result;
                  const isCreator = w.creator === currentUser.name;
                  const myScore = isCreator ? w.creatorScore : w.opponentScore;
                  const opponentScore = isCreator ? w.opponentScore : w.creatorScore;

                  return (
                    <div key={w.id} className="history-row">
                      <div className="history-matchup">
                        <span className="wager-name">{w.creator}</span>
                        {w.opponent && <span className="muted"> vs {w.opponent}</span>}
                        {isCompleted && (
                          <p className="history-subline">
                            Final: {typeof myScore === "number" ? myScore : 0} - {typeof opponentScore === "number" ? opponentScore : 0}
                          </p>
                        )}
                      </div>
                      <div className="muted">{w.map}</div>
                      <div className="text-accent">{w.amount}</div>
                      <div className="history-result">
                        {isCompleted ? (
                          w.result.winner === currentUser.name
                            ? <span className="text-success">WON</span>
                            : <span className="text-danger">LOST</span>
                        ) : (
                          <span className="muted">{w.status.toUpperCase()}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
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
            <button className="btn ghost small-btn" onClick={onDemoReset}>Demo Reset</button>
            <button className="btn ghost small-btn" onClick={onLogout}>Logout</button>
          </div>
        </div>
      </header>

      {activeWagerId && (isPlayerA || isPlayerB) && !matchResult && (() => {
        const myLock = isPlayerA ? lockState.playerA : lockState.playerB;
        const theirLock = isPlayerA ? lockState.playerB : lockState.playerA;
        const opponentName = isPlayerA ? matchPlayers.b : matchPlayers.a;
        let bannerClass = "banner", label = "";
        if (activeWager?.isBotMatch) { bannerClass += " ready"; label = `Debug bot wager ready \u2014 ${activeWager.matchProfile === "fast_solo_debug" ? "Fast Solo Debug" : "Solo Debug"}`; }
        else if (!matchPlayers.b) { bannerClass += " waiting"; label = "Your wager is live \u2014 waiting for a challenger"; }
        else if (theirLock && !myLock) { bannerClass += " urgent"; label = `${opponentName} locked in \u2014 your turn!`; }
        else if (bothLocked && serverInfo && !serverInfo.loading) {
          bannerClass += serverInfo.status === "live" ? " live" : " ready";
          label = `Match ${formatMatchStatusLabel(serverInfo.status).toLowerCase()}`;
        }
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
        {!integrity?.checked && !integrityLoading && (
          <div className="integrity-callout" onClick={runIntegrityCheck}>
            <div>
              <p className="integrity-callout-title">Run your integrity check to start making wagers</p>
              <p className="muted">Use the <strong>?</strong> button in the top-right header.</p>
            </div>
            <div className="integrity-callout-arrow" aria-hidden="true">↗</div>
          </div>
        )}
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
          {wagers.map((wager) => (
            <article key={wager.id} className={`wager-card ${activeWagerId === wager.id ? "selected" : ""}`}>
              <div className="wager-scoreboard">
                {renderFeedPlayer(wager.creator, wager.creatorAvatar, wager.creatorScore, "left", wager.creatorSteamId)}
                <div className="wager-top">
                  <div className="wager-amount">
                    <span>{wager.amount}</span>
                    <small className="text-accent">{wager.status === "live" ? "LIVE" : "ACTIVE"}</small>
                  </div>
                  <div className="wager-map">
                    <div><p className="muted small">MAP</p><p className="map-name">{wager.map}</p></div>
                  </div>
                </div>
                {renderFeedPlayer(wager.opponent || "Waiting...", wager.opponentAvatar, wager.opponentScore, "right", wager.opponentSteamId)}
              </div>
              <div className="wager-actions">
                <button className="btn accent full-width" onClick={() => openWagerModal(wager)}>
                  {activeWagerId === wager.id ? "VIEW WAGER" : wager.creator === currentUser.name ? "YOUR WAGER" : "JOIN WAGER"}
                </button>
                {wager.creatorSteamId === currentUser.steamId && (
                  <button
                    className="btn ghost danger"
                    onClick={() => deleteWager(wager.id)}
                    disabled={deletingWagerId === wager.id}
                  >
                    {deletingWagerId === wager.id ? "DELETING..." : "DELETE"}
                  </button>
                )}
              </div>
            </article>
          ))}
          {MOCK_WAGERS.map((wager) => (
            <article key={wager.id} className="wager-card mock-card">
              <div className="wager-scoreboard">
                {renderFeedPlayer(wager.creator, wager.creatorAvatar, wager.creatorScore, "left", wager.creatorSteamId)}
                <div className="wager-top">
                  <div className="wager-amount">
                    <span>{wager.amount}</span>
                    <small className="mock-badge">SHOWCASE</small>
                  </div>
                  <div className="wager-map">
                    <div><p className="muted small">MAP</p><p className="map-name">{wager.map}</p></div>
                  </div>
                </div>
                {renderFeedPlayer(wager.opponent, wager.opponentAvatar, wager.opponentScore, "right", wager.opponentSteamId)}
              </div>
              <div className="wager-actions">
                <button className="btn ghost full-width" disabled>Feed Preview</button>
              </div>
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
                <label className="field-label">OPPONENT</label>
                <select className="select" value={createOpponentType} onChange={(e) => setCreateOpponentType(e.target.value)}>
                  <option value="human">Human Challenger</option>
                  <option value="bot">Debug Bot</option>
                </select>
              </div>
              {createOpponentType === "bot" && (
                <div className="field">
                  <label className="field-label">DEBUG PROFILE</label>
                  <select className="select" value={createBotProfile} onChange={(e) => setCreateBotProfile(e.target.value)}>
                    <option value="solo_debug">Solo Debug</option>
                    <option value="fast_solo_debug">Fast Solo Debug</option>
                  </select>
                </div>
              )}
              <div className="field">
                <label className="field-label">FIRST TO</label>
                <select className="select" value={createRoundTarget} onChange={(e) => setCreateRoundTarget(Number(e.target.value))}>
                  {ROUND_TARGET_OPTIONS.map((target) => <option key={target} value={target}>{target} rounds</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">START MONEY</label>
                <select className="select" value={createStartMoney} onChange={(e) => setCreateStartMoney(Number(e.target.value))}>
                  {START_MONEY_OPTIONS.map((money) => <option key={money} value={money}>${money.toLocaleString()}</option>)}
                </select>
              </div>
              {createOpponentType === "bot" && (
                <>
                  <div className="field">
                    <label className="field-label">WARMUP</label>
                    <select className="select" value={createWarmupSeconds} onChange={(e) => setCreateWarmupSeconds(Number(e.target.value))}>
                      {WARMUP_OPTIONS.map((seconds) => <option key={seconds} value={seconds}>{seconds}s</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">BOT DIFFICULTY</label>
                    <select className="select" value={createBotDifficulty} onChange={(e) => setCreateBotDifficulty(Number(e.target.value))}>
                      {BOT_DIFFICULTY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                </>
              )}
              <div className="field">
                <label className="field-label">WAGER AMOUNT (USD)</label>
                <div className="amount-input"><span className="muted">$</span><input type="number" value={createAmount} onChange={(e) => setCreateAmount(e.target.value)} min="1" step="0.50" placeholder="5.00" /></div>
              </div>
              <div className="preview">
                <div className="preview-row"><span className="muted">Player</span><span>{currentUser.name}</span></div>
                <div className="preview-row"><span className="muted">Opponent</span><span>{createOpponentType === "bot" ? "Debug Bot" : "Public Challenger"}</span></div>
                {createOpponentType === "bot" && <div className="preview-row"><span className="muted">Profile</span><span>{createBotProfile === "fast_solo_debug" ? "Fast Solo Debug" : "Solo Debug"}</span></div>}
                <div className="preview-row"><span className="muted">Rules</span><span>{formatRulesSummary({
                  roundTarget: createRoundTarget,
                  startMoney: createStartMoney,
                  warmupSeconds: createOpponentType === "bot" ? createWarmupSeconds : 5,
                  botDifficulty: createOpponentType === "bot" ? createBotDifficulty : null,
                }, createOpponentType === "bot")}</span></div>
                <div className="preview-row"><span className="muted">Map</span><span>{createMap}</span></div>
                <div className="preview-row"><span className="muted">Amount</span><span className="text-accent">${parseFloat(createAmount || 0).toFixed(2)}</span></div>
              </div>
              <button className="btn primary" onClick={createWager} disabled={!createAmount || parseFloat(createAmount) <= 0}>
                {createOpponentType === "bot" ? "Create Bot Test Wager" : "Post Wager"}
              </button>
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
                {activeWager?.matchRules && <p className="muted small">{formatRulesSummary(activeWager.matchRules, activeWager.isBotMatch)}</p>}
              </div>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setIsModalOpen(false)}>Close</button>
                <button className="btn ghost danger" onClick={abandonMatch}>Reset</button>
              </div>
            </div>
            <div className="modal-body">
              {matchError && <div className="error-msg">{matchError}</div>}
              {!matchPlayers.b && !activeWager?.isBotMatch && (
                <div className="empty-state"><h3>Waiting for a challenger</h3><p className="muted">Your wager is live on the public board.</p></div>
              )}
              {(matchPlayers.b || activeWager?.isBotMatch) && (
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
                        {!serverInfo && isPlayerA && <button className="btn primary" onClick={finalizeMatch}>Provision Server</button>}
                        {!serverInfo && isPlayerB && <p className="muted">Waiting for the wager creator to provision the server.</p>}
                      </div>
                    </div>
                  )}
                  {serverInfo && !serverInfo.loading && !matchResult && (
                    <div className="server-card">
                      <div><p className="muted small">SERVER</p><h4>{serverInfo.name}</h4></div>
                      <div>
                        <p className="muted small">STATUS</p>
                        <h4 className="status-inline">
                          {isServerStatusActive && <span className="status-spinner" />}
                          {formatMatchStatusLabel(serverInfo.status)}
                        </h4>
                      </div>
                      <div><p className="muted small">MAP</p><h4>{serverInfo.map}</h4></div>
                      <div><p className="muted small">PROFILE</p><h4>{serverInfo.matchProfile === "fast_solo_debug" ? "Fast Solo Debug" : serverInfo.matchProfile === "solo_debug" ? "Solo Debug" : "Duo Match"}</h4></div>
                      {serverInfo.serverIp && <div><p className="muted small">CONNECT</p><h4>{serverInfo.serverIp}:{serverInfo.serverPort}</h4></div>}
                      {serverInfo.serverPassword && <div><p className="muted small">PASSWORD</p><h4>{serverInfo.serverPassword}</h4></div>}
                      {(typeof serverInfo.playerAScore === "number" || typeof serverInfo.playerBScore === "number") && (
                        <div>
                          <p className="muted small">SCORE</p>
                          <h4>{`${serverInfo.playerAScore ?? 0} - ${serverInfo.playerBScore ?? 0}`}</h4>
                        </div>
                      )}
                      {serverInfo.joinCommand && (
                        <div className="join-command-card">
                          <p className="muted small">DEV CONSOLE</p>
                          <div className="join-command-row">
                            <code>{serverInfo.joinCommand}</code>
                            <button className="btn ghost small-btn" onClick={copyJoinCommand}>
                              {copiedJoinCommand ? "Copied" : "Copy"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {serverInfo?.loading && <div className="muted center">Starting match server...</div>}
                  {resultPolling && !matchResult && serverInfo && !serverInfo.loading && (
                    <div className="match-in-progress">
                      <div className="progress-text"><span className="progress-dot" />Match in progress</div>
                    </div>
                  )}
                  {matchResult && (
                    <div className="match-result">
                      <h3 className="text-accent">Match Complete</h3>
                      <p className="muted">
                        {activeWager?.map} &bull; {activeWager?.amount} wager
                        {matchResult.debugMatch && " • Debug bot match"}
                      </p>
                      {(typeof serverInfo?.playerAScore === "number" || typeof serverInfo?.playerBScore === "number") && (
                        <p className="muted">{`Final score: ${serverInfo?.playerAScore ?? 0} - ${serverInfo?.playerBScore ?? 0}`}</p>
                      )}
                      <div className="result-players">
                        <div className="result-player winner">
                          <span className="result-tag winner-tag">WINNER</span><span className="result-name">{matchResult.winner}</span>
                          <span className="muted">
                            {matchResult.debugMatch
                              ? `Balance unchanged • ${fmt(matchResult.winnerBalance)}`
                              : `+${fmt(matchResult.wagerAmount)} → ${fmt(matchResult.winnerBalance)}`}
                          </span>
                        </div>
                        <div className="result-player loser">
                          <span className="result-tag loser-tag">LOSER</span><span className="result-name">{matchResult.loser}</span>
                          <span className="muted">
                            {matchResult.debugMatch
                              ? `Balance unchanged • ${fmt(matchResult.loserBalance)}`
                              : `-${fmt(matchResult.wagerAmount)} → ${fmt(matchResult.loserBalance)}`}
                          </span>
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
      {auditModalOpen && (
        <div className="modal-backdrop" onClick={() => setAuditModalOpen(false)}>
          <div className="modal-card small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="audit-modal-header">
                {auditProfile?.avatar
                  ? <img src={auditProfile.avatar} alt="" className="profile-avatar small" />
                  : <div className="avatar audit-avatar-fallback">{(auditProfile?.personaname || "?").slice(0, 2)}</div>}
                <div>
                  <p className="muted small">PLAYER AUDIT</p>
                  <h3>{auditProfile?.personaname || "Player"}</h3>
                  {auditProfile?.steamId && <p className="muted">{auditProfile.steamId.startsWith("mock_") ? "Showcase profile" : `Steam ID: ${auditProfile.steamId}`}</p>}
                </div>
              </div>
              <button className="btn ghost" onClick={() => setAuditModalOpen(false)}>Close</button>
            </div>
            <div className="modal-body">
              {auditProfileLoading
                ? <div className="muted center">Loading audit...</div>
                : renderAuditSummary(auditProfile?.integrity)}
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
