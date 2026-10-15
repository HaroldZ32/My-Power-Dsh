#!/usr/bin/env bash
# Probe: how long does the NON-LINKED install of the staged pack take with a WARM shared npm cache,
# and what does it put in <profile>/node_modules? (diagnosis + budget measurement for the mcp-call lane)
set -u
REPO="/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
R="$REPO/.qa-mcp-repro"
INST="$R/inst"
rm -rf "$INST"
mkdir -p "$INST/profiles/headless" "$R/npmcache"
cp -r "$REPO/dist/mpd-package" "$INST/staged-pack"
node -e '
const {writeFileSync}=require("fs");
const [inst,repo]=process.argv.slice(1);
writeFileSync(inst+"/profiles/headless/package.json", JSON.stringify({name:"dsh-profile-headless",private:true,dependencies:{"@mpd-dsh/mpd":"file:"+inst+"/staged-pack"},dsh:{profile:{bundles:["@deepseek-ai/dsh-base","@deepseek-ai/dsh-headless"]}}},null,2)+"\n");
' "$INST" "$REPO"
echo "START $(date -u +%Y-%m-%dT%H:%M:%SZ)"
/usr/bin/time -v npm install --prefix "$INST/profiles/headless" --install-links --no-audit --no-fund --cache "$R/npmcache" > "$R/inst-npm.log" 2> "$R/inst-time.log"
echo "NPM_EXIT=$?"
echo "END $(date -u +%Y-%m-%dT%H:%M:%SZ)"
grep -E "Elapsed \(wall clock\)|Exit status" "$R/inst-time.log"
echo "=== profile node_modules top level ==="
ls "$INST/profiles/headless/node_modules" 2>/dev/null
echo "=== @deepseek-ai in profile node_modules ==="
ls "$INST/profiles/headless/node_modules/@deepseek-ai" 2>/dev/null
echo "=== pack node_modules ==="
ls "$INST/profiles/headless/node_modules/@mpd-dsh/mpd/node_modules" 2>/dev/null
echo "=== npmcache size ==="
du -sh "$R/npmcache"
