#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(dirname "$SCRIPT_DIR")"
HOST_PATH="${SCRIPT_DIR}/host.js"
TARGET_DIR="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
TARGET_FILE="${TARGET_DIR}/com.yao.boss_job_assistant.json"
TARGET_RUNNER="${TARGET_DIR}/com.yao.boss_job_assistant.sh"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
EXTENSION_ID="${1:-auto}"

if [[ "$EXTENSION_ID" == "auto" ]]; then
  EXTENSION_ID="$(SKILL_ROOT="$SKILL_ROOT" python3 - <<'PY'
import json
import os
import pathlib

skill_root = pathlib.Path(os.environ["SKILL_ROOT"]).resolve()
extension_path = str(skill_root / "extension")
roots = [
    pathlib.Path.home() / "Library/Application Support/Google/Chrome",
    pathlib.Path.home() / ".claude/skills/shared-chrome-devtools/profiles/boss-job-assistant",
]

for root in roots:
    for pref in list(root.glob("*/Preferences")) + list(root.glob("*/Secure Preferences")):
        try:
            data = json.loads(pref.read_text())
        except Exception:
            continue
        settings = data.get("extensions", {}).get("settings", {})
        for ext_id, info in settings.items():
            path = str(info.get("path", ""))
            manifest = info.get("manifest", {})
            name = str(manifest.get("name", ""))
            if path == extension_path or path.endswith("/boss-job-assistant/extension") or name == "BOSS Job Assistant":
                print(ext_id)
                raise SystemExit(0)
raise SystemExit(1)
PY
)" || {
    echo "Could not auto-detect extension ID." >&2
    echo "Load extension/ in chrome://extensions, then run: $0 <chrome-extension-id>" >&2
    exit 1
  }
fi

if [[ ! "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  echo "Invalid Chrome extension ID: $EXTENSION_ID" >&2
  echo "Expected a 32-character ID from chrome://extensions." >&2
  exit 1
fi

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Node.js executable not found. Set NODE_BIN=/absolute/path/to/node and rerun." >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
cat > "$TARGET_RUNNER" <<EOF
#!/bin/bash
exec "$NODE_BIN" "$HOST_PATH"
EOF
chmod +x "$TARGET_RUNNER"

EXTENSION_ID="$EXTENSION_ID" TARGET_RUNNER="$TARGET_RUNNER" python3 - <<'PY' > "$TARGET_FILE"
import json
import os

print(json.dumps({
    "name": "com.yao.boss_job_assistant",
    "description": "BOSS Job Assistant native host",
    "path": os.environ["TARGET_RUNNER"],
    "type": "stdio",
    "allowed_origins": [f"chrome-extension://{os.environ['EXTENSION_ID']}/"],
}, ensure_ascii=False, indent=2))
PY

echo "Installed native host manifest:"
echo "$TARGET_FILE"
echo "Installed native host runner:"
echo "$TARGET_RUNNER"
echo "Allowed extension:"
echo "chrome-extension://${EXTENSION_ID}/"
