#!/usr/bin/env node

/**
 * Mock CS2 Dedicated Server
 *
 * Simulates a 1v1 CS2 match with realistic console output.
 * Fetches match info from the SafeWager backend, plays out rounds,
 * then reports the winner back to the backend for wager resolution.
 *
 * Auto-spawned by the backend when "Provision Server" is clicked.
 * Skip can be triggered via POST /skip-match from the frontend.
 */

const API_URL = "http://localhost:4242";

const WEAPONS = [
  "ak47",
  "m4a1_silencer",
  "awp",
  "deagle",
  "usp_silencer",
  "glock",
  "p250",
  "famas",
  "galil",
  "ssg08",
  "mp9",
  "mac10",
  "knife",
];

const HITGROUPS = ["", " (headshot)", " (headshot)", ""];

const ROUND_WIN_REASONS = [
  "SFUI_Notice_CTs_Win",
  "SFUI_Notice_Terrorists_Win",
  "SFUI_Notice_Target_Bombed",
  "SFUI_Notice_All_Hostages_Rescued",
];

let skipRequested = false;
let matchData = null;

/* ── Helpers ── */

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(msg) {
  process.stdout.write(`L ${ts()} - ${msg}\n`);
}

function rawLog(msg) {
  process.stdout.write(`${msg}\n`);
}

function randomCoord() {
  return Math.floor(Math.random() * 2000 - 1000);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function checkSkip() {
  if (skipRequested) return;
  try {
    const res = await fetch(`${API_URL}/should-skip`);
    const data = await res.json();
    if (data.skip) {
      skipRequested = true;
      rawLog(``);
      rawLog(`>>> SKIP REQUESTED — fast-forwarding to match end <<<`);
      rawLog(``);
    }
  } catch {
    // ignore
  }
}

function sleep(ms) {
  if (skipRequested) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Poll for skip every 500ms during sleep
    const check = setInterval(async () => {
      await checkSkip();
      if (skipRequested) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 500);
  });
}

/* ── Fetch match data from backend ── */

async function fetchMatch() {
  try {
    const res = await fetch(`${API_URL}/active-match`);
    if (!res.ok) {
      console.error(
        "No active match found. Make sure both players have locked in and you clicked 'Provision Server'."
      );
      process.exit(1);
    }
    return await res.json();
  } catch (err) {
    console.error(`Cannot reach backend at ${API_URL}: ${err.message}`);
    process.exit(1);
  }
}

/* ── Report result to backend ── */

