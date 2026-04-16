# SafeWager CS2 Server Plan

## Goal
Add real CS2 1v1 match hosting to SafeWager so the project can demo an end-to-end flow that feels legitimate:

- two users create and confirm a match
- SafeWager allocates a real private CS2 server
- the site shows join details and live match state
- the backend records the result from the server side

This is a school-project MVP, so the goal is not high scale or full production hardening. The goal is a realistic architecture that works reliably enough for a live demo.

## Core Approach

### 1. Build around one persistent VM
- Use one GCP VM for the first version
- Install SteamCMD and the CS2 dedicated server on that machine
- Run 1 server slot first, then expand to 2-3 slots only if testing shows it is stable
- Do not create one VM per match

This keeps the system understandable, cheaper to run, and much easier to demo.

### 2. Treat result detection as the first technical proof
- Start by manually running a private CS2 server on the VM
- Join the server with test clients
- Confirm what data is actually available from logs and RCON
- Verify whether the server can reliably identify players, match start, match end, disconnects, and winner

If result detection is weak or ambiguous, the rest of the automation is not trustworthy. This must be proven before deeper backend work.

### 3. Add a real database before server orchestration
- Move match state out of memory and into a database
- Store users, matches, server slots, server events, and match results
- Use the database as the shared source of truth between the main backend and the VM controller

For this project, PostgreSQL is the simplest realistic choice. It looks credible in a demo and fits the match/slot/event relationships well.

### 4. Use a small controller service on the VM
- Run a lightweight Node service on the VM
- Give it responsibility for starting, stopping, resetting, and monitoring CS2 server processes
- Have it report status and match events back to the main SafeWager backend
- Treat it as a normal service, not as part of the frontend app and not as an AI component

This keeps game-server process management separate from the public API.

### 5. Keep the playable ruleset intentionally narrow
- Support only one mode at first: CS2 1v1
- Support only a small set of approved maps/settings
- Avoid complex custom lobby logic or multi-mode matchmaking
- Optimize for one clean, repeatable demo flow

That scope is much more likely to produce a stable end-to-end build.

## MVP System Design

### Main backend responsibilities
- user auth and match creation
- writing match state to the database
- choosing an available server slot
- sending a start request to the VM controller
- receiving match lifecycle events from the VM controller
- exposing match status to the frontend

### VM controller responsibilities
- manage CS2 server instance directories and config files
- start and stop CS2 server processes
- assign port, password, and match-specific settings
- watch logs and poll RCON for health/state
- send server events and final result back to SafeWager
- clean up the slot after the match ends

### Frontend responsibilities
- show match creation and confirmation flow
- show server allocation progress
- display server IP, port, and password
- show live status such as waiting_for_players, live, completed, failed
- provide a simple admin/demo view for logs and manual overrides

## Recommended Match State Machine

Use a state machine that reflects both player flow and infrastructure flow:

- `draft`
- `awaiting_opponent`
- `awaiting_confirmation`
- `allocating_server`
- `server_ready`
- `awaiting_players`
- `live`
- `result_pending`
- `completed`
- `cancelled`
- `abandoned`
- `failed`

Why this is better than a simpler flow:
- `allocating_server` separates backend intent from actual server readiness
- `awaiting_players` covers the case where the server exists but players have not both joined
- `result_pending` gives room for log parsing, retries, or manual review
- `abandoned` gives you a clean outcome for no-shows or disconnect-heavy demos

## Minimum Database Schema

### `matches`
- `id`
- `player_one_id`
- `player_two_id`
- `status`
- `selected_map`
- `region`
- `server_slot_id`
- `server_ip`
- `server_port`
- `server_password`
- `winner_user_id`
- `created_at`
- `updated_at`

### `server_slots`
- `id`
- `slot_name`
- `host`
- `game_port`
- `gotv_port`
- `rcon_port`
- `status`
- `current_match_id`
- `last_heartbeat_at`

### `server_events`
- `id`
- `match_id`
- `slot_id`
- `event_type`
- `payload_json`
- `created_at`

### `match_artifacts`
- `id`
- `match_id`
- `log_path`
- `demo_path`
- `created_at`

This is enough to make the system feel real without overdesigning it.

## VM Controller API Contract

Define a simple contract early so the backend and VM service stay cleanly separated.

### Backend -> controller
- `POST /slots/:slotId/start-match`
- `POST /slots/:slotId/stop-match`
- `POST /slots/:slotId/reset`
- `GET /slots`
- `GET /slots/:slotId/health`

### Controller -> backend
- `POST /internal/server-events`
- `POST /internal/match-result`
- `POST /internal/slot-heartbeat`

Each request should include a shared secret or service token so the public frontend cannot call these endpoints directly.

## What Must Be Proven Early

### 1. CS2 observability
- Can logs or RCON reliably show who joined?
- Can the system identify both players consistently?
- Can the system determine when the match actually started?
- Can it determine the winner with enough confidence for a demo?

### 2. Slot reset reliability
- Can the same slot be reused without leaving stale config or process state behind?
- Can the controller recover if the previous process crashes?
- Can a match be force-cleaned without manually rebooting the VM?

### 3. Demo reliability
- Can you start a match from the site and get valid join details within a reasonable time?
- Can you show match progress updates in the UI?
- Can you resolve the match and show logs/artifacts afterward?

These matter more for the school project than theoretical scalability.

## Recommended Build Order

1. Manually provision one CS2 server on one GCP VM
2. Prove that logs and/or RCON expose enough data to determine match lifecycle and winner
3. Add PostgreSQL and create tables for matches, slots, and server events
4. Add backend match states and slot assignment logic
5. Build the VM controller service with start, stop, reset, and heartbeat endpoints
6. Automate one server slot end-to-end from the SafeWager UI
7. Add no-show handling, timeouts, slot cleanup, and manual admin override
8. If stable, expand to 2-3 slots on the same VM

## GCP VM Recommendation

### Best starting point
Use an **E2-standard-4** VM first.

Why:
- enough CPU and memory for one realistic CS2 server demo plus controller/backend overhead
- cheap enough for a school project
- simple starting point before measuring real usage

Specs:
- 4 vCPU
- 16 GB RAM

### Upgrade path
Move to **N2-standard-4** only if you see CPU pressure or poor performance during actual test matches.

### What not to do yet
- do not start with one VM per match
- do not optimize for autoscaling
- do not add Kubernetes, containers, or queueing systems unless the MVP is already working
- do not build for heavy traffic that this project will never receive

## Demo-First Priorities

If time is limited, prioritize the parts that make the project look real in a live walkthrough:

- real CS2 server creation on demand
- real server details shown in the UI
- visible match state transitions
- stored logs or demo artifacts
- admin/demo page for slot status, match events, and manual result override

Those pieces will make the project feel much more substantial than chasing production-scale concerns.

## Final Recommendation

Build this as a realistic single-region MVP:

- one main backend
- one PostgreSQL database
- one GCP VM
- one VM controller service
- one working CS2 server slot first

That is the best balance between technical depth, demo reliability, and implementation time. It is credible, shows real infrastructure work, and avoids wasting effort on scale problems that do not matter for this project.
