#!/bin/sh

# Minimal local storage monitor for MMM-MessageCenter.
# Run it periodically with cron or a systemd timer.

set -eu

SOCKET_PATH=${MESSAGECENTER_SOCKET:-/tmp/mmm-messagecenter.sock}
CHECK_PATH=${MESSAGECENTER_STORAGE_PATH:-/}
MIN_FREE_PERCENT=${MESSAGECENTER_MIN_FREE_PERCENT:-10}
STATE_FILE=${MESSAGECENTER_STATE_FILE:-/tmp/mmm-messagecenter-storage.state}

case "$MIN_FREE_PERCENT" in
  ''|*[!0-9]*)
    echo "MESSAGECENTER_MIN_FREE_PERCENT must be a whole number" >&2
    exit 2
    ;;
esac

if [ "$MIN_FREE_PERCENT" -lt 1 ] || [ "$MIN_FREE_PERCENT" -gt 99 ]; then
  echo "MESSAGECENTER_MIN_FREE_PERCENT must be between 1 and 99" >&2
  exit 2
fi

if ! command -v socat >/dev/null 2>&1; then
  echo "socat is required (for Debian/Ubuntu: sudo apt install socat)" >&2
  exit 1
fi

if [ ! -S "$SOCKET_PATH" ]; then
  echo "MessageCenter socket is not available at $SOCKET_PATH" >&2
  exit 1
fi

used_percent=$(df -Pk "$CHECK_PATH" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')
case "$used_percent" in
  ''|*[!0-9]*)
    echo "Could not determine storage usage for $CHECK_PATH" >&2
    exit 1
    ;;
esac

free_percent=$((100 - used_percent))
previous_state=unknown
if [ -r "$STATE_FILE" ]; then
  previous_state=$(sed -n '1p' "$STATE_FILE")
fi

if [ "$free_percent" -lt "$MIN_FREE_PERCENT" ]; then
  current_state=warning
  if [ "$previous_state" != "$current_state" ]; then
    printf '{"id":"system-storage","type":"system.storage","source":"system-monitor","title":"Storage running low","body":"The mirror has %s%% free storage remaining.","urgency":"attention","retention":"untilAcknowledged"}\n' "$free_percent" \
      | socat - "UNIX-CONNECT:$SOCKET_PATH"
  fi
else
  current_state=ok
  if [ "$previous_state" = "warning" ]; then
    printf '{"id":"system-storage","type":"system.storage","source":"system-monitor","title":"Storage recovered","body":"Free storage is back above the configured threshold.","urgency":"passive","retention":"ephemeral"}\n' \
      | socat - "UNIX-CONNECT:$SOCKET_PATH"
  fi
fi

printf '%s\n' "$current_state" > "$STATE_FILE"
