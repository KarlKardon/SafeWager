const http = require("http");
const net = require("net");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const CONFIG = {
  port: Number(process.env.CONTROLLER_PORT || 8080),
  token: process.env.CONTROLLER_TOKEN || "",
  slotId: process.env.CONTROLLER_SLOT_ID || "slot_na_1",
  slotName: process.env.CONTROLLER_SLOT_NAME || "sw-na-slot-1",
  publicHost: process.env.CONTROLLER_PUBLIC_HOST || "127.0.0.1",
  gamePort: Number(process.env.CONTROLLER_GAME_PORT || 27015),
  gotvPort: Number(process.env.CONTROLLER_GOTV_PORT || 27020),
  rconPort: Number(process.env.CONTROLLER_RCON_PORT || 27016),
  serviceName: process.env.CONTROLLER_CS2_SERVICE || "safewager-cs2.service",
  envFile: process.env.CONTROLLER_CS2_ENV_FILE || "/etc/safewager/cs2.env",
  logFile: process.env.CONTROLLER_LOG_FILE || "/srv/cs2/runtime/server.out.log",
  stateFile: process.env.CONTROLLER_STATE_FILE || "/srv/cs2/runtime/controller-state.json",
  winTarget: Number(process.env.CONTROLLER_WIN_TARGET || 3),
  postMatchShutdownDelayMs: Number(process.env.CONTROLLER_POST_MATCH_SHUTDOWN_DELAY_MS || 60000),
  pollIntervalMs: Number(process.env.CONTROLLER_POLL_INTERVAL_MS || 2000),
};

if (!CONFIG.token) {
  console.error("Missing CONTROLLER_TOKEN");
  process.exit(1);
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG.stateFile, "utf8"));
  } catch {
    return {
      logOffset: 0,
      logRemainder: "",
      slots: {
        [CONFIG.slotId]: {
          id: CONFIG.slotId,
          slotName: CONFIG.slotName,
          host: CONFIG.publicHost,
          gamePort: CONFIG.gamePort,
          gotvPort: CONFIG.gotvPort,
          rconPort: CONFIG.rconPort,
          status: "available",
          currentMatchId: null,
          lastHeartbeatAt: null,
        },
      },
      matches: {},
      eventsByMatch: {},
    };
  }
}

let state = loadState();
const postMatchShutdownTimers = new Map();

function saveState() {
  fs.mkdirSync(path.dirname(CONFIG.stateFile), { recursive: true });
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
}

function getSlot() {
  if (!state.slots[CONFIG.slotId]) {
    state.slots[CONFIG.slotId] = {
      id: CONFIG.slotId,
      slotName: CONFIG.slotName,
      host: CONFIG.publicHost,
      gamePort: CONFIG.gamePort,
      gotvPort: CONFIG.gotvPort,
      rconPort: CONFIG.rconPort,
      status: "available",
      currentMatchId: null,
      lastHeartbeatAt: null,
    };
  }
  return state.slots[CONFIG.slotId];
}

function getMatch(matchId) {
  return state.matches[matchId] || null;
}

