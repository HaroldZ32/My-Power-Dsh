// Regression pin for the `mpd-better-sidebar` mount guard's PROFILE-DIR DERIVATION.
//
// DEFECT (measured 2026-09-23, win32-x64, node v24.21.0): the guard derived the profile
// directory from `baseUrl` with
//     path.normalize(decodeURIComponent(new URL('.', baseUrl).pathname))
// A profile's `baseUrl` is a file URL built by `@deepseek-ai/dsh-app-boot` as
// `pathToFileURL(dirname(configPath)).href + "/"`, i.e. `file:///C:/Users/<u>/.dsh/profiles/web/`
// on win32. That URL's `pathname` is `/C:/Users/<u>/.dsh/profiles/web/`, and win32
// `path.normalize` turns the leading `/` into a `\`, producing `\C:\Users\...\web\` — a path
// on the CURRENT drive root, not the profile. `fs.existsSync` therefore answered false for
// `<profile>/node_modules/dsh-better-sidebar` EVEN WHEN the sidebar was resolvable there, so
// clause 1 disabled the bundle's only sidebar mount, always, with the misleading reason
// "dsh-better-sidebar is not resolvable from the profile node_modules". A profile with no
// foreign (unguarded) mount then had no sidebar at all, and one with a foreign mount got the
// same DISABLED decision for the wrong reason.
//
// This is the same defect class the win32 wave (010d9ef6) fixed for the presets row and the
// four MCP rows of this very patch — it names the "doubled drive prefix" and the
// percent-encoded short name in that commit message. The guard was the one spot left on the
// POSIX-shaped form, and it had no test.
//
// The arms below evaluate the SHIPPED `!!js` expression (never a re-typed copy), so they red
// on the old bytes and green on the fixed ones. Every arm is hermetic: profiles are built in
// a temp sandbox, `DSH_HOME` is pointed at that sandbox while the guard runs (so the real home
// is never read), and the guard's own decision line is captured from `console.warn`.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";

/** Repository root, three directories above this test file. */
const ROOT = join(import.meta.dirname, "..", "..", "..");
/** The bundle patch the sidebar row lives in. */
const PATCH_PATH = join(ROOT, "cordis.patch.yml");
/** The patch text every arm scans for the shipped guard. */
const PATCH = readFileSync(PATCH_PATH, "utf8");

/** One profile fixture's options: which sidebar copies exist and which layers declare bundles. */
interface ProfileOptions {
  /** Write a `<profile>/node_modules/dsh-better-sidebar` copy. */
  withSidebar: boolean
  /** Also write the BUNDLE-relative copy under `<profile>/node_modules/@mpd-dsh/mpd/`. */
  bundleSidebar?: boolean
  /** Bundle names the profile manifest declares. */
  bundles?: string[]
  /** Foreign bundle layers to materialize, each with its own patch text. */
  foreign?: ForeignLayer[]
}

/** One foreign bundle layer a fixture materializes. */
interface ForeignLayer {
  /** The layer's package name, which is also its directory path under node_modules. */
  name: string
  /** The layer's own patch text, scanned for an unguarded sidebar mount. */
  patch: string
}

/** One loader entry the guard reads off its ctx. */
interface LoaderEntry {
  /** The entry's options, whose name the guard matches the sidebar host against. */
  options: { name: string }
}

/** The guard's decision plus the line it logged. */
interface GuardDecision {
  /** The `disabled` value the shipped expression returned. */
  disabled: unknown
  /** The captured console.warn lines, joined into one block. */
  warnings: string
}

/**
 * The SHIPPED `disabled: !!js` scalar of the sidebar row, decoded to JavaScript.
 *
 * MEASURED 2026-09-27: this used to take the FIRST line containing the marker, and a
 * COMMENT elsewhere in the patch that merely NAMED the scalar (`… the row's own
 * `disabled: !!js …` expression …`) became the subject — the run died in `JSON.parse`
 * with `Unexpected identifier "this"`, which reads like a broken guard rather than a
 * broken finder. A candidate is now accepted only if its suffix really parses as the
 * JSON-quoted scalar, so prose about the guard can never displace the guard itself.
 */
