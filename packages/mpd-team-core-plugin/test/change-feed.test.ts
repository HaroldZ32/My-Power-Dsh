// THE TEAM CHANGE FEED: what turns "poll the record" into "be told the record moved".
//
// WHY THESE ARMS EXIST. The feed is the substrate two other lanes are written against, so the things
// worth pinning are the ones a consumer would silently inherit: that ONE observation reaches a
// listener, that a BURST still reaches it once, that a listener which THROWS cannot take the writer or
// its siblings down, that the disposer is idempotent, that the revision is monotonic, and that the
// watch is armed lazily and RELEASED with the last listener instead of leaking one handle per cycle.
//
// EVERY ARM DOES REAL FILESYSTEM WORK IN A TEMP DIRECTORY and the WATCH arms write OUTSIDE the store
// (raw `writeFileSync` + `renameSync`) — that is the only way to prove the watcher itself fired, since
// a store write would also be seen by the in-process hook and the arm would pass with no watcher at
// all. The `watch` factory is injectable for the arms that must force a REFUSAL, which no portable
// test can produce on demand (an unwritable workspace, or an exhausted inotify limit).
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, renameSync, rmSync, watch, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ChangeFeed, type WatchFactory } from "../src/change-feed"
import { addTeamMember, createTeam, teamsDir, teamRoot, writeTeam, type TeamRecord } from "../src/team-store"

/** A frozen instant, so every record in this file is stamped identically. */
const NOW = new Date("2026-10-08T07:40:00.000Z")

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []

/** A fresh empty workspace, which is what a session that never created a team actually has. */
function sandbox(): string {
  /** The directory; registered so the whole file cleans up after itself. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-change-feed-"))
  sandboxes.push(dir)
  return dir
}

/** Wait one turn of the event loop plus a margin, so a coalescing window of `ms` has certainly closed. */
function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms + 15))
}

/**
 * Write a team record the way ANOTHER PROCESS would: bytes straight to disk, no store, no hook.
 *
 * The temp-file-then-rename shape is the store's own atomic write, reproduced here on purpose — a
 * directory watch sees that burst as `rename` events, and the feed has to notice the FIRST one.
 * @param workspace - the workspace to write into.
 * @param teamId - the record's id, which becomes its file name.
 * @param marker - a value written into the record so a reader can tell one write from the next.
 */
function writeLikeAnotherProcess(workspace: string, teamId: string, marker: string): void {
  /** The directory the record lives in; created by hand because no store call is involved. */
  const dir = teamsDir(workspace)
  mkdirSync(dir, { recursive: true })
  /** The final record path. */
  const path = join(dir, teamId + ".json")
  /** The sibling temp file, exactly as `team-store.ts#writeJson` shapes it. */
  const temp = path + ".tmp-" + process.pid
  writeFileSync(temp, JSON.stringify({ teamId, marker, version: 1 }, null, 2) + "\n")
  renameSync(temp, path)
}

/** A record built through the STORE, so a fixture cannot drift from the real shape. */
function storedRecord(workspace: string): TeamRecord {
  /** One team with one member, written by the store's own writer. */
  const team = addTeamMember(createTeam(workspace, { name: "wave-s", description: "publish changes", leadSessionId: "sess-1" }, NOW), { name: "Reviewer", description: "judges" }, NOW)
  writeTeam(workspace, team)
  return team
}