function ensureMatch(matchId) {
  if (!state.matches[matchId]) {
    state.matches[matchId] = {
      id: matchId,
      matchProfile: "duo_match",
      status: "allocating_server",
      scoreCt: 0,
      scoreT: 0,
      playerTeams: {},
      playersJoined: {},
      playerSteamIds: {},
      validatedPlayers: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }
  if (!state.eventsByMatch[matchId]) {
    state.eventsByMatch[matchId] = [];
  }
  return state.matches[matchId];
}

function appendEvent(matchId, eventType, payload = {}) {
  if (!matchId) return;
  const event = {
    id: makeId("controller_evt"),
    matchId,
    slotId: CONFIG.slotId,
    eventType,
    payload,
    createdAt: nowIso(),
  };
  state.eventsByMatch[matchId] = state.eventsByMatch[matchId] || [];
  state.eventsByMatch[matchId].push(event);
  if (state.eventsByMatch[matchId].length > 500) {
    state.eventsByMatch[matchId] = state.eventsByMatch[matchId].slice(-500);
  }
  saveState();
}

function updateMatchStatus(matchId, status, extra = {}) {
  const match = ensureMatch(matchId);
  match.status = status;
  Object.assign(match, extra, { updatedAt: nowIso() });
  saveState();
}

function setSlotStatus(status, currentMatchId = null) {
  const slot = getSlot();
  slot.status = status;
  slot.currentMatchId = currentMatchId;
  slot.lastHeartbeatAt = nowIso();
  saveState();
}

function clearPostMatchShutdown(matchId) {
  const timer = postMatchShutdownTimers.get(matchId);
  if (timer) {
    clearTimeout(timer);
    postMatchShutdownTimers.delete(matchId);
  }
}

function schedulePostMatchShutdown(matchId) {
  clearPostMatchShutdown(matchId);
  const timer = setTimeout(() => {
    const match = getMatch(matchId);
    const slot = getSlot();

    if (!match || slot.currentMatchId !== matchId) {
      postMatchShutdownTimers.delete(matchId);
      return;
    }

    stopGameService()
      .then(() => {
        appendEvent(matchId, "server.stopped", {
          reason: "post_match_shutdown",
        });
        setSlotStatus("available", null);
      })
      .catch((error) => {
        appendEvent(matchId, "controller.stop_error", {
          reason: "post_match_shutdown",
          error: error.message,
        });
      })
      .finally(() => {
        postMatchShutdownTimers.delete(matchId);
      });
  }, CONFIG.postMatchShutdownDelayMs);

  postMatchShutdownTimers.set(matchId, timer);
}

function loadEnvFile() {
  const env = {};
  const text = fs.readFileSync(CONFIG.envFile, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx);
    let value = trimmed.slice(idx + 1);
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function saveEnvFile(env) {
  const lines = Object.entries(env).map(([key, value]) => {
    const str = String(value === undefined || value === null ? "" : value);
    if (/[\s"]/u.test(str)) {
      return `${key}="${str.replace(/"/g, '\\"')}"`;
    }
    return `${key}=${str}`;
  });
  fs.writeFileSync(CONFIG.envFile, `${lines.join("\n")}\n`);
}

async function runCommand(file, args) {
  return execFileAsync(file, args, { encoding: "utf8" });
}

async function restartGameService() {
  await runCommand("systemctl", ["restart", CONFIG.serviceName]);
}

async function stopGameService() {
  await runCommand("systemctl", ["stop", CONFIG.serviceName]);
}

async function getServiceActiveState() {
  try {
    const { stdout } = await runCommand("systemctl", ["is-active", CONFIG.serviceName]);
    return stdout.trim();
  } catch (error) {
    return (error.stdout && error.stdout.trim()) || "inactive";
  }
}

function inferPlayersByTeam(match, team) {
  const entries = Object.entries(match.playerTeams || {})
    .filter(([, assignedTeam]) => assignedTeam === team)
    .map(([name]) => name);
  return entries;
}

function encodeRconPacket(requestId, type, body) {
  const bodyBuffer = Buffer.from(body, "utf8");
  const size = 4 + 4 + bodyBuffer.length + 2;
  const packet = Buffer.alloc(4 + size);
  packet.writeInt32LE(size, 0);
  packet.writeInt32LE(requestId, 4);
  packet.writeInt32LE(type, 8);
  bodyBuffer.copy(packet, 12);
  packet.writeInt16LE(0, 12 + bodyBuffer.length);
  return packet;
}

function sendRconCommand(command) {
  const candidateHosts = [];
  const seenHosts = new Set();

  function addHost(host) {
    if (!host || seenHosts.has(host)) return;
    seenHosts.add(host);
    candidateHosts.push(host);
  }

  addHost("127.0.0.1");
  addHost(CONFIG.publicHost);

  const networkInterfaces = os.networkInterfaces();
  Object.keys(networkInterfaces).forEach((name) => {
    (networkInterfaces[name] || []).forEach((details) => {
      if (details.family === "IPv4" && !details.internal) {
        addHost(details.address);
      }
    });
  });

  return new Promise((resolve, reject) => {
    const env = loadEnvFile();
    const password = env.CS2_RCON_PASSWORD || "";
    if (!password) {
      return reject(new Error("missing_rcon_password"));
    }

    let hostIndex = 0;

    function tryNextHost(lastError) {
      if (hostIndex >= candidateHosts.length) {
        return reject(lastError || new Error("rcon_unreachable"));
      }

      const host = candidateHosts[hostIndex];
      hostIndex += 1;

      const socket = net.createConnection(
        {
          host,
          port: CONFIG.gamePort,
        },
        () => {
          socket.write(encodeRconPacket(10, 3, password));
        }
      );

      let authed = false;
      let buffer = Buffer.alloc(0);
      let settled = false;

      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
          const size = buffer.readInt32LE(0);
          if (buffer.length < size + 4) break;
          const packet = buffer.slice(0, size + 4);
          buffer = buffer.slice(size + 4);
          const requestId = packet.readInt32LE(4);
          const type = packet.readInt32LE(8);

          if (!authed) {
            if (requestId === -1) {
              settled = true;
              socket.destroy();
              return reject(new Error("rcon_auth_failed"));
            }
            authed = true;
            socket.write(encodeRconPacket(11, 2, command));
          } else if (type === 0 || requestId === 11) {
            settled = true;
            socket.end();
            return resolve();
          }
        }
      });

      socket.on("error", (error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        tryNextHost(error);
      });

      socket.setTimeout(5000, () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        tryNextHost(new Error("rcon_timeout"));
      });
    }

    tryNextHost();
  });
}