function shippedGuard(): string {
  /** The scalar prefix that identifies the guard's own line. */
  const marker = "disabled: !!js ";
  /** Every line carrying the marker, before the JSON-quote filter. */
  const candidates = PATCH.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(marker))
  for (const line of candidates) {
    try {
      // The scalar is YAML double-quoted, so its escapes are JSON's.
      return JSON.parse(line.slice(marker.length))
    } catch { /* a comment or a differently-quoted scalar: not the one we want */ }
  }
  throw new Error(`no JSON-quoted \`disabled: !!js\` scalar found in ${PATCH_PATH} (candidates: ${candidates.length})`);
}
/** The decoded `disabled: !!js` expression, i.e. the shipped guard itself. */
const GUARD = shippedGuard();

/** A throwaway profiles root, removed once the file's arms are done. */
const SANDBOX = mkdtempSync(join(tmpdir(), "mpd-sidebar-guard-"));
afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

/** The composition every fixture uses: an enabled web-plane webserver entry. */
const WEBSERVER_ENTRY = [{ options: { name: "@deepseek-ai/dsh-host-webserver" } }];

/** A foreign aggregate that mounts the sidebar with an UNGUARDED row. */
const FOREIGN_MOUNT = [
  "# a foreign aggregate mounting the sidebar in its own patch",
  "- insert:",
  "    - id: web-ui-better-sidebar",
  "      name: dsh-better-sidebar",
  "",
].join("\n");

/** Counter that keeps each fixture's profile directory distinct. */
let profileSeq = 0;

/** Materialize one throwaway profile: optional sidebar, optional foreign bundle layers. */
function makeProfile({ withSidebar, bundleSidebar = false, bundles = [], foreign = [] }: ProfileOptions): string {
  profileSeq += 1;
  /** This fixture's own profile directory. */
  const dir = join(SANDBOX, "profiles", `p${profileSeq}`);
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: `p${profileSeq}`, dsh: { profile: { bundles } } }),
  );
  if (bundleSidebar) {
    // The BUNDLE-relative copy: <profile>/node_modules/@mpd-dsh/mpd/node_modules/dsh-better-sidebar
    const sidebar = join(dir, "node_modules", "@mpd-dsh", "mpd", "node_modules", "dsh-better-sidebar");
    mkdirSync(sidebar, { recursive: true });
    writeFileSync(join(sidebar, "package.json"), JSON.stringify({ name: "dsh-better-sidebar", version: "0.19.0-alpha.1" }));
  }
  if (withSidebar) {
  /** The profile-level sidebar package copy. */
    const sidebar = join(dir, "node_modules", "dsh-better-sidebar");
    mkdirSync(sidebar, { recursive: true });
    writeFileSync(
      join(sidebar, "package.json"),
      JSON.stringify({ name: "dsh-better-sidebar", version: "0.19.1" }),
    );
  }
  for (const layer of foreign) {
    /** The layer's directory inside the profile's node_modules. */
    const layerDir = join(dir, "node_modules", ...layer.name.split("/"));
    mkdirSync(layerDir, { recursive: true });
    writeFileSync(
      join(layerDir, "package.json"),
      JSON.stringify({ name: layer.name, dsh: { bundle: { patch: "./cordis.patch.yml" } } }),
    );
    writeFileSync(join(layerDir, "cordis.patch.yml"), layer.patch);
  }
  return dir;
}

/** The `baseUrl` shape the loader hands a `!!js` expression: a directory file URL + "/". */
const baseUrlOf = (dir: string): string => pathToFileURL(dir + sep).href;

