import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { helperFileRefusal, helperTarget } from "../src/scoped-helper"

test("scoped one-shots can write their exact granted file while read-only files and other commands stay protected", () => {
  /** The fixture is confined to its own temporary checkout. */
  const checkout = mkdtempSync(join(tmpdir(), "mpd-helper-scope-"))
  try {
    /** Bounded owner-selected files in each access mode. */
    const scope = { checkout, read: ["source.txt"], write: ["artifact.txt"] }
    expect(helperFileRefusal(scope, "read", { file_path: "source.txt" })).toBeUndefined()
    expect(helperFileRefusal(scope, "write", { file_path: "artifact.txt" })).toBeUndefined()
    expect(helperFileRefusal(scope, "edit", { file_path: "source.txt" })).toMatch(/exact file tools and paths/)
    expect(helperFileRefusal(scope, "bash", { command: "true" })).toMatch(/exact file tools and paths/)
    expect(helperFileRefusal({ ...scope, current: () => false }, "read", { file_path: "source.txt" })).toMatch(/no longer authorizes/)
    expect(helperFileRefusal(scope, "structured_output", {})).toBeUndefined()
  } finally {
    rmSync(checkout, { recursive: true, force: true })
  }
})

test("relative helper filenames cannot traverse symlinks, other projects, or runtime state", () => {
  /** A root holds two isolated sibling directories. */
  const root = mkdtempSync(join(tmpdir(), "mpd-helper-symlink-"))
  try {
    /** Only this checkout is authorized. */
    const checkout = join(root, "authorized")
    /** The peer's directory holds a real file behind a symlink. */
    const privateDir = join(root, "peer")
    mkdirSync(checkout)
    mkdirSync(privateDir)
    writeFileSync(join(privateDir, "notes"), "peer-private")
    symlinkSync(privateDir, join(checkout, "alias"), "dir")
    expect(helperTarget(checkout, "alias/notes")).toBeUndefined()
    expect(helperTarget(checkout, "alias/new.txt")).toBeUndefined()
    expect(helperTarget(checkout, "../peer/notes")).toBeUndefined()
    expect(helperTarget(checkout, ".mpd/memory/member")).toBeUndefined()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