function sendRconCommandWithRetry(matchId, command, attemptsLeft, delayMs) {
  sendRconCommand(command).catch((error) => {
    if (attemptsLeft > 1) {
      setTimeout(() => {
        sendRconCommandWithRetry(matchId, command, attemptsLeft - 1, delayMs);
      }, delayMs);
      return;
    }

    appendEvent(matchId, "controller.rcon_error", {
      command,
      error: error.message,
    });
  });
}

function isExpectedRealPlayer(match, playerName, steamId) {
  if (!steamId || steamId === "BOT") return false;
  return playerName === match.playerAName || playerName === match.playerBName;
}

function getProfileWinTarget(match) {
  if (match && match.matchProfile === "fast_solo_debug") {
    return 1;
  }
  return CONFIG.winTarget;
}

function maybePromoteLive(matchId) {
  const match = getMatch(matchId);
  if (!match || match.status === "completed") return;

  if (match.matchProfile === "solo_debug" || match.matchProfile === "fast_solo_debug") {
    if (match.playersJoined[match.playerAName]) {
      updateMatchStatus(matchId, "live", {
        startedAt: match.startedAt || nowIso(),
      });
    } else {
      updateMatchStatus(matchId, "awaiting_players");
    }
    return;
  }

  const playerAReady = Boolean(match.playersJoined[match.playerAName]);
  const playerBReady = Boolean(match.playersJoined[match.playerBName]);
  const playerATeam = match.playerTeams[match.playerAName];
  const playerBTeam = match.playerTeams[match.playerBName];
  const oppositeTeams =
    playerATeam &&
    playerBTeam &&
    playerATeam !== playerBTeam &&
    ["CT", "TERRORIST"].includes(playerATeam) &&
    ["CT", "TERRORIST"].includes(playerBTeam);

  if (playerAReady && playerBReady && oppositeTeams) {
    updateMatchStatus(matchId, "live", {
      startedAt: match.startedAt || nowIso(),
    });
    if (!match.warmupEnded) {
      match.warmupEnded = true;
      saveState();
      sendRconCommand("bot_kick; mp_warmup_end").catch((error) => {
        appendEvent(matchId, "controller.rcon_error", {
          command: "bot_kick; mp_warmup_end",
          error: error.message,
        });
      });
    }
  } else {
    updateMatchStatus(matchId, "awaiting_players");
  }
}

function primeMatchState(matchId) {
  const match = getMatch(matchId);
  if (!match) return;

  if (match.matchProfile === "solo_debug" || match.matchProfile === "fast_solo_debug") {
    return;
  }

  sendRconCommandWithRetry(
    matchId,
    "mp_warmup_start; mp_warmup_pausetimer 1; mp_warmuptime 9999",
    5,
    1500
  );
}

