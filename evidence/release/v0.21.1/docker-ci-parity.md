# Credential-free Docker CI parity

Baseline HEAD and `origin/dev` both resolved to `267c44a78a8f9c0437d6a7219b578a5cf827dc98`. The prior run for PR #122 succeeded and uploaded `docker-e2e-stamp-1`. It ran a separate pack step and called the low-level source driver with `--require-docker --allow-rootful-docker --no-browser`. The local release recipe relied on an earlier pack and omitted the hosted daemon opt-in. The run identified the PR head `fa420849fc1324165edf9de45b810d5b06e720af`. GitHub recorded `267c44a7` as the actual merge into `dev`. The `dev` branch filter returned no historical runs, while the latest scheduled run identified `master`. [Hosted PR run](https://github.com/HaroldZ32/My-Power-Dsh/actions/runs/45183027816) · [PR #122](https://github.com/HaroldZ32/My-Power-Dsh/pull/122) · [Scheduled run](https://github.com/HaroldZ32/My-Power-Dsh/actions/runs/45185409342)

`node scripts/docker-acceptance.ts` now selects and archives committed HEAD, derives its pack, and runs the strict source lane with a private home, Docker configuration and allowlisted child environment. The hosted job adds the rootful opt-in. It checks out the event SHA without persisting checkout credentials. Relevant PR changes and pushes to `dev` share a filter. Nightly and manual runs remain available. The workflow uploads only its own stamp, including a failed Docker invocation when an artifact was produced.

The old reporter backfilled fixed rows with `null`, which the driver already rejected. A fully omitted witness outside that static list was invisible to that scan. The driver now checks named installation, isolation and user-surface witnesses for presence, sourcing command names from the user-surface case. It also requires a successful container exit for a passing report. The hosted and local credential-free lanes allow the browser assertions to remain unmeasured.

| Check | Observed result |
|---|---|
| Shared entry point and Docker driver offline self-tests | Exit 0. Dummy credentials and Compose overrides were removed. A missing user-surface arm and a single omitted contributed command failed with exit 3. Disabled browser rows remained optional. Both Compose services used the image tag recorded by the driver. |
| Mismatched `GITHUB_SHA` | Exit 2 before staging. |
| Archive/pack with Docker deliberately unavailable | Staged 685 files from baseline `267c44a7`. Exit 3. The retained stamp reports source mode, credential forwarding disabled and browser disabled. [Negative control stamp](../../docker/client-install/2026-11-23T15-37-30Z/acceptance.json) |
| Workflow YAML structure | Exit 0. Nightly, dispatch, path-filtered PR and `dev` push present. Checked-out SHA, common command, exact stamp upload and 14-day retention confirmed. |
| Targeted strict TypeScript check and declaration gate | Exit 0. Declaration gate scanned 704 files and inspected 62,621 declarations. |
| Documentation parity | 622 checked links resolved, zero dead. |
| Manual paths in the linked worktree | Exit 1. The pinned Bun path was absent and `.git` was a linked-worktree pointer, so the manual's three pre-existing references to those paths did not resolve. |

The archive/pack test deliberately prevented Docker from starting. Real-machine acceptance of the committed release candidate and the updated hosted workflow are separate release checks.
