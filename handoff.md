# SafeWager CS2 Handoff

## Current status

This repo is no longer using only mock/in-memory CS2 state for the server flow.

Completed:

- Reworked the high-level plan in `safewager-cs2-high-level-plan.md` toward a realistic school-project MVP.
- Added SQLite-backed backend persistence in `backend/db.js`.
- Updated `backend/index.js` to:
  - persist matches, slots, server events, and artifacts in SQLite
  - call a real CS2 VM controller when configured
  - sync controller match events back into SQLite
  - support `matchProfile` values for real server startup
  - support solo flows without requiring a second human player name
- Added a VM-side CS2 controller in `cs2-controller/index.js`.
- Added a VM-side startup script in `cs2-controller/start-server.sh`.
- Provisioned a real Ubuntu VM on GCP and installed SteamCMD + CS2 dedicated server.
- Verified:
  - real player joins
  - real kill logs
  - round win logs
  - match completion logs
  - delayed auto-shutdown after match completion

## Important current behaviors

- `solo_debug`
  - bot enabled
  - warmup is 15 seconds
  - MR5 / first to 3
- `fast_solo_debug`
  - bot enabled
  - warmup is 15 seconds
  - MR1 / first to 1
  - verified that match completion triggers delayed shutdown
- `duo_match`
  - no bots
  - held warmup
  - intended to wait for both expected real players on opposite teams before going live

## What is verified working

The clean verification run was `fast_solo_join_3`.

Observed:

- `match.completed` was emitted by the controller at `2026-04-16T01:09:54.415Z`
- `server.stopped` was emitted by the controller at `2026-04-16T01:10:55.170Z`
- controller health then reported:
  - `serviceState: "inactive"`
  - slot `status: "available"`
  - `currentMatchId: null`

Server log also showed the actual stop sequence:

- `SIGTERM received while server was not hibernating`
- `Server shutting down: NETWORK_DISCONNECT_EXITING`
- Steam game server deactivation
- socket close / process shutdown

That means the one-minute delayed shutdown behavior is working end to end.

## Known issues still remaining

### 1. Winner attribution is wrong in solo runs

The controller still infers winners based on expected player names and fallback team logic.

Example:

- actual in-game player: `Bryan`
- configured expected player: sometimes `Collin`
- result can be recorded as `winnerName: "BotOpponent"` even when the real human won

This should be fixed by tracking expected players with Steam ID or by reconciling the real connected player to the configured participant more reliably.

### 2. Post-game score noise can overwrite score fields

After `Game Over`, CS2 can still emit additional score/status lines as the match transitions.
The controller currently still processes some of those lines, so score fields in controller state can drift after completion.

Best fix:

- once `match.status === "completed"`, ignore future `match.score` and similar state-mutating events for that match

### 3. `duo_match` is implemented but not fully re-verified after latest iterations

It should:

- start with no bots
- hold warmup
- only go live once both expected real players are present on opposite teams

That path still needs a clean live retest with two real players after the latest profile changes.

## Repo files that matter

- `backend/index.js`
- `backend/db.js`
- `backend/data/safewager.sqlite`
- `cs2-controller/index.js`
- `cs2-controller/start-server.sh`
- `.env`
- `safewager-cs2-high-level-plan.md`

## Local environment

Repo path:

- `/Users/collin/Projects/SafeWager`

Important local env in `.env`:

- `DEMO_SERVER_HOST="35.238.128.180"`
- `CS2_CONTROLLER_URL="http://35.238.128.180:8080"`
- `CS2_CONTROLLER_TOKEN="09F0AB40-89FC-4F5B-BED4-1FEA580C10E7"`

## GCP / VM details

Project:

- `safewager`

VM:

- name: `safewager-cs2-demo`
- zone: `us-central1-a`
- machine: `e2-standard-4`
- OS: Ubuntu 22.04
- external IP: `35.238.128.180`

Disk:

- resized to 150 GB

Firewall rules already opened:

- game traffic: tcp/udp `27015-27020`
- controller: tcp `8080`

