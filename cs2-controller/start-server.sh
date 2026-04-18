#!/usr/bin/env bash
set -euo pipefail

source /etc/safewager/cs2.env

PROFILE="${CS2_MATCH_PROFILE:-duo_match}"
ROUND_TARGET="${CS2_ROUND_TARGET:-}"
START_MONEY="${CS2_START_MONEY:-}"
WARMUP_SECONDS="${CS2_WARMUP_SECONDS:-}"
BOT_DIFFICULTY="${CS2_BOT_DIFFICULTY:-2}"
cd "${CS2_INSTALL_DIR}"
mkdir -p "${CS2_LOG_DIR}"

if [[ -n "${ROUND_TARGET}" ]]; then
  MAX_ROUNDS=$(( ROUND_TARGET * 2 - 1 ))
else
  MAX_ROUNDS=5
fi

if [[ -z "${START_MONEY}" ]]; then
  if [[ "${PROFILE}" == "duo_match" ]]; then
    START_MONEY=800
  else
    START_MONEY=16000
  fi
fi

if [[ -z "${WARMUP_SECONDS}" ]]; then
  if [[ "${PROFILE}" == "duo_match" ]]; then
    WARMUP_SECONDS=60
  else
    WARMUP_SECONDS=15
  fi
fi

cat > /tmp/safewager-server.cfg <<CFG
hostname "${CS2_HOSTNAME}"
rcon_password "${CS2_RCON_PASSWORD}"
sv_password "${CS2_SERVER_PASSWORD}"
sv_lan 0
sv_cheats 0
sv_region 0
mp_autoteambalance 0
mp_limitteams 0
log on
sv_logfile 1
CFG

cat > /tmp/gamemode_competitive_server.cfg <<CFG
mp_autoteambalance 0
mp_limitteams 0
mp_roundtime 1.92
mp_roundtime_defuse 1.92
mp_freezetime 3
mp_maxrounds ${MAX_ROUNDS}
mp_startmoney ${START_MONEY}
mp_maxmoney 16000
CFG

if [[ "${PROFILE}" == "solo_debug" ]]; then
  cat >> /tmp/gamemode_competitive_server.cfg <<CFG
bot_difficulty ${BOT_DIFFICULTY}
bot_quota 1
bot_quota_mode normal
mp_warmuptime ${WARMUP_SECONDS}
mp_warmup_pausetimer 0
CFG
elif [[ "${PROFILE}" == "fast_solo_debug" ]]; then
  cat > /tmp/gamemode_competitive_server.cfg <<CFG
mp_autoteambalance 0
mp_limitteams 0
mp_roundtime 1.92
mp_roundtime_defuse 1.92
mp_freezetime 3
mp_maxrounds ${MAX_ROUNDS}
mp_startmoney ${START_MONEY}
mp_maxmoney 16000
bot_difficulty ${BOT_DIFFICULTY}
bot_quota 1
bot_quota_mode normal
mp_warmuptime ${WARMUP_SECONDS}
mp_warmup_pausetimer 0
CFG
else
  cat >> /tmp/gamemode_competitive_server.cfg <<CFG
bot_quota 0
bot_quota_mode normal
mp_warmuptime 9999
mp_warmup_pausetimer 1
CFG
fi

cp /tmp/safewager-server.cfg "${CS2_INSTALL_DIR}/csgo/cfg/server.cfg"
cp /tmp/gamemode_competitive_server.cfg "${CS2_INSTALL_DIR}/csgo/cfg/gamemode_competitive_server.cfg"

ARGS=( -dedicated -usercon -console -port "${CS2_PORT}" +game_alias "${CS2_GAME_ALIAS}" +map "${CS2_MAP}" )
if [[ -n "${CS2_GSLT:-}" ]]; then
  ARGS+=( +sv_setsteamaccount "${CS2_GSLT}" )
else
  echo "[warn] CS2_GSLT is empty; server will be LAN-restricted" >&2
fi

exec ./cs2.sh "${ARGS[@]}"