async function reportResult(winner) {
  try {
    const res = await fetch(`${API_URL}/resolve-match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winner }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  } catch (err) {
    console.error(`Failed to report match result: ${err.message}`);
    process.exit(1);
  }
}

/* ── Simulate server startup ── */

async function simulateStartup(map) {
  rawLog("Console initialized.");
  rawLog(`ConVarRef room_type doesn't point to an existing ConVar`);
  rawLog(`Setting breakpad minidump AppID = 730`);
  rawLog(`SteamInternal_SetMinidumpSteamID: Caching Steam ID...`);
  await sleep(400);
  rawLog(`Loading map "${map}"...`);
  rawLog(`server_cvar: "mp_maxrounds" "5"`);
  rawLog(`server_cvar: "mp_roundtime" "1.92"`);
  rawLog(`server_cvar: "mp_freezetime" "3"`);
  rawLog(`server_cvar: "sv_cheats" "0"`);
  rawLog(`server_cvar: "mp_autoteambalance" "0"`);
  rawLog(`server_cvar: "sv_maxrate" "0"`);
  await sleep(600);
  rawLog(`Network: IP 192.168.1.42, mode MP, dedicated Yes, ports 27015 SV / 27020 CL`);
  rawLog(`VAC secure mode is activated.`);
  rawLog(`GC Connection established for server version 1422, instance idx 1`);
  rawLog(`=== SafeWager 1v1 Match Server Ready ===`);
  rawLog(``);
}

/* ── Simulate player connections ── */

async function simulatePlayerConnect(name, idx, team) {
  const steamId = `STEAM_0:${idx}:${10000 + Math.floor(Math.random() * 90000)}`;
  log(
    `"${name}<${idx + 1}><${steamId}><>" connected, address "192.168.1.${100 + idx}:2700${idx}"`
  );
  await sleep(200);
  log(`"${name}<${idx + 1}><${steamId}><>" entered the game`);
  await sleep(150);
  log(
    `"${name}<${idx + 1}><${steamId}>" switched from team <Unassigned> to <${team}>`
  );
  return steamId;
}

/* ── Simulate a single round ── */

async function simulateRound(roundNum, playerA, playerB, steamA, steamB, scoreA, scoreB) {
  rawLog(``);
  log(`World triggered "Round_Start"`);
  rawLog(`--- Round ${roundNum} ---`);
  await sleep(skipRequested ? 0 : 1500 + Math.random() * 2000);

  // Randomly pick who wins this round
  const aWins = Math.random() > 0.5;
  const killer = aWins ? playerA : playerB;
  const victim = aWins ? playerB : playerA;
  const killerSteam = aWins ? steamA : steamB;
  const victimSteam = aWins ? steamB : steamA;
  const killerTeam = aWins ? "CT" : "TERRORIST";
  const victimTeam = aWins ? "TERRORIST" : "CT";
  const killerIdx = aWins ? 2 : 3;
  const victimIdx = aWins ? 3 : 2;
  const weapon = pick(WEAPONS);
  const hitgroup = pick(HITGROUPS);

  log(
    `"${killer}<${killerIdx}><${killerSteam}><${killerTeam}>" [${randomCoord()} ${randomCoord()} ${randomCoord()}] killed "${victim}<${victimIdx}><${victimSteam}><${victimTeam}>" [${randomCoord()} ${randomCoord()} ${randomCoord()}] with "${weapon}"${hitgroup}`
  );

  await sleep(skipRequested ? 0 : 500);

  const newScoreA = aWins ? scoreA + 1 : scoreA;
  const newScoreB = aWins ? scoreB : scoreB + 1;
  const winTeam = aWins ? "CT" : "TERRORIST";
  const winReason = aWins ? ROUND_WIN_REASONS[0] : ROUND_WIN_REASONS[1];

  log(
    `Team "${winTeam}" triggered "${winReason}" (CT "${newScoreA}") (T "${newScoreB}")`
  );
  log(`World triggered "Round_End"`);

  return { scoreA: newScoreA, scoreB: newScoreB };
}

/* ── Main ── */

async function main() {
  rawLog(`========================================`);
  rawLog(`  SafeWager Mock CS2 Server v1.0`);
  rawLog(`========================================`);
  rawLog(``);

  // Fetch match info
  rawLog(`Fetching match data from ${API_URL}...`);
  matchData = await fetchMatch();
  rawLog(
    `Match loaded: ${matchData.playerAName} vs ${matchData.playerBName} on ${matchData.map}`
  );
  rawLog(``);

  // Server startup
  await simulateStartup(matchData.map);

  // Player connections
  await sleep(500);
  const steamA = await simulatePlayerConnect(matchData.playerAName, 0, "CT");
  await sleep(300);
  const steamB = await simulatePlayerConnect(matchData.playerBName, 1, "TERRORIST");
  await sleep(500);

  rawLog(``);
  log(`=== Match starting: ${matchData.playerAName} (CT) vs ${matchData.playerBName} (T) ===`);
  log(`=== Best of 5 rounds, first to 3 wins ===`);

  // Play rounds
  const MAX_ROUNDS = 5;
  const WIN_TARGET = 3;
  let scoreA = 0;
  let scoreB = 0;
  let round = 1;

  while (scoreA < WIN_TARGET && scoreB < WIN_TARGET && round <= MAX_ROUNDS) {
    const result = await simulateRound(
      round,
      matchData.playerAName,
      matchData.playerBName,
      steamA,
      steamB,
      scoreA,
      scoreB
    );
    scoreA = result.scoreA;
    scoreB = result.scoreB;

    round++;
    await sleep(skipRequested ? 0 : 800);
  }

  // Determine winner
  const winnerSlot = scoreA >= scoreB ? "A" : "B";
  const winnerName = winnerSlot === "A" ? matchData.playerAName : matchData.playerBName;
  const loserName = winnerSlot === "A" ? matchData.playerBName : matchData.playerAName;

  rawLog(``);
  rawLog(`========================================`);
  log(
    `Game Over: competitive ${matchData.map} score ${scoreA}:${scoreB} after ${round - 1} rounds`
  );
  rawLog(``);
  rawLog(`  WINNER: ${winnerName}`);
  rawLog(`  SCORE:  ${scoreA} - ${scoreB}`);
  rawLog(`========================================`);
  rawLog(``);

  // Report to backend
  rawLog(`Reporting result to SafeWager backend...`);
  const resolution = await reportResult(winnerSlot);
  rawLog(`Wager resolved:`);
  rawLog(`  ${resolution.winner}: hold released (funds returned)`);
  rawLog(`  ${resolution.loser}: funds captured (wager lost)`);
  rawLog(``);
  rawLog(`Server shutting down. GG!`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
