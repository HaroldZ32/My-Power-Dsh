# MINT-RENUMBER-MAP — draft id -> register id (26 mint rows, shifted by -1)

**Why:** the draft `.mpd/plans/friction-p2-wave-mints.md` was authored from `T-95`, but the plan fixes the mint origin at
**`T-94`** ("new rows discovered in 2b mint from T-94") with **`T-93`** minted separately as the routing row. The register's
last landed row is `T-92`, so `T-93` (own row) and `T-94` (first new row) are the two anchors that fix the numbering.

**Citations written before the shift use the DRAFT numbers** — `.mpd/plans/friction-p2-wave-captain-log.md` §A-118..§A-121
and plan amendment A8. This map is what keeps them resolvable.

| draft | register |
|---|---|
| T-95 | **T-94** |
| T-96 | **T-95** |
| T-97 | **T-96** |
| T-98 | **T-97** |
| T-99 | **T-98** |
| T-100 | **T-99** |
| T-101 | **T-100** |
| T-102 | **T-101** |
| T-103 | **T-102** |
| T-104 | **T-103** |
| T-105 | **T-104** |
| T-106 | **T-105** |
| T-107 | **T-106** |
| T-108 | **T-107** |
| T-109 | **T-108** |
| T-110 | **T-109** |
| T-111 | **T-110** |
| T-112 | **T-111** |
| T-113 | **T-112** |
| T-114 | **T-113** |
| T-115 | **T-114** |
| T-116 | **T-115** |
| T-117 | **T-116** |
| T-118 | **T-117** |
| T-119 | **T-118** |
| T-120 | **T-119** |

**Verification of the shift:** the mints file's headings now run `T-94`..`T-119` and every in-body reference in the
draft range was rewritten in the same pass; the count is unchanged (26 rows).

**CORRECTION to t59's map (captain, 17:2xZ):** t59 published a 25-entry map (T-95→T-94 … T-119→T-118). The captain minted ONE MORE row after t59 read the file (the captain-owned-dispatch row, draft T-120), so the complete map is the **26-entry** one below.
