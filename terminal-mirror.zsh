# --- Terminal Mirror Integration ---
# Source this in .zshrc:  source /path/to/terminal-mirror.zsh

export TAURI_MIRROR_PORT=1234
_TM_URL="http://127.0.0.1:${TAURI_MIRROR_PORT}"

# --- Detect if a command is Claude Code (works with aliases/functions) ---
_tm_is_claude() {
  local cmd="$1"
  local first_word="${cmd%% *}"
  # Direct match
  [[ "$first_word" == "claude" ]] && return 0
  # Resolve alias/function — e.g. "ccc" → "claude"
  local resolved=$(whence "$first_word" 2>/dev/null)
  [[ "$resolved" == *claude* ]] && return 0
  return 1
}

# --- Command categorization ---
# "service" = long-running dev server, flash blue then idle
# "task"    = normal command, stay busy until done
_tm_classify() {
  local cmd="$1"
  if [[ "$cmd" =~ (^|[[:space:]/])(start|dev|serve|watch|metro|docker-compose|docker\ compose|up|run\ dev|run\ start|run\ serve)([[:space:]]|$) ]]; then
    echo "service"
  else
    echo "task"
  fi
}

# --- Send a status/heartbeat request with URL-safe params ---
# Usage: _tm_send <endpoint> <key=value>...
_tm_send() {
  local endpoint="$1"
  shift
  local args=(-G --data-urlencode "pid=$$" \
              --data-urlencode "title=${PWD##*/}" \
              --data-urlencode "pwd=${PWD}" \
              --data-urlencode "tty=${TTY}")
  for kv in "$@"; do
    args+=(--data-urlencode "$kv")
  done
  curl -s --max-time 1 "${args[@]}" "${_TM_URL}${endpoint}" > /dev/null 2>&1 &!
}

# --- Heartbeat (background, every 20s) ---
_tm_heartbeat() {
  while true; do
    _tm_send /heartbeat
    sleep 20
  done
}

# Kill any heartbeat from a previous sourcing (re-source restarts it with new code)
if [[ -n "$_TM_HEARTBEAT_PID" ]]; then
  kill "$_TM_HEARTBEAT_PID" 2>/dev/null
  unset _TM_HEARTBEAT_PID
fi

_tm_heartbeat &!
_TM_HEARTBEAT_PID=$!
trap "kill $_TM_HEARTBEAT_PID 2>/dev/null" EXIT

# --- Hooks ---
_tm_preexec() {
  # Claude Code has its own hooks — skip entirely
  _tm_is_claude "$1" && return
  local cmd_type=$(_tm_classify "$1")
  _tm_send /status "state=busy" "type=${cmd_type}"
}

_tm_precmd() {
  _tm_send /status "state=idle"
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _tm_preexec
add-zsh-hook precmd  _tm_precmd
