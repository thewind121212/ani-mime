# --- Ani-Mime Terminal Mirror (Fish) ---
# Add to fish config:  source /path/to/terminal-mirror.fish

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

# --- Command categorization ---
function _tm_classify
    set -l cmd "$argv[1]"
    if string match -rq '(^|\s|/)(start|dev|serve|watch|metro|docker-compose|docker compose|up)(\s|$)' -- "$cmd"
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

    set -l cmd_type (_tm_classify "$cmd")
    _tm_send /status "state=busy" "type=$cmd_type"
end

function _tm_postexec --on-event fish_postexec
    _tm_send /status "state=idle"
end
