#!/bin/sh
# t38 dual-path: ONE sandbox DSH_HOME, TWO profiles, official one-command installs.
# Both profiles share HOME and the workspace, so any sharing measured below is
# genuine sharing rather than an artifact of two isolated sandboxes.
set -u
S="$1"
REPO=/root/dshProj/my-power-dsh
mkdir -p "$S"/{dshhome,home,ws,store,npm-cache,pnpm-home,config,data}

run() {
  echo "### $*"
  env -i PATH="$PATH" \
    DSH_HOME="$S/dshhome" HOME="$S/home" \
    npm_config_cache="$S/npm-cache" PNPM_HOME="$S/pnpm-home" \
    XDG_CONFIG_HOME="$S/config" XDG_DATA_HOME="$S/data" \
    dsh "$@"
  echo "### exit=$?"
}

# ── profile w (web plane) ────────────────────────────────────────────────────
P="$S/dshhome/profiles/w"
mkdir -p "$P"
cat > "$P/package.json" <<'JSON'
{
  "name": "dsh-profile-w",
  "private": true,
  "dependencies": {},
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } }
}
JSON
run plugin --profile w add --store-dir "$S/store" "$REPO"

# ── profile dsh-tui (TUI plane) ──────────────────────────────────────────────
run plugin --profile dsh-tui add --store-dir "$S/store" @deepseek-harness-tui/dsh-tui@0.10.1
run plugin --profile dsh-tui add --store-dir "$S/store" "$REPO"

echo "### bundles: web"
node -e 'const m=require(process.argv[1]);console.log(JSON.stringify(m.dsh?.profile?.bundles??m.dsh?.bundles))' "$S/dshhome/profiles/w/package.json"
echo "### bundles: dsh-tui"
node -e 'const m=require(process.argv[1]);console.log(JSON.stringify(m.dsh?.profile?.bundles??m.dsh?.bundles))' "$S/dshhome/profiles/dsh-tui/package.json"