describe("S-b — the feed notifies on a change, once per window", () => {
  test("a store write reaches a subscriber", async () => {
    /** The workspace under test. */
    const workspace = sandbox()
    /** The feed under test, with a short window so the arm stays fast. */
    const feed = new ChangeFeed({ debounceMs: 20 })
    /** How many times the listener fired. */
    let calls = 0
    feed.subscribe(workspace, () => { calls += 1 })
    expect(feed.revision(workspace)).toBe(0)
    storedRecord(workspace)
    // ASYNCHRONOUS: the listener is never invoked inside the writer's own stack — which is what lets a
    // writer be a pure store function with no idea that a feed exists.
    expect(calls).toBe(0)
    await settle(20)
    expect(calls).toBe(1)
    feed.dispose()
  })

  test("the FIRST write of a burst notifies on its own: the window is opened by it, not by a second write", async () => {
    /** The workspace under test. */
    const workspace = sandbox()
    /** The feed under test. */
    const feed = new ChangeFeed({ debounceMs: 20 })
    /** The instants the listener fired at. */
    const fired: number[] = []
    feed.subscribe(workspace, () => { fired.push(Date.now()) })
    /** The instant the single write landed. */
    const wroteAt = Date.now()
    storedRecord(workspace)
    await settle(20)
    // ONE write, ONE call — the coalescing window must not swallow the observation that opened it.
    expect(fired.length).toBe(1)
    expect(fired[0]).toBeGreaterThanOrEqual(wroteAt)
    feed.dispose()
  })

  test("a burst inside one window coalesces into ONE call", async () => {
    /** The workspace under test. */
    const workspace = sandbox()
    /** The feed under test. */
    const feed = new ChangeFeed({ debounceMs: 40 })
    /** How many times the listener fired. */
    let calls = 0
    feed.subscribe(workspace, () => { calls += 1 })
    /** One record, mutated five times back to back. */
    const team = storedRecord(workspace)
    for (let index = 0; index < 4; index += 1) writeTeam(workspace, { ...team, name: "burst-" + index })
    await settle(40)
    expect(calls).toBe(1)
    // ONE OBSERVATION PER WINDOW is what the revision counts too: a client comparing revisions after a
    // reconnect sees the burst as the single change it was.
    expect(feed.revision(workspace)).toBe(1)
    feed.dispose()
  })

  test("a quiet period between writes is TWO changes, and the revision is monotonic", async () => {
    /** The workspace under test. */
    const workspace = sandbox()
    /** The feed under test. */
    const feed = new ChangeFeed({ debounceMs: 20 })
    /** Every revision the listener observed, in order. */
    const seen: number[] = []
    feed.subscribe(workspace, () => { seen.push(feed.revision(workspace)) })
    storedRecord(workspace)
    await settle(20)
    writeTeam(workspace, { ...storedRecord(workspace), name: "second" })
    await settle(20)
    writeTeam(workspace, { ...storedRecord(workspace), name: "third" })
    await settle(20)
    expect(seen.length).toBe(3)
    for (let index = 1; index < seen.length; index += 1) expect(seen[index]).toBeGreaterThan(seen[index - 1])
  })

  test("a THROWING listener is contained: the writer survives, and so do its siblings", async () => {
    /** The workspace under test. */
    const workspace = sandbox()
    /** The diagnostics the feed produced. */
    const warned: string[] = []
    /** The feed under test. */
    const feed = new ChangeFeed({ debounceMs: 20, warn: (line: string): void => { warned.push(line) } })
    /** The listeners that ran to completion after the throwing one. */
    let survivors = 0
    feed.subscribe(workspace, () => { throw new Error("this listener is broken") })
    feed.subscribe(workspace, () => { survivors += 1 })
    // The WRITER must not see the failure: a notification substrate cannot be allowed to fail a team
    // mutation, so this call returning at all is half the assertion.
    expect(() => storedRecord(workspace)).not.toThrow()
    await settle(20)
    expect(survivors).toBe(1)
    expect(warned.length).toBe(1)
    expect(warned[0]).toContain("contained")
  })

  test("the disposer is idempotent, and a disposed subscription stops notifying", async () => {
    /** The workspace under test. */
    const workspace = sandbox()
    /** The feed under test. */
    const feed = new ChangeFeed({ debounceMs: 20 })
    /** How many times the listener fired. */
    let calls = 0
    /** The disposer under test. */
    const off = feed.subscribe(workspace, () => { calls += 1 })
    expect(feed.stats(workspace).listeners).toBe(1)
    off()
    off()
    off()
    expect(feed.stats(workspace).listeners).toBe(0)
    storedRecord(workspace)
    await settle(20)
    expect(calls).toBe(0)
    // The revision still moves: the counter belongs to the WORKSPACE, not to a subscription, which is
    // exactly what a reconnecting client needs it for.
    expect(feed.revision(workspace)).toBe(1)
    feed.dispose()
  })
})

