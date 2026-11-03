# The seven names in BOTH anchors (working-tree diff)

## `scripts/pack-mpd.ts` — ROOT_FILES additions
```
+  "AGENTS.md",
+  "PLAN.md",
+  "VENDOR_LOCK.json",
+  "cordis.patch.yml",
+  "dsh-distribution.json",
+  "dsh-plugin.json",
+  "icon.svg",
```
## `scripts/verify-pack-closure.ts` — REQUIRED_ROOT_FILES additions
```
+  "AGENTS.md",
+  "PLAN.md",
+  "VENDOR_LOCK.json",
+  "cordis.patch.yml",
+  "dsh-distribution.json",
+  "dsh-plugin.json",
+  "icon.svg",
```

## Displacement check (no assertion or entry removed)
```
packages/mpd-team-core-plugin/test/vedit-p0-lane-b.test.ts removed-content-lines=0
scripts/pack-mpd.ts removed-content-lines=0
scripts/verify-pack-closure.ts removed-content-lines=0
packages/mpd-team-core-plugin/src/mailbox-store.ts removed-content-lines=1
```

The test file: 0 removed lines (the ceiling arm is a pure addition). `mailbox-store.ts`: 1 removed
line — the superseded one-line doc comment above `MAIL_MAX_UNDELIVERED_CEILING`; the declaration
itself (`= 1000`) is unchanged, so the change is comment-only.