function maybeCompleteMatch(matchId) {
  const match = getMatch(matchId);
  if (!match || match.status === "completed") return;
  const winTarget = getProfileWinTarget(match);
  if (match.scoreCt < winTarget && match.scoreT < winTarget) return;

  const winnerTeam = match.scoreCt >= winTarget ? "CT" : "TERRORIST";
  const loserTeam = winnerTeam === "CT" ? "TERRORIST" : "CT";
  const winnerName =
    inferPlayersByTeam(match, winnerTeam)[0] ||
    (winnerTeam === "CT" ? match.playerAName : match.playerBName);
  const loserName =
    inferPlayersByTeam(match, loserTeam)[0] ||
    (loserTeam === "CT" ? match.playerAName : match.playerBName);

  updateMatchStatus(matchId, "completed", {
    completedAt: nowIso(),
    winnerName,
    loserName,
  });
  appendEvent(matchId, "match.completed", {
    winnerName,
    loserName,
    winnerTeam,
    scoreCt: match.scoreCt,
    scoreT: match.scoreT,
  });
  schedulePostMatchShutdown(matchId);
}

function processLine(line) {
  const slot = getSlot();
  const matchId = slot.currentMatchId;
  if (!matchId) return;

  const match = ensureMatch(matchId);

  if (line.includes("Network socket 'server' opened on port")) {
    updateMatchStatus(matchId, "server_ready");
    setSlotStatus("allocated", matchId);
    appendEvent(matchId, "server.ready", {
      host: CONFIG.publicHost,
      gamePort: CONFIG.gamePort,
    });
    primeMatchState(matchId);
    return;
  }

  let m = line.match(/"(.+?)<\d+><(.+?)><.*?>" connected, address "(.+?)"/);
  if (m) {
    const [, playerName, steamId, address] = m;
    if (isExpectedRealPlayer(match, playerName, steamId)) {
      match.playerSteamIds[playerName] = steamId;
    }
    updateMatchStatus(matchId, "awaiting_players", {
      playerSteamIds: match.playerSteamIds,
    });
    appendEvent(matchId, "player.connected", { playerName, steamId, address });
    return;
  }

  m = line.match(/"(.+?)<\d+><(.+?)><.*?>" STEAM USERID validated/);
  if (m) {
    const [, playerName, steamId] = m;
    if (isExpectedRealPlayer(match, playerName, steamId)) {
      match.validatedPlayers[playerName] = true;
      match.playerSteamIds[playerName] = steamId;
      updateMatchStatus(matchId, "awaiting_players", {
        validatedPlayers: match.validatedPlayers,
        playerSteamIds: match.playerSteamIds,
      });
    }
    appendEvent(matchId, "player.validated", { playerName, steamId });
    return;
  }

  m = line.match(/"(.+?)<\d+><(.+?)><.*?>" entered the game/);
  if (m) {
    const [, playerName, steamId] = m;
    if (isExpectedRealPlayer(match, playerName, steamId)) {
      match.playersJoined[playerName] = true;
      match.playerSteamIds[playerName] = steamId;
      updateMatchStatus(matchId, "awaiting_players", {
        playersJoined: match.playersJoined,
        playerSteamIds: match.playerSteamIds,
      });
    }
    appendEvent(matchId, "player.joined", { playerName, steamId });
    maybePromoteLive(matchId);
    return;
  }

  m = line.match(/"(.+?)<\d+><(.+?)><.*?>" switched from team <.+?> to <(CT|TERRORIST)>/);
  if (m) {
    const [, playerName, steamId, team] = m;
    if (isExpectedRealPlayer(match, playerName, steamId)) {
      match.playerTeams[playerName] = team;
      match.playerSteamIds[playerName] = steamId;
      updateMatchStatus(matchId, match.status, {
        playerTeams: match.playerTeams,
        playerSteamIds: match.playerSteamIds,
      });
    }
    appendEvent(matchId, "player.team", { playerName, steamId, team });
    maybePromoteLive(matchId);
    return;
  }

  if (line.includes('World triggered "Round_Start"')) {
    if (!match.startedAt && match.status === "live") {
      match.startedAt = nowIso();
    }
    updateMatchStatus(matchId, match.status === "live" ? "live" : "awaiting_players", {
      startedAt: match.startedAt || null,
    });
    appendEvent(matchId, "round.start", {});
    return;
  }

  m = line.match(
    /"(.+?)<\d+><(.+?)><(.+?)>".+? killed "(.+?)<\d+><(.+?)><(.+?)>".+? with "(.+?)"( \(headshot\))?/
  );
  if (m) {
    const [, killerName, killerSteamId, killerTeam, victimName, victimSteamId, victimTeam, weapon, headshot] =
      m;
    appendEvent(matchId, "player.kill", {
      killerName,
      killerSteamId,
      killerTeam,
      victimName,
      victimSteamId,
      victimTeam,
      weapon,
      headshot: Boolean(headshot),
    });
    return;
  }

  m = line.match(/Team "(CT|TERRORIST)" triggered "(.+?)" \(CT "(\d+)"\) \(T "(\d+)"\)/);
  if (m) {
    const [, winningTeam, reason, scoreCt, scoreT] = m;
    match.scoreCt = Number(scoreCt);
    match.scoreT = Number(scoreT);
    updateMatchStatus(matchId, "live", { scoreCt: match.scoreCt, scoreT: match.scoreT });
    appendEvent(matchId, "round.win", {
      winningTeam,
      reason,
      scoreCt: match.scoreCt,
      scoreT: match.scoreT,
    });
    maybeCompleteMatch(matchId);
    return;
  }

  m = line.match(/MatchStatus: Score: (\d+):(\d+) on map "(.+?)" RoundsPlayed: (\-?\d+)/);
  if (m) {
    const [, scoreCt, scoreT, mapName, roundsPlayed] = m;
    match.scoreCt = Number(scoreCt);
    match.scoreT = Number(scoreT);
    updateMatchStatus(matchId, match.status, {
      scoreCt: match.scoreCt,
      scoreT: match.scoreT,
      selectedMap: mapName,
      roundsPlayed: Number(roundsPlayed),
    });
    appendEvent(matchId, "match.score", {
      scoreCt: match.scoreCt,
      scoreT: match.scoreT,
      mapName,
      roundsPlayed: Number(roundsPlayed),
    });
    maybeCompleteMatch(matchId);
    return;
  }

  if (line.includes('World triggered "Round_End"')) {
    appendEvent(matchId, "round.end", {});
  }
}

