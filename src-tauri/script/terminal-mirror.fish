# --- Ani-Mime Terminal Mirror (Fish) ---
# Add to fish config:  source /path/to/terminal-mirror.fish

# Skip entirely when this shell was spawned by an AI CLI that runs its own
# tool-use shells (Claude Code, Codex). Without this guard those nested
# shells register orphan sessions and fire preexec on every internal
# command — which keeps the dog stuck on "working" the whole AI session.
# Fish has no `return` from a sourced script, so we set a flag and gate
# the rest of the file on it; never call `exit`, which would terminate
# the user's interactive shell.
set -l _tm_parent_name (ps -o comm= -p $fish_pid 2>/dev/null | xargs basename 2>/dev/null)
set -l _tm_skip 0
switch "$_tm_parent_name"
    case claude claude.exe codex codex.exe 'codex-*'
        set _tm_skip 1
end

if test "$_tm_skip" -eq 0

set -g _TM_URL "http://127.0.0.1:1234"
set -g _TM_TTY (tty 2>/dev/null; or echo "")

# --- Detect if a command is Claude Code ---
function _tm_is_claude
    set -l first_word (string split ' ' -- $argv[1])[1]
    test "$first_word" = "claude"; and return 0
    set -l resolved (type -p "$first_word" 2>/dev/null)
    string match -q '*claude*' -- "$resolved"; and return 0
    return 1
end

# --- Detect if a command is OpenAI Codex CLI ---
# Skipped in preexec because codex has no busy/idle hooks of its own.
function _tm_is_codex
    set -l first_word (string split ' ' -- $argv[1])[1]
    test "$first_word" = "codex"; and return 0
    set -l resolved (type -p "$first_word" 2>/dev/null)
    string match -q '*codex*' -- "$resolved"; and return 0
    return 1
end

# --- Command categorization ---
function _tm_classify
    set -l cmd "$argv[1]"
    if string match -rq '(^|\s|/)(start|dev|serve|watch|metro|expo|docker-compose|docker compose|up|run dev|run start|run serve|run ios|run android|ssh)(\s|$)' -- "$cmd"
        echo "service"
    else
        echo "task"
    end
end

# --- Send a request with URL-safe params ---
function _tm_send
    set -l endpoint $argv[1]
    set -l extra $argv[2..-1]
    set -l args -G \
        --data-urlencode "pid=$fish_pid" \
        --data-urlencode "title="(basename $PWD) \
        --data-urlencode "pwd=$PWD" \
        --data-urlencode "tty=$_TM_TTY"
    for kv in $extra
        set args $args --data-urlencode $kv
    end
    curl -s --max-time 1 $args "$_TM_URL$endpoint" >/dev/null 2>&1 &
    disown
end

# --- Heartbeat (background, every 20s) ---
function _tm_heartbeat
    while true
        curl -s --max-time 2 -G \
            --data-urlencode "pid=$fish_pid" \
            --data-urlencode "title="(basename $PWD) \
            --data-urlencode "pwd=$PWD" \
            --data-urlencode "tty=$_TM_TTY" \
            "$_TM_URL/heartbeat" >/dev/null 2>&1
        sleep 20
    end
end

# Kill any heartbeat from a previous sourcing (re-source restarts it with new code)
if set -q _TM_HEARTBEAT_PID
    kill $_TM_HEARTBEAT_PID 2>/dev/null
    set -e _TM_HEARTBEAT_PID
end

_tm_heartbeat &
set -g _TM_HEARTBEAT_PID $last_pid
disown

# --- Hooks ---
function _tm_preexec --on-event fish_preexec
    set -l cmd "$argv[1]"

    # Claude Code has its own hooks — skip entirely
    _tm_is_claude "$cmd"; and return
    # Codex has no busy/idle hooks. Mark as service (watchdog auto-idles
    # after 2s) so the dog reacts when codex starts without sticking on
    # "working" the entire codex session.
    if _tm_is_codex "$cmd"
        _tm_send /status "state=busy" "type=service"
        return
    end

    set -l cmd_type (_tm_classify "$cmd")
    _tm_send /status "state=busy" "type=$cmd_type"
end

function _tm_postexec --on-event fish_postexec
    _tm_send /status "state=idle"
end

end  # close `if test "$_tm_skip" -eq 0` guard from top of file
