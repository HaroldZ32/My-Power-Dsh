STAMPS="$(ls -1dt evidence/docker/client-install*/*/ 2>/dev/null || true)"
if [ -z "$STAMPS" ]; then
  echo "no stamp directory under evidence/docker/client-install*/*/ — this run wrote no evidence (a lane that skips exits before creating one)"
  exit 0
fi
# UNQUOTED on purpose: one stamp directory per argv entry, newest first. Every entry is a UTC
# timestamp under a fixed prefix, so none can contain whitespace.
node -e '
  const fs = require("node:fs")
  const dirs = process.argv.slice(1)
  const read = (dir, name) => { try { return JSON.parse(fs.readFileSync(dir + name, "utf8")) } catch { return null } }
  const lines = ["stamp directories found (newest first): " + dirs.map((d) => d.replace(/\/$/, "")).join(" ")]
  const graded = dirs.find((d) => read(d, "result.json") !== null)
  if (graded === undefined) {
    lines.push("no readable result.json in any of them — a run killed before the reporter published leaves exactly this shape")
  } else {
    for (const skipped of dirs.slice(0, dirs.indexOf(graded))) lines.push("SKIPPED (no readable result.json): " + skipped)
    lines.push("stamp directory: " + graded)
    const driver = read(graded, "driver.json")
    if (driver) {
      const required = driver.requiredPrefixes || []
      lines.push("driver: exit=" + driver.exitCode + " liveRequested=" + driver.liveRequested
        + " browserEnabled=" + driver.browserEnabled + " requiredPrefixes=[" + required.join(",") + "]"
        + " containerExit=" + driver.containerExit + " imageMiB=" + driver.imageMiB)
    }
    const rows = read(graded, "result.json").assertions || []
    const count = (ok) => rows.filter((row) => row.ok === ok).length
    lines.push("rows: total=" + rows.length + " passed=" + count(true) + " failed=" + count(false) + " null=" + count(null))
    for (const row of rows.filter((r) => r.ok === false)) lines.push("FAIL " + row.name + " — " + row.reason)
    for (const row of rows.filter((r) => r.ok === null)) lines.push("NULL " + row.name + " — " + row.reason)
  }
  const text = lines.join("\n")
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "### Docker acceptance\n\n```\n" + text + "\n```\n")
' $STAMPS