function readNewLogLines() {
  try {
    const stats = fs.statSync(CONFIG.logFile);
    if (stats.size < state.logOffset) {
      state.logOffset = 0;
      state.logRemainder = "";
    }
    if (stats.size === state.logOffset) return;

    const fd = fs.openSync(CONFIG.logFile, "r");
    const buffer = Buffer.alloc(stats.size - state.logOffset);
    fs.readSync(fd, buffer, 0, buffer.length, state.logOffset);
    fs.closeSync(fd);

    state.logOffset = stats.size;
    const text = state.logRemainder + buffer.toString("utf8");
    const lines = text.split("\n");
    state.logRemainder = lines.pop() || "";
    for (const line of lines) {
      processLine(line);
    }
    saveState();
  } catch {
    // Ignore until the server writes a log file.
  }
}

async function poll() {
  const slot = getSlot();
  const activeState = await getServiceActiveState();
  slot.lastHeartbeatAt = nowIso();
  if (slot.currentMatchId) {
    slot.status = activeState === "active" ? "allocated" : "failed";
  } else if (activeState === "active") {
    slot.status = "allocated";
  } else {
    slot.status = "available";
  }
  saveState();
  readNewLogLines();
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function unauthorized(res) {
  writeJson(res, 401, { error: "unauthorized" });
}

function notFound(res) {
  writeJson(res, 404, { error: "not_found" });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function handleStartMatch(req, res, slotId) {
  if (slotId !== CONFIG.slotId) {
    return notFound(res);
  }

  const body = await readRequestBody(req);
  const { matchId, playerAName, playerBName, map, serverPassword, hostname, matchProfile } =
    body || {};
  if (!matchId || !playerAName || !playerBName) {
    return writeJson(res, 400, { error: "matchId, playerAName, and playerBName are required" });
  }

  const env = loadEnvFile();
  env.CS2_MAP = map || env.CS2_MAP || "de_dust2";
  env.CS2_SERVER_PASSWORD = serverPassword || env.CS2_SERVER_PASSWORD || "safewager-demo";
  env.CS2_HOSTNAME =
    hostname || `SafeWager ${playerAName} vs ${playerBName}`.slice(0, 60).trim() || "SafeWager CS2";
  env.CS2_MATCH_PROFILE =
    matchProfile === "solo_debug" || matchProfile === "fast_solo_debug"
      ? matchProfile
      : "duo_match";
  env.CS2_PLAYER_A = playerAName;
  env.CS2_PLAYER_B = playerBName;
  saveEnvFile(env);

  const slot = getSlot();
  if (slot.currentMatchId) {
    clearPostMatchShutdown(slot.currentMatchId);
  }
  await stopGameService().catch(() => {});
  state.logOffset = 0;
  state.logRemainder = "";
  try {
    fs.writeFileSync(CONFIG.logFile, "");
    fs.writeFileSync("/srv/cs2/runtime/server.err.log", "");
  } catch {}

  state.matches[matchId] = {
    id: matchId,
    playerAName,
    playerBName,
    selectedMap: env.CS2_MAP,
    serverPassword: env.CS2_SERVER_PASSWORD,
    matchProfile: env.CS2_MATCH_PROFILE,
    status: "allocating_server",
    scoreCt: 0,
    scoreT: 0,
    playerTeams: {},
    playersJoined: {},
    playerSteamIds: {},
    validatedPlayers: {},
    warmupEnded: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.eventsByMatch[matchId] = [];
  slot.currentMatchId = matchId;
  slot.status = "allocating";
  slot.lastHeartbeatAt = nowIso();
  saveState();
  appendEvent(matchId, "match.allocating", {
    map: env.CS2_MAP,
    playerAName,
    playerBName,
    matchProfile: env.CS2_MATCH_PROFILE,
  });

  await restartGameService();

  writeJson(res, 200, {
    ok: true,
    slotId: CONFIG.slotId,
    host: CONFIG.publicHost,
    gamePort: CONFIG.gamePort,
    gotvPort: CONFIG.gotvPort,
    rconPort: CONFIG.rconPort,
    serverPassword: env.CS2_SERVER_PASSWORD,
    status: "allocating_server",
  });
}

async function handleStopMatch(res, slotId) {
  if (slotId !== CONFIG.slotId) {
    return notFound(res);
  }
  await stopGameService();
  const slot = getSlot();
  const matchId = slot.currentMatchId;
  if (matchId) {
    clearPostMatchShutdown(matchId);
    updateMatchStatus(matchId, "cancelled", { completedAt: nowIso() });
    appendEvent(matchId, "match.cancelled", {});
  }
  setSlotStatus("available", null);
  writeJson(res, 200, { ok: true });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${CONFIG.port}`);

    if (url.pathname !== "/health" && req.headers["x-controller-token"] !== CONFIG.token) {
      return unauthorized(res);
    }

    if (req.method === "GET" && url.pathname === "/health") {
      const activeState = await getServiceActiveState();
      return writeJson(res, 200, {
        ok: true,
        controller: "ready",
        serviceState: activeState,
        slot: getSlot(),
      });
    }

    if (req.method === "GET" && url.pathname === "/slots") {
      return writeJson(res, 200, { slots: [getSlot()] });
    }

    const startMatchRoute = url.pathname.match(/^\/slots\/([^/]+)\/start-match$/);
    if (req.method === "POST" && startMatchRoute) {
      return await handleStartMatch(req, res, startMatchRoute[1]);
    }

    const stopMatchRoute = url.pathname.match(/^\/slots\/([^/]+)\/stop-match$/);
    if (req.method === "POST" && stopMatchRoute) {
      return await handleStopMatch(res, stopMatchRoute[1]);
    }

    const matchRoute = url.pathname.match(/^\/matches\/([^/]+)$/);
    if (req.method === "GET" && matchRoute) {
      const matchId = matchRoute[1];
      return writeJson(res, 200, {
        match: getMatch(matchId),
        events: state.eventsByMatch[matchId] || [],
      });
    }

    return notFound(res);
  } catch (error) {
    console.error("[controller] request error", error);
    return writeJson(res, 500, { error: error.message || "server_error" });
  }
});

server.listen(CONFIG.port, () => {
  console.log(`[controller] listening on ${CONFIG.port}`);
});

setInterval(() => {
  poll().catch((error) => {
    console.error("[controller] poll error", error);
  });
}, CONFIG.pollIntervalMs);

poll().catch((error) => {
  console.error("[controller] initial poll error", error);
});
