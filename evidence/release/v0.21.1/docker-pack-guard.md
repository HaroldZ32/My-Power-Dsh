# Docker pack measurements and staging receipts

The hosted PR run for head `b0c90ae99eabfba75f1b56737d82f2760b2957d1` tested merge candidate `d59accac4936f096cd8bdf04c87d95633978dfc7`. Artifact `14835497164` reported 163 passed, zero failed and 81 null. All seven pack assertions were true. The driver reported `mpd-docker-e2e:acceptance-d59accac4936f096cd8bdf04c87d95633978dfc7`, while `result.json` reported `mpd-docker-e2e:local`. [Hosted run](https://github.com/HaroldZ32/My-Power-Dsh/actions/runs/45208404104) · [Artifact](https://github.com/HaroldZ32/My-Power-Dsh/actions/runs/45208404104/artifacts/14835497164)

The reporter and driver share the pack assertion names. Both modes require presence, licence coherence, declaration coherence and static byte coherence. Source also requires rebuild freshness, compiler identity and the mutation control. One-click permits the three rebuild rows to remain null. The driver requires the reported container image to equal the selected Compose image before accepting a green report. Both Compose services interpolate that same tag into the container's environment.

The shared command publishes its stamp before checkout and staging, then records the current phase and the final exit. Archive, extraction and pack failures keep exit 2 and retain the underlying child status. Docker's exit passes through. GitHub prints the receipt when present and uploads the current stamp. PR and `dev` push filters omit evidence-only changes, so changes to directly invoked scripts or any pack input can trigger the job.

| Check | Observed result |
|---|---|
| `node scripts/docker-acceptance.ts --self-test` | Exit 0. The Git fixture required the workflow output before archive. Archive, extraction and pack failure receipts preserved child statuses 19, 21 and 23 with exit 2. The Docker fixture's exit 3 passed through. |
| `node scripts/docker-e2e.ts --self-test` | Exit 0. A real reporter replay backfilled all seven pack names with null. The source control failed for null rebuild rows, one-click permitted them, and one-click failed for a missing common pack witness. A green report with a different or absent image tag failed. |
| Rendered `docker compose config --format json` | Exit 0. Both service image tags equalled their `MPD_E2E_IMAGE` value under an explicit candidate tag. |
| Workflow YAML structure | Exit 0. Verified shared evidence-only exclusion for PR and dev push, retained schedule and dispatch, one acceptance command, exact-stamp upload and receipt summary. |
| Targeted strict TypeScript, declaration gate and `git diff --check` | Exit 0. Declaration gate scanned 705 TypeScript files and inspected 62,642 declarations. |

The hosted artifact above predates this follow-up. The added tests use fixture subprocesses or Compose configuration rendering and exercise no live model credentials.
