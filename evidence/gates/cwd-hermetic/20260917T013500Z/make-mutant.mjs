// Negative control for the T-57 cwd-hermetic fix.
//
// It copies the fixed test file to a sibling `*.mutant.test.ts` (so the relative
// `../src/index` import still resolves) and re-seeds the ONE thing the fix removed: the
// mount-root fixture gets a `.mpd/mpd.jsonc` with a non-default value. If the new premise
// assertions are real, the two cases must fail again with the ORIGINAL signature
// (a non-empty mount-time base and a fallback root that is not file-free).
//
// Usage: bun make-mutant.mjs <repo root>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? process.cwd();
const testPath = join(root, "packages/mpd-config-plugin/test/settings-wiring.test.ts");
const source = readFileSync(testPath, "utf8");

const anchor = [
  'function mountRootFixture(): string {',
  '  const dir = mkdtempSync(join(tmpdir(), "mpd-wiring-mount-"))',
  '  temps.push(dir)',
  '  return dir',
  '}',
].join("\n");

const mutant = [
  'function mountRootFixture(): string {',
  '  const dir = mkdtempSync(join(tmpdir(), "mpd-wiring-mutant-"))',
  '  temps.push(dir)',
  '  mkdirSync(join(dir, ".mpd"), { recursive: true })',
  '  writeFileSync(join(dir, ".mpd", "mpd.jsonc"), `{ "hashline": { "maxDiffChars": 35000 } }`)',
  '  return dir',
  '}',
].join("\n");

if (!source.includes(anchor)) {
  console.error("NEGATIVE CONTROL BROKEN: the mountRootFixture anchor was not found — re-read the test file");
  process.exit(3);
}

const outPath = join(root, "packages/mpd-config-plugin/test/settings-wiring.mutant.test.ts");
writeFileSync(outPath, source.replace(anchor, mutant));
console.log(outPath);
