#!/bin/bash
# install.sh — copy the agents sidebar into cmux's sidebar folder and validate it.
# Writes one file, ~/.config/cmux/sidebars/agents.js, backing up a different
# existing copy first. No hooks, no launchd jobs, no network. Re-run to update.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/sidebars/agents.js"
dest_dir="$HOME/.config/cmux/sidebars"
dest="$dest_dir/agents.js"

command -v cmux >/dev/null 2>&1 || { echo "cmux is not on PATH; install cmux first" >&2; exit 1; }

mkdir -p "$dest_dir"
if [ -e "$dest" ] && ! cmp -s "$src" "$dest"; then
  cp "$dest" "$dest.bak.$(date +%s)"
  echo "backed up your existing $dest"
fi
install -m 0644 "$src" "$dest"
echo "installed $dest"

cmux sidebar validate agents
echo
echo "Show it in the left sidebar:  cmux sidebar select agents"
echo "Or open it as a pane:         cmux sidebar open agents"
