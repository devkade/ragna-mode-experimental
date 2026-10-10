#!/usr/bin/env bash
# Installs the ragna-mode skill and the `ragna` CLI.
# Usage: curl -fsSL https://raw.githubusercontent.com/devkade/omo-ragna-mode-experimental/main/install.sh | bash
# Needs: git, bun 1.3+. Optional env: RAGNA_SRC (clone dir), SKILLS_DIR (where your agent loads skills).
set -euo pipefail

repo="https://github.com/devkade/omo-ragna-mode-experimental.git"
src="${RAGNA_SRC:-$HOME/.ragna/src}"
skills="${SKILLS_DIR:-$HOME/.agents/skills}"

command -v bun >/dev/null || { echo "bun is required: https://bun.sh" >&2; exit 1; }
command -v git >/dev/null || { echo "git is required" >&2; exit 1; }

if [ -d "$src/.git" ]; then git -C "$src" pull --ff-only --quiet; else git clone --quiet --depth 1 "$repo" "$src"; fi

mkdir -p "$skills"
if [ -e "$skills/ragna-mode" ] && [ ! -L "$skills/ragna-mode" ]; then
  echo "$skills/ragna-mode exists and is not a link; leaving it alone" >&2
else
  ln -sfn "$src/skills/ragna-mode" "$skills/ragna-mode"
fi

(cd "$src/skills/ragna-mode/scripts" && bun install --silent && bun link --silent)

mkdir -p "$HOME/.ragna"
[ -f "$HOME/.ragna/config.json" ] || cp "$src/skills/ragna-mode/references/config.example.json" "$HOME/.ragna/config.json"

echo "Installed. Skill: $skills/ragna-mode  CLI: ragna  Config: ~/.ragna/config.json"
echo "Next: edit ~/.ragna/config.json, then tell your agent: Ragna mode"
