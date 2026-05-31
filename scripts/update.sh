#!/usr/bin/env sh
set -eu

repo="${POCKETBOOK_CLOUD_SKILL_REPO:-LTDigor/pocketbook-cloud-skill}"
ref="${POCKETBOOK_CLOUD_SKILL_REF:-main}"
installer_url="https://raw.githubusercontent.com/$repo/$ref/scripts/install.sh"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need curl

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

echo "Fetching updater for $repo@$ref"
curl -fsSL "$installer_url" -o "$tmp_dir/install.sh"

POCKETBOOK_CLOUD_SKILL_REPO="$repo" \
POCKETBOOK_CLOUD_SKILL_REF="$ref" \
sh "$tmp_dir/install.sh"