## How to access the VM

Use `gcloud` from the repo root or any local shell.

Basic SSH:

```bash
gcloud compute ssh safewager-cs2-demo --zone=us-central1-a
```

Run a remote command without an interactive shell:

```bash
gcloud compute ssh safewager-cs2-demo --zone=us-central1-a --command='sudo systemctl status safewager-cs2-controller.service --no-pager --lines=20'
```

Copy a local file to the VM:

```bash
gcloud compute scp cs2-controller/index.js safewager-cs2-demo:/tmp/safewager-controller-index.js --zone=us-central1-a
```

## Important VM paths

Controller:

- code: `/opt/safewager-cs2-controller/index.js`
- env: `/etc/safewager/controller.env`
- systemd unit: `safewager-cs2-controller.service`

CS2 server:

- install root: `/srv/cs2/game`
- startup script: `/srv/cs2/scripts/start-server.sh`
- runtime env: `/etc/safewager/cs2.env`
- stdout log: `/srv/cs2/runtime/server.out.log`
- stderr log: `/srv/cs2/runtime/server.err.log`
- controller state file: `/srv/cs2/runtime/controller-state.json`
- systemd unit: `safewager-cs2.service`

Config files written at launch:

- `/srv/cs2/game/csgo/cfg/server.cfg`
- `/srv/cs2/game/csgo/cfg/gamemode_competitive_server.cfg`

## Useful service commands

Controller status:

```bash
gcloud compute ssh safewager-cs2-demo --zone=us-central1-a --command='sudo systemctl status safewager-cs2-controller.service --no-pager --lines=20'
```

CS2 status:

```bash
gcloud compute ssh safewager-cs2-demo --zone=us-central1-a --command='sudo systemctl status safewager-cs2.service --no-pager --lines=20'
```

Restart controller:

```bash
gcloud compute ssh safewager-cs2-demo --zone=us-central1-a --command='sudo systemctl restart safewager-cs2-controller.service'
```

Stop CS2:

```bash
gcloud compute ssh safewager-cs2-demo --zone=us-central1-a --command='sudo systemctl stop safewager-cs2.service'
```

Start CS2 indirectly:

- normally do this by starting a match through the controller, not by starting the systemd unit manually

## How to check logs

Tail server log:

```bash
gcloud compute ssh safewager-cs2-demo --zone=us-central1-a --command='sudo tail -n 120 -f /srv/cs2/runtime/server.out.log'
```

Read the controller state file:

```bash
gcloud compute ssh safewager-cs2-demo --zone=us-central1-a --command='sudo cat /srv/cs2/runtime/controller-state.json'
```

Check the current generated CS2 env:

```bash
gcloud compute ssh safewager-cs2-demo --zone=us-central1-a --command='sudo cat /etc/safewager/cs2.env'
```

Check generated competitive override config:

```bash
gcloud compute ssh safewager-cs2-demo --zone=us-central1-a --command='sudo cat /srv/cs2/game/csgo/cfg/gamemode_competitive_server.cfg'
```

Check controller service logs:

```bash
gcloud compute ssh safewager-cs2-demo --zone=us-central1-a --command='sudo journalctl -u safewager-cs2-controller.service -n 100 --no-pager'
```

Check CS2 service logs:

```bash
gcloud compute ssh safewager-cs2-demo --zone=us-central1-a --command='sudo journalctl -u safewager-cs2.service -n 100 --no-pager'
```

## Controller HTTP endpoints

Health:

```bash
curl -s http://35.238.128.180:8080/health
```

List slot state:

```bash
curl -s http://35.238.128.180:8080/slots -H 'x-controller-token: 09F0AB40-89FC-4F5B-BED4-1FEA580C10E7'
```

Start a match:

```bash
curl -s -X POST http://35.238.128.180:8080/slots/slot_na_1/start-match \
  -H 'Content-Type: application/json' \
  -H 'x-controller-token: 09F0AB40-89FC-4F5B-BED4-1FEA580C10E7' \
  --data '{"matchId":"test_match","playerAName":"Bryan","playerBName":"BotOpponent","map":"de_dust2","serverPassword":"testpw","hostname":"SafeWager Test","matchProfile":"fast_solo_debug"}'
```

