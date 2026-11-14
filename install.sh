#!/bin/bash
# install.sh — copy the agents sidebar into cmux's sidebar folder and validate it.
# Writes ~/.config/cmux/sidebars/agents.js, backing up a different existing
# copy first and refusing to replace a symlink. No hooks, no launchd jobs, no network. Re-run to update.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/sidebars/agents.js"
dest_dir="$HOME/.config/cmux/sidebars"
dest="$dest_dir/agents.js"

command -v cmux >/dev/null 2>&1 || { echo "cmux is not on PATH; install cmux first" >&2; exit 1; }

mkdir -p "$dest_dir"
# A symlink here is usually a dotfiles manager's. Replacing it would silently
# break that link, so stop and let the owner decide.
if [ -L "$dest" ]; then
  echo "$dest is a symlink to $(readlink "$dest"); update that file, or remove the link and rerun" >&2
  exit 1
fi
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
