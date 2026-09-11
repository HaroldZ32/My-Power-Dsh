# Control-lane provenance guard — closing a real hole t9's overlay lesson exposed

## The hole (found by re-examining my own control, not by a failure)

My re-injection control's validity condition was `childRequestsUnderRestriction === 0` plus
`refusalSeen === false`. **The fixed build satisfies that too** — a lane whose mutation never ran
would also show zero restricted-child requests, so the control could report a meaningless green while
proving nothing. That is the same class t9 hit through a different route: they proved an id-target
OVERLAY cannot rebind a row's `name:`, so their mutation lane silently ran the FIXED build and
reported a clean lane.

## The fix — the control must prove the mutation LOADED

The control now first asserts that the injected names reached the harness, read from the instrumented
adapter's own record of what it handed over:

    const diagSent = steps.reinjectionDiagnostic.filterSent?.deny ?? []
    const mutationLoaded = DEAD_NAMES.every((n) => diagSent.includes(n))
    ok: mutationLoaded && diagChild.length === 0 && parent sees all seven && refusalSeen === false

Measured on the final bytes (run `2026-09-10T14-17-49.046Z`):

    reinjectionControl: { ok: true, mutationLoaded: true,
      injectedNamesSeenByAdapter: ["str_replace_editor","apply_patch"],
      childRequestsUnderRestriction: 0, parentToolCount: 87,
      parentSeesWriteCapable: [all seven], refusalSeen: false }

So the lane is now SELF-PROVING: it can only pass when the mutation demonstrably loaded AND the
degradation then happened. "The defect is gone" can no longer be confused with "the mutation never
ran" — which is exactly the habit t9 recommended institutionalising.

## Why this lane cannot hit the overlay trap

This case does not rebind a row through an overlay. The QA dev flow defines the rows IN the patch
file, and the negative lane rewrites the row text in the sandbox's own
`<dshHome>/cordis.patch.yml`, pointing `mpd-roles` at a copy whose `READONLY_DENY` carries the two
injected names. The adapter's `filterSent` is the independent witness that the copy really loaded, and
it is now asserted rather than assumed.

## Positive lane unchanged (same run)

    enforcement: { ok: true, childRequests: 1, childToolCounts: [81], parentToolCount: 87,
      childLeaksWriteCapable: [], childHasStructuredOutput: true, parentHasAllSeven: true }

## Lock refreshed (a `skills/**` write invalidates the fingerprint)

    skills treeSha: 0f45bf1f8d28d2174e9249edb9ba26105f4c301ee6987199cb0644bcf890579e   (364 files)
    previous      : 0fffd8fcc0776583f47e577e9e26c3d75b09c17908a4122411500ab29ac1c717
    case hash     : ba6b490813e077609ad426591c751c6f2510728903b46bcecda230d2e05f90a4
    lock sha256   : d259e96889e17417cdf4b20b3d368cd57b656c645b71c84c55372c1e2599ffed   mtime 22:18:22

    CHECK 1  node scripts/verify-vendor.mjs        -> PASS (exit 0)
    CHECK 2  find skills -newer VENDOR_LOCK.json -type f -> prints NOTHING

This is the SEVENTH value in the session: 81620614 → ca9dfa77 → [13:50:28] → 2c11c7a9 → 1499dc30 →
0fffd8fc → 0f45bf1f. Each was correct when measured; none is citable as a constant.
