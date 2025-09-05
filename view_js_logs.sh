#!/bin/bash
# Launch a terminal window to follow the JavaScript log file in real time.

LOG_DIR="$(dirname "$(readlink -f "$0")")/logs"
node "$(dirname "$0")/javascript/view_logs.js" "$LOG_DIR/js.log"