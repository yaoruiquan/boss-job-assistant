#!/bin/bash
set -euo pipefail

EXTENSION_ID="${1:-}"
if [[ -z "$EXTENSION_ID" ]]; then
  echo "Usage: $0 <chrome-extension-id>" >&2
  echo "Load extension/ in chrome://extensions first, then copy its ID." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_PATH="${SCRIPT_DIR}/host.js"
TARGET_DIR="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
TARGET_FILE="${TARGET_DIR}/com.yao.boss_job_assistant.json"

if [[ ! -x "$HOST_PATH" ]]; then
  chmod +x "$HOST_PATH"
fi

mkdir -p "$TARGET_DIR"
sed \
  -e "s#__HOST_PATH__#${HOST_PATH}#g" \
  -e "s#__EXTENSION_ID__#${EXTENSION_ID}#g" \
  "${SCRIPT_DIR}/com.yao.boss_job_assistant.json.template" > "$TARGET_FILE"

echo "Installed native host manifest:"
echo "$TARGET_FILE"
echo "Allowed extension:"
echo "chrome-extension://${EXTENSION_ID}/"
