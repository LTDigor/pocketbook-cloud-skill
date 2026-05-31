#!/usr/bin/env sh
set -eu

repo="${POCKETBOOK_CLOUD_SKILL_REPO:-LTDigor/pocketbook-cloud-skill}"
ref="${POCKETBOOK_CLOUD_SKILL_REF:-main}"
skill_name="${POCKETBOOK_CLOUD_SKILL_NAME:-pocketbook-cloud}"
codex_home="${CODEX_HOME:-$HOME/.codex}"
install_dir="${POCKETBOOK_CLOUD_SKILL_INSTALL_DIR:-$codex_home/skills/$skill_name}"
archive_url="https://github.com/$repo/archive/$ref.tar.gz"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need curl
need tar
need npm

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

echo "Downloading $repo@$ref"
curl -fsSL "$archive_url" -o "$tmp_dir/source.tar.gz"

mkdir -p "$tmp_dir/source"
tar -xzf "$tmp_dir/source.tar.gz" -C "$tmp_dir/source" --strip-components 1

saved_env=""
if [ -f "$install_dir/.env" ]; then
  saved_env="$tmp_dir/.env"
  cp "$install_dir/.env" "$saved_env"
fi

rm -rf "$install_dir"
mkdir -p "$(dirname "$install_dir")"
mv "$tmp_dir/source" "$install_dir"

if [ -n "$saved_env" ]; then
  cp "$saved_env" "$install_dir/.env"
fi

cd "$install_dir"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
npm run build

echo "Installed $skill_name into $install_dir"
echo "Restart Codex to pick up the new skill."
