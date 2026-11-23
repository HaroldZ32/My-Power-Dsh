# Independent verification of dispatch, ceremony and growth

## Final source verification

T30 recorded **PASS** `rec-20261123T061727-3afdde` on the final T0.1, T0.3, T0.4 and T0.5 source set. T0.2 retains its separate verdict. The complete manifest had **21 entries** with SHA-256 `83dd88b712bc3175c94e55f790364d64cbabca1869ac8c3614412a4086c98a83`. The final replay receipt hashed to `d1acda1116ec523b13b6fc2e9ecdb267d990bfc80ec98f1123bc6aac3cb8b87b`. [Source and fixture fingerprints](./public.sha256) · [Published before/after controls](./coverage-receipt.json)

The reviewer reproduced each defect on the earlier bytes and applied identical inputs to the final CLIs. Collector and ceremony agreed on two confirmed links. The collector marked the old and unverified board pointers as candidates and the cohort as incomplete. Passing a discovered journal back to the dispatch CLI, even through a path alias, produced one pass. Two distinct input files with identical payloads retained separate coordinates. One valid checkpoint followed by a malformed journal line yielded an unmeasured total and one valid sample, with incomplete coverage on each statistic. Zero-turn skipping remained distinct from missing source data. Each previously healthy board, pass and checkpoint measurement remained the same across both external workspaces and the main checkout.

All six targeted Bun tests passed, including legacy v3 result extraction. The public synthetic controls passed under a long Unicode path with spaces. Fixed typecheck and declaration-comments gates passed (`ev-20261123T061647-a2df52`, `ev-20261123T061648-d08625`). The independently captured synthetic pre/post receipts hashed to `408391ce3cc53561955ba432536b852c99f9c75c196e26d242d0b77ba208c022` and `f335fa0e85aa91859d4810a5ac0046b9fd9637bc9f9b37ee33342c5778f6be63` respectively.

## Earlier scoped verification

| Criterion | Result | Record |
| --- | --- | --- |
| T0.3 dispatch passes | PASS on `43ecf9ce1da7a0cc87d657608ab1956a60f7b90f63c79b20bd801ffa52cae04e`. Every known unpaired task without a reason remained visible. | `rec-20261123T060348-9ca069` |
| T0.4 ceremony | PASS on `185a5571bbe72f2a47693f4931e5f46d8123c043440b89831bcb378e240c331a`. Missing and corrupt inputs produced explicit unknown totals and preserved confirmed lower bounds. | `rec-20261123T060348-9ca069` |
| T0.5 context growth | PASS on `387605191b564d7edca8a2c02dda02ce78cd5275332b65b113cafede3d149d32`. The timestamped journal inputs reproduced all 25 recorded growth estimates, ratios and distributions. | `rec-20261123T055351-06689c` |

The verifier exercised the proposed CLIs through Node and compared their output with independent raw workspace enumerations. The integrated and dev-based worktrees held identical CLI bytes. The before/after inventories were equal during each scan. Run the public fixture with `node evidence/baseline/wave0-metrics/replay.ts`, then run `node evidence/baseline/wave0-metrics/replay.ts --findings` and `sha256sum -c evidence/baseline/wave0-metrics/public.sha256` from the repository root. Both controls and every one of the eight listed hashes passed. The public fixture uses synthetic workspaces. The following observed counts came from the three original workspaces.

| Workspace | Retained passes / pairings / passes without team ID | Boards / unapproved shells / cells | Measurable checkpoints / turn range |
| --- | --- | --- | --- |
| MailCollect | 135 / 112 / 79 | 9 / 0 / 4 | 4 / 4–7 |
| VEdit | 374 / 393 / 304 | 30 / 4 / 10 | 21 / 2–12 |
| My-Power-Dsh | 0 / 0 / 0 | 16 / 9 / 0 | 0 / unmeasured |

Five independent dispatch controls started with two unpaired tasks. With no reason rows, the unknown count was two. With one attributable busy-owner reason it was one. An explicitly unexplained task, a blocked task with its own separate reason and a missing skip list each preserved the correct number of unaccounted-for ready tasks. In the live logs the pairing counts were available and the earlier ready sets and reason details were unavailable.

An independent ceremony fixture combined a valid board, one malformed board, one confirmed empty shell, one missing archived plan and one corrupt archived plan. Each affected headline total was unknown. Coverage retained one confirmed team, one confirmed empty shell and the specific missing or malformed inputs. The valid board still reported its exact 151-minute approval time. A truly empty workspace, ambiguous board, known shell and partially described shell were also exercised through the public replay.

For growth, a separate five-row fixture covered a zero turn, missing numerator, real zero numerator, missing window and zero window. The CLI retained the token rate when only the ratio was unavailable. The real records did not identify the active host composition or compaction threshold in any of the workspaces. MailCollect's median was 106,156.5 tokens per turn and VEdit's was 105,188.4. The main checkout had no checkpoint distribution. Historical November 13 figures were reported separately.

The first independent review recorded the two missing-data defects in `rec-20261123T055312-3e6c55`. T25 verified their corrections. Fixed typecheck and declaration-comments gates passed (`ev-20261123T060328-614bc7`, `ev-20261123T060329-3449ae`), and the two original source-workspace replay drivers passed with the repaired bytes. [Public replay](./replay.md) · [Repair controls and hashes](./repair-receipt.json)