/** Run the shipped guard against one profile and capture its decision line. */
function decide(baseUrl: string, entries: LoaderEntry[] = WEBSERVER_ENTRY): GuardDecision {
  /** Every console.warn line the guard emitted during this run. */
  const warnings: string[] = [];
  /** The real console.warn, put back before the arm returns. */
  const originalWarn = console.warn;
  /** The DSH_HOME value to restore once the guard has run. */
  const previousHome = process.env.DSH_HOME;
  console.warn = (message) => { warnings.push(String(message)); };
  try {
    // The guard dedupes its decision line per process; each arm wants its own.
    // The guard reads this off globalThis, which has no declared slot for it; the cast names the
    // lookup key the shipped expression uses.
    (globalThis as Record<string, unknown>).__mpdSidebarGuardSeen = {};
    process.env.DSH_HOME = SANDBOX;
    /** The value the shipped guard expression returned. */
    const disabled = new Function("baseUrl", "ctx", `return (${GUARD})`)(baseUrl, {
      loader: { entries: () => entries },
    });
    return { disabled, warnings: warnings.join("\n") };
  } finally {
    console.warn = originalWarn;
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
  }
}

describe("sidebar mount guard: profile-dir derivation", () => {
  test("derives the profile dir through a file-URL conversion, never URL.pathname", () => {
    // Platform-independent pin for the defect: `pathname` is `/C:/...` on win32, which the
    // OS reads as a path on the current drive root once normalized.
    expect(GUARD).not.toContain(".pathname");
    expect(GUARD).toContain("fileURLToPath");
  });

  test("ENABLED when the profile resolves the sidebar and no other layer mounts it", () => {
    /** The guard's decision and the line it logged. */
    const { disabled, warnings } = decide(baseUrlOf(makeProfile({ withSidebar: true })));
    expect(warnings).toContain("ENABLED");
    expect(disabled).toBe(false);
  });

  test("DISABLED only when NEITHER the profile nor the bundle can resolve the sidebar", () => {
    // MEASURED (2026-09-27): a checkout install has no profile copy — `healProfileModuleFallback`
    // does not materialize a declared dependency for a `link:` layer — while the BUNDLE ships one
    // under `<bundle>/node_modules`. The clause therefore asks about both locations, and this arm
    // models the case where both are absent. The fixture writes the bundle's copy too, so the
    // bundle-present case is exercised by the arm below.
    const { disabled, warnings } = decide(baseUrlOf(makeProfile({ withSidebar: false })));
    expect(disabled).toBe(true);
    expect(warnings).toContain("resolvable from neither");
  });

  test("clause 1 PASSES when ONLY the BUNDLE has the host — the checkout install it exists for", () => {
    // MEASURED on a real boot: with the bundle's copy present and the profile's absent, the guard
    // logged `ENABLED - web plane present and no other layer mounts dsh-better-sidebar`, i.e. it got
    // past resolvability. This arm asserts only that: whether the later clauses disable the row
    // depends on the rest of the fixture's composition, which is not what this clause decides.
    const { warnings } = decide(baseUrlOf(makeProfile({ withSidebar: false, bundleSidebar: true })));
    expect(warnings).not.toContain("resolvable from neither");
  });

  test("DISABLED in favour of a foreign bundle layer that already mounts it", () => {
    // Reaching clause 3 at all proves the profile dir resolved: clause 1 must pass first, and
    // the deferral reads the profile manifest and the foreign layer's patch from that same
    // directory. On the old bytes this arm answered with the clause-1 reason instead.
    const dir = makeProfile({
      withSidebar: true,
      bundles: ["@foreign/web-all"],
      foreign: [{ name: "@foreign/web-all", patch: FOREIGN_MOUNT }],
    });
    /** The guard's decision and the line it logged. */
    const { disabled, warnings } = decide(baseUrlOf(dir));
    expect(disabled).toBe(true);
    expect(warnings).toContain("already mounts it in its own patch");
  });

  test("DISABLED when the composition has no enabled webserver entry", () => {
    /** The guard's decision and the line it logged. */
    const { disabled, warnings } = decide(baseUrlOf(makeProfile({ withSidebar: true })), []);
    expect(disabled).toBe(true);
    expect(warnings).toContain("webserver");
  });
});
