# Clean dev and Wave 0 controls

Use a Bash shell on Linux. The measured tools were Node 24.21.0, Bun `1.4.0+34cbb9a40`, DSH `0.2.2-rc.5` and dsh-TUI `0.20.2`. The repository's `.github/workflows/gates.yml` gives the npm coordinates for DSH and dsh-TUI. Provision the official Go kit at the following revision.

```bash
git clone --no-checkout --filter=blob:none https://github.com/ccch1mneyyy/dsh-Go.git checker
git -C checker sparse-checkout set sdk/plugin-kit
git -C checker checkout --detach f36bf91b0736e81ef40c2a7040b2ec337ca1ab40
```

Supply these absolute input paths. `REPO` is a Git repository containing the measured commit. `BUN14` is the pinned executable, `NODE_BIN` the directory holding Node and npm, `DSH_BIN` the rc.5 installation's bin directory, `TUI_ROOT` the installed TUI package directory and `KIT` the checker checkout. The following block runs once per revision in a fresh directory outside `REPO`. Run it for `e86764c0e09b14ba172839bc9671a2c8f3352c81` and `eeec38a9f76fbbae9cd4dcf8db9630f5ab80b0db`.

```bash
set -euo pipefail
: "${REPO:?}" "${REV:?}" "${BUN14:?}" "${NODE_BIN:?}" "${DSH_BIN:?}" "${TUI_ROOT:?}" "${KIT:?}"
lab=$(mktemp -d)
mkdir -p "$lab"/{work,home,dsh,bin,tmp,cache,logs}
git init -q "$lab/work"
git -C "$lab/work" fetch -q --depth=1 "$REPO" "$REV"
git -C "$lab/work" checkout -q --detach FETCH_HEAD
cd "$lab/work"
test -d .git && test "$(git rev-parse HEAD)" = "$REV"
test -z "$(git status --porcelain)"
test ! -e .mpd/boulder.json && test ! -e node_modules && test ! -e dist/mpd-package
test "$(git -C "$KIT" rev-parse HEAD)" = f36bf91b0736e81ef40c2a7040b2ec337ca1ab40
install -m755 "$BUN14" "$lab/bin/bun"
mkdir -p .toolchain/node_modules/.bin
ln "$lab/bin/bun" .toolchain/node_modules/.bin/bun
clean=(env -i "HOME=$lab/home" "DSH_HOME=$lab/dsh" "TMPDIR=$lab/tmp"
       "PATH=$lab/bin:$DSH_BIN:$NODE_BIN:/usr/local/bin:/usr/bin:/bin"
       "MPD_DSHGO_KIT=$KIT" "MPD_DSH_TUI_HOST=$TUI_ROOT"
       "BUN_INSTALL_CACHE_DIR=$lab/cache" LC_ALL=C.UTF-8 TZ=UTC)
test "$("${clean[@]}" node --version)" = v24.21.0
test "$("${clean[@]}" bun --revision)" = 1.4.0+34cbb9a40
test "$("${clean[@]}" dsh --version)" = 0.2.2-rc.5
test "$("${clean[@]}" node -p 'require(process.env.MPD_DSH_TUI_HOST + "/package.json").version')" = 0.20.2
"${clean[@]}" bun install --frozen-lockfile
test ! -L node_modules
for pkg in '@dsh-std/sdk' 'typescript5'; do
  case "$(realpath "node_modules/$pkg")" in "$PWD"/node_modules/*) ;; *) exit 2 ;; esac
done
"${clean[@]}" bun -e 'const r = Bun.spawnSync(["bun", "--version"]); if (r.exitCode || r.stdout.toString().trim() !== "1.4.0") process.exit(1)'
run() {
  local name=$1 rc=0
  shift
  "${clean[@]}" "$@" >"$lab/logs/$name.log" 2>&1 || rc=$?
  printf '%s exit=%d\n' "$name" "$rc"
}
```

For the unmodified commands, run these in this order in the prepared checkout. The shell prints individual exit codes and preserves logs across a failed gate. Read each exit code in the resulting table. Packaging runs after both suites so its output cannot enter test discovery.

```bash
run dist node ./scripts/verify-dist-fresh.ts
run static bun run verify:gates
run typecheck bun run typecheck
run package bun run test
run root .toolchain/node_modules/.bin/bun test
run pack node ./scripts/pack-mpd.ts
run closure node ./scripts/verify-pack-closure.ts
git diff --exit-code --quiet && git diff --cached --exit-code --quiet
```

For the test comparison excluding archives, repeat the setup in a **second fresh checkout** of the same revision. Run the following commands in order. Both exclusion flags matter. The active root includes the entire `packages`, `skills` and, when present, `scripts` test corpus. The isolated and single-case invocations are diagnostics. The measured runs reused a Bun download cache across checkouts, and each checkout installed its own dependencies.

```bash
run active bun test --path-ignore-patterns 'evidence/**' --path-ignore-patterns 'dist/**'
run tui-one bun test ./packages/mpd-tui-adapter-plugin/test/adapter-hosts.test.ts -t 'a kit arriving AFTER the probe settled'
run tui-no-host env -u MPD_DSH_TUI_HOST bun test ./packages/mpd-tui-adapter-plugin/test/adapter-hosts.test.ts -t 'a kit arriving AFTER the probe settled'
run executor-one bun test ./packages/mpd-dsh-adapter-plugin/test/team-executor.test.ts -t 'a TASK-BOARD-ONLY official service is not servable'
run codegraph-one bun test ./packages/mpd-codegraph-plugin/src/index.test.ts -t 'no session and no override falls back'
run isolated env -u MPD_DSH_TUI_HOST bun test --isolate --timeout 30000 --path-ignore-patterns 'evidence/**' --path-ignore-patterns 'dist/**'
git diff --exit-code --quiet && git diff --cached --exit-code --quiet
```