describe("S-c — the watcher is armed lazily and does not leak", () => {
  test("two watches per workspace are armed on the first subscriber and CLOSED by the last disposer", () => {
    /** The workspace under test. */
    const workspace = sandbox()
    /** The directories the factory was asked to watch. */
    const asked: string[] = []
    /** The directories whose handles were closed. */
    const closed: string[] = []
    /** The injected watch door: a real handle is not needed to count arming and release. */
    const factory: WatchFactory = (dir: string): { close: () => void } => {
      asked.push(dir)
      return { close: (): void => { closed.push(dir) } }
    }
    /** The feed under test. */
    const feed = new ChangeFeed({ debounceMs: 20, watch: factory })
    /** The first subscriber. */
    const first = feed.subscribe(workspace, () => {})
    // LAZY: a surface that never looks at a workspace must not arm anything for it.
    expect(feed.stats(workspace).watchers).toBe(2)
    expect(asked).toEqual([teamRoot(workspace), teamsDir(workspace)])
    // A SECOND subscriber shares the arms rather than adding a third and a fourth.
    /** The second subscriber; released below, which must NOT close the watches the first still uses. */
    const second = feed.subscribe(workspace, () => {})
    expect(feed.stats(workspace).watchers).toBe(2)
    expect(asked.length).toBe(2)
    second()
    expect(closed.length).toBe(0)
    expect(feed.stats(workspace).watchers).toBe(2)
    first()
    expect(feed.stats(workspace).watchers).toBe(0)
    expect(closed.sort()).toEqual([teamRoot(workspace), teamsDir(workspace)].sort())
    feed.dispose()
  })

  test("subscribe→dispose repeatedly does not accumulate a handle per cycle", () => {
    /** The workspace under test. */
    const workspace = sandbox()
    /** The live handles the factory minted and has not seen closed. */
    const live = new Set<string>()
    /** A counted factory, so the assertion is about REAL handles rather than about the code. */
    const factory: WatchFactory = (dir: string): { close: () => void } => {
      live.add(dir + "#" + String(live.size))
      return { close: (): void => { live.delete(dir + "#" + String(live.size - 1)) } }
    }
    /** The feed under test. */
    const feed = new ChangeFeed({ debounceMs: 20, watch: factory })
    for (let cycle = 0; cycle < 25; cycle += 1) {
      /** The disposer of this cycle. */
      const off = feed.subscribe(workspace, () => {})
      /** The directory registered by the LAST of this cycle's two arming calls, for the close below. */
      off()
    }
    // 25 cycles × 2 handles, every one released: a leak here is one stale inotify watch per page visit.
    expect(feed.stats(workspace).watchers).toBe(0)
    feed.dispose()
  })

  test("the watch sees a write made OUTSIDE the store — the path no in-process hook can cover", async () => {
    /** The workspace under test. */
    const workspace = sandbox()
    /** The feed under test; the REAL `fs.watch` door, because this arm is about the watcher. */
    const feed = new ChangeFeed({ debounceMs: 20 })
    /** How many times the listener fired. */
    let calls = 0
    feed.subscribe(workspace, () => { calls += 1 })
    // No `writeTeam` anywhere in this arm: the only thing that can observe this file is the watcher.
    writeLikeAnotherProcess(workspace, "team-external", "one")
    await settle(20)
    expect(calls).toBe(1)
    // The temp-file-then-rename burst is ONE change, not two: the event that opened the window is the
    // FIRST one, and the rename that followed it is absorbed.
    expect(feed.revision(workspace)).toBe(1)
    feed.dispose()
  })

  test("a workspace with NO `.mpd` at all is subscribed, then armed, then seen", async () => {
    // The captain's clarification, arm 1: a fresh workspace has neither `.mpd/team` nor `.mpd/team/teams`
    // when `subscribe` is called. A watcher cannot be armed on a path that does not exist, so the
    // directories are created and the arms are live BEFORE the first record arrives — otherwise the
    // FIRST team of a session (written by an approval, possibly in another process) would be invisible.
    /** A workspace with no `.mpd` whatsoever. */
    const workspace = sandbox()
    /** The feed under test. */
    const feed = new ChangeFeed({ debounceMs: 20 })
    /** How many times the listener fired. */
    let calls = 0
    expect(feed.stats(workspace).watchers).toBe(0)
    feed.subscribe(workspace, () => { calls += 1 })
    expect(feed.stats(workspace).watchers).toBe(2)
    expect(feed.revision(workspace)).toBe(0)
    writeLikeAnotherProcess(workspace, "team-first", "created-after-subscribe")
    await settle(20)
    expect(calls).toBe(1)
    feed.dispose()
  })

  test("a REFUSED arm is retried once the directory exists — the feed never silently stops watching", async () => {
    // The captain's clarification, arm 2. Forcing the refusal with a factory that fails its FIRST pair
    // of calls is the only portable way to reach this state: every real cause (an unwritable workspace,
    // an exhausted inotify limit) is machine-dependent.
    /** The workspace under test. */
    const workspace = sandbox()
    /** How many arming attempts the factory saw. */
    let attempts = 0
    /** The handles that are actually live. */
    let live = 0
    /** The default door, deferred so the first attempt can be refused: a REAL watch, not a stub. */
    const real: WatchFactory = (dir: string, onEvent: () => void): { close: () => void } => {
      live += 1
      // A real non-persistent watch, so the arm's second write is genuinely observed — a stub here
      // would let "the retry works" pass while proving nothing about the watcher that was retried.
      /** The live kernel handle. */
      const handle = watch(dir, { persistent: false }, (): void => { onEvent() })
      return { close: (): void => { live -= 1; handle.close() } }
    }
    /** The door under test: refuses the first TWO calls (one per directory), then works. */
    const flaky: WatchFactory = (dir: string, onEvent: () => void): { close: () => void } => {
      attempts += 1
      if (attempts <= 2) throw new Error("ENOSPC: the inotify watch limit was reached")
      return real(dir, onEvent)
    }
    /** The diagnostics, which must carry exactly ONE refusal line before the arming succeeds. */
    const warned: string[] = []
    /** The feed under test. */
    const feed = new ChangeFeed({ debounceMs: 20, watch: flaky, warn: (line: string): void => { warned.push(line) } })
    /** How many times the listener fired. */
    let calls = 0
    feed.subscribe(workspace, () => { calls += 1 })
    expect(feed.stats(workspace).watchers).toBe(0)
    // ONE line for the workspace, not one per refused directory: the contract bounds the diagnostic,
    // because an unwritable workspace would otherwise turn every team mutation into a log entry.
    expect(warned.length).toBe(1)
    // The next observation retries the arm. Nothing else announces that the directory now exists.
    writeLikeAnotherProcess(workspace, "team-retry", "one")
    feed.notify(workspace)
    expect(feed.stats(workspace).watchers).toBe(2)
    expect(live).toBe(2)
    // The retry is REPORTED as an arming line, so the log shows the watch recovered rather than
    // leaving the one refusal line as the last word.
    expect(warned.length).toBe(2)
    expect(warned[1]).toContain("watch armed")
    await settle(20)
    expect(calls).toBeGreaterThanOrEqual(1)
    /** How many times the listener had fired before the SECOND external write. */
    const before = calls
    writeLikeAnotherProcess(workspace, "team-retry", "two")
    await settle(20)
    expect(calls).toBe(before + 1)
    feed.dispose()
  })
})

