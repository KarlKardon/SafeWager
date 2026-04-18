const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.SAFEWAGER_DB_PATH || path.join(dataDir, "safewager.sqlite");
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS wagers (
    id TEXT PRIMARY KEY,
    creator_username TEXT NOT NULL,
    creator_steam_id TEXT NOT NULL,
    creator_avatar TEXT,
    opponent_username TEXT,
    opponent_steam_id TEXT,
    opponent_avatar TEXT,
    wager_type TEXT NOT NULL DEFAULT 'pvp',
    match_profile TEXT,
    match_rules_json TEXT,
    amount_cents INTEGER NOT NULL,
    map TEXT NOT NULL,
    status TEXT NOT NULL,
    match_id TEXT,
    winner_name TEXT,
    loser_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    wager_id TEXT,
    player_one_name TEXT NOT NULL,
    player_one_steam_id TEXT,
    player_two_name TEXT NOT NULL,
    player_two_steam_id TEXT,
    status TEXT NOT NULL,
    selected_map TEXT NOT NULL,
    region TEXT NOT NULL,
    server_slot_id TEXT,
    server_ip TEXT,
    server_port INTEGER,
    server_password TEXT,
    winner_name TEXT,
    loser_name TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (wager_id) REFERENCES wagers(id)
  );

  CREATE TABLE IF NOT EXISTS server_slots (
    id TEXT PRIMARY KEY,
    slot_name TEXT NOT NULL,
    host TEXT NOT NULL,
    game_port INTEGER NOT NULL,
    gotv_port INTEGER NOT NULL,
    rcon_port INTEGER NOT NULL,
    status TEXT NOT NULL,
    current_match_id TEXT,
    last_heartbeat_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS server_events (
    id TEXT PRIMARY KEY,
    match_id TEXT,
    slot_id TEXT,
    event_type TEXT NOT NULL,
    source_event_id TEXT,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS match_artifacts (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    log_path TEXT,
    demo_path TEXT,
    created_at TEXT NOT NULL
  );
`);

const wagerColumns = db.prepare("PRAGMA table_info(wagers)").all();
if (!wagerColumns.some((column) => column.name === "wager_type")) {
  db.exec("ALTER TABLE wagers ADD COLUMN wager_type TEXT NOT NULL DEFAULT 'pvp'");
}
if (!wagerColumns.some((column) => column.name === "match_profile")) {
  db.exec("ALTER TABLE wagers ADD COLUMN match_profile TEXT");
}
if (!wagerColumns.some((column) => column.name === "opponent_avatar")) {
  db.exec("ALTER TABLE wagers ADD COLUMN opponent_avatar TEXT");
}
if (!wagerColumns.some((column) => column.name === "match_rules_json")) {
  db.exec("ALTER TABLE wagers ADD COLUMN match_rules_json TEXT");
}

const serverEventColumns = db.prepare("PRAGMA table_info(server_events)").all();
if (!serverEventColumns.some((column) => column.name === "source_event_id")) {
  db.exec("ALTER TABLE server_events ADD COLUMN source_event_id TEXT");
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_server_events_source_event_id
  ON server_events(source_event_id)
  WHERE source_event_id IS NOT NULL
`);

const slotCount = db.prepare("SELECT COUNT(*) AS count FROM server_slots").get().count;
if (slotCount === 0) {
  const now = new Date().toISOString();
  const host = process.env.DEMO_SERVER_HOST || "127.0.0.1";
  db.prepare(`
    INSERT INTO server_slots (
      id, slot_name, host, game_port, gotv_port, rcon_port, status,
      current_match_id, last_heartbeat_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "slot_na_1",
    "sw-na-slot-1",
    host,
    27015,
    27020,
    27016,
    "available",
    null,
    now,
    now,
    now
  );
}

const configuredHost = process.env.DEMO_SERVER_HOST;
if (configuredHost) {
  db.prepare(`
    UPDATE server_slots
    SET host = ?, updated_at = ?
    WHERE id = ?
  `).run(configuredHost, new Date().toISOString(), "slot_na_1");
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  db,
  dbPath,
  makeId,
  nowIso,
};
