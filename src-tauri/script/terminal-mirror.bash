# --- Ani-Mime Terminal Mirror (Bash) ---
# Source this in .bashrc:  source /path/to/terminal-mirror.bash

export TAURI_MIRROR_PORT=1234
_TM_URL="http://127.0.0.1:${TAURI_MIRROR_PORT}"
_TM_CMD_RUNNING=0
_TM_TTY=$(tty 2>/dev/null || echo "")

# --- Detect if a command is Claude Code ---
_tm_is_claude() {
  local first_word="${1%% *}"
  [[ "$first_word" == "claude" ]] && return 0
  local resolved=$(type -p "$first_word" 2>/dev/null)
  [[ "$resolved" == *claude* ]] && return 0
  return 1
}

# --- Command categorization ---
_tm_classify() {
  local cmd="$1"
  if [[ "$cmd" =~ (^|[[:space:]/])(start|dev|serve|watch|metro|expo|docker-compose|docker\ compose|up|run\ dev|run\ start|run\ serve|run\ ios|run\ android|ssh)([[:space:]]|$) ]]; then
    echo "service"
  else
    echo "task"
  fi
}

# Helper: run a command in background without job notifications
_tm_bg() { { "$@" & disown; } 2>/dev/null; }

# --- Send a status/heartbeat request with URL-safe params ---
_tm_send() {
  local endpoint="$1"
  shift
  local args=(-G --data-urlencode "pid=$$" \
              --data-urlencode "title=${PWD##*/}" \
              --data-urlencode "pwd=${PWD}" \
              --data-urlencode "tty=${_TM_TTY}")
  for kv in "$@"; do
    args+=(--data-urlencode "$kv")
  done
  _tm_bg curl -s --max-time 1 "${args[@]}" "${_TM_URL}${endpoint}" > /dev/null 2>&1
}

# --- Heartbeat (background, every 20s) ---
_tm_heartbeat() {
  while true; do
    curl -s --max-time 2 -G \
      --data-urlencode "pid=$$" \
      --data-urlencode "title=${PWD##*/}" \
      --data-urlencode "pwd=${PWD}" \
      --data-urlencode "tty=${_TM_TTY}" \
      "${_TM_URL}/heartbeat" > /dev/null 2>&1
    sleep 20
  done
}

# Kill any heartbeat from a previous sourcing (re-source restarts it with new code)
if [[ -n "$_TM_HEARTBEAT_PID" ]]; then
  kill "$_TM_HEARTBEAT_PID" 2>/dev/null
  unset _TM_HEARTBEAT_PID
fi

{ _tm_heartbeat & disown; } 2>/dev/null
_TM_HEARTBEAT_PID=$!
trap "kill $_TM_HEARTBEAT_PID 2>/dev/null" EXIT

# --- Preexec via DEBUG trap ---
_tm_preexec() {
  # Guard: only fire once per command, not per pipeline segment
  [[ "$_TM_CMD_RUNNING" == "1" ]] && return
  # Skip if this is the PROMPT_COMMAND itself
  [[ "$BASH_COMMAND" == "_tm_precmd" ]] && return
  [[ "$BASH_COMMAND" == *"_tm_precmd"* ]] && return

  _TM_CMD_RUNNING=1
  local cmd="$BASH_COMMAND"

  # Claude Code has its own hooks — skip entirely
  _tm_is_claude "$cmd" && return

  local cmd_type=$(_tm_classify "$cmd")
  _tm_send /status "state=busy" "type=${cmd_type}"
}
trap '_tm_preexec' DEBUG

# --- Precmd via PROMPT_COMMAND ---
_tm_precmd() {
  _TM_CMD_RUNNING=0
  _tm_send /status "state=idle"
}
PROMPT_COMMAND="_tm_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