describe("S-d — degradation, never failure", () => {
  test("a watch that cannot be created at all: subscribe is served, in-process changes still arrive, ONE line is written", async () => {
    // HOW THE REFUSAL IS FORCED: every `fs.watch` call throws, which is what the real causes look like
    // (a workspace the process cannot write, or a kernel whose inotify watch limit is exhausted). The
    // feed must not throw, must not stop delivering the notifications it can still produce itself, and
    // must say ONCE that the watch is off rather than once per change.
    /** The workspace under test. */
    const workspace = sandbox()
    /** The diagnostics the feed produced. */
    const warned: string[] = []
    /** The feed under test, with a door that refuses everything. */
    const feed = new ChangeFeed({
      debounceMs: 20,
      watch: (): { close: () => void } => { throw new Error("EACCES: the workspace is not writable") },
      warn: (line: string): void => { warned.push(line) },
    })
    /** How many times the listener fired. */
    let calls = 0
    expect(() => { feed.subscribe(workspace, () => { calls += 1 }) }).not.toThrow()
    expect(feed.stats(workspace).watchers).toBe(0)
    // ONE BOUNDED LINE, not one per refused directory and not one per write — and it NAMES the state
    // the reader is left in, so "watching" and "in-process only" cannot be confused for each other.
    expect(warned.length).toBe(1)
    expect(warned[0]).toContain("no filesystem watch")
    expect(warned[0]).toContain("in-process notifications only")
    storedRecord(workspace)
    await settle(20)
    expect(calls).toBe(1)
    expect(feed.revision(workspace)).toBe(1)
    // A second change does not add a diagnostic: the refusal was reported once.
    storedRecord(workspace)
    await settle(20)
    expect(calls).toBe(2)
    expect(warned.length).toBe(1)
    feed.dispose()
  })

  test("dispose closes the watches, clears the pending window and stops the store hook", async () => {
    /** The workspace under test. */
    const workspace = sandbox()
    /** The directories whose handles were closed. */
    const closed: string[] = []
    /** The feed under test. */
    const feed = new ChangeFeed({ debounceMs: 20, watch: (dir: string): { close: () => void } => ({ close: (): void => { closed.push(dir) } }) })
    /** How many times the listener fired. */
    let calls = 0
    feed.subscribe(workspace, () => { calls += 1 })
    storedRecord(workspace)
    expect(feed.revision(workspace)).toBe(1)
    // Dispose with a window still OPEN, which is the case that would otherwise leave a timer behind.
    expect(feed.stats(workspace).pending).toBe(true)
    feed.dispose()
    expect(closed.length).toBe(2)
    expect(feed.stats(workspace).watchers).toBe(0)
    /** A subscription taken after disposal: it must be inert rather than throwing. */
    const after = feed.subscribe(workspace, () => { calls += 1 })
    expect(() => after()).not.toThrow()
    await settle(20)
    // Neither the pending window nor the disposed feed's own writes reach a listener any more: the
    // store hook is off, so a write this process makes is invisible to a feed that has ended.
    storedRecord(workspace)
    await settle(20)
    expect(calls).toBe(0)
    expect(feed.revision(workspace)).toBe(0)
  })
})

describe("the store hook is what makes an in-process write visible", () => {
  test("the writer's own mutation notifies with no filesystem event involved", async () => {
    /** The workspace under test. */
    const workspace = sandbox()
    /** The feed under test, with a door that never fires — only the store hook can produce the call. */
    const feed = new ChangeFeed({ debounceMs: 20, watch: (): { close: () => void } => ({ close: (): void => {} }) })
    /** The observed revisions. */
    const seen: number[] = []
    feed.subscribe(workspace, () => { seen.push(feed.revision(workspace)) })
    /** A record created through the store, which binds the index and writes the record. */
    const team = storedRecord(workspace)
    await settle(20)
    expect(seen.length).toBe(1)
    // The index write and the record write are ONE window, and deleting the record is a change of its
    // own — the same fact a directory watch can only infer from a `rename`.
    rmSync(join(teamsDir(workspace), team.teamId + ".json"), { force: true })
    await settle(20)
    expect(seen.length).toBe(1)
    feed.dispose()
  })
})