Stop current match:

```bash
curl -s -X POST http://35.238.128.180:8080/slots/slot_na_1/stop-match \
  -H 'x-controller-token: 09F0AB40-89FC-4F5B-BED4-1FEA580C10E7'
```

Fetch a match:

```bash
curl -s http://35.238.128.180:8080/matches/fast_solo_join_3 \
  -H 'x-controller-token: 09F0AB40-89FC-4F5B-BED4-1FEA580C10E7'
```

## Backend usage notes

The backend can call the controller automatically using `.env`.

Run backend locally:

```bash
node backend/index.js
```

Start a real match through the backend:

```bash
curl -s -X POST http://127.0.0.1:4242/start-match-server \
  -H 'Content-Type: application/json' \
  --data '{"playerAName":"Bryan","wagerAmount":"$5.00","map":"de_dust2","matchProfile":"fast_solo_debug"}'
```

Fetch backend match state:

```bash
curl -s http://127.0.0.1:4242/matches/<match_id>
```

Note:

- `start-match-server` now syncs slot state from the controller before selecting a slot
- this was added to avoid stale SQLite slot allocation state

## How the deployment loop has been working

When editing controller code locally:

1. edit `cs2-controller/index.js` and/or `cs2-controller/start-server.sh`
2. syntax check locally:

```bash
node --check cs2-controller/index.js
```

3. copy files to VM:

```bash
gcloud compute scp cs2-controller/index.js safewager-cs2-demo:/tmp/safewager-controller-index.js --zone=us-central1-a
gcloud compute scp cs2-controller/start-server.sh safewager-cs2-demo:/tmp/safewager-start-server.sh --zone=us-central1-a
```

4. deploy them:

```bash
gcloud compute ssh safewager-cs2-demo --zone=us-central1-a --command='sudo cp /tmp/safewager-controller-index.js /opt/safewager-cs2-controller/index.js && sudo cp /tmp/safewager-start-server.sh /srv/cs2/scripts/start-server.sh && sudo chmod 755 /srv/cs2/scripts/start-server.sh && sudo systemctl restart safewager-cs2-controller.service'
```

5. verify:

```bash
gcloud compute ssh safewager-cs2-demo --zone=us-central1-a --command='sudo systemctl status safewager-cs2-controller.service --no-pager --lines=20'
```

## Notes about CS2 runtime behavior learned during testing

- `gamemode_competitive.cfg` overrides many values from `server.cfg`
- the correct place to override competitive settings is `gamemode_competitive_server.cfg`
- `mp_do_warmup_period` was not accepted on this server build
- the controller ended up handling warmup behavior more reliably than relying on that cvar
- RCON was reachable on the VM's actual local IPv4 interface, not just `127.0.0.1`
- the controller now probes local IPv4 interfaces instead of assuming loopback

## Current operational profile summary

### `solo_debug`

- bot enabled
- 15s warmup
- MR5
- auto-shutdown after completion

### `fast_solo_debug`

- bot enabled
- 15s warmup
- MR1
- auto-shutdown after completion
- verified shutdown behavior on clean run

### `duo_match`

- no bots
- held warmup
- should wait for both expected real players before going live
- still needs a fresh re-verification

## Suggested next steps for the next session

1. Fix winner attribution logic.
2. Ignore post-completion score noise so completed matches keep stable score data.
3. Re-test `duo_match` with two real players.
4. Optionally expose match profiles in the frontend if you want easy manual testing.
5. Optionally add a small admin/debug page for:
   - start server
   - stop server
   - see slot health
   - tail controller events

## One-line restart point for tomorrow

If starting fresh in a new Codex session, say:

> Read `handoff.md`, inspect `cs2-controller/index.js`, `cs2-controller/start-server.sh`, and `backend/index.js`, then continue from the remaining issues section.
